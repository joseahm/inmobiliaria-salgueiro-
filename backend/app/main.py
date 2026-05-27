from __future__ import annotations

import csv
import email
from email.header import decode_header, make_header
from email.utils import parseaddr
import io
import imaplib
import os
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from .config import get_settings
from .database import create_db_and_tables, engine, get_session
from .models import (
    Charge,
    Contract,
    CashMovement,
    Attachment,
    AuditLog,
    EmailImportRun,
    EmailInboxConfig,
    EmailProviderRule,
    InvoiceDocument,
    OwnerSettlement,
    OwnerCharge,
    Payment,
    PaymentAllocation,
    Person,
    Property,
    PropertyOwnerShare,
    PropertyServiceAccount,
    PropertyVisit,
    PublicPaymentLink,
    Reminder,
    TenantCredit,
)
from .schemas import (
    AdvanceRentPaymentCreate,
    AllocationRequest,
    BulkMonthlyRequest,
    ChargeCreate,
    ChargeUpdate,
    CashMovementCreate,
    ContractCreate,
    EmailInboxConfigCreate,
    EmailInboxConfigUpdate,
    EmailProviderRuleCreate,
    InvoiceDocumentCreate,
    InvoiceDocumentUpdate,
    LoginRequest,
    OwnerChargeCreate,
    PaymentCreate,
    PaymentIntentCreate,
    PersonCreate,
    PropertyAccountUpdate,
    PropertyCreate,
    PropertyServiceAccountCreate,
    PropertyVisitCreate,
    PublicLinkCreate,
    ReminderPreviewRequest,
    SettlementGenerateRequest,
    VoidRequest,
)
from .security import create_access_token, verify_demo_credentials
from .seed import seed_demo_data
from .services import (
    attachment_to_dict,
    audit_log,
    audit_log_to_dict,
    analyze_invoice_text,
    apply_allocations,
    build_reminder_message,
    cash_movement_to_dict,
    charge_to_dict,
    contract_to_dict,
    create_cash_movement_for_owner_charge,
    create_cash_movement_for_payment,
    create_advance_rent_payment,
    create_charge_from_invoice,
    create_owner_charge_from_invoice,
    email_import_run_to_dict,
    email_inbox_to_dict,
    email_rule_to_dict,
    extract_text_from_invoice_upload,
    find_service_account_match,
    generate_monthly_charges,
    generate_owner_settlements,
    money,
    invoice_document_to_dict,
    owner_charge_to_dict,
    paid_amount_for_charge,
    person_debt_summary,
    property_service_to_dict,
    property_visit_to_dict,
    public_link_charge_ids,
    refresh_all_charge_statuses,
    refresh_charge_status,
    remaining_for_charge,
    settlement_to_dict,
    tenant_credit_to_dict,
    unallocated_amount_for_payment,
    void_owner_charge,
    void_payment,
)


settings = get_settings()
app = FastAPI(title="Sistema Inmobiliaria Salgueiro", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()
    if settings.seed_demo_data_on_startup:
        with Session(engine) as session:
            seed_demo_data(session)


def not_found(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail=message)


def ensure_not_referenced(has_reference: bool, message: str) -> None:
    if has_reference:
        raise HTTPException(status_code=400, detail=message)


def ensure_charges_can_notify(session: Session, charge_ids: List[int]) -> None:
    for charge_id in charge_ids:
        charge = session.get(Charge, charge_id)
        if not charge:
            raise not_found("Deuda no encontrada")
        contract = session.get(Contract, charge.contract_id)
        property_obj = session.get(Property, contract.property_id) if contract else None
        if not contract or not contract.active:
            raise HTTPException(status_code=400, detail="No se puede avisar una deuda sin contrato activo.")
        if property_obj and property_obj.occupancy_status != "alquilada":
            raise HTTPException(status_code=400, detail="No se puede avisar una deuda de una finca no alquilada.")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "app": settings.app_name}


def safe_filename(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", filename or "archivo")
    return cleaned[:120] or "archivo"


def parse_visit_datetime(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Fecha y hora de visita inválida") from exc


def apply_guarantee_defaults(data: Dict[str, Any]) -> Dict[str, Any]:
    guarantee_type = str(data.get("guarantee_type") or "").lower()
    if guarantee_type == "anda":
        data["guarantee_percent"] = 2.0
        data["payment_origin"] = "ANDA"
    elif guarantee_type in {"contaduria", "contaduría"}:
        data["guarantee_percent"] = 3.0
        data["payment_origin"] = "Contaduria"
    return data


def find_duplicate_invoice(
    session: Session,
    provider: str,
    account_number: str,
    amount: float,
    due_date: date,
) -> Optional[InvoiceDocument]:
    invoices = session.exec(
        select(InvoiceDocument).where(
            InvoiceDocument.provider == provider,
            InvoiceDocument.due_date == due_date,
            InvoiceDocument.status != "anulada",
        )
    ).all()
    for invoice in invoices:
        same_amount = abs(float(invoice.amount or 0) - float(amount or 0)) < 0.01
        same_account = bool(account_number and invoice.account_number and invoice.account_number == account_number)
        weak_same = not account_number and not invoice.account_number
        if same_amount and (same_account or weak_same):
            return invoice
    return None


def create_invoice_document_from_bytes(
    session: Session,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    source: str,
    notes: str = "Factura importada",
) -> Dict[str, object]:
    extracted = extract_text_from_invoice_upload(
        file_bytes=file_bytes,
        content_type=content_type,
        filename=filename,
    )
    analysis = analyze_invoice_text(
        session=session,
        text=str(extracted["text"]),
        filename=filename,
        content_type=content_type,
        warnings=list(extracted["warnings"]),
    )
    service = find_service_account_match(session, str(analysis.get("account") or ""), str(analysis.get("provider") or ""))
    property_id = service.property_id if service else analysis.get("matched_property_id")
    due_date = datetime.fromisoformat(str(analysis.get("due_date") or datetime.utcnow().date().isoformat())).date()
    provider = str(analysis.get("concept") or analysis.get("provider") or "OTROS")
    account_number = str(analysis.get("account") or analysis.get("matched_account") or "")
    amount = float(analysis.get("amount") or 0)
    duplicate = find_duplicate_invoice(session, provider, account_number, amount, due_date)
    if duplicate:
        return {"invoice": duplicate, "analysis": analysis}
    invoice = InvoiceDocument(
        provider=provider,
        account_number=account_number,
        property_id=int(property_id) if property_id else None,
        service_account_id=service.id if service else None,
        responsible_type=service.payer if service else "tenant",
        amount=amount,
        due_date=due_date,
        period=(str(analysis.get("due_date") or due_date.isoformat())[:7]),
        status="pendiente",
        source=source,
        raw_text_preview=str(analysis.get("raw_text_preview") or "")[:1200],
        notes=notes,
    )
    session.add(invoice)
    session.commit()
    session.refresh(invoice)

    folder = os.path.join("uploads", "invoice", str(invoice.id))
    os.makedirs(folder, exist_ok=True)
    stored_filename = safe_filename(filename or "factura")
    storage_path = os.path.join(folder, f"{uuid4().hex}_{stored_filename}")
    with open(storage_path, "wb") as target:
        target.write(file_bytes)
    attachment = Attachment(
        entity_type="invoice",
        entity_id=invoice.id or 0,
        filename=stored_filename,
        content_type=content_type,
        storage_path=storage_path,
        notes=notes,
    )
    session.add(attachment)
    session.commit()
    session.refresh(attachment)
    invoice.attachment_id = attachment.id
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    return {"invoice": invoice, "analysis": analysis}


def create_invoice_document_from_text(
    session: Session,
    text: str,
    filename: str,
    source: str,
    notes: str,
) -> Optional[InvoiceDocument]:
    analysis = analyze_invoice_text(
        session=session,
        text=text,
        filename=filename,
        content_type="text/plain",
        warnings=[],
    )
    if not analysis.get("amount") and not analysis.get("due_date"):
        return None
    service = find_service_account_match(session, str(analysis.get("account") or ""), str(analysis.get("provider") or ""))
    property_id = service.property_id if service else analysis.get("matched_property_id")
    due_date = datetime.fromisoformat(str(analysis.get("due_date") or datetime.utcnow().date().isoformat())).date()
    provider = str(analysis.get("concept") or analysis.get("provider") or "OTROS")
    account_number = str(analysis.get("account") or analysis.get("matched_account") or "")
    amount = float(analysis.get("amount") or 0)
    duplicate = find_duplicate_invoice(session, provider, account_number, amount, due_date)
    if duplicate:
        return duplicate
    invoice = InvoiceDocument(
        provider=provider,
        account_number=account_number,
        property_id=int(property_id) if property_id else None,
        service_account_id=service.id if service else None,
        responsible_type=service.payer if service else "tenant",
        amount=amount,
        due_date=due_date,
        period=(str(analysis.get("due_date") or due_date.isoformat())[:7]),
        status="pendiente",
        source=source,
        raw_text_preview=str(analysis.get("raw_text_preview") or "")[:1200],
        notes=notes,
    )
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    audit_log(session, "invoice", invoice.id, "import_email_body", notes)
    return invoice


def secret_from_env_or_file(secret_name: str) -> Optional[str]:
    if not secret_name:
        return None
    value = os.environ.get(secret_name)
    if value:
        return value.replace("\xa0", " ").strip()
    env_path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(env_path):
        return None
    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, raw_value = line.split("=", 1)
            if key.strip() == secret_name:
                return raw_value.strip().strip('"').strip("'").replace("\xa0", " ").strip()
    return None


@app.post("/auth/login")
def login(payload: LoginRequest) -> Dict[str, object]:
    if not verify_demo_credentials(payload.email, payload.password):
        raise HTTPException(status_code=401, detail="Credenciales invalidas")
    return {
        "access_token": create_access_token(payload.email),
        "token_type": "bearer",
        "user": {"email": payload.email, "name": "Admin demo"},
    }


@app.get("/dashboard/summary")
def dashboard_summary(session: Session = Depends(get_session)) -> Dict[str, object]:
    charges = session.exec(select(Charge)).all()
    refresh_all_charge_statuses(session, charges)
    payments = session.exec(select(Payment)).all()
    cash_movements = session.exec(select(CashMovement)).all()
    today = datetime.utcnow().date()
    month_prefix = f"{today.year}-{today.month:02d}-"

    pending_total = sum(remaining_for_charge(session, charge) for charge in charges if charge.status != "pagado")
    overdue_total = sum(remaining_for_charge(session, charge) for charge in charges if charge.status == "vencido")
    collected_month = sum(
        payment.amount
        for payment in payments
        if payment.payment_date.isoformat().startswith(month_prefix)
    )
    cash_in_month = sum(
        movement.amount
        for movement in cash_movements
        if movement.status == "confirmado"
        and movement.movement_type == "entrada"
        and movement.movement_date.isoformat().startswith(month_prefix)
    )
    cash_out_month = sum(
        movement.amount
        for movement in cash_movements
        if movement.status == "confirmado"
        and movement.movement_type == "salida"
        and movement.movement_date.isoformat().startswith(month_prefix)
    )
    due_soon = [
        charge_to_dict(session, charge)
        for charge in charges
        if charge.status in {"pendiente", "parcial"}
        and today <= charge.due_date <= today + timedelta(days=7)
    ][:6]
    recent_payments = sorted(payments, key=lambda item: item.payment_date, reverse=True)[:6]

    return {
        "pending_total": money(pending_total),
        "overdue_total": money(overdue_total),
        "collected_month": money(collected_month),
        "open_charges": len([charge for charge in charges if charge.status != "pagado"]),
        "cash_in_month": money(cash_in_month),
        "cash_out_month": money(cash_out_month),
        "cash_balance_month": money(cash_in_month - cash_out_month),
        "due_soon": due_soon,
        "recent_payments": [
            {
                "id": payment.id,
                "person_name": session.get(Person, payment.person_id).full_name
                if session.get(Person, payment.person_id)
                else "",
                "payment_date": payment.payment_date.isoformat(),
                "amount": money(payment.amount),
                "method": payment.method,
                "reference": payment.reference,
            }
            for payment in recent_payments
        ],
    }


@app.get("/persons")
def list_persons(
    person_type: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    query = select(Person)
    people = session.exec(query).all()
    if person_type:
        people = [
            person
            for person in people
            if person.person_type == person_type or person.person_type == "both"
        ]
    return [person_debt_summary(session, person) for person in people]


@app.post("/persons")
def create_person(payload: PersonCreate, session: Session = Depends(get_session)) -> Dict[str, Any]:
    person = Person(**payload.model_dump())
    session.add(person)
    session.commit()
    session.refresh(person)
    return person.model_dump()


@app.patch("/persons/{person_id}")
def update_person(
    person_id: int, payload: PersonCreate, session: Session = Depends(get_session)
) -> Dict[str, Any]:
    person = session.get(Person, person_id)
    if not person:
        raise not_found("Persona no encontrada")
    for key, value in payload.model_dump().items():
        setattr(person, key, value)
    session.add(person)
    session.commit()
    session.refresh(person)
    return person.model_dump()


@app.get("/persons/{person_id}/detail")
def person_detail(person_id: int, session: Session = Depends(get_session)) -> Dict[str, object]:
    person = session.get(Person, person_id)
    if not person:
        raise not_found("Persona no encontrada")
    charges = session.exec(
        select(Charge).where(Charge.responsible_person_id == person_id)
    ).all()
    refresh_all_charge_statuses(session, charges)
    payments = session.exec(
        select(Payment).where(Payment.person_id == person_id)
    ).all()
    contracts = session.exec(
        select(Contract).where(Contract.tenant_id == person_id)
    ).all()
    reminders = session.exec(
        select(Reminder).where(Reminder.person_id == person_id)
    ).all()
    return {
        "person": person_debt_summary(session, person),
        "charges": [charge_to_dict(session, charge) for charge in charges],
        "payments": [
            {
                "id": payment.id,
                "payment_date": payment.payment_date.isoformat(),
                "amount": money(payment.amount),
                "method": payment.method,
                "reference": payment.reference,
                "notes": payment.notes,
            }
            for payment in payments
        ],
        "contracts": [contract_to_dict(session, contract) for contract in contracts],
        "reminders": [
            {
                "id": reminder.id,
                "channel": reminder.channel,
                "status": reminder.status,
                "message": reminder.message,
                "created_at": reminder.created_at.isoformat(),
                "sent_at": reminder.sent_at.isoformat() if reminder.sent_at else None,
            }
            for reminder in reminders
        ],
    }


@app.delete("/persons/{person_id}")
def delete_person(person_id: int, session: Session = Depends(get_session)) -> Dict[str, str]:
    person = session.get(Person, person_id)
    if not person:
        raise not_found("Persona no encontrada")
    ensure_not_referenced(
        bool(session.exec(select(Contract).where(Contract.tenant_id == person_id)).first())
        or bool(session.exec(select(PropertyOwnerShare).where(PropertyOwnerShare.owner_id == person_id)).first())
        or bool(session.exec(select(Charge).where(Charge.responsible_person_id == person_id)).first())
        or bool(session.exec(select(Payment).where(Payment.person_id == person_id)).first())
        or bool(session.exec(select(Reminder).where(Reminder.person_id == person_id)).first())
        or bool(session.exec(select(PublicPaymentLink).where(PublicPaymentLink.person_id == person_id)).first())
        or bool(session.exec(select(OwnerSettlement).where(OwnerSettlement.owner_id == person_id)).first()),
        "No se puede eliminar una persona con contratos, propiedades, deudas, pagos o historial asociado.",
    )
    session.delete(person)
    session.commit()
    return {"status": "deleted"}


@app.get("/properties")
def list_properties(session: Session = Depends(get_session)) -> List[Dict[str, object]]:
    properties = session.exec(select(Property)).all()
    result = []
    for property_obj in properties:
        shares = session.exec(
            select(PropertyOwnerShare).where(
                PropertyOwnerShare.property_id == property_obj.id
            )
        ).all()
        owners = []
        for share in shares:
            owner = session.get(Person, share.owner_id)
            if owner:
                owners.append(
                    {
                        "id": owner.id,
                        "full_name": owner.full_name,
                        "percentage": share.percentage,
                        "is_primary": share.is_primary,
                        "irpf_applies": share.irpf_applies,
                    }
                )
        data = property_obj.model_dump()
        data["owners"] = owners
        services = session.exec(
            select(PropertyServiceAccount).where(PropertyServiceAccount.property_id == property_obj.id)
        ).all()
        data["services"] = [property_service_to_dict(service) for service in services]
        result.append(data)
    return result


@app.post("/properties")
def create_property(
    payload: PropertyCreate, session: Session = Depends(get_session)
) -> Dict[str, Any]:
    data = payload.model_dump(exclude={"owner_id", "owner_percentage", "owner_shares"})
    property_obj = Property(**data)
    session.add(property_obj)
    session.commit()
    session.refresh(property_obj)
    owner_shares = payload.owner_shares or []
    if not owner_shares and payload.owner_id:
        owner_shares = [
            {
                "owner_id": payload.owner_id,
                "percentage": payload.owner_percentage,
                "is_primary": True,
                "irpf_applies": True,
            }
        ]
    for index, share in enumerate(owner_shares):
        session.add(
            PropertyOwnerShare(
                property_id=property_obj.id or 0,
                owner_id=share.owner_id if hasattr(share, "owner_id") else share["owner_id"],
                percentage=share.percentage if hasattr(share, "percentage") else share["percentage"],
                is_primary=(share.is_primary if hasattr(share, "is_primary") else share.get("is_primary", False)) or index == 0,
                irpf_applies=share.irpf_applies if hasattr(share, "irpf_applies") else share.get("irpf_applies", True),
            )
        )
        session.commit()
        session.refresh(property_obj)
    return property_obj.model_dump()


@app.patch("/properties/{property_id}")
def update_property(
    property_id: int, payload: PropertyCreate, session: Session = Depends(get_session)
) -> Dict[str, Any]:
    property_obj = session.get(Property, property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    for key, value in payload.model_dump(exclude={"owner_id", "owner_percentage", "owner_shares"}).items():
        setattr(property_obj, key, value)
    session.add(property_obj)
    shares = session.exec(
        select(PropertyOwnerShare).where(PropertyOwnerShare.property_id == property_id)
    ).all()
    for share in shares:
        session.delete(share)
    owner_shares = payload.owner_shares or []
    if not owner_shares and payload.owner_id:
        owner_shares = [
            {
                "owner_id": payload.owner_id,
                "percentage": payload.owner_percentage,
                "is_primary": True,
                "irpf_applies": True,
            }
        ]
    for index, share in enumerate(owner_shares):
        session.add(
            PropertyOwnerShare(
                property_id=property_id,
                owner_id=share.owner_id if hasattr(share, "owner_id") else share["owner_id"],
                percentage=share.percentage if hasattr(share, "percentage") else share["percentage"],
                is_primary=(share.is_primary if hasattr(share, "is_primary") else share.get("is_primary", False)) or index == 0,
                irpf_applies=share.irpf_applies if hasattr(share, "irpf_applies") else share.get("irpf_applies", True),
            )
        )
    session.commit()
    session.refresh(property_obj)
    return property_obj.model_dump()


@app.patch("/properties/{property_id}/account")
def update_property_account(
    property_id: int,
    payload: PropertyAccountUpdate,
    session: Session = Depends(get_session),
) -> Dict[str, Any]:
    property_obj = session.get(Property, property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    provider = payload.provider.upper()
    field_by_provider = {
        "UTE": "ute_account",
        "OSE": "ose_account",
        "TRIBUTOS": "taxes_account",
        "SANEAMIENTO": "sanitation_account",
    }
    field = field_by_provider.get(provider, "notes")
    if field == "notes":
        property_obj.notes = f"{property_obj.notes}\nCuenta {provider}: {payload.account}".strip()
    else:
        setattr(property_obj, field, payload.account)
    session.add(property_obj)
    session.commit()
    session.refresh(property_obj)
    contract = session.exec(
        select(Contract).where(Contract.property_id == property_id, Contract.active == True)  # noqa: E712
    ).first()
    return {
        "property": property_obj.model_dump(),
        "matched_contract": contract_to_dict(session, contract) if contract else None,
    }


@app.get("/properties/{property_id}/detail")
def property_detail(property_id: int, session: Session = Depends(get_session)) -> Dict[str, object]:
    property_obj = session.get(Property, property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    services = session.exec(
        select(PropertyServiceAccount).where(PropertyServiceAccount.property_id == property_id)
    ).all()
    contracts = session.exec(select(Contract).where(Contract.property_id == property_id)).all()
    contract_ids = [contract.id for contract in contracts if contract.id]
    charges = session.exec(select(Charge)).all()
    charges = [charge for charge in charges if charge.contract_id in contract_ids]
    owner_charges = session.exec(
        select(OwnerCharge).where(OwnerCharge.property_id == property_id)
    ).all()
    cash_movements = session.exec(
        select(CashMovement).where(CashMovement.property_id == property_id)
    ).all()
    attachments = session.exec(
        select(Attachment).where(Attachment.entity_type == "property", Attachment.entity_id == property_id)
    ).all()
    base = next(item for item in list_properties(session=session) if item["id"] == property_id)
    return {
        "property": base,
        "services": [property_service_to_dict(service) for service in services],
        "contracts": [contract_to_dict(session, contract) for contract in contracts],
        "charges": [charge_to_dict(session, charge) for charge in charges],
        "owner_charges": [owner_charge_to_dict(session, item) for item in owner_charges],
        "cash_movements": [cash_movement_to_dict(session, item) for item in cash_movements],
        "attachments": [attachment_to_dict(item) for item in attachments],
    }


@app.post("/properties/{property_id}/services")
def create_property_service(
    property_id: int,
    payload: PropertyServiceAccountCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    property_obj = session.get(Property, property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    if payload.payer not in {"tenant", "owner", "agency"}:
        raise HTTPException(status_code=400, detail="Pagador invalido")
    service = PropertyServiceAccount(property_id=property_id, **payload.model_dump())
    session.add(service)
    session.commit()
    session.refresh(service)
    audit_log(session, "property_service", service.id, "create", f"Servicio {service.service_type} para finca {property_id}")
    return property_service_to_dict(service)


@app.patch("/properties/{property_id}/services/{service_id}")
def update_property_service(
    property_id: int,
    service_id: int,
    payload: PropertyServiceAccountCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    service = session.get(PropertyServiceAccount, service_id)
    if not service or service.property_id != property_id:
        raise not_found("Servicio no encontrado")
    for key, value in payload.model_dump().items():
        setattr(service, key, value)
    session.add(service)
    session.commit()
    session.refresh(service)
    audit_log(session, "property_service", service.id, "update", f"Servicio {service.service_type} actualizado")
    return property_service_to_dict(service)


@app.delete("/properties/{property_id}/services/{service_id}")
def delete_property_service(
    property_id: int,
    service_id: int,
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    service = session.get(PropertyServiceAccount, service_id)
    if not service or service.property_id != property_id:
        raise not_found("Servicio no encontrado")
    session.delete(service)
    session.commit()
    audit_log(session, "property_service", service_id, "delete", f"Servicio {service_id} eliminado")
    return {"status": "deleted"}


@app.delete("/properties/{property_id}")
def delete_property(property_id: int, session: Session = Depends(get_session)) -> Dict[str, str]:
    property_obj = session.get(Property, property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    ensure_not_referenced(
        bool(session.exec(select(Contract).where(Contract.property_id == property_id)).first()),
        "No se puede eliminar una propiedad con contratos asociados.",
    )
    shares = session.exec(
        select(PropertyOwnerShare).where(PropertyOwnerShare.property_id == property_id)
    ).all()
    for share in shares:
        session.delete(share)
    session.delete(property_obj)
    session.commit()
    return {"status": "deleted"}


@app.get("/property-visits")
def list_property_visits(
    status: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    query = select(PropertyVisit)
    if status:
        query = query.where(PropertyVisit.status == status)
    visits = session.exec(query).all()
    return [
        property_visit_to_dict(session, visit)
        for visit in sorted(visits, key=lambda item: item.visit_at)
    ]


@app.post("/property-visits")
def create_property_visit(
    payload: PropertyVisitCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    property_obj = session.get(Property, payload.property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    data = payload.model_dump()
    data["visit_at"] = parse_visit_datetime(data["visit_at"])
    if not data.get("contact_message"):
        data["contact_message"] = (
            f"Hola {data['interested_name']}, te escribo para confirmar la visita a "
            f"{property_obj.reference} el {data['visit_at'].strftime('%d/%m/%Y a las %H:%M')}."
        )
    visit = PropertyVisit(**data)
    session.add(visit)
    session.commit()
    session.refresh(visit)
    return property_visit_to_dict(session, visit)


@app.patch("/property-visits/{visit_id}")
def update_property_visit(
    visit_id: int, payload: PropertyVisitCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    visit = session.get(PropertyVisit, visit_id)
    if not visit:
        raise not_found("Visita no encontrada")
    property_obj = session.get(Property, payload.property_id)
    if not property_obj:
        raise not_found("Propiedad no encontrada")
    data = payload.model_dump()
    data["visit_at"] = parse_visit_datetime(data["visit_at"])
    for key, value in data.items():
        setattr(visit, key, value)
    session.add(visit)
    session.commit()
    session.refresh(visit)
    return property_visit_to_dict(session, visit)


@app.delete("/property-visits/{visit_id}")
def delete_property_visit(visit_id: int, session: Session = Depends(get_session)) -> Dict[str, str]:
    visit = session.get(PropertyVisit, visit_id)
    if not visit:
        raise not_found("Visita no encontrada")
    session.delete(visit)
    session.commit()
    return {"status": "deleted"}


@app.get("/contracts")
def list_contracts(session: Session = Depends(get_session)) -> List[Dict[str, object]]:
    contracts = session.exec(select(Contract)).all()
    return [contract_to_dict(session, contract) for contract in contracts]


@app.post("/contracts")
def create_contract(
    payload: ContractCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    if payload.active:
        existing_contracts = session.exec(
            select(Contract).where(
                Contract.property_id == payload.property_id,
                Contract.active == True,  # noqa: E712
            )
        ).all()
        for existing in existing_contracts:
            existing.active = False
            existing.end_date = payload.start_date - timedelta(days=1)
            session.add(existing)
    contract = Contract(**apply_guarantee_defaults(payload.model_dump()))
    session.add(contract)
    session.commit()
    session.refresh(contract)
    return contract_to_dict(session, contract)


@app.patch("/contracts/{contract_id}")
def update_contract(
    contract_id: int, payload: ContractCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    contract = session.get(Contract, contract_id)
    if not contract:
        raise not_found("Contrato no encontrado")
    if payload.active:
        existing_contracts = session.exec(
            select(Contract).where(
                Contract.property_id == payload.property_id,
                Contract.active == True,  # noqa: E712
                Contract.id != contract_id,
            )
        ).all()
        for existing in existing_contracts:
            existing.active = False
            existing.end_date = payload.start_date - timedelta(days=1)
            session.add(existing)
    for key, value in apply_guarantee_defaults(payload.model_dump()).items():
        setattr(contract, key, value)
    session.add(contract)
    session.commit()
    session.refresh(contract)
    return contract_to_dict(session, contract)


@app.delete("/contracts/{contract_id}")
def delete_contract(contract_id: int, session: Session = Depends(get_session)) -> Dict[str, str]:
    contract = session.get(Contract, contract_id)
    if not contract:
        raise not_found("Contrato no encontrado")
    ensure_not_referenced(
        bool(session.exec(select(Charge).where(Charge.contract_id == contract_id)).first()),
        "No se puede eliminar un contrato con deudas asociadas.",
    )
    session.delete(contract)
    session.commit()
    return {"status": "deleted"}


@app.get("/charges")
def list_charges(
    status: Optional[str] = Query(default=None),
    person_id: Optional[int] = Query(default=None),
    search: str = "",
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    charges = session.exec(select(Charge)).all()
    refresh_all_charge_statuses(session, charges)
    rows = [charge_to_dict(session, charge) for charge in charges]
    if status and status != "todas":
        rows = [row for row in rows if row["status"] == status]
    if person_id:
        rows = [row for row in rows if row["responsible_person_id"] == person_id]
    if search:
        needle = search.lower()
        rows = [
            row
            for row in rows
            if needle in str(row["tenant_name"]).lower()
            or needle in str(row["property_address"]).lower()
            or needle in str(row["concept"]).lower()
        ]
    return sorted(rows, key=lambda row: str(row["due_date"]))


@app.post("/charges")
def create_charge(
    payload: ChargeCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    contract = session.get(Contract, payload.contract_id)
    if not contract:
        raise not_found("Contrato no encontrado")
    data = payload.model_dump()
    if data["responsible_person_id"] is None:
        data["responsible_person_id"] = contract.tenant_id
    if not data["accrual_period"]:
        data["accrual_period"] = data["period"]
    if not data["settlement_period"]:
        data["settlement_period"] = data["period"]
    charge = Charge(**data)
    session.add(charge)
    session.commit()
    session.refresh(charge)
    refresh_charge_status(session, charge)
    session.commit()
    return charge_to_dict(session, charge)


@app.patch("/charges/{charge_id}")
def update_charge(
    charge_id: int,
    payload: ChargeUpdate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    charge = session.get(Charge, charge_id)
    if not charge:
        raise not_found("Deuda no encontrada")
    contract = session.get(Contract, payload.contract_id)
    if not contract:
        raise not_found("Contrato no encontrado")
    data = payload.model_dump()
    if data["responsible_person_id"] is None:
        data["responsible_person_id"] = contract.tenant_id
    if not data["accrual_period"]:
        data["accrual_period"] = data["period"]
    if not data["settlement_period"]:
        data["settlement_period"] = data["period"]
    for key, value in data.items():
        setattr(charge, key, value)
    session.add(charge)
    session.commit()
    session.refresh(charge)
    refresh_charge_status(session, charge)
    session.commit()
    return charge_to_dict(session, charge)


@app.delete("/charges/{charge_id}")
def delete_charge(charge_id: int, session: Session = Depends(get_session)) -> Dict[str, str]:
    charge = session.get(Charge, charge_id)
    if not charge:
        raise not_found("Deuda no encontrada")
    ensure_not_referenced(
        bool(session.exec(select(PaymentAllocation).where(PaymentAllocation.charge_id == charge_id)).first())
        or bool(session.exec(select(Reminder).where(Reminder.charge_id == charge_id)).first())
        or any(
            charge_id in public_link_charge_ids(link.charge_ids_csv)
            for link in session.exec(select(PublicPaymentLink)).all()
        ),
        "No se puede eliminar una deuda con pagos, recordatorios o links asociados.",
    )
    session.delete(charge)
    session.commit()
    return {"status": "deleted"}


@app.post("/charges/bulk-monthly")
def bulk_monthly(
    payload: BulkMonthlyRequest, session: Session = Depends(get_session)
) -> Dict[str, object]:
    try:
        created = generate_monthly_charges(session, payload.period, payload.due_day)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"created": len(created), "charges": [charge_to_dict(session, item) for item in created]}


@app.post("/invoice-scan/analyze")
async def analyze_invoice_upload(
    file: UploadFile = File(...), session: Session = Depends(get_session)
) -> Dict[str, object]:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Archivo vacio")
    extracted = extract_text_from_invoice_upload(
        file_bytes=file_bytes,
        content_type=file.content_type or "",
        filename=file.filename or "",
    )
    return analyze_invoice_text(
        session=session,
        text=str(extracted["text"]),
        filename=file.filename or "",
        content_type=file.content_type or "",
        warnings=list(extracted["warnings"]),
    ) | {
        "ocr_available": extracted["ocr_available"],
        "analysis_source": extracted["analysis_source"],
    }


@app.get("/invoice-documents")
def list_invoice_documents(
    status: Optional[str] = Query(default=None),
    provider: Optional[str] = Query(default=None),
    property_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    invoices = session.exec(select(InvoiceDocument)).all()
    if status and status != "todos":
        invoices = [item for item in invoices if item.status == status]
    if provider and provider != "todos":
        invoices = [item for item in invoices if item.provider.upper() == provider.upper()]
    if property_id:
        invoices = [item for item in invoices if item.property_id == property_id]
    return [
        invoice_document_to_dict(session, invoice)
        for invoice in sorted(invoices, key=lambda item: (item.due_date, item.id or 0), reverse=True)
    ]


def enrich_invoice_data_from_service(session: Session, data: Dict[str, Any]) -> Dict[str, Any]:
    service = None
    if data.get("service_account_id"):
        service = session.get(PropertyServiceAccount, data["service_account_id"])
    if not service and data.get("account_number"):
        service = find_service_account_match(session, str(data.get("account_number")), str(data.get("provider", "")))
    if service:
        data["service_account_id"] = service.id
        data["property_id"] = service.property_id
        data["responsible_type"] = service.payer
    if not data.get("period") and data.get("due_date"):
        data["period"] = data["due_date"].strftime("%Y-%m")
    return data


@app.post("/invoice-documents")
def create_invoice_document(
    payload: InvoiceDocumentCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    data = enrich_invoice_data_from_service(session, payload.model_dump())
    invoice = InvoiceDocument(**data)
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    audit_log(session, "invoice", invoice.id, "create", f"Factura {invoice.provider} {invoice.account_number}")
    return invoice_document_to_dict(session, invoice)


@app.patch("/invoice-documents/{invoice_id}")
def update_invoice_document(
    invoice_id: int,
    payload: InvoiceDocumentUpdate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    invoice = session.get(InvoiceDocument, invoice_id)
    if not invoice:
        raise not_found("Factura no encontrada")
    data = enrich_invoice_data_from_service(session, payload.model_dump())
    for key, value in data.items():
        setattr(invoice, key, value)
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    audit_log(session, "invoice", invoice.id, "update", f"Factura {invoice.provider} actualizada")
    return invoice_document_to_dict(session, invoice)


@app.delete("/invoice-documents/{invoice_id}")
def delete_invoice_document(
    invoice_id: int,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    invoice = session.get(InvoiceDocument, invoice_id)
    if not invoice:
        raise not_found("Factura no encontrada")
    if invoice.charge_id or invoice.owner_charge_id:
        invoice.status = "anulada"
        invoice.notes = (invoice.notes + "\n" if invoice.notes else "") + "Factura anulada; el cargo vinculado se conserva."
        session.add(invoice)
        session.commit()
        audit_log(session, "invoice", invoice.id, "void", f"Factura {invoice.id} anulada")
        return {"status": "anulada", "invoice": invoice_document_to_dict(session, invoice)}
    session.delete(invoice)
    session.commit()
    audit_log(session, "invoice", invoice_id, "delete", f"Factura {invoice_id} eliminada")
    return {"status": "deleted"}


@app.post("/invoice-documents/{invoice_id}/create-charge")
def create_charge_from_invoice_endpoint(
    invoice_id: int,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    invoice = session.get(InvoiceDocument, invoice_id)
    if not invoice:
        raise not_found("Factura no encontrada")
    if invoice.responsible_type == "tenant":
        charge = create_charge_from_invoice(session, invoice)
        if not charge:
            raise HTTPException(status_code=400, detail="No se pudo crear deuda: falta contrato activo o datos de finca.")
        return {"invoice": invoice_document_to_dict(session, invoice), "charge": charge_to_dict(session, charge)}
    owner_charge = create_owner_charge_from_invoice(session, invoice)
    if not owner_charge:
        raise HTTPException(status_code=400, detail="No se pudo crear debito a propietario.")
    return {"invoice": invoice_document_to_dict(session, invoice), "owner_charge": owner_charge_to_dict(session, owner_charge)}


@app.post("/invoice-documents/import")
async def import_invoice_document(
    file: UploadFile = File(...),
    source: str = "manual",
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Archivo vacio")
    result = create_invoice_document_from_bytes(
        session=session,
        file_bytes=file_bytes,
        filename=file.filename or "factura",
        content_type=file.content_type or "",
        source=source,
        notes="Importada desde adjunto",
    )
    invoice = result["invoice"]
    analysis = result["analysis"]
    audit_log(session, "invoice", invoice.id, "import", f"Factura importada desde {source}")
    return {"invoice": invoice_document_to_dict(session, invoice), "analysis": analysis}


@app.get("/email-inboxes")
def list_email_inboxes(session: Session = Depends(get_session)) -> List[Dict[str, object]]:
    inboxes = session.exec(select(EmailInboxConfig)).all()
    return [email_inbox_to_dict(session, inbox) for inbox in inboxes]


@app.get("/email-inboxes/setup-status")
def email_setup_status(session: Session = Depends(get_session)) -> Dict[str, object]:
    inbox = session.exec(select(EmailInboxConfig).where(EmailInboxConfig.active == True)).first()  # noqa: E712
    secret_name = inbox.secret_env_var if inbox else settings.invoices_email_secret_env_var
    secret = secret_from_env_or_file(secret_name)
    rules = (
        session.exec(select(EmailProviderRule).where(EmailProviderRule.inbox_id == inbox.id)).all()
        if inbox and inbox.id
        else []
    )
    return {
        "email_address": inbox.email_address if inbox else settings.invoices_email_address,
        "host": inbox.host if inbox else settings.invoices_email_host,
        "folder": inbox.folder if inbox else settings.invoices_email_folder,
        "secret_env_var": secret_name,
        "has_inbox": bool(inbox),
        "has_secret": bool(secret and "pegar-aca" not in secret.lower()),
        "has_rules": bool(rules),
        "rules_count": len(rules),
        "ready": bool(inbox and secret and "pegar-aca" not in secret.lower() and rules),
    }


@app.post("/email-inboxes")
def create_email_inbox(
    payload: EmailInboxConfigCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    inbox = EmailInboxConfig(**payload.model_dump())
    session.add(inbox)
    session.commit()
    session.refresh(inbox)
    audit_log(session, "email_inbox", inbox.id, "create", f"Bandeja {inbox.email_address}")
    return email_inbox_to_dict(session, inbox)


@app.patch("/email-inboxes/{inbox_id}")
def update_email_inbox(
    inbox_id: int,
    payload: EmailInboxConfigUpdate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    inbox = session.get(EmailInboxConfig, inbox_id)
    if not inbox:
        raise not_found("Bandeja no encontrada")
    for key, value in payload.model_dump().items():
        setattr(inbox, key, value)
    session.add(inbox)
    session.commit()
    session.refresh(inbox)
    audit_log(session, "email_inbox", inbox.id, "update", f"Bandeja {inbox.email_address} actualizada")
    return email_inbox_to_dict(session, inbox)


@app.delete("/email-inboxes/{inbox_id}")
def delete_email_inbox(
    inbox_id: int,
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    inbox = session.get(EmailInboxConfig, inbox_id)
    if not inbox:
        raise not_found("Bandeja no encontrada")
    rules = session.exec(select(EmailProviderRule).where(EmailProviderRule.inbox_id == inbox_id)).all()
    for rule in rules:
        session.delete(rule)
    session.delete(inbox)
    session.commit()
    audit_log(session, "email_inbox", inbox_id, "delete", f"Bandeja {inbox_id} eliminada")
    return {"status": "deleted"}


@app.post("/email-inboxes/{inbox_id}/rules")
def create_email_rule(
    inbox_id: int,
    payload: EmailProviderRuleCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    inbox = session.get(EmailInboxConfig, inbox_id)
    if not inbox:
        raise not_found("Bandeja no encontrada")
    rule = EmailProviderRule(inbox_id=inbox_id, **payload.model_dump())
    session.add(rule)
    session.commit()
    session.refresh(rule)
    audit_log(session, "email_rule", rule.id, "create", f"Regla {rule.provider} para {inbox.email_address}")
    return email_rule_to_dict(rule)


@app.delete("/email-inboxes/{inbox_id}/rules/{rule_id}")
def delete_email_rule(
    inbox_id: int,
    rule_id: int,
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    rule = session.get(EmailProviderRule, rule_id)
    if not rule or rule.inbox_id != inbox_id:
        raise not_found("Regla no encontrada")
    session.delete(rule)
    session.commit()
    audit_log(session, "email_rule", rule_id, "delete", f"Regla {rule_id} eliminada")
    return {"status": "deleted"}


def email_matches_rule(sender: str, subject: str, rule: EmailProviderRule) -> bool:
    sender_needle = strip_rule_text(rule.sender_pattern)
    sender_ok = not sender_needle or sender_needle in strip_rule_text(sender) or sender_needle in strip_rule_text(subject)
    keywords = [item.strip().lower() for item in rule.subject_keywords.split(",") if item.strip()]
    subject_ok = not keywords or all(strip_rule_text(keyword) in strip_rule_text(subject) for keyword in keywords)
    return sender_ok and subject_ok


def strip_rule_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def decode_email_header(value: str) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # noqa: BLE001
        return value


def extract_email_body_text(message: email.message.Message) -> str:
    chunks: List[str] = []
    for part in message.walk():
        if part.get_filename():
            continue
        content_type = part.get_content_type()
        if content_type not in {"text/plain", "text/html"}:
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        charset = part.get_content_charset() or "utf-8"
        text = payload.decode(charset, errors="replace")
        if content_type == "text/html":
            text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
            text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
            text = re.sub(r"<[^>]+>", " ", text)
        chunks.append(text)
    return "\n".join(chunks).strip()


@app.post("/email-inboxes/{inbox_id}/scan")
def scan_email_inbox(
    inbox_id: int,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    inbox = session.get(EmailInboxConfig, inbox_id)
    if not inbox:
        raise not_found("Bandeja no encontrada")
    run = EmailImportRun(inbox_id=inbox_id, status="running")
    session.add(run)
    session.commit()
    session.refresh(run)
    password = secret_from_env_or_file(inbox.secret_env_var or "")
    if password and inbox.host.lower().endswith("gmail.com"):
        password = password.replace(" ", "")
    if not inbox.active or not inbox.host or not inbox.username or not inbox.secret_env_var or not password:
        run.status = "config_pendiente"
        run.finished_at = datetime.utcnow()
        run.notes = "Falta host, usuario o variable de entorno con la clave/app-password del correo."
        session.add(run)
        session.commit()
        session.refresh(run)
        return {"run": email_import_run_to_dict(run), "invoices": []}

    rules = session.exec(
        select(EmailProviderRule).where(
            EmailProviderRule.inbox_id == inbox_id,
            EmailProviderRule.active == True,  # noqa: E712
        )
    ).all()
    created: List[InvoiceDocument] = []
    messages_seen = 0
    messages_checked = 0
    messages_ignored = 0
    try:
        with imaplib.IMAP4_SSL(inbox.host, inbox.port) as mailbox:
            mailbox.login(inbox.username, password)
            mailbox.select(inbox.folder or "INBOX")
            _, search_data = mailbox.search(None, "ALL")
            message_ids = (search_data[0].split() if search_data and search_data[0] else [])[-25:]
            for message_id in message_ids:
                _, fetch_data = mailbox.fetch(message_id, "(RFC822)")
                if not fetch_data or not fetch_data[0]:
                    continue
                messages_checked += 1
                raw_message = fetch_data[0][1]
                message = email.message_from_bytes(raw_message)
                sender = decode_email_header(str(message.get("From", "")))
                sender_email = parseaddr(sender)[1]
                subject = decode_email_header(str(message.get("Subject", "")))
                if rules and not any(email_matches_rule(sender, subject, rule) for rule in rules):
                    messages_ignored += 1
                    continue
                messages_seen += 1
                message_created: List[InvoiceDocument] = []
                for part in message.walk():
                    filename = part.get_filename()
                    payload = part.get_payload(decode=True)
                    if not filename or not payload:
                        continue
                    lower_name = filename.lower()
                    if not lower_name.endswith((".pdf", ".png", ".jpg", ".jpeg", ".txt")):
                        continue
                    content_type = part.get_content_type() or "application/octet-stream"
                    result = create_invoice_document_from_bytes(
                        session=session,
                        file_bytes=payload,
                        filename=filename,
                        content_type=content_type,
                        source="email",
                        notes=f"Importada desde correo {sender}",
                    )
                    invoice = result["invoice"]
                    if invoice not in created and invoice not in message_created:
                        created.append(invoice)
                        message_created.append(invoice)
                if not message_created:
                    body_text = extract_email_body_text(message)
                    if body_text:
                        body_invoice = create_invoice_document_from_text(
                            session=session,
                            text=f"{subject}\n{sender}\n{body_text}",
                            filename=f"correo-{message_id.decode() if isinstance(message_id, bytes) else message_id}.txt",
                            source="email_body",
                            notes=f"Importada desde cuerpo del correo {sender_email or sender}",
                        )
                        if body_invoice and body_invoice not in created:
                            created.append(body_invoice)
            inbox.last_checked_at = datetime.utcnow()
            run.status = "ok"
            run.messages_seen = messages_seen
            run.invoices_created = len(created)
            run.finished_at = datetime.utcnow()
            run.notes = f"Escaneo completado. Correos recientes revisados: {messages_checked}. Ignorados por reglas: {messages_ignored}."
            session.add(inbox)
            session.add(run)
            session.commit()
    except Exception as exc:  # noqa: BLE001
        run.status = "error"
        run.finished_at = datetime.utcnow()
        run.messages_seen = messages_seen
        run.invoices_created = len(created)
        run.notes = f"{str(exc)[:420]} | revisados={messages_checked} ignorados={messages_ignored}"
        session.add(run)
        session.commit()
    session.refresh(run)
    return {
        "run": email_import_run_to_dict(run),
        "invoices": [invoice_document_to_dict(session, invoice) for invoice in created],
    }


@app.post("/payments")
def create_payment(
    payload: PaymentCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    payment = Payment(**payload.model_dump(exclude={"allocations"}))
    session.add(payment)
    session.commit()
    session.refresh(payment)
    if payload.allocations:
        try:
            apply_allocations(
                session,
                payment,
                [allocation.model_dump() for allocation in payload.allocations],
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    cash_movement = create_cash_movement_for_payment(session, payment)
    return {
        "id": payment.id,
        "person_id": payment.person_id,
        "payment_date": payment.payment_date.isoformat(),
        "amount": money(payment.amount),
        "allocated_amount": money(payment.amount - unallocated_amount_for_payment(session, payment)),
        "unallocated_amount": unallocated_amount_for_payment(session, payment),
        "method": payment.method,
        "reference": payment.reference,
        "notes": payment.notes,
        "status": payment.status,
        "cash_movement": cash_movement_to_dict(session, cash_movement),
    }


@app.get("/tenant-credits")
def list_tenant_credits(
    person_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    credits = session.exec(select(TenantCredit)).all()
    if person_id:
        credits = [credit for credit in credits if credit.person_id == person_id]
    return [tenant_credit_to_dict(session, credit) for credit in credits]


@app.post("/payments/advance-rent")
def create_advance_rent_payment_endpoint(
    payload: AdvanceRentPaymentCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    contract = session.get(Contract, payload.contract_id)
    if not contract:
        raise not_found("Contrato no encontrado")
    try:
        result = create_advance_rent_payment(
            session=session,
            contract=contract,
            months=payload.months,
            payment_date=payload.payment_date,
            method=payload.method,
            reference=payload.reference,
            notes=payload.notes,
            due_day=payload.due_day,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payment = result["payment"]
    return {
        "payment": {
            "id": payment.id,
            "person_id": payment.person_id,
            "payment_date": payment.payment_date.isoformat(),
            "amount": money(payment.amount),
            "method": payment.method,
            "reference": payment.reference,
            "notes": payment.notes,
            "status": payment.status,
        },
        "charges": [charge_to_dict(session, charge) for charge in result["charges"]],
        "cash_movement": cash_movement_to_dict(session, result["cash_movement"]),
    }


@app.post("/payments/{payment_id}/allocate")
def allocate_payment(
    payment_id: int, payload: AllocationRequest, session: Session = Depends(get_session)
) -> Dict[str, object]:
    payment = session.get(Payment, payment_id)
    if not payment:
        raise not_found("Pago no encontrado")
    try:
        apply_allocations(
            session,
            payment,
            [allocation.model_dump() for allocation in payload.allocations],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/payments/{payment_id}/void")
def void_payment_endpoint(
    payment_id: int,
    payload: VoidRequest,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    payment = session.get(Payment, payment_id)
    if not payment:
        raise not_found("Pago no encontrado")
    try:
        reversal = void_payment(session, payment, payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "anulado", "cash_reversal": cash_movement_to_dict(session, reversal)}


@app.get("/cash-movements")
def list_cash_movements(
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    movement_type: Optional[str] = Query(default=None),
    person_id: Optional[int] = Query(default=None),
    property_id: Optional[int] = Query(default=None),
    origin: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    movements = session.exec(select(CashMovement)).all()
    if date_from:
        movements = [item for item in movements if item.movement_date.isoformat() >= date_from]
    if date_to:
        movements = [item for item in movements if item.movement_date.isoformat() <= date_to]
    if movement_type and movement_type != "todos":
        movements = [item for item in movements if item.movement_type == movement_type]
    if person_id:
        movements = [item for item in movements if item.person_id == person_id]
    if property_id:
        movements = [item for item in movements if item.property_id == property_id]
    if origin and origin != "todos":
        movements = [item for item in movements if item.origin == origin]
    return [
        cash_movement_to_dict(session, movement)
        for movement in sorted(movements, key=lambda item: (item.movement_date, item.id or 0), reverse=True)
    ]


@app.post("/cash-movements/manual")
def create_manual_cash_movement(
    payload: CashMovementCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    if payload.movement_type not in {"entrada", "salida"}:
        raise HTTPException(status_code=400, detail="Tipo de movimiento invalido")
    movement = CashMovement(
        **payload.model_dump(),
        origin="manual",
    )
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return cash_movement_to_dict(session, movement)


@app.get("/owner-charges")
def list_owner_charges(
    period: Optional[str] = Query(default=None),
    owner_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    owner_charges = session.exec(select(OwnerCharge)).all()
    if period:
        owner_charges = [item for item in owner_charges if item.period == period]
    if owner_id:
        owner_charges = [item for item in owner_charges if item.owner_id == owner_id]
    return [owner_charge_to_dict(session, item) for item in owner_charges]


@app.post("/owner-charges")
def create_owner_charge(
    payload: OwnerChargeCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    owner = session.get(Person, payload.owner_id)
    property_obj = session.get(Property, payload.property_id)
    if not owner:
        raise not_found("Propietario no encontrado")
    if not property_obj:
        raise not_found("Finca no encontrada")
    data = payload.model_dump()
    if not data["period"]:
        data["period"] = data["charge_date"].strftime("%Y-%m")
    owner_charge = OwnerCharge(**data)
    session.add(owner_charge)
    session.commit()
    session.refresh(owner_charge)
    movement = create_cash_movement_for_owner_charge(session, owner_charge)
    response = owner_charge_to_dict(session, owner_charge)
    response["cash_movement"] = cash_movement_to_dict(session, movement) if movement else None
    return response


@app.post("/owner-charges/{owner_charge_id}/void")
def void_owner_charge_endpoint(
    owner_charge_id: int,
    payload: VoidRequest,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    owner_charge = session.get(OwnerCharge, owner_charge_id)
    if not owner_charge:
        raise not_found("Debito a propietario no encontrado")
    try:
        reversal = void_owner_charge(session, owner_charge, payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "status": "anulado",
        "cash_reversal": cash_movement_to_dict(session, reversal) if reversal else None,
    }


@app.post("/reminders/preview")
def reminder_preview(
    payload: ReminderPreviewRequest, session: Session = Depends(get_session)
) -> Dict[str, object]:
    ensure_charges_can_notify(session, payload.charge_ids)
    try:
        preview = build_reminder_message(session, payload.charge_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    person = preview["person"]
    return {
        "person_id": person.id if person else payload.person_id,
        "channel": payload.channel,
        "message": preview["message"],
        "whatsapp_url": preview["whatsapp_url"],
    }


@app.post("/reminders/simulate-send")
def reminder_simulate_send(
    payload: ReminderPreviewRequest, session: Session = Depends(get_session)
) -> Dict[str, object]:
    preview = reminder_preview(payload, session)
    person_id = int(preview["person_id"])
    reminders = []
    for charge_id in payload.charge_ids:
        reminder = Reminder(
            charge_id=charge_id,
            person_id=person_id,
            channel=payload.channel,
            message=str(preview["message"]),
            status="simulado",
            sent_at=datetime.utcnow(),
        )
        session.add(reminder)
        reminders.append(reminder)
    session.commit()
    return {"created": len(reminders), **preview}


@app.post("/public-links")
def create_public_link(
    payload: PublicLinkCreate, session: Session = Depends(get_session)
) -> Dict[str, object]:
    person = session.get(Person, payload.person_id)
    if not person:
        raise not_found("Persona no encontrada")
    ensure_charges_can_notify(session, payload.charge_ids)
    token = uuid4().hex[:18]
    link = PublicPaymentLink(
        token=token,
        person_id=payload.person_id,
        charge_ids_csv=",".join(str(charge_id) for charge_id in payload.charge_ids),
        expires_at=datetime.utcnow() + timedelta(days=payload.days_valid),
    )
    session.add(link)
    session.commit()
    session.refresh(link)
    return {
        "token": token,
        "url": f"http://localhost:5173/public/{token}",
        "expires_at": link.expires_at.isoformat(),
    }


@app.get("/public/{token}")
def public_link(token: str, session: Session = Depends(get_session)) -> Dict[str, object]:
    link = session.exec(
        select(PublicPaymentLink).where(PublicPaymentLink.token == token)
    ).first()
    if not link:
        raise not_found("Link no encontrado")
    if link.expires_at < datetime.utcnow():
        link.status = "expirado"
        session.add(link)
        session.commit()
    person = session.get(Person, link.person_id)
    charge_ids = public_link_charge_ids(link.charge_ids_csv)
    charges = [
        charge_to_dict(session, charge)
        for charge in [session.get(Charge, charge_id) for charge_id in charge_ids]
        if charge
    ]
    return {
        "status": link.status,
        "person": person.model_dump() if person else None,
        "charges": charges,
        "total": money(sum(row["remaining_amount"] for row in charges)),
        "expires_at": link.expires_at.isoformat(),
    }


@app.post("/public/{token}/payment-intent")
def public_payment_intent(
    token: str,
    payload: PaymentIntentCreate,
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    link = session.exec(
        select(PublicPaymentLink).where(PublicPaymentLink.token == token)
    ).first()
    if not link:
        raise not_found("Link no encontrado")
    link.status = "intencion_pago"
    session.add(link)
    session.commit()
    return {
        "status": "intencion_pago",
        "message": "Pago simulado registrado. En una integracion real aca impactaria la pasarela.",
        "payer_name": payload.payer_name,
    }


@app.post("/attachments/{entity_type}/{entity_id}")
async def upload_attachment(
    entity_type: str,
    entity_id: int,
    file: UploadFile = File(...),
    notes: str = "",
    session: Session = Depends(get_session),
) -> Dict[str, object]:
    allowed = {"property", "person", "contract", "charge", "payment", "owner_charge", "settlement"}
    if entity_type not in allowed:
        raise HTTPException(status_code=400, detail="Tipo de adjunto invalido")
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Archivo vacio")
    folder = os.path.join("uploads", entity_type, str(entity_id))
    os.makedirs(folder, exist_ok=True)
    filename = safe_filename(file.filename or "archivo")
    storage_path = os.path.join(folder, f"{uuid4().hex}_{filename}")
    with open(storage_path, "wb") as target:
        target.write(file_bytes)
    attachment = Attachment(
        entity_type=entity_type,
        entity_id=entity_id,
        filename=filename,
        content_type=file.content_type or "",
        storage_path=storage_path,
        notes=notes,
    )
    session.add(attachment)
    session.commit()
    session.refresh(attachment)
    audit_log(session, entity_type, entity_id, "attach_file", filename)
    return attachment_to_dict(attachment)


@app.get("/attachments/{entity_type}/{entity_id}")
def list_attachments(
    entity_type: str,
    entity_id: int,
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    attachments = session.exec(
        select(Attachment).where(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
    ).all()
    return [attachment_to_dict(item) for item in attachments]


@app.get("/audit-log")
def list_audit_log(
    entity_type: Optional[str] = Query(default=None),
    entity_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    rows = session.exec(select(AuditLog)).all()
    if entity_type:
        rows = [row for row in rows if row.entity_type == entity_type]
    if entity_id:
        rows = [row for row in rows if row.entity_id == entity_id]
    return [audit_log_to_dict(row) for row in sorted(rows, key=lambda item: item.created_at, reverse=True)]


@app.get("/settlements/owners")
def list_owner_settlements(
    period: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> List[Dict[str, object]]:
    settlements = session.exec(select(OwnerSettlement)).all()
    if period:
        settlements = [settlement for settlement in settlements if settlement.period == period]
    return [settlement_to_dict(session, settlement) for settlement in settlements]


@app.post("/settlements/owners/generate")
def generate_settlements(
    payload: SettlementGenerateRequest, session: Session = Depends(get_session)
) -> List[Dict[str, object]]:
    settlements = generate_owner_settlements(session, payload.period)
    return [settlement_to_dict(session, settlement) for settlement in settlements]


def csv_response(filename: str, headers: List[str], rows: List[Dict[str, object]]) -> StreamingResponse:
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow({header: row.get(header, "") for header in headers})
    stream.seek(0)
    return StreamingResponse(
        iter([stream.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/exports/charges.csv")
def export_charges(session: Session = Depends(get_session)) -> StreamingResponse:
    rows = list_charges(status=None, person_id=None, search="", session=session)
    headers = [
        "id",
        "tenant_name",
        "property_reference",
        "concept",
        "amount",
        "paid_amount",
        "remaining_amount",
        "due_date",
        "status",
    ]
    return csv_response("deudas.csv", headers, rows)


@app.get("/exports/settlements.csv")
def export_settlements(session: Session = Depends(get_session)) -> StreamingResponse:
    rows = list_owner_settlements(period=None, session=session)
    headers = [
        "id",
        "owner_name",
        "period",
        "income",
        "expenses",
        "commission",
        "iva",
        "irpf",
        "total_to_transfer",
        "status",
    ]
    return csv_response("liquidaciones.csv", headers, rows)


@app.get("/exports/accounting.csv")
def export_accounting(period: Optional[str] = Query(default=None), session: Session = Depends(get_session)) -> StreamingResponse:
    settlements = list_owner_settlements(period=period, session=session)
    rows: List[Dict[str, object]] = []
    for settlement in settlements:
        for line in settlement.get("lines", []):
            rows.append(
                {
                    "period": settlement["period"],
                    "owner_name": settlement["owner_name"],
                    "property_reference": line["property_reference"],
                    "tenant_name": line["tenant_name"],
                    "concept": line["concept"],
                    "accrual_period": line["accrual_period"],
                    "payment_date": line["payment_date"],
                    "owner_percentage": line["owner_percentage"],
                    "income": line["owner_amount"],
                    "expense": line["expense_amount"],
                    "commission": line["commission"],
                    "iva": line["iva"],
                    "irpf": line["irpf"],
                    "net_amount": line["net_amount"],
                }
            )
    headers = [
        "period",
        "owner_name",
        "property_reference",
        "tenant_name",
        "concept",
        "accrual_period",
        "payment_date",
        "owner_percentage",
        "income",
        "expense",
        "commission",
        "iva",
        "irpf",
        "net_amount",
    ]
    return csv_response("contabilidad.csv", headers, rows)


@app.get("/exports/dgi-irpf.csv")
def export_dgi_irpf(period: Optional[str] = Query(default=None), session: Session = Depends(get_session)) -> StreamingResponse:
    settlements = list_owner_settlements(period=period, session=session)
    rows: List[Dict[str, object]] = []
    for item in settlements:
        taxable_lines = [line for line in item.get("lines", []) if line.get("irpf", 0) > 0]
        taxable_income = money(sum(float(line["owner_amount"]) for line in taxable_lines))
        irpf_withheld = money(sum(float(line["irpf"]) for line in taxable_lines))
        if irpf_withheld <= 0:
            continue
        rows.append(
            {
                "period": item["period"],
                "owner_name": item["owner_name"],
                "taxable_income": taxable_income,
                "irpf_withheld": irpf_withheld,
                "source_lines": len(taxable_lines),
                "status": item["status"],
            }
        )
    return csv_response("dgi_irpf.csv", ["period", "owner_name", "taxable_income", "irpf_withheld", "source_lines", "status"], rows)

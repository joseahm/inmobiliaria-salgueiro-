from __future__ import annotations

import io
import os
import re
import shutil
import unicodedata
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Sequence
from urllib.parse import quote

from sqlmodel import Session, select

from .config import get_settings
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
    OwnerSettlementLine,
    OwnerCharge,
    Payment,
    PaymentAllocation,
    Person,
    Property,
    PropertyOwnerShare,
    PropertyServiceAccount,
    PropertyVisit,
    TenantCredit,
)


def money(value: float) -> float:
    return round(float(value or 0), 2)


def audit_log(
    session: Session,
    entity_type: str,
    entity_id: Optional[int],
    action: str,
    description: str = "",
    created_by: str = "admin",
) -> AuditLog:
    entry = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        description=description,
        created_by=created_by,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def strip_accents(value: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", value or "")
        if unicodedata.category(char) != "Mn"
    )


def compact_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", strip_accents(value).lower())


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def parse_invoice_number(value: str) -> Optional[float]:
    cleaned = re.sub(r"[^\d,.\-]", "", value or "")
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(".") > cleaned.rfind(","):
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    elif "." in cleaned:
        groups = cleaned.split(".")
        if len(groups[-1]) == 3 and all(group.isdigit() for group in groups):
            cleaned = "".join(groups)
    try:
        return money(float(cleaned))
    except ValueError:
        return None


def valid_invoice_amount(value: Optional[float]) -> bool:
    return value is not None and 0 < value <= 500_000


def line_has_percentage_number(line: str, raw_match: str) -> bool:
    escaped = re.escape(raw_match.strip())
    return bool(re.search(rf"{escaped}\s*%", line))


def detect_invoice_provider(text: str, filename: str = "") -> Dict[str, str]:
    haystack = strip_accents(f"{filename}\n{text}").lower()
    checks = [
        ("UTE", "UTE", [r"\bute\b", r"ute\.com", r"energia electrica", r"electricidad"]),
        ("OSE", "OSE", [r"\bose\b", r"obras sanitarias", r"agua potable"]),
        (
            "Gastos comunes",
            "GASTOS_COMUNES",
            [r"gastos comunes", r"expensas", r"administracion edificio", r"liquidacion edificio", r"gastos a pagar"],
        ),
        ("Tributos", "TRIBUTOS", [r"tributos", r"intendencia", r"contribucion", r"primaria"]),
        ("Saneamiento", "SANEAMIENTO", [r"saneamiento"]),
    ]
    for provider, concept, patterns in checks:
        if any(re.search(pattern, haystack, re.I) for pattern in patterns):
            return {"provider": provider, "concept": concept}
    return {"provider": "No identificado", "concept": "OTROS"}


def extract_invoice_amount(text: str) -> Optional[float]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    keyword_re = re.compile(r"(total\s+a\s+pagar|importe|monto|saldo|total|pagar)", re.I)
    number_re = re.compile(r"(?<!\d)(?:\$?\s*)?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)(?!\d)")
    candidates: List[float] = []
    for line in lines:
        if keyword_re.search(strip_accents(line)):
            for match in number_re.findall(line):
                number = parse_invoice_number(match)
                if valid_invoice_amount(number) and number > 100 and not line_has_percentage_number(line, match):
                    candidates.append(number)
    if candidates:
        return max(candidates)

    for match in number_re.findall(text):
        number = parse_invoice_number(match)
        if valid_invoice_amount(number) and number > 100:
            candidates.append(number)
    return max(candidates) if candidates else None


def parse_invoice_date(raw: str) -> Optional[str]:
    raw = raw.strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def extract_invoice_due_date(text: str) -> Optional[str]:
    date_re = re.compile(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})")
    normalized = strip_accents(text)
    for line in normalized.splitlines():
        if re.search(r"venc|vence|pagar antes|fecha limite", line, re.I):
            for match in date_re.findall(line):
                parsed = parse_invoice_date(match)
                if parsed:
                    return parsed
    for match in date_re.findall(normalized):
        parsed = parse_invoice_date(match)
        if parsed:
            return parsed
    return None


def extract_invoice_account(text: str) -> str:
    normalized = strip_accents(text)
    account_re = re.compile(
        r"(?:cuenta|servicio|nis|cliente|referencia|contrato)\D{0,18}([A-Z0-9][A-Z0-9\-.\/ ]{3,24})",
        re.I,
    )
    for match in account_re.findall(normalized):
        candidate = match.strip(" -./:")
        if len(compact_key(candidate)) >= 4 and len(re.findall(r"\d", candidate)) >= 4:
            return candidate
    return ""


def normalize_ute_account(raw: str) -> str:
    digits = digits_only(raw)
    return digits[:10] if len(digits) >= 10 else digits


def extract_ute_account(text: str) -> str:
    normalized = strip_accents(text)
    long_references = re.findall(r"\b(\d{20,})\b", normalized)
    for reference in long_references:
        if reference.startswith("56"):
            return reference[:10]

    patterns = [
        r"e-?ticket\s+credito\D{0,20}([\d\s]{7,18})",
        r"referencia\s+de\s+pago\D{0,30}(\d{10})\d+",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, re.I | re.S)
        if match:
            account = normalize_ute_account(match.group(1))
            if len(account) >= 7:
                return account

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if re.search(r"e-?ticket|credito", line, re.I):
            for next_line in lines[index + 1 : index + 5]:
                if re.search(r"rut|telefono|tel|paraguay|montevideo|1930", next_line, re.I):
                    continue
                account = normalize_ute_account(next_line)
                if len(account) >= 7:
                    return account
        if re.search(r"cuenta", line, re.I):
            inline_match = re.search(r"(UTE[-\s]?\d{4,}|\b\d{7,12}\b)", line, re.I)
            if inline_match:
                raw_account = inline_match.group(1).strip().replace(" ", "").upper()
                return raw_account if raw_account.startswith("UTE") else normalize_ute_account(raw_account)
            for next_line in lines[index + 1 : index + 9]:
                if re.search(
                    r"rut|telefono|tel|paraguay|montevideo|1930|iva|importe|total|cargo|%|\$",
                    next_line,
                    re.I,
                ) or parse_invoice_date(next_line):
                    continue
                account = normalize_ute_account(next_line)
                if len(account) >= 7:
                    return account
    return ""


def extract_ute_amount(text: str) -> Optional[float]:
    normalized = strip_accents(text)
    currency_values = []
    for match in re.findall(r"\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2})?)", normalized):
        number = parse_invoice_number(match)
        if valid_invoice_amount(number) and number and number > 100:
            currency_values.append(number)
    if currency_values:
        return max(currency_values)

    total_match = re.search(
        r"(?:importe\s+total|total\s+cargos\s+del\s+mes|total)\D{0,80}(\d{1,3}(?:\.\d{3})*(?:,\d{2}))",
        normalized,
        re.I | re.S,
    )
    if total_match:
        number = parse_invoice_number(total_match.group(1))
        if valid_invoice_amount(number):
            return number

    barcode_amount = re.search(r"\*0{4,}(\d{4,9})\*", normalized)
    if barcode_amount:
        number = money(int(barcode_amount.group(1)) / 100)
        if valid_invoice_amount(number):
            return number
    return None


def extract_ute_due_date(text: str) -> Optional[str]:
    normalized = strip_accents(text)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        line_key = line.lower()
        if "venc" in line_key and "prox" not in line_key and "emision" not in line_key:
            for next_line in lines[index : index + 8]:
                next_key = next_line.lower()
                if (
                    next_line != line
                    and ("prox" in next_key or "emision" in next_key or "factura" in next_key)
                ):
                    break
                dates = re.findall(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}", next_line)
                if dates:
                    return parse_invoice_date(dates[0])

    for index, line in enumerate(lines):
        line_key = line.lower()
        if "prox" in line_key and "venc" in line_key:
            for next_line in lines[index + 1 : index + 4]:
                dates = re.findall(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}", next_line)
                if dates:
                    return parse_invoice_date(dates[-1])

    labeled = re.search(
        r"vencimiento[^\n\d]{0,30}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})",
        normalized,
        re.I,
    )
    if labeled:
        return parse_invoice_date(labeled.group(1))

    for index, line in enumerate(lines):
        if re.search(r"e-?ticket|credito", line, re.I):
            seen_account = False
            for next_line in lines[index + 1 : index + 8]:
                if not seen_account and re.fullmatch(r"\d{7,12}", next_line):
                    seen_account = True
                    continue
                if seen_account:
                    parsed = parse_invoice_date(next_line)
                    if parsed:
                        return parsed
    return None


def extract_provider_specific_fields(provider: str, text: str) -> Dict[str, object]:
    if provider == "UTE":
        return {
            "account": extract_ute_account(text),
            "amount": extract_ute_amount(text),
            "due_date": extract_ute_due_date(text),
        }
    return {}


def property_accounts(property_obj: Property) -> Sequence[str]:
    return [
        property_obj.ute_account,
        property_obj.ose_account,
        property_obj.taxes_account,
        property_obj.sanitation_account,
        property_obj.padron,
    ]


def property_service_to_dict(service: PropertyServiceAccount) -> Dict[str, object]:
    return {
        "id": service.id,
        "property_id": service.property_id,
        "service_type": service.service_type,
        "provider": service.provider,
        "account_number": service.account_number,
        "payer": service.payer,
        "active": service.active,
        "notes": service.notes,
        "created_at": service.created_at.isoformat(),
    }


def attachment_to_dict(attachment: Attachment) -> Dict[str, object]:
    return {
        "id": attachment.id,
        "entity_type": attachment.entity_type,
        "entity_id": attachment.entity_id,
        "filename": attachment.filename,
        "content_type": attachment.content_type,
        "notes": attachment.notes,
        "uploaded_at": attachment.uploaded_at.isoformat(),
    }


def invoice_document_to_dict(session: Session, invoice: InvoiceDocument) -> Dict[str, object]:
    property_obj = session.get(Property, invoice.property_id) if invoice.property_id else None
    service = session.get(PropertyServiceAccount, invoice.service_account_id) if invoice.service_account_id else None
    return {
        "id": invoice.id,
        "provider": invoice.provider,
        "account_number": invoice.account_number,
        "property_id": invoice.property_id,
        "property_reference": property_obj.reference if property_obj else "",
        "property_address": property_obj.address if property_obj else "",
        "service_account_id": invoice.service_account_id,
        "service_type": service.service_type if service else "",
        "responsible_type": invoice.responsible_type,
        "amount": money(invoice.amount),
        "due_date": invoice.due_date.isoformat(),
        "period": invoice.period,
        "status": invoice.status,
        "source": invoice.source,
        "attachment_id": invoice.attachment_id,
        "charge_id": invoice.charge_id,
        "owner_charge_id": invoice.owner_charge_id,
        "raw_text_preview": invoice.raw_text_preview,
        "notes": invoice.notes,
        "created_at": invoice.created_at.isoformat(),
    }


def email_rule_to_dict(rule: EmailProviderRule) -> Dict[str, object]:
    return {
        "id": rule.id,
        "inbox_id": rule.inbox_id,
        "provider": rule.provider,
        "sender_pattern": rule.sender_pattern,
        "subject_keywords": rule.subject_keywords,
        "active": rule.active,
        "created_at": rule.created_at.isoformat(),
    }


def email_inbox_to_dict(session: Session, inbox: EmailInboxConfig) -> Dict[str, object]:
    rules = session.exec(
        select(EmailProviderRule).where(EmailProviderRule.inbox_id == inbox.id)
    ).all()
    return {
        "id": inbox.id,
        "name": inbox.name,
        "email_address": inbox.email_address,
        "provider": inbox.provider,
        "host": inbox.host,
        "port": inbox.port,
        "username": inbox.username,
        "secret_env_var": inbox.secret_env_var,
        "folder": inbox.folder,
        "active": inbox.active,
        "last_checked_at": inbox.last_checked_at.isoformat() if inbox.last_checked_at else None,
        "notes": inbox.notes,
        "created_at": inbox.created_at.isoformat(),
        "rules": [email_rule_to_dict(rule) for rule in rules],
    }


def email_import_run_to_dict(run: EmailImportRun) -> Dict[str, object]:
    return {
        "id": run.id,
        "inbox_id": run.inbox_id,
        "status": run.status,
        "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "messages_seen": run.messages_seen,
        "invoices_created": run.invoices_created,
        "notes": run.notes,
    }


def audit_log_to_dict(entry: AuditLog) -> Dict[str, object]:
    return {
        "id": entry.id,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "action": entry.action,
        "description": entry.description,
        "created_by": entry.created_by,
        "created_at": entry.created_at.isoformat(),
    }


def find_invoice_match(session: Session, text: str, account: str = "") -> Dict[str, object]:
    text_key = compact_key(text)
    account_key = compact_key(account)
    properties = session.exec(select(Property)).all()
    for property_obj in properties:
        for property_account in property_accounts(property_obj):
            if not property_account:
                continue
            property_key = compact_key(property_account)
            if property_key and (property_key in text_key or property_key == account_key):
                contract = session.exec(
                    select(Contract).where(
                        Contract.property_id == property_obj.id,
                        Contract.active == True,  # noqa: E712
                    )
                ).first()
                tenant = session.get(Person, contract.tenant_id) if contract else None
                return {
                    "matched_property_id": property_obj.id,
                    "matched_property_reference": property_obj.reference,
                    "matched_property_address": property_obj.address,
                    "matched_contract_id": contract.id if contract else None,
                    "matched_tenant_id": tenant.id if tenant else None,
                    "matched_tenant_name": tenant.full_name if tenant else "",
                    "matched_account": property_account,
                }
    return {
        "matched_property_id": None,
        "matched_property_reference": "",
        "matched_property_address": "",
        "matched_contract_id": None,
        "matched_tenant_id": None,
        "matched_tenant_name": "",
        "matched_account": account,
    }


def find_service_account_match(session: Session, account: str = "", provider: str = "") -> Optional[PropertyServiceAccount]:
    account_key = compact_key(account)
    provider_key = compact_key(provider)
    if not account_key:
        return None
    services = session.exec(select(PropertyServiceAccount).where(PropertyServiceAccount.active == True)).all()  # noqa: E712
    for service in services:
        service_key = compact_key(service.account_number)
        provider_matches = not provider_key or provider_key in compact_key(f"{service.provider} {service.service_type}") or compact_key(service.provider) in provider_key
        if service_key and (service_key == account_key or service_key in account_key or account_key in service_key) and provider_matches:
            return service
    return None


def is_pdf_upload(content_type: str, filename: str) -> bool:
    return content_type == "application/pdf" or filename.lower().endswith(".pdf")


def preprocess_ocr_image(image, threshold: bool = False):
    from PIL import ImageEnhance, ImageOps

    processed = ImageOps.grayscale(image)
    processed = ImageEnhance.Contrast(processed).enhance(2.5)
    processed = processed.resize((processed.width * 3, processed.height * 3))
    if threshold:
        processed = processed.point(lambda pixel: 255 if pixel > 165 else 0)
    return processed


def ocr_image_bytes(file_bytes: bytes) -> str:
    from PIL import Image
    import pytesseract

    image = Image.open(io.BytesIO(file_bytes))
    texts: List[str] = []
    variants = [image]
    width, height = image.size
    top_half = image.crop((0, 0, width, int(height * 0.34)))
    variants.extend(
        [
            preprocess_ocr_image(image),
            preprocess_ocr_image(top_half),
            preprocess_ocr_image(top_half, threshold=True),
        ]
    )
    for variant in variants:
        config = "--psm 6" if variant is not image else ""
        text = pytesseract.image_to_string(variant, lang="spa+eng", config=config).strip()
        if text and text not in texts:
            texts.append(text)
    return "\n".join(texts)


def extract_text_from_pdf(file_bytes: bytes, ocr_available: bool) -> Dict[str, object]:
    warnings: List[str] = []
    text_parts: List[str] = []
    used_ocr = False

    try:
        import fitz
    except Exception as exc:  # pragma: no cover - dependency/runtime issue
        return {
            "text": "",
            "warnings": [f"No se pudo cargar el lector PDF: {exc}"],
            "used_ocr": False,
        }

    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        return {
            "text": "",
            "warnings": [f"No se pudo abrir el PDF: {exc}"],
            "used_ocr": False,
        }

    max_pages = min(document.page_count, 3)
    for page_index in range(max_pages):
        page = document.load_page(page_index)
        page_text = page.get_text("text").strip()
        if page_text:
            text_parts.append(page_text)

    has_useful_text = len("\n".join(text_parts).strip()) > 40
    if not has_useful_text and ocr_available:
        try:
            import pytesseract
            from PIL import Image

            for page_index in range(max_pages):
                page = document.load_page(page_index)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = Image.open(io.BytesIO(pixmap.tobytes("png")))
                page_text = ocr_image_bytes(pixmap.tobytes("png")).strip()
                if page_text:
                    text_parts.append(page_text)
                    used_ocr = True
        except Exception as exc:  # pragma: no cover - depends on local OCR setup
            warnings.append(f"No se pudo aplicar OCR al PDF: {exc}")

    text = "\n".join(text_parts).strip()
    if not text:
        warnings.append(
            "No se pudo leer texto del PDF. Probá subir una foto clara o un PDF con texto seleccionable."
        )

    return {"text": text, "warnings": warnings, "used_ocr": used_ocr}


def extract_text_from_invoice_upload(
    file_bytes: bytes, content_type: str = "", filename: str = ""
) -> Dict[str, object]:
    ocr_available = bool(shutil.which("tesseract"))
    warnings: List[str] = []
    text = ""
    analysis_source = "texto/nombre"

    if is_pdf_upload(content_type, filename):
        extracted = extract_text_from_pdf(file_bytes, ocr_available)
        text = str(extracted["text"])
        warnings.extend(list(extracted["warnings"]))
        analysis_source = "pdf-ocr" if extracted["used_ocr"] else "pdf-text"
    elif content_type.startswith("image/") and ocr_available:
        try:
            text = ocr_image_bytes(file_bytes)
            analysis_source = "ocr"
        except Exception as exc:  # pragma: no cover - depends on local OCR setup
            warnings.append(f"No se pudo leer la imagen con OCR: {exc}")
    elif content_type.startswith("image/") and not ocr_available:
        warnings.append("OCR local no disponible para leer imagenes.")

    if not text and not is_pdf_upload(content_type, filename):
        try:
            text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = ""

    if not text:
        warnings.append(
            "OCR local no disponible o archivo sin texto legible; se usaron pistas del nombre de archivo."
        )

    return {
        "text": text,
        "ocr_available": ocr_available,
        "warnings": warnings,
        "analysis_source": analysis_source,
    }


def analyze_invoice_text(
    session: Session, text: str, filename: str = "", content_type: str = "", warnings: Optional[List[str]] = None
) -> Dict[str, object]:
    combined = f"{filename}\n{text}"
    provider = detect_invoice_provider(combined, filename)
    specific = extract_provider_specific_fields(provider["provider"], combined)
    account = str(specific.get("account") or extract_invoice_account(combined))
    amount = specific.get("amount") or extract_invoice_amount(combined)
    due_date = specific.get("due_date") or extract_invoice_due_date(combined)
    match = find_invoice_match(session, combined, account)
    confidence = 0
    confidence += 25 if provider["concept"] != "OTROS" else 0
    confidence += 25 if amount else 0
    confidence += 20 if due_date else 0
    confidence += 30 if match["matched_contract_id"] else 0

    description_parts = [provider["provider"]]
    if account or match["matched_account"]:
        description_parts.append(f"cuenta {account or match['matched_account']}")
    description = "Factura " + " · ".join(part for part in description_parts if part)

    return {
        "provider": provider["provider"],
        "concept": provider["concept"],
        "amount": amount,
        "due_date": due_date,
        "account": account or match["matched_account"],
        "description": description,
        "confidence": confidence,
        "filename": filename,
        "content_type": content_type,
        "raw_text_preview": combined[:1200],
        "warnings": warnings or [],
        **match,
    }


def paid_amount_for_charge(session: Session, charge_id: int) -> float:
    allocations = session.exec(
        select(PaymentAllocation).where(
            PaymentAllocation.charge_id == charge_id,
            PaymentAllocation.status == "confirmado",
        )
    ).all()
    return money(sum(item.amount for item in allocations))


def allocated_amount_for_payment(session: Session, payment_id: int) -> float:
    allocations = session.exec(
        select(PaymentAllocation).where(
            PaymentAllocation.payment_id == payment_id,
            PaymentAllocation.status == "confirmado",
        )
    ).all()
    return money(sum(item.amount for item in allocations))


def unallocated_amount_for_payment(session: Session, payment: Payment) -> float:
    if payment.status != "confirmado":
        return 0
    return money(max(payment.amount - allocated_amount_for_payment(session, payment.id or 0), 0))


def remaining_for_charge(session: Session, charge: Charge) -> float:
    return money(max(charge.amount - paid_amount_for_charge(session, charge.id or 0), 0))


def computed_charge_status(session: Session, charge: Charge) -> str:
    paid = paid_amount_for_charge(session, charge.id or 0)
    if paid >= charge.amount:
        return "pagado"
    if paid > 0:
        return "parcial"
    if charge.due_date < date.today():
        return "vencido"
    return "pendiente"


def refresh_charge_status(session: Session, charge: Charge) -> Charge:
    charge.status = computed_charge_status(session, charge)
    session.add(charge)
    return charge


def refresh_all_charge_statuses(session: Session, charges: Iterable[Charge]) -> None:
    for charge in charges:
        refresh_charge_status(session, charge)
    session.commit()


def get_person(session: Session, person_id: int) -> Person:
    person = session.get(Person, person_id)
    if not person:
        raise ValueError("Persona no encontrada")
    return person


def get_contract(session: Session, contract_id: int) -> Contract:
    contract = session.get(Contract, contract_id)
    if not contract:
        raise ValueError("Contrato no encontrado")
    return contract


def charge_to_dict(session: Session, charge: Charge) -> Dict[str, object]:
    contract = session.get(Contract, charge.contract_id)
    tenant = session.get(Person, charge.responsible_person_id)
    property_obj = session.get(Property, contract.property_id) if contract else None
    paid = paid_amount_for_charge(session, charge.id or 0)
    status = computed_charge_status(session, charge)
    if charge.status != status:
        charge.status = status
        session.add(charge)
    return {
        "id": charge.id,
        "contract_id": charge.contract_id,
        "responsible_person_id": charge.responsible_person_id,
        "responsible_type": charge.responsible_type,
        "tenant_name": tenant.full_name if tenant else "",
        "tenant_mobile": tenant.mobile if tenant else "",
        "property_reference": property_obj.reference if property_obj else "",
        "property_address": property_obj.address if property_obj else "",
        "concept": charge.concept,
        "description": charge.description,
        "amount": money(charge.amount),
        "paid_amount": paid,
        "remaining_amount": money(max(charge.amount - paid, 0)),
        "due_date": charge.due_date.isoformat(),
        "period": charge.period,
        "accrual_period": charge.accrual_period or charge.period,
        "settlement_period": charge.settlement_period or charge.period,
        "status": status,
        "origin": charge.origin,
        "created_at": charge.created_at.isoformat(),
    }


def contract_to_dict(session: Session, contract: Contract) -> Dict[str, object]:
    tenant = session.get(Person, contract.tenant_id)
    property_obj = session.get(Property, contract.property_id)
    shares = session.exec(
        select(PropertyOwnerShare).where(
            PropertyOwnerShare.property_id == contract.property_id
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
                }
            )
    return {
        "id": contract.id,
        "legacy_code": contract.legacy_code,
        "property_id": contract.property_id,
        "tenant_id": contract.tenant_id,
        "tenant_name": tenant.full_name if tenant else "",
        "property_reference": property_obj.reference if property_obj else "",
        "property_address": property_obj.address if property_obj else "",
        "owners": owners,
        "start_date": contract.start_date.isoformat(),
        "end_date": contract.end_date.isoformat() if contract.end_date else None,
        "rent_amount": money(contract.rent_amount),
        "payment_type": contract.payment_type,
        "rent_payment_timing": contract.rent_payment_timing,
        "guarantee_type": contract.guarantee_type,
        "guarantee_provider": contract.guarantee_provider,
        "guarantee_percent": contract.guarantee_percent,
        "rent_regime": contract.rent_regime,
        "reajustment_index": contract.reajustment_index,
        "next_reajustment_date": contract.next_reajustment_date.isoformat() if contract.next_reajustment_date else "",
        "commission_percent": contract.commission_percent,
        "irpf_applies": contract.irpf_applies,
        "irpf_percent": contract.irpf_percent,
        "payment_origin": contract.payment_origin,
        "active": contract.active,
    }


def property_visit_to_dict(session: Session, visit: PropertyVisit) -> Dict[str, object]:
    property_obj = session.get(Property, visit.property_id)
    return {
        "id": visit.id,
        "property_id": visit.property_id,
        "property_reference": property_obj.reference if property_obj else "",
        "property_address": property_obj.address if property_obj else "",
        "interested_name": visit.interested_name,
        "interested_phone": visit.interested_phone,
        "interested_email": visit.interested_email,
        "visit_at": visit.visit_at.isoformat(),
        "status": visit.status,
        "contact_message": visit.contact_message,
        "notification_phone": visit.notification_phone,
        "reminder_minutes_before": visit.reminder_minutes_before,
        "notes": visit.notes,
        "created_at": visit.created_at.isoformat(),
    }


def person_debt_summary(session: Session, person: Person) -> Dict[str, object]:
    charges = session.exec(
        select(Charge).where(Charge.responsible_person_id == person.id)
    ).all()
    refresh_all_charge_statuses(session, charges)
    total_debt = sum(remaining_for_charge(session, charge) for charge in charges)
    overdue = sum(
        remaining_for_charge(session, charge)
        for charge in charges
        if computed_charge_status(session, charge) == "vencido"
    )
    return {
        "id": person.id,
        "legacy_code": person.legacy_code,
        "full_name": person.full_name,
        "document": person.document,
        "phone": person.phone,
        "mobile": person.mobile,
        "email": person.email,
        "address": person.address,
        "person_type": person.person_type,
        "created_at": person.created_at.isoformat(),
        "total_debt": money(total_debt),
        "overdue_debt": money(overdue),
        "open_charges": len(
            [charge for charge in charges if computed_charge_status(session, charge) != "pagado"]
        ),
    }


def generate_monthly_charges(session: Session, period: str, due_day: int) -> List[Charge]:
    year, month = [int(part) for part in period.split("-")]
    due_date = date(year, month, due_day)
    created: List[Charge] = []
    contracts = session.exec(select(Contract).where(Contract.active == True)).all()  # noqa: E712
    for contract in contracts:
        existing = session.exec(
            select(Charge).where(
                Charge.contract_id == contract.id,
                Charge.period == period,
                Charge.concept == "ALQUILER",
            )
        ).first()
        if existing:
            continue
        charge = Charge(
            contract_id=contract.id or 0,
            responsible_person_id=contract.tenant_id,
            concept="ALQUILER",
            description=f"Alquiler {period}",
            amount=contract.rent_amount,
            due_date=due_date,
            period=period,
            accrual_period=period,
            settlement_period=period,
            origin="recurrente",
        )
        session.add(charge)
        created.append(charge)
    session.commit()
    for charge in created:
        session.refresh(charge)
        refresh_charge_status(session, charge)
    session.commit()
    return created


def ensure_rent_charge_for_period(
    session: Session,
    contract: Contract,
    period: str,
    due_day: int = 10,
) -> Charge:
    existing = session.exec(
        select(Charge).where(
            Charge.contract_id == contract.id,
            Charge.period == period,
            Charge.concept == "ALQUILER",
        )
    ).first()
    if existing:
        return existing
    year, month = [int(part) for part in period.split("-")]
    charge = Charge(
        contract_id=contract.id or 0,
        responsible_person_id=contract.tenant_id,
        concept="ALQUILER",
        description=f"Alquiler {period}",
        amount=contract.rent_amount,
        due_date=date(year, month, min(due_day, 28)),
        period=period,
        accrual_period=period,
        settlement_period=period,
        origin="recurrente",
    )
    session.add(charge)
    session.commit()
    session.refresh(charge)
    return charge


def create_advance_rent_payment(
    session: Session,
    contract: Contract,
    months: Sequence[str],
    payment_date: date,
    method: str,
    reference: str,
    notes: str,
    due_day: int = 10,
) -> Dict[str, object]:
    if not months:
        raise ValueError("Debe indicar al menos un mes")
    charges = [ensure_rent_charge_for_period(session, contract, month, due_day) for month in months]
    total = money(sum(remaining_for_charge(session, charge) for charge in charges))
    if total <= 0:
        raise ValueError("Los meses seleccionados no tienen saldo pendiente")
    payment = Payment(
        person_id=contract.tenant_id,
        amount=total,
        payment_date=payment_date,
        method=method,
        reference=reference,
        notes=notes or f"Pago adelantado de alquileres: {', '.join(months)}",
    )
    session.add(payment)
    session.commit()
    session.refresh(payment)
    apply_allocations(
        session,
        payment,
        [{"charge_id": charge.id or 0, "amount": remaining_for_charge(session, charge)} for charge in charges],
    )
    movement = create_cash_movement_for_payment(session, payment)
    audit_log(
        session,
        "payment",
        payment.id,
        "advance_rent_payment",
        f"Pago de alquileres {', '.join(months)} contra contrato {contract.id}",
    )
    return {
        "payment": payment,
        "charges": charges,
        "cash_movement": movement,
    }


def create_charge_from_invoice(session: Session, invoice: InvoiceDocument) -> Optional[Charge]:
    if invoice.charge_id or invoice.responsible_type != "tenant" or not invoice.property_id:
        return None
    contracts = session.exec(
        select(Contract).where(
            Contract.property_id == invoice.property_id,
            Contract.active == True,  # noqa: E712
        )
    ).all()
    valid_contracts = [
        contract
        for contract in contracts
        if contract.start_date <= invoice.due_date and (contract.end_date is None or contract.end_date >= invoice.due_date)
    ]
    contract = sorted(
        valid_contracts or contracts,
        key=lambda item: (item.start_date, item.id or 0),
        reverse=True,
    )[0] if contracts else None
    if not contract:
        return None
    charge = Charge(
        contract_id=contract.id or 0,
        responsible_person_id=contract.tenant_id,
        responsible_type="tenant",
        concept=invoice.provider.upper(),
        description=f"Factura {invoice.provider} cuenta {invoice.account_number}",
        amount=invoice.amount,
        due_date=invoice.due_date,
        period=invoice.period or invoice.due_date.strftime("%Y-%m"),
        accrual_period=invoice.period or invoice.due_date.strftime("%Y-%m"),
        settlement_period=invoice.period or invoice.due_date.strftime("%Y-%m"),
        origin="invoice",
    )
    session.add(charge)
    session.commit()
    session.refresh(charge)
    invoice.charge_id = charge.id
    invoice.status = "convertida"
    session.add(invoice)
    session.commit()
    audit_log(session, "invoice", invoice.id, "create_charge", f"Deuda creada desde factura {invoice.id}")
    return charge


def create_owner_charge_from_invoice(session: Session, invoice: InvoiceDocument) -> Optional[OwnerCharge]:
    if invoice.owner_charge_id or invoice.responsible_type != "owner" or not invoice.property_id:
        return None
    share = session.exec(
        select(PropertyOwnerShare).where(PropertyOwnerShare.property_id == invoice.property_id)
    ).first()
    if not share:
        return None
    owner_charge = OwnerCharge(
        owner_id=share.owner_id,
        property_id=invoice.property_id,
        concept=invoice.provider.upper(),
        description=f"Factura {invoice.provider} cuenta {invoice.account_number}",
        amount=invoice.amount,
        charge_date=invoice.due_date,
        period=invoice.period or invoice.due_date.strftime("%Y-%m"),
        paid_by_agency=False,
        generates_commission=False,
        split_by_ownership=True,
    )
    session.add(owner_charge)
    session.commit()
    session.refresh(owner_charge)
    invoice.owner_charge_id = owner_charge.id
    invoice.status = "convertida"
    session.add(invoice)
    session.commit()
    audit_log(session, "invoice", invoice.id, "create_owner_charge", f"Debito propietario creado desde factura {invoice.id}")
    return owner_charge


def cash_movement_to_dict(session: Session, movement: CashMovement) -> Dict[str, object]:
    person = session.get(Person, movement.person_id) if movement.person_id else None
    property_obj = session.get(Property, movement.property_id) if movement.property_id else None
    return {
        "id": movement.id,
        "movement_date": movement.movement_date.isoformat(),
        "movement_type": movement.movement_type,
        "amount": money(movement.amount),
        "concept": movement.concept,
        "person_id": movement.person_id,
        "person_name": person.full_name if person else "",
        "property_id": movement.property_id,
        "property_reference": property_obj.reference if property_obj else "",
        "origin": movement.origin,
        "origin_id": movement.origin_id,
        "status": movement.status,
        "notes": movement.notes,
        "created_at": movement.created_at.isoformat(),
    }


def create_cash_movement_for_payment(session: Session, payment: Payment) -> CashMovement:
    existing = session.exec(
        select(CashMovement).where(
            CashMovement.origin == "payment",
            CashMovement.origin_id == payment.id,
            CashMovement.status == "confirmado",
        )
    ).first()
    if existing:
        return existing
    allocations = session.exec(
        select(PaymentAllocation).where(
            PaymentAllocation.payment_id == payment.id,
            PaymentAllocation.status == "confirmado",
        )
    ).all()
    concept_parts: List[str] = []
    property_id: Optional[int] = None
    for allocation in allocations:
        charge = session.get(Charge, allocation.charge_id)
        if not charge:
            continue
        contract = session.get(Contract, charge.contract_id)
        if contract and property_id is None:
            property_id = contract.property_id
        label = charge.concept.replace("_", " ").title()
        if charge.concept == "ALQUILER" and (charge.accrual_period or charge.period):
            label = f"Alquiler {charge.accrual_period or charge.period}"
        elif charge.period:
            label = f"{label} {charge.period}"
        concept_parts.append(label)
    concept = "Pago de inquilino"
    if concept_parts:
        unique_parts = list(dict.fromkeys(concept_parts))
        concept = f"Pago: {', '.join(unique_parts[:3])}"
        if len(unique_parts) > 3:
            concept += f" +{len(unique_parts) - 3}"
    movement = CashMovement(
        movement_date=payment.payment_date,
        movement_type="entrada",
        amount=payment.amount,
        concept=concept,
        person_id=payment.person_id,
        property_id=property_id,
        origin="payment",
        origin_id=payment.id,
        notes=payment.reference,
    )
    session.add(movement)
    session.commit()
    session.refresh(movement)
    unallocated = unallocated_amount_for_payment(session, payment)
    if unallocated > 0:
        existing_credit = session.exec(
            select(TenantCredit).where(TenantCredit.payment_id == payment.id)
        ).first()
        if not existing_credit:
            session.add(
                TenantCredit(
                    person_id=payment.person_id,
                    payment_id=payment.id,
                    amount=unallocated,
                    remaining_amount=unallocated,
                    notes="Saldo a favor generado automaticamente por pago sin imputar completo.",
                )
            )
            session.commit()
    return movement


def tenant_credit_to_dict(session: Session, credit: TenantCredit) -> Dict[str, object]:
    person = session.get(Person, credit.person_id)
    return {
        "id": credit.id,
        "person_id": credit.person_id,
        "person_name": person.full_name if person else "",
        "payment_id": credit.payment_id,
        "amount": money(credit.amount),
        "remaining_amount": money(credit.remaining_amount),
        "status": credit.status,
        "notes": credit.notes,
        "created_at": credit.created_at.isoformat(),
    }


def owner_charge_to_dict(session: Session, owner_charge: OwnerCharge) -> Dict[str, object]:
    owner = session.get(Person, owner_charge.owner_id)
    property_obj = session.get(Property, owner_charge.property_id)
    commission = owner_charge.amount * (owner_charge.commission_percent / 100) if owner_charge.generates_commission else 0
    settings = get_settings()
    iva = commission * (settings.iva_percent / 100)
    return {
        "id": owner_charge.id,
        "owner_id": owner_charge.owner_id,
        "owner_name": owner.full_name if owner else "",
        "property_id": owner_charge.property_id,
        "property_reference": property_obj.reference if property_obj else "",
        "concept": owner_charge.concept,
        "description": owner_charge.description,
        "amount": money(owner_charge.amount),
        "charge_date": owner_charge.charge_date.isoformat(),
        "period": owner_charge.period,
        "paid_by_agency": owner_charge.paid_by_agency,
        "generates_commission": owner_charge.generates_commission,
        "commission_percent": owner_charge.commission_percent,
        "split_by_ownership": owner_charge.split_by_ownership,
        "commission": money(commission),
        "iva": money(iva),
        "status": owner_charge.status,
        "created_at": owner_charge.created_at.isoformat(),
    }


def create_cash_movement_for_owner_charge(session: Session, owner_charge: OwnerCharge) -> Optional[CashMovement]:
    if not owner_charge.paid_by_agency:
        return None
    existing = session.exec(
        select(CashMovement).where(
            CashMovement.origin == "owner_charge",
            CashMovement.origin_id == owner_charge.id,
            CashMovement.status == "confirmado",
        )
    ).first()
    if existing:
        return existing
    movement = CashMovement(
        movement_date=owner_charge.charge_date,
        movement_type="salida",
        amount=owner_charge.amount,
        concept=f"Gasto propietario: {owner_charge.concept}",
        person_id=owner_charge.owner_id,
        property_id=owner_charge.property_id,
        origin="owner_charge",
        origin_id=owner_charge.id,
        notes=owner_charge.description,
    )
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement


def reverse_cash_movement(session: Session, movement: CashMovement, reason: str) -> CashMovement:
    if movement.status != "confirmado":
        raise ValueError("El movimiento ya esta anulado")
    movement.status = "anulado"
    session.add(movement)
    reversal = CashMovement(
        movement_date=date.today(),
        movement_type="salida" if movement.movement_type == "entrada" else "entrada",
        amount=movement.amount,
        concept=f"Reversa: {movement.concept}",
        person_id=movement.person_id,
        property_id=movement.property_id,
        origin="anulacion",
        origin_id=movement.id,
        reversal_of_id=movement.id,
        status="confirmado",
        notes=reason,
    )
    session.add(reversal)
    session.commit()
    session.refresh(reversal)
    return reversal


def void_payment(session: Session, payment: Payment, reason: str) -> CashMovement:
    if payment.status != "confirmado":
        raise ValueError("El pago ya esta anulado")
    allocations = session.exec(
        select(PaymentAllocation).where(
            PaymentAllocation.payment_id == payment.id,
            PaymentAllocation.status == "confirmado",
        )
    ).all()
    affected_charge_ids = [allocation.charge_id for allocation in allocations]
    for allocation in allocations:
        allocation.status = "anulado"
        session.add(allocation)
    payment.status = "anulado"
    session.add(payment)
    session.commit()

    for charge_id in affected_charge_ids:
        charge = session.get(Charge, charge_id)
        if charge:
            refresh_charge_status(session, charge)
    session.commit()

    movement = session.exec(
        select(CashMovement).where(
            CashMovement.origin == "payment",
            CashMovement.origin_id == payment.id,
            CashMovement.status == "confirmado",
        )
    ).first()
    if not movement:
        raise ValueError("El pago no tiene movimiento de caja confirmado")
    return reverse_cash_movement(session, movement, reason)


def void_owner_charge(session: Session, owner_charge: OwnerCharge, reason: str) -> Optional[CashMovement]:
    if owner_charge.status == "anulado":
        raise ValueError("El debito ya esta anulado")
    owner_charge.status = "anulado"
    session.add(owner_charge)
    session.commit()
    movement = session.exec(
        select(CashMovement).where(
            CashMovement.origin == "owner_charge",
            CashMovement.origin_id == owner_charge.id,
            CashMovement.status == "confirmado",
        )
    ).first()
    if movement:
        return reverse_cash_movement(session, movement, reason)
    return None


def apply_allocations(
    session: Session, payment: Payment, allocations: Sequence[Dict[str, float]]
) -> None:
    already_allocated = sum(
        item.amount
        for item in session.exec(
            select(PaymentAllocation).where(
                PaymentAllocation.payment_id == payment.id,
                PaymentAllocation.status == "confirmado",
            )
        ).all()
    )
    if payment.status != "confirmado":
        raise ValueError("No se puede imputar un pago anulado")
    requested_total = sum(float(item["amount"]) for item in allocations)
    if already_allocated + requested_total > payment.amount + 0.01:
        raise ValueError("Las imputaciones superan el monto del pago")

    for item in allocations:
        charge = session.get(Charge, int(item["charge_id"]))
        if not charge:
            raise ValueError("Deuda no encontrada")
        remaining = remaining_for_charge(session, charge)
        amount = money(float(item["amount"]))
        if amount <= 0:
            raise ValueError("El monto imputado debe ser mayor a cero")
        if amount > remaining + 0.01:
            raise ValueError("La imputacion supera el saldo de la deuda")
        session.add(
            PaymentAllocation(
                payment_id=payment.id or 0,
                charge_id=charge.id or 0,
                amount=amount,
                status="confirmado",
            )
        )
    session.commit()

    charge_ids = [int(item["charge_id"]) for item in allocations]
    charges = [session.get(Charge, charge_id) for charge_id in charge_ids]
    for charge in charges:
        if charge:
            refresh_charge_status(session, charge)
    session.commit()


def build_reminder_message(session: Session, charge_ids: Sequence[int]) -> Dict[str, object]:
    charges = [session.get(Charge, charge_id) for charge_id in charge_ids]
    charges = [charge for charge in charges if charge]
    if not charges:
        raise ValueError("No hay deudas para recordar")
    person = session.get(Person, charges[0].responsible_person_id)
    total = sum(remaining_for_charge(session, charge) for charge in charges)
    lines = [
        f"Hola {person.full_name.split()[0] if person else ''}, te compartimos el estado pendiente:",
    ]
    for charge in charges:
        lines.append(
            f"- {charge.concept}: ${remaining_for_charge(session, charge):,.2f} vence {charge.due_date.isoformat()}"
        )
    lines.append(f"Total pendiente: ${money(total):,.2f}.")
    lines.append("Gracias, Inmobiliaria Salgueiro.")
    message = "\n".join(lines)
    phone = (person.mobile if person else "").replace("+", "").replace(" ", "")
    return {
        "person": person,
        "message": message,
        "whatsapp_url": f"https://wa.me/{phone}?text={quote(message)}",
    }


def public_link_charge_ids(csv_value: str) -> List[int]:
    return [int(part) for part in csv_value.split(",") if part.strip()]


def generate_owner_settlements(session: Session, period: str) -> List[OwnerSettlement]:
    settings = get_settings()
    existing = session.exec(
        select(OwnerSettlement).where(OwnerSettlement.period == period)
    ).all()
    for settlement in existing:
        lines = session.exec(
            select(OwnerSettlementLine).where(OwnerSettlementLine.settlement_id == settlement.id)
        ).all()
        for line in lines:
            session.delete(line)
        session.delete(settlement)
    session.commit()

    period_prefix = f"{period}-"
    payments = session.exec(select(Payment)).all()
    owner_totals: Dict[int, Dict[str, float]] = {}
    pending_lines: Dict[int, List[Dict[str, object]]] = {}

    for payment in payments:
        if payment.status != "confirmado":
            continue
        if not payment.payment_date.isoformat().startswith(period_prefix):
            continue
        allocations = session.exec(
            select(PaymentAllocation).where(
                PaymentAllocation.payment_id == payment.id,
                PaymentAllocation.status == "confirmado",
            )
        ).all()
        for allocation in allocations:
            charge = session.get(Charge, allocation.charge_id)
            if not charge:
                continue
            contract = session.get(Contract, charge.contract_id)
            if not contract:
                continue
            property_obj = session.get(Property, contract.property_id)
            shares = session.exec(
                select(PropertyOwnerShare).where(
                    PropertyOwnerShare.property_id == contract.property_id
                )
            ).all()
            for share in shares:
                owner_amount = allocation.amount * (share.percentage / 100)
                totals = owner_totals.setdefault(
                    share.owner_id,
                    {"income": 0, "expenses": 0, "commission": 0, "iva": 0, "irpf": 0},
                )
                totals["income"] += owner_amount
                commission = owner_amount * (contract.commission_percent / 100)
                iva = commission * (settings.iva_percent / 100)
                should_apply_irpf = (
                    contract.irpf_applies
                    and share.irpf_applies
                    and contract.payment_origin == "normal"
                )
                irpf = owner_amount * (contract.irpf_percent / 100) if should_apply_irpf else 0
                totals["commission"] += commission
                totals["iva"] += iva
                totals["irpf"] += irpf
                pending_lines.setdefault(share.owner_id, []).append(
                    {
                        "property_id": contract.property_id,
                        "contract_id": contract.id,
                        "tenant_id": contract.tenant_id,
                        "source_type": "payment_allocation",
                        "source_id": allocation.id,
                        "concept": charge.concept,
                        "description": f"{property_obj.reference if property_obj else ''} · {charge.description}",
                        "period": period,
                        "accrual_period": charge.accrual_period or charge.period,
                        "payment_date": payment.payment_date,
                        "owner_percentage": share.percentage,
                        "gross_amount": allocation.amount,
                        "owner_amount": owner_amount,
                        "expense_amount": 0,
                        "commission": commission,
                        "iva": iva,
                        "irpf": irpf,
                        "net_amount": owner_amount - commission - iva - irpf,
                    }
                )

    owner_charges = session.exec(
        select(OwnerCharge).where(
            OwnerCharge.period == period,
            OwnerCharge.status != "anulado",
        )
    ).all()
    for owner_charge in owner_charges:
        if owner_charge.split_by_ownership:
            shares = session.exec(
                select(PropertyOwnerShare).where(
                    PropertyOwnerShare.property_id == owner_charge.property_id
                )
            ).all()
        else:
            shares = [
                PropertyOwnerShare(
                    property_id=owner_charge.property_id,
                    owner_id=owner_charge.owner_id,
                    percentage=100,
                )
            ]
        for share in shares:
            expense_amount = owner_charge.amount * (share.percentage / 100)
            totals = owner_totals.setdefault(
                share.owner_id,
                {"income": 0, "expenses": 0, "commission": 0, "iva": 0, "irpf": 0},
            )
            totals["expenses"] += expense_amount
            commission = expense_amount * (owner_charge.commission_percent / 100) if owner_charge.generates_commission else 0
            iva = commission * (settings.iva_percent / 100)
            totals["commission"] += commission
            totals["iva"] += iva
            pending_lines.setdefault(share.owner_id, []).append(
                {
                    "property_id": owner_charge.property_id,
                    "contract_id": None,
                    "tenant_id": None,
                    "source_type": "owner_charge",
                    "source_id": owner_charge.id,
                    "concept": owner_charge.concept,
                    "description": owner_charge.description,
                    "period": period,
                    "accrual_period": owner_charge.period,
                    "payment_date": owner_charge.charge_date,
                    "owner_percentage": share.percentage,
                    "gross_amount": owner_charge.amount,
                    "owner_amount": 0,
                    "expense_amount": expense_amount,
                    "commission": commission,
                    "iva": iva,
                    "irpf": 0,
                    "net_amount": -expense_amount - commission - iva,
                }
            )

    settlements: List[OwnerSettlement] = []
    for owner_id, totals in owner_totals.items():
        income = money(totals["income"])
        expenses = money(totals["expenses"])
        commission = money(totals["commission"])
        iva = money(totals["iva"])
        irpf = money(totals["irpf"])
        settlement = OwnerSettlement(
            owner_id=owner_id,
            period=period,
            income=income,
            expenses=expenses,
            commission=commission,
            iva=iva,
            irpf=irpf,
            total_to_transfer=money(income - expenses - commission - iva - irpf),
            status="borrador",
        )
        session.add(settlement)
        settlements.append(settlement)
    session.commit()
    for settlement in settlements:
        session.refresh(settlement)
        for line_data in pending_lines.get(settlement.owner_id, []):
            session.add(
                OwnerSettlementLine(
                    settlement_id=settlement.id or 0,
                    owner_id=settlement.owner_id,
                    **line_data,
                )
            )
    session.commit()
    return settlements


def settlement_to_dict(session: Session, settlement: OwnerSettlement) -> Dict[str, object]:
    owner = session.get(Person, settlement.owner_id)
    lines = session.exec(
        select(OwnerSettlementLine).where(OwnerSettlementLine.settlement_id == settlement.id)
    ).all()
    return {
        "id": settlement.id,
        "owner_id": settlement.owner_id,
        "owner_name": owner.full_name if owner else "",
        "period": settlement.period,
        "income": money(settlement.income),
        "expenses": money(settlement.expenses),
        "commission": money(settlement.commission),
        "iva": money(settlement.iva),
        "irpf": money(settlement.irpf),
        "total_to_transfer": money(settlement.total_to_transfer),
        "status": settlement.status,
        "created_at": settlement.created_at.isoformat(),
        "lines": [settlement_line_to_dict(session, line) for line in lines],
    }


def settlement_line_to_dict(session: Session, line: OwnerSettlementLine) -> Dict[str, object]:
    property_obj = session.get(Property, line.property_id) if line.property_id else None
    tenant = session.get(Person, line.tenant_id) if line.tenant_id else None
    return {
        "id": line.id,
        "settlement_id": line.settlement_id,
        "owner_id": line.owner_id,
        "property_id": line.property_id,
        "property_reference": property_obj.reference if property_obj else "",
        "property_address": property_obj.address if property_obj else "",
        "contract_id": line.contract_id,
        "tenant_id": line.tenant_id,
        "tenant_name": tenant.full_name if tenant else "",
        "source_type": line.source_type,
        "source_id": line.source_id,
        "concept": line.concept,
        "description": line.description,
        "period": line.period,
        "accrual_period": line.accrual_period,
        "payment_date": line.payment_date.isoformat() if line.payment_date else None,
        "owner_percentage": line.owner_percentage,
        "gross_amount": money(line.gross_amount),
        "owner_amount": money(line.owner_amount),
        "expense_amount": money(line.expense_amount),
        "commission": money(line.commission),
        "iva": money(line.iva),
        "irpf": money(line.irpf),
        "net_amount": money(line.net_amount),
    }

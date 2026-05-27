from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Person(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    legacy_code: str = Field(default="", index=True)
    full_name: str
    document: str = ""
    phone: str = ""
    mobile: str = ""
    email: str = ""
    address: str = ""
    person_type: str = "tenant"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Property(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    legacy_code: str = Field(default="", index=True)
    reference: str = Field(index=True)
    address: str
    padron: str = ""
    occupancy_status: str = Field(default="alquilada", index=True)
    property_type: str = ""
    destination: str = ""
    ute_account: str = ""
    ose_account: str = ""
    taxes_account: str = ""
    sanitation_account: str = ""
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PropertyOwnerShare(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    property_id: int = Field(foreign_key="property.id", index=True)
    owner_id: int = Field(foreign_key="person.id", index=True)
    percentage: float = 100.0
    is_primary: bool = False
    irpf_applies: bool = True


class PropertyServiceAccount(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    property_id: int = Field(foreign_key="property.id", index=True)
    service_type: str = Field(index=True)
    provider: str = ""
    account_number: str = Field(default="", index=True)
    payer: str = Field(default="tenant", index=True)  # tenant / owner / agency
    active: bool = Field(default=True, index=True)
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PropertyVisit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    property_id: int = Field(foreign_key="property.id", index=True)
    interested_name: str
    interested_phone: str = ""
    interested_email: str = ""
    visit_at: datetime = Field(index=True)
    status: str = Field(default="coordinada", index=True)
    contact_message: str = ""
    notification_phone: str = ""
    reminder_minutes_before: int = 60
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InvoiceDocument(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(index=True)
    account_number: str = Field(default="", index=True)
    property_id: Optional[int] = Field(default=None, foreign_key="property.id", index=True)
    service_account_id: Optional[int] = Field(default=None, foreign_key="propertyserviceaccount.id", index=True)
    responsible_type: str = Field(default="tenant", index=True)
    amount: float = 0
    due_date: date = Field(default_factory=date.today, index=True)
    period: str = Field(default="", index=True)
    status: str = Field(default="pendiente", index=True)
    source: str = Field(default="manual", index=True)  # email / manual / portal
    attachment_id: Optional[int] = Field(default=None, foreign_key="attachment.id", index=True)
    charge_id: Optional[int] = Field(default=None, foreign_key="charge.id", index=True)
    owner_charge_id: Optional[int] = Field(default=None, foreign_key="ownercharge.id", index=True)
    raw_text_preview: str = ""
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EmailInboxConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email_address: str = Field(index=True)
    provider: str = Field(default="imap", index=True)
    host: str = ""
    port: int = 993
    username: str = ""
    secret_env_var: str = ""
    folder: str = "INBOX"
    active: bool = Field(default=True, index=True)
    last_checked_at: Optional[datetime] = None
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EmailProviderRule(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    inbox_id: int = Field(foreign_key="emailinboxconfig.id", index=True)
    provider: str = Field(index=True)
    sender_pattern: str = Field(default="", index=True)
    subject_keywords: str = ""
    active: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EmailImportRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    inbox_id: int = Field(foreign_key="emailinboxconfig.id", index=True)
    status: str = Field(default="pendiente", index=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    messages_seen: int = 0
    invoices_created: int = 0
    notes: str = ""


class Contract(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    legacy_code: str = Field(default="", index=True)
    property_id: int = Field(foreign_key="property.id", index=True)
    tenant_id: int = Field(foreign_key="person.id", index=True)
    start_date: date
    end_date: Optional[date] = None
    rent_amount: float
    payment_type: str = "adelantado"
    rent_payment_timing: str = "adelantado"
    guarantee_type: str = "sin_garantia"
    guarantee_provider: str = ""
    guarantee_percent: float = 0.0
    rent_regime: str = "libre_contratacion"
    reajustment_index: str = "libre"
    next_reajustment_date: Optional[date] = None
    commission_percent: float = 8.0
    irpf_applies: bool = True
    irpf_percent: float = 10.5
    payment_origin: str = "normal"
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Charge(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    contract_id: int = Field(foreign_key="contract.id", index=True)
    responsible_person_id: int = Field(foreign_key="person.id", index=True)
    responsible_type: str = Field(default="tenant", index=True)
    concept: str = Field(index=True)
    description: str = ""
    amount: float
    due_date: date = Field(index=True)
    period: str = Field(default="", index=True)
    accrual_period: str = Field(default="", index=True)
    settlement_period: str = Field(default="", index=True)
    status: str = Field(default="pendiente", index=True)
    origin: str = "manual"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Payment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    payment_date: date = Field(default_factory=date.today, index=True)
    amount: float
    method: str = "transferencia"
    reference: str = ""
    notes: str = ""
    status: str = Field(default="confirmado", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TenantCredit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    payment_id: Optional[int] = Field(default=None, foreign_key="payment.id", index=True)
    amount: float
    remaining_amount: float
    status: str = Field(default="disponible", index=True)
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PaymentAllocation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    payment_id: int = Field(foreign_key="payment.id", index=True)
    charge_id: int = Field(foreign_key="charge.id", index=True)
    amount: float
    status: str = Field(default="confirmado", index=True)


class CashMovement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    movement_date: date = Field(default_factory=date.today, index=True)
    movement_type: str = Field(index=True)  # entrada / salida
    amount: float
    concept: str
    person_id: Optional[int] = Field(default=None, foreign_key="person.id", index=True)
    property_id: Optional[int] = Field(default=None, foreign_key="property.id", index=True)
    origin: str = Field(default="manual", index=True)
    origin_id: Optional[int] = Field(default=None, index=True)
    reversal_of_id: Optional[int] = Field(default=None, foreign_key="cashmovement.id", index=True)
    status: str = Field(default="confirmado", index=True)
    notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OwnerCharge(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="person.id", index=True)
    property_id: int = Field(foreign_key="property.id", index=True)
    concept: str = Field(index=True)
    description: str = ""
    amount: float
    charge_date: date = Field(default_factory=date.today, index=True)
    period: str = Field(default="", index=True)
    paid_by_agency: bool = True
    generates_commission: bool = False
    commission_percent: float = 0
    split_by_ownership: bool = False
    reversal_of_id: Optional[int] = Field(default=None, foreign_key="ownercharge.id", index=True)
    status: str = Field(default="pendiente", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    charge_id: Optional[int] = Field(default=None, foreign_key="charge.id", index=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    channel: str = "whatsapp"
    message: str
    status: str = "borrador"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    sent_at: Optional[datetime] = None


class PublicPaymentLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    charge_ids_csv: str
    status: str = "activo"
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OwnerSettlement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="person.id", index=True)
    period: str = Field(index=True)
    income: float = 0
    expenses: float = 0
    commission: float = 0
    iva: float = 0
    irpf: float = 0
    total_to_transfer: float = 0
    status: str = "borrador"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OwnerSettlementLine(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    settlement_id: int = Field(foreign_key="ownersettlement.id", index=True)
    owner_id: int = Field(foreign_key="person.id", index=True)
    property_id: Optional[int] = Field(default=None, foreign_key="property.id", index=True)
    contract_id: Optional[int] = Field(default=None, foreign_key="contract.id", index=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="person.id", index=True)
    source_type: str = Field(index=True)
    source_id: Optional[int] = Field(default=None, index=True)
    concept: str
    description: str = ""
    period: str = Field(index=True)
    accrual_period: str = ""
    payment_date: Optional[date] = None
    owner_percentage: float = 100.0
    gross_amount: float = 0
    owner_amount: float = 0
    expense_amount: float = 0
    commission: float = 0
    iva: float = 0
    irpf: float = 0
    net_amount: float = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Attachment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_type: str = Field(index=True)
    entity_id: int = Field(index=True)
    filename: str
    content_type: str = ""
    storage_path: str
    notes: str = ""
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_type: str = Field(index=True)
    entity_id: Optional[int] = Field(default=None, index=True)
    action: str = Field(index=True)
    description: str = ""
    created_by: str = "system"
    created_at: datetime = Field(default_factory=datetime.utcnow)

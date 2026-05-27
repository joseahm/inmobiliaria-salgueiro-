from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class PersonCreate(BaseModel):
    legacy_code: str = ""
    full_name: str
    document: str = ""
    phone: str = ""
    mobile: str = ""
    email: str = ""
    address: str = ""
    person_type: str = "tenant"


class PropertyCreate(BaseModel):
    legacy_code: str = ""
    reference: str
    address: str
    padron: str = ""
    occupancy_status: str = "alquilada"
    property_type: str = ""
    destination: str = ""
    ute_account: str = ""
    ose_account: str = ""
    taxes_account: str = ""
    sanitation_account: str = ""
    notes: str = ""
    owner_id: Optional[int] = None
    owner_percentage: float = 100.0
    owner_shares: List["PropertyOwnerShareCreate"] = []


class PropertyOwnerShareCreate(BaseModel):
    owner_id: int
    percentage: float
    is_primary: bool = False
    irpf_applies: bool = True


class PropertyAccountUpdate(BaseModel):
    provider: str
    account: str


class PropertyServiceAccountCreate(BaseModel):
    service_type: str
    provider: str = ""
    account_number: str = ""
    payer: str = "tenant"
    active: bool = True
    notes: str = ""


class PropertyVisitCreate(BaseModel):
    property_id: int
    interested_name: str
    interested_phone: str = ""
    interested_email: str = ""
    visit_at: str
    status: str = "coordinada"
    contact_message: str = ""
    notification_phone: str = ""
    reminder_minutes_before: int = 60
    notes: str = ""


class InvoiceDocumentCreate(BaseModel):
    provider: str
    account_number: str = ""
    property_id: Optional[int] = None
    service_account_id: Optional[int] = None
    responsible_type: str = "tenant"
    amount: float
    due_date: date
    period: str = ""
    status: str = "pendiente"
    source: str = "manual"
    notes: str = ""


class InvoiceDocumentUpdate(BaseModel):
    provider: str
    account_number: str = ""
    property_id: Optional[int] = None
    service_account_id: Optional[int] = None
    responsible_type: str = "tenant"
    amount: float
    due_date: date
    period: str = ""
    status: str = "pendiente"
    source: str = "manual"
    notes: str = ""


class EmailInboxConfigCreate(BaseModel):
    name: str
    email_address: str
    provider: str = "imap"
    host: str = ""
    port: int = 993
    username: str = ""
    secret_env_var: str = ""
    folder: str = "INBOX"
    active: bool = True
    notes: str = ""


class EmailInboxConfigUpdate(BaseModel):
    name: str
    email_address: str
    provider: str = "imap"
    host: str = ""
    port: int = 993
    username: str = ""
    secret_env_var: str = ""
    folder: str = "INBOX"
    active: bool = True
    notes: str = ""


class EmailProviderRuleCreate(BaseModel):
    provider: str
    sender_pattern: str = ""
    subject_keywords: str = ""
    active: bool = True


class ContractCreate(BaseModel):
    legacy_code: str = ""
    property_id: int
    tenant_id: int
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


class ChargeCreate(BaseModel):
    contract_id: int
    responsible_person_id: Optional[int] = None
    responsible_type: str = "tenant"
    concept: str
    description: str = ""
    amount: float
    due_date: date
    period: str = ""
    accrual_period: str = ""
    settlement_period: str = ""
    origin: str = "manual"


class ChargeUpdate(BaseModel):
    contract_id: int
    responsible_person_id: Optional[int] = None
    responsible_type: str = "tenant"
    concept: str
    description: str = ""
    amount: float
    due_date: date
    period: str = ""
    accrual_period: str = ""
    settlement_period: str = ""
    origin: str = "manual"


class BulkMonthlyRequest(BaseModel):
    period: str
    due_day: int = 10


class AllocationCreate(BaseModel):
    charge_id: int
    amount: float


class PaymentCreate(BaseModel):
    person_id: int
    amount: float
    payment_date: date
    method: str = "transferencia"
    reference: str = ""
    notes: str = ""
    allocations: List[AllocationCreate] = []


class AdvanceRentPaymentCreate(BaseModel):
    contract_id: int
    months: List[str]
    payment_date: date
    method: str = "transferencia"
    reference: str = ""
    notes: str = ""
    due_day: int = 10


class OwnerChargeCreate(BaseModel):
    owner_id: int
    property_id: int
    concept: str
    description: str = ""
    amount: float
    charge_date: date
    period: str = ""
    paid_by_agency: bool = True
    generates_commission: bool = False
    commission_percent: float = 0
    split_by_ownership: bool = False


class CashMovementCreate(BaseModel):
    movement_date: date
    movement_type: str
    amount: float
    concept: str
    person_id: Optional[int] = None
    property_id: Optional[int] = None
    notes: str = ""


class AllocationRequest(BaseModel):
    allocations: List[AllocationCreate]


class VoidRequest(BaseModel):
    reason: str = "Anulacion operativa"


class ReminderPreviewRequest(BaseModel):
    person_id: Optional[int] = None
    charge_ids: List[int]
    channel: str = "whatsapp"


class PublicLinkCreate(BaseModel):
    person_id: int
    charge_ids: List[int]
    days_valid: int = 14


class PaymentIntentCreate(BaseModel):
    payer_name: str = ""
    message: str = ""


class SettlementGenerateRequest(BaseModel):
    period: str

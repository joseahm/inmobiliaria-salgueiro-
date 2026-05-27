export type ChargeStatus = "pendiente" | "parcial" | "pagado" | "vencido";

export interface DashboardSummary {
  pending_total: number;
  overdue_total: number;
  collected_month: number;
  open_charges: number;
  due_soon: Charge[];
  recent_payments: RecentPayment[];
  cash_in_month: number;
  cash_out_month: number;
  cash_balance_month: number;
}

export interface RecentPayment {
  id: number;
  person_name: string;
  payment_date: string;
  amount: number;
  method: string;
  reference: string;
}

export interface Person {
  id: number;
  legacy_code: string;
  full_name: string;
  document: string;
  phone?: string;
  mobile: string;
  email: string;
  address?: string;
  person_type: "tenant" | "owner" | "both";
  created_at: string;
  total_debt: number;
  overdue_debt: number;
  open_charges: number;
}

export interface PropertyOwner {
  id: number;
  full_name: string;
  percentage: number;
  is_primary?: boolean;
  irpf_applies?: boolean;
}

export interface PropertyItem {
  id: number;
  legacy_code: string;
  reference: string;
  address: string;
  padron: string;
  occupancy_status: string;
  property_type: string;
  destination: string;
  ute_account: string;
  ose_account: string;
  taxes_account: string;
  sanitation_account: string;
  notes: string;
  created_at: string;
  owners: PropertyOwner[];
  services?: PropertyServiceAccount[];
}

export interface PropertyServiceAccount {
  id: number;
  property_id: number;
  service_type: string;
  provider: string;
  account_number: string;
  payer: "tenant" | "owner" | "agency";
  active: boolean;
  notes: string;
  created_at: string;
}

export interface ContractItem {
  id: number;
  legacy_code: string;
  property_id: number;
  tenant_id: number;
  tenant_name: string;
  property_reference: string;
  property_address: string;
  owners: PropertyOwner[];
  start_date: string;
  end_date: string | null;
  rent_amount: number;
  payment_type: string;
  rent_payment_timing: string;
  guarantee_type: string;
  guarantee_provider: string;
  guarantee_percent: number;
  rent_regime: string;
  reajustment_index: string;
  next_reajustment_date: string;
  commission_percent: number;
  irpf_applies: boolean;
  irpf_percent: number;
  payment_origin: string;
  active: boolean;
}

export interface PropertyVisit {
  id: number;
  property_id: number;
  property_reference: string;
  property_address: string;
  interested_name: string;
  interested_phone: string;
  interested_email: string;
  visit_at: string;
  status: string;
  contact_message: string;
  notification_phone: string;
  reminder_minutes_before: number;
  notes: string;
  created_at: string;
}

export interface Charge {
  id: number;
  contract_id: number;
  responsible_person_id: number;
  responsible_type: string;
  tenant_name: string;
  tenant_mobile: string;
  property_reference: string;
  property_address: string;
  concept: string;
  description: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  due_date: string;
  period: string;
  accrual_period: string;
  settlement_period: string;
  status: ChargeStatus;
  origin: string;
}

export interface CashMovement {
  id: number;
  movement_date: string;
  movement_type: "entrada" | "salida";
  amount: number;
  concept: string;
  person_id: number | null;
  person_name: string;
  property_id: number | null;
  property_reference: string;
  origin: string;
  origin_id: number | null;
  reversal_of_id?: number | null;
  status: string;
  notes: string;
  created_at: string;
}

export interface TenantCredit {
  id: number;
  person_id: number;
  person_name: string;
  payment_id: number | null;
  amount: number;
  remaining_amount: number;
  status: string;
  notes: string;
  created_at: string;
}

export interface Attachment {
  id: number;
  entity_type: string;
  entity_id: number;
  filename: string;
  content_type: string;
  notes: string;
  uploaded_at: string;
}

export interface InvoiceDocument {
  id: number;
  provider: string;
  account_number: string;
  property_id: number | null;
  property_reference: string;
  property_address: string;
  service_account_id: number | null;
  service_type: string;
  responsible_type: "tenant" | "owner" | "agency";
  amount: number;
  due_date: string;
  period: string;
  status: string;
  source: string;
  attachment_id: number | null;
  charge_id: number | null;
  owner_charge_id: number | null;
  raw_text_preview: string;
  notes: string;
  created_at: string;
}

export interface EmailProviderRule {
  id: number;
  inbox_id: number;
  provider: string;
  sender_pattern: string;
  subject_keywords: string;
  active: boolean;
  created_at: string;
}

export interface EmailInboxConfig {
  id: number;
  name: string;
  email_address: string;
  provider: string;
  host: string;
  port: number;
  username: string;
  secret_env_var: string;
  folder: string;
  active: boolean;
  last_checked_at: string | null;
  notes: string;
  created_at: string;
  rules: EmailProviderRule[];
}

export interface EmailImportRun {
  id: number;
  inbox_id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  messages_seen: number;
  invoices_created: number;
  notes: string;
}

export interface EmailSetupStatus {
  email_address: string;
  host: string;
  folder: string;
  secret_env_var: string;
  has_inbox: boolean;
  has_secret: boolean;
  has_rules: boolean;
  rules_count: number;
  ready: boolean;
}

export interface AuditLog {
  id: number;
  entity_type: string;
  entity_id: number | null;
  action: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface OwnerCharge {
  id: number;
  owner_id: number;
  owner_name: string;
  property_id: number;
  property_reference: string;
  concept: string;
  description: string;
  amount: number;
  charge_date: string;
  period: string;
  paid_by_agency: boolean;
  generates_commission: boolean;
  commission_percent: number;
  split_by_ownership: boolean;
  commission: number;
  iva: number;
  status: string;
  cash_movement?: CashMovement | null;
}

export interface Settlement {
  id: number;
  owner_id: number;
  owner_name: string;
  period: string;
  income: number;
  expenses: number;
  commission: number;
  iva: number;
  irpf: number;
  total_to_transfer: number;
  status: string;
  lines: SettlementLine[];
}

export interface SettlementLine {
  id: number;
  settlement_id: number;
  owner_id: number;
  property_id: number | null;
  property_reference: string;
  property_address: string;
  contract_id: number | null;
  tenant_id: number | null;
  tenant_name: string;
  source_type: string;
  source_id: number | null;
  concept: string;
  description: string;
  period: string;
  accrual_period: string;
  payment_date: string | null;
  owner_percentage: number;
  gross_amount: number;
  owner_amount: number;
  expense_amount: number;
  commission: number;
  iva: number;
  irpf: number;
  net_amount: number;
}

export interface PublicPortalData {
  status: string;
  person: {
    id: number;
    full_name: string;
    mobile: string;
    email: string;
  };
  charges: Charge[];
  total: number;
  expires_at: string;
}

export interface InvoiceScanResult {
  provider: string;
  concept: string;
  amount: number | null;
  due_date: string | null;
  account: string;
  description: string;
  confidence: number;
  filename: string;
  content_type: string;
  raw_text_preview: string;
  warnings: string[];
  matched_property_id: number | null;
  matched_property_reference: string;
  matched_property_address: string;
  matched_contract_id: number | null;
  matched_tenant_id: number | null;
  matched_tenant_name: string;
  matched_account: string;
  ocr_available: boolean;
  analysis_source: string;
}

export interface PersonDetail {
  person: Person;
  charges: Charge[];
  payments: Array<{
    id: number;
    payment_date: string;
    amount: number;
    method: string;
    reference: string;
    notes: string;
    status?: string;
  }>;
  contracts: ContractItem[];
  reminders: Array<{
    id: number;
    channel: string;
    status: string;
    message: string;
    created_at: string;
    sent_at: string | null;
  }>;
}

export interface PropertyDetail {
  property: PropertyItem;
  services: PropertyServiceAccount[];
  contracts: ContractItem[];
  charges: Charge[];
  owner_charges: OwnerCharge[];
  cash_movements: CashMovement[];
  attachments: Attachment[];
}

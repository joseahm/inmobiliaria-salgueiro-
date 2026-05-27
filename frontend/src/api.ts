import type {
  Charge,
  Attachment,
  AuditLog,
  CashMovement,
  ContractItem,
  DashboardSummary,
  EmailImportRun,
  EmailInboxConfig,
  EmailProviderRule,
  EmailSetupStatus,
  InvoiceScanResult,
  InvoiceDocument,
  OwnerCharge,
  Person,
  PersonDetail,
  PropertyDetail,
  PropertyItem,
  PropertyVisit,
  PublicPortalData,
  Settlement,
  TenantCredit
} from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? "Error de API");
  }
  return response.json() as Promise<T>;
}

export const api = {
  apiUrl: API_URL,
  login: (email: string, password: string) =>
    request<{ access_token: string; user: { name: string; email: string } }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password })
      }
    ),
  dashboard: () => request<DashboardSummary>("/dashboard/summary"),
  people: (type?: string) =>
    request<Person[]>(type ? `/persons?person_type=${type}` : "/persons"),
  personDetail: (personId: number) => request<PersonDetail>(`/persons/${personId}/detail`),
  createPerson: (payload: unknown) =>
    request<Person>("/persons", { method: "POST", body: JSON.stringify(payload) }),
  updatePerson: (personId: number, payload: unknown) =>
    request<Person>(`/persons/${personId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePerson: (personId: number) =>
    request<{ status: string }>(`/persons/${personId}`, { method: "DELETE" }),
  properties: () => request<PropertyItem[]>("/properties"),
  propertyDetail: (propertyId: number) => request<PropertyDetail>(`/properties/${propertyId}/detail`),
  createProperty: (payload: unknown) =>
    request<PropertyItem>("/properties", { method: "POST", body: JSON.stringify(payload) }),
  updateProperty: (propertyId: number, payload: unknown) =>
    request<PropertyItem>(`/properties/${propertyId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProperty: (propertyId: number) =>
    request<{ status: string }>(`/properties/${propertyId}`, { method: "DELETE" }),
  associatePropertyAccount: (propertyId: number, payload: unknown) =>
    request<{ property: PropertyItem; matched_contract: ContractItem | null }>(
      `/properties/${propertyId}/account`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  createPropertyService: (propertyId: number, payload: unknown) =>
    request(`/properties/${propertyId}/services`, { method: "POST", body: JSON.stringify(payload) }),
  updatePropertyService: (propertyId: number, serviceId: number, payload: unknown) =>
    request(`/properties/${propertyId}/services/${serviceId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePropertyService: (propertyId: number, serviceId: number) =>
    request<{ status: string }>(`/properties/${propertyId}/services/${serviceId}`, { method: "DELETE" }),
  propertyVisits: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<PropertyVisit[]>(`/property-visits${search ? `?${search}` : ""}`);
  },
  createPropertyVisit: (payload: unknown) =>
    request<PropertyVisit>("/property-visits", { method: "POST", body: JSON.stringify(payload) }),
  updatePropertyVisit: (visitId: number, payload: unknown) =>
    request<PropertyVisit>(`/property-visits/${visitId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePropertyVisit: (visitId: number) =>
    request<{ status: string }>(`/property-visits/${visitId}`, { method: "DELETE" }),
  contracts: () => request<ContractItem[]>("/contracts"),
  createContract: (payload: unknown) =>
    request<ContractItem>("/contracts", { method: "POST", body: JSON.stringify(payload) }),
  updateContract: (contractId: number, payload: unknown) =>
    request<ContractItem>(`/contracts/${contractId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteContract: (contractId: number) =>
    request<{ status: string }>(`/contracts/${contractId}`, { method: "DELETE" }),
  charges: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<Charge[]>(`/charges${search ? `?${search}` : ""}`);
  },
  createCharge: (payload: unknown) =>
    request<Charge>("/charges", { method: "POST", body: JSON.stringify(payload) }),
  updateCharge: (chargeId: number, payload: unknown) =>
    request<Charge>(`/charges/${chargeId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCharge: (chargeId: number) =>
    request<{ status: string }>(`/charges/${chargeId}`, { method: "DELETE" }),
  analyzeInvoice: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_URL}/invoice-scan/analyze`, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail ?? "No se pudo analizar la factura");
    }
    return response.json() as Promise<InvoiceScanResult>;
  },
  invoiceDocuments: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<InvoiceDocument[]>(`/invoice-documents${search ? `?${search}` : ""}`);
  },
  createInvoiceDocument: (payload: unknown) =>
    request<InvoiceDocument>("/invoice-documents", { method: "POST", body: JSON.stringify(payload) }),
  createChargeFromInvoice: (invoiceId: number) =>
    request(`/invoice-documents/${invoiceId}/create-charge`, { method: "POST" }),
  deleteInvoiceDocument: (invoiceId: number) =>
    request<{ status: string }>(`/invoice-documents/${invoiceId}`, { method: "DELETE" }),
  importInvoiceDocument: async (file: File, source = "manual") => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_URL}/invoice-documents/import?source=${encodeURIComponent(source)}`, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail ?? "No se pudo importar la factura");
    }
    return response.json() as Promise<{ invoice: InvoiceDocument; analysis: InvoiceScanResult }>;
  },
  emailInboxes: () => request<EmailInboxConfig[]>("/email-inboxes"),
  emailSetupStatus: () => request<EmailSetupStatus>("/email-inboxes/setup-status"),
  createEmailInbox: (payload: unknown) =>
    request<EmailInboxConfig>("/email-inboxes", { method: "POST", body: JSON.stringify(payload) }),
  updateEmailInbox: (inboxId: number, payload: unknown) =>
    request<EmailInboxConfig>(`/email-inboxes/${inboxId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteEmailInbox: (inboxId: number) =>
    request<{ status: string }>(`/email-inboxes/${inboxId}`, { method: "DELETE" }),
  createEmailRule: (inboxId: number, payload: unknown) =>
    request<EmailProviderRule>(`/email-inboxes/${inboxId}/rules`, { method: "POST", body: JSON.stringify(payload) }),
  deleteEmailRule: (inboxId: number, ruleId: number) =>
    request<{ status: string }>(`/email-inboxes/${inboxId}/rules/${ruleId}`, { method: "DELETE" }),
  scanEmailInbox: (inboxId: number) =>
    request<{ run: EmailImportRun; invoices: InvoiceDocument[] }>(`/email-inboxes/${inboxId}/scan`, { method: "POST" }),
  bulkMonthly: (period: string, dueDay = 10) =>
    request<{ created: number; charges: Charge[] }>("/charges/bulk-monthly", {
      method: "POST",
      body: JSON.stringify({ period, due_day: dueDay })
    }),
  createPayment: (payload: unknown) =>
    request<{ id: number }>("/payments", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  voidPayment: (paymentId: number, reason: string) =>
    request<{ status: string; cash_reversal: CashMovement }>(`/payments/${paymentId}/void`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  createAdvanceRentPayment: (payload: unknown) =>
    request("/payments/advance-rent", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  tenantCredits: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<TenantCredit[]>(`/tenant-credits${search ? `?${search}` : ""}`);
  },
  cashMovements: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<CashMovement[]>(`/cash-movements${search ? `?${search}` : ""}`);
  },
  createManualCashMovement: (payload: unknown) =>
    request<CashMovement>("/cash-movements/manual", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  ownerCharges: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<OwnerCharge[]>(`/owner-charges${search ? `?${search}` : ""}`);
  },
  createOwnerCharge: (payload: unknown) =>
    request<OwnerCharge>("/owner-charges", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  voidOwnerCharge: (ownerChargeId: number, reason: string) =>
    request<{ status: string; cash_reversal: CashMovement | null }>(`/owner-charges/${ownerChargeId}/void`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  previewReminder: (payload: unknown) =>
    request<{ message: string; whatsapp_url: string }>("/reminders/preview", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  simulateReminder: (payload: unknown) =>
    request<{ message: string; whatsapp_url: string; created: number }>(
      "/reminders/simulate-send",
      { method: "POST", body: JSON.stringify(payload) }
    ),
  createPublicLink: (payload: unknown) =>
    request<{ token: string; url: string; expires_at: string }>("/public-links", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  publicPortal: (token: string) => request<PublicPortalData>(`/public/${token}`),
  paymentIntent: (token: string, payload: unknown) =>
    request<{ status: string; message: string }>(`/public/${token}/payment-intent`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  settlements: (period?: string) =>
    request<Settlement[]>(
      period ? `/settlements/owners?period=${period}` : "/settlements/owners"
    ),
  generateSettlements: (period: string) =>
    request<Settlement[]>("/settlements/owners/generate", {
      method: "POST",
      body: JSON.stringify({ period })
    }),
  attachments: (entityType: string, entityId: number) =>
    request<Attachment[]>(`/attachments/${entityType}/${entityId}`),
  uploadAttachment: async (entityType: string, entityId: number, file: File, notes = "") => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("notes", notes);
    const response = await fetch(`${API_URL}/attachments/${entityType}/${entityId}`, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail ?? "No se pudo adjuntar archivo");
    }
    return response.json() as Promise<Attachment>;
  },
  auditLog: (params: Record<string, string> = {}) => {
    const search = new URLSearchParams(params).toString();
    return request<AuditLog[]>(`/audit-log${search ? `?${search}` : ""}`);
  }
};

export function exportUrl(path: string) {
  return `${API_URL}${path}`;
}

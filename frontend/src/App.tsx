import {
  AlertCircle,
  ArrowDownToLine,
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  Edit3,
  Eye,
  FileImage,
  HelpCircle,
  Home,
  Link as LinkIcon,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api, exportUrl } from "./api";
import type {
  Charge,
  AuditLog,
  ChargeStatus,
  CashMovement,
  ContractItem,
  DashboardSummary,
  EmailInboxConfig,
  EmailImportRun,
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

type View = "dashboard" | "charges" | "invoices" | "tenants" | "owners" | "properties" | "visits" | "contracts" | "payments" | "cash" | "settlements";
type AppModal =
  | "charge"
  | "payment"
  | "batchPayment"
  | "reminder"
  | "link"
  | "person"
  | "property"
  | "contract"
  | "ownerCharge"
  | "freePayment"
  | "tenantDetail"
  | "propertyDetail"
  | "advancePayment"
  | null;

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "charges", label: "Deudas", icon: ClipboardList },
  { id: "invoices", label: "Facturas", icon: FileImage },
  { id: "tenants", label: "Inquilinos", icon: UserRound },
  { id: "owners", label: "Propietarios", icon: Users },
  { id: "properties", label: "Propiedades", icon: Building2 },
  { id: "visits", label: "Visitas", icon: CalendarDays },
  { id: "contracts", label: "Contratos", icon: ReceiptText },
  { id: "payments", label: "Pagos", icon: Banknote },
  { id: "cash", label: "Caja", icon: WalletCards },
  { id: "settlements", label: "Liquidaciones", icon: WalletCards }
];

const statusMeta: Record<ChargeStatus, { label: string; className: string; dot: string }> = {
  pendiente: {
    label: "Pendiente",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500"
  },
  parcial: {
    label: "Parcial",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500"
  },
  pagado: {
    label: "Pagado",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500"
  },
  vencido: {
    label: "Vencido",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500"
  }
};

const concepts = ["ALQUILER", "UTE", "OSE", "GASTOS_COMUNES", "TRIBUTOS", "SANEAMIENTO", "OTROS"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "UYU",
    maximumFractionDigits: 0
  }).format(value ?? 0);
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value?: string) {
  if (!value) return "sin fecha";
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildWhatsappUrl(phone: string, message: string) {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned ? `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}` : "";
}

function isVisitAlertActive(visit: PropertyVisit, now: Date) {
  if (visit.status === "realizada" || visit.status === "cancelada") return false;
  const visitDate = new Date(visit.visit_at);
  const alertFrom = new Date(visitDate.getTime() - visit.reminder_minutes_before * 60 * 1000);
  const keepUntil = new Date(visitDate.getTime() + 24 * 60 * 60 * 1000);
  return now >= alertFrom && now <= keepUntil;
}

function legacyCodeValue(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value.toLowerCase();
}

function PublicPortal() {
  const token = window.location.pathname.split("/").pop() ?? "";
  const [data, setData] = useState<PublicPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api
      .publicPortal(token)
      .then(setData)
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function simulatePayment() {
    setMessage("");
    try {
      const response = await api.paymentIntent(token, {
        payer_name: data?.person.full_name,
        message: "Pago simulado desde portal publico"
      });
      setMessage(response.message);
      const refreshed = await api.publicPortal(token);
      setData(refreshed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo registrar");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded-lg bg-white p-6 shadow-panel">{message || "Link no disponible"}</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <section className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
          <div>
            <p className="text-sm font-medium text-muted">Estado de cuenta</p>
            <h1 className="text-2xl font-semibold text-ink">{data.person.full_name}</h1>
          </div>
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-right text-sm font-semibold text-emerald-700">
            {data.status}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-panel">
          <div className="border-b border-slate-100 p-5">
            <p className="text-sm text-muted">Total pendiente</p>
            <p className="text-3xl font-semibold text-ink">{formatCurrency(data.total)}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.charges.map((charge) => (
              <div key={charge.id} className="grid gap-2 p-5 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={charge.status} />
                    <p className="font-semibold text-ink">{charge.concept}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted">{charge.description}</p>
                  <p className="mt-1 text-sm text-muted">Vence {charge.due_date}</p>
                </div>
                <p className="text-lg font-semibold text-ink">{formatCurrency(charge.remaining_amount)}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">Pago real pendiente de integrar con pasarela.</p>
            <button className="btn-primary" onClick={simulatePayment}>
              <CreditCard className="h-4 w-4" />
              Simular intención de pago
            </button>
          </div>
        </div>
        {message && <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: ChargeStatus }) {
  const meta = statusMeta[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.className}`}>
      <span className={`status-dot ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function App() {
  if (window.location.pathname.startsWith("/public/")) {
    return <PublicPortal />;
  }

  const [token, setToken] = useState(() => localStorage.getItem("salgueiro_token") ?? "");
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [propertyVisits, setPropertyVisits] = useState<PropertyVisit[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [ownerCharges, setOwnerCharges] = useState<OwnerCharge[]>([]);
  const [tenantCredits, setTenantCredits] = useState<TenantCredit[]>([]);
  const [invoiceDocuments, setInvoiceDocuments] = useState<InvoiceDocument[]>([]);
  const [emailInboxes, setEmailInboxes] = useState<EmailInboxConfig[]>([]);
  const [emailSetup, setEmailSetup] = useState<EmailSetupStatus | null>(null);
  const [statusFilter, setStatusFilter] = useState("todas");
  const [search, setSearch] = useState("");
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [selectedCharges, setSelectedCharges] = useState<Charge[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<PropertyItem | null>(null);
  const [selectedContract, setSelectedContract] = useState<ContractItem | null>(null);
  const [modal, setModal] = useState<AppModal>(null);
  const [personModalDefaultType, setPersonModalDefaultType] = useState<Person["person_type"]>("tenant");
  const [publicLink, setPublicLink] = useState("");
  const [now, setNow] = useState(() => new Date());

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [summary, persons, props, visitsData, contractsData, chargesData, settlementsData, cashData, ownerChargeData, creditsData, invoiceData, inboxData, emailSetupData] =
        await Promise.all([
          api.dashboard(),
          api.people(),
          api.properties(),
          api.propertyVisits(),
          api.contracts(),
          api.charges(),
          api.settlements(),
          api.cashMovements(),
          api.ownerCharges(),
          api.tenantCredits(),
          api.invoiceDocuments(),
          api.emailInboxes(),
          api.emailSetupStatus()
        ]);
      setDashboard(summary);
      setPeople(persons);
      setProperties(props);
      setPropertyVisits(visitsData);
      setContracts(contractsData);
      setCharges(chargesData);
      setSettlements(settlementsData);
      setCashMovements(cashData);
      setOwnerCharges(ownerChargeData);
      setTenantCredits(creditsData);
      setInvoiceDocuments(invoiceData);
      setEmailInboxes(inboxData);
      setEmailSetup(emailSetupData);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      loadAll();
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredCharges = useMemo(() => {
    return charges.filter((charge) => {
      const matchesStatus = statusFilter === "todas" || charge.status === statusFilter;
      const needle = search.toLowerCase();
      const matchesSearch =
        !needle ||
        charge.tenant_name.toLowerCase().includes(needle) ||
        charge.property_address.toLowerCase().includes(needle) ||
        charge.concept.toLowerCase().includes(needle);
      return matchesStatus && matchesSearch;
    });
  }, [charges, search, statusFilter]);

  const openChargesForPerson = (personId: number) =>
    charges.filter((charge) => charge.responsible_person_id === personId && charge.status !== "pagado");

  function openChargeModal(charge: Charge | null = null) {
    setSelectedCharge(charge);
    setModal("charge");
  }

  function openPayment(charge: Charge) {
    setSelectedCharge(charge);
    setModal("payment");
  }

  function openReminder(chargesToSend: Charge[]) {
    const openItems = chargesToSend.filter((charge) => charge.status !== "pagado");
    if (!openItems.length) {
      setError("No hay deudas abiertas para generar recordatorio.");
      return;
    }
    setSelectedCharges(openItems);
    setModal("reminder");
  }

  function openPublicLink(chargesToLink: Charge[]) {
    const openItems = chargesToLink.filter((charge) => charge.status !== "pagado");
    if (!openItems.length) {
      setError("No hay deudas abiertas para crear link público.");
      return;
    }
    setPublicLink("");
    setSelectedCharges(openItems);
    setModal("link");
  }

  const visitAlerts = useMemo(() => {
    return propertyVisits.filter((visit) => isVisitAlertActive(visit, now));
  }, [propertyVisits, now]);

  async function removeEntity(label: string, action: () => Promise<unknown>) {
    if (!window.confirm(`Eliminar ${label}?`)) return;
    setError("");
    try {
      await action();
      await loadAll();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo eliminar");
    }
  }

  if (!token) {
    return <Login onLogin={(newToken) => {
      localStorage.setItem("salgueiro_token", newToken);
      setToken(newToken);
    }} />;
  }

  const activeLabel = navItems.find((item) => item.id === activeView)?.label ?? "";

  return (
    <div className="min-h-screen bg-slate-50 text-ink">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">POC</p>
                <h1 className="mt-1 text-lg font-semibold text-ink">Salgueiro Admin</h1>
              </div>
              <button className="icon-btn lg:hidden" onClick={() => setSidebarOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
                    active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                  }`}
                  onClick={() => {
                    setActiveView(item.id);
                    setSidebarOpen(false);
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="border-t border-slate-100 p-3">
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => {
                localStorage.removeItem("salgueiro_token");
                setToken("");
              }}
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </div>
        </div>
      </aside>

      <main className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button className="icon-btn lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Operacion diaria</p>
                <h2 className="text-xl font-semibold text-ink">{activeLabel}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {visitAlerts.length > 0 && (
                <button className="btn-secondary border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100" onClick={() => setActiveView("visits")}>
                  <Bell className="h-4 w-4" />
                  {visitAlerts.length === 1 ? "1 visita" : `${visitAlerts.length} visitas`}
                </button>
              )}
              <button className="btn-secondary" onClick={loadAll} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </button>
              <button
                className="btn-primary"
                onClick={() => openChargeModal()}
              >
                <Plus className="h-4 w-4" />
                Nueva deuda
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {visitAlerts.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  <span className="font-semibold">
                    {visitAlerts.length === 1 ? "Tenés 1 visita para confirmar" : `Tenés ${visitAlerts.length} visitas para confirmar`}
                  </span>
                  <span>{formatDateTime(visitAlerts[0].visit_at)} · {visitAlerts[0].property_reference}</span>
                </div>
                <div className="flex gap-2">
                  {visitAlerts[0].notification_phone && (
                    <a className="btn-secondary" href={buildWhatsappUrl(visitAlerts[0].notification_phone, `Recordatorio de visita: ${visitAlerts[0].interested_name} en ${visitAlerts[0].property_reference} el ${formatDateTime(visitAlerts[0].visit_at)}. Tel: ${visitAlerts[0].interested_phone || "sin dato"}`)} target="_blank" rel="noreferrer">
                      <MessageCircle className="h-4 w-4" />
                      Avisar por WhatsApp
                    </a>
                  )}
                  <button className="btn-secondary" onClick={() => setActiveView("visits")}>
                    Ver agenda
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeView === "dashboard" && (
            <DashboardView
              summary={dashboard}
              charges={charges}
              onPay={openPayment}
              onReminder={(charge) => openReminder([charge])}
            />
          )}

          {activeView === "charges" && (
            <ChargesView
              charges={filteredCharges}
              statusFilter={statusFilter}
              search={search}
              setStatusFilter={setStatusFilter}
              setSearch={setSearch}
              onBulkMonthly={async () => {
                const result = await api.bulkMonthly(currentPeriod(), 10);
                await loadAll();
                setError(result.created ? "" : "No se crearon alquileres nuevos para este periodo.");
              }}
              onPay={openPayment}
              onReminder={(charge) => openReminder([charge])}
              onLink={(charge) => openPublicLink([charge])}
              onEdit={(charge) => openChargeModal(charge)}
              onDelete={(charge) => removeEntity("esta deuda", () => api.deleteCharge(charge.id))}
            />
          )}
          {activeView === "invoices" && (
            <InvoicesView
              invoices={invoiceDocuments}
              inboxes={emailInboxes}
              setup={emailSetup}
              onRefresh={loadAll}
              onImport={async (file) => {
                await api.importInvoiceDocument(file, "manual");
                await loadAll();
              }}
              onCreateCharge={async (invoice) => {
                await api.createChargeFromInvoice(invoice.id);
                await loadAll();
              }}
              onDeleteInvoice={async (invoice) => removeEntity("esta factura", () => api.deleteInvoiceDocument(invoice.id))}
              onCreateInbox={async (payload) => {
                await api.createEmailInbox(payload);
                await loadAll();
              }}
              onCreateRule={async (inboxId, payload) => {
                await api.createEmailRule(inboxId, payload);
                await loadAll();
              }}
              onScanInbox={async (inboxId) => {
                const result = await api.scanEmailInbox(inboxId);
                await loadAll();
                setError(result.run.status === "ok" ? "" : result.run.notes);
                return result;
              }}
            />
          )}

          {activeView === "tenants" && (
            <TenantsView
              people={people.filter((p) => p.person_type !== "owner")}
              getOpenCharges={openChargesForPerson}
              onNew={() => {
                setSelectedPerson(null);
                setPersonModalDefaultType("tenant");
                setModal("person");
              }}
              onEdit={(person) => {
                setSelectedPerson(person);
                setPersonModalDefaultType(person.person_type);
                setModal("person");
              }}
              onDelete={(person) => removeEntity(person.full_name, () => api.deletePerson(person.id))}
              onDetail={(person) => {
                setSelectedPerson(person);
                setModal("tenantDetail");
              }}
              onReminder={(person) => openReminder(openChargesForPerson(person.id))}
              onLink={(person) => openPublicLink(openChargesForPerson(person.id))}
              onPayGroup={(person) => {
                const openItems = openChargesForPerson(person.id);
                if (!openItems.length) {
                  setError("El inquilino no tiene deudas abiertas.");
                  return;
                }
                setSelectedPerson(person);
                setSelectedCharges(openItems);
                setModal("batchPayment");
              }}
            />
          )}
          {activeView === "owners" && (
            <OwnersView
              people={people.filter((p) => p.person_type !== "tenant")}
              properties={properties}
              settlements={settlements}
              onNew={() => {
                setSelectedPerson(null);
                setPersonModalDefaultType("owner");
                setModal("person");
              }}
              onEdit={(person) => {
                setSelectedPerson(person);
                setPersonModalDefaultType(person.person_type);
                setModal("person");
              }}
              onDelete={(person) => removeEntity(person.full_name, () => api.deletePerson(person.id))}
            />
          )}
          {activeView === "properties" && (
            <PropertiesView
              properties={properties}
              onNew={() => {
                setSelectedProperty(null);
                setModal("property");
              }}
              onEdit={(property) => {
                setSelectedProperty(property);
                setModal("property");
              }}
              onDetail={(property) => {
                setSelectedProperty(property);
                setModal("propertyDetail");
              }}
              onDelete={(property) => removeEntity(property.reference, () => api.deleteProperty(property.id))}
            />
          )}
          {activeView === "visits" && (
            <VisitsView
              visits={propertyVisits}
              properties={properties}
              onRefresh={loadAll}
            />
          )}
          {activeView === "contracts" && (
            <ContractsView
              contracts={contracts}
              onNew={() => {
                setSelectedContract(null);
                setModal("contract");
              }}
              onEdit={(contract) => {
                setSelectedContract(contract);
                setModal("contract");
              }}
              onDelete={(contract) => removeEntity(`contrato de ${contract.tenant_name}`, () => api.deleteContract(contract.id))}
            />
          )}
          {activeView === "payments" && (
            <PaymentsView
              people={people.filter((p) => p.person_type !== "owner")}
              charges={charges.filter((charge) => charge.status !== "pagado")}
              credits={tenantCredits}
              onPay={openPayment}
              onBatchPay={(person, personCharges) => {
                setSelectedPerson(person);
                setSelectedCharges(personCharges);
                setModal("batchPayment");
              }}
              onAdvancePay={(person) => {
                setSelectedPerson(person);
                setModal("advancePayment");
              }}
              onNewPayment={(person) => {
                setSelectedPerson(person);
                setModal("freePayment");
              }}
            />
          )}
          {activeView === "cash" && (
            <CashView
              movements={cashMovements}
              ownerCharges={ownerCharges}
              owners={people.filter((person) => person.person_type !== "tenant")}
              properties={properties}
              onNewOwnerCharge={() => setModal("ownerCharge")}
              onVoidOwnerCharge={async (ownerCharge) => {
                const reason = window.prompt("Motivo de anulación", "Error de carga");
                if (!reason) return;
                await api.voidOwnerCharge(ownerCharge.id, reason);
                await loadAll();
              }}
            />
          )}
          {activeView === "settlements" && (
            <SettlementsView
              settlements={settlements}
              onGenerate={async (period) => {
                const result = await api.generateSettlements(period);
                setSettlements(result);
                await loadAll();
              }}
            />
          )}
        </div>
      </main>
      <FloatingHelpWidget />

      {modal === "charge" && (
        <ChargeModal
          contracts={contracts}
          properties={properties}
          charge={selectedCharge}
          onRefreshData={loadAll}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "payment" && selectedCharge && (
        <PaymentModal
          charge={selectedCharge}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "batchPayment" && selectedPerson && selectedCharges.length > 0 && (
        <BatchPaymentModal
          person={selectedPerson}
          charges={selectedCharges}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "reminder" && selectedCharges.length > 0 && (
        <ReminderModal charges={selectedCharges} onClose={() => setModal(null)} />
      )}
      {modal === "link" && selectedCharges.length > 0 && (
        <LinkModal
          charges={selectedCharges}
          publicLink={publicLink}
          setPublicLink={setPublicLink}
          onClose={() => {
            setPublicLink("");
            setModal(null);
          }}
        />
      )}
      {modal === "person" && (
        <PersonModal
          person={selectedPerson}
          defaultType={personModalDefaultType}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "property" && (
        <PropertyModal
          property={selectedProperty}
          owners={people.filter((person) => person.person_type !== "tenant")}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "contract" && (
        <ContractModal
          contract={selectedContract}
          properties={properties}
          tenants={people.filter((person) => person.person_type !== "owner")}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "ownerCharge" && (
        <OwnerChargeModal
          owners={people.filter((person) => person.person_type !== "tenant")}
          properties={properties}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "tenantDetail" && selectedPerson && (
        <TenantDetailModal person={selectedPerson} onClose={() => setModal(null)} />
      )}
      {modal === "propertyDetail" && selectedProperty && (
        <PropertyDetailModal property={selectedProperty} onClose={() => setModal(null)} />
      )}
      {modal === "advancePayment" && selectedPerson && (
        <AdvancePaymentModal
          person={selectedPerson}
          contracts={contracts.filter((contract) => contract.tenant_id === selectedPerson.id && contract.active)}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
      {modal === "freePayment" && selectedPerson && (
        <FreePaymentModal
          person={selectedPerson}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadAll();
          }}
        />
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("admin@salgueiro.test");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await api.login(email, password);
      onLogin(response.access_token);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo ingresar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Inmobiliaria Salgueiro</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Panel operativo</h1>
        <p className="mt-2 text-sm text-muted">Demo interna para cargar deudas, registrar pagos y acelerar recordatorios.</p>
        <label className="form-label mt-6">Email</label>
        <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
        <label className="form-label mt-4">Password</label>
        <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="mt-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
        <button className="btn-primary mt-5 w-full justify-center" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Entrar
        </button>
      </form>
    </main>
  );
}

function DashboardView({
  summary,
  charges,
  onPay,
  onReminder
}: {
  summary: DashboardSummary | null;
  charges: Charge[];
  onPay: (charge: Charge) => void;
  onReminder: (charge: Charge) => void;
}) {
  const urgent = charges.filter((charge) => charge.status === "vencido" || charge.status === "parcial").slice(0, 5);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-5">
        <Metric title="Pendiente" value={formatCurrency(summary?.pending_total ?? 0)} icon={ClipboardList} tone="blue" />
        <Metric title="Vencido" value={formatCurrency(summary?.overdue_total ?? 0)} icon={AlertCircle} tone="rose" />
        <Metric title="Cobrado mes" value={formatCurrency(summary?.collected_month ?? 0)} icon={Banknote} tone="green" />
        <Metric title="Caja neta" value={formatCurrency(summary?.cash_balance_month ?? 0)} icon={WalletCards} tone="green" />
        <Metric title="Deudas abiertas" value={String(summary?.open_charges ?? 0)} icon={CalendarDays} tone="slate" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Prioridad de cobranza" action={<span className="text-sm text-muted">vencidas y parciales</span>}>
          {urgent.length ? (
            <div className="divide-y divide-slate-100">
              {urgent.map((charge) => (
                <ChargeRow key={charge.id} charge={charge} onPay={onPay} onReminder={onReminder} compact />
              ))}
            </div>
          ) : (
            <EmptyState title="Sin urgencias" detail="No hay deudas vencidas o parciales en este momento." />
          )}
        </Panel>
        <Panel title="Pagos recientes">
          <div className="space-y-3">
            {(summary?.recent_payments ?? []).map((payment) => (
              <div key={payment.id} className="rounded-md border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{payment.person_name}</p>
                  <p className="font-semibold text-emerald-700">{formatCurrency(payment.amount)}</p>
                </div>
                <p className="mt-1 text-sm text-muted">{payment.payment_date} · {payment.method}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

const helpTopics = [
  {
    category: "Pagos",
    question: "Como registro un pago si todavia no hay deuda?",
    answer:
      "Entra a Pagos, elegi el inquilino en Registrar pago sin deuda previa y toca Nuevo pago. El dinero entra a Caja y queda como saldo a favor del inquilino para aplicarlo despues."
  },
  {
    category: "Pagos",
    question: "Como cargo un pago adelantado de alquiler?",
    answer:
      "En Pagos, elegi el inquilino y toca Pago adelantado. Selecciona el contrato, el mes inicial y la cantidad de meses. El sistema crea esos alquileres, los marca como pagados y deja el movimiento en Caja."
  },
  {
    category: "Deudas",
    question: "Cuando uso Nueva deuda?",
    answer:
      "Usala para cargar un cargo puntual: UTE, OSE, gastos comunes, tributos, saneamiento u otro concepto. Si viene de una factura detectada, conviene crear el cargo desde Facturas."
  },
  {
    category: "Facturas",
    question: "Que hace el modulo Facturas?",
    answer:
      "Sirve para capturar facturas desde correo o cargar un archivo local. El sistema intenta leer proveedor, cuenta, importe y vencimiento, asociarlo a una propiedad y luego convertirlo en deuda."
  },
  {
    category: "Facturas",
    question: "Como hago que una factura se asocie sola?",
    answer:
      "Primero carga en la propiedad sus cuentas de servicios: UTE, OSE, gastos comunes u otros. Despues crea reglas de correo para reconocer remitente o asunto. Cuando llegue una factura con esa cuenta, el sistema la vincula."
  },
  {
    category: "Caja",
    question: "Que es Caja?",
    answer:
      "Caja es el registro de plata que entra y sale. Por ejemplo, cuando un inquilino paga, entra dinero. Cuando se carga un debito al propietario o una salida, queda registrado para tener trazabilidad."
  },
  {
    category: "Caja",
    question: "Que significa debito al propietario?",
    answer:
      "Es un gasto que se le descuenta al propietario en su liquidacion. Por ejemplo, un arreglo, tributo o gasto que pago la inmobiliaria y despues se descuenta al momento de liquidar."
  },
  {
    category: "Liquidaciones",
    question: "Que es una liquidacion?",
    answer:
      "Es el resumen mensual de cuanto se cobro por una propiedad, cuanto se descuenta por comision, IVA, IRPF o gastos, y cuanto queda para girarle al propietario."
  },
  {
    category: "Liquidaciones",
    question: "Que pasa si una propiedad tiene dos propietarios?",
    answer:
      "La liquidacion reparte los importes segun el porcentaje configurado en la propiedad. Si son 50% y 50%, cada uno recibe y descuenta su mitad. Si es 60% y 40%, se reparte de esa forma."
  },
  {
    category: "IRPF",
    question: "Como se calcula el IRPF?",
    answer:
      "El sistema lo calcula solo cuando el contrato y el propietario tienen IRPF activo. Es una regla configurable y debe validarse con contador o escribano antes de usarlo en produccion."
  },
  {
    category: "Propiedades",
    question: "Donde cargo UTE, OSE o gastos comunes?",
    answer:
      "En Propiedades, abri el detalle de la propiedad y entra a Cuentas de servicios. Ahi agregas proveedor, cuenta o referencia, quien paga y notas como unidad o padron."
  }
];

function FloatingHelpWidget() {
  const [open, setOpen] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState(helpTopics[0].question);
  const [query, setQuery] = useState("");
  const selected = helpTopics.find((topic) => topic.question === selectedQuestion) ?? helpTopics[0];
  const filtered = helpTopics.filter((topic) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${topic.category} ${topic.question} ${topic.answer}`.toLowerCase().includes(needle);
  });

  const quickFlow = [
    "Crear o revisar propiedad, propietario, inquilino y contrato.",
    "Cargar deuda manual, convertir factura en deuda o registrar pago adelantado.",
    "Registrar pago total, parcial o saldo a favor.",
    "Revisar Caja para ver entrada o salida de dinero.",
    "Generar liquidacion del periodo y revisar descuentos antes de exportar."
  ];

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <section className="w-[calc(100vw-2rem)] max-w-[28rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-brand p-2 text-white">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-semibold text-ink">Ayuda del sistema</h3>
                <p className="text-xs text-muted">Selecciona una pregunta</p>
              </div>
            </div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Cerrar ayuda">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[min(42rem,calc(100vh-9rem))] overflow-auto p-4">
            <div className="rounded-lg border border-slate-100 bg-white p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-md bg-teal-50 p-2 text-brand">
                  <HelpCircle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">{selected.category}</p>
                  <h4 className="mt-1 font-semibold text-ink">{selected.question}</h4>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{selected.answer}</p>
                </div>
              </div>
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">
                IRPF, IVA, DGI y criterios contables deben validarse con contador o escribano.
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-ink">Preguntas frecuentes</p>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input className="input pl-9" placeholder="Buscar por pagos, caja o facturas" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <div className="mt-3 grid gap-2">
                {filtered.map((topic) => {
                  const active = selected.question === topic.question;
                  return (
                    <button
                      key={topic.question}
                      className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                        active ? "border-brand bg-teal-50 text-ink" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedQuestion(topic.question)}
                    >
                      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-brand">{topic.category}</span>
                      <span className="mt-0.5 block text-sm font-semibold leading-5">{topic.question}</span>
                    </button>
                  );
                })}
                {!filtered.length && <EmptyState title="Sin resultados" detail="Proba buscar por pagos, caja, facturas o liquidacion." />}
              </div>
            </div>

            <details className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Ver flujo rapido</summary>
              <div className="mt-3 space-y-2">
                {quickFlow.map((step, index) => (
                  <div key={step} className="flex gap-2 rounded-md border border-slate-100 bg-white p-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-semibold text-white">{index + 1}</span>
                    <p className="text-xs leading-5 text-slate-700">{step}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </section>
      )}
      <button
        className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-2xl transition hover:bg-teal-800"
        onClick={() => setOpen(!open)}
        aria-label="Abrir ayuda"
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
        {open ? "Cerrar ayuda" : "Ayuda"}
      </button>
    </div>
  );
}

function Metric({ title, value, icon: Icon, tone }: { title: string; value: string; icon: typeof Home; tone: string }) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    rose: "bg-rose-50 text-rose-700",
    green: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700"
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted">{title}</p>
        <span className={`rounded-md p-2 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-panel">
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <h3 className="font-semibold text-ink">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const PAGE_SIZE = 10;

function includesText(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function inDateRange(value: string, from: string, to: string) {
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function usePaged<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => setPage(1), [items.length, pageSize]);
  return {
    page: safePage,
    setPage,
    totalPages,
    pageItems: items.slice((safePage - 1) * pageSize, safePage * pageSize)
  };
}

function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-muted">
      <span>{total} registros · página {page} de {totalPages}</span>
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>Anterior</button>
        <button className="btn-secondary" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Siguiente</button>
      </div>
    </div>
  );
}

function ChargesView({
  charges,
  statusFilter,
  search,
  setStatusFilter,
  setSearch,
  onBulkMonthly,
  onPay,
  onReminder,
  onLink,
  onEdit,
  onDelete
}: {
  charges: Charge[];
  statusFilter: string;
  search: string;
  setStatusFilter: (value: string) => void;
  setSearch: (value: string) => void;
  onBulkMonthly: () => Promise<void>;
  onPay: (charge: Charge) => void;
  onReminder: (charge: Charge) => void;
  onLink: (charge: Charge) => void;
  onEdit: (charge: Charge) => void;
  onDelete: (charge: Charge) => void;
}) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const datedCharges = charges.filter((charge) => inDateRange(charge.due_date, fromDate, toDate));
  const paged = usePaged(datedCharges);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel xl:flex-row xl:items-center xl:justify-between">
        <div className="grid flex-1 gap-3 md:grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar inquilino, propiedad o concepto" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <select className="input sm:w-52" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todas">Todas</option>
            <option value="vencido">Vencidas</option>
            <option value="parcial">Parciales</option>
            <option value="pendiente">Pendientes</option>
            <option value="pagado">Pagadas</option>
          </select>
          <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
        <button className="btn-secondary" onClick={onBulkMonthly}>
          <CalendarDays className="h-4 w-4" />
          Generar alquileres del mes
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-panel">
        {datedCharges.length ? (
          <div className="divide-y divide-slate-100">
            {paged.pageItems.map((charge) => (
              <ChargeRow
                key={charge.id}
                charge={charge}
                onPay={onPay}
                onReminder={onReminder}
                onLink={onLink}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState title="No hay deudas para este filtro" detail="Probá cambiar el estado o la búsqueda." />
          </div>
        )}
        <Pagination page={paged.page} totalPages={paged.totalPages} total={datedCharges.length} onPage={paged.setPage} />
      </div>
    </div>
  );
}

function ChargeRow({
  charge,
  onPay,
  onReminder,
  onLink,
  onEdit,
  onDelete,
  compact = false
}: {
  charge: Charge;
  onPay: (charge: Charge) => void;
  onReminder: (charge: Charge) => void;
  onLink?: (charge: Charge) => void;
  onEdit?: (charge: Charge) => void;
  onDelete?: (charge: Charge) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid gap-3 p-4 ${compact ? "lg:grid-cols-[1fr_auto]" : "xl:grid-cols-[1.5fr_1fr_1fr_auto]"}`}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={charge.status} />
          <p className="font-semibold text-ink">{charge.tenant_name}</p>
        </div>
        <p className="mt-1 text-sm text-muted">{charge.property_reference} · {charge.property_address}</p>
        <p className="mt-1 text-sm text-muted">{charge.description || charge.concept}</p>
      </div>
      {!compact && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Concepto</p>
          <p className="mt-1 font-medium text-ink">{charge.concept}</p>
          <p className="text-sm text-muted">Vence {charge.due_date}</p>
          <p className="text-xs text-muted">Dev. {charge.accrual_period || charge.period} · Liq. {charge.settlement_period || charge.period}</p>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Saldo</p>
        <p className="mt-1 text-lg font-semibold text-ink">{formatCurrency(charge.remaining_amount)}</p>
        <p className="text-sm text-muted">de {formatCurrency(charge.amount)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {charge.status !== "pagado" && (
          <button className="icon-action" title="Registrar pago" onClick={() => onPay(charge)}>
            <Banknote className="h-4 w-4" />
          </button>
        )}
        <button className="icon-action" title="Recordatorio" onClick={() => onReminder(charge)}>
          <MessageCircle className="h-4 w-4" />
        </button>
        {onLink && (
          <button className="icon-action" title="Link público" onClick={() => onLink(charge)}>
            <LinkIcon className="h-4 w-4" />
          </button>
        )}
        {onEdit && (
          <button className="icon-action" title="Editar deuda" onClick={() => onEdit(charge)}>
            <Edit3 className="h-4 w-4" />
          </button>
        )}
        {onDelete && (
          <button className="icon-action" title="Eliminar deuda" onClick={() => onDelete(charge)}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function InvoicesView({
  invoices,
  inboxes,
  setup,
  onImport,
  onCreateCharge,
  onDeleteInvoice,
  onCreateInbox,
  onCreateRule,
  onScanInbox
}: {
  invoices: InvoiceDocument[];
  inboxes: EmailInboxConfig[];
  setup: EmailSetupStatus | null;
  onRefresh: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onCreateCharge: (invoice: InvoiceDocument) => Promise<void>;
  onDeleteInvoice: (invoice: InvoiceDocument) => Promise<void>;
  onCreateInbox: (payload: unknown) => Promise<void>;
  onCreateRule: (inboxId: number, payload: unknown) => Promise<void>;
  onScanInbox: (inboxId: number) => Promise<{ run: EmailImportRun; invoices: InvoiceDocument[] }>;
}) {
  const [statusFilter, setStatusFilter] = useState("todos");
  const [providerFilter, setProviderFilter] = useState("todos");
  const [sourceFilter, setSourceFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [lastScan, setLastScan] = useState<EmailImportRun | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inboxForm, setInboxForm] = useState({
    name: "Correo facturas",
    email_address: "",
    host: "imap.gmail.com",
    port: 993,
    username: "",
    secret_env_var: "FACTURAS_EMAIL_PASSWORD",
    folder: "INBOX"
  });
  const [ruleForm, setRuleForm] = useState({
    inbox_id: 0,
    provider: "UTE",
    sender_pattern: "",
    subject_keywords: ""
  });
  const visible = invoices.filter((invoice) => {
    const matchesStatus = statusFilter === "todos" || invoice.status === statusFilter;
    const matchesProvider = providerFilter === "todos" || invoice.provider === providerFilter;
    const matchesSource = sourceFilter === "todos" || invoice.source === sourceFilter;
    const matchesDate = inDateRange(invoice.due_date, fromDate, toDate);
    const matchesText = !query || includesText(`${invoice.provider} ${invoice.account_number} ${invoice.property_reference} ${invoice.property_address}`, query);
    return matchesStatus && matchesProvider && matchesSource && matchesDate && matchesText;
  });
  const paged = usePaged(visible);
  const pending = invoices.filter((invoice) => invoice.status === "pendiente").length;
  const automated = invoices.filter((invoice) => invoice.source === "email").length;

  async function importFile(file: File) {
    setLoading(true);
    try {
      await onImport(file);
    } finally {
      setLoading(false);
    }
  }

  async function submitInbox(event: FormEvent) {
    event.preventDefault();
    await onCreateInbox({ ...inboxForm, provider: "imap", active: true });
    setRuleForm((current) => ({ ...current, inbox_id: 0 }));
  }

  async function submitRule(event: FormEvent) {
    event.preventDefault();
    const inboxId = ruleForm.inbox_id || inboxes[0]?.id;
    if (!inboxId) return;
    await onCreateRule(inboxId, {
      provider: ruleForm.provider,
      sender_pattern: ruleForm.sender_pattern,
      subject_keywords: ruleForm.subject_keywords,
      active: true
    });
    setRuleForm((current) => ({ ...current, sender_pattern: "", subject_keywords: "" }));
  }

  async function scanInbox(inboxId: number) {
    setScanningId(inboxId);
    try {
      const result = await onScanInbox(inboxId);
      setLastScan(result.run);
    } finally {
      setScanningId(null);
    }
  }

  function useGmailDefaults() {
    setInboxForm({
      ...inboxForm,
      name: "Gmail facturas",
      host: "imap.gmail.com",
      port: 993,
      username: inboxForm.email_address,
      secret_env_var: "FACTURAS_EMAIL_PASSWORD",
      folder: "INBOX"
    });
  }

  const configuredInbox = inboxes.find((inbox) => inbox.active);
  const hasRules = inboxes.some((inbox) => inbox.rules.length > 0);
  const quickInbox = configuredInbox ?? inboxes[0];
  const setupSteps = [
    { label: "Correo configurado", done: setup?.has_inbox ?? Boolean(configuredInbox) },
    { label: "Clave cargada", done: setup?.has_secret ?? false },
    { label: "Regla creada", done: setup?.has_rules ?? hasRules },
    { label: "Correo no leído con PDF", done: false },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric title="Pendientes" value={String(pending)} icon={Bell} tone="rose" />
        <Metric title="Desde email" value={String(automated)} icon={FileImage} tone="blue" />
        <Metric title="Total facturas" value={String(invoices.length)} icon={ReceiptText} tone="slate" />
      </div>
      <Panel
        title="Correo automático de facturas"
        action={
          <button className="btn-secondary" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Configuración
          </button>
        }
      >
        <div className="mb-4 grid gap-3 lg:grid-cols-4">
          {setupSteps.map((step, index) => (
            <div key={step.label} className={`rounded-lg border p-3 ${step.done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
              <p className={`text-xs font-semibold ${step.done ? "text-emerald-700" : "text-muted"}`}>Paso {index + 1}</p>
              <p className="mt-1 font-semibold text-ink">{step.label}</p>
            </div>
          ))}
        </div>
        <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_auto]">
          <div className={`rounded-lg border p-4 ${setup?.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <p className="font-semibold text-ink">Prueba rápida</p>
            <p className="mt-1 text-sm text-muted">
              Correo: {setup?.email_address || quickInbox?.email_address || "sin correo"} · Carpeta: {setup?.folder || quickInbox?.folder || "INBOX"}
            </p>
            <p className="mt-1 text-sm text-muted">
              Mandá un email no leído con asunto "factura UTE" y un PDF adjunto. Después tocá revisar.
            </p>
            {!setup?.has_secret && (
              <p className="mt-2 text-sm font-semibold text-amber-800">
                Falta pegar la app-password en backend/.env: {setup?.secret_env_var || "FACTURAS_EMAIL_PASSWORD"}="..."
              </p>
            )}
          </div>
          <button className="btn-primary justify-center px-6" onClick={() => quickInbox && scanInbox(quickInbox.id)} disabled={!quickInbox || scanningId === quickInbox.id}>
            {scanningId === quickInbox?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Revisar correo
          </button>
        </div>
        {lastScan && (
          <div className={`mb-4 rounded-lg border p-4 text-sm ${lastScan.status === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            <p className="font-semibold">Resultado: {lastScan.status}</p>
            <p className="mt-1">Correos revisados: {lastScan.messages_seen} · Facturas creadas: {lastScan.invoices_created}</p>
            {lastScan.notes && <p className="mt-1">{lastScan.notes}</p>}
          </div>
        )}
        {showAdvanced && (
        <>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <form className="grid gap-3 rounded-lg border border-slate-200 p-3" onSubmit={submitInbox}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">1. Bandeja central</p>
                <p className="text-sm text-muted">El campo "Variable de clave" debe decir FACTURAS_EMAIL_PASSWORD, no la clave real.</p>
              </div>
              <button className="btn-secondary" type="button" onClick={useGmailDefaults}>Usar Gmail</button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-ink">Nombre<input className="input" placeholder="Gmail facturas" value={inboxForm.name} onChange={(event) => setInboxForm({ ...inboxForm, name: event.target.value })} required /></label>
              <label className="grid gap-1 text-sm font-medium text-ink">Correo<input className="input" placeholder="tu-correo@gmail.com" value={inboxForm.email_address} onChange={(event) => setInboxForm({ ...inboxForm, email_address: event.target.value, username: event.target.value })} required /></label>
              <label className="grid gap-1 text-sm font-medium text-ink">Host IMAP<input className="input" placeholder="imap.gmail.com" value={inboxForm.host} onChange={(event) => setInboxForm({ ...inboxForm, host: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-medium text-ink">Usuario<input className="input" placeholder="tu-correo@gmail.com" value={inboxForm.username} onChange={(event) => setInboxForm({ ...inboxForm, username: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-medium text-ink">Variable de clave<input className="input" placeholder="FACTURAS_EMAIL_PASSWORD" value={inboxForm.secret_env_var} onChange={(event) => setInboxForm({ ...inboxForm, secret_env_var: event.target.value })} /></label>
              <label className="grid gap-1 text-sm font-medium text-ink">Carpeta<input className="input" placeholder="INBOX" value={inboxForm.folder} onChange={(event) => setInboxForm({ ...inboxForm, folder: event.target.value })} /></label>
            </div>
            <button className="btn-primary justify-center" type="submit">
              <Plus className="h-4 w-4" />
              Guardar bandeja
            </button>
          </form>
          <form className="grid gap-3 rounded-lg border border-slate-200 p-3" onSubmit={submitRule}>
            <div>
              <p className="font-semibold text-ink">2. Regla de prueba</p>
              <p className="text-sm text-muted">Para probar con un correo enviado por vos, poné tu email como remitente y "factura" en asunto.</p>
            </div>
            <select className="input" value={ruleForm.inbox_id || inboxes[0]?.id || 0} onChange={(event) => setRuleForm({ ...ruleForm, inbox_id: Number(event.target.value) })}>
              {inboxes.length ? inboxes.map((inbox) => <option key={inbox.id} value={inbox.id}>{inbox.name} · {inbox.email_address}</option>) : <option value={0}>Primero guardá una bandeja</option>}
            </select>
            <div className="grid gap-2 md:grid-cols-3">
              <select className="input" value={ruleForm.provider} onChange={(event) => setRuleForm({ ...ruleForm, provider: event.target.value })}>
                <option value="UTE">UTE</option>
                <option value="OSE">OSE</option>
                <option value="GASTOS_COMUNES">Gastos comunes</option>
                <option value="TRIBUTOS">Tributos</option>
                <option value="SANEAMIENTO">Saneamiento</option>
              </select>
              <input className="input" placeholder="ej: jose@gmail.com o ute" value={ruleForm.sender_pattern} onChange={(event) => setRuleForm({ ...ruleForm, sender_pattern: event.target.value })} />
              <input className="input" placeholder="ej: factura" value={ruleForm.subject_keywords} onChange={(event) => setRuleForm({ ...ruleForm, subject_keywords: event.target.value })} />
            </div>
            <button className="btn-secondary justify-center" type="submit" disabled={!inboxes.length}>
              <Plus className="h-4 w-4" />
              Agregar regla
            </button>
          </form>
        </div>
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">
          {inboxes.map((inbox) => (
            <div key={inbox.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="font-semibold text-ink">{inbox.name} · {inbox.email_address}</p>
                <p className="text-sm text-muted">{inbox.host || "sin host"} · {inbox.folder} · ultima revision {inbox.last_checked_at || "sin revisar"}</p>
                <p className="mt-1 text-xs text-muted">
                  Reglas: {inbox.rules.length ? inbox.rules.map((rule) => `${rule.provider}${rule.sender_pattern ? ` (${rule.sender_pattern})` : ""}`).join(", ") : "sin reglas"}
                </p>
                <p className="mt-1 text-xs text-muted">Clave esperada en backend/.env: {inbox.secret_env_var}=********</p>
              </div>
              <button className="btn-primary justify-center" onClick={() => scanInbox(inbox.id)} disabled={scanningId === inbox.id}>
                {scanningId === inbox.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Revisar correo
              </button>
            </div>
          ))}
          {!inboxes.length && <EmptyState title="Sin correo configurado" detail="Registrá el correo central y luego agregá reglas de UTE, OSE o gastos comunes." />}
        </div>
        </>
        )}
      </Panel>
      <Panel
        title="Facturas capturadas"
        action={
          <label className="btn-primary cursor-pointer">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
            Cargar factura local
            <input
              className="hidden"
              type="file"
              accept="application/pdf,image/*,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        }
      >
        <div className="mb-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="relative md:col-span-3 xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar proveedor, cuenta o finca" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="convertida">Convertidas</option>
            <option value="anulada">Anuladas</option>
            <option value="vencida">Vencidas</option>
          </select>
          <select className="input" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="todos">Todos los proveedores</option>
            <option value="UTE">UTE</option>
            <option value="OSE">OSE</option>
            <option value="TRIBUTOS">Tributos</option>
            <option value="SANEAMIENTO">Saneamiento</option>
            <option value="OTROS">Otros</option>
          </select>
          <select className="input" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="todos">Todas las fuentes</option>
            <option value="email">Email</option>
            <option value="manual">Manual</option>
          </select>
          <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
        {visible.length ? (
          <div className="divide-y divide-slate-100">
            {paged.pageItems.map((invoice) => (
              <div key={invoice.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center">
                <div>
                  <p className="font-semibold text-ink">{invoice.provider} · {invoice.account_number || "sin cuenta"}</p>
                  <p className="text-sm text-muted">
                    {invoice.property_reference || "Sin finca"} · vence {invoice.due_date} · {invoice.source} · responsable {invoice.responsible_type}
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">{formatCurrency(invoice.amount)}</span>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${invoice.status === "pendiente" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{invoice.status}</span>
                <button className="btn-secondary justify-center" onClick={() => onCreateCharge(invoice)} disabled={Boolean(invoice.charge_id || invoice.owner_charge_id || !invoice.property_id || invoice.status === "anulada")}>
                  <Plus className="h-4 w-4" />
                  Crear cargo
                </button>
                <button className="icon-action" title="Eliminar o anular factura" onClick={() => onDeleteInvoice(invoice)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin facturas para este filtro" detail="Importá PDFs o configurá el correo central para procesarlas automáticamente." />
        )}
        <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
      </Panel>
    </div>
  );
}

function TenantsView({
  people,
  getOpenCharges,
  onNew,
  onEdit,
  onDelete,
  onDetail,
  onReminder,
  onLink,
  onPayGroup
}: {
  people: Person[];
  getOpenCharges: (personId: number) => Charge[];
  onNew: () => void;
  onEdit: (person: Person) => void;
  onDelete: (person: Person) => void;
  onDetail: (person: Person) => void;
  onReminder: (person: Person) => void;
  onLink: (person: Person) => void;
  onPayGroup: (person: Person) => void;
}) {
  const [query, setQuery] = useState("");
  const [debtFilter, setDebtFilter] = useState("todos");
  const [sortBy, setSortBy] = useState("codigo_desc");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const visible = [...people]
    .filter((person) => {
      const openItems = getOpenCharges(person.id);
      const matchesText = !query || includesText(`${person.full_name} ${person.document} ${person.mobile} ${person.email} ${person.legacy_code}`, query);
      const matchesDebt =
        debtFilter === "todos" ||
        (debtFilter === "con_deuda" && person.total_debt > 0) ||
        (debtFilter === "vencida" && person.overdue_debt > 0) ||
        (debtFilter === "sin_deuda" && openItems.length === 0);
      return matchesText && matchesDebt;
    })
    .sort((a, b) => {
      const codeA = legacyCodeValue(a.legacy_code || "0");
      const codeB = legacyCodeValue(b.legacy_code || "0");
      if (sortBy === "codigo_asc") return codeA > codeB ? 1 : codeA < codeB ? -1 : 0;
      if (sortBy === "codigo_desc") return codeA < codeB ? 1 : codeA > codeB ? -1 : 0;
      if (sortBy === "fecha_desc") return b.created_at.localeCompare(a.created_at);
      if (sortBy === "fecha_asc") return a.created_at.localeCompare(b.created_at);
      if (sortBy === "deuda_desc") return b.total_debt - a.total_debt;
      return a.full_name.localeCompare(b.full_name);
    });
  const paged = usePaged(visible);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel md:grid-cols-[1fr_220px_240px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar nombre, código, documento o contacto" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select className="input" value={debtFilter} onChange={(event) => setDebtFilter(event.target.value)}>
          <option value="todos">Todos</option>
          <option value="con_deuda">Con deuda</option>
          <option value="vencida">Con vencida</option>
          <option value="sin_deuda">Sin deuda</option>
        </select>
        <select className="input" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="codigo_desc">Código mayor primero</option>
          <option value="codigo_asc">Código menor primero</option>
          <option value="fecha_desc">Creación más reciente</option>
          <option value="fecha_asc">Creación más antigua</option>
          <option value="nombre_asc">Nombre A-Z</option>
          <option value="deuda_desc">Mayor deuda</option>
        </select>
        <button className="btn-primary" onClick={onNew}>
          <Plus className="h-4 w-4" />
          Nuevo inquilino
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {paged.pageItems.map((person) => {
          const openItems = getOpenCharges(person.id);
          const isExpanded = Boolean(expanded[person.id]);
          return (
            <div key={person.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ink">{person.full_name}</h3>
                  <p className="mt-1 text-sm text-muted">{[person.legacy_code && `Código ${person.legacy_code}`, person.document || person.email || person.mobile].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 text-xs text-muted">Creado {formatDateTime(person.created_at)}</p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{openItems.length} abiertas</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="text-xs text-muted">Deuda</p>
                  <p className="font-semibold text-ink">{formatCurrency(person.total_debt)}</p>
                </div>
                <div className="rounded-md bg-rose-50 p-3">
                  <p className="text-xs text-rose-700">Vencido</p>
                  <p className="font-semibold text-rose-700">{formatCurrency(person.overdue_debt)}</p>
                </div>
              </div>
              <p className="mt-4 truncate text-sm text-muted">{person.mobile || person.email || "Sin contacto"}</p>
              {isExpanded && (
                <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-muted">
                  <p>Documento: {person.document || "sin dato"}</p>
                  <p>Email: {person.email || "sin dato"}</p>
                  <p>Teléfono: {person.mobile || person.phone || "sin dato"}</p>
                  <p>Fecha de creación: {formatDateTime(person.created_at)}</p>
                  <p>Deudas abiertas: {openItems.map((charge) => `${charge.concept} ${formatCurrency(charge.remaining_amount)}`).join(", ") || "ninguna"}</p>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="icon-action" title={isExpanded ? "Contraer" : "Expandir"} onClick={() => setExpanded({ ...expanded, [person.id]: !isExpanded })}>
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <button className="icon-action" title="Ver ficha" onClick={() => onDetail(person)}>
                  <Eye className="h-4 w-4" />
                </button>
                <button className="icon-action" title="Registrar pago agrupado" onClick={() => onPayGroup(person)} disabled={!openItems.length}>
                  <Banknote className="h-4 w-4" />
                </button>
                <button className="icon-action" title="Recordar deuda" onClick={() => onReminder(person)} disabled={!openItems.length}>
                  <MessageCircle className="h-4 w-4" />
                </button>
                <button className="icon-action" title="Crear link público" onClick={() => onLink(person)} disabled={!openItems.length}>
                  <LinkIcon className="h-4 w-4" />
                </button>
                <button className="icon-action" title="Editar inquilino" onClick={() => onEdit(person)}>
                  <Edit3 className="h-4 w-4" />
                </button>
                <button className="icon-action" title="Eliminar inquilino" onClick={() => onDelete(person)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
    </div>
  );
}

function OwnersView({
  people,
  properties,
  settlements,
  onNew,
  onEdit,
  onDelete
}: {
  people: Person[];
  properties: PropertyItem[];
  settlements: Settlement[];
  onNew: () => void;
  onEdit: (person: Person) => void;
  onDelete: (person: Person) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("codigo_desc");
  const visible = [...people]
    .filter((person) =>
      !query || includesText(`${person.full_name} ${person.document} ${person.mobile} ${person.email} ${person.legacy_code}`, query)
    )
    .sort((a, b) => {
      const codeA = legacyCodeValue(a.legacy_code || "0");
      const codeB = legacyCodeValue(b.legacy_code || "0");
      if (sortBy === "codigo_asc") return codeA > codeB ? 1 : codeA < codeB ? -1 : 0;
      if (sortBy === "codigo_desc") return codeA < codeB ? 1 : codeA > codeB ? -1 : 0;
      if (sortBy === "fecha_desc") return b.created_at.localeCompare(a.created_at);
      if (sortBy === "fecha_asc") return a.created_at.localeCompare(b.created_at);
      return a.full_name.localeCompare(b.full_name);
    });
  const paged = usePaged(visible);
  const ownedProperties = (ownerId: number) =>
    properties.filter((property) => property.owners.some((owner) => owner.id === ownerId));
  const ownerSettlement = (ownerId: number) =>
    settlements.find((settlement) => settlement.owner_id === ownerId);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel md:grid-cols-[1fr_240px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar propietario, código, documento o contacto" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select className="input" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="codigo_desc">Código mayor primero</option>
          <option value="codigo_asc">Código menor primero</option>
          <option value="fecha_desc">Creación más reciente</option>
          <option value="fecha_asc">Creación más antigua</option>
          <option value="nombre_asc">Nombre A-Z</option>
        </select>
        <button className="btn-primary" onClick={onNew}>
          <Plus className="h-4 w-4" />
          Nuevo propietario
        </button>
      </div>
      {visible.length ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {paged.pageItems.map((person) => {
            const props = ownedProperties(person.id);
            const settlement = ownerSettlement(person.id);
            return (
              <div key={person.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">{person.full_name}</h3>
                    <p className="mt-1 text-sm text-muted">{[person.legacy_code && `Código ${person.legacy_code}`, person.document || person.email || person.mobile].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1 text-xs text-muted">Creado {formatDateTime(person.created_at)}</p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{props.length} finca(s)</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-slate-50 p-3">
                    <p className="text-xs text-muted">Última liquidación</p>
                    <p className="font-semibold text-ink">{settlement ? settlement.period : "Sin generar"}</p>
                  </div>
                  <div className="rounded-md bg-emerald-50 p-3">
                    <p className="text-xs text-emerald-700">A girar</p>
                    <p className="font-semibold text-emerald-700">{settlement ? formatCurrency(settlement.total_to_transfer) : formatCurrency(0)}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted">
                  Fincas: {props.map((property) => `${property.reference} (${property.owners.find((owner) => owner.id === person.id)?.percentage ?? 0}%)`).join(", ") || "sin fincas asociadas"}
                </p>
                <p className="mt-2 truncate text-sm text-muted">{person.mobile || person.email || "Sin contacto"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="icon-action" title="Editar propietario" onClick={() => onEdit(person)}>
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button className="icon-action" title="Eliminar propietario" onClick={() => onDelete(person)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Sin propietarios" detail="Creá propietarios para poder asociarlos a fincas y generar liquidaciones." />
      )}
      <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
    </div>
  );
}

function PropertiesView({
  properties,
  onNew,
  onEdit,
  onDetail,
  onDelete
}: {
  properties: PropertyItem[];
  onNew: () => void;
  onEdit: (property: PropertyItem) => void;
  onDetail: (property: PropertyItem) => void;
  onDelete: (property: PropertyItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [sortBy, setSortBy] = useState("codigo_desc");
  const visible = [...properties]
    .filter((property) => {
      const ownerText = property.owners.map((owner) => owner.full_name).join(" ");
      const serviceText = property.services?.map((service) => `${service.provider} ${service.account_number}`).join(" ") ?? "";
      return (status === "todos" || property.occupancy_status === status) && (!query || includesText(`${property.legacy_code} ${property.reference} ${property.address} ${property.padron} ${property.ute_account} ${property.ose_account} ${ownerText} ${serviceText}`, query));
    })
    .sort((a, b) => {
      const codeA = legacyCodeValue(a.legacy_code || "0");
      const codeB = legacyCodeValue(b.legacy_code || "0");
      if (sortBy === "codigo_asc") return codeA > codeB ? 1 : codeA < codeB ? -1 : 0;
      if (sortBy === "codigo_desc") return codeA < codeB ? 1 : codeA > codeB ? -1 : 0;
      if (sortBy === "fecha_desc") return b.created_at.localeCompare(a.created_at);
      if (sortBy === "fecha_asc") return a.created_at.localeCompare(b.created_at);
      return a.reference.localeCompare(b.reference);
    });
  const paged = usePaged(visible);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel md:grid-cols-[1fr_220px_240px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar código, ref, dirección, padrón, propietario o cuenta" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="todos">Todos los estados</option>
          <option value="alquilada">Alquilada</option>
          <option value="libre">Libre</option>
          <option value="mantenimiento">Mantenimiento</option>
        </select>
        <select className="input" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="codigo_desc">Código mayor primero</option>
          <option value="codigo_asc">Código menor primero</option>
          <option value="fecha_desc">Creación más reciente</option>
          <option value="fecha_asc">Creación más antigua</option>
          <option value="referencia_asc">Referencia A-Z</option>
        </select>
        <button className="btn-primary" onClick={onNew}>
          <Plus className="h-4 w-4" />
          Nueva propiedad
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-panel">
        <div className="hidden grid-cols-[0.9fr_1.5fr_1fr_1fr_auto] gap-3 border-b border-slate-100 p-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted md:grid">
          <span>Ref</span>
          <span>Dirección</span>
          <span>Propietarios</span>
          <span>Cuentas</span>
          <span>Acciones</span>
        </div>
        {paged.pageItems.map((property) => (
          <div key={property.id} className="grid gap-3 border-b border-slate-100 p-4 text-sm last:border-b-0 md:grid-cols-[0.9fr_1.5fr_1fr_1fr_auto]">
            <div>
              <p className="font-semibold text-ink">{property.reference}</p>
              <p className="text-muted">{[property.legacy_code && `Código ${property.legacy_code}`, `Creado ${formatDateTime(property.created_at)}`].filter(Boolean).join(" · ")}</p>
            </div>
            <div>
              <p className="font-medium text-ink">{property.address}</p>
              <p className="text-muted">Padrón {property.padron || "sin dato"} · {property.occupancy_status}</p>
            </div>
            <p className="text-muted">{property.owners.map((owner) => `${owner.full_name} ${owner.percentage}%`).join(", ") || "Sin propietario"}</p>
            <p className="text-muted">{[property.ute_account && `UTE ${property.ute_account}`, property.ose_account && `OSE ${property.ose_account}`].filter(Boolean).join(" · ") || "Sin cuentas"}</p>
            <div className="flex gap-2">
              <button className="icon-action" title="Ver ficha" onClick={() => onDetail(property)}>
                <Eye className="h-4 w-4" />
              </button>
              <button className="icon-action" title="Editar propiedad" onClick={() => onEdit(property)}>
                <Edit3 className="h-4 w-4" />
              </button>
              <button className="icon-action" title="Eliminar propiedad" onClick={() => onDelete(property)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
      </div>
    </div>
  );
}

function VisitsView({
  visits,
  properties,
  onRefresh
}: {
  visits: PropertyVisit[];
  properties: PropertyItem[];
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [propertyId, setPropertyId] = useState(String(properties[0]?.id ?? ""));
  const [interestedName, setInterestedName] = useState("");
  const [interestedPhone, setInterestedPhone] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("120");
  const [visitAt, setVisitAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const visible = visits.filter((visit) => {
    const text = `${visit.property_reference} ${visit.property_address} ${visit.interested_name} ${visit.interested_phone} ${visit.status}`;
    return (status === "todos" || visit.status === status) && (!query || includesText(text, query));
  });
  const paged = usePaged(visible);
  const nextVisits = visits.filter((visit) => visit.status !== "cancelada" && visit.status !== "realizada").slice(0, 3);
  const dueAlerts = visits.filter((visit) => {
    return isVisitAlertActive(visit, new Date());
  });

  async function createVisit(event: FormEvent) {
    event.preventDefault();
    if (!propertyId || !interestedName || !visitAt) return;
    setLoading(true);
    try {
      await api.createPropertyVisit({
        property_id: Number(propertyId),
        interested_name: interestedName,
        interested_phone: interestedPhone,
        notification_phone: notificationPhone,
        visit_at: visitAt,
        status: "coordinada",
        reminder_minutes_before: Number(reminderMinutes),
        notes
      });
      setInterestedName("");
      setInterestedPhone("");
      setNotificationPhone("");
      setReminderMinutes("120");
      setVisitAt("");
      setNotes("");
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(visit: PropertyVisit, nextStatus: string) {
    await api.updatePropertyVisit(visit.id, { ...visit, status: nextStatus });
    await onRefresh();
  }

  async function removeVisit(visit: PropertyVisit) {
    if (!window.confirm(`Eliminar visita de ${visit.interested_name}?`)) return;
    await api.deletePropertyVisit(visit.id);
    await onRefresh();
  }

  return (
    <div className="space-y-4">
      {dueAlerts.length > 0 && (
        <Panel title="Alertas activas" action={<span className="text-sm text-muted">dentro del margen configurado</span>}>
          <div className="space-y-3">
            {dueAlerts.map((visit) => {
              const internalMessage = `Recordatorio de visita: ${visit.interested_name} en ${visit.property_reference} el ${formatDateTime(visit.visit_at)}. Tel: ${visit.interested_phone || "sin dato"}`;
              return (
                <div key={visit.id} className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <p className="font-semibold text-amber-950">{formatDateTime(visit.visit_at)} · {visit.property_reference}</p>
                    <p className="text-sm text-amber-900">{visit.interested_name} · {visit.interested_phone || "sin celular"} · avisar {visit.reminder_minutes_before} min antes</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(internalMessage)}>
                      <Copy className="h-4 w-4" />
                      Copiar alerta
                    </button>
                    <a className={`btn-secondary ${!visit.notification_phone ? "pointer-events-none opacity-50" : ""}`} href={buildWhatsappUrl(visit.notification_phone, internalMessage) || "#"} target="_blank" rel="noreferrer">
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp interno
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="Nueva visita" action={<span className="text-sm text-muted">agenda comercial</span>}>
          <form onSubmit={createVisit} className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-ink">Propiedad
              <select className="input" value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>{property.reference} · {property.address}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">Fecha y hora
              <input className="input" type="datetime-local" value={visitAt} onChange={(event) => setVisitAt(event.target.value)} required />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">Interesado
              <input className="input" value={interestedName} onChange={(event) => setInterestedName(event.target.value)} required />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">Celular
              <input className="input" value={interestedPhone} onChange={(event) => setInterestedPhone(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">Avisar a WhatsApp interno
              <input className="input" value={notificationPhone} onChange={(event) => setNotificationPhone(event.target.value)} placeholder="Celular de Emiliano o equipo" />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">Avisar antes
              <select className="input" value={reminderMinutes} onChange={(event) => setReminderMinutes(event.target.value)}>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
                <option value="180">3 horas</option>
                <option value="1440">1 día</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink md:col-span-2">Notas
              <textarea className="input min-h-20" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <button className="btn-primary justify-center md:col-span-2" disabled={loading || !properties.length}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Agendar visita
            </button>
          </form>
        </Panel>
        <Panel title="Próximas visitas">
          <div className="space-y-3">
            {nextVisits.map((visit) => (
              <div key={visit.id} className="rounded-md border border-slate-100 p-3">
                <p className="font-semibold text-ink">{formatDateTime(visit.visit_at)} · {visit.interested_name}</p>
                <p className="mt-1 text-sm text-muted">{visit.property_reference} · {visit.interested_phone || "sin celular"}</p>
              </div>
            ))}
            {!nextVisits.length && <EmptyState title="Sin visitas próximas" detail="Agendá visitas para propiedades libres o en promoción." />}
            <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-muted">
              La alerta aparece en el sistema cuando entra en la ventana configurada. WhatsApp se abre con el mensaje listo; el envío automático requiere WhatsApp Business API.
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Agenda de visitas">
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar propiedad, interesado o teléfono" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="coordinada">Coordinada</option>
            <option value="confirmada">Confirmada</option>
            <option value="realizada">Realizada</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </div>
        <div className="divide-y divide-slate-100">
          {paged.pageItems.map((visit) => {
            const whatsapp = buildWhatsappUrl(visit.interested_phone, visit.contact_message);
            const internalMessage = `Recordatorio de visita: ${visit.interested_name} en ${visit.property_reference} el ${formatDateTime(visit.visit_at)}. Tel: ${visit.interested_phone || "sin dato"}`;
            const internalWhatsapp = buildWhatsappUrl(visit.notification_phone, internalMessage);
            return (
              <div key={visit.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
                <div>
                  <p className="font-semibold text-ink">{formatDateTime(visit.visit_at)} · {visit.interested_name}</p>
                  <p className="text-sm text-muted">{visit.property_reference} · {visit.property_address} · {visit.status}</p>
                  <p className="mt-1 text-xs text-muted">{visit.contact_message}</p>
                  <p className="mt-1 text-xs text-muted">Aviso interno: {visit.reminder_minutes_before} min antes · {visit.notification_phone || "sin WhatsApp interno"}</p>
                </div>
                <select className="input min-w-36" value={visit.status} onChange={(event) => updateStatus(visit, event.target.value)}>
                  <option value="coordinada">Coordinada</option>
                  <option value="confirmada">Confirmada</option>
                  <option value="realizada">Realizada</option>
                  <option value="cancelada">Cancelada</option>
                </select>
                <div className="flex gap-2">
                  <button className="icon-action" title="Copiar mensaje" onClick={() => navigator.clipboard.writeText(visit.contact_message)}>
                    <Copy className="h-4 w-4" />
                  </button>
                  <a className={`icon-action ${!whatsapp ? "pointer-events-none opacity-50" : ""}`} title="Enviar WhatsApp" href={whatsapp || "#"} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" />
                  </a>
                  <a className={`icon-action ${!internalWhatsapp ? "pointer-events-none opacity-50" : ""}`} title="Avisar al equipo" href={internalWhatsapp || "#"} target="_blank" rel="noreferrer">
                    <Bell className="h-4 w-4" />
                  </a>
                  <button className="icon-action" title="Eliminar visita" onClick={() => removeVisit(visit)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {!visible.length && <EmptyState title="Sin visitas" detail="No hay visitas para los filtros actuales." />}
        </div>
        <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
      </Panel>
    </div>
  );
}

function ContractsView({
  contracts,
  onNew,
  onEdit,
  onDelete
}: {
  contracts: ContractItem[];
  onNew: () => void;
  onEdit: (contract: ContractItem) => void;
  onDelete: (contract: ContractItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("todos");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortBy, setSortBy] = useState("codigo_desc");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const visible = [...contracts]
    .filter((contract) => {
      const text = `${contract.tenant_name} ${contract.property_reference} ${contract.property_address} ${contract.owners.map((owner) => owner.full_name).join(" ")} ${contract.legacy_code}`;
      const matchesActive = activeFilter === "todos" || (activeFilter === "activo" ? contract.active : !contract.active);
      const matchesDate = inDateRange(contract.start_date, fromDate, toDate);
      return matchesActive && matchesDate && (!query || includesText(text, query));
    })
    .sort((a, b) => {
      const codeA = legacyCodeValue(a.legacy_code || "0");
      const codeB = legacyCodeValue(b.legacy_code || "0");
      if (sortBy === "codigo_asc") return codeA > codeB ? 1 : codeA < codeB ? -1 : 0;
      if (sortBy === "codigo_desc") return codeA < codeB ? 1 : codeA > codeB ? -1 : 0;
      if (sortBy === "inicio_desc") return b.start_date.localeCompare(a.start_date);
      if (sortBy === "inicio_asc") return a.start_date.localeCompare(b.start_date);
      return a.tenant_name.localeCompare(b.tenant_name);
    });
  const paged = usePaged(visible);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel md:grid-cols-[1fr_180px_160px_160px_220px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar inquilino, finca o propietario" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select className="input" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
          <option value="todos">Todos</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Inactivos</option>
        </select>
        <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        <select className="input" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="codigo_desc">Código mayor primero</option>
          <option value="codigo_asc">Código menor primero</option>
          <option value="inicio_desc">Inicio más reciente</option>
          <option value="inicio_asc">Inicio más antiguo</option>
          <option value="inquilino_asc">Inquilino A-Z</option>
        </select>
        <button className="btn-primary" onClick={onNew}>
          <Plus className="h-4 w-4" />
          Nuevo contrato
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {paged.pageItems.map((contract) => {
          const isExpanded = Boolean(expanded[contract.id]);
          return (
          <div key={contract.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-ink">{contract.tenant_name}</h3>
                <p className="mt-1 text-sm text-muted">{[contract.legacy_code && `Contrato ${contract.legacy_code}`, contract.property_reference, contract.property_address].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{contract.active ? "Activo" : "Inactivo"}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <MiniStat label="Alquiler" value={formatCurrency(contract.rent_amount)} />
              <MiniStat label="Comisión" value={`${contract.commission_percent}%`} />
              <MiniStat label="IRPF" value={contract.irpf_applies ? `${contract.irpf_percent}%` : "No aplica"} />
              <MiniStat label="Garantía" value={contract.guarantee_type === "anda" ? "ANDA 2%" : contract.guarantee_type === "contaduria" ? "Contaduría 3%" : contract.guarantee_provider || contract.guarantee_type} />
            </div>
            <p className="mt-4 text-sm text-muted">Propietarios: {contract.owners.map((owner) => `${owner.full_name} ${owner.percentage}%`).join(", ") || "Sin propietarios"}</p>
            {isExpanded && (
              <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-muted">
                <p>Inicio: {contract.start_date} · Fin: {contract.end_date || "sin fecha"}</p>
                <p>Origen pago: {contract.payment_origin} · Tipo: {contract.payment_type}</p>
                <p>Régimen: {contract.rent_regime} · Índice: {contract.reajustment_index} · Próximo reajuste: {contract.next_reajustment_date || "sin fecha"}</p>
                <p>Finca: {contract.property_reference} · {contract.property_address}</p>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button className="icon-action" title={isExpanded ? "Contraer" : "Expandir"} onClick={() => setExpanded({ ...expanded, [contract.id]: !isExpanded })}>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <button className="icon-action" title="Editar contrato" onClick={() => onEdit(contract)}>
                <Edit3 className="h-4 w-4" />
              </button>
              <button className="icon-action" title="Eliminar contrato" onClick={() => onDelete(contract)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          );
        })}
      </div>
      <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function PaymentsView({
  people,
  charges,
  credits,
  onPay,
  onBatchPay,
  onAdvancePay,
  onNewPayment
}: {
  people: Person[];
  charges: Charge[];
  credits: TenantCredit[];
  onPay: (charge: Charge) => void;
  onBatchPay: (person: Person, charges: Charge[]) => void;
  onAdvancePay: (person: Person) => void;
  onNewPayment: (person: Person) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const debtors = people
    .map((person) => ({
      person,
      charges: charges.filter((charge) => charge.responsible_person_id === person.id)
    }))
    .filter((item) => {
      const total = item.charges.reduce((sum, charge) => sum + charge.remaining_amount, 0);
      const hasOverdue = item.charges.some((charge) => charge.status === "vencido");
      const matchesStatus = statusFilter === "todos" || (statusFilter === "vencida" ? hasOverdue : total > 0);
      return item.charges.length > 0 && matchesStatus && (!query || includesText(`${item.person.full_name} ${item.person.document} ${item.person.mobile}`, query));
    })
    .sort((a, b) => b.charges.reduce((sum, charge) => sum + charge.remaining_amount, 0) - a.charges.reduce((sum, charge) => sum + charge.remaining_amount, 0));
  const pagedDebtors = usePaged(debtors);
  const pagedOpenCharges = usePaged(charges);
  const [selectedPersonId, setSelectedPersonId] = useState(String(people[0]?.id ?? ""));
  const selectedPerson = people.find((person) => String(person.id) === selectedPersonId) ?? people[0];

  return (
    <div className="space-y-4">
      <Panel title="Registrar pago sin deuda previa" action={<span className="text-sm text-muted">también sirve para adelantos</span>}>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <select className="input" value={selectedPersonId} onChange={(event) => setSelectedPersonId(event.target.value)}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.full_name}</option>
            ))}
          </select>
          <button className="btn-secondary justify-center" onClick={() => selectedPerson && onNewPayment(selectedPerson)} disabled={!selectedPerson}>
            <Banknote className="h-4 w-4" />
            Nuevo pago
          </button>
          <button className="btn-primary justify-center" onClick={() => selectedPerson && onAdvancePay(selectedPerson)} disabled={!selectedPerson}>
            <CalendarDays className="h-4 w-4" />
            Pago adelantado
          </button>
        </div>
      </Panel>
      <Panel title="Saldos a favor" action={<span className="text-sm text-muted">pagos recibidos sin imputar completo</span>}>
        {credits.filter((credit) => credit.remaining_amount > 0).length ? (
          <div className="divide-y divide-slate-100">
            {credits.filter((credit) => credit.remaining_amount > 0).map((credit) => (
              <div key={credit.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div>
                  <p className="font-semibold text-ink">{credit.person_name}</p>
                  <p className="text-sm text-muted">{credit.notes || "Saldo disponible"} · {credit.status}</p>
                </div>
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-700">{formatCurrency(credit.remaining_amount)}</span>
                <span className="text-xs text-muted">Pago #{credit.payment_id ?? "-"}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin saldos a favor" detail="Cuando un inquilino pague de más o quede dinero sin imputar, aparecerá acá." />
        )}
      </Panel>
      <Panel title="Pago rápido por inquilino" action={<span className="text-sm text-muted">imputa varias deudas</span>}>
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar inquilino" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todos">Todas las deudas</option>
            <option value="vencida">Con vencidas</option>
            <option value="abierta">Con saldo abierto</option>
          </select>
        </div>
        {debtors.length ? (
          <div className="divide-y divide-slate-100">
            {pagedDebtors.pageItems.map(({ person, charges: personCharges }) => {
              const total = personCharges.reduce((sum, charge) => sum + charge.remaining_amount, 0);
              return (
                <div key={person.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-ink">{person.full_name}</p>
                    <p className="text-sm text-muted">{personCharges.length} deudas abiertas · {formatCurrency(total)}</p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">{formatCurrency(total)}</span>
                  <button className="btn-primary justify-center" onClick={() => onBatchPay(person, personCharges)}>
                    <Banknote className="h-4 w-4" />
                    Registrar pago
                  </button>
                  <button className="btn-secondary justify-center" onClick={() => onAdvancePay(person)}>
                    <CalendarDays className="h-4 w-4" />
                    Adelantado
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Sin deudas abiertas" detail="Cuando haya saldos pendientes, aparecen acá para imputar pagos rápido." />
        )}
        <Pagination page={pagedDebtors.page} totalPages={pagedDebtors.totalPages} total={debtors.length} onPage={pagedDebtors.setPage} />
      </Panel>
      <Panel title="Deudas abiertas">
        <div className="divide-y divide-slate-100">
          {pagedOpenCharges.pageItems.map((charge) => (
            <ChargeRow key={charge.id} charge={charge} onPay={onPay} onReminder={() => undefined} compact />
          ))}
        </div>
        <Pagination page={pagedOpenCharges.page} totalPages={pagedOpenCharges.totalPages} total={charges.length} onPage={pagedOpenCharges.setPage} />
      </Panel>
    </div>
  );
}

function CashView({
  movements,
  ownerCharges,
  owners,
  properties,
  onNewOwnerCharge,
  onVoidOwnerCharge
}: {
  movements: CashMovement[];
  ownerCharges: OwnerCharge[];
  owners: Person[];
  properties: PropertyItem[];
  onNewOwnerCharge: () => void;
  onVoidOwnerCharge: (ownerCharge: OwnerCharge) => Promise<void>;
}) {
  const [typeFilter, setTypeFilter] = useState("todos");
  const [originFilter, setOriginFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const visibleMovements = movements.filter((movement) => {
    const matchesType = typeFilter === "todos" || movement.movement_type === typeFilter;
    const matchesOrigin = originFilter === "todos" || movement.origin === originFilter;
    const matchesStatus = statusFilter === "todos" || movement.status === statusFilter;
    const matchesDate = inDateRange(movement.movement_date, fromDate, toDate);
    const matchesText = !query || includesText(`${movement.concept} ${movement.person_name} ${movement.property_reference} ${movement.origin}`, query);
    return matchesType && matchesOrigin && matchesStatus && matchesDate && matchesText;
  });
  const pagedMovements = usePaged(visibleMovements);
  const pagedOwnerCharges = usePaged(ownerCharges);
  const entries = visibleMovements.filter((item) => item.movement_type === "entrada" && item.status === "confirmado");
  const exits = visibleMovements.filter((item) => item.movement_type === "salida" && item.status === "confirmado");
  const totalIn = entries.reduce((sum, item) => sum + item.amount, 0);
  const totalOut = exits.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric title="Entradas" value={formatCurrency(totalIn)} icon={ArrowDownToLine} tone="green" />
        <Metric title="Salidas" value={formatCurrency(totalOut)} icon={WalletCards} tone="rose" />
        <Metric title="Saldo caja" value={formatCurrency(totalIn - totalOut)} icon={Banknote} tone="blue" />
      </div>
      <Panel
        title="Débitos a propietario"
        action={
          <button className="btn-primary" onClick={onNewOwnerCharge} disabled={!owners.length || !properties.length}>
            <Plus className="h-4 w-4" />
            Nuevo débito
          </button>
        }
      >
        {ownerCharges.length ? (
          <div className="divide-y divide-slate-100">
            {pagedOwnerCharges.pageItems.map((item) => (
              <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <div>
                  <p className="font-semibold text-ink">{item.owner_name}</p>
                  <p className="text-sm text-muted">
                    {item.property_reference} · {item.concept} · {item.charge_date} · {item.split_by_ownership ? "reparte por %" : "directo"}
                  </p>
                </div>
                <span className="rounded-md bg-rose-50 px-2 py-1 text-sm font-semibold text-rose-700">{formatCurrency(item.amount)}</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{item.paid_by_agency ? "Caja automática" : "Sin caja"}</span>
                <button className="icon-action" title="Anular débito" onClick={() => onVoidOwnerCharge(item)} disabled={item.status === "anulado"}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin débitos a propietario" detail="Registrá contribución, primaria, saneamiento u otros gastos administrados." />
        )}
        <Pagination page={pagedOwnerCharges.page} totalPages={pagedOwnerCharges.totalPages} total={ownerCharges.length} onPage={pagedOwnerCharges.setPage} />
      </Panel>
      <Panel title="Movimientos de caja" action={<span className="text-sm text-muted">pagos, gastos, ajustes y reversas</span>}>
        <div className="mb-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="relative md:col-span-3 xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar concepto, persona o finca" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="todos">Todos los tipos</option>
            <option value="entrada">Entradas</option>
            <option value="salida">Salidas</option>
          </select>
          <select className="input" value={originFilter} onChange={(event) => setOriginFilter(event.target.value)}>
            <option value="todos">Todos los orígenes</option>
            <option value="payment">Pagos</option>
            <option value="owner_charge">Gastos propietario</option>
            <option value="manual">Manual</option>
            <option value="anulacion">Anulaciones</option>
          </select>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="confirmado">Confirmados</option>
            <option value="anulado">Anulados</option>
          </select>
          <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
        {visibleMovements.length ? (
          <div className="divide-y divide-slate-100">
            {pagedMovements.pageItems.map((movement) => (
              <div key={movement.id} className="grid gap-3 py-3 md:grid-cols-[auto_1fr_auto_auto] md:items-center">
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${movement.movement_type === "entrada" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {movement.movement_type}
                </span>
                <div>
                  <p className="font-semibold text-ink">{movement.concept}</p>
                  <p className="text-sm text-muted">{movement.movement_date} · {movement.person_name || "Sin persona"} · {movement.origin}</p>
                </div>
                <p className="font-semibold text-ink">{formatCurrency(movement.amount)}</p>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{movement.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin movimientos" detail="Los pagos y débitos generarán caja automáticamente." />
        )}
        <Pagination page={pagedMovements.page} totalPages={pagedMovements.totalPages} total={visibleMovements.length} onPage={pagedMovements.setPage} />
      </Panel>
    </div>
  );
}

function SettlementsView({
  settlements,
  onGenerate
}: {
  settlements: Settlement[];
  onGenerate: (period: string) => Promise<void>;
}) {
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const visible = settlements.filter((item) => {
    const matchesPeriod = !period || item.period === period;
    const matchesStatus = statusFilter === "todos" || item.status === statusFilter;
    return matchesPeriod && matchesStatus && (!query || includesText(item.owner_name, query));
  });
  const paged = usePaged(visible);

  async function generate() {
    setLoading(true);
    try {
      await onGenerate(period);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-3 sm:grid-cols-[150px_1fr_160px_auto]">
          <input className="input w-40" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar propietario" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="todos">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="emitida">Emitida</option>
          </select>
          <button className="btn-primary" onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Generar
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={exportUrl("/exports/settlements.csv")}>
            <ArrowDownToLine className="h-4 w-4" />
            Liquidación
          </a>
          <a className="btn-secondary" href={exportUrl(`/exports/accounting.csv?period=${period}`)}>
            <ArrowDownToLine className="h-4 w-4" />
            Contable
          </a>
          <a className="btn-secondary" href={exportUrl(`/exports/dgi-irpf.csv?period=${period}`)}>
            <ArrowDownToLine className="h-4 w-4" />
            DGI IRPF
          </a>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-panel">
        {visible.length ? (
          <div className="divide-y divide-slate-100">
            {paged.pageItems.map((item) => {
              const isExpanded = expanded[item.id] ?? false;
              return (
              <div key={item.id} className="space-y-3 p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_repeat(6,auto)] md:items-center">
                  <button className="flex items-center gap-2 text-left font-semibold text-ink" onClick={() => setExpanded({ ...expanded, [item.id]: !isExpanded })}>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {item.owner_name}
                  </button>
                  <MiniMoney label="Ingresos" value={item.income} />
                  <MiniMoney label="Gastos" value={item.expenses} />
                  <MiniMoney label="Comisión" value={item.commission} />
                  <MiniMoney label="IVA" value={item.iva} />
                  <MiniMoney label="IRPF" value={item.irpf} />
                  <MiniMoney label="A girar" value={item.total_to_transfer} strong />
                </div>
                {isExpanded && item.lines?.length ? (
                  <div className="overflow-hidden rounded-md border border-slate-100">
                    <div className="hidden grid-cols-[1fr_0.8fr_0.8fr_repeat(5,auto)] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted lg:grid">
                      <span>Finca</span>
                      <span>Concepto</span>
                      <span>Devengado</span>
                      <span>%</span>
                      <span>Ingreso</span>
                      <span>Gasto</span>
                      <span>Imp.</span>
                      <span>Neto</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {item.lines.map((line) => (
                        <div key={line.id} className="grid gap-2 px-3 py-2 text-sm lg:grid-cols-[1fr_0.8fr_0.8fr_repeat(5,auto)] lg:items-center">
                          <span className="font-medium text-ink">{line.property_reference || "Sin finca"}</span>
                          <span className="text-muted">{line.concept}{line.tenant_name ? ` · ${line.tenant_name}` : ""}</span>
                          <span className="text-muted">{line.accrual_period || line.period}</span>
                          <span className="text-muted">{line.owner_percentage}%</span>
                          <span className="font-medium text-ink">{formatCurrency(line.owner_amount)}</span>
                          <span className="font-medium text-rose-700">{formatCurrency(line.expense_amount)}</span>
                          <span className="text-muted">{formatCurrency(line.commission + line.iva + line.irpf)}</span>
                          <span className="font-semibold text-brand">{formatCurrency(line.net_amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState title="Sin liquidaciones generadas" detail="Elegí el periodo y generá la liquidación demo." />
          </div>
        )}
        <Pagination page={paged.page} totalPages={paged.totalPages} total={visible.length} onPage={paged.setPage} />
      </div>
    </div>
  );
}

function MiniMoney({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="min-w-28">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-sm ${strong ? "font-bold text-brand" : "font-semibold text-ink"}`}>{formatCurrency(value)}</p>
    </div>
  );
}

function ChargeModal({
  contracts,
  properties,
  charge,
  onRefreshData,
  onClose,
  onSaved
}: {
  contracts: ContractItem[];
  properties: PropertyItem[];
  charge?: Charge | null;
  onRefreshData: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [contractId, setContractId] = useState(String(charge?.contract_id ?? contracts[0]?.id ?? ""));
  const [concept, setConcept] = useState(charge?.concept ?? "UTE");
  const [amount, setAmount] = useState(charge ? String(charge.amount) : "");
  const [dueDate, setDueDate] = useState(charge?.due_date ?? todayIso());
  const [description, setDescription] = useState(charge?.description ?? "");
  const [period, setPeriod] = useState(charge?.period || currentPeriod());
  const [accrualPeriod, setAccrualPeriod] = useState(charge?.accrual_period || charge?.period || currentPeriod());
  const [settlementPeriod, setSettlementPeriod] = useState(charge?.settlement_period || charge?.period || currentPeriod());
  const [responsibleType, setResponsibleType] = useState(charge?.responsible_type ?? "tenant");
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [associationLoading, setAssociationLoading] = useState(false);
  const [scanResult, setScanResult] = useState<InvoiceScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [propertyIdForAccount, setPropertyIdForAccount] = useState(String(properties[0]?.id ?? ""));
  const selected = contracts.find((contract) => String(contract.id) === contractId);

  async function analyzeInvoice(file: File) {
    setScanLoading(true);
    setScanError("");
    try {
      const result = await api.analyzeInvoice(file);
      setScanResult(result);
      if (result.matched_contract_id) {
        setContractId(String(result.matched_contract_id));
      }
      if (result.matched_property_id) {
        setPropertyIdForAccount(String(result.matched_property_id));
      }
      if (result.concept) {
        setConcept(result.concept);
      }
      if (result.amount) {
        setAmount(String(result.amount));
      }
      if (result.due_date) {
        setDueDate(result.due_date);
      }
      setDescription(result.description || `Factura ${result.provider}`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "No se pudo analizar la factura");
    } finally {
      setScanLoading(false);
    }
  }

  async function associateDetectedAccount() {
    if (!scanResult?.account || !propertyIdForAccount) return;
    setAssociationLoading(true);
    setScanError("");
    try {
      const response = await api.associatePropertyAccount(Number(propertyIdForAccount), {
        provider: scanResult.concept,
        account: scanResult.account
      });
      await onRefreshData();
      if (response.matched_contract) {
        setContractId(String(response.matched_contract.id));
      }
      setScanResult({
        ...scanResult,
        matched_property_id: response.property.id,
        matched_property_reference: response.property.reference,
        matched_property_address: response.property.address,
        matched_contract_id: response.matched_contract?.id ?? null,
        matched_tenant_id: response.matched_contract?.tenant_id ?? null,
        matched_tenant_name: response.matched_contract?.tenant_name ?? "",
        matched_account: scanResult.account
      });
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "No se pudo asociar la cuenta");
    } finally {
      setAssociationLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setLoading(true);
    try {
      const payload = {
        contract_id: selected.id,
        responsible_person_id: selected.tenant_id,
        concept,
        description,
        amount: Number(amount),
        due_date: dueDate,
        period,
        accrual_period: accrualPeriod,
        settlement_period: settlementPeriod,
        responsible_type: responsibleType,
        origin: charge?.origin ?? (scanResult ? "importado" : "manual")
      };
      if (charge) {
        await api.updateCharge(charge.id, payload);
      } else {
        await api.createCharge(payload);
      }
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={charge ? "Editar deuda" : "Nueva deuda"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-teal-100 bg-teal-50/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand" />
                <p className="font-semibold text-ink">Carga rápida por factura</p>
              </div>
              <p className="mt-1 text-sm text-muted">Adjuntá foto o PDF, revisá y guardá la deuda.</p>
            </div>
            <label className="btn-secondary cursor-pointer justify-center">
              {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
              Adjuntar factura
              <input
                className="hidden"
                type="file"
                accept="image/*,.txt,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    analyzeInvoice(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {scanError && <p className="mt-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{scanError}</p>}
          {scanResult && (
            <div className="mt-3 grid gap-3 rounded-md border border-teal-100 bg-white p-3 text-sm md:grid-cols-4">
              <MiniStat label="Proveedor" value={scanResult.provider} />
              <MiniStat label="Confianza" value={`${scanResult.confidence}%`} />
              <MiniStat label="Cuenta" value={scanResult.account || "No detectada"} />
              <MiniStat
                label="Sugerencia"
                value={scanResult.matched_tenant_name || "Revisar contrato"}
              />
              {scanResult.warnings.length > 0 && (
                <p className="md:col-span-4 text-xs text-amber-700">
                  {scanResult.warnings.join(" ")}
                </p>
              )}
              {scanResult.account && !scanResult.matched_contract_id && (
                <div className="md:col-span-4 grid gap-2 border-t border-teal-100 pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <label className="form-label">Asociar cuenta detectada a propiedad</label>
                    <select className="input" value={propertyIdForAccount} onChange={(event) => setPropertyIdForAccount(event.target.value)}>
                      {properties.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.reference} · {property.address}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn-secondary justify-center" type="button" onClick={associateDetectedAccount} disabled={associationLoading || !propertyIdForAccount}>
                    {associationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                    Asociar cuenta
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="form-label">Contrato</label>
          <select className="input" value={contractId} onChange={(event) => setContractId(event.target.value)}>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.tenant_name} · {contract.property_reference}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Concepto</label>
            <select className="input" value={concept} onChange={(event) => setConcept(event.target.value)}>
              {concepts.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Monto</label>
            <input className="input" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </div>
        </div>
        <div>
          <label className="form-label">Vencimiento</label>
          <input className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Periodo deuda</label>
            <input className="input" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Devengado</label>
            <input className="input" type="month" value={accrualPeriod} onChange={(event) => setAccrualPeriod(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Liquidación</label>
            <input className="input" type="month" value={settlementPeriod} onChange={(event) => setSettlementPeriod(event.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Responsable</label>
          <select className="input" value={responsibleType} onChange={(event) => setResponsibleType(event.target.value)}>
            <option value="tenant">Inquilino</option>
            <option value="owner">Propietario</option>
            <option value="agency">Inmobiliaria</option>
          </select>
        </div>
        <div>
          <label className="form-label">Descripción</label>
          <textarea className="input min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ej: Factura UTE mayo, gasto común, tributos..." />
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : charge ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {charge ? "Actualizar deuda" : "Guardar deuda"}
        </button>
      </form>
    </Modal>
  );
}

function PaymentModal({ charge, onClose, onSaved }: { charge: Charge; onClose: () => void; onSaved: () => Promise<void> }) {
  const [amount, setAmount] = useState(String(charge.remaining_amount));
  const [method, setMethod] = useState("transferencia");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await api.createPayment({
        person_id: charge.responsible_person_id,
        amount: Number(amount),
        payment_date: paymentDate,
        method,
        reference,
        notes: "",
        allocations: [{ charge_id: charge.id, amount: Number(amount) }]
      });
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Registrar pago" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3">
          <p className="font-semibold text-ink">{charge.tenant_name}</p>
          <p className="text-sm text-muted">{charge.concept} · saldo {formatCurrency(charge.remaining_amount)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Monto</label>
            <input className="input" type="number" min="1" max={charge.remaining_amount} value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </div>
          <div>
            <label className="form-label">Fecha</label>
            <input className="input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Método</label>
            <select className="input" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="redpagos">Redpagos</option>
              <option value="ANDA">ANDA</option>
            </select>
          </div>
          <div>
            <label className="form-label">Referencia</label>
            <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="BROU, comprobante, nota" />
          </div>
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
          Imputar pago
        </button>
      </form>
    </Modal>
  );
}

function BatchPaymentModal({
  person,
  charges,
  onClose,
  onSaved
}: {
  person: Person;
  charges: Charge[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [allocations, setAllocations] = useState<Record<number, string>>(
    () => Object.fromEntries(charges.map((charge) => [charge.id, String(charge.remaining_amount)])) as Record<number, string>
  );
  const [method, setMethod] = useState("transferencia");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const total = charges.reduce((sum, charge) => sum + Number(allocations[charge.id] || 0), 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const applied = charges
      .map((charge) => ({ charge_id: charge.id, amount: Number(allocations[charge.id] || 0) }))
      .filter((item) => item.amount > 0);
    if (!applied.length) return;
    setLoading(true);
    try {
      await api.createPayment({
        person_id: person.id,
        amount: total,
        payment_date: paymentDate,
        method,
        reference,
        notes: "Pago agrupado desde panel operativo",
        allocations: applied
      });
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Registrar pago agrupado" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3">
          <p className="font-semibold text-ink">{person.full_name}</p>
          <p className="text-sm text-muted">{charges.length} deudas abiertas · total a imputar {formatCurrency(total)}</p>
        </div>
        <div className="space-y-2">
          {charges.map((charge) => (
            <div key={charge.id} className="grid gap-2 rounded-md border border-slate-100 p-3 sm:grid-cols-[1fr_9rem] sm:items-center">
              <div>
                <p className="font-medium text-ink">{charge.concept}</p>
                <p className="text-sm text-muted">{charge.description || charge.property_reference} · saldo {formatCurrency(charge.remaining_amount)}</p>
              </div>
              <input
                className="input"
                type="number"
                min="0"
                max={charge.remaining_amount}
                value={allocations[charge.id] ?? ""}
                onChange={(event) => setAllocations((current) => ({ ...current, [charge.id]: event.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Fecha</label>
            <input className="input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Método</label>
            <select className="input" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="redpagos">Redpagos</option>
              <option value="ANDA">ANDA</option>
            </select>
          </div>
          <div>
            <label className="form-label">Referencia</label>
            <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Comprobante" />
          </div>
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading || total <= 0}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
          Imputar {formatCurrency(total)}
        </button>
      </form>
    </Modal>
  );
}

function ReminderModal({ charges, onClose }: { charges: Charge[]; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const chargeIds = useMemo(() => charges.map((charge) => charge.id), [charges]);
  const firstCharge = charges[0];

  useEffect(() => {
    api
      .previewReminder({ charge_ids: chargeIds, channel: "whatsapp" })
      .then((response) => {
        setMessage(response.message);
        setWhatsapp(response.whatsapp_url);
      })
      .finally(() => setLoading(false));
  }, [chargeIds]);

  async function simulate() {
    const response = await api.simulateReminder({ charge_ids: chargeIds, channel: "whatsapp" });
    setMessage(response.message);
    setWhatsapp(response.whatsapp_url);
    setSent(true);
  }

  return (
    <Modal title="Recordatorio" onClose={onClose}>
      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-slate-50 p-3">
            <p className="font-semibold text-ink">{firstCharge?.tenant_name}</p>
            <p className="text-sm text-muted">{charges.length} deuda(s) incluidas</p>
          </div>
          <textarea className="input min-h-48" value={message} onChange={(event) => setMessage(event.target.value)} />
          {sent && <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">Envío simulado registrado.</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn-secondary flex-1 justify-center" onClick={() => navigator.clipboard.writeText(message)}>
              <Copy className="h-4 w-4" />
              Copiar
            </button>
            <a className="btn-secondary flex-1 justify-center" href={whatsapp} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" />
              Abrir WhatsApp
            </a>
            <button className="btn-primary flex-1 justify-center" onClick={simulate}>
              <Send className="h-4 w-4" />
              Simular envío
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LinkModal({
  charges,
  publicLink,
  setPublicLink,
  onClose
}: {
  charges: Charge[];
  publicLink: string;
  setPublicLink: (value: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const firstCharge = charges[0];
  const total = charges.reduce((sum, charge) => sum + charge.remaining_amount, 0);

  async function create() {
    if (!firstCharge) return;
    setLoading(true);
    try {
      const response = await api.createPublicLink({
        person_id: firstCharge.responsible_person_id,
        charge_ids: charges.map((charge) => charge.id),
        days_valid: 14
      });
      setPublicLink(response.url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Link público" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3">
          <p className="font-semibold text-ink">{firstCharge?.tenant_name}</p>
          <p className="text-sm text-muted">{charges.length} deuda(s) · {formatCurrency(total)}</p>
        </div>
        {!publicLink ? (
          <button className="btn-primary w-full justify-center" onClick={create} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
            Generar link
          </button>
        ) : (
          <div className="space-y-3">
            <input className="input" readOnly value={publicLink} />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1 justify-center" onClick={() => navigator.clipboard.writeText(publicLink)}>
                <Copy className="h-4 w-4" />
                Copiar
              </button>
              <a className="btn-primary flex-1 justify-center" href={publicLink} target="_blank" rel="noreferrer">
                <LinkIcon className="h-4 w-4" />
                Abrir
              </a>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PersonModal({
  person,
  defaultType,
  onClose,
  onSaved
}: {
  person: Person | null;
  defaultType?: Person["person_type"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(person?.full_name ?? "");
  const [legacyCode, setLegacyCode] = useState(person?.legacy_code ?? "");
  const [document, setDocument] = useState(person?.document ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [mobile, setMobile] = useState(person?.mobile ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [address, setAddress] = useState(person?.address ?? "");
  const [personType, setPersonType] = useState<Person["person_type"]>(person?.person_type ?? defaultType ?? "tenant");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = {
        full_name: fullName,
        legacy_code: legacyCode,
        document,
        phone,
        mobile,
        email,
        address,
        person_type: personType
      };
      if (person) {
        await api.updatePerson(person.id, payload);
      } else {
        await api.createPerson(payload);
      }
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={person ? "Editar persona" : "Nueva persona"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label">Nombre</label>
          <input className="input" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Código Abaco</label>
            <input className="input" value={legacyCode} onChange={(event) => setLegacyCode(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Cédula/RUT</label>
            <input className="input" value={document} onChange={(event) => setDocument(event.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Tipo</label>
          <select className="input" value={personType} onChange={(event) => setPersonType(event.target.value as Person["person_type"])}>
            <option value="tenant">Inquilino</option>
            <option value="owner">Propietario</option>
            <option value="both">Ambos</option>
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Celular</label>
            <input className="input" value={mobile} onChange={(event) => setMobile(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Teléfono</label>
            <input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Email</label>
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div>
          <label className="form-label">Dirección</label>
          <input className="input" value={address} onChange={(event) => setAddress(event.target.value)} />
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : person ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {person ? "Actualizar persona" : "Guardar persona"}
        </button>
      </form>
    </Modal>
  );
}

function PropertyModal({
  property,
  owners,
  onClose,
  onSaved
}: {
  property: PropertyItem | null;
  owners: Person[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reference, setReference] = useState(property?.reference ?? "");
  const [legacyCode, setLegacyCode] = useState(property?.legacy_code ?? "");
  const [address, setAddress] = useState(property?.address ?? "");
  const [padron, setPadron] = useState(property?.padron ?? "");
  const [occupancyStatus, setOccupancyStatus] = useState(property?.occupancy_status ?? "alquilada");
  const [propertyType, setPropertyType] = useState(property?.property_type ?? "");
  const [destination, setDestination] = useState(property?.destination ?? "");
  const [uteAccount, setUteAccount] = useState(property?.ute_account ?? "");
  const [oseAccount, setOseAccount] = useState(property?.ose_account ?? "");
  const [taxesAccount, setTaxesAccount] = useState(property?.taxes_account ?? "");
  const [sanitationAccount, setSanitationAccount] = useState(property?.sanitation_account ?? "");
  const [notes, setNotes] = useState(property?.notes ?? "");
  const [ownerId, setOwnerId] = useState(String(property?.owners[0]?.id ?? owners[0]?.id ?? ""));
  const [ownerPercentage, setOwnerPercentage] = useState(String(property?.owners[0]?.percentage ?? 100));
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = {
        legacy_code: legacyCode,
        reference,
        address,
        padron,
        occupancy_status: occupancyStatus,
        property_type: propertyType,
        destination,
        ute_account: uteAccount,
        ose_account: oseAccount,
        taxes_account: taxesAccount,
        sanitation_account: sanitationAccount,
        notes,
        owner_id: ownerId ? Number(ownerId) : null,
        owner_percentage: Number(ownerPercentage || 100)
      };
      if (property) {
        await api.updateProperty(property.id, payload);
      } else {
        await api.createProperty(payload);
      }
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={property ? "Editar propiedad" : "Nueva propiedad"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Referencia</label>
            <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} required />
          </div>
          <div>
            <label className="form-label">Código Abaco</label>
            <input className="input" value={legacyCode} onChange={(event) => setLegacyCode(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Padrón</label>
            <input className="input" value={padron} onChange={(event) => setPadron(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Estado</label>
            <select className="input" value={occupancyStatus} onChange={(event) => setOccupancyStatus(event.target.value)}>
              <option value="alquilada">Alquilada</option>
              <option value="desocupada">Desocupada</option>
              <option value="reservada">Reservada</option>
              <option value="inactiva">Inactiva</option>
            </select>
          </div>
          <div>
            <label className="form-label">Destino</label>
            <input className="input" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="vivienda, local..." />
          </div>
        </div>
        <div>
          <label className="form-label">Tipo</label>
          <input className="input" value={propertyType} onChange={(event) => setPropertyType(event.target.value)} placeholder="apartamento, casa, local comercial" />
        </div>
        <div>
          <label className="form-label">Dirección</label>
          <input className="input" value={address} onChange={(event) => setAddress(event.target.value)} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Cuenta UTE</label>
            <input className="input" value={uteAccount} onChange={(event) => setUteAccount(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Cuenta OSE</label>
            <input className="input" value={oseAccount} onChange={(event) => setOseAccount(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Tributos</label>
            <input className="input" value={taxesAccount} onChange={(event) => setTaxesAccount(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Saneamiento</label>
            <input className="input" value={sanitationAccount} onChange={(event) => setSanitationAccount(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div>
            <label className="form-label">Propietario</label>
            <select className="input" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Sin propietario</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">%</label>
            <input className="input" type="number" min="1" max="100" value={ownerPercentage} onChange={(event) => setOwnerPercentage(event.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Notas</label>
          <textarea className="input min-h-20" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : property ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {property ? "Actualizar propiedad" : "Guardar propiedad"}
        </button>
      </form>
    </Modal>
  );
}

function ContractModal({
  contract,
  properties,
  tenants,
  onClose,
  onSaved
}: {
  contract: ContractItem | null;
  properties: PropertyItem[];
  tenants: Person[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [propertyId, setPropertyId] = useState(String(contract?.property_id ?? properties[0]?.id ?? ""));
  const [tenantId, setTenantId] = useState(String(contract?.tenant_id ?? tenants[0]?.id ?? ""));
  const [legacyCode, setLegacyCode] = useState(contract?.legacy_code ?? "");
  const [startDate, setStartDate] = useState(contract?.start_date ?? todayIso());
  const [endDate, setEndDate] = useState(contract?.end_date ?? "");
  const [rentAmount, setRentAmount] = useState(String(contract?.rent_amount ?? ""));
  const [paymentType, setPaymentType] = useState(contract?.payment_type ?? "adelantado");
  const [commissionPercent, setCommissionPercent] = useState(String(contract?.commission_percent ?? 8));
  const [irpfApplies, setIrpfApplies] = useState(contract?.irpf_applies ?? true);
  const [irpfPercent, setIrpfPercent] = useState(String(contract?.irpf_percent ?? 10.5));
  const [paymentOrigin, setPaymentOrigin] = useState(contract?.payment_origin ?? "normal");
  const [rentPaymentTiming, setRentPaymentTiming] = useState(contract?.rent_payment_timing ?? "adelantado");
  const [guaranteeType, setGuaranteeType] = useState(contract?.guarantee_type ?? "sin_garantia");
  const [guaranteeProvider, setGuaranteeProvider] = useState(contract?.guarantee_provider ?? "");
  const [guaranteePercent, setGuaranteePercent] = useState(String(contract?.guarantee_percent ?? 0));
  const [rentRegime, setRentRegime] = useState(contract?.rent_regime ?? "libre_contratacion");
  const [reajustmentIndex, setReajustmentIndex] = useState(contract?.reajustment_index ?? "libre");
  const [nextReajustmentDate, setNextReajustmentDate] = useState(contract?.next_reajustment_date ?? "");
  const [active, setActive] = useState(contract?.active ?? true);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!propertyId || !tenantId) return;
    setLoading(true);
    try {
      const payload = {
        property_id: Number(propertyId),
        tenant_id: Number(tenantId),
        legacy_code: legacyCode,
        start_date: startDate,
        end_date: endDate || null,
        rent_amount: Number(rentAmount),
        payment_type: paymentType,
        rent_payment_timing: rentPaymentTiming,
        guarantee_type: guaranteeType,
        guarantee_provider: guaranteeProvider,
        guarantee_percent: Number(guaranteePercent),
        rent_regime: rentRegime,
        reajustment_index: reajustmentIndex,
        next_reajustment_date: nextReajustmentDate || null,
        commission_percent: Number(commissionPercent),
        irpf_applies: irpfApplies,
        irpf_percent: Number(irpfPercent),
        payment_origin: paymentOrigin,
        active
      };
      if (contract) {
        await api.updateContract(contract.id, payload);
      } else {
        await api.createContract(payload);
      }
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={contract ? "Editar contrato" : "Nuevo contrato"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Código contrato</label>
            <input className="input" value={legacyCode} onChange={(event) => setLegacyCode(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Momento alquiler</label>
            <select className="input" value={rentPaymentTiming} onChange={(event) => setRentPaymentTiming(event.target.value)}>
              <option value="adelantado">Adelantado</option>
              <option value="vencido">Vencido</option>
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Propiedad</label>
            <select className="input" value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.reference} · {property.address}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Inquilino</label>
            <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)} required>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Inicio</label>
            <input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Fin</label>
            <input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Alquiler</label>
            <input className="input" type="number" min="1" value={rentAmount} onChange={(event) => setRentAmount(event.target.value)} required />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Tipo pago</label>
            <select className="input" value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
              <option value="adelantado">Adelantado</option>
              <option value="vencido">Vencido</option>
            </select>
          </div>
          <div>
            <label className="form-label">Garantía</label>
            <select className="input" value={guaranteeType} onChange={(event) => {
              const value = event.target.value;
              setGuaranteeType(value);
              if (value === "anda") {
                setGuaranteePercent("2");
                setPaymentOrigin("ANDA");
              } else if (value === "contaduria") {
                setGuaranteePercent("3");
                setPaymentOrigin("Contaduria");
              }
            }}>
              <option value="sin_garantia">Sin garantía</option>
              <option value="anda">ANDA</option>
              <option value="contaduria">Contaduría</option>
              <option value="aseguradora">Aseguradora privada</option>
              <option value="otro">Otra</option>
            </select>
          </div>
          <div>
            <label className="form-label">Proveedor garantía</label>
            <input className="input" value={guaranteeProvider} onChange={(event) => setGuaranteeProvider(event.target.value)} placeholder="Mapfre, Porto, Sura..." />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Garantía %</label>
            <input className="input" type="number" step="0.1" value={guaranteePercent} onChange={(event) => setGuaranteePercent(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Régimen alquiler</label>
            <select className="input" value={rentRegime} onChange={(event) => {
              const value = event.target.value;
              setRentRegime(value);
              setReajustmentIndex(value === "regimen_legal" ? "indice_reajuste_alquileres" : "libre");
            }}>
              <option value="libre_contratacion">Libre contratación</option>
              <option value="regimen_legal">Régimen legal</option>
            </select>
          </div>
          <div>
            <label className="form-label">Próximo reajuste</label>
            <input className="input" type="date" value={nextReajustmentDate} onChange={(event) => setNextReajustmentDate(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="form-label">Índice reajuste</label>
            <select className="input" value={reajustmentIndex} onChange={(event) => setReajustmentIndex(event.target.value)}>
              <option value="libre">Libre / manual</option>
              <option value="indice_reajuste_alquileres">Índice reajuste alquileres</option>
            </select>
          </div>
          <div>
            <label className="form-label">Comisión %</label>
            <input className="input" type="number" step="0.1" value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Origen</label>
            <select className="input" value={paymentOrigin} onChange={(event) => setPaymentOrigin(event.target.value)}>
              <option value="normal">Normal</option>
              <option value="ANDA">ANDA</option>
              <option value="Contaduria">Contaduría</option>
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={irpfApplies} onChange={(event) => setIrpfApplies(event.target.checked)} />
            Aplica IRPF
          </label>
          <div>
            <label className="form-label">IRPF %</label>
            <input className="input" type="number" step="0.1" value={irpfPercent} onChange={(event) => setIrpfPercent(event.target.value)} disabled={!irpfApplies} />
          </div>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Contrato activo
        </label>
        <button className="btn-primary w-full justify-center" disabled={loading || !propertyId || !tenantId}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : contract ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {contract ? "Actualizar contrato" : "Guardar contrato"}
        </button>
      </form>
    </Modal>
  );
}

function TenantDetailModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [credits, setCredits] = useState<TenantCredit[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDetail() {
    setLoading(true);
    try {
      const [detailData, creditsData, auditData] = await Promise.all([
        api.personDetail(person.id),
        api.tenantCredits({ person_id: String(person.id) }),
        api.auditLog({ entity_type: "payment" })
      ]);
      setDetail(detailData);
      setCredits(creditsData);
      setAudit(auditData);
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo cargar la ficha");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [person.id]);

  async function voidPayment(paymentId: number) {
    const reason = window.prompt("Motivo de anulación", "Error de carga");
    if (!reason) return;
    await api.voidPayment(paymentId, reason);
    await loadDetail();
  }

  return (
    <Modal title="Ficha de inquilino" onClose={onClose}>
      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      ) : error ? (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      ) : detail ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Contacto" value={detail.person.mobile || detail.person.email || "Sin dato"} />
            <MiniStat label="Deuda total" value={formatCurrency(detail.person.total_debt)} />
            <MiniStat label="Abiertas" value={String(detail.person.open_charges)} />
          </div>
          <Panel title="Deudas">
            <div className="divide-y divide-slate-100">
              {detail.charges.slice(0, 8).map((charge) => (
                <div key={charge.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-ink">{charge.concept}</p>
                    <p className="text-muted">{charge.due_date} · {charge.description}</p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={charge.status} />
                    <p className="mt-1 font-semibold text-ink">{formatCurrency(charge.remaining_amount)}</p>
                  </div>
                </div>
              ))}
              {!detail.charges.length && <p className="text-sm text-muted">Sin deudas.</p>}
            </div>
          </Panel>
          <Panel title="Pagos">
            <div className="divide-y divide-slate-100">
              {detail.payments.slice(0, 8).map((payment) => (
                <div key={payment.id} className="grid gap-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <p className="text-muted">{payment.payment_date} · {payment.method} · {payment.reference || "sin referencia"} · {payment.status || "confirmado"}</p>
                  <p className="font-semibold text-emerald-700">{formatCurrency(payment.amount)}</p>
                  <button className="icon-action" title="Anular pago" onClick={() => voidPayment(payment.id)} disabled={payment.status === "anulado"}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {!detail.payments.length && <p className="text-sm text-muted">Sin pagos registrados.</p>}
            </div>
          </Panel>
          <Panel title="Saldos a favor">
            <div className="divide-y divide-slate-100">
              {credits.map((credit) => (
                <div key={credit.id} className="flex justify-between py-2 text-sm">
                  <span className="text-muted">{credit.status} · {credit.notes}</span>
                  <span className="font-semibold text-emerald-700">{formatCurrency(credit.remaining_amount)}</span>
                </div>
              ))}
              {!credits.length && <p className="text-sm text-muted">Sin saldo a favor.</p>}
            </div>
          </Panel>
          <Panel title="Auditoría">
            <div className="space-y-2">
              {audit.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 p-2 text-sm">
                  <p className="font-semibold text-ink">{item.action}</p>
                  <p className="text-muted">{item.created_at} · {item.description}</p>
                </div>
              ))}
              {!audit.length && <p className="text-sm text-muted">Sin auditoría registrada.</p>}
            </div>
          </Panel>
          <Panel title="Recordatorios">
            <div className="space-y-2">
              {detail.reminders.slice(0, 4).map((reminder) => (
                <div key={reminder.id} className="rounded-md bg-slate-50 p-3 text-sm">
                  <p className="font-semibold text-ink">{reminder.channel} · {reminder.status}</p>
                  <p className="mt-1 line-clamp-2 text-muted">{reminder.message}</p>
                </div>
              ))}
              {!detail.reminders.length && <p className="text-sm text-muted">Sin recordatorios.</p>}
            </div>
          </Panel>
        </div>
      ) : null}
    </Modal>
  );
}

function PropertyDetailModal({ property, onClose }: { property: PropertyItem; onClose: () => void }) {
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceType, setServiceType] = useState("UTE");
  const [provider, setProvider] = useState("UTE");
  const [accountNumber, setAccountNumber] = useState("");
  const [payer, setPayer] = useState("tenant");
  const [serviceNotes, setServiceNotes] = useState("");

  async function loadDetail() {
    setLoading(true);
    try {
      const [detailData, auditData] = await Promise.all([
        api.propertyDetail(property.id),
        api.auditLog({ entity_type: "property_service" })
      ]);
      setDetail(detailData);
      setAudit(auditData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [property.id]);

  async function addService(event: FormEvent) {
    event.preventDefault();
    if (!accountNumber) return;
    await api.createPropertyService(property.id, {
      service_type: serviceType,
      provider: provider || serviceType,
      account_number: accountNumber,
      payer,
      active: true,
      notes: serviceNotes
    });
    setAccountNumber("");
    setServiceNotes("");
    await loadDetail();
  }

  async function removeService(serviceId: number) {
    if (!window.confirm("Eliminar esta cuenta de servicio?")) return;
    await api.deletePropertyService(property.id, serviceId);
    await loadDetail();
  }

  async function uploadFile(file: File) {
    await api.uploadAttachment("property", property.id, file);
    await loadDetail();
  }

  return (
    <Modal title="Ficha de finca" onClose={onClose}>
      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      ) : detail ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Referencia" value={detail.property.reference} />
            <MiniStat label="Estado" value={detail.property.occupancy_status} />
            <MiniStat label="Padrón" value={detail.property.padron || "Sin dato"} />
          </div>
          <Panel title="Propietarios">
            <div className="divide-y divide-slate-100">
              {detail.property.owners.map((owner) => (
                <div key={owner.id} className="flex justify-between py-2 text-sm">
                  <span className="font-medium text-ink">{owner.full_name}</span>
                  <span className="text-muted">{owner.percentage}% · IRPF {owner.irpf_applies === false ? "no" : "sí"}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Cuentas de servicios">
            <div className="mb-3 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
              Para asociar facturas automaticas, cargá acá la cuenta o referencia que aparece en el correo. Para gastos comunes usá la referencia de pago, por ejemplo 000113000271.
            </div>
            <form onSubmit={addService} className="mb-3 grid gap-2 lg:grid-cols-[1fr_1fr_1.4fr_1fr_1fr_auto]">
              <select className="input" value={serviceType} onChange={(event) => {
                setServiceType(event.target.value);
                setProvider(event.target.value === "GASTOS_COMUNES" ? "Administración" : event.target.value);
              }}>
                <option value="UTE">UTE</option>
                <option value="OSE">OSE</option>
                <option value="GASTOS_COMUNES">Gastos comunes</option>
                <option value="TRIBUTOS">Tributos</option>
                <option value="SANEAMIENTO">Saneamiento</option>
                <option value="PRIMARIA">Primaria</option>
              </select>
              <input className="input" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Proveedor" />
              <input className="input" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} placeholder="Cuenta o referencia" />
              <select className="input" value={payer} onChange={(event) => setPayer(event.target.value)}>
                <option value="tenant">Inquilino</option>
                <option value="owner">Propietario</option>
                <option value="agency">Inmobiliaria</option>
              </select>
              <input className="input" value={serviceNotes} onChange={(event) => setServiceNotes(event.target.value)} placeholder="Notas/unidad" />
              <button className="btn-secondary justify-center">
                <Plus className="h-4 w-4" />
                Agregar
              </button>
            </form>
            <div className="divide-y divide-slate-100">
              {detail.services.map((service) => (
                <div key={service.id} className="grid gap-2 py-2 text-sm md:grid-cols-[1fr_1fr_1.4fr_1fr_auto_auto] md:items-center">
                  <span className="font-medium text-ink">{service.service_type}</span>
                  <span className="text-muted">{service.provider || "-"}</span>
                  <span className="text-muted">{service.account_number}</span>
                  <span className="text-muted">{service.payer === "tenant" ? "Inquilino" : service.payer === "owner" ? "Propietario" : "Inmobiliaria"}</span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${service.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{service.active ? "Activo" : "Inactivo"}</span>
                  <button className="icon-action" title="Eliminar cuenta" onClick={() => removeService(service.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {!detail.services.length && <p className="py-2 text-sm text-muted">Sin cuentas de servicio cargadas.</p>}
            </div>
          </Panel>
          <Panel title="Contratos y deuda">
            <div className="space-y-2">
              <p className="text-sm text-muted">{detail.contracts.length} contrato(s) · {detail.charges.length} deuda(s)</p>
              {detail.charges.slice(0, 6).map((charge) => (
                <div key={charge.id} className="flex justify-between rounded-md bg-slate-50 p-2 text-sm">
                  <span>{charge.tenant_name} · {charge.concept} · {charge.period}</span>
                  <span className="font-semibold">{formatCurrency(charge.remaining_amount)}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Comprobantes y documentos">
            <label className="btn-secondary mb-3 cursor-pointer">
              <FileImage className="h-4 w-4" />
              Adjuntar archivo
              <input
                className="hidden"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <div className="divide-y divide-slate-100">
              {detail.attachments.map((attachment) => (
                <div key={attachment.id} className="flex justify-between py-2 text-sm">
                  <span className="font-medium text-ink">{attachment.filename}</span>
                  <span className="text-muted">{attachment.uploaded_at}</span>
                </div>
              ))}
              {!detail.attachments.length && <p className="text-sm text-muted">Sin adjuntos.</p>}
            </div>
          </Panel>
          <Panel title="Auditoría">
            <div className="space-y-2">
              {audit.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 p-2 text-sm">
                  <p className="font-semibold text-ink">{item.action}</p>
                  <p className="text-muted">{item.created_at} · {item.description}</p>
                </div>
              ))}
              {!audit.length && <p className="text-sm text-muted">Sin auditoría registrada.</p>}
            </div>
          </Panel>
        </div>
      ) : null}
    </Modal>
  );
}

function AdvancePaymentModal({
  person,
  contracts,
  onClose,
  onSaved
}: {
  person: Person;
  contracts: ContractItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [contractId, setContractId] = useState(String(contracts[0]?.id ?? ""));
  const [monthsText, setMonthsText] = useState(currentPeriod());
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [method, setMethod] = useState("transferencia");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const months = monthsText.split(",").map((item) => item.trim()).filter(Boolean);
  const selectedContract = contracts.find((contract) => String(contract.id) === contractId);
  const estimatedTotal = (selectedContract?.rent_amount ?? 0) * months.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!contractId || !months.length) return;
    setError("");
    setLoading(true);
    try {
      await api.createAdvanceRentPayment({
        contract_id: Number(contractId),
        months,
        payment_date: paymentDate,
        method,
        reference,
        notes: `Pago de alquileres: ${months.join(", ")}`,
        due_day: 10
      });
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo registrar el pago adelantado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Pago de alquileres adelantados" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3">
          <p className="font-semibold text-ink">{person.full_name}</p>
          <p className="text-sm text-muted">Crea los alquileres faltantes, los marca pagados y registra una sola entrada de caja.</p>
        </div>
        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div>
          <label className="form-label">Contrato</label>
          <select className="input" value={contractId} onChange={(event) => setContractId(event.target.value)} required>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>{contract.property_reference} · {formatCurrency(contract.rent_amount)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Meses a pagar</label>
          <input className="input" value={monthsText} onChange={(event) => setMonthsText(event.target.value)} placeholder="2026-05, 2026-06" />
          <p className="mt-1 text-xs text-muted">Formato: AAAA-MM separado por comas. Ejemplo: 2026-05, 2026-06.</p>
        </div>
        <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Se van a pagar {months.length} mes(es) por un total estimado de {formatCurrency(estimatedTotal)}.
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          <select className="input" value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="redpagos">Redpagos</option>
            <option value="ANDA">ANDA</option>
          </select>
          <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Referencia" />
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading || !contracts.length}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
          Registrar pago adelantado
        </button>
      </form>
    </Modal>
  );
}

function FreePaymentModal({
  person,
  onClose,
  onSaved
}: {
  person: Person;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [method, setMethod] = useState("transferencia");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("Pago recibido sin deuda imputada");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    setLoading(true);
    setError("");
    try {
      await api.createPayment({
        person_id: person.id,
        amount: Number(amount),
        payment_date: paymentDate,
        method,
        reference,
        notes,
        allocations: []
      });
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo registrar el pago");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Nuevo pago" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3">
          <p className="font-semibold text-ink">{person.full_name}</p>
          <p className="text-sm text-muted">Si no se imputa a una deuda, queda como saldo a favor y entra en caja.</p>
        </div>
        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Monto</label>
            <input className="input" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </div>
          <div>
            <label className="form-label">Fecha</label>
            <input className="input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Método</label>
            <select className="input" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="redpagos">Redpagos</option>
              <option value="ANDA">ANDA</option>
            </select>
          </div>
          <div>
            <label className="form-label">Referencia</label>
            <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Comprobante" />
          </div>
        </div>
        <div>
          <label className="form-label">Notas</label>
          <textarea className="input min-h-20" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <button className="btn-primary w-full justify-center" disabled={loading || Number(amount) <= 0}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
          Registrar pago
        </button>
      </form>
    </Modal>
  );
}

function OwnerChargeModal({
  owners,
  properties,
  onClose,
  onSaved
}: {
  owners: Person[];
  properties: PropertyItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [ownerId, setOwnerId] = useState(String(owners[0]?.id ?? ""));
  const [propertyId, setPropertyId] = useState(String(properties[0]?.id ?? ""));
  const [concept, setConcept] = useState("CONTRIBUCION");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [chargeDate, setChargeDate] = useState(todayIso());
  const [period, setPeriod] = useState(currentPeriod());
  const [paidByAgency, setPaidByAgency] = useState(true);
  const [generatesCommission, setGeneratesCommission] = useState(false);
  const [splitByOwnership, setSplitByOwnership] = useState(false);
  const [commissionPercent, setCommissionPercent] = useState("3");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ownerId || !propertyId) return;
    setLoading(true);
    try {
      await api.createOwnerCharge({
        owner_id: Number(ownerId),
        property_id: Number(propertyId),
        concept,
        description,
        amount: Number(amount),
        charge_date: chargeDate,
        period,
        paid_by_agency: paidByAgency,
        generates_commission: generatesCommission,
        commission_percent: Number(commissionPercent || 0),
        split_by_ownership: splitByOwnership
      });
      await onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Nuevo débito a propietario" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Propietario</label>
            <select className="input" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} required>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Finca / Propiedad</label>
            <select className="input" value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>{property.reference} · {property.address}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Concepto</label>
            <select className="input" value={concept} onChange={(event) => setConcept(event.target.value)}>
              <option value="CONTRIBUCION">Contribución</option>
              <option value="PRIMARIA">Primaria</option>
              <option value="SANEAMIENTO">Saneamiento</option>
              <option value="OSE">OSE</option>
              <option value="UTE">UTE</option>
              <option value="OTROS">Otros</option>
            </select>
          </div>
          <div>
            <label className="form-label">Monto</label>
            <input className="input" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Fecha</label>
            <input className="input" type="date" value={chargeDate} onChange={(event) => setChargeDate(event.target.value)} />
          </div>
          <div>
            <label className="form-label">Periodo liquidación</label>
            <input className="input" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </div>
        </div>
        <textarea className="input min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Detalle del gasto o comprobante" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={paidByAgency} onChange={(event) => setPaidByAgency(event.target.checked)} />
            Genera salida de caja
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={generatesCommission} onChange={(event) => setGeneratesCommission(event.target.checked)} />
            Cobra comisión
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm font-semibold text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={splitByOwnership} onChange={(event) => setSplitByOwnership(event.target.checked)} />
            Repartir entre propietarios según porcentaje
          </label>
        </div>
        {generatesCommission && (
          <div>
            <label className="form-label">Comisión %</label>
            <input className="input" type="number" step="0.1" value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} />
          </div>
        )}
        <button className="btn-primary w-full justify-center" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Guardar débito y caja
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default App;

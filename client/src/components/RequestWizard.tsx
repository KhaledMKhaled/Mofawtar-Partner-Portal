import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Modal } from "./Modal";
import { Field } from "./Field";
import { Search, AlertTriangle, ArrowRight, ArrowLeft, Download } from "lucide-react";
import { toPng } from "html-to-image";
import { useCurrentUser } from "../hooks/useAuth";
import { OPERATION_TYPES, type OperationType } from "../../../shared/requests";

interface Customer {
  id: number;
  taxCardNumber: string;
  name: string;
  nameOnTaxCard: string | null;
  commercialRegistry: string | null;
  nationalId: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  primaryPhone: string | null;
  primaryPhoneWhatsapp: boolean;
  altPhone: string | null;
  altPhoneWhatsapp: boolean;
  email: string | null;
  address: string | null;
  taxOffice: string | null;
  businessActivity: string | null;
  notes: string | null;
}
interface LookupResp {
  found: boolean;
  customer?: Customer;
  currentOwner?: { partnerId: number | null; status: string; endDate: string } | null;
  activeRequests?: { id: number; srNumber: string; partnerName: string; status: string }[];
  canCreate?: boolean;
  blockReason?: string | null;
}
interface Pkg {
  id: number;
  name: string;
  description?: string | null;
  finalPriceAfterTax: string;
  itemPriceBeforeTax: string;
  taxPct: string;
  active: boolean;
  availableForAll: boolean;
}
interface DraftResp {
  customer: Customer;
  request: { id: number; srNumber: string };
}

const blankCustomer: Customer = {
  id: 0,
  taxCardNumber: "",
  name: "",
  nameOnTaxCard: "",
  commercialRegistry: "",
  nationalId: "",
  contactPerson: "",
  contactPhone: "",
  primaryPhone: "",
  primaryPhoneWhatsapp: false,
  altPhone: "",
  altPhoneWhatsapp: false,
  email: "",
  address: "",
  taxOffice: "",
  businessActivity: "",
  notes: "",
};

export interface WizardInitialDraft {
  requestId: number;
  srNumber: string;
  taxCardNumber: string;
  customerName: string;
  partnerId: number | null;
  salesUserId?: number | null;
  salesUserName?: string | null;
}

export function RequestWizard({
  open,
  onClose,
  initialDraft,
}: {
  open: boolean;
  onClose: () => void;
  initialDraft?: WizardInitialDraft;
}) {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const isCompany = user?.roleKey === "company_super_admin" || user?.roleKey === "company_accountant";

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const receiptElRef = useRef<HTMLDivElement | null>(null);
  const [tax, setTax] = useState("");
  const [lookup, setLookup] = useState<LookupResp | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer>(blankCustomer);
  const [wizardPartnerId, setWizardPartnerId] = useState<number | null>(null);
  const [salesUserId, setSalesUserId] = useState<number | null>(null);
  const [salesUserName, setSalesUserName] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResp | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [operationType, setOperationType] = useState<OperationType | "">("");
  const [realReceiptNumber, setRealReceiptNumber] = useState("");
  const [collectionConfirmed, setCollectionConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minStep: 1 | 3 = initialDraft ? 3 : 1;

  const reset = () => {
    if (initialDraft) {
      setStep(3);
      setTax(initialDraft.taxCardNumber ?? "");
      setCustomer({ ...blankCustomer, taxCardNumber: initialDraft.taxCardNumber ?? "", name: initialDraft.customerName ?? "" });
      setWizardPartnerId(initialDraft.partnerId);
      setDraft({ customer: { ...blankCustomer, taxCardNumber: initialDraft.taxCardNumber ?? "", name: initialDraft.customerName ?? "" }, request: { id: initialDraft.requestId, srNumber: initialDraft.srNumber } });
      setSalesUserId(initialDraft.salesUserId ?? null);
      setSalesUserName(initialDraft.salesUserName ?? null);
    } else {
      setStep(1);
      setTax("");
      setCustomer(blankCustomer);
      setWizardPartnerId(null);
      setDraft(null);
      setSalesUserId(null);
      setSalesUserName(null);
    }
    setLookup(null);
    setLookupErr(null);
    setPackageId(null);
    setOperationType("");
    setRealReceiptNumber("");
    setCollectionConfirmed(false);
    setError(null);
  };
  useEffect(() => {
    if (open) reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const packages = useQuery({
    queryKey: ["packages"],
    queryFn: () => api<Pkg[]>("/api/packages"),
    enabled: open,
  });

  const partnersQ = useQuery({
    queryKey: ["partners-min"],
    queryFn: () => api<{ id: number; name: string }[]>("/api/partners?minimal=1"),
    enabled: open && isCompany,
  });

  // For company users the sales list depends on the partner they pick.
  const salesPartnerId = isCompany ? wizardPartnerId : (user?.partnerId ?? null);
  const teamMembers = useQuery({
    queryKey: ["users", "sales-assignable", salesPartnerId],
    queryFn: () =>
      api<{ id: number; name: string }[]>(
        `/api/users/sales-assignable${isCompany && salesPartnerId ? `?partnerId=${salesPartnerId}` : ""}`,
      ),
    enabled:
      open &&
      (user?.roleKey === "team_leader" ||
        user?.roleKey === "partner_admin" ||
        (isCompany && !!salesPartnerId)),
  });

  // Reset sales selection when company user changes the partner.
  useEffect(() => {
    if (isCompany) { setSalesUserId(null); setSalesUserName(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardPartnerId]);

  const lookupMut = useMutation({
    mutationFn: (taxCard: string) =>
      api<LookupResp>(`/api/requests/lookup/${encodeURIComponent(taxCard)}`),
  });

  const draftMut = useMutation({
    mutationFn: () =>
      api<DraftResp>("/api/requests/draft", {
        method: "POST",
        json: {
          customer: { ...customer, taxCardNumber: tax },
          salesUserId: salesUserId ?? undefined,
          partnerId: wizardPartnerId ?? undefined,
        },
      }),
  });
  const packageMut = useMutation({
    mutationFn: (id: number) =>
      api(`/api/requests/${id}/package`, {
        method: "PATCH",
        json: { packageId, operationType, realReceiptNumber, collectionConfirmed },
      }),
  });
  const submitMut = useMutation({
    mutationFn: (id: number) =>
      api(`/api/requests/${id}/submit`, { method: "POST" }),
  });

  const submitFlow = async () => {
    setError(null);
    try {
      if (!draft) return;
      await packageMut.mutateAsync(draft.request.id);
      await submitMut.mutateAsync(draft.request.id);
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      onClose();
      navigate(`/requests/${draft.request.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? (typeof e.body === "object" && e.body?.error) || e.message : String(e));
    }
  };

  const taxOk = /^\d{9,15}$/.test(tax);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("wizard.title")}
      size="xl"
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            {t("common.cancel")}
          </button>
          {step > minStep && (
            <button className="btn-ghost" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}>
              <ArrowLeft className="w-4 h-4" /> {t("common.back")}
            </button>
          )}
          {step === 1 && (
            <button
              className="btn-primary"
              disabled={!taxOk || lookupMut.isPending}
              onClick={async () => {
                setLookupErr(null);
                try {
                  const r = await lookupMut.mutateAsync(tax);
                  setLookup(r);
                  if (r.canCreate === false) {
                    setLookupErr(r.blockReason ?? "blocked");
                  } else {
                    setCustomer(r.found && r.customer ? r.customer : { ...blankCustomer, taxCardNumber: tax });
                    setStep(2);
                  }
                } catch (e) {
                  setLookupErr(e instanceof ApiError ? (typeof e.body === "object" && e.body?.error) || e.message : String(e));
                }
              }}
            >
              {t("common.next")} <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === 2 && (
            <button
              className="btn-primary"
              disabled={
                !customer.name ||
                (isCompany && (!wizardPartnerId || !salesUserId)) ||
                ((user?.roleKey === "team_leader" || user?.roleKey === "partner_admin") && !salesUserId) ||
                draftMut.isPending
              }
              onClick={async () => {
                setError(null);
                try {
                  const d = await draftMut.mutateAsync();
                  setDraft(d);
                  setStep(3);
                } catch (e) {
                  setError(e instanceof ApiError ? (typeof e.body === "object" && e.body?.error) || e.message : String(e));
                }
              }}
            >
              {t("common.next")} <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === 3 && (
            <button
              className="btn-primary"
              disabled={!packageId || !operationType || !collectionConfirmed}
              onClick={() => setStep(4)}
            >
              {t("common.next")} <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === 4 && (
            <button
              className="btn-primary"
              disabled={packageMut.isPending || submitMut.isPending}
              onClick={submitFlow}
            >
              {t("wizard.submit")}
            </button>
          )}
        </>
      }
    >
      <Stepper step={step} />
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{t(`wizard.errors.${error}`, error)}</div>}

      {step === 1 && (
        <div>
          <p className="text-sm text-muted mb-3">{t("wizard.step1.intro")}</p>
          <div className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div className="font-semibold leading-relaxed">{t("wizard.step1.pendingNotice")}</div>
          </div>
          <Field label={t("wizard.taxCard")} required hint={t("wizard.taxCardHint")}>
            <div className="relative">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
              <input
                dir="ltr"
                className="input ps-9 font-mono"
                placeholder="123456789"
                value={tax}
                onChange={(e) => setTax(e.target.value.replace(/\D/g, "").slice(0, 15))}
              />
            </div>
          </Field>
          {lookupErr && (
            <div className="mt-4 rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-sm flex gap-2 items-start">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{t(`wizard.errors.${lookupErr}`, lookupErr)}</div>
                {lookup?.activeRequests && lookup.activeRequests.length > 0 && (
                  <ul className="mt-2 list-disc ms-5">
                    {lookup.activeRequests.map((r) => (
                      <li key={r.id}>
                        <span className="font-mono">{r.srNumber}</span> — {r.partnerName} ({r.status})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="text-sm text-muted mb-3">{t("wizard.step2.intro")}</p>
          {lookup?.found && (
            <div className="mb-4 rounded-lg bg-violet-50 text-violet-800 px-3 py-2 text-sm">
              {t("wizard.existingCustomer")}
            </div>
          )}
          <div className="form-row">
            <Field label={t("customers.businessName")} required>
              <input className="input" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </Field>
            <Field label={t("wizard.taxCard")} hint={t("wizard.taxCardLocked")}>
              <input dir="ltr" className="input font-mono bg-magnolia cursor-not-allowed" value={tax} disabled readOnly />
            </Field>
            <Field label={t("customers.nameOnTaxCard")}>
              <input className="input" value={customer.nameOnTaxCard ?? ""} onChange={(e) => setCustomer({ ...customer, nameOnTaxCard: e.target.value })} />
            </Field>
            <Field label={t("customers.taxOffice")}>
              <input className="input" value={customer.taxOffice ?? ""} onChange={(e) => setCustomer({ ...customer, taxOffice: e.target.value })} />
            </Field>
            <Field label={t("customers.commercialRegistry")}>
              <input dir="ltr" className="input" value={customer.commercialRegistry ?? ""} onChange={(e) => setCustomer({ ...customer, commercialRegistry: e.target.value })} />
            </Field>
            <Field label={t("customers.businessActivity")}>
              <input className="input" value={customer.businessActivity ?? ""} onChange={(e) => setCustomer({ ...customer, businessActivity: e.target.value })} />
            </Field>
            <Field label={t("common.email")}>
              <input dir="ltr" type="email" className="input" value={customer.email ?? ""} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            </Field>
            <Field label={t("customers.nationalId")}>
              <input dir="ltr" className="input" value={customer.nationalId ?? ""} onChange={(e) => setCustomer({ ...customer, nationalId: e.target.value.replace(/\D/g, "").slice(0, 14) })} />
            </Field>
            <Field label={t("common.address")} className="md:col-span-2">
              <input className="input" value={customer.address ?? ""} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
            </Field>
            <Field label={t("customers.primaryPhone")}>
              <PhoneWithWhatsapp
                value={customer.primaryPhone ?? ""}
                onChange={(v) => setCustomer({ ...customer, primaryPhone: v })}
                whatsapp={customer.primaryPhoneWhatsapp}
                onWhatsappChange={(b) => setCustomer({ ...customer, primaryPhoneWhatsapp: b })}
                whatsappLabel={t("customers.whatsapp")}
              />
            </Field>
            <Field label={t("customers.altPhone")}>
              <PhoneWithWhatsapp
                value={customer.altPhone ?? ""}
                onChange={(v) => setCustomer({ ...customer, altPhone: v })}
                whatsapp={customer.altPhoneWhatsapp}
                onWhatsappChange={(b) => setCustomer({ ...customer, altPhoneWhatsapp: b })}
                whatsappLabel={t("customers.whatsapp")}
              />
            </Field>
            {isCompany && (
              <Field label={t("common.partner")} required>
                <select
                  className="input"
                  value={wizardPartnerId ?? ""}
                  onChange={(e) => setWizardPartnerId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t("wizard.selectPartner")}</option>
                  {partnersQ.data?.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {(isCompany || user?.roleKey === "team_leader" || user?.roleKey === "partner_admin") && (
              <Field
                label={t("wizard.assignSales")}
                required
                hint={
                  isCompany && !wizardPartnerId
                    ? t("wizard.selectPartnerFirst")
                    : teamMembers.data && teamMembers.data.length === 0
                      ? t("wizard.noSalesForPartner")
                      : undefined
                }
              >
                <select
                  className="input"
                  value={salesUserId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setSalesUserId(id);
                    const m = teamMembers.data?.find((x) => x.id === id);
                    setSalesUserName(m?.name ?? null);
                  }}
                  disabled={isCompany && !wizardPartnerId}
                >
                  <option value="">{t("wizard.selectSales")}</option>
                  {teamMembers.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="text-sm text-muted mb-3">{t("wizard.step3.intro")}</p>
          <div className="form-row">
            <Field label={t("requests.package")} required>
              <select className="input" value={packageId ?? ""} onChange={(e) => setPackageId(Number(e.target.value))}>
                <option value="">{t("wizard.selectPackage")}</option>
                {packages.data?.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {Number(p.finalPriceAfterTax).toFixed(2)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("requests.operationType")} required>
              <select className="input" value={operationType} onChange={(e) => setOperationType(e.target.value as OperationType)}>
                <option value="">{t("wizard.selectOperation")}</option>
                {OPERATION_TYPES.map((op) => (
                  <option key={op} value={op}>
                    {t(`operationTypes.${op}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("requests.realReceiptNumber")} className="md:col-span-2">
              <input dir="ltr" className="input" value={realReceiptNumber} onChange={(e) => setRealReceiptNumber(e.target.value)} />
            </Field>
            <Field label={t("requests.collectionConfirmation")} className="md:col-span-2">
              <label className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  checked={collectionConfirmed}
                  onChange={(e) => setCollectionConfirmed(e.target.checked)}
                />
                <span>{t("requests.collectedBySales")}</span>
              </label>
            </Field>
          </div>
        </div>
      )}

      {step === 4 && draft && (() => {
        const pkg = packages.data?.find((p) => p.id === packageId);
        const partnerName =
          (isCompany ? partnersQ.data?.find((p) => p.id === wizardPartnerId)?.name : null) ??
          user?.partnerName ?? "—";
        const salesName =
          user?.roleKey === "sales"
            ? (user.name || "—")
            : (teamMembers.data?.find((m) => m.id === salesUserId)?.name
                ?? salesUserName
                ?? "—");
        const finalPrice = pkg ? Number(pkg.finalPriceAfterTax) : 0;
        const beforeTax = pkg ? Number(pkg.itemPriceBeforeTax) : 0;
        const taxAmount = Math.max(0, finalPrice - beforeTax);
        const taxPctNum = pkg ? Number(pkg.taxPct) : 0;
        const taxLabel = `Tax (${taxPctNum.toFixed(taxPctNum % 1 ? 2 : 0)}%)`;
        const receiptRef = receiptElRef;
        const onSave = async () => {
          if (!receiptRef.current) return;
          try {
            const dataUrl = await toPng(receiptRef.current, {
              pixelRatio: 3,
              backgroundColor: "#ffffff",
              cacheBust: true,
            });
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `receipt-${draft.request.srNumber}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (err) {
            console.error("Failed to save receipt:", err);
          }
        };
        return (
          <div>
            <p className="text-sm text-muted mb-4">{t("wizard.step4.intro")}</p>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-start">
              {/* Written summary */}
              <div className="rounded-xl border border-border bg-white p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <Summary label={t("wizard.srNumber")} value={draft.request.srNumber} mono />
                  <Summary label={t("wizard.taxCard")} value={tax} mono />
                  <Summary label={t("customers.businessName")} value={customer.name} />
                  <Summary label={t("common.partner")} value={partnerName} />
                  <Summary label={t("wizard.assignSales")} value={salesName} />
                  <Summary label={t("requests.operationType")} value={operationType ? t(`operationTypes.${operationType}`) : "—"} />
                  <Summary label={t("requests.package")} value={pkg ? pkg.name : "—"} />
                  {pkg?.description && (
                    <Summary label={t("common.description")} value={pkg.description} />
                  )}
                  <Summary label={t("requests.realReceiptNumber")} value={realReceiptNumber || "—"} mono />
                  <Summary label={t("customers.primaryPhone")} value={customer.primaryPhone || "—"} mono />
                  <Summary label={t("requests.collectionConfirmation")} value={collectionConfirmed ? t("common.yes") : t("common.no")} />
                </div>
              </div>

              {/* POS receipt — fixed 80mm column */}
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  className="self-stretch inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 px-3 py-1.5 text-xs font-semibold"
                  onClick={onSave}
                >
                  <Download className="w-3.5 h-3.5" />
                  {t("wizard.step4.saveReceipt")}
                </button>
                <div
                  ref={receiptRef}
                  className="pos-print bg-white text-black border border-dashed border-zinc-400 rounded-md shadow-sm"
                  style={{
                    width: "80mm",
                    padding: "6mm 4mm",
                    fontFamily: '"Courier New", "Lucida Console", monospace',
                    fontSize: "11px",
                    lineHeight: 1.5,
                  }}
                  dir="ltr"
                >
                  <div style={{ fontSize: "16px", fontWeight: 800, textAlign: "center", letterSpacing: "0.03em" }}>
                    {partnerName}
                  </div>
                  <div style={{ textAlign: "center", fontSize: "10px", letterSpacing: "0.05em", opacity: 0.85 }}>
                    Mofawter
                  </div>
                  <Sep />
                  <Row label="SR #" value={draft.request.srNumber} bold />
                  <Row label="Date" value={new Date().toLocaleString("en-GB")} small />
                  <Sep />
                  <div style={{ fontWeight: 700 }}>CUSTOMER</div>
                  <Row label="Name" value={customer.name} />
                  <Row label="Tax Card" value={tax} />
                  {customer.commercialRegistry && <Row label="CR No." value={customer.commercialRegistry} />}
                  {customer.email && <Row label="Email" value={customer.email} small />}
                  <Sep />
                  <div style={{ fontWeight: 700 }}>REQUEST</div>
                  <Row label="Operation" value={operationType || "—"} />
                  <Row label="Package" value={pkg?.name ?? "—"} />
                  {pkg?.description && (
                    <div style={{ fontSize: "10px", fontStyle: "italic", paddingInlineStart: 8, opacity: 0.85 }}>
                      {pkg.description}
                    </div>
                  )}
                  {realReceiptNumber && <Row label="Receipt #" value={realReceiptNumber} />}
                  <Row label="Sales Rep" value={salesName} />
                  <Sep />
                  <div style={{ fontWeight: 700 }}>AMOUNT</div>
                  <Row label="Subtotal" value={beforeTax.toFixed(2)} />
                  <Row label={taxLabel} value={taxAmount.toFixed(2)} />
                  <Sep />
                  <Row label="TOTAL" value={`${finalPrice.toFixed(2)} EGP`} bold big />
                  <Sep />
                  <Row label="Collection" value={collectionConfirmed ? "CONFIRMED" : "PENDING"} small />
                  <Sep />
                  <div style={{ textAlign: "center", fontSize: "10px", marginTop: 4 }}>Thank you</div>
                  <div style={{ textAlign: "center", fontSize: "10px" }}>{draft.request.srNumber}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </Modal>
  );
}

function Sep() {
  return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />;
}
function Row({ label, value, bold, small, big }: { label: string; value: string; bold?: boolean; small?: boolean; big?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        fontWeight: bold ? 700 : 400,
        fontSize: big ? "13px" : small ? "10px" : "11px",
      }}
    >
      <span>{label}</span>
      <span style={{ textAlign: "end", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const { t } = useTranslation();
  const labels = [t("wizard.steps.1"), t("wizard.steps.2"), t("wizard.steps.3"), t("wizard.steps.4")];
  return (
    <div className="flex items-center gap-2 mb-6">
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const active = n === step;
        const done = n < step;
        return (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div
              className={
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 " +
                (done
                  ? "bg-violet text-white"
                  : active
                    ? "bg-violet-100 text-violet-700 ring-2 ring-violet"
                    : "bg-magnolia text-muted")
              }
            >
              {done ? "✓" : n}
            </div>
            <div className={"text-xs " + (active ? "text-ink font-semibold" : "text-muted")}>{l}</div>
            {n < 4 && <div className="dashed-divider flex-1" />}
          </div>
        );
      })}
    </div>
  );
}

function PhoneWithWhatsapp({
  value,
  onChange,
  whatsapp,
  onWhatsappChange,
  whatsappLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  whatsapp: boolean;
  onWhatsappChange: (b: boolean) => void;
  whatsappLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        dir="ltr"
        className="input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <label className="flex items-center gap-2 text-xs text-muted shrink-0 cursor-pointer select-none">
        <button
          type="button"
          role="switch"
          aria-checked={whatsapp}
          onClick={() => onWhatsappChange(!whatsapp)}
          className={
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors " +
            (whatsapp ? "bg-emerald-500" : "bg-slate-300")
          }
        >
          <span
            className={
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
              (whatsapp ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </button>
        <span>{whatsappLabel}</span>
      </label>
    </div>
  );
}

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={"text-sm " + (mono ? "font-mono" : "font-medium")}>{value}</div>
    </div>
  );
}

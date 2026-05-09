import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Modal } from "./Modal";
import { Field } from "./Field";
import { Search, AlertTriangle, CheckCircle2, ArrowRight, ArrowLeft } from "lucide-react";
import { useCurrentUser } from "../hooks/useAuth";
import { OPERATION_TYPES, type OperationType } from "../../../shared/requests";

interface Customer {
  id: number;
  taxCardNumber: string;
  name: string;
  contactPerson: string | null;
  contactPhone: string | null;
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
  contactPerson: "",
  contactPhone: "",
  email: "",
  address: "",
  taxOffice: "",
  businessActivity: "",
  notes: "",
};

export function RequestWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const isCompany = user?.roleKey === "company_super_admin" || user?.roleKey === "company_accountant";

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [tax, setTax] = useState("");
  const [lookup, setLookup] = useState<LookupResp | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer>(blankCustomer);
  const [wizardPartnerId, setWizardPartnerId] = useState<number | null>(null);
  const [salesUserId, setSalesUserId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftResp | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [operationType, setOperationType] = useState<OperationType | "">("");
  const [realReceiptNumber, setRealReceiptNumber] = useState("");
  const [collectionConfirmed, setCollectionConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep(1);
    setTax("");
    setLookup(null);
    setLookupErr(null);
    setCustomer(blankCustomer);
    setWizardPartnerId(null);
    setSalesUserId(null);
    setDraft(null);
    setPackageId(null);
    setOperationType("");
    setRealReceiptNumber("");
    setCollectionConfirmed(false);
    setError(null);
  };
  useEffect(() => {
    if (!open) reset();
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

  const teamMembers = useQuery({
    queryKey: ["users", "team-members", user?.id],
    queryFn: () => api<{ id: number; name: string }[]>("/api/users/sales-assignable"),
    enabled: open && (user?.roleKey === "team_leader" || user?.roleKey === "partner_admin"),
  });

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
          {step > 1 && (
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
              disabled={!customer.name || (isCompany && !wizardPartnerId) || draftMut.isPending}
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
            <Field label={t("wizard.taxCard")}>
              <input dir="ltr" className="input font-mono" value={tax} disabled />
            </Field>
            <Field label={t("customers.businessName")} required>
              <input className="input" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </Field>
            <Field label={t("customers.contactPerson")}>
              <input className="input" value={customer.contactPerson ?? ""} onChange={(e) => setCustomer({ ...customer, contactPerson: e.target.value })} />
            </Field>
            <Field label={t("customers.contactPhone")}>
              <input dir="ltr" className="input" value={customer.contactPhone ?? ""} onChange={(e) => setCustomer({ ...customer, contactPhone: e.target.value })} />
            </Field>
            <Field label={t("common.email")}>
              <input dir="ltr" type="email" className="input" value={customer.email ?? ""} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            </Field>
            <Field label={t("customers.taxOffice")}>
              <input className="input" value={customer.taxOffice ?? ""} onChange={(e) => setCustomer({ ...customer, taxOffice: e.target.value })} />
            </Field>
            <Field label={t("customers.businessActivity")} className="md:col-span-2">
              <input className="input" value={customer.businessActivity ?? ""} onChange={(e) => setCustomer({ ...customer, businessActivity: e.target.value })} />
            </Field>
            <Field label={t("common.address")} className="md:col-span-2">
              <input className="input" value={customer.address ?? ""} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
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
            {(user?.roleKey === "team_leader" || user?.roleKey === "partner_admin") && (
              <Field label={t("wizard.assignSales")} required={user?.roleKey === "team_leader"}>
                <select
                  className="input"
                  value={salesUserId ?? ""}
                  onChange={(e) => setSalesUserId(e.target.value ? Number(e.target.value) : null)}
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

      {step === 4 && draft && (
        <div>
          <p className="text-sm text-muted mb-3">{t("wizard.step4.intro")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Summary label={t("wizard.srNumber")} value={draft.request.srNumber} mono />
            <Summary label={t("wizard.taxCard")} value={tax} mono />
            <Summary label={t("customers.businessName")} value={customer.name} />
            <Summary label={t("requests.operationType")} value={operationType ? t(`operationTypes.${operationType}`) : "—"} />
            <Summary
              label={t("requests.package")}
              value={
                packages.data?.find((p) => p.id === packageId)
                  ? `${packages.data.find((p) => p.id === packageId)!.name} — ${Number(packages.data.find((p) => p.id === packageId)!.finalPriceAfterTax).toFixed(2)}`
                  : "—"
              }
            />
            <Summary label={t("requests.collectionConfirmation")} value={collectionConfirmed ? t("common.yes") : t("common.no")} />
          </div>
          <div className="mt-4 rounded-lg bg-violet-50 text-violet-800 px-3 py-2 text-sm flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5" />
            <span>{t("wizard.step4.confirm")}</span>
          </div>
        </div>
      )}
    </Modal>
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

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={"text-sm " + (mono ? "font-mono" : "font-medium")}>{value}</div>
    </div>
  );
}

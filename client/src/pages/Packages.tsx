import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCurrentUser, can } from "../hooks/useAuth";

interface Pkg {
  id: number;
  name: string;
  description: string | null;
  itemPriceBeforeTax: string;
  taxPct: string;
  finalPriceAfterTax: string;
  durationDays: number;
  packageType: string;
  active: boolean;
  availableForAll: boolean;
  defaultPartnerCommissionPct: string;
  defaultSalesCommissionPct: string;
}

interface PkgDetail extends Pkg {
  partners: { partnerId: number; partnerName: string }[];
}

interface Partner { id: number; name: string }

interface PkgForm {
  name: string;
  description: string;
  itemPriceBeforeTax: number;
  taxPct: number;
  durationDays: number;
  packageType: string;
  active: boolean;
  availableForAll: boolean;
  defaultPartnerCommissionPct: number;
  defaultSalesCommissionPct: number;
  partnerIds: number[];
  partnerIdsTouched: boolean;
}

const blank: PkgForm = {
  name: "",
  description: "",
  itemPriceBeforeTax: 0,
  taxPct: 14,
  durationDays: 365,
  packageType: "subscription",
  active: true,
  availableForAll: true,
  defaultPartnerCommissionPct: 0,
  defaultSalesCommissionPct: 0,
  partnerIds: [],
  partnerIdsTouched: false,
};

export function PackagesPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["packages"], queryFn: () => api<Pkg[]>("/api/packages") });
  const partnersQ = useQuery({ queryKey: ["partners"], queryFn: () => api<Partner[]>("/api/partners") });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState<Pkg | null>(null);

  const finalPrice = useMemo(
    () => Math.round((form.itemPriceBeforeTax + (form.itemPriceBeforeTax * form.taxPct) / 100) * 100) / 100,
    [form.itemPriceBeforeTax, form.taxPct]
  );

  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) => api("/api/packages", { method: "POST", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["packages"] }); setOpen(false); },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api(`/api/packages/${id}`, { method: "PATCH", json: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["packages"] }); setOpen(false); },
  });

  const onNew = () => { setEditing(null); setForm(blank); setError(null); setOpen(true); };
  const onEdit = async (p: Pkg) => {
    setEditing(p);
    setError(null);
    // Hydrate the form (including existing partner availability) from the
    // detail endpoint so saving an edit never silently wipes assignments.
    try {
      const detail = await api<PkgDetail>(`/api/packages/${p.id}`);
      setForm({
        name: detail.name,
        description: detail.description || "",
        itemPriceBeforeTax: Number(detail.itemPriceBeforeTax),
        taxPct: Number(detail.taxPct),
        durationDays: detail.durationDays,
        packageType: detail.packageType,
        active: detail.active,
        availableForAll: detail.availableForAll,
        defaultPartnerCommissionPct: Number(detail.defaultPartnerCommissionPct),
        defaultSalesCommissionPct: Number(detail.defaultSalesCommissionPct),
        partnerIds: detail.partners.map((x) => x.partnerId),
        partnerIdsTouched: false,
      });
      setOpen(true);
    } catch {
      setError(t("common.failed"));
    }
  };
  const submit = async () => {
    setError(null);
    // Only send partnerIds when the user actually touched the selection or
    // when creating a brand-new package.
    const { partnerIdsTouched, partnerIds, ...rest } = form;
    const payload: Record<string, unknown> = { ...rest };
    if (!editing || partnerIdsTouched) payload.partnerIds = partnerIds;
    try {
      if (editing) await update.mutateAsync({ id: editing.id, data: payload });
      else await create.mutateAsync(payload);
    } catch (e) {
      const err = e as { body?: { error?: string }; message?: string };
      setError(err?.body?.error || err?.message || "failed");
    }
  };

  const canCreate = can(user, "packages:create");
  const canEdit = can(user, "packages:edit");

  return (
    <div>
      <PageHeader
        title={t("packages.title")}
        subtitle={t("packages.subtitle")}
        actions={canCreate && <button className="btn-primary" onClick={onNew}><Plus className="w-4 h-4" /> {t("packages.new")}</button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {list.data?.map((p) => (
          <div key={p.id} className="stamp-card p-5 flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="font-semibold text-ink">{p.name}</div>
                <div className="text-xs text-muted">{p.description}</div>
              </div>
              <span className={p.active ? "pill-success" : "pill-muted"}>
                {p.active ? t("common.active") : t("common.inactive")}
              </span>
            </div>
            <div className="dashed-divider my-3" />
            <div className="grid grid-cols-2 gap-y-1 text-xs">
              <span className="text-muted">{t("packages.itemPrice")}</span>
              <span className="text-end font-medium">{Number(p.itemPriceBeforeTax).toLocaleString()} EGP</span>
              <span className="text-muted">{t("packages.taxPct")}</span>
              <span className="text-end font-medium">{Number(p.taxPct)}%</span>
              <span className="text-muted">{t("packages.finalPrice")}</span>
              <span className="text-end font-bold text-violet-700">{Number(p.finalPriceAfterTax).toLocaleString()} EGP</span>
              <span className="text-muted">{t("packages.durationDays")}</span>
              <span className="text-end font-medium">{p.durationDays}</span>
            </div>
            <div className="dashed-divider my-3" />
            <div className="flex gap-2 mt-auto">
              {canEdit && (
                <>
                  <button className="btn-outline flex-1" onClick={() => onEdit(p)}>
                    <Pencil className="w-3.5 h-3.5" /> {t("common.edit")}
                  </button>
                  <button className="btn-secondary flex-1" onClick={() => setRulesOpen(p)}>
                    {t("packages.commissionRules")}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `${t("common.edit")} — ${editing.name}` : t("packages.new")}
        size="lg"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button className="btn-primary" disabled={create.isPending || update.isPending} onClick={submit}>
              {editing ? t("common.update") : t("common.create")}
            </button>
          </>
        }
      >
        {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}
        <div className="form-row">
          <Field label={t("common.name")} required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("packages.type")}>
            <select className="input" value={form.packageType} onChange={(e) => setForm({ ...form, packageType: e.target.value })}>
              <option value="subscription">{t("packages.typeSubscription")}</option>
              <option value="addon">{t("packages.typeAddon")}</option>
              <option value="other">{t("packages.typeOther")}</option>
            </select>
          </Field>
          <Field label={t("common.description")} className="md:col-span-2">
            <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={t("packages.itemPrice")} required>
            <input type="number" min={0} step="0.01" className="input" value={form.itemPriceBeforeTax}
              onChange={(e) => setForm({ ...form, itemPriceBeforeTax: Number(e.target.value) })} />
          </Field>
          <Field label={t("packages.taxPct")}>
            <input type="number" min={0} step="0.01" className="input" value={form.taxPct}
              onChange={(e) => setForm({ ...form, taxPct: Number(e.target.value) })} />
          </Field>
          <Field label={t("packages.finalPrice")}>
            <input className="input bg-magnolia font-bold text-violet-700" value={finalPrice} readOnly />
          </Field>
          <Field label={t("packages.durationDays")}>
            <input type="number" className="input" value={form.durationDays}
              onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} />
          </Field>
          <Field label={t("common.status")}>
            <select className="input" value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
              <option value="1">{t("common.active")}</option>
              <option value="0">{t("common.inactive")}</option>
            </select>
          </Field>
          <Field label={t("packages.availableForAll")}>
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={form.availableForAll}
                onChange={(e) => setForm({ ...form, availableForAll: e.target.checked })} />
              <span>{form.availableForAll ? t("common.yes") : t("common.no")}</span>
            </label>
          </Field>
          <Field label={t("packages.defaultPartnerCommissionPct")}>
            <input type="number" step="0.01" min={0} max={100} className="input"
              value={form.defaultPartnerCommissionPct}
              onChange={(e) => setForm({ ...form, defaultPartnerCommissionPct: Number(e.target.value) })} />
          </Field>
          <Field label={t("packages.defaultSalesCommissionPct")}>
            <input type="number" step="0.01" min={0} max={100} className="input"
              value={form.defaultSalesCommissionPct}
              onChange={(e) => setForm({ ...form, defaultSalesCommissionPct: Number(e.target.value) })} />
          </Field>
          {!form.availableForAll && (
            <Field label={t("packages.selectPartners")} className="md:col-span-2">
              <select multiple className="input min-h-[120px]"
                value={form.partnerIds.map(String)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    partnerIds: Array.from(e.target.selectedOptions).map((o) => Number(o.value)),
                    partnerIdsTouched: true,
                  })
                }>
                {partnersQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      </Modal>

      <CommissionRulesModal pkg={rulesOpen} onClose={() => setRulesOpen(null)} partners={partnersQ.data || []} />
    </div>
  );
}

interface Rule {
  id: number;
  packageId: number;
  partnerId: number;
  partnerName: string;
  operationType: string;
  partnerCommissionPct: string;
  salesCommissionPct: string;
  active: boolean;
}

function CommissionRulesModal({
  pkg,
  onClose,
  partners,
}: {
  pkg: Pkg | null;
  onClose: () => void;
  partners: Partner[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const enabled = !!pkg;
  const rulesQ = useQuery({
    queryKey: ["pkg-rules", pkg?.id],
    queryFn: () => api<Rule[]>(`/api/packages/${pkg!.id}/commission-rules`),
    enabled,
  });
  const opsQ = useQuery({ queryKey: ["op-types"], queryFn: () => api<string[]>("/api/packages/operation-types"), enabled });

  const [form, setForm] = useState({
    partnerId: 0,
    operationType: "",
    partnerCommissionPct: 0,
    salesCommissionPct: 0,
    active: true,
  });
  const create = useMutation({
    mutationFn: (data: typeof form) => api(`/api/packages/${pkg!.id}/commission-rules`, { method: "POST", json: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pkg-rules", pkg?.id] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/packages/commission-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pkg-rules", pkg?.id] }),
  });

  if (!pkg) return null;

  return (
    <Modal
      open={enabled}
      onClose={onClose}
      title={`${t("packages.commissionRules")} — ${pkg.name}`}
      size="xl"
      footer={<button className="btn-outline" onClick={onClose}>{t("common.close")}</button>}
    >
      <div className="stamp-card overflow-hidden mb-5">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.partner")}</th>
              <th>{t("packages.operationType")}</th>
              <th>{t("partners.partnerCommissionPct")}</th>
              <th>{t("partners.salesCommissionPct")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rulesQ.data?.length === 0 && (
              <tr><td colSpan={5} className="text-center py-6 text-muted">{t("common.noData")}</td></tr>
            )}
            {rulesQ.data?.map((r) => (
              <tr key={r.id}>
                <td>{r.partnerName}</td>
                <td>{t([`operationTypes.${r.operationType}`, r.operationType] as const)}</td>
                <td>{Number(r.partnerCommissionPct)}%</td>
                <td>{Number(r.salesCommissionPct)}%</td>
                <td className="text-end">
                  <button className="btn-ghost text-red-600" onClick={() => remove.mutate(r.id)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashed-divider mb-4" />
      <h4 className="font-semibold text-violet-700 mb-3 text-sm">{t("packages.addRule")}</h4>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Field label={t("common.partner")}>
          <select className="input" value={form.partnerId}
            onChange={(e) => setForm({ ...form, partnerId: Number(e.target.value) })}>
            <option value={0}>—</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t("packages.operationType")}>
          <select className="input" value={form.operationType}
            onChange={(e) => setForm({ ...form, operationType: e.target.value })}>
            <option value="">—</option>
            {opsQ.data?.map((o) => <option key={o} value={o}>{t([`operationTypes.${o}`, o] as const)}</option>)}
          </select>
        </Field>
        <Field label={t("partners.partnerCommissionPct")}>
          <input type="number" step="0.01" className="input" value={form.partnerCommissionPct}
            onChange={(e) => setForm({ ...form, partnerCommissionPct: Number(e.target.value) })} />
        </Field>
        <Field label={t("partners.salesCommissionPct")}>
          <input type="number" step="0.01" className="input" value={form.salesCommissionPct}
            onChange={(e) => setForm({ ...form, salesCommissionPct: Number(e.target.value) })} />
        </Field>
        <Field label="—">
          <button
            className="btn-primary w-full"
            disabled={!form.partnerId || !form.operationType || create.isPending}
            onClick={() => create.mutate(form)}
          >
            <Plus className="w-4 h-4" /> {t("common.add")}
          </button>
        </Field>
      </div>
    </Modal>
  );
}

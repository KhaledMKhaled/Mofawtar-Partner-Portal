import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { Plus, Pencil } from "lucide-react";
import { useCurrentUser, can } from "../hooks/useAuth";

interface Partner {
  id: number;
  name: string;
  code: string;
  status: string;
  partnerCommissionPct: string;
  safetyPeriodDays: number;
  claimCycleType: string;
  salesCommissionEnabled: boolean;
  salesCommissionPct: string;
  ownershipPeriodValue: number;
  ownershipPeriodUnit: string;
}

const blank = {
  name: "",
  code: "",
  address: "",
  status: "active" as "active" | "inactive",
  partnerCommissionPct: 20,
  commissionPeriodDays: 30,
  safetyPeriodDays: 14,
  claimCycleType: "manual" as "auto" | "manual",
  claimCycleDays: 30,
  salesCommissionEnabled: false,
  salesCommissionPct: 5,
  salesPayoutCycle: "monthly" as "monthly" | "quarterly",
  ownershipPeriodValue: 3,
  ownershipPeriodUnit: "years" as "years" | "months",
  contractStartDate: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
};

export function PartnersPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["partners"],
    queryFn: () => api<Partner[]>("/api/partners"),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: any) => api("/api/partners", { method: "POST", json: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      setOpen(false);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api(`/api/partners/${id}`, { method: "PATCH", json: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      setOpen(false);
    },
  });

  const onNew = () => {
    setEditing(null);
    setForm(blank);
    setError(null);
    setOpen(true);
  };
  const onEdit = (p: Partner) => {
    setEditing(p);
    setForm({
      ...blank,
      name: p.name,
      code: p.code,
      status: p.status as any,
      partnerCommissionPct: Number(p.partnerCommissionPct),
      safetyPeriodDays: p.safetyPeriodDays,
      claimCycleType: p.claimCycleType as any,
      salesCommissionEnabled: p.salesCommissionEnabled,
      salesCommissionPct: Number(p.salesCommissionPct),
      ownershipPeriodValue: p.ownershipPeriodValue,
      ownershipPeriodUnit: p.ownershipPeriodUnit as any,
    });
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    try {
      if (editing) {
        const { adminName, adminEmail, adminPassword, ...rest } = form;
        await update.mutateAsync({ id: editing.id, data: rest });
      } else {
        await create.mutateAsync(form);
      }
    } catch (e: any) {
      setError(e?.body?.error || e?.message || "failed");
    }
  };

  const canCreate = can(user, "partners:create");
  const canEdit = can(user, "partners:edit");

  return (
    <div>
      <PageHeader
        title={t("partners.title")}
        subtitle={t("partners.subtitle")}
        actions={
          canCreate && (
            <button className="btn-primary" onClick={onNew}>
              <Plus className="w-4 h-4" /> {t("partners.new")}
            </button>
          )
        }
      />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.code")}</th>
              <th>{t("partners.partnerCommissionPct")}</th>
              <th>{t("partners.salesCommissionEnabled")}</th>
              <th>{t("partners.ownershipPeriod")}</th>
              <th>{t("common.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr><td colSpan={7} className="text-center text-muted py-8">{t("common.loading")}</td></tr>
            )}
            {list.data?.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted py-8">{t("common.noData")}</td></tr>
            )}
            {list.data?.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.name}</td>
                <td className="font-mono text-xs">{p.code}</td>
                <td>{Number(p.partnerCommissionPct)}%</td>
                <td>
                  {p.salesCommissionEnabled
                    ? <span className="pill-success">{Number(p.salesCommissionPct)}%</span>
                    : <span className="pill-muted">{t("common.disabled")}</span>}
                </td>
                <td>{p.ownershipPeriodValue} {t(`partners.${p.ownershipPeriodUnit}`)}</td>
                <td>
                  <span className={p.status === "active" ? "pill-success" : "pill-muted"}>
                    {t(`common.${p.status}`)}
                  </span>
                </td>
                <td className="text-end">
                  {canEdit && (
                    <button className="btn-ghost" onClick={() => onEdit(p)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `${t("common.edit")} — ${editing.name}` : t("partners.new")}
        size="xl"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button
              className="btn-primary"
              disabled={create.isPending || update.isPending}
              onClick={submit}
            >
              {editing ? t("common.update") : t("common.create")}
            </button>
          </>
        }
      >
        {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}

        <Section title={t("partners.basic")}>
          <div className="form-row">
            <Field label={t("common.name")} required>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("common.code")} required>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t("common.address")} className="md:col-span-2">
              <input className="input" value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t("common.status")}>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.inactive")}</option>
              </select>
            </Field>
            <Field label={t("partners.contractStartDate")}>
              <input type="date" className="input" value={form.contractStartDate} onChange={(e) => setForm({ ...form, contractStartDate: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title={t("partners.contract")}>
          <div className="form-row">
            <Field label={t("partners.partnerCommissionPct")} required>
              <input type="number" step="0.01" className="input" value={form.partnerCommissionPct}
                onChange={(e) => setForm({ ...form, partnerCommissionPct: Number(e.target.value) })} />
            </Field>
            <Field label={t("partners.safetyPeriodDays")}>
              <input type="number" className="input" value={form.safetyPeriodDays}
                onChange={(e) => setForm({ ...form, safetyPeriodDays: Number(e.target.value) })} />
            </Field>
            <Field label={t("partners.claimCycleType")}>
              <select className="input" value={form.claimCycleType}
                onChange={(e) => setForm({ ...form, claimCycleType: e.target.value as any })}>
                <option value="manual">{t("partners.claimCycleManual")}</option>
                <option value="auto">{t("partners.claimCycleAuto")}</option>
              </select>
            </Field>
            <Field label={t("partners.claimCycleDays")}>
              <input type="number" className="input" value={form.claimCycleDays}
                onChange={(e) => setForm({ ...form, claimCycleDays: Number(e.target.value) })} />
            </Field>
            <Field label={t("partners.salesCommissionEnabled")}>
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.salesCommissionEnabled}
                  onChange={(e) => setForm({ ...form, salesCommissionEnabled: e.target.checked })} />
                <span>{form.salesCommissionEnabled ? t("common.enabled") : t("common.disabled")}</span>
              </label>
            </Field>
            <Field label={t("partners.salesCommissionPct")}>
              <input type="number" step="0.01" className="input" value={form.salesCommissionPct}
                disabled={!form.salesCommissionEnabled}
                onChange={(e) => setForm({ ...form, salesCommissionPct: Number(e.target.value) })} />
            </Field>
            <Field label={t("partners.salesPayoutCycle")}>
              <select className="input" value={form.salesPayoutCycle}
                disabled={!form.salesCommissionEnabled}
                onChange={(e) => setForm({ ...form, salesPayoutCycle: e.target.value as any })}>
                <option value="monthly">{t("partners.monthly")}</option>
                <option value="quarterly">{t("partners.quarterly")}</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title={t("partners.ownership")}>
          <div className="form-row">
            <Field label={t("partners.ownershipPeriod")} required>
              <input type="number" min={1} className="input" value={form.ownershipPeriodValue}
                onChange={(e) => setForm({ ...form, ownershipPeriodValue: Number(e.target.value) })} />
            </Field>
            <Field label="—">
              <select className="input" value={form.ownershipPeriodUnit}
                onChange={(e) => setForm({ ...form, ownershipPeriodUnit: e.target.value as any })}>
                <option value="years">{t("partners.years")}</option>
                <option value="months">{t("partners.months")}</option>
              </select>
            </Field>
          </div>
        </Section>

        {!editing && (
          <Section title={t("partners.admin")}>
            <div className="form-row">
              <Field label={t("partners.adminName")} required>
                <input className="input" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              </Field>
              <Field label={t("partners.adminEmail")} required>
                <input type="email" dir="ltr" className="input" value={form.adminEmail}
                  onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
              </Field>
              <Field label={t("partners.adminPassword")} required hint="≥ 8 chars">
                <input type="text" dir="ltr" className="input" value={form.adminPassword}
                  onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
              </Field>
            </div>
          </Section>
        )}
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-sm font-semibold text-violet-700 mb-3">{title}</h3>
      <div className="dashed-divider mb-4" />
      {children}
    </div>
  );
}

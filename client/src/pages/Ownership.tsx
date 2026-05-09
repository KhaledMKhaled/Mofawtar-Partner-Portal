import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { useCurrentUser, can } from "../hooks/useAuth";
import { OWNERSHIP_STATUSES } from "../../../shared/requests";

interface Row {
  id: number;
  customerId: number;
  customerName: string | null;
  taxCardNumber: string | null;
  partnerId: number | null;
  partnerName: string | null;
  startDate: string;
  endDate: string;
  status: string;
  reason: string | null;
}

export function OwnershipPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["ownership", { status }],
    queryFn: () => api<Row[]>(`/api/ownership${status ? `?status=${status}` : ""}`),
  });

  const partners = useQuery({
    queryKey: ["partners-light"],
    queryFn: () => api<{ id: number; name: string }[]>("/api/partners"),
    enabled: can(user, "ownership:manage"),
  });

  const [action, setAction] = useState<"" | "extend" | "transfer" | "return">("");
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [extendByDays, setExtendByDays] = useState(30);
  const [toPartnerId, setToPartnerId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  const extend = useMutation({
    mutationFn: () => api(`/api/ownership/${target!.id}/extend`, { method: "POST", json: { reason, extendByDays } }),
  });
  const transfer = useMutation({
    mutationFn: () => api(`/api/ownership/${target!.id}/transfer`, { method: "POST", json: { reason, toPartnerId } }),
  });
  const returnToCo = useMutation({
    mutationFn: () => api(`/api/ownership/${target!.id}/return`, { method: "POST", json: { reason } }),
  });

  const close = () => {
    setAction("");
    setTarget(null);
    setReason("");
    setExtendByDays(30);
    setToPartnerId("");
    setError(null);
  };
  const run = async () => {
    setError(null);
    try {
      if (action === "extend") await extend.mutateAsync();
      else if (action === "transfer") await transfer.mutateAsync();
      else if (action === "return") await returnToCo.mutateAsync();
      qc.invalidateQueries({ queryKey: ["ownership"] });
      close();
    } catch (e) {
      setError(e instanceof ApiError ? (typeof e.body === "object" && e.body?.error) || e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader title={t("ownership.title")} subtitle={t("ownership.subtitle")} />

      <div className="mb-4 flex gap-3">
        <select className="input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("ownership.allStatuses")}</option>
          {OWNERSHIP_STATUSES.map((s) => <option key={s} value={s}>{t(`ownership.statuses.${s}`)}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("requests.customer")}</th>
              <th>{t("common.partner")}</th>
              <th>{t("ownership.startDate")}</th>
              <th>{t("ownership.endDate")}</th>
              <th>{t("common.status")}</th>
              {can(user, "ownership:manage") && <th />}
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={6} className="text-center text-muted py-8">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-8">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/customers/${r.customerId}`} className="font-medium hover:text-violet-700">{r.customerName}</Link>
                  <div className="text-xs text-muted font-mono">{r.taxCardNumber}</div>
                </td>
                <td>{r.partnerName ?? "—"}</td>
                <td className="text-xs">{new Date(r.startDate).toLocaleDateString()}</td>
                <td className="text-xs">{new Date(r.endDate).toLocaleDateString()}</td>
                <td><span className={statusPill(r.status)}>{t(`ownership.statuses.${r.status}`)}</span></td>
                {can(user, "ownership:manage") && (
                  <td className="text-end whitespace-nowrap">
                    {(r.status === "active" || r.status === "extended") && (
                      <>
                        <button className="btn-ghost text-xs" onClick={() => { setTarget(r); setAction("extend"); }}>
                          {t("ownership.extend")}
                        </button>
                        <button className="btn-ghost text-xs" onClick={() => { setTarget(r); setAction("transfer"); }}>
                          {t("ownership.transfer")}
                        </button>
                        <button className="btn-ghost text-xs" onClick={() => { setTarget(r); setAction("return"); }}>
                          {t("ownership.return")}
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!action}
        onClose={close}
        title={action === "extend" ? t("ownership.extend") : action === "transfer" ? t("ownership.transfer") : t("ownership.return")}
        footer={
          <>
            <button className="btn-outline" onClick={close}>{t("common.cancel")}</button>
            <button className="btn-primary" disabled={extend.isPending || transfer.isPending || returnToCo.isPending} onClick={run}>{t("common.confirm")}</button>
          </>
        }
      >
        {error && <div className="mb-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>}
        {action === "extend" && (
          <div className="space-y-3">
            <Field label={t("ownership.extendByDays")} required>
              <input type="number" className="input" value={extendByDays} onChange={(e) => setExtendByDays(Number(e.target.value))} />
            </Field>
            <Field label={t("requests.reason")} required>
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
        {action === "return" && (
          <div className="space-y-3">
            <Field label={t("requests.reason")} required>
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
        {action === "transfer" && (
          <div className="space-y-3">
            <Field label={t("ownership.toPartner")} required>
              <select className="input" value={toPartnerId} onChange={(e) => setToPartnerId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">—</option>
                {partners.data?.filter((p) => p.id !== target?.partnerId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label={t("requests.reason")} required>
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function statusPill(s: string) {
  if (s === "active" || s === "extended") return "pill-success";
  if (s === "expired") return "pill-warning";
  if (s === "transferred") return "pill-violet";
  return "pill-muted";
}

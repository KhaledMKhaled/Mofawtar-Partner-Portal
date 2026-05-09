import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Download } from "lucide-react";

interface Row {
  id: number;
  userId: number | null; userName: string | null;
  action: string; entityType: string | null; entityId: string | null;
  note: string | null; partnerId: number | null;
  oldValue: unknown; newValue: unknown;
  createdAt: string;
}

const ENTITY_TYPES = ["request","customer","ownership","order_payment","partner_commission","sales_commission","claim","payout_batch","settlement","user","partner","package"] as const;

export function AuditLogPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const buildQuery = () => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    if (entityType) params.entityType = entityType;
    if (action) params.action = action;
    if (partnerId) params.partnerId = partnerId;
    if (from) params.from = from;
    if (to) params.to = to;
    return new URLSearchParams(params).toString();
  };

  const list = useQuery({
    queryKey: ["audit-log", q, entityType, action, partnerId, from, to],
    queryFn: () => api<Row[]>(`/api/audit-log?${buildQuery()}`),
  });

  const exportTo = (kind: "csv" | "xlsx") => {
    window.open(`/api/audit-log/export.${kind}?${buildQuery()}`, "_blank");
  };

  return (
    <div>
      <PageHeader title={t("nav.audit_log")} subtitle={t("auditLog.subtitle")} />
      <div className="grid md:grid-cols-6 gap-2 mb-4">
        <input className="input md:col-span-2" placeholder={t("common.search") as string} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">{t("auditLog.anyEntity")}</option>
          {ENTITY_TYPES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input className="input" placeholder={t("auditLog.actionFilter") as string} value={action} onChange={(e) => setAction(e.target.value)} />
        <input className="input" type="number" placeholder={t("auditLog.partnerIdFilter") as string} value={partnerId} onChange={(e) => setPartnerId(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t("common.from") as string} />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t("common.to") as string} />
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <button className="btn-secondary" onClick={() => exportTo("csv")}><Download className="w-4 h-4" /> CSV</button>
        <button className="btn-secondary" onClick={() => exportTo("xlsx")}><Download className="w-4 h-4" /> Excel</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>{t("auditLog.when")}</th><th>{t("auditLog.who")}</th>
            <th>{t("auditLog.action")}</th><th>{t("auditLog.entity")}</th>
            <th>{t("auditLog.details")}</th>
          </tr></thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={5} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => (
              <tr key={r.id} className="text-xs">
                <td className="text-muted whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.userName ?? <span className="text-muted">system</span>}</td>
                <td className="font-mono">{r.action}</td>
                <td>{r.entityType ?? "—"}{r.entityId ? ` #${r.entityId}` : ""}</td>
                <td>
                  {r.note && <div className="mb-1">{r.note}</div>}
                  {(r.oldValue || r.newValue) ? (
                    <details>
                      <summary className="cursor-pointer text-violet-700">{t("auditLog.viewDiff")}</summary>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
                        <pre className="bg-red-50 p-2 rounded overflow-auto max-h-40">{r.oldValue ? JSON.stringify(r.oldValue, null, 2) : "—"}</pre>
                        <pre className="bg-green-50 p-2 rounded overflow-auto max-h-40">{r.newValue ? JSON.stringify(r.newValue, null, 2) : "—"}</pre>
                      </div>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

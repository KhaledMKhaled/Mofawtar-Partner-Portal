import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { useCurrentUser, can } from "../hooks/useAuth";
import {
  SALES_COMMISSION_STATUSES, SALES_COMMISSION_TRANSITIONS, pillClassFor, tStatus, fmtMoney,
  type SalesCommissionStatus,
} from "../lib/financial";

interface Row {
  id: number;
  requestId: number;
  srNumber: string | null;
  partnerName: string | null;
  salesName: string | null;
  customerName: string | null;
  packageName: string | null;
  baseAmount: string;
  pct: string;
  amount: string;
  status: SalesCommissionStatus;
  payoutBatchId: number | null;
  createdAt: string;
}

export function SalesCommissionsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["sales-commissions", status],
    queryFn: () => api<Row[]>(`/api/sales-commissions?${new URLSearchParams({ status }).toString()}`),
  });
  const mutate = useMutation({
    mutationFn: (vars: { id: number; toStatus: string; reason?: string }) =>
      api(`/api/sales-commissions/${vars.id}/transition`, { method: "POST", json: { toStatus: vars.toStatus, reason: vars.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales-commissions"] }),
  });
  const canChange = can(user, "sales_commissions:change_status");
  const isCompany = user?.roleKey === "company_super_admin" || user?.roleKey === "company_accountant";

  const total = list.data?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;

  return (
    <div>
      <PageHeader title={t("nav.sales_commissions")} subtitle={t("salesCommissions.subtitle")} />
      <div className="flex flex-wrap gap-2 mb-4 items-end justify-between">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.all")}</option>
          {SALES_COMMISSION_STATUSES.map((s) => <option key={s} value={s}>{tStatus(t, "salesCommission", s)}</option>)}
        </select>
        <div className="text-sm">
          <span className="text-muted">{t("common.total")}: </span>
          <span className="font-mono font-semibold text-violet-700">{fmtMoney(total)}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("requests.sr")}</th>
              <th>{t("common.customer")}</th>
              <th>{t("salesCommissions.salesName")}</th>
              {isCompany && <th>{t("common.partner")}</th>}
              <th className="text-end">{t("partnerCommissions.pct")}</th>
              <th className="text-end">{t("partnerCommissions.amount")}</th>
              <th>{t("common.status")}</th>
              {canChange && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={8} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => {
              const allowed = SALES_COMMISSION_TRANSITIONS[r.status] ?? [];
              return (
                <tr key={r.id}>
                  <td className="font-mono text-xs"><Link to={`/requests/${r.requestId}`} className="text-violet-700 hover:underline">{r.srNumber ?? `#${r.requestId}`}</Link></td>
                  <td>{r.customerName}</td>
                  <td>{r.salesName ?? "—"}</td>
                  {isCompany && <td>{r.partnerName}</td>}
                  <td className="text-end font-mono">{Number(r.pct).toFixed(2)}%</td>
                  <td className="text-end font-mono text-violet-700 font-semibold">{fmtMoney(r.amount)}</td>
                  <td><span className={pillClassFor(r.status)}>{tStatus(t, "salesCommission", r.status)}</span></td>
                  {canChange && (
                    <td>{allowed.length > 0 ? (
                      <select className="input text-xs"
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          const reason = ["rejected","adjusted"].includes(v) ? prompt(t("requests.reason") as string) ?? "" : undefined;
                          mutate.mutate({ id: r.id, toStatus: v, reason });
                          e.currentTarget.value = "";
                        }}>
                        <option value="">…</option>
                        {allowed.map((s) => <option key={s} value={s}>{tStatus(t, "salesCommission", s)}</option>)}
                      </select>
                    ) : <span className="text-xs text-muted">—</span>}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

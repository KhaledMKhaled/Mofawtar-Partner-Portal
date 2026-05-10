import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { useCurrentUser } from "../hooks/useAuth";
import { SALES_COMMISSION_STATUSES, pillClassFor, tStatus, fmtMoney, type SalesCommissionStatus } from "../lib/financial";

interface Row {
  id: number;
  requestId: number;
  srNumber: string | null;
  partnerName: string | null;
  salesName: string | null;
  customerName: string | null;
  packageName: string | null;
  amount: string;
  status: SalesCommissionStatus;
  createdAt: string;
}

export function SalesCommissionsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["sales-commissions", status],
    queryFn: () => api<Row[]>(`/api/sales-commissions?${new URLSearchParams({ status }).toString()}`),
  });
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
              <th className="text-end">{t("partnerCommissions.amount")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={6 + (isCompany ? 1 : 0)} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={6 + (isCompany ? 1 : 0)} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => {
              return (
                <tr key={r.id}>
                  <td className="font-mono text-xs"><Link to={`/requests/${r.requestId}`} className="text-violet-700 hover:underline">{r.srNumber ?? `#${r.requestId}`}</Link></td>
                  <td>{r.customerName}</td>
                  <td>{r.salesName ?? "—"}</td>
                  {isCompany && <td>{r.partnerName}</td>}
                  <td className="text-end font-mono text-violet-700 font-semibold">{fmtMoney(r.amount)}</td>
                  <td><span className={pillClassFor(r.status)}>{tStatus(t, "salesCommission", r.status)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { FinTabs } from "../components/FinTabs";
import {
  ORDER_PAYMENT_STATUSES, pillClassFor, tStatus, fmtMoney,
  type OrderPaymentStatus,
} from "../lib/financial";

interface Row {
  id: number;
  requestId: number;
  srNumber: string | null;
  partnerName: string | null;
  customerName: string | null;
  taxCardNumber: string | null;
  packageName: string | null;
  grossAmount: string;
  netAmount: string;
  partnerCommissionAmount: string;
  netDueToCompany: string;
  status: OrderPaymentStatus;
  receivedAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = useQuery({
    queryKey: ["payments", { status, from, to }],
    queryFn: () => api<Row[]>(`/api/payments?${new URLSearchParams({ type: "payment_item", status, from, to } as Record<string,string>).toString()}`),
  });

  return (
    <div>
      <PageHeader title={t("nav.payments")} subtitle={t("payments.subtitle")} />
      <FinTabs />
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div>
          <label className="text-xs text-muted block mb-1">{t("common.status")}</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("common.all")}</option>
            {ORDER_PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{tStatus(t, "payment", s)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">{t("common.from")}</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">{t("common.to")}</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("requests.sr")}</th>
              <th>{t("common.customer")}</th>
              <th>{t("common.partner")}</th>
              <th className="text-end">{t("payments.gross")}</th>
              <th className="text-end">{t("payments.commission")}</th>
              <th className="text-end">{t("payments.netDue")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={7} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs"><Link to={`/payments/${r.id}`} className="text-violet-700 hover:underline">{r.srNumber ?? `#${r.requestId}`}</Link></td>
                <td>{r.customerName}</td>
                <td>{r.partnerName}</td>
                <td className="text-end font-mono">{fmtMoney(r.grossAmount)}</td>
                <td className="text-end font-mono text-violet-700">{fmtMoney(r.partnerCommissionAmount)}</td>
                <td className="text-end font-mono">{fmtMoney(r.netDueToCompany)}</td>
                <td><span className={pillClassFor(r.status)}>{tStatus(t, "payment", r.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

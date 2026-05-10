import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { fmtMoney, fmtDate } from "../lib/financial";

interface Row {
  id: number; settlementNumber: string; type: string;
  partnerId: number; partnerName: string | null;
  claimId: number | null; totalAmount: string; direction: string;
  completedAt: string | null; createdAt: string;
}

export function SettlementsPage() {
  const { t } = useTranslation();
  const [type, setType] = useState("");
  const list = useQuery({
    queryKey: ["settlements", type],
    queryFn: () => api<Row[]>(`/api/settlements${type ? `?type=${type}` : ""}`),
  });

  return (
    <div>
      <PageHeader title={t("nav.settlements")} subtitle={t("settlements.subtitle")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { v: "", label: t("common.all") },
          { v: "payment", label: t("financial.claimTypes.payment") },
          { v: "partner_commission", label: t("financial.claimTypes.partner_commission") },
          { v: "sales_commission", label: t("financial.claimTypes.sales_commission") },
        ].map((opt) => (
          <button
            key={opt.v}
            onClick={() => setType(opt.v)}
            className={`px-3 py-1 rounded-md text-sm border ${type === opt.v ? "bg-violet-600 text-white border-violet-700" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}
          >{opt.label}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>{t("settlements.number")}</th>
            <th>{t("common.type")}</th>
            <th>{t("common.partner")}</th>
            <th className="text-end">{t("settlements.totalAmount")}</th>
            <th>{t("settlements.direction")}</th>
            <th>{t("common.createdAt")}</th>
          </tr></thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={6} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-xs"><Link to={`/settlements/${s.id}`} className="text-violet-700 hover:underline">{s.settlementNumber}</Link></td>
                <td><span className="pill-violet">{t(`financial.claimTypes.${s.type}`)}</span></td>
                <td>{s.partnerName}</td>
                <td className="text-end font-mono font-bold">{fmtMoney(s.totalAmount)}</td>
                <td>{t(`settlements.directions.${s.direction}`)}</td>
                <td className="text-xs text-muted">{fmtDate(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface DetailResp {
  settlement: Row;
  payments: Array<{ id: number; grossAmount: string; netDueToCompany: string }>;
  commissions: Array<{ id: number; amount: string }>;
  salesCommissions: Array<{ id: number; amount: string }>;
}

export function SettlementDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: ["settlement", id],
    queryFn: () => api<DetailResp>(`/api/settlements/${id}`),
    enabled: !!id,
  });
  if (!detail.data) return <div className="text-center text-muted py-12">{t("common.loading")}</div>;
  const { settlement, payments, commissions, salesCommissions } = detail.data;
  return (
    <div>
      <PageHeader title={`${t("settlements.number")} ${settlement.settlementNumber}`} />
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("common.type")}</div><div className="mt-1"><span className="pill-violet">{t(`financial.claimTypes.${settlement.type}`)}</span></div></div>
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("settlements.totalAmount")}</div><div className="font-mono font-bold text-2xl">{fmtMoney(settlement.totalAmount)}</div></div>
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("settlements.direction")}</div><div>{t(`settlements.directions.${settlement.direction}`)}</div></div>
      </div>
      {settlement.type === "payment" && payments.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-2 mt-6">{t("nav.payments")}</h2>
          <div className="table-wrap mb-6">
            <table className="table">
              <thead><tr><th>#</th><th className="text-end">{t("payments.gross")}</th><th className="text-end">{t("payments.netDue")}</th></tr></thead>
              <tbody>
                {payments.map((p) => <tr key={p.id}><td className="font-mono text-xs">{p.id}</td><td className="text-end font-mono">{fmtMoney(p.grossAmount)}</td><td className="text-end font-mono">{fmtMoney(p.netDueToCompany)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
      {settlement.type === "partner_commission" && commissions.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-2">{t("nav.partner_commissions")}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th className="text-end">{t("partnerCommissions.amount")}</th></tr></thead>
              <tbody>
                {commissions.map((c) => <tr key={c.id}><td className="font-mono text-xs">{c.id}</td><td className="text-end font-mono text-violet-700">{fmtMoney(c.amount)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
      {settlement.type === "sales_commission" && salesCommissions.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-2">{t("nav.sales_commissions")}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th className="text-end">{t("partnerCommissions.amount")}</th></tr></thead>
              <tbody>
                {salesCommissions.map((c) => <tr key={c.id}><td className="font-mono text-xs">{c.id}</td><td className="text-end font-mono text-violet-700">{fmtMoney(c.amount)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

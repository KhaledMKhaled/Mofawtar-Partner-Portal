import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { useCurrentUser, can } from "../hooks/useAuth";
import { fmtMoney, fmtDate } from "../lib/financial";

interface Row {
  id: number; settlementNumber: string; partnerId: number; partnerName: string | null;
  claimId: number | null; netDueToCompany: string; partnerCommissionTotal: string;
  finalAmount: string; direction: string; completedAt: string | null; createdAt: string;
}

export function SettlementsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [partnerId, setPartnerId] = useState("");
  const list = useQuery({ queryKey: ["settlements"], queryFn: () => api<Row[]>("/api/settlements") });
  const partners = useQuery({
    queryKey: ["partners-lite"],
    queryFn: () => api<Array<{ id: number; name: string }>>("/api/partners"),
    enabled: !!user && (user.roleKey === "company_super_admin" || user.roleKey === "company_accountant"),
  });
  const preview = useQuery({
    queryKey: ["settlement-preview", partnerId],
    queryFn: () => api<{ netDue: number; partnerCommissionTotal: number; finalAmount: number; direction: string; paymentCount: number }>(`/api/settlements/preview?partnerId=${partnerId}`),
    enabled: !!partnerId,
  });
  const create = useMutation({
    mutationFn: () => api<{ id: number; settlementNumber: string }>("/api/settlements", { method: "POST", json: { partnerId: Number(partnerId) } }),
    onSuccess: () => { setPartnerId(""); qc.invalidateQueries({ queryKey: ["settlements"] }); },
  });

  return (
    <div>
      <PageHeader title={t("nav.settlements")} subtitle={t("settlements.subtitle")} />
      {can(user, "settlements:create") && (
        <div className="stamp-card p-5 mb-6">
          <div className="font-semibold mb-3">{t("settlements.newSettlement")}</div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-muted block mb-1">{t("common.partner")}</label>
              <select className="input" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">—</option>
                {partners.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={!partnerId || create.isPending} onClick={() => create.mutate()}>{t("settlements.complete")}</button>
          </div>
          {partnerId && preview.data && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="stamp-card p-3"><div className="text-xs text-muted">{t("settlements.netDue")}</div><div className="font-mono font-semibold">{fmtMoney(preview.data.netDue)}</div></div>
              <div className="stamp-card p-3"><div className="text-xs text-muted">{t("settlements.commissionTotal")}</div><div className="font-mono font-semibold text-violet-700">{fmtMoney(preview.data.partnerCommissionTotal)}</div></div>
              <div className="stamp-card p-3"><div className="text-xs text-muted">{t("settlements.finalAmount")}</div><div className="font-mono font-bold text-lg">{fmtMoney(preview.data.finalAmount)}</div></div>
              <div className="stamp-card p-3"><div className="text-xs text-muted">{t("settlements.direction")}</div><div>{t(`settlements.directions.${preview.data.direction}`)}</div></div>
            </div>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>{t("settlements.number")}</th><th>{t("common.partner")}</th>
            <th className="text-end">{t("settlements.netDue")}</th>
            <th className="text-end">{t("settlements.commissionTotal")}</th>
            <th className="text-end">{t("settlements.finalAmount")}</th>
            <th>{t("settlements.direction")}</th>
            <th>{t("common.createdAt")}</th>
          </tr></thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={7} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-xs"><Link to={`/settlements/${s.id}`} className="text-violet-700 hover:underline">{s.settlementNumber}</Link></td>
                <td>{s.partnerName}</td>
                <td className="text-end font-mono">{fmtMoney(s.netDueToCompany)}</td>
                <td className="text-end font-mono text-violet-700">{fmtMoney(s.partnerCommissionTotal)}</td>
                <td className="text-end font-mono font-bold">{fmtMoney(s.finalAmount)}</td>
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

export function SettlementDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: ["settlement", id],
    queryFn: () => api<{ settlement: any; payments: any[]; commissions: any[] }>(`/api/settlements/${id}`),
    enabled: !!id,
  });
  if (!detail.data) return <div className="text-center text-muted py-12">{t("common.loading")}</div>;
  const { settlement, payments, commissions } = detail.data;
  return (
    <div>
      <PageHeader title={`${t("settlements.number")} ${settlement.settlementNumber}`} />
      <div className="grid md:grid-cols-4 gap-3 mb-4">
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("settlements.netDue")}</div><div className="font-mono font-semibold">{fmtMoney(settlement.netDueToCompany)}</div></div>
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("settlements.commissionTotal")}</div><div className="font-mono font-semibold text-violet-700">{fmtMoney(settlement.partnerCommissionTotal)}</div></div>
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("settlements.finalAmount")}</div><div className="font-mono font-bold text-lg">{fmtMoney(settlement.finalAmount)}</div></div>
        <div className="stamp-card p-4"><div className="text-xs text-muted">{t("settlements.direction")}</div><div>{t(`settlements.directions.${settlement.direction}`)}</div></div>
      </div>
      <h2 className="text-lg font-semibold mb-2 mt-6">{t("nav.payments")}</h2>
      <div className="table-wrap mb-6">
        <table className="table">
          <thead><tr><th>#</th><th className="text-end">{t("payments.gross")}</th><th className="text-end">{t("payments.netDue")}</th></tr></thead>
          <tbody>
            {payments.map((p: any) => <tr key={p.id}><td className="font-mono text-xs">{p.id}</td><td className="text-end font-mono">{fmtMoney(p.grossAmount)}</td><td className="text-end font-mono">{fmtMoney(p.netDueToCompany)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <h2 className="text-lg font-semibold mb-2">{t("nav.partner_commissions")}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th className="text-end">{t("partnerCommissions.amount")}</th></tr></thead>
          <tbody>
            {commissions.map((c: any) => <tr key={c.id}><td className="font-mono text-xs">{c.id}</td><td className="text-end font-mono text-violet-700">{fmtMoney(c.amount)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

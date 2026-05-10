import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { useCurrentUser, can } from "../hooks/useAuth";
import { pillClassFor, fmtMoney, fmtDate } from "../lib/financial";

interface Row {
  id: number; batchNumber: string; partnerId: number; partnerName: string | null;
  cycle: string; status: string; totalAmount: string;
  approvedAt: string | null; paidAt: string | null; createdAt: string;
}

export function PayoutBatchesPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [partnerId, setPartnerId] = useState("");
  const [cycle, setCycle] = useState<"monthly"|"quarterly">("monthly");
  const [selectedSc, setSelectedSc] = useState<Set<number>>(new Set());

  const list = useQuery({
    queryKey: ["payout-batches"],
    queryFn: () => api<Row[]>("/api/payout-batches"),
  });
  const partners = useQuery({
    queryKey: ["partners-lite"],
    queryFn: () => api<Array<{ id: number; name: string }>>("/api/partners"),
    enabled: !!user && (user.roleKey === "company_super_admin" || user.roleKey === "company_accountant"),
  });
  const eligible = useQuery({
    queryKey: ["payout-eligible", partnerId],
    queryFn: () => api<Array<{ id: number; salesName: string | null; customerName: string | null; packageName: string | null; amount: string }>>(`/api/payout-batches/eligible?partnerId=${partnerId}`),
    enabled: !!partnerId,
  });
  const create = useMutation({
    mutationFn: () => api<{ id: number; batchNumber: string }>("/api/payout-batches", { method: "POST", json: { partnerId: Number(partnerId), cycle, salesCommissionIds: [...selectedSc] } }),
    onSuccess: () => { setSelectedSc(new Set()); qc.invalidateQueries({ queryKey: ["payout-batches"] }); qc.invalidateQueries({ queryKey: ["payout-eligible"] }); },
  });
  const promote = useMutation({
    mutationFn: () => api(`/api/payout-batches/promote-eligible`, { method: "POST", json: { partnerId: Number(partnerId) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payout-eligible"] }),
  });

  return (
    <div>
      <PageHeader title={t("nav.payout_batches")} subtitle={t("payoutBatches.subtitle")} />
      <div className="stamp-card p-4 mb-4 bg-amber-50/60 border-amber-200">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-amber-900">{t("payoutBatches.deprecatedNotice")}</div>
          <Link to="/claims?type=sales_commission" className="btn-primary whitespace-nowrap">{t("payoutBatches.goToClaims")}</Link>
        </div>
      </div>
      {can(user, "payout_batches:create") && (
        <div className="stamp-card p-5 mb-6">
          <div className="font-semibold mb-3">{t("payoutBatches.newBatch")}</div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-muted block mb-1">{t("common.partner")}</label>
              <select className="input" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">—</option>
                {partners.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">{t("payoutBatches.cycle")}</label>
              <select className="input" value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)}>
                <option value="monthly">{t("partners.monthly")}</option>
                <option value="quarterly">{t("partners.quarterly")}</option>
              </select>
            </div>
            <button className="btn-secondary" disabled={!partnerId || promote.isPending} onClick={() => promote.mutate()}>
              {t("payoutBatches.promoteAll")}
            </button>
            <button className="btn-primary" disabled={selectedSc.size === 0 || create.isPending} onClick={() => create.mutate()}>
              {t("payoutBatches.create", { count: selectedSc.size })}
            </button>
          </div>
          {partnerId && (
            <div className="mt-4 table-wrap">
              <table className="table">
                <thead><tr><th></th><th>{t("salesCommissions.salesName")}</th><th>{t("common.customer")}</th><th>{t("packages.title")}</th><th className="text-end">{t("partnerCommissions.amount")}</th></tr></thead>
                <tbody>
                  {eligible.data?.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted">{t("common.noData")}</td></tr>}
                  {eligible.data?.map((e) => (
                    <tr key={e.id}>
                      <td><input type="checkbox" checked={selectedSc.has(e.id)} onChange={(ev) => {
                        const next = new Set(selectedSc);
                        ev.target.checked ? next.add(e.id) : next.delete(e.id);
                        setSelectedSc(next);
                      }} /></td>
                      <td>{e.salesName}</td>
                      <td>{e.customerName}</td>
                      <td>{e.packageName}</td>
                      <td className="text-end font-mono">{fmtMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>{t("payoutBatches.number")}</th><th>{t("common.partner")}</th>
            <th>{t("payoutBatches.cycle")}</th>
            <th className="text-end">{t("partnerCommissions.amount")}</th>
            <th>{t("common.status")}</th>
            <th>{t("payoutBatches.paidAt")}</th>
            <th>{t("common.actions")}</th>
          </tr></thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={7} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((b) => (
              <tr key={b.id}>
                <td className="font-mono text-xs"><Link to={`/payout-batches/${b.id}`} className="text-violet-700 hover:underline">{b.batchNumber}</Link></td>
                <td>{b.partnerName}</td>
                <td>{t(`partners.${b.cycle}`)}</td>
                <td className="text-end font-mono font-semibold">{fmtMoney(b.totalAmount)}</td>
                <td><span className={pillClassFor(b.status)}>{t(`financial.payoutBatchStatuses.${b.status}`)}</span></td>
                <td className="text-xs text-muted">{fmtDate(b.paidAt)}</td>
                <td><Link to={`/payout-batches/${b.id}`} className="text-violet-700 text-sm hover:underline">{t("common.view")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface BatchDetail {
  batch: { id: number; batchNumber: string; partnerId: number; cycle: string; status: string; totalAmount: string; notes: string | null; approvedAt: string | null; paidAt: string | null; createdAt: string };
  items: Array<{ id: number; salesCommissionId: number; amount: string; salesName: string | null; customerName: string | null; packageName: string | null }>;
}
export function PayoutBatchDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["payout-batch", id], queryFn: () => api<BatchDetail>(`/api/payout-batches/${id}`), enabled: !!id });
  const approve = useMutation({
    mutationFn: () => api(`/api/payout-batches/${id}/approve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payout-batch", id] }),
  });
  const pay = useMutation({
    mutationFn: () => api(`/api/payout-batches/${id}/pay`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payout-batch", id] }),
  });
  if (!detail.data) return <div className="text-center text-muted py-12">{t("common.loading")}</div>;
  const { batch, items } = detail.data;
  const isCompanyAcct = user?.roleKey === "company_super_admin" || user?.roleKey === "company_accountant";
  return (
    <div>
      <PageHeader
        title={`${t("payoutBatches.number")} ${batch.batchNumber}`}
        actions={isCompanyAcct ? (
          <div className="flex gap-2">
            {batch.status === "draft" && <button className="btn-primary" onClick={() => approve.mutate()}>{t("payoutBatches.approve")}</button>}
            {batch.status === "approved" && <button className="btn-primary" onClick={() => pay.mutate()}>{t("payoutBatches.markPaid")}</button>}
          </div>
        ) : null}
      />
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div className="stamp-card p-5"><div className="text-xs text-muted">{t("common.status")}</div><div className="mt-2"><span className={pillClassFor(batch.status)}>{t(`financial.payoutBatchStatuses.${batch.status}`)}</span></div></div>
        <div className="stamp-card p-5"><div className="text-xs text-muted">{t("partnerCommissions.amount")}</div><div className="text-2xl font-bold text-violet-700 mt-1">{fmtMoney(batch.totalAmount)}</div></div>
        <div className="stamp-card p-5"><div className="text-xs text-muted">{t("payoutBatches.cycle")}</div><div className="text-lg mt-1">{t(`partners.${batch.cycle}`)}</div></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t("salesCommissions.salesName")}</th><th>{t("common.customer")}</th><th>{t("packages.title")}</th><th className="text-end">{t("partnerCommissions.amount")}</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.salesName}</td><td>{i.customerName}</td><td>{i.packageName}</td>
                <td className="text-end font-mono">{fmtMoney(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

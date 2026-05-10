import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { FinTabs } from "../components/FinTabs";
import { useCurrentUser, can } from "../hooks/useAuth";
import {
  PARTNER_COMMISSION_STATUSES, pillClassFor, tStatus, fmtMoney, fmtDate,
  type PartnerCommissionStatus,
} from "../lib/financial";

interface Row {
  id: number;
  requestId: number;
  srNumber: string | null;
  partnerName: string | null;
  customerName: string | null;
  packageName: string | null;
  baseAmount: string;
  pct: string;
  amount: string;
  safetyEndsAt: string | null;
  isVoided?: boolean;
  status: PartnerCommissionStatus;
  claimId: number | null;
  createdAt: string;
}

function isClaimable(r: Row): boolean {
  if (r.status !== "not_added_to_claim") return false;
  if (r.isVoided) return false;
  if (r.safetyEndsAt && new Date(r.safetyEndsAt).getTime() > Date.now()) return false;
  return true;
}

export function PartnerCommissionsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const list = useQuery({
    queryKey: ["partner-commissions", status],
    queryFn: () => api<Row[]>(`/api/partner-commissions?${new URLSearchParams({ type: "partner_commission_item", status }).toString()}`),
  });
  const createClaim = useMutation({
    mutationFn: (ids: number[]) => api<{ id: number; claimNumber: string }>("/api/claims", { method: "POST", json: { partnerCommissionIds: ids } }),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ["partner-commissions"] }); },
  });
  const canClaim = can(user, "claims:create");

  const eligibleRows = (list.data ?? []).filter(isClaimable);
  const toggleAll = () => {
    if (selected.size === eligibleRows.length) setSelected(new Set());
    else setSelected(new Set(eligibleRows.map((r) => r.id)));
  };

  return (
    <div>
      <PageHeader
        title={t("nav.partner_commissions")}
        subtitle={t("partnerCommissions.subtitle")}
        actions={canClaim && selected.size > 0 ? (
          <button className="btn-primary" disabled={createClaim.isPending} onClick={() => createClaim.mutate([...selected])}>
            {t("claims.createFromSelected", { count: selected.size })}
          </button>
        ) : null}
      />
      <FinTabs />
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.all")}</option>
          {PARTNER_COMMISSION_STATUSES.map((s) => <option key={s} value={s}>{tStatus(t, "partnerCommission", s)}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={eligibleRows.length > 0 && selected.size === eligibleRows.length} onChange={toggleAll} /></th>
              <th>{t("requests.sr")}</th>
              <th>{t("common.customer")}</th>
              <th>{t("common.partner")}</th>
              <th className="text-end">{t("partnerCommissions.base")}</th>
              <th className="text-end">{t("partnerCommissions.pct")}</th>
              <th className="text-end">{t("partnerCommissions.amount")}</th>
              <th>{t("partnerCommissions.safetyEnds")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={9} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => {
              const eligible = isClaimable(r);
              const pctNum = Number(r.pct);
              return (
                <tr key={r.id}>
                  <td>{eligible ? (
                    <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => {
                      const next = new Set(selected);
                      e.target.checked ? next.add(r.id) : next.delete(r.id);
                      setSelected(next);
                    }} />
                  ) : null}</td>
                  <td className="font-mono text-xs"><Link to={`/requests/${r.requestId}`} className="text-violet-700 hover:underline">{r.srNumber ?? `#${r.requestId}`}</Link></td>
                  <td>{r.customerName}</td>
                  <td>{r.partnerName}</td>
                  <td className="text-end font-mono">{fmtMoney(r.baseAmount)}</td>
                  <td className="text-end font-mono">{Number.isFinite(pctNum) ? `${pctNum.toFixed(2)}%` : "—"}</td>
                  <td className="text-end font-mono text-violet-700 font-semibold">{fmtMoney(r.amount)}</td>
                  <td className="text-xs">{r.safetyEndsAt ? fmtDate(r.safetyEndsAt) : "—"}</td>
                  <td><span className={pillClassFor(r.status)}>{tStatus(t, "partnerCommission", r.status)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

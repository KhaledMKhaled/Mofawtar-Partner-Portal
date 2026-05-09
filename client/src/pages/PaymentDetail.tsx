import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { useCurrentUser, can } from "../hooks/useAuth";
import {
  ORDER_PAYMENT_TRANSITIONS, pillClassFor, tStatus, fmtMoney, fmtDate,
  type OrderPaymentStatus,
} from "../lib/financial";

interface PaymentDetail {
  payment: {
    id: number;
    requestId: number;
    customerId: number;
    partnerId: number;
    packageId: number;
    grossAmount: string;
    taxAmount: string;
    netAmount: string;
    partnerCommissionAmount: string;
    netDueToCompany: string;
    status: OrderPaymentStatus;
    receivedAt: string | null;
    settledAt: string | null;
    createdAt: string;
  };
  history: Array<{
    id: number;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
    userName: string | null;
  }>;
}

export function PaymentDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["payment", id],
    queryFn: () => api<PaymentDetail>(`/api/payments/${id}`),
    enabled: !!id,
  });
  const mutate = useMutation({
    mutationFn: (vars: { toStatus: string; reason?: string }) =>
      api(`/api/payments/${id}/transition`, { method: "POST", json: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment", id] }),
  });

  if (detail.isLoading || !detail.data) return <div className="text-center text-muted py-12">{t("common.loading")}</div>;
  const { payment, history } = detail.data;
  const allowed = ORDER_PAYMENT_TRANSITIONS[payment.status] ?? [];
  const canChange = can(user, "payments:change_status");
  const isCompany = user?.roleKey === "company_super_admin" || user?.roleKey === "company_accountant";
  const visibleAllowed = allowed.filter((s) => isCompany || (s !== "received_by_company" && s !== "settled"));

  return (
    <div>
      <PageHeader
        title={`${t("nav.payments")} #${payment.id}`}
        subtitle={`${t("requests.sr")} #${payment.requestId}`}
        actions={
          canChange && visibleAllowed.length > 0 ? (
            <select className="input"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const reason = ["refunded", "cancelled"].includes(v) ? prompt(t("requests.reason") as string) ?? "" : undefined;
                mutate.mutate({ toStatus: v, reason });
                e.currentTarget.value = "";
              }}>
              <option value="">{t("requests.changeStatus")}…</option>
              {visibleAllowed.map((s) => <option key={s} value={s}>{tStatus(t, "payment", s)}</option>)}
            </select>
          ) : null
        }
      />
      <div className="grid md:grid-cols-4 gap-4 mb-4">
        <div className="stamp-card p-5">
          <div className="text-xs text-muted">{t("common.status")}</div>
          <div className="mt-2"><span className={pillClassFor(payment.status)}>{tStatus(t, "payment", payment.status)}</span></div>
        </div>
        <div className="stamp-card p-5">
          <div className="text-xs text-muted">{t("payments.gross")}</div>
          <div className="text-xl font-bold mt-1">{fmtMoney(payment.grossAmount)}</div>
        </div>
        <div className="stamp-card p-5">
          <div className="text-xs text-muted">{t("payments.commission")}</div>
          <div className="text-xl font-bold text-violet-700 mt-1">{fmtMoney(payment.partnerCommissionAmount)}</div>
        </div>
        <div className="stamp-card p-5">
          <div className="text-xs text-muted">{t("payments.netDue")}</div>
          <div className="text-xl font-bold mt-1">{fmtMoney(payment.netDueToCompany)}</div>
        </div>
      </div>
      <div className="stamp-card p-4 mb-4">
        <div className="text-sm font-semibold mb-3">{t("payments.breakdown")}</div>
        <dl className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{t("payments.netAmount")}</dt><dd className="font-mono">{fmtMoney(payment.netAmount)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("payments.tax")}</dt><dd className="font-mono">{fmtMoney(payment.taxAmount)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("payments.gross")}</dt><dd className="font-mono">{fmtMoney(payment.grossAmount)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("payments.commission")}</dt><dd className="font-mono text-violet-700">{fmtMoney(payment.partnerCommissionAmount)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("payments.netDue")}</dt><dd className="font-mono font-semibold">{fmtMoney(payment.netDueToCompany)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("payments.receivedAt")}</dt><dd>{fmtDate(payment.receivedAt)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("payments.settledAt")}</dt><dd>{fmtDate(payment.settledAt)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t("common.createdAt")}</dt><dd>{fmtDate(payment.createdAt)}</dd></div>
        </dl>
      </div>
      <div className="stamp-card p-4">
        <div className="text-sm font-semibold mb-3">{t("payments.history")}</div>
        <div className="table-wrap">
          <table className="table text-sm">
            <thead><tr><th>{t("auditLog.when")}</th><th>{t("auditLog.who")}</th><th>{t("payments.transition")}</th><th>{t("requests.reason")}</th></tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-muted">{t("common.noData")}</td></tr>}
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="text-xs">{fmtDate(h.createdAt)}</td>
                  <td>{h.userName ?? "—"}</td>
                  <td>
                    <span className="text-xs text-muted">{h.fromStatus ? tStatus(t, "payment", h.fromStatus as OrderPaymentStatus) : "—"}</span>
                    {" → "}
                    <span className={pillClassFor(h.toStatus)}>{tStatus(t, "payment", h.toStatus as OrderPaymentStatus)}</span>
                  </td>
                  <td className="text-xs">{h.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

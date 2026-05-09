import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { ArrowLeft } from "lucide-react";
import { useCurrentUser, can } from "../hooks/useAuth";
import { ALLOWED_TRANSITIONS, REOPEN_TARGETS, type RequestStatus } from "../../../shared/requests";

interface Detail {
  request: {
    id: number;
    srNumber: string;
    status: RequestStatus;
    paymentStatus: string;
    operationType: string | null;
    realReceiptNumber: string | null;
    rejectionReason: string | null;
    partnerId: number;
    partnerName: string | null;
    customerId: number;
    customerName: string | null;
    taxCardNumber: string | null;
    packageId: number | null;
    packageName: string | null;
    finalPrice: string | null;
    salesUserId: number | null;
    salesName: string | null;
    teamLeaderId: number | null;
    submittedAt: string | null;
    activatedAt: string | null;
    createdAt: string;
  };
  history: { id: number; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; userName: string | null }[];
  reassignments: { id: number; fromSalesUserId: number | null; toSalesUserId: number | null; reason: string | null; createdAt: string }[];
}

export function RequestDetailPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const { id } = useParams();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["request", id],
    queryFn: () => api<Detail>(`/api/requests/${id}`),
    enabled: !!id,
  });

  const [showAction, setShowAction] = useState<"" | "transition" | "reopen" | "reassign">("");
  const [toStatus, setToStatus] = useState<RequestStatus | "">("");
  const [reason, setReason] = useState("");
  const [toSalesUserId, setToSalesUserId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  const transition = useMutation({
    mutationFn: () => api(`/api/requests/${id}/transition`, { method: "POST", json: { toStatus, reason } }),
  });
  const reopen = useMutation({
    mutationFn: () => api(`/api/requests/${id}/reopen`, { method: "POST", json: { toStatus, reason } }),
  });
  const reassign = useMutation({
    mutationFn: () => api(`/api/requests/${id}/reassign`, { method: "POST", json: { toSalesUserId, reason } }),
  });

  const partnerUsers = useQuery({
    queryKey: ["users", "for-reassign"],
    queryFn: () => api<{ id: number; name: string }[]>("/api/users"),
    enabled: showAction === "reassign",
  });

  if (q.isLoading) return <div className="text-muted">{t("common.loading")}</div>;
  if (!q.data) return <div className="text-muted">{t("common.noData")}</div>;
  const { request, history, reassignments } = q.data;
  const allowed = ALLOWED_TRANSITIONS[request.status] ?? [];
  const isTerminalFailRej = request.status === "failed" || request.status === "rejected";

  const close = () => {
    setShowAction("");
    setToStatus("");
    setReason("");
    setToSalesUserId("");
    setError(null);
  };

  const runAction = async () => {
    setError(null);
    try {
      if (showAction === "transition") await transition.mutateAsync();
      else if (showAction === "reopen") await reopen.mutateAsync();
      else if (showAction === "reassign") await reassign.mutateAsync();
      qc.invalidateQueries({ queryKey: ["request", id] });
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      close();
    } catch (e) {
      setError(e instanceof ApiError ? (typeof e.body === "object" && e.body?.error) || e.message : String(e));
    }
  };

  return (
    <div>
      <Link to="/requests" className="text-violet-700 text-sm inline-flex items-center gap-1 mb-2">
        <ArrowLeft className="w-4 h-4" /> {t("nav.requests")}
      </Link>
      <PageHeader
        title={request.srNumber}
        subtitle={`${request.customerName ?? ""} · ${request.taxCardNumber ?? ""}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {allowed.length > 0 && can(user, "requests:change_status") && (
              <button className="btn-primary" onClick={() => { setShowAction("transition"); setToStatus(allowed[0]); }}>
                {t("requests.changeStatus")}
              </button>
            )}
            {isTerminalFailRej && can(user, "requests:reopen") && (
              <button className="btn-secondary" onClick={() => { setShowAction("reopen"); setToStatus("draft_sr"); }}>
                {t("requests.reopen")}
              </button>
            )}
            {request.status === "draft_sr" && can(user, "requests:reassign") && (
              <button className="btn-outline" onClick={() => setShowAction("reassign")}>
                {t("requests.reassign")}
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="stamp-card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("requests.summary")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Info label={t("common.status")}>
              <span className={requestPill(request.status)}>{t(`requests.statuses.${request.status}`)}</span>
            </Info>
            <Info label={t("requests.payment")}>
              <span className={request.paymentStatus === "collected_by_sales" ? "pill-success" : "pill-warning"}>
                {t(`requests.paymentStatuses.${request.paymentStatus}`)}
              </span>
            </Info>
            <Info label={t("requests.operationType")}>
              {request.operationType ? t(`operationTypes.${request.operationType}`) : "—"}
            </Info>
            <Info label={t("requests.realReceiptNumber")}>
              <span className="font-mono">{request.realReceiptNumber ?? "—"}</span>
            </Info>
            <Info label={t("common.partner")}>
              <Link to={`/partners/${request.partnerId}`} className="text-violet-700 hover:underline">{request.partnerName}</Link>
            </Info>
            <Info label={t("requests.customer")}>
              <Link to={`/customers/${request.customerId}`} className="text-violet-700 hover:underline">{request.customerName}</Link>
            </Info>
            <Info label={t("requests.package")}>{request.packageName ?? "—"}</Info>
            <Info label={t("requests.amount")}>
              <span className="font-mono">{request.finalPrice ? Number(request.finalPrice).toFixed(2) : "—"}</span>
            </Info>
            <Info label={t("requests.sales")}>{request.salesName ?? "—"}</Info>
            <Info label={t("common.createdAt")}>
              <span className="text-xs">{new Date(request.createdAt).toLocaleString(isAr ? "ar" : "en")}</span>
            </Info>
            {request.submittedAt && (
              <Info label={t("requests.submittedAt")}>
                <span className="text-xs">{new Date(request.submittedAt).toLocaleString(isAr ? "ar" : "en")}</span>
              </Info>
            )}
            {request.activatedAt && (
              <Info label={t("requests.activatedAt")}>
                <span className="text-xs">{new Date(request.activatedAt).toLocaleString(isAr ? "ar" : "en")}</span>
              </Info>
            )}
            {request.rejectionReason && (
              <Info label={t("requests.rejectionReason")}>
                <span className="text-red-700 text-sm">{request.rejectionReason}</span>
              </Info>
            )}
          </div>
        </div>

        <div className="stamp-card p-5">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("requests.timeline")}</h3>
          <ul className="space-y-3 text-sm">
            {history.map((e) => (
              <li key={e.id} className="border-s-2 border-violet-200 ps-3">
                <div className="text-xs text-muted">{new Date(e.createdAt).toLocaleString(isAr ? "ar" : "en")}</div>
                <div>
                  {e.fromStatus ? `${t(`requests.statuses.${e.fromStatus}`)} → ` : ""}
                  {t(`requests.statuses.${e.toStatus}`)}
                </div>
                {e.userName && <div className="text-xs text-muted">{e.userName}</div>}
                {e.reason && <div className="text-xs italic">{e.reason}</div>}
              </li>
            ))}
          </ul>
          {reassignments.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-muted uppercase mb-2">{t("requests.reassignments")}</h4>
              <ul className="space-y-2 text-sm">
                {reassignments.map((r) => (
                  <li key={r.id} className="text-xs">
                    {new Date(r.createdAt).toLocaleString(isAr ? "ar" : "en")} — #{r.fromSalesUserId ?? "—"} → #{r.toSalesUserId}
                    {r.reason && <span className="italic"> · {r.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!showAction}
        onClose={close}
        title={
          showAction === "transition" ? t("requests.changeStatus") :
          showAction === "reopen" ? t("requests.reopen") :
          showAction === "reassign" ? t("requests.reassign") : ""
        }
        footer={
          <>
            <button className="btn-outline" onClick={close}>{t("common.cancel")}</button>
            <button
              className="btn-primary"
              disabled={transition.isPending || reopen.isPending || reassign.isPending}
              onClick={runAction}
            >
              {t("common.confirm")}
            </button>
          </>
        }
      >
        {error && <div className="mb-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{t(`wizard.errors.${error}`, error)}</div>}
        {showAction === "transition" && (
          <div className="space-y-3">
            <Field label={t("requests.newStatus")} required>
              <select className="input" value={toStatus} onChange={(e) => setToStatus(e.target.value as RequestStatus)}>
                {allowed.map((s) => <option key={s} value={s}>{t(`requests.statuses.${s}`)}</option>)}
              </select>
            </Field>
            <Field
              label={t("requests.reason")}
              required={toStatus === "failed" || toStatus === "rejected"}
              hint={toStatus === "failed" || toStatus === "rejected" ? t("requests.reasonRequired") : ""}
            >
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
        {showAction === "reopen" && (
          <div className="space-y-3">
            <Field label={t("requests.reopenTarget")} required>
              <select className="input" value={toStatus} onChange={(e) => setToStatus(e.target.value as RequestStatus)}>
                {REOPEN_TARGETS.map((s) => <option key={s} value={s}>{t(`requests.statuses.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={t("requests.reason")} required>
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
        {showAction === "reassign" && (
          <div className="space-y-3">
            <Field label={t("requests.reassignTo")} required>
              <select className="input" value={toSalesUserId} onChange={(e) => setToSalesUserId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">—</option>
                {partnerUsers.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label={t("requests.reason")}>
              <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
function requestPill(s: string) {
  if (s === "activated") return "pill-success";
  if (s === "rejected" || s === "failed") return "pill-danger";
  if (s === "under_activation" || s === "received") return "pill-violet";
  if (s === "draft_sr") return "pill-muted";
  return "pill-warning";
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Plus, Search, X } from "lucide-react";
import { RequestWizard } from "../components/RequestWizard";
import { Modal } from "../components/Modal";
import { Field } from "../components/Field";
import { useCurrentUser, can } from "../hooks/useAuth";
import {
  REQUEST_STATUSES,
  OPERATION_TYPES,
  ALLOWED_TRANSITIONS,
  type RequestStatus,
} from "../../../shared/requests";

interface Row {
  id: number;
  srNumber: string;
  status: string;
  paymentStatus: string;
  operationType: string | null;
  partnerName: string | null;
  customerName: string | null;
  taxCardNumber: string | null;
  packageName: string | null;
  finalPrice: string | null;
  salesName: string | null;
  createdAt: string;
  submittedAt: string | null;
  activatedAt: string | null;
}

// All statuses that may appear as a transition target across the
// non-terminal source statuses. Server enforces per-row validity.
const BULK_TARGETS: RequestStatus[] = ["received", "under_activation", "activated", "failed", "rejected"];

export function RequestsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [operationType, setOperationType] = useState("");
  const [q, setQ] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [salesUserId, setSalesUserId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

  // Bulk-selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTo, setBulkTo] = useState<RequestStatus | "">("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const isCompany = user?.roleKey === "company_super_admin" || user?.roleKey === "company_accountant";
  const partnersQ = useQuery({
    queryKey: ["partners-min"],
    queryFn: () => api<{ id: number; name: string }[]>("/api/partners"),
    enabled: isCompany,
  });
  const salesQ = useQuery({
    queryKey: ["sales-assignable", partnerId],
    queryFn: () => api<{ id: number; name: string }[]>(`/api/users/sales-assignable${partnerId ? `?partnerId=${partnerId}` : ""}`),
    enabled: !!user && (isCompany ? !!partnerId : true),
  });
  const packagesQ = useQuery({
    queryKey: ["packages-min"],
    queryFn: () => api<{ id: number; name: string }[]>("/api/packages"),
  });

  const list = useQuery({
    queryKey: ["requests", { status, operationType, q, partnerId, salesUserId, packageId, fromDate, toDate }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
      if (operationType) p.set("operationType", operationType);
      if (q) p.set("q", q);
      if (partnerId) p.set("partnerId", partnerId);
      if (salesUserId) p.set("salesUserId", salesUserId);
      if (packageId) p.set("packageId", packageId);
      if (fromDate) p.set("fromDate", fromDate);
      if (toDate) p.set("toDate", toDate);
      return api<Row[]>(`/api/requests?${p.toString()}`);
    },
  });

  const canChangeStatus = can(user, "requests:change_status");
  const rows = list.data ?? [];

  // Whenever the visible rows change (filters, refetch, status changes after
  // a bulk update), prune the selection so it can never contain ids that the
  // user can no longer see. This keeps the action-bar count, the select-all
  // indeterminate state, and the modal's eligibility list all consistent
  // with the request payload that will actually be sent.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visible = new Set(rows.map((r) => r.id));
    let changed = false;
    const next = new Set<number>();
    for (const id of selectedIds) {
      if (visible.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedIds(next);
  }, [rows, selectedIds]);

  // Restrict the bulk-target options to the INTERSECTION of allowed
  // transitions across every selected row. Showing a target that only
  // applies to some rows would guarantee partial failures, so we only
  // surface targets every selected row supports. The server still
  // validates per-row defensively.
  const eligibleTargets = useMemo<RequestStatus[]>(() => {
    if (selectedIds.size === 0) return [];
    const selectedRows = rows.filter((r) => selectedIds.has(r.id));
    if (selectedRows.length === 0) return [];
    let intersection: Set<RequestStatus> | null = null;
    for (const r of selectedRows) {
      const allowed = new Set<RequestStatus>(ALLOWED_TRANSITIONS[r.status as RequestStatus] ?? []);
      if (intersection === null) intersection = allowed;
      else for (const s of intersection) if (!allowed.has(s)) intersection.delete(s);
      if (intersection.size === 0) break;
    }
    return BULK_TARGETS.filter((s) => intersection?.has(s));
  }, [rows, selectedIds]);

  const toggleAll = (checked: boolean) => {
    if (!checked) { setSelectedIds(new Set()); return; }
    setSelectedIds(new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someChecked = selectedIds.size > 0 && !allChecked;

  const bulkMut = useMutation({
    mutationFn: (payload: { ids: number[]; toStatus: RequestStatus; reason: string | null }) =>
      api<{ total: number; succeeded: number; failed: number; results: { id: number; ok: boolean; error?: string }[] }>(
        "/api/requests/bulk-transition",
        { method: "POST", json: payload },
      ),
  });

  const openBulk = () => {
    setBulkTo("");
    setBulkReason("");
    setBulkSummary(null);
    setBulkError(null);
    setBulkOpen(true);
  };
  const closeBulk = () => {
    setBulkOpen(false);
    setBulkSummary(null);
    setBulkError(null);
  };
  const runBulk = async () => {
    setBulkError(null);
    setBulkSummary(null);
    if (!bulkTo) return;
    if ((bulkTo === "failed" || bulkTo === "rejected") && !bulkReason.trim()) {
      setBulkError("reason_required");
      return;
    }
    try {
      const ids = Array.from(selectedIds);
      const r = await bulkMut.mutateAsync({ ids, toStatus: bulkTo, reason: bulkReason.trim() || null });
      setBulkSummary(t("requests.bulkResult", { succeeded: r.succeeded, total: r.total, failed: r.failed }));
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // Drop ids that succeeded so a retry only targets the failures.
      const failedIds = new Set(r.results.filter((x) => !x.ok).map((x) => x.id));
      setSelectedIds(failedIds);
    } catch (e) {
      setBulkError(e instanceof ApiError ? (typeof e.body === "object" && e.body?.error) || e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
        actions={
          can(user, "requests:create") && (
            <button className="btn-primary" onClick={() => setWizardOpen(true)}>
              <Plus className="w-4 h-4" /> {t("wizard.openCta")}
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input className="input ps-9" placeholder={t("requests.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("requests.allStatuses")}</option>
          {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{t(`requests.statuses.${s}`)}</option>)}
        </select>
        <select className="input" value={operationType} onChange={(e) => setOperationType(e.target.value)}>
          <option value="">{t("requests.allOperations")}</option>
          {OPERATION_TYPES.map((o) => <option key={o} value={o}>{t(`operationTypes.${o}`)}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {isCompany && (
          <select className="input" value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setSalesUserId(""); }}>
            <option value="">{t("requests.allPartners")}</option>
            {partnersQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select className="input" value={salesUserId} onChange={(e) => setSalesUserId(e.target.value)}>
          <option value="">{t("requests.allSales")}</option>
          {salesQ.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
          <option value="">{t("requests.allPackages")}</option>
          {packagesQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title={t("requests.fromDate")} />
        <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} title={t("requests.toDate")} />
      </div>

      {canChangeStatus && selectedIds.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
          <div className="text-violet-800">{t("requests.selectedCount", { count: selectedIds.size })}</div>
          <div className="flex items-center gap-2">
            <button className="btn-primary !py-1 !px-3 text-xs" onClick={openBulk}>
              {t("requests.bulkUpdateStatus")}
            </button>
            <button className="btn-ghost !py-1 !px-2 text-xs inline-flex items-center gap-1" onClick={() => setSelectedIds(new Set())}>
              <X className="w-3.5 h-3.5" />
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {canChangeStatus && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="select-all"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
              )}
              <th>{t("requests.sr")}</th>
              <th>{t("common.status")}</th>
              <th>{t("requests.customer")}</th>
              <th>{t("requests.operationType")}</th>
              <th>{t("common.partner")}</th>
              <th>{t("requests.package")}</th>
              <th>{t("requests.amount")}</th>
              <th>{t("requests.sales")}</th>
              <th>{t("common.createdAt")}</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td colSpan={canChangeStatus ? 10 : 9} className="text-center text-muted py-8">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={canChangeStatus ? 10 : 9} className="text-center text-muted py-8">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => (
              <tr key={r.id} className={selectedIds.has(r.id) ? "bg-violet-50/40" : ""}>
                {canChangeStatus && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`select-${r.id}`}
                      checked={selectedIds.has(r.id)}
                      onChange={(e) => toggleOne(r.id, e.target.checked)}
                    />
                  </td>
                )}
                <td className="font-mono text-xs"><Link to={`/requests/${r.id}`} className="text-violet-700 hover:underline">{r.srNumber}</Link></td>
                <td><span className={requestPill(r.status)}>{t(`requests.statuses.${r.status}`)}</span></td>
                <td>
                  <div className="font-medium">{r.customerName}</div>
                  <div className="text-xs text-muted font-mono">{r.taxCardNumber}</div>
                </td>
                <td>{r.operationType ? t(`operationTypes.${r.operationType}`) : "—"}</td>
                <td>{r.partnerName ?? "—"}</td>
                <td>{r.packageName ?? "—"}</td>
                <td className="font-mono">{r.finalPrice ? Number(r.finalPrice).toFixed(2) : "—"}</td>
                <td>{r.salesName ?? "—"}</td>
                <td className="text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RequestWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <Modal
        open={bulkOpen}
        onClose={closeBulk}
        title={t("requests.bulkUpdateStatus")}
        footer={
          <>
            <button className="btn-ghost" onClick={closeBulk} disabled={bulkMut.isPending}>{t("common.cancel")}</button>
            <button className="btn-primary" onClick={runBulk} disabled={!bulkTo || bulkMut.isPending}>
              {bulkMut.isPending ? t("common.loading") : t("common.save")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-muted">
            {t("requests.selectedCount", { count: selectedIds.size })}
          </div>
          <Field label={t("requests.newStatus")} required>
            <select className="input" value={bulkTo} onChange={(e) => setBulkTo(e.target.value as RequestStatus)}>
              <option value="">—</option>
              {eligibleTargets.map((s) => <option key={s} value={s}>{t(`requests.statuses.${s}`)}</option>)}
            </select>
          </Field>
          {eligibleTargets.length === 0 && (
            <div className="text-xs text-amber-700">{t("requests.bulkNoEligible")}</div>
          )}
          <Field
            label={t("requests.reason")}
            required={bulkTo === "failed" || bulkTo === "rejected"}
            hint={bulkTo === "failed" || bulkTo === "rejected" ? t("requests.reasonRequired") : ""}
          >
            <textarea className="input" rows={3} value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} />
          </Field>
          {bulkSummary && (
            <div className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-xs">{bulkSummary}</div>
          )}
          {bulkError && (
            <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">
              {t(`wizard.errors.${bulkError}`, { defaultValue: bulkError })}
            </div>
          )}
        </div>
      </Modal>
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

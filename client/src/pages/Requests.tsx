import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Plus, Search } from "lucide-react";
import { RequestWizard } from "../components/RequestWizard";
import { useCurrentUser, can } from "../hooks/useAuth";
import { REQUEST_STATUSES, OPERATION_TYPES } from "../../../shared/requests";

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

export function RequestsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const [status, setStatus] = useState("");
  const [operationType, setOperationType] = useState("");
  const [q, setQ] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [salesUserId, setSalesUserId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

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

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
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
            {list.isLoading && <tr><td colSpan={9} className="text-center text-muted py-8">{t("common.loading")}</td></tr>}
            {list.data?.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-8">{t("common.noData")}</td></tr>}
            {list.data?.map((r) => (
              <tr key={r.id}>
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

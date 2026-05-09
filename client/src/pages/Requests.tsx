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
  const [wizardOpen, setWizardOpen] = useState(false);
  const list = useQuery({
    queryKey: ["requests", { status, operationType, q }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
      if (operationType) p.set("operationType", operationType);
      if (q) p.set("q", q);
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
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

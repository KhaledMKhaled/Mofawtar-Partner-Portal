import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { ArrowLeft } from "lucide-react";

interface Customer360 {
  customer: {
    id: number;
    taxCardNumber: string;
    name: string;
    contactPerson: string | null;
    contactPhone: string | null;
    email: string | null;
    address: string | null;
    taxOffice: string | null;
    businessActivity: string | null;
    notes: string | null;
  };
  currentOwner: { partnerId: number | null; status: string; endDate: string } | null;
  ownership: {
    id: number;
    partnerId: number | null;
    partnerName: string | null;
    startDate: string;
    endDate: string;
    status: string;
    reason: string | null;
  }[];
  requests: {
    id: number;
    srNumber: string;
    status: string;
    operationType: string | null;
    partnerName: string | null;
    packageName: string | null;
    salesName: string | null;
    paymentStatus: string;
    activatedAt: string | null;
    createdAt: string;
  }[];
  timeline: {
    id: number;
    requestId: number;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
    userName: string | null;
  }[];
  audit: { id: number; action: string; createdAt: string; note: string | null; userName: string | null }[];
}

export function Customer360Page() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<Customer360>(`/api/customers/${id}`),
    enabled: !!id,
  });

  if (q.isLoading) return <div className="text-muted">{t("common.loading")}</div>;
  if (!q.data) return <div className="text-muted">{t("common.noData")}</div>;
  const { customer, currentOwner, ownership, requests, timeline, audit } = q.data;

  return (
    <div>
      <Link to="/customers" className="text-violet-700 text-sm inline-flex items-center gap-1 mb-2">
        <ArrowLeft className="w-4 h-4" /> {t("nav.customers")}
      </Link>
      <PageHeader title={customer.name} subtitle={customer.taxCardNumber} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="stamp-card p-5">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("customers.profile")}</h3>
          <Info label={t("customers.contactPerson")} value={customer.contactPerson} />
          <Info label={t("customers.contactPhone")} value={customer.contactPhone} mono />
          <Info label={t("common.email")} value={customer.email} mono />
          <Info label={t("customers.taxOffice")} value={customer.taxOffice} />
          <Info label={t("customers.businessActivity")} value={customer.businessActivity} />
          <Info label={t("common.address")} value={customer.address} />
        </div>
        <div className="stamp-card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("ownership.current")}</h3>
          {currentOwner ? (
            <div className="text-sm">
              <span className={statusPill(currentOwner.status)}>{t(`ownership.statuses.${currentOwner.status}`)}</span>
              <span className="ms-3 text-muted">
                {t("ownership.until")} {new Date(currentOwner.endDate).toLocaleDateString()}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted">{t("ownership.none")}</div>
          )}
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-muted uppercase mb-2">{t("ownership.history")}</h4>
            <table className="table">
              <thead><tr><th>{t("common.partner")}</th><th>{t("ownership.startDate")}</th><th>{t("ownership.endDate")}</th><th>{t("common.status")}</th></tr></thead>
              <tbody>
                {ownership.length === 0 && <tr><td colSpan={4} className="text-muted text-center py-4">{t("common.noData")}</td></tr>}
                {ownership.map((o) => (
                  <tr key={o.id}>
                    <td>{o.partnerName ?? "—"}</td>
                    <td className="text-xs">{new Date(o.startDate).toLocaleDateString()}</td>
                    <td className="text-xs">{new Date(o.endDate).toLocaleDateString()}</td>
                    <td><span className={statusPill(o.status)}>{t(`ownership.statuses.${o.status}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="stamp-card p-5 mb-6">
        <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("customers.requests")}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>{t("requests.sr")}</th>
              <th>{t("common.status")}</th>
              <th>{t("requests.operationType")}</th>
              <th>{t("common.partner")}</th>
              <th>{t("requests.package")}</th>
              <th>{t("requests.sales")}</th>
              <th>{t("common.createdAt")}</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && <tr><td colSpan={7} className="text-muted text-center py-6">{t("common.noData")}</td></tr>}
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs"><Link className="text-violet-700 hover:underline" to={`/requests/${r.id}`}>{r.srNumber}</Link></td>
                <td><span className={requestPill(r.status)}>{t(`requests.statuses.${r.status}`)}</span></td>
                <td>{r.operationType ? t(`operationTypes.${r.operationType}`) : "—"}</td>
                <td>{r.partnerName ?? "—"}</td>
                <td>{r.packageName ?? "—"}</td>
                <td>{r.salesName ?? "—"}</td>
                <td className="text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="stamp-card p-5">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("requests.timeline")}</h3>
          <ul className="space-y-3 text-sm">
            {timeline.length === 0 && <li className="text-muted">{t("common.noData")}</li>}
            {timeline.map((e) => (
              <li key={e.id} className="border-s-2 border-violet-200 ps-3">
                <div className="text-xs text-muted">{new Date(e.createdAt).toLocaleString(isAr ? "ar" : "en")}</div>
                <div>
                  <span className="font-medium">SR #{e.requestId}</span>{" "}
                  {e.fromStatus ? `${t(`requests.statuses.${e.fromStatus}`)} → ` : ""}
                  {t(`requests.statuses.${e.toStatus}`)}
                </div>
                {e.userName && <div className="text-xs text-muted">{e.userName}</div>}
                {e.reason && <div className="text-xs italic">{e.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
        <div className="stamp-card p-5">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("nav.audit_log")}</h3>
          <ul className="space-y-3 text-sm">
            {audit.length === 0 && <li className="text-muted">{t("common.noData")}</li>}
            {audit.map((a) => (
              <li key={a.id} className="border-s-2 border-violet-200 ps-3">
                <div className="text-xs text-muted">{new Date(a.createdAt).toLocaleString(isAr ? "ar" : "en")}</div>
                <div className="font-medium">{a.action}</div>
                {a.userName && <div className="text-xs text-muted">{a.userName}</div>}
                {a.note && <div className="text-xs italic">{a.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="mb-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={"text-sm " + (mono ? "font-mono" : "")}>{value || "—"}</div>
    </div>
  );
}

function statusPill(s: string) {
  if (s === "active" || s === "extended") return "pill-success";
  if (s === "expired") return "pill-warning";
  if (s === "transferred") return "pill-violet";
  return "pill-muted";
}
function requestPill(s: string) {
  if (s === "activated") return "pill-success";
  if (s === "rejected" || s === "failed") return "pill-danger";
  if (s === "under_activation" || s === "received") return "pill-violet";
  if (s === "draft_sr") return "pill-muted";
  return "pill-warning";
}

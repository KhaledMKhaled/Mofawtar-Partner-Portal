import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { ArrowLeft } from "lucide-react";

interface Summary {
  counts: { active: number; expired: number; transferred: number; returnedToCompany: number; total: number };
  owned: {
    id: number;
    customerId: number;
    customerName: string;
    taxCardNumber: string;
    startDate: string;
    endDate: string;
    status: string;
  }[];
}
interface Partner {
  id: number;
  name: string;
  code: string;
  status: string;
  partnerCommissionPct: string;
  ownershipPeriodValue: number;
  ownershipPeriodUnit: string;
  salesCommissionEnabled: boolean;
  salesCommissionPct: string;
}

export function PartnerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const partner = useQuery({
    queryKey: ["partner", id],
    queryFn: async () => {
      const all = await api<Partner[]>("/api/partners");
      return all.find((p) => p.id === Number(id)) ?? null;
    },
    enabled: !!id,
  });
  const summary = useQuery({
    queryKey: ["partner-ownership", id],
    queryFn: () => api<Summary>(`/api/ownership/partner/${id}/summary`),
    enabled: !!id,
  });

  if (partner.isLoading) return <div className="text-muted">{t("common.loading")}</div>;
  if (!partner.data) return <div className="text-muted">{t("common.noData")}</div>;
  const p = partner.data;

  return (
    <div>
      <Link to="/partners" className="text-violet-700 text-sm inline-flex items-center gap-1 mb-2">
        <ArrowLeft className="w-4 h-4" /> {t("nav.partners")}
      </Link>
      <PageHeader title={p.name} subtitle={p.code} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Stat label={t("ownership.activeCount")} value={summary.data?.counts.active ?? 0} />
        <Stat label={t("ownership.expiredCount")} value={summary.data?.counts.expired ?? 0} />
        <Stat label={t("ownership.transferredCount")} value={summary.data?.counts.transferred ?? 0} />
        <Stat label={t("ownership.totalCount")} value={summary.data?.counts.total ?? 0} />
      </div>

      <div className="stamp-card p-5 mb-6">
        <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("partners.contract")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Info label={t("partners.partnerCommissionPct")} value={`${Number(p.partnerCommissionPct)}%`} />
          <Info label={t("partners.salesCommissionEnabled")} value={p.salesCommissionEnabled ? `${Number(p.salesCommissionPct)}%` : t("common.disabled")} />
          <Info label={t("partners.ownershipPeriod")} value={`${p.ownershipPeriodValue} ${t(`partners.${p.ownershipPeriodUnit}`)}`} />
        </div>
      </div>

      <div className="stamp-card p-5">
        <h3 className="text-sm font-semibold text-violet-700 mb-3">{t("partners.ownedCustomers")}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>{t("requests.customer")}</th>
              <th>{t("ownership.startDate")}</th>
              <th>{t("ownership.endDate")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.data?.owned.length === 0 && <tr><td colSpan={4} className="text-center text-muted py-6">{t("common.noData")}</td></tr>}
            {summary.data?.owned.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/customers/${o.customerId}`} className="font-medium hover:text-violet-700">{o.customerName}</Link>
                  <div className="text-xs text-muted font-mono">{o.taxCardNumber}</div>
                </td>
                <td className="text-xs">{new Date(o.startDate).toLocaleDateString()}</td>
                <td className="text-xs">{new Date(o.endDate).toLocaleDateString()}</td>
                <td><span className={statusPill(o.status)}>{t(`ownership.statuses.${o.status}`)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="text-xs text-muted uppercase">{label}</div>
      <div className="text-3xl font-bold text-ink">{value}</div>
    </div>
  );
}
function statusPill(s: string) {
  if (s === "active" || s === "extended") return "pill-success";
  if (s === "expired") return "pill-warning";
  if (s === "transferred") return "pill-violet";
  return "pill-muted";
}

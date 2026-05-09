import { useTranslation } from "react-i18next";
import { useCurrentUser } from "../hooks/useAuth";
import { PageHeader } from "../components/AppShell";
import { Building2, Users, PackageOpen, ShieldCheck, Receipt, Wallet, HandCoins, ClipboardList, TrendingUp, AlertTriangle } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/financial";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface QuickTile { key: string; icon: IconType; to: string }

const QUICK_TILES_BY_ROLE: Record<string, QuickTile[]> = {
  company_super_admin: [
    { key: "partners", icon: Building2, to: "/partners" },
    { key: "users", icon: Users, to: "/users" },
    { key: "packages", icon: PackageOpen, to: "/packages" },
    { key: "reports", icon: TrendingUp, to: "/reports" },
  ],
  company_accountant: [
    { key: "payments", icon: Wallet, to: "/payments" },
    { key: "claims", icon: ClipboardList, to: "/claims" },
    { key: "partner_commissions", icon: HandCoins, to: "/partner-commissions" },
    { key: "settlements", icon: TrendingUp, to: "/settlements" },
  ],
  partner_admin: [
    { key: "users", icon: Users, to: "/users" },
    { key: "customers", icon: Users, to: "/customers" },
    { key: "requests", icon: Receipt, to: "/requests" },
    { key: "claims", icon: ClipboardList, to: "/claims" },
  ],
  partner_accountant: [
    { key: "payments", icon: Wallet, to: "/payments" },
    { key: "claims", icon: ClipboardList, to: "/claims" },
    { key: "settlements", icon: TrendingUp, to: "/settlements" },
  ],
  team_leader: [
    { key: "requests", icon: Receipt, to: "/requests" },
    { key: "customers", icon: Users, to: "/customers" },
    { key: "sales_commissions", icon: HandCoins, to: "/sales-commissions" },
  ],
  sales: [
    { key: "requests", icon: Receipt, to: "/requests" },
    { key: "customers", icon: Users, to: "/customers" },
    { key: "sales_commissions", icon: HandCoins, to: "/sales-commissions" },
  ],
};

interface KpiResponse {
  cards: Array<{ key: string; label: string; value: number; format: "money" | "count"; tone?: "violet"|"success"|"warning"|"danger" }>;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { data: user } = useCurrentUser();
  const isAr = i18n.language?.startsWith("ar");

  const kpisQ = useQuery({
    queryKey: ["dashboard-kpis"],
    queryFn: () => api<KpiResponse>("/api/reports/dashboard/kpis"),
    enabled: !!user,
  });

  if (!user) return null;
  const tiles = QUICK_TILES_BY_ROLE[user.roleKey] || [];
  const cards = kpisQ.data?.cards ?? [];

  return (
    <div>
      <PageHeader
        title={`${t("dashboard.welcome")}, ${user.name}`}
        subtitle={isAr ? user.roleNameAr : user.roleNameEn}
      />

      {cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {cards.map((c) => (
            <KpiCard key={c.key} label={t(`dashboard.kpis.${c.key}`, c.label)} value={c.format === "money" ? fmtMoney(c.value) : c.value.toLocaleString()} tone={c.tone} />
          ))}
        </div>
      )}

      <div className="stamp-card p-6">
        <h3 className="font-semibold text-ink mb-1">{t("dashboard.quickActions")}</h3>
        <p className="text-sm text-muted mb-5">{t("dashboard.subtitle")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <a
                key={tile.key}
                href={tile.to}
                className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-violet hover:bg-magnolia/40 transition"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="font-medium text-ink">{t(`nav.${tile.key}`)}</div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone = "violet" }: { label: string; value: string | number; tone?: "violet"|"success"|"warning"|"danger" }) {
  const toneClass = {
    violet: "bg-violet-50 text-violet-700",
    success: "bg-green-50 text-green-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
  }[tone];
  const Icon = tone === "danger" || tone === "warning" ? AlertTriangle : TrendingUp;
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted font-semibold">{label}</div>
        <div className={`w-9 h-9 rounded-lg ${toneClass} flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-2xl font-bold text-ink">{value}</div>
    </div>
  );
}

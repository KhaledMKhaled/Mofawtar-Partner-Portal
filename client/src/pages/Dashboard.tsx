import { useTranslation } from "react-i18next";
import { useCurrentUser } from "../hooks/useAuth";
import { PageHeader } from "../components/AppShell";
import { Building2, Users, PackageOpen, ShieldCheck, Receipt, Wallet, HandCoins, ClipboardList } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface QuickTile { key: string; icon: IconType; to: string }

const QUICK_TILES_BY_ROLE: Record<string, QuickTile[]> = {
  company_super_admin: [
    { key: "partners", icon: Building2, to: "/partners" },
    { key: "users", icon: Users, to: "/users" },
    { key: "packages", icon: PackageOpen, to: "/packages" },
    { key: "roles", icon: ShieldCheck, to: "/roles" },
  ],
  company_accountant: [
    { key: "payments", icon: Wallet, to: "/payments" },
    { key: "claims", icon: ClipboardList, to: "/claims" },
    { key: "partner_commissions", icon: HandCoins, to: "/partner-commissions" },
  ],
  partner_admin: [
    { key: "users", icon: Users, to: "/users" },
    { key: "customers", icon: Users, to: "/customers" },
    { key: "requests", icon: Receipt, to: "/requests" },
  ],
  partner_accountant: [
    { key: "payments", icon: Wallet, to: "/payments" },
    { key: "claims", icon: ClipboardList, to: "/claims" },
  ],
  team_leader: [
    { key: "requests", icon: Receipt, to: "/requests" },
    { key: "customers", icon: Users, to: "/customers" },
  ],
  sales: [
    { key: "requests", icon: Receipt, to: "/requests" },
    { key: "customers", icon: Users, to: "/customers" },
  ],
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { data: user } = useCurrentUser();
  const isAr = i18n.language?.startsWith("ar");

  // Phase 1 lightweight stats — uses the only data we currently have
  const partnersQ = useQuery({
    queryKey: ["partners-count"],
    queryFn: () => api<unknown[]>("/api/partners").catch(() => [] as unknown[]),
    enabled: !!user && (user.permissions || []).includes("partners:view"),
  });
  const usersQ = useQuery({
    queryKey: ["users-count"],
    queryFn: () => api<unknown[]>("/api/users").catch(() => [] as unknown[]),
    enabled: !!user && (user.permissions || []).includes("users:view"),
  });
  const packagesQ = useQuery({
    queryKey: ["packages-count"],
    queryFn: () => api<unknown[]>("/api/packages").catch(() => [] as unknown[]),
    enabled: !!user && (user.permissions || []).includes("packages:view"),
  });

  if (!user) return null;
  const tiles = QUICK_TILES_BY_ROLE[user.roleKey] || [];

  return (
    <div>
      <PageHeader
        title={`${t("dashboard.welcome")}, ${user.name}`}
        subtitle={isAr ? user.roleNameAr : user.roleNameEn}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {partnersQ.data && (
          <StatCard label={t("nav.partners")} value={partnersQ.data.length} icon={Building2} />
        )}
        {usersQ.data && (
          <StatCard label={t("nav.users")} value={usersQ.data.length} icon={Users} />
        )}
        {packagesQ.data && (
          <StatCard label={t("nav.packages")} value={packagesQ.data.length} icon={PackageOpen} />
        )}
        <StatCard label={t("common.role")} value={isAr ? user.roleNameAr : user.roleNameEn} icon={ShieldCheck} />
      </div>

      <div className="stamp-card p-6">
        <h3 className="font-semibold text-ink mb-1">{t("dashboard.quickActions")}</h3>
        <p className="text-sm text-muted mb-5">{t("dashboard.phaseNote")}</p>
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

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: IconType }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted font-semibold">{label}</div>
        <div className="w-9 h-9 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-2xl font-bold text-ink">{value}</div>
    </div>
  );
}

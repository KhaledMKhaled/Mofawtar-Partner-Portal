import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Users,
  Building2,
  ShieldCheck,
  PackageOpen,
  Receipt,
  CircleDollarSign,
  Wallet,
  HandCoins,
  Banknote,
  ScrollText,
  FileBarChart2,
  ClipboardList,
  Settings,
  Bell,
  LogOut,
  Globe,
  ChevronDown,
  UserCircle2,
  Search,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useCurrentUser, useLogout, canModule } from "../hooks/useAuth";
import { LogoMark } from "./Logo";
import { MODULES, type Module } from "@shared/permissions";
import { useState } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<Module, IconType> = {
  dashboard: LayoutDashboard,
  partners: Building2,
  users: Users,
  roles: ShieldCheck,
  packages: PackageOpen,
  customers: UserCircle2,
  requests: Receipt,
  payments: Wallet,
  partner_commissions: HandCoins,
  sales_commissions: CircleDollarSign,
  claims: ClipboardList,
  payout_batches: Banknote,
  settlements: Banknote,
  ownership: ShieldCheck,
  reports: FileBarChart2,
  audit_log: ScrollText,
  notifications: Bell,
  excel_import: PackageOpen,
  settings: Settings,
};

const ROUTES: Partial<Record<Module, string>> = {
  dashboard: "/",
  partners: "/partners",
  users: "/users",
  roles: "/roles",
  packages: "/packages",
  customers: "/customers",
  requests: "/requests",
  payments: "/payments",
  partner_commissions: "/partner-commissions",
  sales_commissions: "/sales-commissions",
  claims: "/claims",
  payout_batches: "/payout-batches",
  settlements: "/settlements",
  ownership: "/ownership",
  reports: "/reports",
  audit_log: "/audit-log",
  settings: "/settings",
};

export function AppShell() {
  const { data: user } = useCurrentUser();
  const { t, i18n } = useTranslation();
  const logout = useLogout();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;
  const isAr = i18n.language?.startsWith("ar");
  // Derive sidebar from the user's actual permissions so custom roles and
  // edited system roles always show the right menu.
  const navItems: Module[] = MODULES.filter(
    (m) => ROUTES[m] && canModule(user, m),
  );

  const toggleLang = () => i18n.changeLanguage(isAr ? "en" : "ar");

  return (
    <div className="min-h-screen flex bg-[#f6f6fb]">
      <aside className="w-64 shrink-0 bg-white border-e border-border flex flex-col">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-border">
          <LogoMark size={36} />
          <div className="leading-tight">
            <div className="font-bold text-ink">{t("brand.name")}</div>
            <div className="text-xs text-muted">{t("brand.portal")}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((mod) => {
            const Icon: IconType = ICONS[mod] ?? LayoutDashboard;
            const path = ROUTES[mod] || "/";
            return (
              <NavLink
                key={mod}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition " +
                  (isActive
                    ? "bg-violet-50 text-violet-700 font-semibold"
                    : "text-ink hover:bg-magnolia")
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{t(`nav.${mod}`)}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-border text-[11px] text-muted">
          © {new Date().getFullYear()} {t("brand.name")} · {t("brand.tagline")}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-border flex items-center px-6 gap-4 sticky top-0 z-10">
          <div className="hidden md:flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
              <input className="input ps-9" placeholder={t("common.search")} disabled />
            </div>
          </div>
          <div className="flex-1 md:hidden" />
          <button
            onClick={toggleLang}
            className="btn-ghost text-sm"
            title={t("auth.language")}
          >
            <Globe className="w-4 h-4" />
            {isAr ? "English" : "العربية"}
          </button>
          <button className="btn-ghost relative" disabled title={t("nav.notifications")}>
            <Bell className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-magnolia"
            >
              <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-semibold">
                {user.name?.[0] || "U"}
              </div>
              <div className="hidden sm:block text-start leading-tight">
                <div className="text-sm font-semibold text-ink">{user.name}</div>
                <div className="text-[11px] text-muted">{isAr ? user.roleNameAr : user.roleNameEn}</div>
              </div>
              <ChevronDown className="w-4 h-4 text-muted" />
            </button>
            {menuOpen && (
              <div
                className="absolute end-0 mt-2 w-56 stamp-card p-2 shadow-stamp z-20"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="px-3 py-2 text-xs text-muted">{user.email}</div>
                <div className="dashed-divider my-1" />
                <button
                  className="w-full text-start px-3 py-2 rounded-md hover:bg-magnolia text-sm flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/account/password");
                  }}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {t("auth.changePassword")}
                </button>
                <button
                  className="w-full text-start px-3 py-2 rounded-md hover:bg-magnolia text-sm flex items-center gap-2"
                  onClick={async () => {
                    await logout.mutateAsync();
                    navigate("/login");
                  }}
                >
                  <LogOut className="w-4 h-4" />
                  {t("auth.signOut")}
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

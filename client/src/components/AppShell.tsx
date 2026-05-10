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
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

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
  settlements: "/settlements",
  ownership: "/ownership",
  reports: "/reports",
  audit_log: "/audit-log",
  excel_import: "/excel-import",
  settings: "/settings",
};

interface SearchHit {
  type: "customer" | "request";
  id: number;
  label: string;
  sub: string;
}
interface NotifLite {
  id: number;
  titleEn: string;
  titleAr: string;
  bodyEn: string | null;
  bodyAr: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export function AppShell() {
  const { data: user } = useCurrentUser();
  const { t, i18n } = useTranslation();
  const logout = useLogout();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const isAr = i18n.language?.startsWith("ar");

  const search = useQuery({
    queryKey: ["search", q],
    queryFn: async (): Promise<SearchHit[]> => {
      const term = q.trim();
      if (!term) return [];
      const [custs, reqs] = await Promise.all([
        api<{ id: number; name: string; taxCardNumber: string }[]>(`/api/customers?q=${encodeURIComponent(term)}`).catch(() => []),
        api<{ id: number; srNumber: string; customerName: string }[]>(`/api/requests?q=${encodeURIComponent(term)}`).catch(() => []),
      ]);
      const custHits: SearchHit[] = custs.slice(0, 8).map((c) => ({
        type: "customer", id: c.id, label: c.name, sub: c.taxCardNumber,
      }));
      const reqHits: SearchHit[] = reqs.slice(0, 8).map((r) => ({
        type: "request", id: r.id, label: r.srNumber, sub: r.customerName,
      }));
      return [...custHits, ...reqHits];
    },
    enabled: q.trim().length >= 2 && searchOpen,
  });

  const unread = useQuery({
    queryKey: ["notifications-count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: 60000,
    enabled: !!user,
  });
  const notifList = useQuery({
    queryKey: ["notifications", "lite"],
    queryFn: () => api<NotifLite[]>("/api/notifications?unread=1"),
    enabled: bellOpen,
  });

  if (!user) return null;
  const allowed = (mods: Module[]) => mods.filter((m) => ROUTES[m] && canModule(user, m));
  const navSections: { key: string; items: Module[] }[] = [
    { key: "overview",       items: allowed(["dashboard"]) },
    { key: "operations",     items: allowed(["customers", "requests", "packages"]) },
    { key: "financial",      items: allowed(["payments", "partner_commissions", "sales_commissions", "claims", "settlements"]) },
    { key: "administration", items: allowed(["partners", "users", "roles", "ownership"]) },
    { key: "system",         items: allowed(["reports", "audit_log", "excel_import", "settings"]) },
  ].filter((s) => s.items.length > 0);
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
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {navSections.map((section) => (
            <div key={section.key} className="space-y-1">
              <div
                className={
                  "px-3 pt-1 pb-1 font-semibold text-slate-400 " +
                  (isAr ? "text-xs" : "text-[10px] uppercase tracking-wider")
                }
              >
                {t(`nav.sections.${section.key}`)}
              </div>
              {section.items.map((mod) => {
                const Icon: IconType = ICONS[mod] ?? LayoutDashboard;
                const path = ROUTES[mod] || "/";
                return (
                  <NavLink
                    key={mod}
                    to={path}
                    end={path === "/"}
                    className={({ isActive }) =>
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition " +
                      (isActive ? "bg-violet-50 text-violet-700 font-semibold" : "text-ink hover:bg-magnolia")
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{t(`nav.${mod}`)}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-border text-[11px] text-muted">
          © {new Date().getFullYear()} {t("brand.name")} · {t("brand.tagline")}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-border flex items-center px-6 gap-4 sticky top-0 z-10">
          <div className="hidden md:flex items-center gap-2 flex-1 max-w-md" ref={searchRef}>
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
              <input
                className="input ps-9"
                placeholder={t("common.searchAll")}
                value={q}
                onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
              {searchOpen && q.trim().length >= 2 && (
                <div className="absolute top-full inset-x-0 mt-2 stamp-card max-h-96 overflow-auto p-2 shadow-stamp z-30">
                  {search.isLoading && <div className="p-3 text-sm text-muted">{t("common.loading")}</div>}
                  {!search.isLoading && (search.data?.length ?? 0) === 0 && (
                    <div className="p-3 text-sm text-muted">{t("common.noData")}</div>
                  )}
                  {search.data?.map((h) => (
                    <button
                      key={`${h.type}-${h.id}`}
                      className="w-full text-start px-3 py-2 rounded-md hover:bg-magnolia text-sm flex justify-between gap-3"
                      onClick={() => {
                        setSearchOpen(false);
                        setQ("");
                        navigate(h.type === "customer" ? `/customers/${h.id}` : `/requests/${h.id}`);
                      }}
                    >
                      <div>
                        <div className="font-medium">{h.label}</div>
                        <div className="text-xs text-muted">{h.sub}</div>
                      </div>
                      <span className="pill-muted self-start">{t(`common.${h.type}`)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 md:hidden" />
          <button onClick={toggleLang} className="btn-ghost text-sm" title={t("auth.language")}>
            <Globe className="w-4 h-4" />
            {isAr ? "English" : "العربية"}
          </button>
          <div className="relative">
            <button
              className="btn-ghost relative"
              title={t("nav.notifications")}
              onClick={() => setBellOpen((v) => !v)}
            >
              <Bell className="w-4 h-4" />
              {(unread.data?.count ?? 0) > 0 && (
                <span className="absolute -top-1 -end-1 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center font-bold">
                  {unread.data!.count > 9 ? "9+" : unread.data!.count}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute end-0 mt-2 w-80 stamp-card shadow-stamp z-20" onMouseLeave={() => setBellOpen(false)}>
                <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                  <div className="font-semibold text-sm">{t("nav.notifications")}</div>
                  <Link to="/notifications" className="text-xs text-violet-700 hover:underline" onClick={() => setBellOpen(false)}>
                    {t("notifications.viewAll")}
                  </Link>
                </div>
                <div className="max-h-80 overflow-auto">
                  {(notifList.data?.length ?? 0) === 0 && <div className="p-6 text-center text-sm text-muted">{t("notifications.empty")}</div>}
                  {notifList.data?.slice(0, 8).map((n) => (
                    <button
                      key={n.id}
                      className="w-full text-start px-4 py-3 border-b border-border/70 hover:bg-magnolia/40"
                      onClick={() => {
                        setBellOpen(false);
                        if (n.linkPath) navigate(n.linkPath);
                      }}
                    >
                      <div className="text-sm font-medium">{isAr ? n.titleAr : n.titleEn}</div>
                      {(isAr ? n.bodyAr : n.bodyEn) && <div className="text-xs text-muted">{isAr ? n.bodyAr : n.bodyEn}</div>}
                      <div className="text-[11px] text-muted mt-1">{new Date(n.createdAt).toLocaleString(isAr ? "ar" : "en")}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
              <div className="absolute end-0 mt-2 w-56 stamp-card p-2 shadow-stamp z-20" onMouseLeave={() => setMenuOpen(false)}>
                <div className="px-3 py-2 text-xs text-muted">{user.email}</div>
                <div className="dashed-divider my-1" />
                <button
                  className="w-full text-start px-3 py-2 rounded-md hover:bg-magnolia text-sm flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); navigate("/account/password"); }}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {t("auth.changePassword")}
                </button>
                <button
                  className="w-full text-start px-3 py-2 rounded-md hover:bg-magnolia text-sm flex items-center gap-2"
                  onClick={async () => { await logout.mutateAsync(); navigate("/login"); }}
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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
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

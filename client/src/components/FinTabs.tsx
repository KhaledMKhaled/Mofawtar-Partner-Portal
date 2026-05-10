import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrentUser, can } from "../hooks/useAuth";

export function FinTabs() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const tabs: { to: string; label: string; show: boolean }[] = [
    { to: "/payments", label: t("nav.payments"), show: can(user, "payments:view") },
    { to: "/partner-commissions", label: t("nav.partner_commissions"), show: can(user, "partner_commissions:view") },
    { to: "/sales-commissions", label: t("nav.sales_commissions"), show: can(user, "sales_commissions:view") },
  ];
  const visible = tabs.filter((x) => x.show);
  if (visible.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-4 border-b border-gray-200">
      {visible.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-muted hover:text-ink hover:border-gray-300"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}

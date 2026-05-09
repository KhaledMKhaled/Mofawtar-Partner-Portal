import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Search, Plus } from "lucide-react";
import { RequestWizard } from "../components/RequestWizard";
import { useCurrentUser, can } from "../hooks/useAuth";

interface Row {
  id: number;
  taxCardNumber: string;
  name: string;
  contactPerson: string | null;
  contactPhone: string | null;
  primaryPhone: string | null;
  primaryPhoneWhatsapp: boolean;
  email: string | null;
  createdAt: string;
}

export function CustomersPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const [q, setQ] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const list = useQuery({
    queryKey: ["customers", q],
    queryFn: () => api<Row[]>(`/api/customers?q=${encodeURIComponent(q)}`),
  });

  return (
    <div>
      <PageHeader
        title={t("customers.title")}
        subtitle={t("customers.subtitle")}
        actions={
          can(user, "requests:create") && (
            <button className="btn-primary" onClick={() => setWizardOpen(true)}>
              <Plus className="w-4 h-4" /> {t("wizard.openCta")}
            </button>
          )
        }
      />
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input
            className="input ps-9"
            placeholder={t("customers.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("customers.taxCard")}</th>
              <th>{t("customers.businessName")}</th>
              <th>{t("customers.contactPerson")}</th>
              <th>{t("customers.primaryPhone")}</th>
              <th>{t("common.email")}</th>
              <th>{t("common.createdAt")}</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr><td colSpan={6} className="text-center text-muted py-8">{t("common.loading")}</td></tr>
            )}
            {list.data?.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted py-8">{t("common.noData")}</td></tr>
            )}
            {list.data?.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs"><Link to={`/customers/${c.id}`} className="text-violet-700 hover:underline">{c.taxCardNumber}</Link></td>
                <td className="font-medium"><Link to={`/customers/${c.id}`} className="hover:text-violet-700">{c.name}</Link></td>
                <td>{c.contactPerson ?? "—"}</td>
                <td className="font-mono text-xs">
                  {c.primaryPhone ?? c.contactPhone ?? "—"}
                  {c.primaryPhone && c.primaryPhoneWhatsapp && (
                    <span className="ms-2 inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold">
                      {t("customers.whatsapp")}
                    </span>
                  )}
                </td>
                <td className="text-xs">{c.email ?? "—"}</td>
                <td className="text-xs text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RequestWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

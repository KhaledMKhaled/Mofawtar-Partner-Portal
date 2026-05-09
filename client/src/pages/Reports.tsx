import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { useCurrentUser, can } from "../hooks/useAuth";
import { fmtMoney } from "../lib/financial";
import { Download, Printer } from "lucide-react";

const REPORTS = [
  "payments_summary",
  "partner_commissions_summary",
  "sales_commissions_summary",
  "claims_summary",
  "requests_summary",
  "ownership_summary",
] as const;
type ReportKey = (typeof REPORTS)[number];

export function ReportsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const [key, setKey] = useState<ReportKey>("payments_summary");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const data = useQuery<{ headers: string[]; rows: Record<string, unknown>[] }>({
    queryKey: ["report", key, from, to],
    queryFn: () => api<{ headers: string[]; rows: Record<string, unknown>[] }>(`/api/reports/${key}?${new URLSearchParams({ from, to } as Record<string,string>).toString()}`),
  });
  const canExport = can(user, "reports:export");
  const exportUrl = (fmt: "xlsx" | "pdf") => `/api/reports/${key}/export.${fmt}?${new URLSearchParams({ from, to }).toString()}`;
  const isMoneyCol = (h: string) => /amount|gross|net|commission|total/i.test(h);
  const headers: string[] = data.data?.headers ?? [];
  const rows: Record<string, unknown>[] = data.data?.rows ?? [];

  return (
    <div>
      <PageHeader
        title={t("nav.reports")}
        subtitle={t("reports.subtitle")}
        actions={canExport ? (
          <div className="flex gap-2">
            <a className="btn-secondary" href={exportUrl("xlsx")} download><Download className="w-4 h-4" /> Excel</a>
            <a className="btn-ghost" href={exportUrl("pdf")} target="_blank" rel="noreferrer"><Printer className="w-4 h-4" /> PDF</a>
          </div>
        ) : null}
      />
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div>
          <label className="text-xs text-muted block mb-1">{t("reports.report")}</label>
          <select className="input" value={key} onChange={(e) => setKey(e.target.value as ReportKey)}>
            {REPORTS.map((r) => <option key={r} value={r}>{t(`reports.keys.${r}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">{t("common.from")}</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">{t("common.to")}</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>{headers.map((h) => <th key={h} className={isMoneyCol(h) ? "text-end" : ""}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.isLoading && <tr><td colSpan={headers.length || 1} className="text-center py-8 text-muted">{t("common.loading")}</td></tr>}
            {!data.isLoading && rows.length === 0 && <tr><td colSpan={headers.length || 1} className="text-center py-8 text-muted">{t("common.noData")}</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                {headers.map((h) => {
                  const v = (r as Record<string, unknown>)[h];
                  return <td key={h} className={(isMoneyCol(h) ? "text-end font-mono " : "") + "text-xs"}>
                    {v == null ? "—" : isMoneyCol(h) ? fmtMoney(v as number | string) : (typeof v === "boolean" ? (v ? "✓" : "—") : String(v))}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

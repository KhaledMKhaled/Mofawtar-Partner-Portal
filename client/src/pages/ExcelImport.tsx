import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Upload } from "lucide-react";
import * as XLSX from "xlsx";

type Entity = "customers" | "packages" | "requests" | "order_payments" | "partner_commissions" | "sales_commissions";

export function ExcelImportPage() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<Entity>("customers");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [result, setResult] = useState<{ updated: number; failed: number; failures: Array<{ row: number; error: string }> } | null>(null);

  const submit = useMutation({
    mutationFn: () => api<{ updated: number; failed: number; failures: Array<{ row: number; error: string }> }>("/api/excel-import", { method: "POST", json: { entity, rows } }),
    onSuccess: (data) => setResult(data),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    setRows(json);
    setResult(null);
  };

  return (
    <div>
      <PageHeader title={t("excelImport.title")} subtitle={t("excelImport.subtitle")} />
      <div className="stamp-card p-5 max-w-3xl">
        <div className="grid md:grid-cols-3 gap-3 items-end mb-4">
          <div>
            <label className="text-xs text-muted block mb-1">{t("excelImport.entity")}</label>
            <select className="input" value={entity} onChange={(e) => { setEntity(e.target.value as Entity); setRows([]); setResult(null); }}>
              <option value="customers">{t("nav.customers")}</option>
              <option value="packages">{t("nav.packages")}</option>
              <option value="requests">{t("nav.requests")}</option>
              <option value="order_payments">{t("nav.payments")}</option>
              <option value="partner_commissions">{t("nav.partner_commissions")}</option>
              <option value="sales_commissions">{t("nav.sales_commissions")}</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted block mb-1">{t("excelImport.uploadFile")}</label>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="input" />
          </div>
        </div>
        {rows.length > 0 && (
          <div className="text-sm">
            <div className="mb-2">{t("excelImport.previewCount", { count: rows.length })}</div>
            <div className="table-wrap max-h-64 overflow-auto">
              <table className="table text-xs">
                <thead><tr>{Object.keys(rows[0] ?? {}).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i}>{Object.keys(rows[0] ?? {}).map((k) => <td key={k}>{String(r[k] ?? "—")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-primary mt-3" disabled={submit.isPending} onClick={() => submit.mutate()}>
              <Upload className="w-4 h-4" /> {t("excelImport.applyUpdates", { count: rows.length })}
            </button>
          </div>
        )}
        {result && (
          <div className="mt-4 stamp-card p-4">
            <div className="text-sm font-semibold">{t("excelImport.result")}</div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="text-center"><div className="text-2xl font-bold text-green-700">{result.updated}</div><div className="text-xs text-muted">{t("excelImport.updated")}</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-red-700">{result.failed}</div><div className="text-xs text-muted">{t("excelImport.failed")}</div></div>
            </div>
            {result.failures.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-red-700">{t("excelImport.viewFailures")}</summary>
                <ul className="text-xs mt-2 space-y-1">
                  {result.failures.map((f, i) => <li key={i}>{t("excelImport.row")} {f.row}: {f.error}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

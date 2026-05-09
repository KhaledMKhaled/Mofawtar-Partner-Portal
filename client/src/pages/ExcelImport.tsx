import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Upload, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";

type Entity = "customers" | "packages" | "requests" | "order_payments" | "partner_commissions" | "sales_commissions";
type Step = 1 | 2 | 3;

interface ValidateResp { valid: boolean; totalRows: number; okRows: number; failures: Array<{ row: number; error: string }> }
interface ApplyResp { updated: number; failed: number; failures: Array<{ row: number; error: string }> }

export function ExcelImportPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [entity, setEntity] = useState<Entity>("customers");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [validation, setValidation] = useState<ValidateResp | null>(null);
  const [result, setResult] = useState<ApplyResp | null>(null);

  const validate = useMutation({
    mutationFn: () => api<ValidateResp>("/api/excel-import/validate", { method: "POST", json: { entity, rows } }),
    onSuccess: (data) => { setValidation(data); setStep(2); },
  });
  const apply = useMutation({
    mutationFn: () => api<ApplyResp>("/api/excel-import", { method: "POST", json: { entity, rows } }),
    onSuccess: (data) => { setResult(data); setStep(3); },
  });

  const reset = (e: Entity) => { setEntity(e); setRows([]); setValidation(null); setResult(null); setStep(1); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    setRows(json);
    setValidation(null);
    setResult(null);
  };

  const downloadTemplate = () => {
    window.open(`/api/excel-import/template/${entity}`, "_blank");
  };

  const StepDot = ({ n, label }: { n: Step; label: string }) => (
    <div className={"flex items-center gap-2 " + (step >= n ? "text-violet-700" : "text-muted")}>
      <div className={"w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold " + (step >= n ? "bg-violet-700 text-white" : "bg-zinc-200")}>{n}</div>
      <span className="text-sm">{label}</span>
    </div>
  );

  return (
    <div>
      <PageHeader title={t("excelImport.title")} subtitle={t("excelImport.subtitle")} />
      <div className="stamp-card p-5 max-w-4xl">
        <div className="flex items-center gap-6 mb-4 border-b pb-3">
          <StepDot n={1} label={t("excelImport.stepUpload")} />
          <div className="flex-1 h-px bg-zinc-200" />
          <StepDot n={2} label={t("excelImport.stepValidate")} />
          <div className="flex-1 h-px bg-zinc-200" />
          <StepDot n={3} label={t("excelImport.stepConfirm")} />
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end mb-4">
          <div>
            <label className="text-xs text-muted block mb-1">{t("excelImport.entity")}</label>
            <select className="input" value={entity} onChange={(e) => reset(e.target.value as Entity)}>
              <option value="customers">{t("nav.customers")}</option>
              <option value="packages">{t("nav.packages")}</option>
              <option value="requests">{t("nav.requests")}</option>
              <option value="order_payments">{t("nav.payments")}</option>
              <option value="partner_commissions">{t("nav.partner_commissions")}</option>
              <option value="sales_commissions">{t("nav.sales_commissions")}</option>
            </select>
          </div>
          <div>
            <button className="btn-secondary w-full" type="button" onClick={downloadTemplate}>
              <Download className="w-4 h-4" /> {t("excelImport.downloadTemplate")}
            </button>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">{t("excelImport.uploadFile")}</label>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="input" />
          </div>
        </div>

        {step === 1 && rows.length > 0 && (
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
            <button className="btn-primary mt-3" disabled={validate.isPending} onClick={() => validate.mutate()}>
              {t("excelImport.validateAction")}
            </button>
          </div>
        )}

        {step === 2 && validation && (
          <div className="text-sm">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="stamp-card p-3 text-center"><div className="text-2xl font-bold">{validation.totalRows}</div><div className="text-xs text-muted">{t("excelImport.totalRows")}</div></div>
              <div className="stamp-card p-3 text-center"><div className="text-2xl font-bold text-green-700">{validation.okRows}</div><div className="text-xs text-muted">{t("excelImport.validRows")}</div></div>
              <div className="stamp-card p-3 text-center"><div className="text-2xl font-bold text-red-700">{validation.failures.length}</div><div className="text-xs text-muted">{t("excelImport.invalidRows")}</div></div>
            </div>
            {validation.failures.length > 0 && (
              <div className="stamp-card p-3 mb-3 max-h-48 overflow-auto">
                <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm mb-2"><AlertTriangle className="w-4 h-4" />{t("excelImport.validationIssues")}</div>
                <ul className="text-xs space-y-1">
                  {validation.failures.map((f, i) => <li key={i}><span className="font-mono">{t("excelImport.row")} {f.row}</span> — {f.error}</li>)}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setStep(1)}>{t("common.back")}</button>
              <button className="btn-primary" disabled={apply.isPending || validation.okRows === 0} onClick={() => apply.mutate()}>
                <Upload className="w-4 h-4" /> {t("excelImport.confirmApply", { count: validation.okRows })}
              </button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="mt-2 stamp-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-green-700"><CheckCircle2 className="w-4 h-4" />{t("excelImport.result")}</div>
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
            <button className="btn-secondary mt-3" onClick={() => reset(entity)}>{t("excelImport.startOver")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";
import { Field } from "../components/Field";
import { useCurrentUser, can } from "../hooks/useAuth";
import i18n from "../i18n";

export function SettingsPage() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  type SettingsMap = Record<string, unknown>;
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsMap>("/api/settings") });
  const [form, setForm] = useState<SettingsMap>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsQ.data) setForm(settingsQ.data);
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: (data: SettingsMap) => api("/api/settings", { method: "PUT", json: data }),
    onSuccess: (_res, data) => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setTimeout(() => setSaved(false), 2500);
      // Apply language change immediately and persist it in localStorage.
      const lang = String(data.language ?? "ar");
      if (lang !== i18n.language) {
        i18n.changeLanguage(lang);
        localStorage.setItem("i18nextLng", lang);
      }
      // Apply direction immediately.
      const dir = String(data.direction ?? (lang === "en" ? "ltr" : "rtl"));
      document.documentElement.dir = dir;
      document.documentElement.lang = lang;
    },
  });

  const canEdit = can(user, "settings:edit");

  return (
    <div>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="stamp-card p-6 max-w-3xl">
        <div className="form-row">
          <Field label={t("settings.language")}>
            <select className="input" value={String(form.language ?? "ar")} disabled={!canEdit}
              onChange={(e) => {
                const lang = e.target.value;
                const dir = lang === "en" ? "ltr" : "rtl";
                setForm({ ...form, language: lang, direction: dir });
              }}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={t("settings.direction")}>
            <select className="input" value={String(form.direction ?? "rtl")} disabled
              onChange={() => {}}>
              <option value="rtl">RTL</option>
              <option value="ltr">LTR</option>
            </select>
          </Field>
          <Field label={t("settings.currency")}>
            <input className="input" value={String(form.currency ?? "")} disabled={!canEdit}
              onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </Field>
          <Field label={t("settings.timezone")}>
            <input className="input" value={String(form.timezone ?? "")} disabled={!canEdit}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
          </Field>
          <Field label={t("settings.ownershipExpiryWarningDays")}>
            <input type="number" min={1} className="input" value={Number(form.ownership_expiry_warning_days ?? 30)} disabled={!canEdit}
              onChange={(e) => setForm({ ...form, ownership_expiry_warning_days: Number(e.target.value) })} />
          </Field>
          <Field label={t("settings.commissionCalculationBase")}>
            <select className="input" value={String(form.commission_calculation_base ?? "before_tax")} disabled={!canEdit}
              onChange={(e) => setForm({ ...form, commission_calculation_base: e.target.value })}>
              <option value="before_tax">{t("settings.before_tax")}</option>
              <option value="after_tax">{t("settings.after_tax")}</option>
            </select>
          </Field>
        </div>
        {canEdit && (
          <div className="mt-6 flex items-center gap-3">
            <button className="btn-primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
              {t("common.save")}
            </button>
            {saved && <span className="text-sm text-green-700">{t("common.saved")}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

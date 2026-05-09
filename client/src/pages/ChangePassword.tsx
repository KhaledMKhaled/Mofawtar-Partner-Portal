import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/AppShell";

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 8) return setError(t("auth.pwMinLen"));
    if (next !== confirm) return setError(t("auth.pwMismatch"));
    setSubmitting(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        json: { currentPassword: current, newPassword: next },
      });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(t("auth.wrongPassword"));
      } else {
        setError(t("common.failed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title={t("auth.changePassword")} subtitle={t("auth.changeSubtitle")} />
      <div className="stamp-card p-6 max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">{t("auth.currentPassword")}</label>
            <input
              type="password"
              required
              className="input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">{t("auth.newPassword")}</label>
            <input
              type="password"
              required
              className="input"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">{t("auth.confirmPassword")}</label>
            <input
              type="password"
              required
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              dir="ltr"
            />
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
          )}
          {done && (
            <div className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
              {t("auth.passwordChanged")}
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t("common.loading") : t("auth.changePassword")}
          </button>
        </form>
      </div>
    </div>
  );
}

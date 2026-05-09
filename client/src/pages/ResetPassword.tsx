import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { Logo } from "../components/Logo";
import { Globe } from "lucide-react";

export function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError(t("auth.pwMinLen"));
      return;
    }
    if (pw !== pw2) {
      setError(t("auth.pwMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        json: { token, newPassword: pw },
      });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(t("auth.tokenInvalid"));
      } else {
        setError(t("common.failed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-magnolia/40 p-6">
      <div className="w-full max-w-md stamp-card p-8">
        <div className="flex items-center justify-between mb-6">
          <Logo />
          <button
            onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")}
            className="btn-ghost text-sm"
          >
            <Globe className="w-4 h-4" />
            {isAr ? "English" : "العربية"}
          </button>
        </div>
        <h1 className="text-2xl font-bold text-ink mb-1">{t("auth.resetTitle")}</h1>
        <p className="text-muted text-sm mb-6">{t("auth.resetSubtitle")}</p>
        {done ? (
          <div className="rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
            {t("auth.resetSuccess")}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">{t("auth.resetToken")}</label>
              <input
                required
                className="input font-mono text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                dir="ltr"
              />
            </div>
            <div>
              <label className="label">{t("auth.newPassword")}</label>
              <input
                type="password"
                required
                className="input"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
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
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                dir="ltr"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t("common.loading") : t("auth.resetPassword")}
            </button>
            <Link to="/login" className="text-sm text-violet hover:underline block text-center">
              ← {t("auth.backToLogin")}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

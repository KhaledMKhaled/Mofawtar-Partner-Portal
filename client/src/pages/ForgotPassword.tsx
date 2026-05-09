import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { Logo } from "../components/Logo";
import { Globe } from "lucide-react";

interface ForgotResponse {
  ok: true;
  demoToken?: string;
  demoNote?: string;
}

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ForgotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<ForgotResponse>("/api/auth/forgot-password", {
        method: "POST",
        json: { email },
      });
      setResult(r);
    } catch {
      setError(t("common.failed"));
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
        <h1 className="text-2xl font-bold text-ink mb-1">{t("auth.forgotTitle")}</h1>
        <p className="text-muted text-sm mb-6">{t("auth.forgotSubtitle")}</p>
        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
              {t("auth.forgotSubmitted")}
            </div>
            {result.demoToken && (
              <div className="rounded-lg border border-dashed border-violet/40 bg-violet-50/50 p-4 text-sm">
                <div className="font-semibold text-ink mb-1">{t("auth.demoTokenLabel")}</div>
                <div className="font-mono text-xs break-all text-violet-800 mb-3">
                  {result.demoToken}
                </div>
                <Link
                  to={`/reset-password?token=${encodeURIComponent(result.demoToken)}`}
                  className="btn-primary inline-flex"
                >
                  {t("auth.continueReset")}
                </Link>
              </div>
            )}
            <Link to="/login" className="text-sm text-violet hover:underline">
              ← {t("auth.backToLogin")}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">{t("common.email")}</label>
              <input
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t("common.loading") : t("auth.sendResetLink")}
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

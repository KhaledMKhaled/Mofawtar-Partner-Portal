import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrentUser, useLogin } from "../hooks/useAuth";
import { Logo } from "../components/Logo";
import { Globe } from "lucide-react";

const DEMO_ACCOUNTS = [
  { label: { en: "Company Super Admin", ar: "مدير عام الشركة" }, email: "superadmin@mofawter.com" },
  { label: { en: "Company Accountant", ar: "محاسب الشركة" }, email: "accountant@mofawter.com" },
  { label: { en: "Partner Admin", ar: "مدير الشريك" }, email: "partner.admin@demo.com" },
  { label: { en: "Partner Accountant", ar: "محاسب الشريك" }, email: "partner.accountant@demo.com" },
  { label: { en: "Team Leader", ar: "قائد الفريق" }, email: "team.leader@demo.com" },
  { label: { en: "Sales", ar: "مندوب المبيعات" }, email: "sales@demo.com" },
];
const DEMO_PASSWORD = "password123";

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user) {
    navigate("/", { replace: true });
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      navigate("/", { replace: true });
    } catch {
      setError(t("auth.invalidCredentials"));
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Brand panel */}
      <div className="hidden lg:flex relative bg-violet text-white p-12 flex-col justify-between overflow-hidden">
        <div className="relative z-10">
          <Logo variant="white" />
        </div>
        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-bold leading-tight mb-4">
            {isAr ? "بوابة شركاء مفوتر" : "Mofawter Partner Portal"}
          </h2>
          <p className="text-violet-100 text-lg leading-relaxed">
            {isAr
              ? "إدارة الشركاء وتفعيل العملاء والعمولات والمطالبات والتسويات في مكان واحد."
              : "Manage partners, customer activations, commissions, claims and settlements — all in one place."}
          </p>
          <div
            className="mt-10 h-px w-72 text-white/40"
            style={{
              backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 12px)",
            }}
          />
          <p className="mt-4 text-sm text-violet-100">{t("brand.tagline")}</p>
        </div>
        {/* Decorative dashed circles */}
        <div className="absolute -bottom-32 -end-32 w-96 h-96 rounded-full border-4 border-dashed border-white/10" />
        <div className="absolute top-10 end-20 w-48 h-48 rounded-full border-2 border-dashed border-white/10" />
      </div>

      {/* Form panel */}
      <div className="flex flex-col p-6 sm:p-12">
        <div className="flex items-center justify-between">
          <div className="lg:hidden">
            <Logo />
          </div>
          <button
            onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")}
            className="btn-ghost text-sm ms-auto"
          >
            <Globe className="w-4 h-4" />
            {isAr ? "English" : "العربية"}
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md">
            <h1 className="text-3xl font-bold text-ink mb-2">{t("auth.welcome")}</h1>
            <p className="text-muted mb-8">{t("auth.subtitle")}</p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">{t("common.email")}</label>
                <input
                  type="email"
                  className="input"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="label">{t("common.password")}</label>
                <input
                  type="password"
                  className="input"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
              )}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={login.isPending}
              >
                {login.isPending ? t("common.loading") : t("auth.signIn")}
              </button>
              <p className="text-xs text-muted text-center mt-2">{t("auth.forgotNote")}</p>
            </form>

            <div className="mt-8">
              <div className="dashed-divider mb-4" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">
                {t("auth.demoAccounts")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    onClick={() => {
                      setEmail(d.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="text-start px-3 py-2 rounded-lg border border-border hover:border-violet hover:bg-magnolia/40 transition"
                  >
                    <div className="text-sm font-semibold text-ink">{isAr ? d.label.ar : d.label.en}</div>
                    <div className="text-[11px] text-muted truncate" dir="ltr">{d.email}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-3 text-center">
                {isAr ? "كلمة المرور للجميع: " : "Password for all: "}
                <span className="font-mono font-semibold text-ink">{DEMO_PASSWORD}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

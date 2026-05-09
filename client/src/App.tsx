import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useCurrentUser, canModule } from "./hooks/useAuth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/Login";
import { ForgotPasswordPage } from "./pages/ForgotPassword";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { DashboardPage } from "./pages/Dashboard";
import { PartnersPage } from "./pages/Partners";
import { UsersPage } from "./pages/Users";
import { RolesPage } from "./pages/Roles";
import { PackagesPage } from "./pages/Packages";
import { SettingsPage } from "./pages/Settings";
import { PlaceholderPage } from "./pages/Placeholder";
import type { Module } from "@shared/permissions";

function Protected({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const loc = useLocation();
  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted text-sm">Loading…</div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <>{children}</>;
}

function Gate({ module, children }: { module: Module; children: React.ReactNode }) {
  const { data: user } = useCurrentUser();
  if (!canModule(user, module)) {
    return (
      <div className="stamp-card p-10 text-center text-muted">
        You do not have permission to view this page.
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route path="/partners" element={<Gate module="partners"><PartnersPage /></Gate>} />
        <Route path="/users" element={<Gate module="users"><UsersPage /></Gate>} />
        <Route path="/roles" element={<Gate module="roles"><RolesPage /></Gate>} />
        <Route path="/packages" element={<Gate module="packages"><PackagesPage /></Gate>} />
        <Route path="/settings" element={<Gate module="settings"><SettingsPage /></Gate>} />
        <Route path="/customers" element={<Gate module="customers"><PlaceholderPage moduleKey="customers" /></Gate>} />
        <Route path="/requests" element={<Gate module="requests"><PlaceholderPage moduleKey="requests" /></Gate>} />
        <Route path="/payments" element={<Gate module="payments"><PlaceholderPage moduleKey="payments" /></Gate>} />
        <Route path="/partner-commissions" element={<Gate module="partner_commissions"><PlaceholderPage moduleKey="partner_commissions" /></Gate>} />
        <Route path="/sales-commissions" element={<Gate module="sales_commissions"><PlaceholderPage moduleKey="sales_commissions" /></Gate>} />
        <Route path="/claims" element={<Gate module="claims"><PlaceholderPage moduleKey="claims" /></Gate>} />
        <Route path="/payout-batches" element={<Gate module="payout_batches"><PlaceholderPage moduleKey="payout_batches" /></Gate>} />
        <Route path="/settlements" element={<Gate module="settlements"><PlaceholderPage moduleKey="settlements" /></Gate>} />
        <Route path="/ownership" element={<Gate module="ownership"><PlaceholderPage moduleKey="ownership" /></Gate>} />
        <Route path="/reports" element={<Gate module="reports"><PlaceholderPage moduleKey="reports" /></Gate>} />
        <Route path="/audit-log" element={<Gate module="audit_log"><PlaceholderPage moduleKey="audit_log" /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

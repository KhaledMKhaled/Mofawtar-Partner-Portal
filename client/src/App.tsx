import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrentUser, canModule } from "./hooks/useAuth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/Login";
import { ForgotPasswordPage } from "./pages/ForgotPassword";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { DashboardPage } from "./pages/Dashboard";
import { PartnersPage } from "./pages/Partners";
import { PartnerDetailPage } from "./pages/PartnerDetail";
import { UsersPage } from "./pages/Users";
import { RolesPage } from "./pages/Roles";
import { PackagesPage } from "./pages/Packages";
import { SettingsPage } from "./pages/Settings";
import { CustomersPage } from "./pages/Customers";
import { Customer360Page } from "./pages/Customer360";
import { RequestsPage } from "./pages/Requests";
import { RequestDetailPage } from "./pages/RequestDetail";
import { OwnershipPage } from "./pages/Ownership";
import { NotificationsPage } from "./pages/Notifications";
import { PaymentsPage } from "./pages/Payments";
import { PartnerCommissionsPage } from "./pages/PartnerCommissions";
import { SalesCommissionsPage } from "./pages/SalesCommissions";
import { ClaimsPage, ClaimDetailPage } from "./pages/Claims";
import { PayoutBatchesPage, PayoutBatchDetailPage } from "./pages/PayoutBatches";
import { SettlementsPage, SettlementDetailPage } from "./pages/Settlements";
import { ReportsPage } from "./pages/Reports";
import { AuditLogPage } from "./pages/AuditLog";
import { ExcelImportPage } from "./pages/ExcelImport";
import type { Module } from "@shared/permissions";

function Protected({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const loc = useLocation();
  if (isLoading) {
    return <div className="min-h-screen grid place-items-center text-muted text-sm">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <>{children}</>;
}

function Gate({ module, children }: { module: Module; children: React.ReactNode }) {
  const { data: user } = useCurrentUser();
  const { t } = useTranslation();
  if (!canModule(user, module)) {
    return <div className="stamp-card p-10 text-center text-muted">{t("common.permissionDenied")}</div>;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<Protected><AppShell /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route path="/partners" element={<Gate module="partners"><PartnersPage /></Gate>} />
        <Route path="/partners/:id" element={<Gate module="partners"><PartnerDetailPage /></Gate>} />
        <Route path="/users" element={<Gate module="users"><UsersPage /></Gate>} />
        <Route path="/roles" element={<Gate module="roles"><RolesPage /></Gate>} />
        <Route path="/packages" element={<Gate module="packages"><PackagesPage /></Gate>} />
        <Route path="/settings" element={<Gate module="settings"><SettingsPage /></Gate>} />
        <Route path="/customers" element={<Gate module="customers"><CustomersPage /></Gate>} />
        <Route path="/customers/:id" element={<Gate module="customers"><Customer360Page /></Gate>} />
        <Route path="/requests" element={<Gate module="requests"><RequestsPage /></Gate>} />
        <Route path="/requests/:id" element={<Gate module="requests"><RequestDetailPage /></Gate>} />
        <Route path="/ownership" element={<Gate module="ownership"><OwnershipPage /></Gate>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/payments" element={<Gate module="payments"><PaymentsPage /></Gate>} />
        <Route path="/partner-commissions" element={<Gate module="partner_commissions"><PartnerCommissionsPage /></Gate>} />
        <Route path="/sales-commissions" element={<Gate module="sales_commissions"><SalesCommissionsPage /></Gate>} />
        <Route path="/claims" element={<Gate module="claims"><ClaimsPage /></Gate>} />
        <Route path="/claims/:id" element={<Gate module="claims"><ClaimDetailPage /></Gate>} />
        <Route path="/payout-batches" element={<Gate module="payout_batches"><PayoutBatchesPage /></Gate>} />
        <Route path="/payout-batches/:id" element={<Gate module="payout_batches"><PayoutBatchDetailPage /></Gate>} />
        <Route path="/settlements" element={<Gate module="settlements"><SettlementsPage /></Gate>} />
        <Route path="/settlements/:id" element={<Gate module="settlements"><SettlementDetailPage /></Gate>} />
        <Route path="/reports" element={<Gate module="reports"><ReportsPage /></Gate>} />
        <Route path="/audit-log" element={<Gate module="audit_log"><AuditLogPage /></Gate>} />
        <Route path="/excel-import" element={<Gate module="excel_import"><ExcelImportPage /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

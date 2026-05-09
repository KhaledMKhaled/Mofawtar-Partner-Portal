import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrentUser, canModule } from "./hooks/useAuth";
import { AppShell } from "./components/AppShell";
import type { Module } from "@shared/permissions";

const LoginPage = lazy(() => import("./pages/Login").then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPassword").then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/ResetPassword").then(m => ({ default: m.ResetPasswordPage })));
const ChangePasswordPage = lazy(() => import("./pages/ChangePassword").then(m => ({ default: m.ChangePasswordPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.DashboardPage })));
const PartnersPage = lazy(() => import("./pages/Partners").then(m => ({ default: m.PartnersPage })));
const PartnerDetailPage = lazy(() => import("./pages/PartnerDetail").then(m => ({ default: m.PartnerDetailPage })));
const UsersPage = lazy(() => import("./pages/Users").then(m => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import("./pages/Roles").then(m => ({ default: m.RolesPage })));
const PackagesPage = lazy(() => import("./pages/Packages").then(m => ({ default: m.PackagesPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then(m => ({ default: m.SettingsPage })));
const CustomersPage = lazy(() => import("./pages/Customers").then(m => ({ default: m.CustomersPage })));
const Customer360Page = lazy(() => import("./pages/Customer360").then(m => ({ default: m.Customer360Page })));
const RequestsPage = lazy(() => import("./pages/Requests").then(m => ({ default: m.RequestsPage })));
const RequestDetailPage = lazy(() => import("./pages/RequestDetail").then(m => ({ default: m.RequestDetailPage })));
const OwnershipPage = lazy(() => import("./pages/Ownership").then(m => ({ default: m.OwnershipPage })));
const NotificationsPage = lazy(() => import("./pages/Notifications").then(m => ({ default: m.NotificationsPage })));
const PaymentsPage = lazy(() => import("./pages/Payments").then(m => ({ default: m.PaymentsPage })));
const PaymentDetailPage = lazy(() => import("./pages/PaymentDetail").then(m => ({ default: m.PaymentDetailPage })));
const PartnerCommissionsPage = lazy(() => import("./pages/PartnerCommissions").then(m => ({ default: m.PartnerCommissionsPage })));
const SalesCommissionsPage = lazy(() => import("./pages/SalesCommissions").then(m => ({ default: m.SalesCommissionsPage })));
const ClaimsPage = lazy(() => import("./pages/Claims").then(m => ({ default: m.ClaimsPage })));
const ClaimDetailPage = lazy(() => import("./pages/Claims").then(m => ({ default: m.ClaimDetailPage })));
const PayoutBatchesPage = lazy(() => import("./pages/PayoutBatches").then(m => ({ default: m.PayoutBatchesPage })));
const PayoutBatchDetailPage = lazy(() => import("./pages/PayoutBatches").then(m => ({ default: m.PayoutBatchDetailPage })));
const SettlementsPage = lazy(() => import("./pages/Settlements").then(m => ({ default: m.SettlementsPage })));
const SettlementDetailPage = lazy(() => import("./pages/Settlements").then(m => ({ default: m.SettlementDetailPage })));
const ReportsPage = lazy(() => import("./pages/Reports").then(m => ({ default: m.ReportsPage })));
const AuditLogPage = lazy(() => import("./pages/AuditLog").then(m => ({ default: m.AuditLogPage })));
const ExcelImportPage = lazy(() => import("./pages/ExcelImport").then(m => ({ default: m.ExcelImportPage })));

function PageFallback() {
  return <div className="min-h-[40vh] grid place-items-center text-muted text-sm">Loading…</div>;
}

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
    <Suspense fallback={<PageFallback />}>
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
          <Route path="/payments/:id" element={<Gate module="payments"><PaymentDetailPage /></Gate>} />
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
    </Suspense>
  );
}

// Permission model — module/action pairs used across the app.
export const MODULES = [
  "dashboard",
  "partners",
  "users",
  "roles",
  "packages",
  "customers",
  "requests",
  "payments",
  "partner_commissions",
  "sales_commissions",
  "claims",
  "settlements",
  "ownership",
  "reports",
  "audit_log",
  "notifications",
  "excel_import",
  "settings",
] as const;

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "reject",
  "export",
  "import",
  "change_status",
  "reopen",
  "reassign",
  "manage",
  "advance_lifecycle",
  "manual_override",
] as const;

export type Module = (typeof MODULES)[number];
export type Action = (typeof ACTIONS)[number];
export type Permission = `${Module}:${Action}`;

export const ROLE_KEYS = [
  "company_super_admin",
  "company_accountant",
  "partner_admin",
  "partner_accountant",
  "team_leader",
  "sales",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, { en: string; ar: string }> = {
  company_super_admin: { en: "Company Super Admin", ar: "مدير عام الشركة" },
  company_accountant: { en: "Company Accountant", ar: "محاسب الشركة" },
  partner_admin: { en: "Partner Admin", ar: "مدير الشريك" },
  partner_accountant: { en: "Partner Accountant", ar: "محاسب الشريك" },
  team_leader: { en: "Team Leader", ar: "قائد الفريق" },
  sales: { en: "Sales", ar: "مندوب المبيعات" },
};

const all = (...mods: Module[]): Permission[] =>
  mods.flatMap((m) => ACTIONS.map((a) => `${m}:${a}` as Permission));

const view = (...mods: Module[]): Permission[] =>
  mods.map((m) => `${m}:view` as Permission);

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  company_super_admin: all(...MODULES),
  company_accountant: [
    ...view("dashboard"),
    ...all(
      "payments",
      "partner_commissions",
      "sales_commissions",
      "claims",
      "settlements",
      "reports"
    ),
    ...view("requests", "customers", "partners", "packages", "ownership", "audit_log"),
    "requests:change_status",
    "requests:reopen",
    "requests:advance_lifecycle",
    "payments:manual_override",
    "partner_commissions:manual_override",
    "sales_commissions:manual_override",
    "claims:manual_override",
    "settlements:manual_override",
    "excel_import:view",
    "excel_import:import",
    "audit_log:view",
    "reports:view",
    "reports:export",
  ],
  partner_admin: [
    ...view("dashboard", "ownership", "reports", "packages"),
    ...all("users", "customers"),
    // Partners can fully manage requests EXCEPT changing their lifecycle
    // status — status transitions (received → under_activation → activated /
    // failed / rejected) are the exclusive responsibility of the parent
    // company team. Reopening from a terminal status remains a separate
    // permission and is not granted here either.
    "requests:view",
    "requests:create",
    "requests:edit",
    "requests:delete",
    "requests:approve",
    "requests:reject",
    "requests:export",
    "requests:import",
    "requests:reassign",
    "requests:manage",
    ...view("payments", "partner_commissions", "claims", "settlements", "audit_log"),
    "payments:change_status",
    "partner_commissions:change_status",
    "claims:create",
    "claims:view",
    "audit_log:view",
    "reports:view",
    "reports:export",
  ],
  partner_accountant: [
    ...view("dashboard", "payments", "partner_commissions", "claims", "settlements", "reports", "packages"),
    "payments:change_status",
    "partner_commissions:change_status",
    "claims:create",
    "reports:view",
    "reports:export",
  ],
  team_leader: [
    ...view("dashboard", "customers", "requests", "reports", "sales_commissions", "packages"),
    "requests:create",
    "reports:view",
  ],
  sales: [
    ...view("dashboard", "customers", "requests", "packages"),
    "requests:create",
    "sales_commissions:view",
  ],
};

export const DEFAULT_NAVIGATION: Record<RoleKey, Module[]> = {
  company_super_admin: [
    "dashboard","partners","users","roles","packages","customers","requests",
    "payments","partner_commissions","sales_commissions","claims","settlements",
    "ownership","reports","audit_log","settings",
  ],
  company_accountant: [
    "dashboard","requests","payments","partner_commissions","sales_commissions",
    "claims","settlements","reports","audit_log",
  ],
  partner_admin: [
    "dashboard","users","customers","requests","payments","partner_commissions",
    "claims","settlements","ownership","reports","audit_log",
  ],
  partner_accountant: [
    "dashboard","payments","partner_commissions","claims","settlements","reports",
  ],
  team_leader: [
    "dashboard","customers","requests","sales_commissions","reports",
  ],
  sales: [
    "dashboard","customers","requests","sales_commissions",
  ],
};

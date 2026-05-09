import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const partners = pgTable("partners", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  address: text("address"),
  imageUrl: text("image_url"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  // contract
  contractStartDate: timestamp("contract_start_date", { mode: "date" }),
  partnerCommissionPct: numeric("partner_commission_pct", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
  commissionPeriodDays: integer("commission_period_days").notNull().default(30),
  safetyPeriodDays: integer("safety_period_days").notNull().default(14),
  claimCycleType: varchar("claim_cycle_type", { length: 20 }).notNull().default("manual"), // auto|manual
  claimCycleDays: integer("claim_cycle_days").notNull().default(30),
  salesCommissionEnabled: boolean("sales_commission_enabled").notNull().default(false),
  salesCommissionPct: numeric("sales_commission_pct", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
  salesPayoutCycle: varchar("sales_payout_cycle", { length: 20 }).notNull().default("monthly"), // monthly|quarterly
  // ownership
  ownershipPeriodValue: integer("ownership_period_value").notNull().default(3),
  ownershipPeriodUnit: varchar("ownership_period_unit", { length: 10 }).notNull().default("years"), // years|months
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 60 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 120 }).notNull(),
  nameAr: varchar("name_ar", { length: 120 }).notNull(),
  scope: varchar("scope", { length: 20 }).notNull().default("company"), // company|partner
  isSystem: boolean("is_system").notNull().default(false),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    imageUrl: text("image_url"),
    address: text("address"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    roleId: integer("role_id").notNull().references(() => roles.id),
    partnerId: integer("partner_id").references(() => partners.id),
    teamLeaderId: integer("team_leader_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    partnerIdx: index("users_partner_idx").on(t.partnerId),
  })
);

export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  itemPriceBeforeTax: numeric("item_price_before_tax", { precision: 14, scale: 2 }).notNull(),
  taxPct: numeric("tax_pct", { precision: 6, scale: 3 }).notNull().default("14"),
  finalPriceAfterTax: numeric("final_price_after_tax", { precision: 14, scale: 2 }).notNull(),
  durationDays: integer("duration_days").notNull().default(365),
  packageType: varchar("package_type", { length: 50 }).notNull().default("subscription"),
  active: boolean("active").notNull().default(true),
  availableForAll: boolean("available_for_all").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const packagePartners = pgTable(
  "package_partners",
  {
    packageId: integer("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    partnerId: integer("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.packageId, t.partnerId] }) })
);

export const commissionRules = pgTable("commission_rules", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  packageId: integer("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  operationType: varchar("operation_type", { length: 40 }).notNull(),
  partnerCommissionPct: numeric("partner_commission_pct", { precision: 6, scale: 3 }).notNull(),
  salesCommissionPct: numeric("sales_commission_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 60 }),
    entityId: varchar("entity_id", { length: 60 }),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    note: text("note"),
    partnerId: integer("partner_id"),
    customerId: integer("customer_id"),
    requestId: integer("request_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ actionIdx: index("audit_log_action_idx").on(t.action) })
);

export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export type Partner = typeof partners.$inferSelect;
export type NewPartner = typeof partners.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type CommissionRule = typeof commissionRules.$inferSelect;

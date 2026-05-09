import { db, pool } from "./db.js";
import { roles, users, partners, packages, settings } from "./schema.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth.js";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  type RoleKey,
} from "../shared/permissions.js";

export async function ensureSchema() {
  // Idempotent CREATE TABLE statements so the app can boot without a separate migration step.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      address TEXT,
      image_url TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      contract_start_date TIMESTAMP,
      partner_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
      commission_period_days INTEGER NOT NULL DEFAULT 30,
      safety_period_days INTEGER NOT NULL DEFAULT 14,
      claim_cycle_type VARCHAR(20) NOT NULL DEFAULT 'manual',
      claim_cycle_days INTEGER NOT NULL DEFAULT 30,
      sales_commission_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      sales_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
      sales_payout_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      ownership_period_value INTEGER NOT NULL DEFAULT 3,
      ownership_period_unit VARCHAR(10) NOT NULL DEFAULT 'years',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      key VARCHAR(60) NOT NULL UNIQUE,
      name_en VARCHAR(120) NOT NULL,
      name_ar VARCHAR(120) NOT NULL,
      scope VARCHAR(20) NOT NULL DEFAULT 'company',
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL,
      password_hash TEXT NOT NULL,
      image_url TEXT,
      address TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      role_id INTEGER NOT NULL REFERENCES roles(id),
      partner_id INTEGER REFERENCES partners(id),
      team_leader_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
    CREATE INDEX IF NOT EXISTS users_partner_idx ON users(partner_id);

    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      item_price_before_tax NUMERIC(14,2) NOT NULL,
      tax_pct NUMERIC(6,3) NOT NULL DEFAULT 14,
      final_price_after_tax NUMERIC(14,2) NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 365,
      package_type VARCHAR(50) NOT NULL DEFAULT 'subscription',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      available_for_all BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS package_partners (
      package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      PRIMARY KEY (package_id, partner_id)
    );

    CREATE TABLE IF NOT EXISTS commission_rules (
      id SERIAL PRIMARY KEY,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      operation_type VARCHAR(40) NOT NULL,
      partner_commission_pct NUMERIC(6,3) NOT NULL,
      sales_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(60),
      entity_id VARCHAR(60),
      old_value JSONB,
      new_value JSONB,
      note TEXT,
      partner_id INTEGER,
      customer_id INTEGER,
      request_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action);
  `);
}

const ROLE_SCOPE: Record<RoleKey, "company" | "partner"> = {
  company_super_admin: "company",
  company_accountant: "company",
  partner_admin: "partner",
  partner_accountant: "partner",
  team_leader: "partner",
  sales: "partner",
};

export async function runSeed() {
  // Roles
  for (const key of ROLE_KEYS) {
    const existing = await db.select().from(roles).where(eq(roles.key, key));
    const labels = ROLE_LABELS[key];
    if (!existing[0]) {
      await db.insert(roles).values({
        key,
        nameEn: labels.en,
        nameAr: labels.ar,
        scope: ROLE_SCOPE[key],
        isSystem: true,
        permissions: DEFAULT_ROLE_PERMISSIONS[key] as unknown as string[],
      });
    } else {
      // Refresh permissions for system roles to keep them up to date with code
      await db
        .update(roles)
        .set({ permissions: DEFAULT_ROLE_PERMISSIONS[key] as unknown as string[] })
        .where(eq(roles.id, existing[0].id));
    }
  }

  const [superAdminRole] = await db.select().from(roles).where(eq(roles.key, "company_super_admin"));
  const [companyAccountantRole] = await db.select().from(roles).where(eq(roles.key, "company_accountant"));
  const [partnerAdminRole] = await db.select().from(roles).where(eq(roles.key, "partner_admin"));
  const [partnerAccountantRole] = await db.select().from(roles).where(eq(roles.key, "partner_accountant"));
  const [teamLeaderRole] = await db.select().from(roles).where(eq(roles.key, "team_leader"));
  const [salesRole] = await db.select().from(roles).where(eq(roles.key, "sales"));

  // Demo partner
  let [demoPartner] = await db.select().from(partners).where(eq(partners.code, "DEMO"));
  if (!demoPartner) {
    const inserted = await db
      .insert(partners)
      .values({
        name: "Demo Partner",
        code: "DEMO",
        address: "Cairo, Egypt",
        status: "active",
        contractStartDate: new Date(),
        partnerCommissionPct: "20",
        commissionPeriodDays: 30,
        safetyPeriodDays: 14,
        claimCycleType: "auto",
        claimCycleDays: 2,
        salesCommissionEnabled: true,
        salesCommissionPct: "5",
        salesPayoutCycle: "monthly",
        ownershipPeriodValue: 3,
        ownershipPeriodUnit: "years",
      })
      .returning();
    demoPartner = inserted[0];
  }

  // Demo users
  const demoUsers: Array<{
    name: string;
    email: string;
    password: string;
    roleId: number;
    partnerId: number | null;
    teamLeaderId?: number | null;
  }> = [
    { name: "Company Super Admin", email: "superadmin@mofawter.com", password: "password123", roleId: superAdminRole.id, partnerId: null },
    { name: "Company Accountant", email: "accountant@mofawter.com", password: "password123", roleId: companyAccountantRole.id, partnerId: null },
    { name: "Demo Partner Admin", email: "partner.admin@demo.com", password: "password123", roleId: partnerAdminRole.id, partnerId: demoPartner.id },
    { name: "Demo Partner Accountant", email: "partner.accountant@demo.com", password: "password123", roleId: partnerAccountantRole.id, partnerId: demoPartner.id },
    { name: "Demo Team Leader", email: "team.leader@demo.com", password: "password123", roleId: teamLeaderRole.id, partnerId: demoPartner.id },
  ];

  let teamLeaderId: number | null = null;
  for (const du of demoUsers) {
    const existing = await db.select().from(users).where(eq(users.email, du.email));
    if (!existing[0]) {
      const hash = await hashPassword(du.password);
      const [u] = await db
        .insert(users)
        .values({
          name: du.name,
          email: du.email,
          passwordHash: hash,
          roleId: du.roleId,
          partnerId: du.partnerId,
        })
        .returning();
      if (du.email === "team.leader@demo.com") teamLeaderId = u.id;
    } else if (du.email === "team.leader@demo.com") {
      teamLeaderId = existing[0].id;
    }
  }

  const salesEmail = "sales@demo.com";
  const existingSales = await db.select().from(users).where(eq(users.email, salesEmail));
  if (!existingSales[0]) {
    const hash = await hashPassword("password123");
    await db.insert(users).values({
      name: "Demo Sales",
      email: salesEmail,
      passwordHash: hash,
      roleId: salesRole.id,
      partnerId: demoPartner.id,
      teamLeaderId,
    });
  }

  // Packages
  const seedPackages = [
    { name: "Basic Package", desc: "Entry-level e-invoicing package", price: 1000, taxPct: 14, days: 365 },
    { name: "Pro Package", desc: "Pro-tier e-invoicing package", price: 2000, taxPct: 14, days: 365 },
    { name: "Add-on Package", desc: "Add-on services", price: 500, taxPct: 14, days: 365 },
  ];
  for (const sp of seedPackages) {
    const existing = await db.select().from(packages).where(eq(packages.name, sp.name));
    if (!existing[0]) {
      const final = sp.price + (sp.price * sp.taxPct) / 100;
      await db.insert(packages).values({
        name: sp.name,
        description: sp.desc,
        itemPriceBeforeTax: String(sp.price),
        taxPct: String(sp.taxPct),
        finalPriceAfterTax: String(final),
        durationDays: sp.days,
        packageType: "subscription",
        active: true,
        availableForAll: true,
      });
    }
  }

  // Settings defaults
  const defaults = [
    { key: "language", value: "ar" },
    { key: "direction", value: "rtl" },
    { key: "currency", value: "EGP" },
    { key: "timezone", value: "Africa/Cairo" },
    { key: "ownership_expiry_warning_days", value: 30 },
    { key: "commission_calculation_base", value: "before_tax" },
  ];
  for (const s of defaults) {
    const existing = await db.select().from(settings).where(eq(settings.key, s.key));
    if (!existing[0]) await db.insert(settings).values({ key: s.key, value: s.value });
  }

  console.log("Seed complete.");
}

// Allow running directly: `tsx server/seed.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSchema()
    .then(runSeed)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

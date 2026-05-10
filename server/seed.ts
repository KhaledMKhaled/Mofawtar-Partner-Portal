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
      default_partner_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
      default_sales_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE packages
      ADD COLUMN IF NOT EXISTS default_partner_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0;
    ALTER TABLE packages
      ADD COLUMN IF NOT EXISTS default_sales_commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS team_assignments (
      team_leader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sales_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (team_leader_id, sales_user_id)
    );
    CREATE INDEX IF NOT EXISTS team_assignments_partner_idx ON team_assignments(partner_id);
    CREATE INDEX IF NOT EXISTS team_assignments_sales_idx ON team_assignments(sales_user_id);

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

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      tax_card_number VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(250) NOT NULL,
      contact_person VARCHAR(200),
      contact_phone VARCHAR(50),
      email VARCHAR(200),
      address TEXT,
      tax_office VARCHAR(200),
      business_activity VARCHAR(200),
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS customers_tax_idx ON customers(tax_card_number);
    CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name);

    CREATE TABLE IF NOT EXISTS customer_ownership (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      partner_id INTEGER REFERENCES partners(id),
      start_date TIMESTAMP NOT NULL,
      end_date TIMESTAMP NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      transferred_from_partner_id INTEGER,
      reason TEXT,
      created_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ownership_customer_idx ON customer_ownership(customer_id);
    CREATE INDEX IF NOT EXISTS ownership_partner_idx ON customer_ownership(partner_id);
    CREATE INDEX IF NOT EXISTS ownership_status_idx ON customer_ownership(status);

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      sr_number VARCHAR(80) NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      sales_user_id INTEGER REFERENCES users(id),
      team_leader_id INTEGER REFERENCES users(id),
      package_id INTEGER REFERENCES packages(id),
      operation_type VARCHAR(40),
      real_receipt_number VARCHAR(80),
      payment_status VARCHAR(40) NOT NULL DEFAULT 'pending_collection_confirmation',
      status VARCHAR(30) NOT NULL DEFAULT 'draft_sr',
      rejection_reason TEXT,
      activated_at TIMESTAMP,
      submitted_at TIMESTAMP,
      created_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(status);
    CREATE INDEX IF NOT EXISTS requests_customer_idx ON requests(customer_id);
    CREATE INDEX IF NOT EXISTS requests_partner_idx ON requests(partner_id);
    CREATE INDEX IF NOT EXISTS requests_sales_idx ON requests(sales_user_id);

    -- Unified Transaction Lifecycle additions (idempotent).
    ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS lifecycle_stage VARCHAR(50) NOT NULL DEFAULT 'draft_sr';
    ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS lifecycle_exception VARCHAR(50);
    ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS cancelled_from_request_id INTEGER;
    ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS cloned_to_request_id INTEGER;
    CREATE INDEX IF NOT EXISTS requests_lifecycle_idx ON requests(lifecycle_stage);

    CREATE TABLE IF NOT EXISTS master_lifecycle_history (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      from_stage VARCHAR(50),
      to_stage VARCHAR(50) NOT NULL,
      from_exception VARCHAR(50),
      to_exception VARCHAR(50),
      action VARCHAR(50) NOT NULL,
      reason TEXT,
      changed_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS master_lifecycle_history_request_idx ON master_lifecycle_history(request_id);

    -- 1-to-1 invariant: a claim can be linked to at most ONE settlement.
    -- Partial unique index ignores legacy NULLs while enforcing uniqueness
    -- for every populated settlements.claim_id going forward.
    CREATE UNIQUE INDEX IF NOT EXISTS settlements_claim_uniq
      ON settlements(claim_id) WHERE claim_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS request_status_history (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      from_status VARCHAR(30),
      to_status VARCHAR(30) NOT NULL,
      reason TEXT,
      changed_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS request_reassignments (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      from_sales_user_id INTEGER,
      to_sales_user_id INTEGER,
      reason TEXT,
      by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(60) NOT NULL,
      title_en VARCHAR(250) NOT NULL,
      title_ar VARCHAR(250) NOT NULL,
      body_en TEXT,
      body_ar TEXT,
      entity_type VARCHAR(40),
      entity_id VARCHAR(60),
      link_path VARCHAR(200),
      read_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at);

    -- Phase 3: financial tables -----------------------------------------------
    CREATE TABLE IF NOT EXISTS order_payments (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      package_id INTEGER REFERENCES packages(id),
      gross_amount NUMERIC(14,2) NOT NULL,
      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(14,2) NOT NULL,
      partner_commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      net_due_to_company NUMERIC(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'pending_collection_confirmation',
      settlement_id INTEGER,
      received_at TIMESTAMP,
      settled_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS order_payments_request_idx ON order_payments(request_id);
    CREATE INDEX IF NOT EXISTS order_payments_partner_idx ON order_payments(partner_id);
    CREATE INDEX IF NOT EXISTS order_payments_status_idx ON order_payments(status);

    CREATE TABLE IF NOT EXISTS order_payment_status_history (
      id SERIAL PRIMARY KEY,
      order_payment_id INTEGER NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
      from_status VARCHAR(40),
      to_status VARCHAR(40) NOT NULL,
      reason TEXT,
      changed_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS partner_commissions (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      order_payment_id INTEGER REFERENCES order_payments(id),
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      package_id INTEGER REFERENCES packages(id),
      base_amount NUMERIC(14,2) NOT NULL,
      pct NUMERIC(6,3) NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      safety_ends_at TIMESTAMP,
      status VARCHAR(40) NOT NULL DEFAULT 'in_safety_period',
      claim_id INTEGER,
      settlement_id INTEGER,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS partner_commissions_partner_idx ON partner_commissions(partner_id);
    CREATE INDEX IF NOT EXISTS partner_commissions_status_idx ON partner_commissions(status);
    CREATE INDEX IF NOT EXISTS partner_commissions_request_idx ON partner_commissions(request_id);

    CREATE TABLE IF NOT EXISTS partner_commission_status_history (
      id SERIAL PRIMARY KEY,
      partner_commission_id INTEGER NOT NULL REFERENCES partner_commissions(id) ON DELETE CASCADE,
      from_status VARCHAR(40),
      to_status VARCHAR(40) NOT NULL,
      reason TEXT,
      changed_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sales_commissions (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      order_payment_id INTEGER REFERENCES order_payments(id),
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      sales_user_id INTEGER REFERENCES users(id),
      team_leader_id INTEGER REFERENCES users(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      package_id INTEGER REFERENCES packages(id),
      base_amount NUMERIC(14,2) NOT NULL,
      pct NUMERIC(6,3) NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'new',
      payout_batch_id INTEGER,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sales_commissions_partner_idx ON sales_commissions(partner_id);
    CREATE INDEX IF NOT EXISTS sales_commissions_sales_idx ON sales_commissions(sales_user_id);
    CREATE INDEX IF NOT EXISTS sales_commissions_status_idx ON sales_commissions(status);

    CREATE TABLE IF NOT EXISTS sales_commission_status_history (
      id SERIAL PRIMARY KEY,
      sales_commission_id INTEGER NOT NULL REFERENCES sales_commissions(id) ON DELETE CASCADE,
      from_status VARCHAR(40),
      to_status VARCHAR(40) NOT NULL,
      reason TEXT,
      changed_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS claims (
      id SERIAL PRIMARY KEY,
      claim_number VARCHAR(60) NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      type VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      submitted_at TIMESTAMP,
      approved_at TIMESTAMP,
      approved_by_user_id INTEGER,
      rejected_at TIMESTAMP,
      rejection_reason TEXT,
      settled_at TIMESTAMP,
      settlement_id INTEGER,
      created_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS claims_partner_idx ON claims(partner_id);
    CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status);
    CREATE INDEX IF NOT EXISTS claims_type_idx ON claims(type);
    -- Pre-existing DBs may have been created without the type column; add it idempotently.
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS type VARCHAR(30);
    UPDATE claims SET type = 'partner_commission' WHERE type IS NULL;
    ALTER TABLE claims ALTER COLUMN type SET NOT NULL;

    CREATE TABLE IF NOT EXISTS claim_items (
      id SERIAL PRIMARY KEY,
      claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      partner_commission_id INTEGER REFERENCES partner_commissions(id),
      order_payment_id INTEGER REFERENCES order_payments(id),
      sales_commission_id INTEGER REFERENCES sales_commissions(id),
      amount NUMERIC(14,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT claim_items_exactly_one_subject CHECK (
        (CASE WHEN partner_commission_id IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN order_payment_id     IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN sales_commission_id  IS NOT NULL THEN 1 ELSE 0 END) = 1
      )
    );
    -- Idempotent column adds for pre-existing claim_items rows.
    ALTER TABLE claim_items ALTER COLUMN partner_commission_id DROP NOT NULL;
    ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS order_payment_id INTEGER REFERENCES order_payments(id);
    ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS sales_commission_id INTEGER REFERENCES sales_commissions(id);

    CREATE TABLE IF NOT EXISTS payout_batches (
      id SERIAL PRIMARY KEY,
      batch_number VARCHAR(60) NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      submitted_at TIMESTAMP,
      approved_at TIMESTAMP,
      approved_by_user_id INTEGER,
      paid_at TIMESTAMP,
      created_by_user_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS payout_batches_partner_idx ON payout_batches(partner_id);
    CREATE INDEX IF NOT EXISTS payout_batches_status_idx ON payout_batches(status);

    CREATE TABLE IF NOT EXISTS payout_batch_items (
      id SERIAL PRIMARY KEY,
      payout_batch_id INTEGER NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
      sales_commission_id INTEGER NOT NULL REFERENCES sales_commissions(id),
      amount NUMERIC(14,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id SERIAL PRIMARY KEY,
      settlement_number VARCHAR(60) NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      claim_id INTEGER NOT NULL REFERENCES claims(id),
      type VARCHAR(30) NOT NULL,
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      direction VARCHAR(20) NOT NULL DEFAULT 'partner_to_company',
      notes TEXT,
      created_by_user_id INTEGER,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS settlements_partner_idx ON settlements(partner_id);
    CREATE INDEX IF NOT EXISTS settlements_type_idx ON settlements(type);
    CREATE UNIQUE INDEX IF NOT EXISTS settlements_claim_uniq ON settlements(claim_id) WHERE claim_id IS NOT NULL;
    -- Idempotent shape upgrade for pre-existing settlements rows.
    ALTER TABLE settlements ADD COLUMN IF NOT EXISTS type VARCHAR(30);
    ALTER TABLE settlements ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
    UPDATE settlements SET type = 'partner_commission' WHERE type IS NULL;
    ALTER TABLE settlements ALTER COLUMN type SET NOT NULL;
    ALTER TABLE settlements DROP COLUMN IF EXISTS net_due_to_company;
    ALTER TABLE settlements DROP COLUMN IF EXISTS partner_commission_total;
    ALTER TABLE settlements DROP COLUMN IF EXISTS final_amount;

    -- Phase 3 financial integrity: prevent duplicate financial rows / double-claim / double-payout.
    CREATE UNIQUE INDEX IF NOT EXISTS order_payments_request_uniq ON order_payments(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS partner_commissions_request_uniq ON partner_commissions(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS sales_commissions_request_uniq ON sales_commissions(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS claim_items_pc_uniq ON claim_items(partner_commission_id);
    CREATE UNIQUE INDEX IF NOT EXISTS payout_batch_items_sc_uniq ON payout_batch_items(sales_commission_id);
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
  // Roles — only inserted when missing, so admin edits to default roles
  // remain durable across restarts. Operators who want to refresh the
  // baseline permissions for a system role can run this script directly
  // with RESEED_ROLE_PERMISSIONS=1 (one-time refresh, never on boot).
  const refreshDefaults = process.env.RESEED_ROLE_PERMISSIONS === "1";
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
    } else if (refreshDefaults) {
      await db
        .update(roles)
        .set({ permissions: DEFAULT_ROLE_PERMISSIONS[key] as unknown as string[] })
        .where(eq(roles.id, existing[0].id));
    }
  }

  const [superAdminRole] = await db.select().from(roles).where(eq(roles.key, "company_super_admin"));

  // Superadmin user
  const adminEmail = "a.sirag@mofawter.com";
  const existing = await db.select().from(users).where(eq(users.email, adminEmail));
  if (!existing[0]) {
    const hash = await hashPassword("123123123");
    await db.insert(users).values({
      name: "A. Sirag",
      email: adminEmail,
      passwordHash: hash,
      roleId: superAdminRole.id,
      partnerId: null,
    });
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

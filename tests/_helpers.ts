import { db, pool } from "../server/db.js";
import { ensureSchema } from "../server/seed.js";
import {
  partners,
  packages,
  customers,
  requests,
  customerOwnership,
  roles,
  users,
  settings,
  partnerCommissions,
  orderPayments,
  salesCommissions,
  claims,
  claimItems,
  auditLog,
  notifications,
} from "../server/schema.js";
import { eq, sql } from "drizzle-orm";

let schemaReady = false;

export async function setupSchema() {
  if (!schemaReady) {
    await ensureSchema();
    // Make sure default commission base setting exists.
    const existing = await db.select().from(settings).where(eq(settings.key, "commission_calculation_base"));
    if (!existing[0]) {
      await db.insert(settings).values({ key: "commission_calculation_base", value: "before_tax" as unknown as object });
    }
    schemaReady = true;
  }
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Make sure we have at least one role row so that auditing user FK constraints
// (none — auditLog.userId is nullable) and notifications never fan-out to a
// user that owns this partner. We create a system role lazily.
async function ensureSystemRole(): Promise<number> {
  const [r] = await db.select().from(roles).where(eq(roles.key, "test_isolated_role"));
  if (r) return r.id;
  const [ins] = await db
    .insert(roles)
    .values({ key: "test_isolated_role", nameEn: "Test", nameAr: "اختبار", scope: "company", isSystem: false, permissions: [] })
    .returning();
  return ins.id;
}

export interface TestFixture {
  partnerId: number;
  packageId: number;
  customerId: number;
  userId: number;
  cleanup: () => Promise<void>;
}

export async function createIsolatedFixture(opts: {
  claimCycleType?: "auto" | "manual";
  claimCycleDays?: number;
  safetyPeriodDays?: number;
  partnerCommissionPct?: string;
  salesCommissionEnabled?: boolean;
  salesCommissionPct?: string;
} = {}): Promise<TestFixture> {
  const sfx = uniqueSuffix();
  const roleId = await ensureSystemRole();

  const [partner] = await db
    .insert(partners)
    .values({
      name: `TestPartner-${sfx}`,
      code: `T-${sfx}`,
      status: "active",
      partnerCommissionPct: opts.partnerCommissionPct ?? "20",
      commissionPeriodDays: 30,
      safetyPeriodDays: opts.safetyPeriodDays ?? 14,
      claimCycleType: opts.claimCycleType ?? "manual",
      claimCycleDays: opts.claimCycleDays ?? 30,
      salesCommissionEnabled: opts.salesCommissionEnabled ?? false,
      salesCommissionPct: opts.salesCommissionPct ?? "0",
      salesPayoutCycle: "monthly",
      ownershipPeriodValue: 3,
      ownershipPeriodUnit: "years",
    })
    .returning();

  const [pkg] = await db
    .insert(packages)
    .values({
      name: `TestPackage-${sfx}`,
      itemPriceBeforeTax: "1000",
      taxPct: "14",
      finalPriceAfterTax: "1140",
      durationDays: 365,
      packageType: "subscription",
      active: true,
      availableForAll: true,
    })
    .returning();

  const [cust] = await db
    .insert(customers)
    .values({
      taxCardNumber: `TX-${sfx}`,
      name: `TestCustomer-${sfx}`,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      name: `TestUser-${sfx}`,
      email: `test-${sfx}@example.com`,
      passwordHash: "x",
      roleId,
      partnerId: partner.id,
    })
    .returning();

  // Create active ownership so isEligibleForCommission() returns true.
  const start = new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 3);
  await db.insert(customerOwnership).values({
    customerId: cust.id,
    partnerId: partner.id,
    startDate: start,
    endDate: end,
    status: "active",
    createdByUserId: user.id,
  });

  const fixture: TestFixture = {
    partnerId: partner.id,
    packageId: pkg.id,
    customerId: cust.id,
    userId: user.id,
    cleanup: async () => {
      // Best-effort cleanup. ON DELETE CASCADE handles dependents for partner/customer.
      await db.delete(claimItems).where(sql`${claimItems.claimId} IN (SELECT id FROM claims WHERE partner_id = ${partner.id})`);
      await db.delete(claims).where(eq(claims.partnerId, partner.id));
      await db.delete(salesCommissions).where(eq(salesCommissions.partnerId, partner.id));
      await db.delete(partnerCommissions).where(eq(partnerCommissions.partnerId, partner.id));
      await db.delete(orderPayments).where(eq(orderPayments.partnerId, partner.id));
      await db.delete(requests).where(eq(requests.partnerId, partner.id));
      await db.delete(customerOwnership).where(eq(customerOwnership.partnerId, partner.id));
      await db.delete(customers).where(eq(customers.id, cust.id));
      // Clear audit and notification rows that reference our test user before deleting it.
      await db.delete(auditLog).where(eq(auditLog.userId, user.id));
      await db.delete(notifications).where(eq(notifications.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
      await db.delete(packages).where(eq(packages.id, pkg.id));
      await db.delete(partners).where(eq(partners.id, partner.id));
    },
  };
  return fixture;
}

export async function createTestRequest(fx: TestFixture, opts: { activated?: boolean } = {}): Promise<number> {
  const sfx = uniqueSuffix();
  const [r] = await db
    .insert(requests)
    .values({
      srNumber: `SR-${sfx}`,
      customerId: fx.customerId,
      partnerId: fx.partnerId,
      packageId: fx.packageId,
      operationType: "new",
      status: opts.activated ? "activated" : "new_request",
      activatedAt: opts.activated ? new Date() : null,
      createdByUserId: fx.userId,
    })
    .returning();
  return r.id;
}

export async function closePool() {
  await pool.end();
}

export { db, pool };

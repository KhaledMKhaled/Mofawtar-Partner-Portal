import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db, type DbExecutor } from "./db.js";
import {
  customerOwnership,
  customers,
  partners,
  users,
  requests,
} from "./schema.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import type { Partner } from "./schema.js";

export function addOwnershipPeriod(start: Date, partner: Pick<Partner, "ownershipPeriodValue" | "ownershipPeriodUnit">): Date {
  const end = new Date(start);
  if (partner.ownershipPeriodUnit === "months") {
    end.setMonth(end.getMonth() + partner.ownershipPeriodValue);
  } else {
    end.setFullYear(end.getFullYear() + partner.ownershipPeriodValue);
  }
  return end;
}

// Find the ownership row covering `customerId` at `at` (defaults to now).
// Returns the most recently created matching row in case of overlaps.
// Accepts an executor so callers running inside a transaction can see
// rows that were just inserted within the same tx.
export async function getOwnerAt(
  customerId: number,
  at: Date = new Date(),
  executor: DbExecutor = db,
) {
  const rows = await executor
    .select()
    .from(customerOwnership)
    .where(
      and(
        eq(customerOwnership.customerId, customerId),
        lte(customerOwnership.startDate, at),
      )
    )
    .orderBy(desc(customerOwnership.createdAt));
  return rows.find((r) => r.endDate >= at) ?? null;
}

export async function isEligibleForCommission(
  customerId: number,
  partnerId: number,
  at: Date = new Date(),
  executor: DbExecutor = db,
): Promise<boolean> {
  const owner = await getOwnerAt(customerId, at, executor);
  if (!owner) return false;
  if (owner.partnerId !== partnerId) return false;
  if (owner.status === "transferred" || owner.status === "returned_to_company") return false;
  return owner.status === "active" || owner.status === "extended";
}

// Mark ownership rows whose end_date is in the past and still flagged as
// active/extended. Emits `ownership.expired` notifications. Also emits
// `ownership.near_expiry` for rows expiring within `warningDays`.
export async function markExpiredOwnerships(warningDays = 30): Promise<{ expired: number; warned: number }> {
  const now = new Date();
  const expiredRows = await db
    .select()
    .from(customerOwnership)
    .where(
      and(
        sql`${customerOwnership.endDate} < ${now}`,
        sql`${customerOwnership.status} IN ('active','extended')`,
      )
    );
  for (const row of expiredRows) {
    await db
      .update(customerOwnership)
      .set({ status: "expired" })
      .where(eq(customerOwnership.id, row.id));
    await notifyOwnershipChange(row.customerId, row.partnerId, "ownership.expired");
    await audit({
      action: "ownership.expired",
      entityType: "ownership",
      entityId: row.id,
      customerId: row.customerId,
      partnerId: row.partnerId ?? undefined,
      oldValue: { status: row.status },
      newValue: { status: "expired" },
    });
  }

  const warnDate = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);
  const nearRows = await db
    .select()
    .from(customerOwnership)
    .where(
      and(
        sql`${customerOwnership.endDate} >= ${now}`,
        sql`${customerOwnership.endDate} <= ${warnDate}`,
        sql`${customerOwnership.status} IN ('active','extended')`,
      )
    );
  for (const row of nearRows) {
    await notifyOwnershipChange(row.customerId, row.partnerId, "ownership.near_expiry");
  }

  return { expired: expiredRows.length, warned: nearRows.length };
}

async function notifyOwnershipChange(
  customerId: number,
  partnerId: number | null,
  type: "ownership.expired" | "ownership.near_expiry",
) {
  const [cust] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!cust) return;
  // Notify partner admin(s) of the partner and all company super admins.
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(sql`roles r`, sql`r.id = ${users.roleId}`)
    .where(
      sql`(r.key = 'company_super_admin' OR (r.key = 'partner_admin' AND ${users.partnerId} = ${partnerId}))`
    );
  const titleEn = type === "ownership.expired" ? "Ownership expired" : "Ownership near expiry";
  const titleAr = type === "ownership.expired" ? "انتهاء ملكية العميل" : "اقتراب انتهاء ملكية العميل";
  for (const a of admins) {
    await notify({
      userId: a.id,
      type,
      titleEn,
      titleAr,
      bodyEn: `${cust.name} (${cust.taxCardNumber})`,
      bodyAr: `${cust.name} (${cust.taxCardNumber})`,
      entityType: "customer",
      entityId: customerId,
      linkPath: `/customers/${customerId}`,
    });
  }
}

// Helper used after the first activation of a request — closes any
// existing returned/expired marker by no-op (we don't reuse rows) and
// inserts a new active ownership.
export async function startOwnership(
  opts: {
    customerId: number;
    partnerId: number;
    userId: number;
    start?: Date;
  },
  executor: DbExecutor = db,
) {
  const start = opts.start ?? new Date();
  const [partner] = await executor.select().from(partners).where(eq(partners.id, opts.partnerId));
  if (!partner) throw new Error("partner_not_found");
  const end = addOwnershipPeriod(start, partner);
  const [row] = await executor
    .insert(customerOwnership)
    .values({
      customerId: opts.customerId,
      partnerId: opts.partnerId,
      startDate: start,
      endDate: end,
      status: "active",
      createdByUserId: opts.userId,
    })
    .returning();
  await audit({
    userId: opts.userId,
    action: "ownership.started",
    entityType: "ownership",
    entityId: row.id,
    customerId: opts.customerId,
    partnerId: opts.partnerId,
    newValue: row,
  });
  // Notify partner admin(s)
  const partnerAdmins = await executor
    .select({ id: users.id })
    .from(users)
    .innerJoin(sql`roles r`, sql`r.id = ${users.roleId}`)
    .where(
      sql`r.key IN ('partner_admin','company_super_admin') AND (${users.partnerId} = ${opts.partnerId} OR r.key = 'company_super_admin')`
    );
  for (const a of partnerAdmins) {
    await notify({
      userId: a.id,
      type: "ownership.started",
      titleEn: "Customer ownership started",
      titleAr: "بداية ملكية العميل",
      entityType: "customer",
      entityId: opts.customerId,
      linkPath: `/customers/${opts.customerId}`,
    });
  }
  return row;
}

// Latest ownership row for a customer (any status, any date), used to gate
// new requests against expired/returned-to-company state.
export async function getLatestOwnership(customerId: number) {
  const [row] = await db
    .select()
    .from(customerOwnership)
    .where(eq(customerOwnership.customerId, customerId))
    .orderBy(desc(customerOwnership.startDate), desc(customerOwnership.createdAt))
    .limit(1);
  return row ?? null;
}

// Returns whether this customer has ever been activated by this partner.
export async function hasPreviousActivation(customerId: number, partnerId: number): Promise<boolean> {
  const rows = await db
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        eq(requests.customerId, customerId),
        eq(requests.partnerId, partnerId),
        eq(requests.status, "activated"),
      )
    )
    .limit(1);
  return rows.length > 0;
}

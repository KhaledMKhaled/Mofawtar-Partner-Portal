import { and, desc, eq, sql, inArray, gte, lte } from "drizzle-orm";
import { db } from "./db.js";
import {
  orderPayments,
  orderPaymentStatusHistory,
  partnerCommissions,
  partnerCommissionStatusHistory,
  salesCommissions,
  salesCommissionStatusHistory,
  claims,
  claimItems,
  payoutBatches,
  payoutBatchItems,
  settlements,
  partners,
  packages,
  commissionRules,
  requests,
  users,
  settings,
  roles,
} from "./schema.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { isEligibleForCommission } from "./ownership.js";
import {
  isAllowedOrderPaymentTransition,
  isAllowedPartnerCommissionTransition,
  isAllowedSalesCommissionTransition,
  type OrderPaymentStatus,
  type PartnerCommissionStatus,
  type SalesCommissionStatus,
  commissionBase,
  calcCommission,
} from "../shared/financial.js";
import type { NotificationType } from "../shared/requests.js";

// -------- Settings helpers --------
async function getCommissionBase(): Promise<"before_tax" | "after_tax"> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "commission_calculation_base"));
  const v = (row?.value as unknown as string) ?? "before_tax";
  return v === "after_tax" ? "after_tax" : "before_tax";
}

// -------- Commission resolution --------
// Resolves the partner commission % and sales commission % using the
// precedence: per-partner+package+operation rule → package defaults → partner default.
export async function resolveCommissionRates(
  partnerId: number,
  packageId: number,
  operationType: string,
): Promise<{ partnerPct: number; salesPct: number }> {
  const [partner] = await db.select().from(partners).where(eq(partners.id, partnerId));
  const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId));
  const [rule] = await db
    .select()
    .from(commissionRules)
    .where(
      and(
        eq(commissionRules.partnerId, partnerId),
        eq(commissionRules.packageId, packageId),
        eq(commissionRules.operationType, operationType),
        eq(commissionRules.active, true),
      )
    )
    .limit(1);

  // Spec precedence: special rule (per partner+package+operation) -> partner
  // default -> none. Package defaults are intentionally NOT consulted here.
  let partnerPct: number;
  let salesPct: number;
  if (rule) {
    partnerPct = Number(rule.partnerCommissionPct);
    salesPct = Number(rule.salesCommissionPct);
  } else if (partner) {
    partnerPct = Number(partner.partnerCommissionPct ?? 0);
    salesPct = partner.salesCommissionEnabled ? Number(partner.salesCommissionPct ?? 0) : 0;
  } else {
    partnerPct = 0;
    salesPct = 0;
  }
  if (!partner?.salesCommissionEnabled) salesPct = 0;
  void pkg;
  return { partnerPct, salesPct };
}

// -------- On-activation hook --------
// Called from requests.ts when a request transitions to `activated`.
// Idempotent: returns existing rows if already created for the request.
export async function onRequestActivated(opts: {
  requestId: number;
  userId: number;
}): Promise<{ orderPaymentId: number | null; partnerCommissionId: number | null; salesCommissionId: number | null }> {
  const [r] = await db.select().from(requests).where(eq(requests.id, opts.requestId));
  if (!r || !r.packageId) {
    return { orderPaymentId: null, partnerCommissionId: null, salesCommissionId: null };
  }
  // Idempotency
  const [existing] = await db
    .select({ id: orderPayments.id })
    .from(orderPayments)
    .where(eq(orderPayments.requestId, opts.requestId))
    .limit(1);
  if (existing) {
    const [pc] = await db
      .select({ id: partnerCommissions.id })
      .from(partnerCommissions)
      .where(eq(partnerCommissions.requestId, opts.requestId))
      .limit(1);
    const [sc] = await db
      .select({ id: salesCommissions.id })
      .from(salesCommissions)
      .where(eq(salesCommissions.requestId, opts.requestId))
      .limit(1);
    return { orderPaymentId: existing.id, partnerCommissionId: pc?.id ?? null, salesCommissionId: sc?.id ?? null };
  }

  const [pkg] = await db.select().from(packages).where(eq(packages.id, r.packageId));
  const [partner] = await db.select().from(partners).where(eq(partners.id, r.partnerId));
  if (!pkg || !partner) {
    return { orderPaymentId: null, partnerCommissionId: null, salesCommissionId: null };
  }
  const base = await getCommissionBase();
  const beforeTax = Number(pkg.itemPriceBeforeTax);
  const afterTax = Number(pkg.finalPriceAfterTax);
  const tax = afterTax - beforeTax;
  const baseAmount = commissionBase(beforeTax, afterTax, base);

  const eligible = await isEligibleForCommission(r.customerId, r.partnerId);
  let partnerPct = 0;
  let salesPct = 0;
  if (eligible) {
    const rates = await resolveCommissionRates(r.partnerId, r.packageId, r.operationType ?? "");
    partnerPct = rates.partnerPct;
    salesPct = rates.salesPct;
  }
  const partnerAmount = calcCommission(baseAmount, partnerPct);
  const salesAmount = calcCommission(baseAmount, salesPct);
  const netDueToCompany = Math.max(0, afterTax - partnerAmount);

  const [op] = await db
    .insert(orderPayments)
    .values({
      requestId: r.id,
      customerId: r.customerId,
      partnerId: r.partnerId,
      packageId: r.packageId,
      grossAmount: String(afterTax),
      taxAmount: String(tax),
      netAmount: String(beforeTax),
      partnerCommissionAmount: String(partnerAmount),
      netDueToCompany: String(netDueToCompany),
      status: "pending_collection_confirmation",
    })
    .returning();
  await db.insert(orderPaymentStatusHistory).values({
    orderPaymentId: op.id,
    fromStatus: null,
    toStatus: "pending_collection_confirmation",
    changedByUserId: opts.userId,
    reason: "auto-created on activation",
  });
  await audit({
    userId: opts.userId,
    action: "order_payment.created",
    entityType: "order_payment",
    entityId: op.id,
    requestId: r.id,
    customerId: r.customerId,
    partnerId: r.partnerId,
    newValue: op,
  });

  let pcId: number | null = null;
  if (partnerAmount > 0) {
    const safetyDays = partner.safetyPeriodDays ?? 14;
    const safetyEnds = new Date(Date.now() + safetyDays * 24 * 60 * 60 * 1000);
    const [pc] = await db
      .insert(partnerCommissions)
      .values({
        requestId: r.id,
        orderPaymentId: op.id,
        partnerId: r.partnerId,
        customerId: r.customerId,
        packageId: r.packageId,
        baseAmount: String(baseAmount),
        pct: String(partnerPct),
        amount: String(partnerAmount),
        safetyEndsAt: safetyEnds,
        status: "in_safety_period",
      })
      .returning();
    pcId = pc.id;
    await db.insert(partnerCommissionStatusHistory).values({
      partnerCommissionId: pc.id,
      fromStatus: null,
      toStatus: "in_safety_period",
      changedByUserId: opts.userId,
    });
    await audit({
      userId: opts.userId,
      action: "partner_commission.created",
      entityType: "partner_commission",
      entityId: pc.id,
      requestId: r.id,
      customerId: r.customerId,
      partnerId: r.partnerId,
      newValue: pc,
    });
  }

  let scId: number | null = null;
  if (salesAmount > 0 && r.salesUserId) {
    const [sc] = await db
      .insert(salesCommissions)
      .values({
        requestId: r.id,
        orderPaymentId: op.id,
        partnerId: r.partnerId,
        salesUserId: r.salesUserId,
        teamLeaderId: r.teamLeaderId,
        customerId: r.customerId,
        packageId: r.packageId,
        baseAmount: String(baseAmount),
        pct: String(salesPct),
        amount: String(salesAmount),
        status: "new",
      })
      .returning();
    scId = sc.id;
    await db.insert(salesCommissionStatusHistory).values({
      salesCommissionId: sc.id,
      fromStatus: null,
      toStatus: "new",
      changedByUserId: opts.userId,
    });
    await audit({
      userId: opts.userId,
      action: "sales_commission.created",
      entityType: "sales_commission",
      entityId: sc.id,
      requestId: r.id,
      customerId: r.customerId,
      partnerId: r.partnerId,
      newValue: sc,
    });
  }

  return { orderPaymentId: op.id, partnerCommissionId: pcId, salesCommissionId: scId };
}

// -------- Notification helpers --------
async function notifyPartnerAccountants(partnerId: number, type: NotificationType, opts: {
  titleEn: string; titleAr: string; bodyEn?: string; bodyAr?: string;
  entityType?: string; entityId?: string | number; linkPath?: string;
}) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      sql`(${roles.key} IN ('partner_admin','partner_accountant') AND ${users.partnerId} = ${partnerId})
          OR ${roles.key} IN ('company_super_admin','company_accountant')`
    );
  for (const u of rows) {
    await notify({ userId: u.id, type, ...opts });
  }
}
async function notifyCompanyAccountants(type: NotificationType, opts: {
  titleEn: string; titleAr: string; bodyEn?: string; bodyAr?: string;
  entityType?: string; entityId?: string | number; linkPath?: string;
}) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(sql`${roles.key} IN ('company_super_admin','company_accountant')`);
  for (const u of rows) {
    await notify({ userId: u.id, type, ...opts });
  }
}
async function notifySalesUser(salesUserId: number, type: NotificationType, opts: {
  titleEn: string; titleAr: string; bodyEn?: string; bodyAr?: string;
  entityType?: string; entityId?: string | number; linkPath?: string;
}) {
  await notify({ userId: salesUserId, type, ...opts });
}

// -------- Order payment transitions --------
export async function transitionOrderPayment(opts: {
  id: number;
  toStatus: OrderPaymentStatus;
  userId: number;
  reason?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; allowed?: OrderPaymentStatus[] }> {
  const [op] = await db.select().from(orderPayments).where(eq(orderPayments.id, opts.id));
  if (!op) return { ok: false, error: "not_found" };
  const from = op.status as OrderPaymentStatus;
  if (!isAllowedOrderPaymentTransition(from, opts.toStatus)) {
    return { ok: false, error: "invalid_transition" };
  }
  const update: Partial<typeof orderPayments.$inferInsert> = { status: opts.toStatus, updatedAt: new Date() };
  if (opts.toStatus === "received_by_company") update.receivedAt = new Date();
  if (opts.toStatus === "settled") update.settledAt = new Date();
  await db.update(orderPayments).set(update).where(eq(orderPayments.id, opts.id));
  await db.insert(orderPaymentStatusHistory).values({
    orderPaymentId: opts.id,
    fromStatus: from,
    toStatus: opts.toStatus,
    reason: opts.reason ?? null,
    changedByUserId: opts.userId,
  });
  await audit({
    userId: opts.userId,
    action: `order_payment.${opts.toStatus}`,
    entityType: "order_payment",
    entityId: opts.id,
    partnerId: op.partnerId,
    customerId: op.customerId,
    requestId: op.requestId,
    oldValue: { status: from },
    newValue: { status: opts.toStatus, reason: opts.reason ?? null },
  });

  if (opts.toStatus === "received_by_company") {
    await notifyPartnerAccountants(op.partnerId, "payment.received_by_company", {
      titleEn: "Payment received by company",
      titleAr: "تم استلام الدفعة من قبل الشركة",
      entityType: "order_payment",
      entityId: opts.id,
      linkPath: `/payments`,
    });
  } else if (opts.toStatus === "settled") {
    await notifyPartnerAccountants(op.partnerId, "payment.settled", {
      titleEn: "Payment settled",
      titleAr: "تمت تسوية الدفعة",
      entityType: "order_payment",
      entityId: opts.id,
      linkPath: `/payments`,
    });
  }
  return { ok: true };
}

// -------- Partner commission transitions --------
export async function transitionPartnerCommission(opts: {
  id: number; toStatus: PartnerCommissionStatus; userId: number; reason?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [pc] = await db.select().from(partnerCommissions).where(eq(partnerCommissions.id, opts.id));
  if (!pc) return { ok: false, error: "not_found" };
  const from = pc.status as PartnerCommissionStatus;
  if (!isAllowedPartnerCommissionTransition(from, opts.toStatus)) return { ok: false, error: "invalid_transition" };
  await db.update(partnerCommissions).set({ status: opts.toStatus, updatedAt: new Date() }).where(eq(partnerCommissions.id, opts.id));
  await db.insert(partnerCommissionStatusHistory).values({
    partnerCommissionId: opts.id, fromStatus: from, toStatus: opts.toStatus, reason: opts.reason ?? null, changedByUserId: opts.userId,
  });
  await audit({
    userId: opts.userId, action: `partner_commission.${opts.toStatus}`, entityType: "partner_commission",
    entityId: opts.id, partnerId: pc.partnerId, customerId: pc.customerId, requestId: pc.requestId,
    oldValue: { status: from }, newValue: { status: opts.toStatus, reason: opts.reason ?? null },
  });
  if (opts.toStatus === "eligible_for_claim") {
    await notifyPartnerAccountants(pc.partnerId, "commission.eligible_for_claim", {
      titleEn: "Commission eligible for claim",
      titleAr: "العمولة مؤهلة للمطالبة",
      entityType: "partner_commission", entityId: opts.id,
      linkPath: `/partner-commissions`,
    });
  }
  return { ok: true };
}

export async function transitionSalesCommission(opts: {
  id: number; toStatus: SalesCommissionStatus; userId: number; reason?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [sc] = await db.select().from(salesCommissions).where(eq(salesCommissions.id, opts.id));
  if (!sc) return { ok: false, error: "not_found" };
  const from = sc.status as SalesCommissionStatus;
  if (!isAllowedSalesCommissionTransition(from, opts.toStatus)) return { ok: false, error: "invalid_transition" };
  await db.update(salesCommissions).set({ status: opts.toStatus, updatedAt: new Date() }).where(eq(salesCommissions.id, opts.id));
  await db.insert(salesCommissionStatusHistory).values({
    salesCommissionId: opts.id, fromStatus: from, toStatus: opts.toStatus, reason: opts.reason ?? null, changedByUserId: opts.userId,
  });
  await audit({
    userId: opts.userId, action: `sales_commission.${opts.toStatus}`, entityType: "sales_commission",
    entityId: opts.id, partnerId: sc.partnerId, customerId: sc.customerId, requestId: sc.requestId,
    oldValue: { status: from }, newValue: { status: opts.toStatus, reason: opts.reason ?? null },
  });
  if ((opts.toStatus === "approved_by_company" || opts.toStatus === "paid") && sc.salesUserId) {
    await notifySalesUser(sc.salesUserId,
      opts.toStatus === "paid" ? "sales_commission.paid" : "sales_commission.approved",
      {
        titleEn: opts.toStatus === "paid" ? "Sales commission paid" : "Sales commission approved",
        titleAr: opts.toStatus === "paid" ? "تم صرف عمولة المبيعات" : "تم اعتماد عمولة المبيعات",
        entityType: "sales_commission", entityId: opts.id,
        linkPath: `/sales-commissions`,
      });
  }
  return { ok: true };
}

// -------- Background scheduler --------
// 1. Flip in_safety_period → eligible_for_claim when safety_ends_at is past.
// 2. Auto-create claims for partners with claim_cycle_type='auto' if their last
//    claim is older than claim_cycle_days (and there is at least one eligible commission).
export async function runFinancialHousekeep(): Promise<{ flipped: number; claimsCreated: number }> {
  // Postgres advisory lock prevents concurrent housekeep runs across
  // multiple instances or overlapping intervals from double-creating claims.
  const lockKey = 0x4d50503301; // "MPP" + 0x01
  const got = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) AS ok`);
  const ok = (got as unknown as { rows: Array<{ ok: boolean }> }).rows?.[0]?.ok;
  if (!ok) return { flipped: 0, claimsCreated: 0 };
  try {
  const now = new Date();
  // Flip safety → eligible
  const due = await db
    .select()
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.status, "in_safety_period"),
        sql`${partnerCommissions.safetyEndsAt} <= ${now}`,
      )
    );
  for (const pc of due) {
    await transitionPartnerCommission({ id: pc.id, toStatus: "eligible_for_claim", userId: 0, reason: "safety_period_complete" });
  }

  // Auto-claim per partner
  let claimsCreated = 0;
  const autoPartners = await db.select().from(partners).where(eq(partners.claimCycleType, "auto"));
  for (const p of autoPartners) {
    const cycleDays = p.claimCycleDays ?? 30;
    const cutoff = new Date(now.getTime() - cycleDays * 24 * 60 * 60 * 1000);
    const [last] = await db
      .select({ createdAt: claims.createdAt })
      .from(claims)
      .where(eq(claims.partnerId, p.id))
      .orderBy(desc(claims.createdAt))
      .limit(1);
    if (last && last.createdAt > cutoff) continue;
    const eligible = await db
      .select()
      .from(partnerCommissions)
      .where(
        and(
          eq(partnerCommissions.partnerId, p.id),
          eq(partnerCommissions.status, "eligible_for_claim"),
        )
      );
    if (eligible.length === 0) continue;
    await createClaim({ partnerId: p.id, partnerCommissionIds: eligible.map((e) => e.id), userId: 0, autoGenerated: true });
    claimsCreated += 1;
  }
  return { flipped: due.length, claimsCreated };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
  }
}

// -------- Claim creation / lifecycle --------
export async function createClaim(opts: {
  partnerId: number;
  partnerCommissionIds: number[];
  userId: number;
  autoGenerated?: boolean;
  notes?: string;
}): Promise<{ id: number; claimNumber: string }> {
  const partnerId = opts.partnerId;
  const items = await db
    .select()
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.partnerId, partnerId),
        eq(partnerCommissions.status, "eligible_for_claim"),
        inArray(partnerCommissions.id, opts.partnerCommissionIds),
      )
    );
  if (items.length === 0) throw new Error("no_eligible_items");
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  const claimNumber = `CLM-${Date.now()}-${partnerId}`;
  const [claim] = await db
    .insert(claims)
    .values({
      claimNumber,
      partnerId,
      status: "draft",
      autoGenerated: !!opts.autoGenerated,
      totalAmount: String(total),
      notes: opts.notes,
      createdByUserId: opts.userId || null,
      submittedAt: new Date(),
    })
    .returning();
  for (const it of items) {
    await db.insert(claimItems).values({ claimId: claim.id, partnerCommissionId: it.id, amount: it.amount });
    await transitionPartnerCommission({ id: it.id, toStatus: "in_claim", userId: opts.userId, reason: `attached to ${claimNumber}` });
    await db.update(partnerCommissions).set({ claimId: claim.id }).where(eq(partnerCommissions.id, it.id));
  }
  await audit({
    userId: opts.userId || null,
    action: "claim.created",
    entityType: "claim", entityId: claim.id,
    partnerId, newValue: claim,
  });
  await notifyCompanyAccountants("claim.created", {
    titleEn: `New claim ${claimNumber}`,
    titleAr: `مطالبة جديدة ${claimNumber}`,
    bodyEn: `Total: ${total.toFixed(2)}`,
    bodyAr: `الإجمالي: ${total.toFixed(2)}`,
    entityType: "claim", entityId: claim.id, linkPath: `/claims/${claim.id}`,
  });
  return { id: claim.id, claimNumber };
}

export async function approveClaim(claimId: number, userId: number): Promise<void> {
  const [c] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!c) throw new Error("not_found");
  if (c.status !== "draft") throw new Error("invalid_state");
  await db
    .update(claims)
    .set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId, updatedAt: new Date() })
    .where(eq(claims.id, claimId));
  const items = await db.select().from(claimItems).where(eq(claimItems.claimId, claimId));
  for (const it of items) {
    await transitionPartnerCommission({ id: it.partnerCommissionId, toStatus: "claim_approved", userId, reason: "claim_approved" });
  }
  await audit({ userId, action: "claim.approved", entityType: "claim", entityId: claimId, partnerId: c.partnerId });
  await notifyPartnerAccountants(c.partnerId, "claim.approved", {
    titleEn: `Claim ${c.claimNumber} approved`,
    titleAr: `تم اعتماد المطالبة ${c.claimNumber}`,
    entityType: "claim", entityId: claimId, linkPath: `/claims/${claimId}`,
  });
}

export async function rejectClaim(claimId: number, userId: number, reason: string): Promise<void> {
  const [c] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!c) throw new Error("not_found");
  if (c.status !== "draft") throw new Error("invalid_state");
  await db
    .update(claims)
    .set({ status: "rejected", rejectedAt: new Date(), rejectionReason: reason, updatedAt: new Date() })
    .where(eq(claims.id, claimId));
  const items = await db.select().from(claimItems).where(eq(claimItems.claimId, claimId));
  for (const it of items) {
    // Move back to eligible_for_claim
    await db.update(partnerCommissions)
      .set({ status: "eligible_for_claim", claimId: null, updatedAt: new Date() })
      .where(eq(partnerCommissions.id, it.partnerCommissionId));
    await db.insert(partnerCommissionStatusHistory).values({
      partnerCommissionId: it.partnerCommissionId,
      fromStatus: "in_claim",
      toStatus: "eligible_for_claim",
      reason: `claim_rejected: ${reason}`,
      changedByUserId: userId,
    });
  }
  await audit({ userId, action: "claim.rejected", entityType: "claim", entityId: claimId, partnerId: c.partnerId, note: reason });
  await notifyPartnerAccountants(c.partnerId, "claim.rejected", {
    titleEn: `Claim ${c.claimNumber} rejected`,
    titleAr: `تم رفض المطالبة ${c.claimNumber}`,
    bodyEn: reason, bodyAr: reason,
    entityType: "claim", entityId: claimId, linkPath: `/claims/${claimId}`,
  });
}

// -------- Payout batch lifecycle --------
export async function createPayoutBatch(opts: {
  partnerId: number;
  cycle: "monthly" | "quarterly";
  salesCommissionIds: number[];
  userId: number;
  notes?: string;
}): Promise<{ id: number; batchNumber: string }> {
  const items = await db
    .select()
    .from(salesCommissions)
    .where(
      and(
        eq(salesCommissions.partnerId, opts.partnerId),
        eq(salesCommissions.status, "eligible_for_payout"),
        inArray(salesCommissions.id, opts.salesCommissionIds),
      )
    );
  if (items.length === 0) throw new Error("no_eligible_items");
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  const batchNumber = `PB-${Date.now()}-${opts.partnerId}`;
  const [batch] = await db
    .insert(payoutBatches)
    .values({
      batchNumber, partnerId: opts.partnerId, cycle: opts.cycle, status: "draft",
      totalAmount: String(total), notes: opts.notes,
      createdByUserId: opts.userId, submittedAt: new Date(),
    })
    .returning();
  for (const it of items) {
    await db.insert(payoutBatchItems).values({ payoutBatchId: batch.id, salesCommissionId: it.id, amount: it.amount });
    await transitionSalesCommission({ id: it.id, toStatus: "in_payout_batch", userId: opts.userId, reason: `attached to ${batchNumber}` });
    await db.update(salesCommissions).set({ payoutBatchId: batch.id }).where(eq(salesCommissions.id, it.id));
  }
  await audit({ userId: opts.userId, action: "payout_batch.created", entityType: "payout_batch", entityId: batch.id, partnerId: opts.partnerId, newValue: batch });
  return { id: batch.id, batchNumber };
}

export async function approvePayoutBatch(batchId: number, userId: number): Promise<void> {
  const [b] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, batchId));
  if (!b) throw new Error("not_found");
  if (b.status !== "draft") throw new Error("invalid_state");
  await db.update(payoutBatches).set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId, updatedAt: new Date() }).where(eq(payoutBatches.id, batchId));
  const items = await db.select().from(payoutBatchItems).where(eq(payoutBatchItems.payoutBatchId, batchId));
  for (const it of items) {
    await transitionSalesCommission({ id: it.salesCommissionId, toStatus: "approved_by_company", userId, reason: "batch_approved" });
  }
  await audit({ userId, action: "payout_batch.approved", entityType: "payout_batch", entityId: batchId, partnerId: b.partnerId });
}

export async function payPayoutBatch(batchId: number, userId: number): Promise<void> {
  const [b] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, batchId));
  if (!b) throw new Error("not_found");
  if (b.status !== "approved") throw new Error("invalid_state");
  await db.update(payoutBatches).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(eq(payoutBatches.id, batchId));
  const items = await db.select().from(payoutBatchItems).where(eq(payoutBatchItems.payoutBatchId, batchId));
  for (const it of items) {
    await transitionSalesCommission({ id: it.salesCommissionId, toStatus: "paid", userId, reason: "batch_paid" });
  }
  await audit({ userId, action: "payout_batch.paid", entityType: "payout_batch", entityId: batchId, partnerId: b.partnerId });
}

// -------- Settlement creation --------
export async function createSettlement(opts: {
  partnerId: number;
  claimId?: number;
  userId: number;
  notes?: string;
}): Promise<{ id: number; settlementNumber: string; finalAmount: number; direction: string }> {
  // Sum of unsettled order_payments received_by_company for this partner.
  const ops = await db
    .select()
    .from(orderPayments)
    .where(
      and(
        eq(orderPayments.partnerId, opts.partnerId),
        eq(orderPayments.status, "received_by_company"),
      )
    );
  const netDue = ops.reduce((s, o) => s + Number(o.netDueToCompany), 0);

  // Sum of approved partner commissions to be paid out
  let partnerTotal = 0;
  const claim = opts.claimId
    ? (await db.select().from(claims).where(eq(claims.id, opts.claimId)))[0]
    : null;
  if (claim) {
    if (claim.status !== "approved") throw new Error("claim_not_approved");
    partnerTotal = Number(claim.totalAmount);
  } else {
    const approved = await db
      .select()
      .from(partnerCommissions)
      .where(
        and(
          eq(partnerCommissions.partnerId, opts.partnerId),
          eq(partnerCommissions.status, "claim_approved"),
        )
      );
    partnerTotal = approved.reduce((s, p) => s + Number(p.amount), 0);
  }

  const finalAmount = netDue - partnerTotal;
  const direction = finalAmount >= 0 ? "partner_to_company" : "company_to_partner";
  const settlementNumber = `STL-${Date.now()}-${opts.partnerId}`;
  const [settlement] = await db
    .insert(settlements)
    .values({
      settlementNumber, partnerId: opts.partnerId, claimId: opts.claimId,
      netDueToCompany: String(netDue),
      partnerCommissionTotal: String(partnerTotal),
      finalAmount: String(Math.abs(finalAmount)),
      direction,
      notes: opts.notes,
      createdByUserId: opts.userId,
      completedAt: new Date(),
    })
    .returning();

  // Mark order_payments as settled & link
  for (const o of ops) {
    await transitionOrderPayment({ id: o.id, toStatus: "settled", userId: opts.userId, reason: `settlement ${settlementNumber}` });
    await db.update(orderPayments).set({ settlementId: settlement.id }).where(eq(orderPayments.id, o.id));
  }

  // Move partner commissions to ready_for_settlement → settled_successfully
  if (claim) {
    const its = await db.select().from(claimItems).where(eq(claimItems.claimId, claim.id));
    for (const it of its) {
      await transitionPartnerCommission({ id: it.partnerCommissionId, toStatus: "ready_for_settlement", userId: opts.userId, reason: settlementNumber });
      await transitionPartnerCommission({ id: it.partnerCommissionId, toStatus: "settled_successfully", userId: opts.userId, reason: settlementNumber });
      await db.update(partnerCommissions).set({ settlementId: settlement.id }).where(eq(partnerCommissions.id, it.partnerCommissionId));
    }
    await db.update(claims).set({ status: "settled", settledAt: new Date(), settlementId: settlement.id }).where(eq(claims.id, claim.id));
    await notifyPartnerAccountants(opts.partnerId, "claim.settled", {
      titleEn: `Claim ${claim.claimNumber} settled`,
      titleAr: `تمت تسوية المطالبة ${claim.claimNumber}`,
      entityType: "claim", entityId: claim.id, linkPath: `/claims/${claim.id}`,
    });
  }

  await audit({ userId: opts.userId, action: "settlement.completed", entityType: "settlement", entityId: settlement.id, partnerId: opts.partnerId, newValue: settlement });
  await notifyPartnerAccountants(opts.partnerId, "settlement.completed", {
    titleEn: `Settlement ${settlementNumber} completed`,
    titleAr: `اكتملت التسوية ${settlementNumber}`,
    bodyEn: `Final amount: ${Math.abs(finalAmount).toFixed(2)} (${direction})`,
    bodyAr: `المبلغ النهائي: ${Math.abs(finalAmount).toFixed(2)}`,
    entityType: "settlement", entityId: settlement.id, linkPath: `/settlements/${settlement.id}`,
  });
  return { id: settlement.id, settlementNumber, finalAmount: Math.abs(finalAmount), direction };
}

// -------- Date range filter helper --------
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
export function dateRangeFilter(
  col: PgColumn,
  from?: string | null,
  to?: string | null,
): SQL[] {
  const filters: SQL[] = [];
  if (from) filters.push(gte(col, new Date(from)));
  if (to) filters.push(lte(col, new Date(to)));
  return filters;
}

import { and, desc, eq, sql, inArray, gte, lte } from "drizzle-orm";
import { db, type DbExecutor } from "./db.js";
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
  type ClaimType,
  defaultDirectionFor,
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
  executor: DbExecutor = db,
): Promise<{ partnerPct: number; salesPct: number }> {
  const [partner] = await executor.select().from(partners).where(eq(partners.id, partnerId));
  const [pkg] = await executor.select().from(packages).where(eq(packages.id, packageId));
  const [rule] = await executor
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

  // Precedence (most specific wins):
  //   1. Per-partner + package + operation override row in `commission_rules`
  //   2. Package's own default % (only when > 0 — treats 0 as "unset" so a
  //      package without a configured rate falls through to the partner's
  //      general rate; this matches the spec: "the partner % is the general
  //      rate; when it conflicts with the package's own rate, the package
  //      wins")
  //   3. Partner's default %
  // Each rate (partner / sales) is resolved INDEPENDENTLY — a package may
  // override only the partner side and leave the sales side to the partner
  // default, or vice versa.
  const partnerDefault = partner ? Number(partner.partnerCommissionPct ?? 0) : 0;
  const salesDefault = partner ? Number(partner.salesCommissionPct ?? 0) : 0;
  const pkgPartner = pkg ? Number(pkg.defaultPartnerCommissionPct ?? 0) : 0;
  const pkgSales = pkg ? Number(pkg.defaultSalesCommissionPct ?? 0) : 0;

  let partnerPct: number;
  let salesPct: number;
  if (rule) {
    partnerPct = Number(rule.partnerCommissionPct);
    salesPct = Number(rule.salesCommissionPct);
  } else {
    partnerPct = pkgPartner > 0 ? pkgPartner : partnerDefault;
    salesPct = pkgSales > 0 ? pkgSales : salesDefault;
  }
  if (!partner?.salesCommissionEnabled) salesPct = 0;
  return { partnerPct, salesPct };
}

// -------- On-activation hook --------
// Called from requests.ts when a request transitions to `activated`.
// Idempotent: returns existing rows if already created for the request.
export async function onRequestActivated(
  opts: {
    requestId: number;
    userId: number;
  },
  executor: DbExecutor = db,
): Promise<{ orderPaymentId: number | null; partnerCommissionId: number | null; salesCommissionId: number | null }> {
  const [r] = await executor.select().from(requests).where(eq(requests.id, opts.requestId));
  // Fail-closed: an activated request without a package or partner is a
  // data integrity bug — refuse to silently no-op so the caller (and the
  // request transition) can surface the failure instead of leaving the
  // request activated with no financial track.
  if (!r) throw new Error(`request_not_found:${opts.requestId}`);
  if (!r.packageId) throw new Error(`request_missing_package:${opts.requestId}`);
  const [pkg] = await executor.select().from(packages).where(eq(packages.id, r.packageId));
  const [partner] = await executor.select().from(partners).where(eq(partners.id, r.partnerId));
  if (!pkg) throw new Error(`package_not_found:${r.packageId}`);
  if (!partner) throw new Error(`partner_not_found:${r.partnerId}`);
  const base = await getCommissionBase();
  const beforeTax = Number(pkg.itemPriceBeforeTax);
  const afterTax = Number(pkg.finalPriceAfterTax);
  const tax = afterTax - beforeTax;
  const baseAmount = commissionBase(beforeTax, afterTax, base);

  // CRITICAL: pass the executor so the just-inserted ownership row
  // (created earlier in the same transaction by the caller via
  // startOwnership) is visible to the eligibility check. Reading via
  // the global `db` would miss it and silently zero out the commission.
  const eligible = await isEligibleForCommission(r.customerId, r.partnerId, new Date(), executor);
  let partnerPct = 0;
  let salesPct = 0;
  if (eligible) {
    const rates = await resolveCommissionRates(r.partnerId, r.packageId, r.operationType ?? "", executor);
    partnerPct = rates.partnerPct;
    salesPct = rates.salesPct;
  }
  const partnerAmount = calcCommission(baseAmount, partnerPct);
  const salesAmount = calcCommission(baseAmount, salesPct);
  const netDueToCompany = Math.max(0, afterTax - partnerAmount);

  // Idempotent backfill: if an order_payment already exists for this
  // request (e.g., a prior activation half-applied), reuse it and only
  // create whichever commission rows are missing.
  const [existingOp] = await executor
    .select()
    .from(orderPayments)
    .where(eq(orderPayments.requestId, opts.requestId))
    .limit(1);
  const op = existingOp ?? (await executor
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
    .returning())[0];
  if (!existingOp) {
    await executor.insert(orderPaymentStatusHistory).values({
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
  }

  const [existingPc] = await executor
    .select({ id: partnerCommissions.id })
    .from(partnerCommissions)
    .where(eq(partnerCommissions.requestId, opts.requestId))
    .limit(1);
  let pcId: number | null = existingPc?.id ?? null;
  if (!existingPc && partnerAmount > 0) {
    const safetyDays = partner.safetyPeriodDays ?? 14;
    const safetyEnds = new Date(Date.now() + safetyDays * 24 * 60 * 60 * 1000);
    const [pc] = await executor
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
    await executor.insert(partnerCommissionStatusHistory).values({
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

  const [existingSc] = await executor
    .select({ id: salesCommissions.id })
    .from(salesCommissions)
    .where(eq(salesCommissions.requestId, opts.requestId))
    .limit(1);
  let scId: number | null = existingSc?.id ?? null;
  if (!existingSc && salesAmount > 0 && r.salesUserId) {
    const [sc] = await executor
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
    await executor.insert(salesCommissionStatusHistory).values({
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
export async function transitionOrderPayment(
  opts: {
    id: number;
    toStatus: OrderPaymentStatus;
    userId: number;
    reason?: string | null;
    // `viaSettlement` is set to true ONLY by `createSettlementForPartner`
    // and the lifecycle orchestrator. It permits the two terminal
    // company-side transitions (`received_by_company`, `settled`) which
    // otherwise must NOT happen via the public payments endpoint without
    // an explicit manual override. This enforces the business rule:
    // "once a payment reaches net_amount_due_to_company it cannot be
    // settled except through a claim → settlement flow."
    viaSettlement?: boolean;
    // Set by createClaim/approveClaim (payment-claim flow).
    viaClaim?: boolean;
    // `viaManualOverride` is set by the route handler when a user with
    // `payments:manual_override` permission deliberately bypasses the
    // claim-gated path (e.g. company accountant fixing a stuck record).
    viaManualOverride?: boolean;
  },
  executor: DbExecutor = db,
): Promise<{ ok: true } | { ok: false; error: string; allowed?: OrderPaymentStatus[] }> {
  const [op] = await executor.select().from(orderPayments).where(eq(orderPayments.id, opts.id));
  if (!op) return { ok: false, error: "not_found" };
  const from = op.status as OrderPaymentStatus;
  if (!isAllowedOrderPaymentTransition(from, opts.toStatus)) {
    return { ok: false, error: "invalid_transition" };
  }
  // CLAIM/SETTLEMENT GATED RULE: payment claim and payment settlement
  // states are reachable ONLY through the bound primitives.
  //   - in_payment_claim, payment_claim_approved → must come from createClaim/approveClaim
  //   - received_by_company, settled              → must come from createSettlement
  // Manual override (admin perm) bypasses both gates. Refunds/cancellations
  // are not gated by this rule.
  const claimGated: OrderPaymentStatus[] = ["in_payment_claim", "payment_claim_approved"];
  const settlementGated: OrderPaymentStatus[] = ["received_by_company", "settled"];
  // viaClaim flag — set by createClaim/approveClaim. Reuse the existing
  // option object: we accept either `viaSettlement` (legacy) or `viaClaim`
  // for forward compatibility.
  const viaClaim = (opts as { viaClaim?: boolean }).viaClaim === true;
  if (
    claimGated.includes(opts.toStatus) &&
    !viaClaim &&
    !opts.viaManualOverride
  ) {
    return { ok: false, error: "requires_claim_or_override" };
  }
  if (
    settlementGated.includes(opts.toStatus) &&
    !opts.viaSettlement &&
    !opts.viaManualOverride
  ) {
    return { ok: false, error: "requires_settlement_or_override" };
  }
  const update: Partial<typeof orderPayments.$inferInsert> = { status: opts.toStatus, updatedAt: new Date() };
  if (opts.toStatus === "received_by_company") update.receivedAt = new Date();
  if (opts.toStatus === "settled") update.settledAt = new Date();
  await executor.update(orderPayments).set(update).where(eq(orderPayments.id, opts.id));
  await executor.insert(orderPaymentStatusHistory).values({
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
export async function transitionPartnerCommission(
  opts: {
    id: number; toStatus: PartnerCommissionStatus; userId: number | null; reason?: string | null;
    // Gates for the claim → settlement pipeline. The forward path
    // `eligible_for_claim → in_claim → claim_approved → ready_for_settlement →
    // settled_successfully` is reachable ONLY through the bound primitives
    // (createClaim, approveClaim, createSettlement). Any direct call must
    // come with `viaManualOverride: true` and the caller must hold the
    // `partner_commissions:manual_override` permission (enforced at the route).
    viaClaim?: boolean;          // set by createClaim / approveClaim
    viaSettlement?: boolean;     // set by createSettlement
    viaManualOverride?: boolean; // set by route when override perm present
  },
  executor: DbExecutor = db,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [pc] = await executor.select().from(partnerCommissions).where(eq(partnerCommissions.id, opts.id));
  if (!pc) return { ok: false, error: "not_found" };
  const from = pc.status as PartnerCommissionStatus;
  if (!isAllowedPartnerCommissionTransition(from, opts.toStatus)) return { ok: false, error: "invalid_transition" };
  // CLAIM/SETTLEMENT GATE
  const claimGated: PartnerCommissionStatus[] = ["in_claim", "claim_approved"];
  const settlementGated: PartnerCommissionStatus[] = ["ready_for_settlement", "settled_successfully"];
  if (claimGated.includes(opts.toStatus) && !opts.viaClaim && !opts.viaManualOverride) {
    return { ok: false, error: "requires_claim_or_override" };
  }
  if (settlementGated.includes(opts.toStatus) && !opts.viaSettlement && !opts.viaManualOverride) {
    return { ok: false, error: "requires_settlement_or_override" };
  }
  await executor.update(partnerCommissions).set({ status: opts.toStatus, updatedAt: new Date() }).where(eq(partnerCommissions.id, opts.id));
  await executor.insert(partnerCommissionStatusHistory).values({
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

export async function transitionSalesCommission(
  opts: {
    id: number; toStatus: SalesCommissionStatus; userId: number; reason?: string | null;
    // Gates for the payout-batch pipeline. The forward path
    // `eligible_for_payout → in_payout_batch → approved_by_company → paid`
    // is reachable ONLY through the payout-batch primitives. Direct calls
    // must come with `viaManualOverride: true` and the caller must hold
    // `sales_commissions:manual_override` (enforced at the route).
    viaPayoutBatch?: boolean; // legacy alias for viaClaim (sales-commission claim)
    viaClaim?: boolean;       // set by createClaim/approveClaim (sales-commission flow)
    viaSettlement?: boolean;  // set by createSettlement
    viaManualOverride?: boolean;
  },
  executor: DbExecutor = db,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [sc] = await executor.select().from(salesCommissions).where(eq(salesCommissions.id, opts.id));
  if (!sc) return { ok: false, error: "not_found" };
  const from = sc.status as SalesCommissionStatus;
  if (!isAllowedSalesCommissionTransition(from, opts.toStatus)) return { ok: false, error: "invalid_transition" };
  // CLAIM/SETTLEMENT GATE — same shape as PC and OP.
  // in_payout_batch + approved_by_company → claim-gated.
  // paid                                  → settlement-gated.
  const claimGated: SalesCommissionStatus[] = ["in_payout_batch", "approved_by_company"];
  const settlementGated: SalesCommissionStatus[] = ["paid"];
  const viaClaim = opts.viaClaim || opts.viaPayoutBatch; // legacy alias
  if (claimGated.includes(opts.toStatus) && !viaClaim && !opts.viaManualOverride) {
    return { ok: false, error: "requires_claim_or_override" };
  }
  if (settlementGated.includes(opts.toStatus) && !opts.viaSettlement && !opts.viaManualOverride) {
    return { ok: false, error: "requires_settlement_or_override" };
  }
  await executor.update(salesCommissions).set({ status: opts.toStatus, updatedAt: new Date() }).where(eq(salesCommissions.id, opts.id));
  await executor.insert(salesCommissionStatusHistory).values({
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
export async function runFinancialHousekeep(): Promise<{ flipped: number; claimsCreated: number; advancedSales?: number }> {
  // Postgres advisory lock prevents concurrent housekeep runs across
  // multiple instances or overlapping intervals from double-creating claims.
  const lockKey = 0x4d50503301; // "MPP" + 0x01
  const got = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) AS ok`);
  const ok = (got as unknown as { rows: Array<{ ok: boolean }> }).rows?.[0]?.ok;
  if (!ok) return { flipped: 0, claimsCreated: 0, advancedSales: 0 };
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
    await transitionPartnerCommission({ id: pc.id, toStatus: "eligible_for_claim", userId: null, reason: "safety_period_complete" });
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
    await createClaim({ type: "partner_commission", partnerId: p.id, itemIds: eligible.map((e) => e.id), userId: null, autoGenerated: true });
    claimsCreated += 1;
  }
  // Sales commission payout-cycle progression:
  // when a partner commission this sales row is tied to has been settled
  // (i.e. the company has received the money), advance pending sales rows to
  // eligible_for_payout so they show up in the next payout batch.
  const eligibleSales = await db.execute(sql`
    UPDATE sales_commissions sc
       SET status = 'eligible_for_payout', updated_at = NOW()
      FROM partner_commissions pc
     WHERE sc.request_id = pc.request_id
       AND sc.status = 'new'
       AND pc.status = 'settled_successfully'
    RETURNING sc.id`);
  const advancedSales = (eligibleSales as unknown as { rows?: Array<{ id: number }> }).rows?.length ?? 0;

  return { flipped: due.length, claimsCreated, advancedSales };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
  }
}

// ============================================================================
// UNIFIED CLAIM + SETTLEMENT PRIMITIVES
// ----------------------------------------------------------------------------
// Three claim/settlement types share one generic flow:
//
//   payment            : OP rows  (net_amount_due_to_company → in_payment_claim
//                                  → payment_claim_approved → settled)
//   partner_commission : PC rows  (eligible_for_claim → in_claim → claim_approved
//                                  → ready_for_settlement → settled_successfully)
//   sales_commission   : SC rows  (eligible_for_payout → in_payout_batch
//                                  → approved_by_company → paid)
//
// `createClaim`, `approveClaim`, `rejectClaim`, and `createSettlement` are
// the ONLY way to advance child entities through their claim-/settlement-
// gated states without an explicit manual override.
//
// Settlements are independent (no netting). Each settlement has a single
// `total_amount` and a `direction` derived from the type.
// ============================================================================

interface ClaimChildHandlers {
  // Read all eligible items for this partner (used by /eligible endpoint).
  // Returns the child rows currently sitting in the "ready to claim" state.
  loadEligible: (
    tx: DbExecutor,
    partnerId: number,
    ids: number[],
  ) => Promise<Array<{ id: number; amount: string }>>;
  // Move child to "in_claim" state.
  toInClaim: (
    tx: DbExecutor,
    childId: number,
    userId: number | null,
    reason: string,
  ) => Promise<void>;
  // Move child to "claim_approved" state.
  toClaimApproved: (
    tx: DbExecutor,
    childId: number,
    userId: number,
    reason: string,
  ) => Promise<void>;
  // Roll child back to its eligible/ready state on rejection.
  rollback: (
    tx: DbExecutor,
    childId: number,
    userId: number,
    reason: string,
  ) => Promise<void>;
  // Move child to its terminal "settled" state during settlement creation.
  // (For PC this includes the intermediate ready_for_settlement step.)
  toSettled: (
    tx: DbExecutor,
    childId: number,
    userId: number,
    reason: string,
    settlementId: number,
  ) => Promise<void>;
  // Read claim_items.<fk> for this child kind.
  itemFkColumn: "partnerCommissionId" | "orderPaymentId" | "salesCommissionId";
  // Insert a claim_items row pointing at this child.
  insertItem: (
    tx: DbExecutor,
    claimId: number,
    childId: number,
    amount: string,
  ) => Promise<void>;
  // Set child.claim_id / child.settlement_id linkage.
  setClaimId: (tx: DbExecutor, childId: number, claimId: number | null) => Promise<void>;
}

const HANDLERS: Record<ClaimType, ClaimChildHandlers> = {
  partner_commission: {
    loadEligible: async (tx, partnerId, ids) => {
      const rows = await tx
        .select({ id: partnerCommissions.id, amount: partnerCommissions.amount })
        .from(partnerCommissions)
        .where(and(
          eq(partnerCommissions.partnerId, partnerId),
          eq(partnerCommissions.status, "eligible_for_claim"),
          inArray(partnerCommissions.id, ids),
        ));
      return rows;
    },
    toInClaim: async (tx, id, userId, reason) => {
      const r = await transitionPartnerCommission(
        { id, toStatus: "in_claim", userId, reason, viaClaim: true }, tx);
      if (!r.ok) throw new Error(`pc_in_claim_failed:${id}:${r.error}`);
    },
    toClaimApproved: async (tx, id, userId, reason) => {
      const r = await transitionPartnerCommission(
        { id, toStatus: "claim_approved", userId, reason, viaClaim: true }, tx);
      if (!r.ok) throw new Error(`pc_claim_approved_failed:${id}:${r.error}`);
    },
    rollback: async (tx, id, userId, reason) => {
      await tx.update(partnerCommissions)
        .set({ status: "eligible_for_claim", claimId: null, updatedAt: new Date() })
        .where(eq(partnerCommissions.id, id));
      await tx.insert(partnerCommissionStatusHistory).values({
        partnerCommissionId: id, fromStatus: "in_claim", toStatus: "eligible_for_claim",
        reason, changedByUserId: userId,
      });
    },
    toSettled: async (tx, id, userId, reason, settlementId) => {
      const r1 = await transitionPartnerCommission(
        { id, toStatus: "ready_for_settlement", userId, reason, viaSettlement: true }, tx);
      if (!r1.ok) throw new Error(`pc_ready_failed:${id}:${r1.error}`);
      const r2 = await transitionPartnerCommission(
        { id, toStatus: "settled_successfully", userId, reason, viaSettlement: true }, tx);
      if (!r2.ok) throw new Error(`pc_settled_failed:${id}:${r2.error}`);
      await tx.update(partnerCommissions)
        .set({ settlementId }).where(eq(partnerCommissions.id, id));
    },
    itemFkColumn: "partnerCommissionId",
    insertItem: async (tx, claimId, childId, amount) => {
      await tx.insert(claimItems).values({ claimId, partnerCommissionId: childId, amount });
    },
    setClaimId: async (tx, childId, claimId) => {
      await tx.update(partnerCommissions)
        .set({ claimId, updatedAt: new Date() })
        .where(eq(partnerCommissions.id, childId));
    },
  },
  payment: {
    loadEligible: async (tx, partnerId, ids) => {
      const rows = await tx
        .select({ id: orderPayments.id, amount: orderPayments.netDueToCompany })
        .from(orderPayments)
        .where(and(
          eq(orderPayments.partnerId, partnerId),
          eq(orderPayments.status, "net_amount_due_to_company"),
          inArray(orderPayments.id, ids),
        ));
      return rows;
    },
    toInClaim: async (tx, id, userId, reason) => {
      const r = await transitionOrderPayment(
        { id, toStatus: "in_payment_claim", userId: userId ?? 0, reason, viaClaim: true }, tx);
      if (!r.ok) throw new Error(`op_in_claim_failed:${id}:${r.error}`);
    },
    toClaimApproved: async (tx, id, userId, reason) => {
      const r = await transitionOrderPayment(
        { id, toStatus: "payment_claim_approved", userId, reason, viaClaim: true }, tx);
      if (!r.ok) throw new Error(`op_claim_approved_failed:${id}:${r.error}`);
    },
    rollback: async (tx, id, userId, reason) => {
      await tx.update(orderPayments)
        .set({ status: "net_amount_due_to_company", claimId: null, updatedAt: new Date() })
        .where(eq(orderPayments.id, id));
      await tx.insert(orderPaymentStatusHistory).values({
        orderPaymentId: id, fromStatus: "in_payment_claim", toStatus: "net_amount_due_to_company",
        reason, changedByUserId: userId,
      });
    },
    toSettled: async (tx, id, userId, reason, settlementId) => {
      // Walk through received_by_company → settled so the audit trail
      // reflects "company received the money" then "settlement closed".
      const r1 = await transitionOrderPayment(
        { id, toStatus: "received_by_company", userId, reason, viaSettlement: true }, tx);
      if (!r1.ok) throw new Error(`op_received_failed:${id}:${r1.error}`);
      const r2 = await transitionOrderPayment(
        { id, toStatus: "settled", userId, reason, viaSettlement: true }, tx);
      if (!r2.ok) throw new Error(`op_settled_failed:${id}:${r2.error}`);
      await tx.update(orderPayments)
        .set({ settlementId }).where(eq(orderPayments.id, id));
    },
    itemFkColumn: "orderPaymentId",
    insertItem: async (tx, claimId, childId, amount) => {
      await tx.insert(claimItems).values({ claimId, orderPaymentId: childId, amount });
    },
    setClaimId: async (tx, childId, claimId) => {
      await tx.update(orderPayments)
        .set({ claimId, updatedAt: new Date() })
        .where(eq(orderPayments.id, childId));
    },
  },
  sales_commission: {
    loadEligible: async (tx, partnerId, ids) => {
      const rows = await tx
        .select({ id: salesCommissions.id, amount: salesCommissions.amount })
        .from(salesCommissions)
        .where(and(
          eq(salesCommissions.partnerId, partnerId),
          eq(salesCommissions.status, "eligible_for_payout"),
          inArray(salesCommissions.id, ids),
        ));
      return rows;
    },
    toInClaim: async (tx, id, userId, reason) => {
      const r = await transitionSalesCommission(
        { id, toStatus: "in_payout_batch", userId: userId ?? 0, reason, viaClaim: true }, tx);
      if (!r.ok) throw new Error(`sc_in_claim_failed:${id}:${r.error}`);
    },
    toClaimApproved: async (tx, id, userId, reason) => {
      const r = await transitionSalesCommission(
        { id, toStatus: "approved_by_company", userId, reason, viaClaim: true }, tx);
      if (!r.ok) throw new Error(`sc_claim_approved_failed:${id}:${r.error}`);
    },
    rollback: async (tx, id, userId, reason) => {
      await tx.update(salesCommissions)
        .set({ status: "eligible_for_payout", claimId: null, updatedAt: new Date() })
        .where(eq(salesCommissions.id, id));
      await tx.insert(salesCommissionStatusHistory).values({
        salesCommissionId: id, fromStatus: "in_payout_batch", toStatus: "eligible_for_payout",
        reason, changedByUserId: userId,
      });
    },
    toSettled: async (tx, id, userId, reason, settlementId) => {
      const r = await transitionSalesCommission(
        { id, toStatus: "paid", userId, reason, viaSettlement: true }, tx);
      if (!r.ok) throw new Error(`sc_paid_failed:${id}:${r.error}`);
      await tx.update(salesCommissions)
        .set({ settlementId }).where(eq(salesCommissions.id, id));
    },
    itemFkColumn: "salesCommissionId",
    insertItem: async (tx, claimId, childId, amount) => {
      await tx.insert(claimItems).values({ claimId, salesCommissionId: childId, amount });
    },
    setClaimId: async (tx, childId, claimId) => {
      await tx.update(salesCommissions)
        .set({ claimId, updatedAt: new Date() })
        .where(eq(salesCommissions.id, childId));
    },
  },
};

function claimNumberPrefix(type: ClaimType): string {
  switch (type) {
    case "payment": return "PMC";
    case "partner_commission": return "PCC";
    case "sales_commission": return "SCC";
  }
}
function settlementNumberPrefix(type: ClaimType): string {
  switch (type) {
    case "payment": return "PMS";
    case "partner_commission": return "PCS";
    case "sales_commission": return "SCS";
  }
}

// -------- Generic claim creation --------
export async function createClaim(opts: {
  type: ClaimType;
  partnerId: number;
  itemIds: number[];
  userId: number | null;
  autoGenerated?: boolean;
  notes?: string;
}): Promise<{ id: number; claimNumber: string; type: ClaimType }> {
  const handler = HANDLERS[opts.type];
  const { claim, total, claimNumber } = await db.transaction(async (tx) => {
    const items = await handler.loadEligible(tx, opts.partnerId, opts.itemIds);
    if (items.length === 0) throw new Error("no_eligible_items");
    // Strict attachment: every requested ID must resolve to an eligible item
    // for this partner. Silently dropping ineligible/foreign IDs would let
    // callers create partial claims and is not allowed.
    if (items.length !== opts.itemIds.length) {
      const found = new Set(items.map((i) => i.id));
      const missing = opts.itemIds.filter((id) => !found.has(id));
      throw new Error(`ineligible_items:${missing.join(",")}`);
    }
    const total = items.reduce((s, i) => s + Number(i.amount), 0);
    const claimNumber = `${claimNumberPrefix(opts.type)}-${Date.now()}-${opts.partnerId}`;
    const [claim] = await tx
      .insert(claims)
      .values({
        claimNumber,
        partnerId: opts.partnerId,
        type: opts.type,
        status: "draft",
        autoGenerated: !!opts.autoGenerated,
        totalAmount: String(total),
        notes: opts.notes,
        createdByUserId: opts.userId || null,
        submittedAt: new Date(),
      })
      .returning();
    for (const it of items) {
      await handler.insertItem(tx, claim.id, it.id, it.amount);
      await handler.toInClaim(tx, it.id, opts.userId, `attached to ${claimNumber}`);
      await handler.setClaimId(tx, it.id, claim.id);
    }
    return { claim, total, claimNumber };
  });
  await audit({
    userId: opts.userId || null,
    action: "claim.created",
    entityType: "claim", entityId: claim.id,
    partnerId: opts.partnerId, newValue: claim,
  });
  await notifyCompanyAccountants("claim.created", {
    titleEn: `New ${opts.type} claim ${claimNumber}`,
    titleAr: `مطالبة ${opts.type} جديدة ${claimNumber}`,
    bodyEn: `Total: ${total.toFixed(2)}`,
    bodyAr: `الإجمالي: ${total.toFixed(2)}`,
    entityType: "claim", entityId: claim.id, linkPath: `/claims/${claim.id}`,
  });
  return { id: claim.id, claimNumber, type: opts.type };
}

// -------- Generic claim approve / reject --------
export async function approveClaim(claimId: number, userId: number): Promise<void> {
  const c = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(claims).where(eq(claims.id, claimId));
    if (!c) throw new Error("not_found");
    if (c.status !== "draft") throw new Error("invalid_state");
    const handler = HANDLERS[c.type as ClaimType];
    if (!handler) throw new Error(`unknown_claim_type:${c.type}`);
    await tx
      .update(claims)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: userId, updatedAt: new Date() })
      .where(eq(claims.id, claimId));
    const items = await tx.select().from(claimItems).where(eq(claimItems.claimId, claimId));
    for (const it of items) {
      const childId = it[handler.itemFkColumn];
      if (childId == null) throw new Error(`claim_item_missing_${handler.itemFkColumn}:${it.id}`);
      await handler.toClaimApproved(tx, childId, userId, "claim_approved");
    }
    return c;
  });
  await audit({ userId, action: "claim.approved", entityType: "claim", entityId: claimId, partnerId: c.partnerId });
  await notifyPartnerAccountants(c.partnerId, "claim.approved", {
    titleEn: `Claim ${c.claimNumber} approved`,
    titleAr: `تم اعتماد المطالبة ${c.claimNumber}`,
    entityType: "claim", entityId: claimId, linkPath: `/claims/${claimId}`,
  });
}

export async function rejectClaim(claimId: number, userId: number, reason: string): Promise<void> {
  const c = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(claims).where(eq(claims.id, claimId));
    if (!c) throw new Error("not_found");
    if (c.status !== "draft") throw new Error("invalid_state");
    const handler = HANDLERS[c.type as ClaimType];
    if (!handler) throw new Error(`unknown_claim_type:${c.type}`);
    await tx
      .update(claims)
      .set({ status: "rejected", rejectedAt: new Date(), rejectionReason: reason, updatedAt: new Date() })
      .where(eq(claims.id, claimId));
    const items = await tx.select().from(claimItems).where(eq(claimItems.claimId, claimId));
    for (const it of items) {
      const childId = it[handler.itemFkColumn];
      if (childId == null) throw new Error(`claim_item_missing_${handler.itemFkColumn}:${it.id}`);
      await handler.rollback(tx, childId, userId, `claim_rejected: ${reason}`);
    }
    return c;
  });
  await audit({ userId, action: "claim.rejected", entityType: "claim", entityId: claimId, partnerId: c.partnerId, note: reason });
  await notifyPartnerAccountants(c.partnerId, "claim.rejected", {
    titleEn: `Claim ${c.claimNumber} rejected`,
    titleAr: `تم رفض المطالبة ${c.claimNumber}`,
    bodyEn: reason, bodyAr: reason,
    entityType: "claim", entityId: claimId, linkPath: `/claims/${claimId}`,
  });
}

// -------- Generic settlement creation (NO netting) --------
// Each settlement is independent: total_amount = sum of its claim's items.
// The direction is determined by the claim type:
//   payment            → partner_to_company
//   partner_commission → company_to_partner
//   sales_commission   → partner_to_sales
export async function createSettlement(opts: {
  claimId: number;
  userId: number;
  notes?: string;
}): Promise<{ id: number; settlementNumber: string; totalAmount: number; direction: string; type: ClaimType }> {
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(claims).where(eq(claims.id, opts.claimId));
    if (!c) throw new Error("claim_not_found");
    if (c.status !== "approved") throw new Error("claim_not_approved");
    const type = c.type as ClaimType;
    const handler = HANDLERS[type];
    if (!handler) throw new Error(`unknown_claim_type:${c.type}`);
    const totalAmount = Number(c.totalAmount);
    const direction = defaultDirectionFor(type);
    const settlementNumber = `${settlementNumberPrefix(type)}-${Date.now()}-${c.partnerId}`;
    const [settlement] = await tx
      .insert(settlements)
      .values({
        settlementNumber,
        partnerId: c.partnerId,
        claimId: c.id,
        type,
        totalAmount: String(totalAmount),
        direction,
        notes: opts.notes,
        createdByUserId: opts.userId,
        completedAt: new Date(),
      })
      .returning();

    const items = await tx.select().from(claimItems).where(eq(claimItems.claimId, c.id));
    for (const it of items) {
      const childId = it[handler.itemFkColumn];
      if (childId == null) throw new Error(`claim_item_missing_${handler.itemFkColumn}:${it.id}`);
      await handler.toSettled(tx, childId, opts.userId, settlementNumber, settlement.id);
    }

    await tx.update(claims).set({
      status: "settled", settledAt: new Date(), settlementId: settlement.id, updatedAt: new Date(),
    }).where(eq(claims.id, c.id));

    return { settlement, settlementNumber, totalAmount, direction, type, claim: c };
  });

  await audit({
    userId: opts.userId, action: "settlement.completed",
    entityType: "settlement", entityId: result.settlement.id,
    partnerId: result.claim.partnerId, newValue: result.settlement,
  });
  await notifyPartnerAccountants(result.claim.partnerId, "settlement.completed", {
    titleEn: `Settlement ${result.settlementNumber} completed`,
    titleAr: `اكتملت التسوية ${result.settlementNumber}`,
    bodyEn: `Amount: ${result.totalAmount.toFixed(2)} (${result.direction})`,
    bodyAr: `المبلغ: ${result.totalAmount.toFixed(2)}`,
    entityType: "settlement", entityId: result.settlement.id,
    linkPath: `/settlements/${result.settlement.id}`,
  });
  await notifyPartnerAccountants(result.claim.partnerId, "claim.settled", {
    titleEn: `Claim ${result.claim.claimNumber} settled`,
    titleAr: `تمت تسوية المطالبة ${result.claim.claimNumber}`,
    entityType: "claim", entityId: result.claim.id, linkPath: `/claims/${result.claim.id}`,
  });

  return {
    id: result.settlement.id, settlementNumber: result.settlementNumber,
    totalAmount: result.totalAmount, direction: result.direction, type: result.type,
  };
}

// -------- DEPRECATED: payout-batch wrappers (use sales_commission claims instead) --------
// These keep the old endpoints functional while the UI transitions to the
// unified Claims page. They simply create a `sales_commission` claim, then
// approve and settle it in one shot, mirroring the pre-refactor behavior.
export async function createPayoutBatch(opts: {
  partnerId: number;
  cycle: "monthly" | "quarterly";
  salesCommissionIds: number[];
  userId: number;
  notes?: string;
}): Promise<{ id: number; batchNumber: string }> {
  const c = await createClaim({
    type: "sales_commission",
    partnerId: opts.partnerId,
    itemIds: opts.salesCommissionIds,
    userId: opts.userId,
    notes: opts.notes,
  });
  return { id: c.id, batchNumber: c.claimNumber };
}
export async function approvePayoutBatch(batchId: number, userId: number): Promise<void> {
  await approveClaim(batchId, userId);
}
export async function payPayoutBatch(batchId: number, userId: number): Promise<void> {
  await createSettlement({ claimId: batchId, userId });
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

// ============================================================================
// Unified Transaction Lifecycle Orchestrator
// ============================================================================
// Single source of truth for advancing a Request through its 10-stage master
// lifecycle. Every stage transition runs inside ONE database transaction and
// cascades all sub-statuses (order_payments, partner_commissions,
// sales_commissions, claims, settlements, customer_ownership) so the audit
// trail can never go out of sync.
//
// The orchestrator delegates the actual mutations to existing primitives in
// `server/financial.ts` (onRequestActivated, transitionOrderPayment,
// transitionPartnerCommission, transitionSalesCommission, createSettlement)
// and `server/ownership.ts` (startOwnership) so business rules stay in one
// place.
import { and, eq } from "drizzle-orm";
import { db, type DbExecutor } from "./db.js";
import {
  requests,
  requestStatusHistory,
  masterLifecycleHistory,
  orderPayments,
  partnerCommissions,
  salesCommissions,
  claims,
  claimItems,
  settlements,
  customerOwnership,
} from "./schema.js";
import {
  MASTER_LIFECYCLE_STAGES,
  STAGE_INDEX,
  STAGE_PROJECTION,
  isAllowedMasterTransition,
  isPastNoReturn,
  canCancelFrom,
  canFailFrom,
  MASTER_REOPEN_TARGETS,
  type MasterLifecycleStage,
  type MasterExceptionStatus,
  type MasterAction,
} from "../shared/financial.js";
import {
  onRequestActivated,
  transitionOrderPayment,
  transitionPartnerCommission,
  transitionSalesCommission,
  createSettlement,
} from "./financial.js";
import { startOwnership } from "./ownership.js";
import { audit } from "./audit.js";

export interface AdvanceOptions {
  reason?: string | null;
  // Skip validation of the "from" stage (used by the migration script).
  skipFromCheck?: boolean;
}

export interface AdvanceResult {
  ok: boolean;
  fromStage: MasterLifecycleStage;
  toStage: MasterLifecycleStage;
  error?: string;
}

// --------------------------------------------------------------------------
// Public entry points
// --------------------------------------------------------------------------

export async function advanceMasterStage(
  requestId: number,
  toStage: MasterLifecycleStage,
  userId: number,
  opts: AdvanceOptions = {},
): Promise<AdvanceResult> {
  return await db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!r) throw new Error("not_found");
    const fromStage = (r.lifecycleStage ?? "draft_sr") as MasterLifecycleStage;

    if (r.lifecycleException) {
      throw new Error(`request_in_exception:${r.lifecycleException}`);
    }
    if (!opts.skipFromCheck && !isAllowedMasterTransition(fromStage, toStage)) {
      throw new Error(`invalid_transition:${fromStage}->${toStage}`);
    }
    if (fromStage === toStage) {
      return { ok: true, fromStage, toStage };
    }

    await applyStageProjection(tx, requestId, fromStage, toStage, userId, opts.reason ?? null);

    await tx
      .update(requests)
      .set({
        lifecycleStage: toStage,
        status: STAGE_PROJECTION[toStage].orderStatus,
        updatedAt: new Date(),
        ...(toStage === "activated_in_safety_period" && !r.activatedAt ? { activatedAt: new Date() } : {}),
      })
      .where(eq(requests.id, requestId));

    await tx.insert(masterLifecycleHistory).values({
      requestId,
      fromStage,
      toStage,
      action: stageAdvanceAction(fromStage, toStage),
      reason: opts.reason ?? null,
      changedByUserId: userId,
    });
    await tx.insert(requestStatusHistory).values({
      requestId,
      fromStatus: STAGE_PROJECTION[fromStage].orderStatus,
      toStatus: STAGE_PROJECTION[toStage].orderStatus,
      reason: opts.reason ?? null,
      changedByUserId: userId,
    });
    await audit({
      userId,
      action: `lifecycle.${toStage}`,
      entityType: "request",
      entityId: requestId,
      requestId,
      partnerId: r.partnerId,
      customerId: r.customerId,
      oldValue: { lifecycleStage: fromStage },
      newValue: { lifecycleStage: toStage },
      note: opts.reason ?? undefined,
    });

    return { ok: true, fromStage, toStage };
  });
}

// Cancel/Refund — preserves all data but marks the request as cancelled.
// Allowed only before LINE_OF_NO_RETURN (stages 1–4).
export async function cancelRefundRequest(
  requestId: number,
  userId: number,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!r) throw new Error("not_found");
    const stage = (r.lifecycleStage ?? "draft_sr") as MasterLifecycleStage;
    if (!canCancelFrom(stage)) throw new Error(`cannot_cancel_after_stage:${stage}`);
    if (r.lifecycleException) throw new Error(`already_in_exception:${r.lifecycleException}`);

    await tx
      .update(requests)
      .set({
        lifecycleException: "cancelled_refunded" as MasterExceptionStatus,
        status: "rejected", // map to legacy status so existing UI hides the row from active queues
        rejectionReason: `cancel_refund: ${reason}`,
        updatedAt: new Date(),
      })
      .where(eq(requests.id, requestId));

    await tx.insert(masterLifecycleHistory).values({
      requestId,
      fromStage: stage,
      toStage: stage,
      toException: "cancelled_refunded",
      action: "cancel_refund",
      reason,
      changedByUserId: userId,
    });
    await audit({
      userId,
      action: "lifecycle.cancel_refund",
      entityType: "request",
      entityId: requestId,
      requestId,
      partnerId: r.partnerId,
      customerId: r.customerId,
      oldValue: { lifecycleStage: stage, lifecycleException: null },
      newValue: { lifecycleStage: stage, lifecycleException: "cancelled_refunded" },
      note: reason,
    });
  });
}

// Failed/Rejected — pre-activation only; supports Reopen.
export async function failRequest(
  requestId: number,
  userId: number,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!r) throw new Error("not_found");
    const stage = (r.lifecycleStage ?? "draft_sr") as MasterLifecycleStage;
    if (!canFailFrom(stage)) throw new Error(`cannot_fail_after_activation:${stage}`);
    if (r.lifecycleException) throw new Error(`already_in_exception:${r.lifecycleException}`);

    await tx
      .update(requests)
      .set({
        lifecycleException: "failed_rejected" as MasterExceptionStatus,
        status: "failed",
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(requests.id, requestId));

    await tx.insert(masterLifecycleHistory).values({
      requestId,
      fromStage: stage,
      toStage: stage,
      toException: "failed_rejected",
      action: "reject_request",
      reason,
      changedByUserId: userId,
    });
    await audit({
      userId,
      action: "lifecycle.failed",
      entityType: "request",
      entityId: requestId,
      requestId,
      partnerId: r.partnerId,
      customerId: r.customerId,
      newValue: { lifecycleException: "failed_rejected" },
      note: reason,
    });
  });
}

// Reopen a failed_rejected request back to draft_sr or submitted.
export async function reopenRequest(
  requestId: number,
  userId: number,
  toStage: MasterLifecycleStage,
  reason: string,
): Promise<void> {
  if (!MASTER_REOPEN_TARGETS.includes(toStage)) {
    throw new Error(`invalid_reopen_target:${toStage}`);
  }
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!r) throw new Error("not_found");
    if (r.lifecycleException !== "failed_rejected") throw new Error("not_reopenable");

    await tx
      .update(requests)
      .set({
        lifecycleException: null,
        lifecycleStage: toStage,
        status: STAGE_PROJECTION[toStage].orderStatus,
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(requests.id, requestId));

    await tx.insert(masterLifecycleHistory).values({
      requestId,
      fromStage: (r.lifecycleStage ?? "draft_sr") as MasterLifecycleStage,
      toStage,
      fromException: "failed_rejected",
      action: "reopen_request",
      reason,
      changedByUserId: userId,
    });
    await audit({
      userId,
      action: "lifecycle.reopened",
      entityType: "request",
      entityId: requestId,
      requestId,
      partnerId: r.partnerId,
      customerId: r.customerId,
      newValue: { lifecycleStage: toStage, lifecycleException: null },
      note: reason,
    });
  });
}

// Clone a cancelled or failed request into a new Draft. The source's data
// (customer, partner, package, sales rep) is copied and linked back via
// `cancelled_from_request_id` / `cloned_to_request_id`.
export async function cloneFromCancelled(
  sourceRequestId: number,
  userId: number,
): Promise<{ id: number; srNumber: string }> {
  return await db.transaction(async (tx) => {
    const [src] = await tx.select().from(requests).where(eq(requests.id, sourceRequestId));
    if (!src) throw new Error("not_found");
    if (
      src.lifecycleException !== "cancelled_refunded" &&
      src.lifecycleException !== "failed_rejected"
    ) {
      throw new Error("source_not_cancelled_or_failed");
    }
    if (src.clonedToRequestId) throw new Error("already_cloned");

    const newSr = `${src.srNumber}-CLONE-${Date.now()}`;
    const [created] = await tx
      .insert(requests)
      .values({
        srNumber: newSr,
        customerId: src.customerId,
        partnerId: src.partnerId,
        salesUserId: src.salesUserId,
        teamLeaderId: src.teamLeaderId,
        packageId: src.packageId,
        operationType: src.operationType,
        status: "draft_sr",
        lifecycleStage: "draft_sr",
        cancelledFromRequestId: src.id,
        createdByUserId: userId,
      })
      .returning();
    await tx
      .update(requests)
      .set({ clonedToRequestId: created.id, updatedAt: new Date() })
      .where(eq(requests.id, src.id));

    await tx.insert(masterLifecycleHistory).values({
      requestId: created.id,
      fromStage: null as unknown as string,
      toStage: "draft_sr",
      action: "save_draft",
      reason: `cloned from #${src.id} (${src.lifecycleException})`,
      changedByUserId: userId,
    });
    await audit({
      userId,
      action: "lifecycle.cloned_from_cancelled",
      entityType: "request",
      entityId: created.id,
      requestId: created.id,
      partnerId: created.partnerId,
      customerId: created.customerId,
      newValue: { srNumber: newSr, sourceRequestId: src.id },
    });

    return { id: created.id, srNumber: created.srNumber };
  });
}

// --------------------------------------------------------------------------
// Internal: cascade sub-statuses for a single forward step
// --------------------------------------------------------------------------

async function applyStageProjection(
  tx: DbExecutor,
  requestId: number,
  fromStage: MasterLifecycleStage,
  toStage: MasterLifecycleStage,
  userId: number,
  reason: string | null,
): Promise<void> {
  const [r] = await tx.select().from(requests).where(eq(requests.id, requestId));
  if (!r) throw new Error("not_found");

  switch (toStage) {
    case "draft_sr":
    case "submitted_collection_confirmed":
    case "received_by_company":
    case "under_activation": {
      // Pre-activation stages: only the legacy `requests.status` and
      // `payment_status` columns need to move; financial rows do not exist
      // yet. Keep `payment_status` aligned with the stage projection.
      await tx
        .update(requests)
        .set({
          paymentStatus: STAGE_PROJECTION[toStage].paymentStatus ?? r.paymentStatus,
          ...(toStage === "submitted_collection_confirmed" && !r.submittedAt
            ? { submittedAt: new Date() }
            : {}),
        })
        .where(eq(requests.id, requestId));
      return;
    }

    case "activated_in_safety_period": {
      // Stage 5 — line of no return. Bootstrap financial rows + ownership.
      const had = await tx
        .select({ id: customerOwnership.id })
        .from(customerOwnership)
        .where(
          and(
            eq(customerOwnership.customerId, r.customerId),
            eq(customerOwnership.partnerId, r.partnerId),
          ),
        )
        .limit(1);
      if (had.length === 0) {
        await startOwnership(
          { customerId: r.customerId, partnerId: r.partnerId, userId },
          tx,
        );
      }
      await onRequestActivated({ requestId, userId }, tx);
      // onRequestActivated leaves the order_payment at
      // `pending_collection_confirmation`. Walk it forward to
      // `net_amount_due_to_company` so the sub-status matches the master
      // stage projection. Each step uses the validated transition helper.
      const [op] = await tx
        .select()
        .from(orderPayments)
        .where(eq(orderPayments.requestId, requestId))
        .limit(1);
      if (!op) throw new Error("order_payment_missing_after_activation");
      if (op.status === "pending_collection_confirmation") {
        const r1 = await transitionOrderPayment(
          { id: op.id, toStatus: "collected_by_sales", userId, reason: reason ?? "lifecycle_activation" },
          tx,
        );
        if (!r1.ok) throw new Error(`op_collect_failed:${r1.error}`);
      }
      const [op2] = await tx
        .select({ status: orderPayments.status })
        .from(orderPayments)
        .where(eq(orderPayments.id, op.id));
      if (op2?.status === "collected_by_sales") {
        const r2 = await transitionOrderPayment(
          { id: op.id, toStatus: "net_amount_due_to_company", userId, reason: reason ?? "lifecycle_activation" },
          tx,
        );
        if (!r2.ok) throw new Error(`op_due_failed:${r2.error}`);
      }
      await tx
        .update(requests)
        .set({ paymentStatus: "net_amount_due_to_company" })
        .where(eq(requests.id, requestId));
      return;
    }

    case "eligible_for_claim": {
      // Move partner commission from in_safety_period → eligible_for_claim.
      const [pc] = await tx
        .select()
        .from(partnerCommissions)
        .where(eq(partnerCommissions.requestId, requestId));
      if (!pc) throw new Error("partner_commission_missing");
      if (pc.status === "in_safety_period") {
        const r1 = await transitionPartnerCommission(
          { id: pc.id, toStatus: "eligible_for_claim", userId, reason: reason ?? "lifecycle_advance" },
          tx,
        );
        if (!r1.ok) throw new Error(`pc_transition_failed:${r1.error}`);
      }
      return;
    }

    case "in_claim_review": {
      // Create a Claim with this request's partner_commission as its sole
      // line item (1-to-1 invariant).
      const [pc] = await tx
        .select()
        .from(partnerCommissions)
        .where(eq(partnerCommissions.requestId, requestId));
      if (!pc) throw new Error("partner_commission_missing");
      if (pc.status !== "eligible_for_claim") throw new Error(`pc_wrong_status:${pc.status}`);

      const claimNumber = `PCC-${Date.now()}-${r.partnerId}-${requestId}`;
      const [c] = await tx
        .insert(claims)
        .values({
          claimNumber,
          partnerId: r.partnerId,
          type: "partner_commission",
          status: "draft",
          totalAmount: pc.amount,
          createdByUserId: userId,
          submittedAt: new Date(),
        })
        .returning();
      await tx.insert(claimItems).values({
        claimId: c.id,
        partnerCommissionId: pc.id,
        amount: pc.amount,
      });
      const r2 = await transitionPartnerCommission(
        { id: pc.id, toStatus: "in_claim", userId, reason: claimNumber, viaClaim: true },
        tx,
      );
      if (!r2.ok) throw new Error(`pc_transition_failed:${r2.error}`);
      await tx
        .update(partnerCommissions)
        .set({ claimId: c.id, updatedAt: new Date() })
        .where(eq(partnerCommissions.id, pc.id));
      return;
    }

    case "claim_approved_ready_for_settlement": {
      const [pc] = await tx
        .select()
        .from(partnerCommissions)
        .where(eq(partnerCommissions.requestId, requestId));
      if (!pc?.claimId) throw new Error("claim_missing");
      const [c] = await tx.select().from(claims).where(eq(claims.id, pc.claimId));
      if (!c) throw new Error("claim_not_found");
      if (c.status === "draft") {
        await tx
          .update(claims)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedByUserId: userId,
            updatedAt: new Date(),
          })
          .where(eq(claims.id, c.id));
      }
      const r1 = await transitionPartnerCommission(
        { id: pc.id, toStatus: "claim_approved", userId, reason: c.claimNumber, viaClaim: true },
        tx,
      );
      if (!r1.ok) throw new Error(`pc_transition_failed:${r1.error}`);
      const r2 = await transitionPartnerCommission(
        { id: pc.id, toStatus: "ready_for_settlement", userId, reason: c.claimNumber, viaSettlement: true },
        tx,
      );
      if (!r2.ok) throw new Error(`pc_transition_failed:${r2.error}`);

      // Sales commission becomes eligible for payout in parallel.
      const [sc] = await tx
        .select()
        .from(salesCommissions)
        .where(eq(salesCommissions.requestId, requestId));
      if (sc && sc.status === "new") {
        await transitionSalesCommission(
          { id: sc.id, toStatus: "eligible_for_payout", userId, reason: "claim_approved" },
          tx,
        );
      }
      return;
    }

    case "net_payment_received_by_company": {
      const [op] = await tx
        .select()
        .from(orderPayments)
        .where(eq(orderPayments.requestId, requestId));
      if (!op) throw new Error("order_payment_missing");
      // Fail hard on drift — silently skipping would let master stage
      // diverge from the actual order_payment row.
      if (op.status !== "net_amount_due_to_company" && op.status !== "received_by_company") {
        throw new Error(`op_wrong_status_for_advance:${op.status}`);
      }
      if (op.status === "net_amount_due_to_company") {
        const r1 = await transitionOrderPayment(
          { id: op.id, toStatus: "received_by_company", userId, reason: reason ?? "net_received", viaSettlement: true },
          tx,
        );
        if (!r1.ok) throw new Error(`op_transition_failed:${r1.error}`);
      }
      return;
    }

    case "fully_settled": {
      // Settle the partner_commission claim bound to this request, then
      // separately settle the order_payment by creating a payment claim
      // and a payment settlement. Each settlement is independent under the
      // refactored model — no netting.
      const [pc] = await tx
        .select()
        .from(partnerCommissions)
        .where(eq(partnerCommissions.requestId, requestId));
      if (!pc?.claimId) throw new Error("claim_missing");
      const [c] = await tx.select().from(claims).where(eq(claims.id, pc.claimId));
      if (!c) throw new Error("claim_not_found");
      const [op] = await tx
        .select()
        .from(orderPayments)
        .where(eq(orderPayments.requestId, requestId));
      if (!op) throw new Error("order_payment_missing");

      // 1) Settle the PC claim via the canonical primitive.
      if (c.status === "approved") {
        const pcSettlementNumber = `PCS-${Date.now()}-${r.partnerId}-${requestId}`;
        const [pcStl] = await tx
          .insert(settlements)
          .values({
            settlementNumber: pcSettlementNumber,
            partnerId: r.partnerId,
            claimId: c.id,
            type: "partner_commission",
            totalAmount: c.totalAmount,
            direction: "company_to_partner",
            createdByUserId: userId,
            completedAt: new Date(),
          })
          .returning();
        // Stage 8 (`claim_approved_ready_for_settlement`) already advanced
        // the PC into `ready_for_settlement`. Only run that step if it
        // hasn't happened yet; either way we close out at
        // `settled_successfully`.
        if (pc.status === "claim_approved") {
          const rPc1 = await transitionPartnerCommission(
            { id: pc.id, toStatus: "ready_for_settlement", userId, reason: pcSettlementNumber, viaSettlement: true }, tx);
          if (!rPc1.ok) throw new Error(`pc_ready_failed:${rPc1.error}`);
        }
        const rPc2 = await transitionPartnerCommission(
          { id: pc.id, toStatus: "settled_successfully", userId, reason: pcSettlementNumber, viaSettlement: true }, tx);
        if (!rPc2.ok) throw new Error(`pc_settle_failed:${rPc2.error}`);
        await tx.update(partnerCommissions).set({ settlementId: pcStl.id }).where(eq(partnerCommissions.id, pc.id));
        await tx.update(claims).set({
          status: "settled", settledAt: new Date(), settlementId: pcStl.id, updatedAt: new Date(),
        }).where(eq(claims.id, c.id));
      }

      // 2) Settle the order_payment by minting a payment claim+settlement
      // bound to this single OP. Skips if already settled.
      if (op.status !== "settled") {
        // Move OP into the payment-claim flow if it is still in
        // received_by_company (legacy path) — the gated forward steps
        // are reached via createClaim/createSettlement primitives in
        // the normal flow, but at this stage we own the transaction.
        const opClaimNumber = `PMC-${Date.now()}-${r.partnerId}-${requestId}`;
        const [opClaim] = await tx
          .insert(claims)
          .values({
            claimNumber: opClaimNumber,
            partnerId: r.partnerId,
            type: "payment",
            status: "approved",
            totalAmount: op.netDueToCompany,
            createdByUserId: userId,
            submittedAt: new Date(),
            approvedAt: new Date(),
            approvedByUserId: userId,
          })
          .returning();
        await tx.insert(claimItems).values({
          claimId: opClaim.id, orderPaymentId: op.id, amount: op.netDueToCompany,
        });
        await tx.update(orderPayments).set({ claimId: opClaim.id }).where(eq(orderPayments.id, op.id));

        const opSettlementNumber = `PMS-${Date.now()}-${r.partnerId}-${requestId}`;
        const [opStl] = await tx
          .insert(settlements)
          .values({
            settlementNumber: opSettlementNumber,
            partnerId: r.partnerId,
            claimId: opClaim.id,
            type: "payment",
            totalAmount: op.netDueToCompany,
            direction: "partner_to_company",
            createdByUserId: userId,
            completedAt: new Date(),
          })
          .returning();
        // Walk OP through the terminal states using the gated primitives.
        if (op.status === "net_amount_due_to_company") {
          const rR = await transitionOrderPayment(
            { id: op.id, toStatus: "received_by_company", userId, reason: opSettlementNumber, viaSettlement: true }, tx);
          if (!rR.ok) throw new Error(`op_received_failed:${rR.error}`);
        }
        const rS = await transitionOrderPayment(
          { id: op.id, toStatus: "settled", userId, reason: opSettlementNumber, viaSettlement: true }, tx);
        if (!rS.ok) throw new Error(`op_settle_failed:${rS.error}`);
        await tx.update(orderPayments).set({ settlementId: opStl.id }).where(eq(orderPayments.id, op.id));
        await tx.update(claims).set({
          status: "settled", settledAt: new Date(), settlementId: opStl.id, updatedAt: new Date(),
        }).where(eq(claims.id, opClaim.id));
      }
      return;
    }
  }
}

function stageAdvanceAction(
  fromStage: MasterLifecycleStage,
  toStage: MasterLifecycleStage,
): MasterAction {
  // Forward = whatever the destination represents.
  if (STAGE_INDEX[toStage] > STAGE_INDEX[fromStage]) {
    const map: Record<MasterLifecycleStage, MasterAction | null> = {
      draft_sr: "save_draft",
      submitted_collection_confirmed: "submit_request",
      received_by_company: "receive_request",
      under_activation: "start_activation",
      activated_in_safety_period: "activate_request",
      eligible_for_claim: "mark_eligible_for_claim",
      in_claim_review: "create_claim",
      claim_approved_ready_for_settlement: "approve_claim",
      net_payment_received_by_company: "confirm_net_payment_received",
      fully_settled: "complete_settlement",
    };
    return map[toStage] ?? "save_draft";
  }
  return "rewind_stage";
}

// --------------------------------------------------------------------------
// Read API used by the GET /lifecycle endpoint
// --------------------------------------------------------------------------

export async function getLifecycleSnapshot(requestId: number) {
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!r) return null;
  const history = await db
    .select()
    .from(masterLifecycleHistory)
    .where(eq(masterLifecycleHistory.requestId, requestId))
    .orderBy(masterLifecycleHistory.createdAt);
  const [op] = await db
    .select()
    .from(orderPayments)
    .where(eq(orderPayments.requestId, requestId))
    .limit(1);
  const [pc] = await db
    .select()
    .from(partnerCommissions)
    .where(eq(partnerCommissions.requestId, requestId))
    .limit(1);
  const [sc] = await db
    .select()
    .from(salesCommissions)
    .where(eq(salesCommissions.requestId, requestId))
    .limit(1);
  const [cl] = pc?.claimId
    ? await db.select().from(claims).where(eq(claims.id, pc.claimId)).limit(1)
    : [];
  const [stl] = pc?.settlementId
    ? await db.select().from(settlements).where(eq(settlements.id, pc.settlementId)).limit(1)
    : [];
  return {
    request: {
      id: r.id,
      srNumber: r.srNumber,
      lifecycleStage: r.lifecycleStage,
      lifecycleException: r.lifecycleException,
      status: r.status,
      paymentStatus: r.paymentStatus,
      cancelledFromRequestId: r.cancelledFromRequestId,
      clonedToRequestId: r.clonedToRequestId,
    },
    stages: MASTER_LIFECYCLE_STAGES,
    currentIndex: STAGE_INDEX[(r.lifecycleStage ?? "draft_sr") as MasterLifecycleStage],
    isPastNoReturn: isPastNoReturn(
      (r.lifecycleStage ?? "draft_sr") as MasterLifecycleStage,
    ),
    history,
    subStatuses: { orderPayment: op ?? null, partnerCommission: pc ?? null, salesCommission: sc ?? null, claim: cl ?? null, settlement: stl ?? null },
  };
}

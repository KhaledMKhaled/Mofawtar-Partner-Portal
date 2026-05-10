// Phase 3 — financial state machines, transitions, and shared types.

// --- ORDER PAYMENT FLOW (mirrors PC and SC: ready → in_claim → claim_approved → settled) ---
// `in_payment_claim` and `payment_claim_approved` are the new claim-gated
// stages added to align with the unified 3-claim / 3-settlement model.
// `received_by_company` is preserved as a legacy alias (maps to
// `payment_claim_approved` semantically); kept so historical data and any
// remaining routes continue to function during the transition.
export const ORDER_PAYMENT_STATUSES = [
  "pending_collection_confirmation",
  "collected_by_sales",
  "held_by_partner",
  "net_amount_due_to_company",
  "in_payment_claim",
  "payment_claim_approved",
  "received_by_company",
  "settled",
  "refunded",
  "cancelled",
] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export const ORDER_PAYMENT_TRANSITIONS: Record<OrderPaymentStatus, OrderPaymentStatus[]> = {
  pending_collection_confirmation: ["collected_by_sales", "refunded", "cancelled"],
  collected_by_sales: ["held_by_partner", "refunded", "cancelled"],
  held_by_partner: ["net_amount_due_to_company", "refunded", "cancelled"],
  net_amount_due_to_company: ["in_payment_claim", "received_by_company", "refunded", "cancelled"],
  in_payment_claim: ["payment_claim_approved", "net_amount_due_to_company", "refunded", "cancelled"],
  payment_claim_approved: ["settled", "received_by_company", "refunded", "cancelled"],
  received_by_company: ["settled", "refunded", "cancelled"],
  settled: [],
  refunded: [],
  cancelled: [],
};

export const PARTNER_COMMISSION_STATUSES = [
  "in_safety_period",
  "eligible_for_claim",
  "in_claim",
  "claim_approved",
  "ready_for_settlement",
  "settled_successfully",
  "rejected",
  "adjusted",
] as const;
export type PartnerCommissionStatus = (typeof PARTNER_COMMISSION_STATUSES)[number];

export const PARTNER_COMMISSION_TRANSITIONS: Record<PartnerCommissionStatus, PartnerCommissionStatus[]> = {
  in_safety_period: ["eligible_for_claim", "rejected", "adjusted"],
  eligible_for_claim: ["in_claim", "rejected", "adjusted"],
  in_claim: ["claim_approved", "rejected", "adjusted"],
  claim_approved: ["ready_for_settlement", "rejected", "adjusted"],
  ready_for_settlement: ["settled_successfully", "rejected", "adjusted"],
  settled_successfully: [],
  rejected: [],
  adjusted: [],
};

export const SALES_COMMISSION_STATUSES = [
  "new",
  "eligible_for_payout",
  "in_payout_batch",
  "approved_by_company",
  "paid",
  "rejected",
  "adjusted",
] as const;
export type SalesCommissionStatus = (typeof SALES_COMMISSION_STATUSES)[number];

export const SALES_COMMISSION_TRANSITIONS: Record<SalesCommissionStatus, SalesCommissionStatus[]> = {
  new: ["eligible_for_payout", "rejected", "adjusted"],
  eligible_for_payout: ["in_payout_batch", "rejected", "adjusted"],
  in_payout_batch: ["approved_by_company", "rejected", "adjusted"],
  approved_by_company: ["paid", "rejected", "adjusted"],
  paid: [],
  rejected: [],
  adjusted: [],
};

export const CLAIM_STATUSES = ["draft", "approved", "rejected", "settled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// THREE typed claims and settlements (one row per type per cycle).
// - `payment`            : partner submits collected payments → company receives net.
// - `partner_commission` : partner requests their commission → company pays.
// - `sales_commission`   : partner submits sales-rep payouts → partner pays sales.
export const CLAIM_TYPES = ["payment", "partner_commission", "sales_commission"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export const SETTLEMENT_TYPES = CLAIM_TYPES;
export type SettlementType = ClaimType;

// Direction of money flow in a settlement.
// payment            → partner_to_company  (partner remits collected money)
// partner_commission → company_to_partner  (company pays partner)
// sales_commission   → partner_to_sales    (partner pays sales rep)
export const SETTLEMENT_DIRECTIONS = [
  "partner_to_company",
  "company_to_partner",
  "partner_to_sales",
] as const;
export type SettlementDirection = (typeof SETTLEMENT_DIRECTIONS)[number];

export function defaultDirectionFor(type: ClaimType): SettlementDirection {
  switch (type) {
    case "payment": return "partner_to_company";
    case "partner_commission": return "company_to_partner";
    case "sales_commission": return "partner_to_sales";
  }
}

// Legacy — kept for back-compat with existing PayoutBatches UI/routes.
export const PAYOUT_BATCH_STATUSES = ["draft", "approved", "paid"] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

export const PAYOUT_CYCLES = ["monthly", "quarterly"] as const;
export type PayoutCycle = (typeof PAYOUT_CYCLES)[number];

export const FINANCIAL_NOTIFICATION_TYPES = [
  "commission.eligible_for_claim",
  "claim.created",
  "claim.approved",
  "claim.rejected",
  "claim.settled",
  "payment.received_by_company",
  "payment.settled",
  "settlement.completed",
  "sales_commission.approved",
  "sales_commission.paid",
] as const;
export type FinancialNotificationType = (typeof FINANCIAL_NOTIFICATION_TYPES)[number];

export function isAllowedOrderPaymentTransition(from: OrderPaymentStatus, to: OrderPaymentStatus): boolean {
  return ORDER_PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}
export function isAllowedPartnerCommissionTransition(from: PartnerCommissionStatus, to: PartnerCommissionStatus): boolean {
  return PARTNER_COMMISSION_TRANSITIONS[from]?.includes(to) ?? false;
}
export function isAllowedSalesCommissionTransition(from: SalesCommissionStatus, to: SalesCommissionStatus): boolean {
  return SALES_COMMISSION_TRANSITIONS[from]?.includes(to) ?? false;
}

// Computes commission base from a package row and the configured base rule.
export function commissionBase(
  itemPriceBeforeTax: number,
  finalPriceAfterTax: number,
  base: "before_tax" | "after_tax",
): number {
  return base === "after_tax" ? finalPriceAfterTax : itemPriceBeforeTax;
}

export function calcCommission(base: number, pct: number): number {
  return Math.round(base * pct) / 100;
}

// ============================================================================
// Unified Transaction Lifecycle (Master Status)
// ============================================================================
// One user-facing master status drives all financial sub-statuses (order
// payments, partner commissions, claims, settlements, sales commissions,
// customer ownership). Users only update the master via dedicated action
// buttons; the orchestrator (`server/lifecycle.ts`) cascades all sub-status
// changes inside a single DB transaction so the audit/financial trail can
// never go out of sync.

export const MASTER_LIFECYCLE_STAGES = [
  "draft_sr",                              // 1
  "submitted_collection_confirmed",        // 2
  "received_by_company",                   // 3
  "under_activation",                      // 4
  "activated_in_safety_period",            // 5  ← LINE OF NO RETURN
  "eligible_for_claim",                    // 6
  "in_claim_review",                       // 7
  "claim_approved_ready_for_settlement",   // 8
  "net_payment_received_by_company",       // 9
  "fully_settled",                         // 10 (terminal)
] as const;
export type MasterLifecycleStage = (typeof MASTER_LIFECYCLE_STAGES)[number];

export const MASTER_EXCEPTION_STATUSES = [
  "failed_rejected",
  "cancelled_refunded",
  "adjustment_required",
  "reopened",
] as const;
export type MasterExceptionStatus = (typeof MASTER_EXCEPTION_STATUSES)[number];

export type MasterStatus = MasterLifecycleStage | MasterExceptionStatus;

// First stage with financial impact. Cancel/Refund and reverse-step are
// forbidden once the order has reached this stage; only completing the
// cycle to fully_settled is allowed from here onward.
export const LINE_OF_NO_RETURN: MasterLifecycleStage = "activated_in_safety_period";

export const STAGE_INDEX: Record<MasterLifecycleStage, number> = Object.fromEntries(
  MASTER_LIFECYCLE_STAGES.map((s, i) => [s, i] as const),
) as Record<MasterLifecycleStage, number>;

export function stageAtOrAfter(s: MasterLifecycleStage, threshold: MasterLifecycleStage): boolean {
  return STAGE_INDEX[s] >= STAGE_INDEX[threshold];
}
export function isPastNoReturn(s: MasterLifecycleStage): boolean {
  return stageAtOrAfter(s, LINE_OF_NO_RETURN);
}

export const MASTER_LIFECYCLE_TRANSITIONS: Record<MasterLifecycleStage, MasterLifecycleStage[]> = {
  draft_sr: ["submitted_collection_confirmed"],
  submitted_collection_confirmed: ["received_by_company"],
  received_by_company: ["under_activation"],
  under_activation: ["activated_in_safety_period"],
  activated_in_safety_period: ["eligible_for_claim"],
  eligible_for_claim: ["in_claim_review"],
  in_claim_review: ["claim_approved_ready_for_settlement"],
  claim_approved_ready_for_settlement: ["net_payment_received_by_company"],
  net_payment_received_by_company: ["fully_settled"],
  fully_settled: [],
};

export const FAIL_REJECT_ALLOWED_FROM: MasterLifecycleStage[] = [
  "draft_sr",
  "submitted_collection_confirmed",
  "received_by_company",
  "under_activation",
];

export const CANCEL_REFUND_ALLOWED_FROM: MasterLifecycleStage[] = [
  "draft_sr",
  "submitted_collection_confirmed",
  "received_by_company",
  "under_activation",
];

export const REWIND_ALLOWED_FROM: MasterLifecycleStage[] = [
  "submitted_collection_confirmed",
  "received_by_company",
  "under_activation",
];

export const MASTER_REOPEN_TARGETS: MasterLifecycleStage[] = ["draft_sr", "submitted_collection_confirmed"];

export const MASTER_ACTIONS = [
  "save_draft",
  "submit_request",
  "receive_request",
  "start_activation",
  "activate_request",
  "mark_eligible_for_claim",
  "create_claim",
  "approve_claim",
  "confirm_net_payment_received",
  "complete_settlement",
  "reject_request",
  "cancel_refund",
  "create_adjustment",
  "reopen_request",
  "rewind_stage",
] as const;
export type MasterAction = (typeof MASTER_ACTIONS)[number];

export const STAGE_ADVANCE_ACTION: Record<MasterLifecycleStage, MasterAction | null> = {
  draft_sr: "submit_request",
  submitted_collection_confirmed: "receive_request",
  received_by_company: "start_activation",
  under_activation: "activate_request",
  activated_in_safety_period: "mark_eligible_for_claim",
  eligible_for_claim: "create_claim",
  in_claim_review: "approve_claim",
  claim_approved_ready_for_settlement: "confirm_net_payment_received",
  net_payment_received_by_company: "complete_settlement",
  fully_settled: null,
};

export interface SubStatusProjection {
  orderStatus: string;
  paymentStatus: OrderPaymentStatus | null;
  partnerCommissionStatus: PartnerCommissionStatus | null;
  claimStatus: "draft" | "approved" | "rejected" | "settled" | null;
  settlementCompleted: boolean;
  ownershipStarts: boolean;
  salesCommissionStatus: SalesCommissionStatus | null;
}

export const STAGE_PROJECTION: Record<MasterLifecycleStage, SubStatusProjection> = {
  draft_sr: {
    orderStatus: "draft_sr",
    paymentStatus: "pending_collection_confirmation",
    partnerCommissionStatus: null,
    claimStatus: null,
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: null,
  },
  submitted_collection_confirmed: {
    orderStatus: "new_request",
    paymentStatus: "collected_by_sales",
    partnerCommissionStatus: null,
    claimStatus: null,
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: null,
  },
  received_by_company: {
    orderStatus: "received",
    paymentStatus: "collected_by_sales",
    partnerCommissionStatus: null,
    claimStatus: null,
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: null,
  },
  under_activation: {
    orderStatus: "under_activation",
    paymentStatus: "collected_by_sales",
    partnerCommissionStatus: null,
    claimStatus: null,
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: null,
  },
  activated_in_safety_period: {
    orderStatus: "activated",
    paymentStatus: "net_amount_due_to_company",
    partnerCommissionStatus: "in_safety_period",
    claimStatus: null,
    settlementCompleted: false,
    ownershipStarts: true,
    salesCommissionStatus: "new",
  },
  eligible_for_claim: {
    orderStatus: "activated",
    paymentStatus: "net_amount_due_to_company",
    partnerCommissionStatus: "eligible_for_claim",
    claimStatus: null,
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: "new",
  },
  in_claim_review: {
    orderStatus: "activated",
    paymentStatus: "net_amount_due_to_company",
    partnerCommissionStatus: "in_claim",
    claimStatus: "draft",
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: "new",
  },
  claim_approved_ready_for_settlement: {
    orderStatus: "activated",
    paymentStatus: "net_amount_due_to_company",
    partnerCommissionStatus: "ready_for_settlement",
    claimStatus: "approved",
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: "eligible_for_payout",
  },
  net_payment_received_by_company: {
    orderStatus: "activated",
    paymentStatus: "received_by_company",
    partnerCommissionStatus: "ready_for_settlement",
    claimStatus: "approved",
    settlementCompleted: false,
    ownershipStarts: false,
    salesCommissionStatus: "eligible_for_payout",
  },
  fully_settled: {
    orderStatus: "activated",
    paymentStatus: "settled",
    partnerCommissionStatus: "settled_successfully",
    claimStatus: "settled",
    settlementCompleted: true,
    ownershipStarts: false,
    salesCommissionStatus: "eligible_for_payout",
  },
};

export function isAllowedMasterTransition(
  from: MasterLifecycleStage,
  to: MasterLifecycleStage,
): boolean {
  if (MASTER_LIFECYCLE_TRANSITIONS[from]?.includes(to)) return true;
  if (REWIND_ALLOWED_FROM.includes(from)) {
    const idx = STAGE_INDEX[from];
    if (idx > 0 && MASTER_LIFECYCLE_STAGES[idx - 1] === to) return true;
  }
  return false;
}

export function canCancelFrom(from: MasterLifecycleStage): boolean {
  return CANCEL_REFUND_ALLOWED_FROM.includes(from);
}
export function canFailFrom(from: MasterLifecycleStage): boolean {
  return FAIL_REJECT_ALLOWED_FROM.includes(from);
}

export const MASTER_STAGE_I18N_KEY = (s: MasterStatus) => `lifecycle.stage.${s}`;
export const MASTER_ACTION_I18N_KEY = (a: MasterAction) => `lifecycle.action.${a}`;

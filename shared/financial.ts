// Unified greenfield financial constants
export const FINANCIAL_ITEM_TYPES = ["payment_item", "partner_commission_item", "sales_commission_item"] as const;
export type FinancialItemType = (typeof FINANCIAL_ITEM_TYPES)[number];

export const FINANCIAL_ITEM_STATUSES = [
  "not_added_to_claim",
  "added_to_claim",
  "added_to_settlement",
  "settled",
] as const;
export type FinancialItemStatus = (typeof FINANCIAL_ITEM_STATUSES)[number];

export const CLAIM_TYPES = ["payment_claim", "partner_commission_claim", "sales_commission_claim"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ["draft", "approved", "rejected", "in_settlement", "settled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const SETTLEMENT_TYPES = ["payment_settlement", "partner_commission_settlement", "sales_commission_settlement"] as const;
export type SettlementType = (typeof SETTLEMENT_TYPES)[number];

export const SETTLEMENT_STATUSES = ["draft", "completed", "cancelled"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const FINANCIAL_EVENT_TYPES = [
  "collection_confirmed_by_sales",
  "handed_to_partner",
  "net_due_calculated",
  "company_received_net_amount",
  "claim_created",
  "claim_approved",
  "claim_rejected",
  "claim_moved_to_settlement",
  "settlement_completed",
  "item_voided",
  "adjustment_created",
] as const;
export type FinancialEventType = (typeof FINANCIAL_EVENT_TYPES)[number];

export const SALES_PAYOUT_CYCLES = ["monthly", "quarterly"] as const;
export type SalesPayoutCycle = (typeof SALES_PAYOUT_CYCLES)[number];

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

// Phase 3 — financial state machines, transitions, and shared types.

export const ORDER_PAYMENT_STATUSES = [
  "pending_collection_confirmation",
  "collected_by_sales",
  "held_by_partner",
  "net_amount_due_to_company",
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
  net_amount_due_to_company: ["received_by_company", "refunded", "cancelled"],
  received_by_company: ["settled", "refunded"],
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

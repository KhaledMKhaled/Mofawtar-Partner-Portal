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

export const CLAIM_TYPE_TO_FINANCIAL_ITEM_TYPE: Record<ClaimType, FinancialItemType> = {
  payment_claim: "payment_item",
  partner_commission_claim: "partner_commission_item",
  sales_commission_claim: "sales_commission_item",
};

export const FINANCIAL_ITEM_TYPE_TO_CLAIM_TYPE: Record<FinancialItemType, ClaimType> = {
  payment_item: "payment_claim",
  partner_commission_item: "partner_commission_claim",
  sales_commission_item: "sales_commission_claim",
};

export function isClaimTypeCompatibleWithFinancialItemType(
  claimType: ClaimType,
  financialItemType: FinancialItemType,
): boolean {
  return CLAIM_TYPE_TO_FINANCIAL_ITEM_TYPE[claimType] === financialItemType;
}

export function assertClaimTypeCompatibleWithFinancialItemType(
  claimType: ClaimType,
  financialItemType: FinancialItemType,
): asserts financialItemType is (typeof CLAIM_TYPE_TO_FINANCIAL_ITEM_TYPE)[typeof claimType] {
  if (!isClaimTypeCompatibleWithFinancialItemType(claimType, financialItemType)) {
    throw new Error(`Incompatible claim type and financial item type: ${claimType} cannot include ${financialItemType}`);
  }
}

export function claimTypeForFinancialItemType(financialItemType: FinancialItemType): ClaimType {
  return FINANCIAL_ITEM_TYPE_TO_CLAIM_TYPE[financialItemType];
}

export function financialItemTypeForClaimType(claimType: ClaimType): FinancialItemType {
  return CLAIM_TYPE_TO_FINANCIAL_ITEM_TYPE[claimType];
}

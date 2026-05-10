import type { TFunction } from "i18next";

export const FINANCIAL_ITEM_STATUSES = [
  "not_added_to_claim",
  "added_to_claim",
  "added_to_settlement",
  "settled",
] as const;
export type FinancialItemStatus = (typeof FINANCIAL_ITEM_STATUSES)[number];

const FINANCIAL_ITEM_TRANSITIONS: Record<FinancialItemStatus, FinancialItemStatus[]> = {
  not_added_to_claim: ["added_to_claim"],
  added_to_claim: ["added_to_settlement"],
  added_to_settlement: ["settled"],
  settled: [],
};

export const ORDER_PAYMENT_STATUSES = FINANCIAL_ITEM_STATUSES;
export type OrderPaymentStatus = FinancialItemStatus;
export const ORDER_PAYMENT_TRANSITIONS: Record<OrderPaymentStatus, OrderPaymentStatus[]> = FINANCIAL_ITEM_TRANSITIONS;

export const PARTNER_COMMISSION_STATUSES = FINANCIAL_ITEM_STATUSES;
export type PartnerCommissionStatus = FinancialItemStatus;
export const PARTNER_COMMISSION_TRANSITIONS: Record<PartnerCommissionStatus, PartnerCommissionStatus[]> = FINANCIAL_ITEM_TRANSITIONS;

export const SALES_COMMISSION_STATUSES = FINANCIAL_ITEM_STATUSES;
export type SalesCommissionStatus = FinancialItemStatus;
export const SALES_COMMISSION_TRANSITIONS: Record<SalesCommissionStatus, SalesCommissionStatus[]> = FINANCIAL_ITEM_TRANSITIONS;

export function pillClassFor(status: string): string {
  if (["settled"].includes(status)) return "pill-success";
  if (["not_added_to_claim"].includes(status)) return "pill-muted";
  if (["added_to_claim","added_to_settlement"].includes(status)) return "pill-warning";
  return "pill-violet";
}

export function tStatus(t: TFunction, group: "payment"|"partnerCommission"|"salesCommission"|"claim"|"settlement", status: string): string {
  return t(`financial.${group}Statuses.${status}`, status.replace(/_/g, " "));
}

export function fmtMoney(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return String(amount);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

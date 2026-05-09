import type { TFunction } from "i18next";

export const ORDER_PAYMENT_STATUSES = [
  "pending_collection_confirmation","collected_by_sales","held_by_partner",
  "net_amount_due_to_company","received_by_company","settled","refunded","cancelled",
] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export const ORDER_PAYMENT_TRANSITIONS: Record<OrderPaymentStatus, OrderPaymentStatus[]> = {
  pending_collection_confirmation: ["collected_by_sales","refunded","cancelled"],
  collected_by_sales: ["held_by_partner","refunded","cancelled"],
  held_by_partner: ["net_amount_due_to_company","refunded","cancelled"],
  net_amount_due_to_company: ["received_by_company","refunded","cancelled"],
  received_by_company: ["settled","refunded","cancelled"],
  settled: [], refunded: [], cancelled: [],
};

export const PARTNER_COMMISSION_STATUSES = [
  "in_safety_period","eligible_for_claim","in_claim","claim_approved",
  "ready_for_settlement","settled_successfully","rejected","adjusted",
] as const;
export type PartnerCommissionStatus = (typeof PARTNER_COMMISSION_STATUSES)[number];
export const PARTNER_COMMISSION_TRANSITIONS: Record<PartnerCommissionStatus, PartnerCommissionStatus[]> = {
  in_safety_period: ["eligible_for_claim","rejected","adjusted"],
  eligible_for_claim: ["in_claim","rejected","adjusted"],
  in_claim: ["claim_approved","rejected","adjusted"],
  claim_approved: ["ready_for_settlement","rejected","adjusted"],
  ready_for_settlement: ["settled_successfully","rejected","adjusted"],
  settled_successfully: [], rejected: [], adjusted: [],
};

export const SALES_COMMISSION_STATUSES = [
  "new","eligible_for_payout","in_payout_batch","approved_by_company","paid","rejected","adjusted",
] as const;
export type SalesCommissionStatus = (typeof SALES_COMMISSION_STATUSES)[number];
export const SALES_COMMISSION_TRANSITIONS: Record<SalesCommissionStatus, SalesCommissionStatus[]> = {
  new: ["eligible_for_payout","rejected","adjusted"],
  eligible_for_payout: ["in_payout_batch","rejected","adjusted"],
  in_payout_batch: ["approved_by_company","rejected","adjusted"],
  approved_by_company: ["paid","rejected","adjusted"],
  paid: [], rejected: [], adjusted: [],
};

export function pillClassFor(status: string): string {
  if (["paid","settled","settled_successfully","received_by_company","approved_by_company","claim_approved","approved"].includes(status)) return "pill-success";
  if (["rejected","cancelled","refunded","failed"].includes(status)) return "pill-danger";
  if (["pending_collection_confirmation","new","draft","in_safety_period"].includes(status)) return "pill-muted";
  if (["eligible_for_claim","eligible_for_payout","ready_for_settlement","in_claim","in_payout_batch","held_by_partner","net_amount_due_to_company","collected_by_sales"].includes(status)) return "pill-warning";
  return "pill-violet";
}

export function tStatus(t: TFunction, group: "payment"|"partnerCommission"|"salesCommission"|"claim"|"payoutBatch"|"settlement", status: string): string {
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

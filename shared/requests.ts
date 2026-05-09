// Operation types, request statuses, allowed transitions, and ownership statuses
// shared between client and server.

export const OPERATION_TYPES = [
  "new_subscription",
  "renewal",
  "upgrade",
  "addon",
  "recurring_payment",
  "other_paid_service",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const REQUEST_STATUSES = [
  "draft_sr",
  "new_request",
  "received",
  "under_activation",
  "activated",
  "failed",
  "rejected",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Allowed forward transitions for the unified request lifecycle.
// `failed` and `rejected` are terminal except for the explicit `reopen`
// action which is handled separately and may target either `draft_sr`
// or `new_request`.
export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft_sr: ["new_request"],
  new_request: ["received", "rejected"],
  received: ["under_activation", "rejected", "failed"],
  under_activation: ["activated", "failed", "rejected"],
  activated: [],
  failed: [],
  rejected: [],
};

export const REOPEN_TARGETS: RequestStatus[] = ["draft_sr", "new_request"];

export const PAYMENT_STATUSES = [
  "pending_collection_confirmation",
  "collected_by_sales",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const OWNERSHIP_STATUSES = [
  "active",
  "expired",
  "extended",
  "transferred",
  "returned_to_company",
] as const;
export type OwnershipStatus = (typeof OWNERSHIP_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "request.submitted",
  "request.received",
  "request.under_activation",
  "request.activated",
  "request.rejected",
  "request.failed",
  "request.reopened",
  "request.reassigned",
  "ownership.started",
  "ownership.near_expiry",
  "ownership.expired",
  "ownership.extended",
  "ownership.transferred",
  "ownership.returned",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isAllowedTransition(from: RequestStatus, to: RequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// Build the SR number for a given tax card + creation timestamp.
// Format: SR-<TaxCardNumber>-YYYYMMDD-HHMM (-NN suffix added on collision by caller).
export function formatSrNumber(taxCardNumber: string, when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = when.getUTCFullYear();
  const m = pad(when.getUTCMonth() + 1);
  const d = pad(when.getUTCDate());
  const hh = pad(when.getUTCHours());
  const mm = pad(when.getUTCMinutes());
  return `SR-${taxCardNumber}-${y}${m}${d}-${hh}${mm}`;
}

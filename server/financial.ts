import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, type DbExecutor } from "./db.js";
import { claimItems, claims, commissionRules, financialEvents, financialItems, packages, partners, requests, roles, settings, settlements, users } from "./schema.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { isEligibleForCommission } from "./ownership.js";
import { calcCommission, commissionBase, defaultDirectionFor, type ClaimType } from "../shared/financial.js";
import type { NotificationType } from "../shared/requests.js";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

async function getCommissionBase(): Promise<"before_tax" | "after_tax"> { const [row] = await db.select().from(settings).where(eq(settings.key, "commission_calculation_base")); return row?.value === "after_tax" ? "after_tax" : "before_tax"; }

export async function resolveCommissionRates(partnerId: number, packageId: number, operationType: string, executor: DbExecutor = db): Promise<{ partnerPct: number; salesPct: number }> {
  const [partner] = await executor.select().from(partners).where(eq(partners.id, partnerId));
  const [pkg] = await executor.select().from(packages).where(eq(packages.id, packageId));
  const [rule] = await executor.select().from(commissionRules).where(and(eq(commissionRules.partnerId, partnerId), eq(commissionRules.packageId, packageId), eq(commissionRules.operationType, operationType), eq(commissionRules.active, true))).limit(1);
  const partnerPct = rule ? Number(rule.partnerCommissionPct) : (Number(pkg?.defaultPartnerCommissionPct ?? 0) || Number(partner?.partnerCommissionPct ?? 0));
  const salesPctRaw = rule ? Number(rule.salesCommissionPct) : (Number(pkg?.defaultSalesCommissionPct ?? 0) || Number(partner?.salesCommissionPct ?? 0));
  return { partnerPct, salesPct: partner?.salesCommissionEnabled ? salesPctRaw : 0 };
}

async function createFinancialEvent(tx: DbExecutor, data: { financialItemId: number | null; requestId: number; customerId: number; partnerId: number; salesUserId?: number | null; eventType: string; amount?: string | null; createdBy?: number | null; eventNote?: string | null; }) {
  await tx.insert(financialEvents).values({ ...data, amount: data.amount ?? null, createdBy: data.createdBy ?? null, salesUserId: data.salesUserId ?? null, eventNote: data.eventNote ?? null });
}

function startOfNextMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 1); }
function startOfNextQuarter(d: Date): Date { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 1); }

function buildClaimability(type: "payment_item" | "partner_commission_item" | "sales_commission_item", activatedAt: Date, safetyPeriodDays: number, salesPayoutCycle: "monthly" | "quarterly", now: Date): { eligibleForClaimAt: Date; isClaimable: boolean; claimBlockReason: string | null } {
  const eligibleForClaimAt =
    type === "payment_item" ? activatedAt
      : type === "partner_commission_item" ? new Date(activatedAt.getTime() + (safetyPeriodDays * 24 * 60 * 60 * 1000))
      : (salesPayoutCycle === "quarterly" ? startOfNextQuarter(activatedAt) : startOfNextMonth(activatedAt));
  const isClaimable = eligibleForClaimAt <= now;
  const claimBlockReason = isClaimable
    ? null
    : (type === "partner_commission_item" ? "Inside safety period" : "Awaiting payout cycle date");
  return { eligibleForClaimAt, isClaimable, claimBlockReason };
}

export async function onRequestActivated(opts: { requestId: number; userId: number }, executor: DbExecutor = db) {
  const [r] = await executor.select().from(requests).where(eq(requests.id, opts.requestId));
  if (!r?.packageId) throw new Error(`request_missing_package:${opts.requestId}`);
  const [pkg] = await executor.select().from(packages).where(eq(packages.id, r.packageId));
  const [partner] = await executor.select().from(partners).where(eq(partners.id, r.partnerId));
  if (!pkg || !partner) throw new Error("related_not_found");
  const base = await getCommissionBase();
  const beforeTax = Number(pkg.itemPriceBeforeTax); const afterTax = Number(pkg.finalPriceAfterTax); const tax = afterTax - beforeTax;
  const baseAmount = commissionBase(beforeTax, afterTax, base);
  const eligible = await isEligibleForCommission(r.customerId, r.partnerId, new Date(), executor);
  const rates = eligible ? await resolveCommissionRates(r.partnerId, r.packageId, r.operationType ?? "", executor) : { partnerPct: 0, salesPct: 0 };
  const partnerAmount = calcCommission(baseAmount, rates.partnerPct);
  const salesAmount = calcCommission(baseAmount, rates.salesPct);
  const netDueToCompany = Math.max(0, afterTax - partnerAmount);
  const now = new Date();
  const activatedAt = r.activatedAt ?? now;
  const common = { relatedRequestId: r.id, relatedSrNumber: r.srNumber, relatedCustomerId: r.customerId, relatedPartnerId: r.partnerId, relatedSalesUserId: r.salesUserId, relatedPackageId: r.packageId, operationType: r.operationType, grossCustomerAmount: String(afterTax), itemPriceBeforeTax: String(beforeTax), taxPercentage: String(pkg.taxPercentage ?? 0), taxAmount: String(tax), finalPriceAfterTax: String(afterTax), commissionBase: String(baseAmount), partnerCommissionPercentage: String(rates.partnerPct), partnerCommissionAmount: String(partnerAmount), salesCommissionPercentage: String(rates.salesPct), salesCommissionAmount: String(salesAmount), netAmountDueToCompany: String(netDueToCompany), status: "not_added_to_claim" as const, claimBlockReason: null };

  const existing = await executor.select().from(financialItems).where(eq(financialItems.relatedRequestId, r.id));
  const byType = new Map(existing.map((x) => [x.type, x]));
  const ensure = async (type: "payment_item" | "partner_commission_item" | "sales_commission_item", amount: number, forceUnclaimableReason?: string) => {
    if (byType.has(type)) return byType.get(type)!;
    const claimability = buildClaimability(type, activatedAt, partner.safetyPeriodDays ?? 0, (partner.salesPayoutCycle as "monthly" | "quarterly") ?? "monthly", now);
    const isClaimable = forceUnclaimableReason ? false : claimability.isClaimable;
    const claimBlockReason = forceUnclaimableReason ?? claimability.claimBlockReason;
    const [item] = await executor.insert(financialItems).values({ ...common, type, amount: String(amount), isClaimable, eligibleForClaimAt: claimability.eligibleForClaimAt, claimBlockReason }).returning();
    await createFinancialEvent(executor, { financialItemId: item.id, requestId: r.id, customerId: r.customerId, partnerId: r.partnerId, salesUserId: r.salesUserId, eventType: "item_created", amount: String(amount), createdBy: opts.userId, eventNote: `${type} created on activation` });
    await audit({ userId: opts.userId, action: "financial_item.created", entityType: "financial_item", entityId: item.id, requestId: r.id, customerId: r.customerId, partnerId: r.partnerId, newValue: item });
    return item;
  };

  const payment = await ensure("payment_item", netDueToCompany);
  const partnerCommission = await ensure("partner_commission_item", partnerAmount, partnerAmount > 0 ? undefined : "zero_amount");
  const salesCommission = (partner.salesCommissionEnabled && salesAmount > 0 && r.salesUserId) ? await ensure("sales_commission_item", salesAmount) : null;
  return { paymentItemId: payment.id, partnerCommissionItemId: partnerCommission.id, salesCommissionItemId: salesCommission?.id ?? null };
}

async function notifyPartnerAccountants(partnerId: number, type: NotificationType, opts: any) { const rows = await db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(sql`(${roles.key} IN ('partner_admin','partner_accountant') AND ${users.partnerId} = ${partnerId}) OR ${roles.key} IN ('company_super_admin','company_accountant')`); for (const u of rows) await notify({ userId: u.id, type, ...opts }); }
async function notifyCompanyAccountants(type: NotificationType, opts: any) { const rows = await db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(sql`${roles.key} IN ('company_super_admin','company_accountant')`); for (const u of rows) await notify({ userId: u.id, type, ...opts }); }

const CLAIM_ITEM_TYPE_MAP: Record<ClaimType, "payment_item" | "partner_commission_item" | "sales_commission_item"> = { payment_claim: "payment_item", partner_commission_claim: "partner_commission_item", sales_commission_claim: "sales_commission_item" };

export async function createClaim(opts: { type: ClaimType; partnerId: number; itemIds: number[]; userId: number | null; autoGenerated?: boolean; notes?: string; }) {
  const type = CLAIM_ITEM_TYPE_MAP[opts.type];
  const { claim, claimNumber } = await db.transaction(async (tx) => {
    const items = await tx.select().from(financialItems).where(and(eq(financialItems.relatedPartnerId, opts.partnerId), eq(financialItems.type, type), eq(financialItems.status, "not_added_to_claim"), eq(financialItems.isClaimable, true), inArray(financialItems.id, opts.itemIds)));
    if (items.length !== opts.itemIds.length) throw new Error("ineligible_items");
    const total = items.reduce((s, i) => s + Number(i.amount), 0);
    const claimNumber = `CLM-${Date.now()}-${opts.partnerId}`;
    const [claim] = await tx.insert(claims).values({ claimNumber, partnerId: opts.partnerId, type: opts.type, status: "draft", totalAmount: String(total), createdBy: opts.userId ?? null }).returning();
    for (const it of items) {
      await tx.insert(claimItems).values({ claimId: claim.id, financialItemId: it.id, amountSnapshot: it.amount, commissionBaseSnapshot: it.commissionBase, taxSnapshot: it.taxAmount, netDueSnapshot: it.netAmountDueToCompany });
      await tx.update(financialItems).set({ status: "added_to_claim", claimId: claim.id, updatedAt: new Date() }).where(eq(financialItems.id, it.id));
      await createFinancialEvent(tx, { financialItemId: it.id, requestId: it.relatedRequestId, customerId: it.relatedCustomerId, partnerId: it.relatedPartnerId, salesUserId: it.relatedSalesUserId, eventType: "claim_created", amount: it.amount, createdBy: opts.userId, eventNote: claimNumber });
    }
    return { claim, claimNumber };
  });
  await audit({ userId: opts.userId, action: "claim.created", entityType: "claim", entityId: claim.id, partnerId: opts.partnerId, newValue: claim });
  await notifyCompanyAccountants("claim.created", { titleEn: `New claim ${claimNumber}`, titleAr: `مطالبة جديدة ${claimNumber}`, entityType: "claim", entityId: claim.id });
  return { id: claim.id, claimNumber, type: opts.type };
}

export async function approveClaim(claimId: number, userId: number): Promise<void> { await db.update(claims).set({ status: "approved", approvedAt: new Date(), approvedBy: userId }).where(eq(claims.id, claimId)); await audit({ userId, action: "claim.approved", entityType: "claim", entityId: claimId }); }
export async function rejectClaim(claimId: number, userId: number, reason: string): Promise<void> { const items = await db.select().from(claimItems).where(eq(claimItems.claimId, claimId)); await db.transaction(async (tx)=>{ await tx.update(claims).set({ status: "rejected", rejectedAt: new Date(), rejectedBy: userId, rejectionReason: reason }).where(eq(claims.id, claimId)); for (const it of items) await tx.update(financialItems).set({ status: "not_added_to_claim", claimId: null }).where(eq(financialItems.id, it.financialItemId)); }); await audit({ userId, action: "claim.rejected", entityType: "claim", entityId: claimId, note: reason }); }

export async function createDraftSettlement(opts: { claimId: number; userId: number; notes?: string; }) {
  const [c] = await db.select().from(claims).where(eq(claims.id, opts.claimId));
  if (!c || c.status !== "approved") throw new Error("claim_not_approved");
  const totalAmount = Number(c.totalAmount);
  const settlementNumber = `SET-${Date.now()}-${c.id}`;
  const [s] = await db.insert(settlements).values({
    settlementNumber,
    type: c.type.replace("claim", "settlement"),
    status: "draft",
    totalAmount: String(totalAmount),
    createdBy: opts.userId,
    notes: opts.notes,
  }).returning();
  await audit({ userId: opts.userId, action: "settlement.draft_created", entityType: "settlement", entityId: s.id });
  return { settlement: s, claim: c };
}

export async function addApprovedClaimToSettlement(opts: { settlementId: number; claimId: number; userId: number; }) {
  const [s] = await db.select().from(settlements).where(eq(settlements.id, opts.settlementId));
  const [c] = await db.select().from(claims).where(eq(claims.id, opts.claimId));
  if (!s) throw new Error("settlement_not_found");
  if (!c || c.status !== "approved") throw new Error("claim_not_approved");
  if (s.status !== "draft") throw new Error("settlement_not_draft");
  if (s.type !== c.type.replace("claim", "settlement")) throw new Error("claim_type_mismatch");

  const items = await db.select().from(claimItems).where(eq(claimItems.claimId, c.id));
  await db.transaction(async (tx) => {
    await tx.update(claims).set({ status: "in_settlement", settlementId: s.id }).where(eq(claims.id, c.id));
    for (const it of items) {
      const [fi] = await tx.select().from(financialItems).where(eq(financialItems.id, it.financialItemId));
      await tx.update(financialItems).set({ status: "added_to_settlement", settlementId: s.id, updatedAt: new Date() }).where(eq(financialItems.id, it.financialItemId));
      if (fi) {
        await createFinancialEvent(tx, { financialItemId: fi.id, requestId: fi.relatedRequestId, customerId: fi.relatedCustomerId, partnerId: fi.relatedPartnerId, salesUserId: fi.relatedSalesUserId, eventType: "claim_moved_to_settlement", amount: fi.amount, createdBy: opts.userId, eventNote: s.settlementNumber });
      }
    }
  });
  await audit({ userId: opts.userId, action: "claim.moved_to_settlement", entityType: "claim", entityId: c.id });
}

export async function completeSettlement(opts: { settlementId: number; userId: number; }) {
  const [s] = await db.select().from(settlements).where(eq(settlements.id, opts.settlementId));
  if (!s) throw new Error("settlement_not_found");
  const [c] = await db.select().from(claims).where(eq(claims.settlementId, s.id));
  if (!c) throw new Error("settlement_has_no_claim");
  const items = await db.select().from(claimItems).where(eq(claimItems.claimId, c.id));
  const settledAt = new Date();

  await db.transaction(async (tx) => {
    await tx.update(settlements).set({ status: "completed", completedBy: opts.userId, completedAt: settledAt }).where(eq(settlements.id, s.id));
    await tx.update(claims).set({ status: "settled", settledAt }).where(eq(claims.id, c.id));
    for (const it of items) {
      const [fi] = await tx.select().from(financialItems).where(eq(financialItems.id, it.financialItemId));
      await tx.update(financialItems).set({ status: "settled", settlementId: s.id, settledAt, updatedAt: settledAt }).where(eq(financialItems.id, it.financialItemId));
      if (fi) {
        await createFinancialEvent(tx, { financialItemId: fi.id, requestId: fi.relatedRequestId, customerId: fi.relatedCustomerId, partnerId: fi.relatedPartnerId, salesUserId: fi.relatedSalesUserId, eventType: "settlement_completed", amount: fi.amount, createdBy: opts.userId, eventNote: s.settlementNumber });
      }
    }
  });
  await audit({ userId: opts.userId, action: "settlement.completed", entityType: "settlement", entityId: s.id });
}

export async function createSettlement(opts: { claimId: number; userId: number; notes?: string; }) {
  const { settlement, claim } = await createDraftSettlement(opts);
  await addApprovedClaimToSettlement({ settlementId: settlement.id, claimId: claim.id, userId: opts.userId });
  await completeSettlement({ settlementId: settlement.id, userId: opts.userId });
  return { id: settlement.id, settlementNumber: settlement.settlementNumber, totalAmount: Number(settlement.totalAmount), direction: defaultDirectionFor(claim.type as ClaimType), type: claim.type as ClaimType };
}

export async function runFinancialHousekeep() {
  const now = new Date();
  const flippedRows = await db.update(financialItems)
    .set({ isClaimable: true, claimBlockReason: null, updatedAt: now })
    .where(and(eq(financialItems.status, "not_added_to_claim"), eq(financialItems.isClaimable, false), lte(financialItems.eligibleForClaimAt, now)))
    .returning({ id: financialItems.id });
  const autoPartners = await db.select().from(partners).where(eq(partners.claimCycleType, "auto"));
  let claimsCreated = 0;
  for (const p of autoPartners) {
    const eligible = await db.select({ id: financialItems.id }).from(financialItems).where(and(eq(financialItems.relatedPartnerId, p.id), eq(financialItems.isClaimable, true), eq(financialItems.status, "not_added_to_claim"), eq(financialItems.type, "partner_commission_item")));
    if (!eligible.length) continue;
    await createClaim({ type: "partner_commission_claim", partnerId: p.id, itemIds: eligible.map(e=>e.id), userId: null, autoGenerated: true });
    claimsCreated++;
  }
  return { flipped: flippedRows.length, claimsCreated, advancedSales: 0 };
}

export function dateRangeFilter(col: PgColumn, from?: string | null, to?: string | null): SQL[] { const filters: SQL[] = []; if (from) filters.push(gte(col, new Date(from))); if (to) filters.push(lte(col, new Date(to))); return filters; }

export async function createPayoutBatch(opts:{partnerId:number;cycle:"monthly"|"quarterly";salesCommissionIds:number[];userId:number;notes?:string}){const c=await createClaim({type:"sales_commission_claim",partnerId:opts.partnerId,itemIds:opts.salesCommissionIds,userId:opts.userId,notes:opts.notes});return {id:c.id,batchNumber:c.claimNumber};}
export async function approvePayoutBatch(batchId:number,userId:number){await approveClaim(batchId,userId);}
export async function payPayoutBatch(batchId:number,userId:number){await createSettlement({claimId:batchId,userId});}

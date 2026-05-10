import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db.js";
import { financialItems, customers, partners, packages, requests, claims, settlements } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { createClaim, approveClaim } from "../financial.js";

export const paymentsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

paymentsRouter.get("/", requirePerm("payments:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { status, partnerId, from, to } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [eq(financialItems.type, "payment_item")];
  if (partnerScoped(cu)) filters.push(eq(financialItems.relatedPartnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(financialItems.relatedPartnerId, Number(partnerId)));
  if (status) filters.push(eq(financialItems.status, status));
  if (from) filters.push(sql`${financialItems.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${financialItems.createdAt} <= ${new Date(to)}`);
  const where = and(...filters);
  const rows = await db.select({
    id: financialItems.id, requestId: financialItems.relatedRequestId, srNumber: requests.srNumber,
    partnerId: financialItems.relatedPartnerId, partnerName: partners.name,
    customerId: financialItems.relatedCustomerId, customerName: customers.name, taxCardNumber: customers.taxCardNumber,
    packageId: financialItems.relatedPackageId, packageName: packages.name,
    grossAmount: financialItems.grossCustomerAmount, netAmount: financialItems.itemPriceBeforeTax, taxAmount: financialItems.taxAmount, partnerCommissionAmount: financialItems.partnerCommissionAmount, amount: financialItems.amount, netDueToCompany: financialItems.netAmountDueToCompany,
    status: financialItems.status, claimId: financialItems.claimId, settlementId: financialItems.settlementId,
    createdAt: financialItems.createdAt, settledAt: financialItems.settledAt,
  }).from(financialItems)
    .leftJoin(requests, eq(requests.id, financialItems.relatedRequestId))
    .leftJoin(customers, eq(customers.id, financialItems.relatedCustomerId))
    .leftJoin(partners, eq(partners.id, financialItems.relatedPartnerId))
    .leftJoin(packages, eq(packages.id, financialItems.relatedPackageId))
    .where(where).orderBy(desc(financialItems.createdAt)).limit(500);
  res.json(rows);
});

paymentsRouter.post("/:id(\\d+)/claims", requirePerm("claims:create"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [item] = await db.select().from(financialItems).where(eq(financialItems.id, id));
  if (!item || item.type !== "payment_item") return res.status(404).json({ error: "not_found_or_type_mismatch" });
  if (partnerScoped(cu) && item.relatedPartnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const [r] = await db.select({ status: requests.status }).from(requests).where(eq(requests.id, item.relatedRequestId));
  if (item.isVoided || !item.isClaimable || item.status !== "not_added_to_claim" || (item.eligibleForClaimAt && item.eligibleForClaimAt > new Date()) || !r || r.status !== "activated") {
    return res.status(409).json({ error: "ineligible_item" });
  }
  const result = await createClaim({ type: "payment_claim", partnerId: item.relatedPartnerId, itemIds: [id], userId: cu.id });
  res.json(result);
});

paymentsRouter.post("/:id(\\d+)/claims/:claimId(\\d+)/approve", requirePerm("claims:approve"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  await approveClaim(Number(req.params.claimId), cu.id);
  res.json({ ok: true });
});

paymentsRouter.post("/:id(\\d+)/claims/:claimId(\\d+)/reject", requirePerm("claims:reject"), async (_req, res) => res.status(501).json({ error: "use_/claims/:id/reject" }));
paymentsRouter.post("/:id(\\d+)/claims/:claimId(\\d+)/move", requirePerm("claims:create"), async (_req, res) => res.status(501).json({ error: "not_supported" }));
paymentsRouter.post("/:id(\\d+)/settlements", requirePerm("settlements:create"), async (_req, res) => res.status(501).json({ error: "use_/settlements" }));
paymentsRouter.post("/:id(\\d+)/settlements/add-claim", requirePerm("settlements:create"), async (_req, res) => res.status(501).json({ error: "use_claimId_in_/settlements" }));
paymentsRouter.post("/:id(\\d+)/settlements/:settlementId(\\d+)/complete", requirePerm("settlements:create"), async (_req, res) => res.status(501).json({ error: "auto_completed" }));
paymentsRouter.post("/:id(\\d+)/settlements/:settlementId(\\d+)/cancel", requirePerm("settlements:create"), async (_req, res) => res.status(501).json({ error: "not_implemented" }));

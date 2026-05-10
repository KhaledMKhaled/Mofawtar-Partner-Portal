import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db.js";
import { financialItems, customers, partners, packages, requests } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { createClaim } from "../financial.js";

export const partnerCommissionsRouter = Router();
const partnerScoped = (cu: { roleKey: string; partnerId: number | null }) => !!(cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant");

partnerCommissionsRouter.get("/", requirePerm("partner_commissions:view"), async (req, res) => {
  const cu = getUser(req)!; const { status, partnerId, from, to } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [eq(financialItems.type, "partner_commission_item")];
  if (partnerScoped(cu)) filters.push(eq(financialItems.relatedPartnerId, cu.partnerId!)); else if (partnerId) filters.push(eq(financialItems.relatedPartnerId, Number(partnerId)));
  if (status) filters.push(eq(financialItems.status, status)); if (from) filters.push(sql`${financialItems.createdAt} >= ${new Date(from)}`); if (to) filters.push(sql`${financialItems.createdAt} <= ${new Date(to)}`);
  const rows = await db.select({ id: financialItems.id, requestId: financialItems.relatedRequestId, srNumber: requests.srNumber, partnerId: financialItems.relatedPartnerId, partnerName: partners.name, customerName: customers.name, packageName: packages.name, baseAmount: financialItems.commissionBase, pct: financialItems.partnerCommissionPercentage, partnerCommissionAmount: financialItems.partnerCommissionAmount, amount: financialItems.amount, status: financialItems.status, safetyEndsAt: financialItems.eligibleForClaimAt, eligibleForClaimAt: financialItems.eligibleForClaimAt, isVoided: financialItems.isVoided, claimId: financialItems.claimId, settlementId: financialItems.settlementId, createdAt: financialItems.createdAt }).from(financialItems).leftJoin(requests, eq(requests.id, financialItems.relatedRequestId)).leftJoin(customers, eq(customers.id, financialItems.relatedCustomerId)).leftJoin(partners, eq(partners.id, financialItems.relatedPartnerId)).leftJoin(packages, eq(packages.id, financialItems.relatedPackageId)).where(and(...filters)).orderBy(desc(financialItems.createdAt)).limit(500);
  res.json(rows);
});

partnerCommissionsRouter.post("/:id/claims", requirePerm("claims:create"), async (req, res) => {
  const cu = getUser(req)!; const id = Number(req.params.id);
  const [item] = await db.select().from(financialItems).where(eq(financialItems.id, id));
  if (!item || item.type !== "partner_commission_item") return res.status(404).json({ error: "not_found_or_type_mismatch" });
  if (partnerScoped(cu) && item.relatedPartnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const [r] = await db.select({ status: requests.status }).from(requests).where(eq(requests.id, item.relatedRequestId));
  if (item.isVoided || !item.isClaimable || item.status !== "not_added_to_claim" || (item.eligibleForClaimAt && item.eligibleForClaimAt > new Date()) || !r || r.status !== "activated") return res.status(409).json({ error: "ineligible_item" });
  res.json(await createClaim({ type: "partner_commission_claim", partnerId: item.relatedPartnerId, itemIds: [id], userId: cu.id }));
});

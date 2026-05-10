import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db.js";
import { financialItems, customers, partners, packages, requests, users } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { createClaim } from "../financial.js";

export const salesCommissionsRouter = Router();

salesCommissionsRouter.get("/", requirePerm("sales_commissions:view"), async (req, res) => {
  const cu = getUser(req)!; const { status, partnerId, salesUserId, from, to } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [eq(financialItems.type, "sales_commission_item")];
  if (cu.roleKey === "sales") filters.push(eq(financialItems.relatedSalesUserId, cu.id));
  else if (cu.roleKey === "team_leader") filters.push(sql`${financialItems.relatedSalesUserId} IN (SELECT ${users.id} FROM ${users} WHERE ${users.teamLeaderId} = ${cu.id})`);
  else if (partnerId) filters.push(eq(financialItems.relatedPartnerId, Number(partnerId)));
  if (salesUserId) filters.push(eq(financialItems.relatedSalesUserId, Number(salesUserId)));
  if (status) filters.push(eq(financialItems.status, status)); if (from) filters.push(sql`${financialItems.createdAt} >= ${new Date(from)}`); if (to) filters.push(sql`${financialItems.createdAt} <= ${new Date(to)}`);
  const rows = await db.select({ id: financialItems.id, requestId: financialItems.relatedRequestId, srNumber: requests.srNumber, partnerId: financialItems.relatedPartnerId, partnerName: partners.name, salesUserId: financialItems.relatedSalesUserId, salesName: users.name, customerName: customers.name, packageName: packages.name, amount: financialItems.amount, status: financialItems.status, createdAt: financialItems.createdAt }).from(financialItems).leftJoin(requests, eq(requests.id, financialItems.relatedRequestId)).leftJoin(customers, eq(customers.id, financialItems.relatedCustomerId)).leftJoin(partners, eq(partners.id, financialItems.relatedPartnerId)).leftJoin(packages, eq(packages.id, financialItems.relatedPackageId)).leftJoin(users, eq(users.id, financialItems.relatedSalesUserId)).where(and(...filters)).orderBy(desc(financialItems.createdAt)).limit(500);
  res.json(rows);
});

salesCommissionsRouter.post("/:id/claims", requirePerm("claims:create"), async (req, res) => {
  const cu = getUser(req)!; const id = Number(req.params.id);
  const [item] = await db.select().from(financialItems).where(eq(financialItems.id, id));
  if (!item || item.type !== "sales_commission_item") return res.status(404).json({ error: "not_found_or_type_mismatch" });
  if (cu.roleKey === "sales" && item.relatedSalesUserId !== cu.id) return res.status(403).json({ error: "forbidden" });
  const [r] = await db.select({ status: requests.status }).from(requests).where(eq(requests.id, item.relatedRequestId));
  if (item.isVoided || !item.isClaimable || item.status !== "not_added_to_claim" || (item.eligibleForClaimAt && item.eligibleForClaimAt > new Date()) || !r || r.status !== "activated") return res.status(409).json({ error: "ineligible_item" });
  res.json(await createClaim({ type: "sales_commission_claim", partnerId: item.relatedPartnerId, itemIds: [id], userId: cu.id }));
});

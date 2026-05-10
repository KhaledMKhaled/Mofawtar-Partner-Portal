import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  payoutBatches, payoutBatchItems, salesCommissions, partners, customers, packages, users,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
// Mutating endpoints are deprecated — sales-commission payouts now flow
// through unified Claims (`type=sales_commission`) and Settlements. The
// generic primitives create claim/settlement IDs that do not correspond to
// `payout_batches` rows, so calling the legacy create/approve/pay endpoints
// would silently corrupt the audit trail. We answer 410 Gone instead.

export const payoutBatchesRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

payoutBatchesRouter.get("/", requirePerm("payout_batches:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { status, partnerId } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [];
  if (partnerScoped(cu)) filters.push(eq(payoutBatches.partnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(payoutBatches.partnerId, Number(partnerId)));
  if (status) filters.push(eq(payoutBatches.status, status));
  const where = filters.length ? and(...filters) : undefined;
  const q = db.select({
    id: payoutBatches.id, batchNumber: payoutBatches.batchNumber,
    partnerId: payoutBatches.partnerId, partnerName: partners.name,
    cycle: payoutBatches.cycle, status: payoutBatches.status,
    totalAmount: payoutBatches.totalAmount, paidAt: payoutBatches.paidAt,
    approvedAt: payoutBatches.approvedAt, createdAt: payoutBatches.createdAt,
  }).from(payoutBatches).leftJoin(partners, eq(partners.id, payoutBatches.partnerId));
  const rows = where ? await q.where(where).orderBy(desc(payoutBatches.createdAt)).limit(200) : await q.orderBy(desc(payoutBatches.createdAt)).limit(200);
  res.json(rows);
});

payoutBatchesRouter.get("/eligible", requirePerm("payout_batches:view"), async (req, res) => {
  const cu = getUser(req)!;
  const partnerId = partnerScoped(cu) ? cu.partnerId! : Number(req.query.partnerId);
  if (!partnerId) return res.status(400).json({ error: "partner_required" });
  const rows = await db.select({
    id: salesCommissions.id,
    salesName: users.name,
    customerName: customers.name,
    packageName: packages.name,
    amount: salesCommissions.amount,
    createdAt: salesCommissions.createdAt,
  }).from(salesCommissions)
    .leftJoin(users, eq(users.id, salesCommissions.salesUserId))
    .leftJoin(customers, eq(customers.id, salesCommissions.customerId))
    .leftJoin(packages, eq(packages.id, salesCommissions.packageId))
    .where(and(eq(salesCommissions.partnerId, partnerId), eq(salesCommissions.status, "eligible_for_payout")))
    .orderBy(desc(salesCommissions.createdAt));
  res.json(rows);
});

payoutBatchesRouter.get("/:id", requirePerm("payout_batches:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [b] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, id));
  if (!b) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && b.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const items = await db.select({
    id: payoutBatchItems.id,
    salesCommissionId: payoutBatchItems.salesCommissionId,
    amount: payoutBatchItems.amount,
    salesName: users.name,
    customerName: customers.name,
    packageName: packages.name,
  }).from(payoutBatchItems)
    .leftJoin(salesCommissions, eq(salesCommissions.id, payoutBatchItems.salesCommissionId))
    .leftJoin(users, eq(users.id, salesCommissions.salesUserId))
    .leftJoin(customers, eq(customers.id, salesCommissions.customerId))
    .leftJoin(packages, eq(packages.id, salesCommissions.packageId))
    .where(eq(payoutBatchItems.payoutBatchId, id));
  res.json({ batch: b, items });
});

const goneBody = {
  error: "deprecated",
  message: "payout_batches mutations are deprecated; use /api/claims with type=sales_commission",
  redirect: "/claims?type=sales_commission",
};
payoutBatchesRouter.post("/", (_req, res) => res.status(410).json(goneBody));
payoutBatchesRouter.post("/:id/approve", (_req, res) => res.status(410).json(goneBody));
payoutBatchesRouter.post("/:id/pay", (_req, res) => res.status(410).json(goneBody));

// Bulk: mark eligible_for_payout for sales commissions in `new` status for a partner.
const promoteInput = z.object({ partnerId: z.coerce.number().int(), ids: z.array(z.coerce.number().int()).optional() });
payoutBatchesRouter.post("/promote-eligible", requirePerm("sales_commissions:change_status"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const parsed = promoteInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const filter = parsed.data.ids?.length
    ? and(eq(salesCommissions.partnerId, parsed.data.partnerId), eq(salesCommissions.status, "new"), sql`${salesCommissions.id} = ANY(${parsed.data.ids})`)
    : and(eq(salesCommissions.partnerId, parsed.data.partnerId), eq(salesCommissions.status, "new"));
  const items = await db.select().from(salesCommissions).where(filter);
  const { transitionSalesCommission } = await import("../financial.js");
  let n = 0;
  for (const it of items) {
    const r = await transitionSalesCommission({ id: it.id, toStatus: "eligible_for_payout", userId: cu.id, reason: "bulk_promote" });
    // Note: `eligible_for_payout` is the natural promotion target after the
    // safety period; it is NOT batch-gated, so no override flag is needed.
    if (r.ok) n++;
  }
  res.json({ promoted: n });
});

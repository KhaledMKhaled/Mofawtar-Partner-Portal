import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  salesCommissions, salesCommissionStatusHistory, customers, partners, packages, requests, users,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { transitionSalesCommission } from "../financial.js";
import { SALES_COMMISSION_STATUSES, type SalesCommissionStatus } from "../../shared/financial.js";

export const salesCommissionsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

salesCommissionsRouter.get("/", requirePerm("sales_commissions:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { status, partnerId, salesUserId, from, to } = req.query as Record<string, string | undefined>;
  const filters: any[] = [];
  if (cu.roleKey === "sales") {
    filters.push(eq(salesCommissions.salesUserId, cu.id));
  } else if (cu.roleKey === "team_leader") {
    filters.push(sql`${salesCommissions.salesUserId} IN (SELECT sales_user_id FROM team_assignments WHERE team_leader_id = ${cu.id})`);
  } else if (partnerScoped(cu)) {
    filters.push(eq(salesCommissions.partnerId, cu.partnerId!));
  } else if (partnerId) {
    filters.push(eq(salesCommissions.partnerId, Number(partnerId)));
  }
  if (salesUserId) filters.push(eq(salesCommissions.salesUserId, Number(salesUserId)));
  if (status) filters.push(eq(salesCommissions.status, status));
  if (from) filters.push(sql`${salesCommissions.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${salesCommissions.createdAt} <= ${new Date(to)}`);
  const where = filters.length ? and(...filters) : undefined;
  const q = db
    .select({
      id: salesCommissions.id,
      requestId: salesCommissions.requestId,
      srNumber: requests.srNumber,
      partnerId: salesCommissions.partnerId,
      partnerName: partners.name,
      salesUserId: salesCommissions.salesUserId,
      salesName: users.name,
      customerId: salesCommissions.customerId,
      customerName: customers.name,
      packageId: salesCommissions.packageId,
      packageName: packages.name,
      baseAmount: salesCommissions.baseAmount,
      pct: salesCommissions.pct,
      amount: salesCommissions.amount,
      status: salesCommissions.status,
      payoutBatchId: salesCommissions.payoutBatchId,
      createdAt: salesCommissions.createdAt,
    })
    .from(salesCommissions)
    .leftJoin(requests, eq(requests.id, salesCommissions.requestId))
    .leftJoin(customers, eq(customers.id, salesCommissions.customerId))
    .leftJoin(partners, eq(partners.id, salesCommissions.partnerId))
    .leftJoin(packages, eq(packages.id, salesCommissions.packageId))
    .leftJoin(users, eq(users.id, salesCommissions.salesUserId));
  const rows = where
    ? await q.where(where).orderBy(desc(salesCommissions.createdAt)).limit(500)
    : await q.orderBy(desc(salesCommissions.createdAt)).limit(500);
  res.json(rows);
});

salesCommissionsRouter.get("/:id", requirePerm("sales_commissions:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [sc] = await db.select().from(salesCommissions).where(eq(salesCommissions.id, id));
  if (!sc) return res.status(404).json({ error: "not_found" });
  if (cu.roleKey === "sales" && sc.salesUserId !== cu.id) return res.status(403).json({ error: "forbidden" });
  if (partnerScoped(cu) && sc.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const history = await db
    .select({
      id: salesCommissionStatusHistory.id,
      fromStatus: salesCommissionStatusHistory.fromStatus,
      toStatus: salesCommissionStatusHistory.toStatus,
      reason: salesCommissionStatusHistory.reason,
      createdAt: salesCommissionStatusHistory.createdAt,
      userName: users.name,
    })
    .from(salesCommissionStatusHistory)
    .leftJoin(users, eq(users.id, salesCommissionStatusHistory.changedByUserId))
    .where(eq(salesCommissionStatusHistory.salesCommissionId, id))
    .orderBy(desc(salesCommissionStatusHistory.createdAt));
  res.json({ commission: sc, history });
});

const transitionInput = z.object({
  toStatus: z.enum(SALES_COMMISSION_STATUSES as unknown as [string, ...string[]]),
  reason: z.string().optional().nullable(),
});

salesCommissionsRouter.post("/:id/transition", requirePerm("sales_commissions:change_status"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = transitionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [sc] = await db.select().from(salesCommissions).where(eq(salesCommissions.id, id));
  if (!sc) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && sc.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const result = await transitionSalesCommission({
    id, toStatus: parsed.data.toStatus as SalesCommissionStatus, userId: cu.id, reason: parsed.data.reason,
  });
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});

import { Router } from "express";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  partnerCommissions, partnerCommissionStatusHistory, customers, partners, packages, requests, users,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { transitionPartnerCommission } from "../financial.js";
import { PARTNER_COMMISSION_STATUSES, type PartnerCommissionStatus } from "../../shared/financial.js";

export const partnerCommissionsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

partnerCommissionsRouter.get("/", requirePerm("partner_commissions:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { status, partnerId, from, to } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [];
  if (partnerScoped(cu)) filters.push(eq(partnerCommissions.partnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(partnerCommissions.partnerId, Number(partnerId)));
  if (status) filters.push(eq(partnerCommissions.status, status));
  if (from) filters.push(sql`${partnerCommissions.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${partnerCommissions.createdAt} <= ${new Date(to)}`);
  const where = filters.length ? and(...filters) : undefined;
  const q = db
    .select({
      id: partnerCommissions.id,
      requestId: partnerCommissions.requestId,
      srNumber: requests.srNumber,
      partnerId: partnerCommissions.partnerId,
      partnerName: partners.name,
      customerId: partnerCommissions.customerId,
      customerName: customers.name,
      packageId: partnerCommissions.packageId,
      packageName: packages.name,
      baseAmount: partnerCommissions.baseAmount,
      pct: partnerCommissions.pct,
      amount: partnerCommissions.amount,
      safetyEndsAt: partnerCommissions.safetyEndsAt,
      status: partnerCommissions.status,
      claimId: partnerCommissions.claimId,
      createdAt: partnerCommissions.createdAt,
    })
    .from(partnerCommissions)
    .leftJoin(requests, eq(requests.id, partnerCommissions.requestId))
    .leftJoin(customers, eq(customers.id, partnerCommissions.customerId))
    .leftJoin(partners, eq(partners.id, partnerCommissions.partnerId))
    .leftJoin(packages, eq(packages.id, partnerCommissions.packageId));
  const rows = where
    ? await q.where(where).orderBy(desc(partnerCommissions.createdAt)).limit(500)
    : await q.orderBy(desc(partnerCommissions.createdAt)).limit(500);
  res.json(rows);
});

partnerCommissionsRouter.get("/:id", requirePerm("partner_commissions:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [pc] = await db.select().from(partnerCommissions).where(eq(partnerCommissions.id, id));
  if (!pc) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && pc.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const history = await db
    .select({
      id: partnerCommissionStatusHistory.id,
      fromStatus: partnerCommissionStatusHistory.fromStatus,
      toStatus: partnerCommissionStatusHistory.toStatus,
      reason: partnerCommissionStatusHistory.reason,
      createdAt: partnerCommissionStatusHistory.createdAt,
      userName: users.name,
    })
    .from(partnerCommissionStatusHistory)
    .leftJoin(users, eq(users.id, partnerCommissionStatusHistory.changedByUserId))
    .where(eq(partnerCommissionStatusHistory.partnerCommissionId, id))
    .orderBy(desc(partnerCommissionStatusHistory.createdAt));
  res.json({ commission: pc, history });
});

const transitionInput = z.object({
  toStatus: z.enum(PARTNER_COMMISSION_STATUSES as unknown as [string, ...string[]]),
  reason: z.string().optional().nullable(),
});

partnerCommissionsRouter.post("/:id/transition", requirePerm("partner_commissions:change_status"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = transitionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [pc] = await db.select().from(partnerCommissions).where(eq(partnerCommissions.id, id));
  if (!pc) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && pc.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const result = await transitionPartnerCommission({
    id, toStatus: parsed.data.toStatus as PartnerCommissionStatus, userId: cu.id, reason: parsed.data.reason,
  });
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});

const adjustInput = z.object({
  amount: z.coerce.number().min(0),
  reason: z.string().min(2),
});

partnerCommissionsRouter.post("/:id/adjust", requirePerm("partner_commissions:edit"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = adjustInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    return res.status(403).json({ error: "forbidden" });
  }
  const [pc] = await db.select().from(partnerCommissions).where(eq(partnerCommissions.id, id));
  if (!pc) return res.status(404).json({ error: "not_found" });
  await db.update(partnerCommissions).set({ amount: String(parsed.data.amount), notes: parsed.data.reason, updatedAt: new Date() }).where(eq(partnerCommissions.id, id));
  await db.insert(partnerCommissionStatusHistory).values({
    partnerCommissionId: id, fromStatus: pc.status, toStatus: pc.status, reason: `adjusted to ${parsed.data.amount}: ${parsed.data.reason}`, changedByUserId: cu.id,
  });
  res.json({ ok: true });
});

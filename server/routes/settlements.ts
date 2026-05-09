import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import { settlements, partners, claims, orderPayments, partnerCommissions } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { createSettlement } from "../financial.js";

export const settlementsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

settlementsRouter.get("/", requirePerm("settlements:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { partnerId } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [];
  if (partnerScoped(cu)) filters.push(eq(settlements.partnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(settlements.partnerId, Number(partnerId)));
  const where = filters.length ? and(...filters) : undefined;
  const q = db.select({
    id: settlements.id,
    settlementNumber: settlements.settlementNumber,
    partnerId: settlements.partnerId,
    partnerName: partners.name,
    claimId: settlements.claimId,
    netDueToCompany: settlements.netDueToCompany,
    partnerCommissionTotal: settlements.partnerCommissionTotal,
    finalAmount: settlements.finalAmount,
    direction: settlements.direction,
    completedAt: settlements.completedAt,
    createdAt: settlements.createdAt,
  }).from(settlements).leftJoin(partners, eq(partners.id, settlements.partnerId));
  const rows = where ? await q.where(where).orderBy(desc(settlements.createdAt)).limit(200) : await q.orderBy(desc(settlements.createdAt)).limit(200);
  res.json(rows);
});

settlementsRouter.get("/preview", requirePerm("settlements:view"), async (req, res) => {
  const cu = getUser(req)!;
  const partnerId = partnerScoped(cu) ? cu.partnerId! : Number(req.query.partnerId);
  if (!partnerId) return res.status(400).json({ error: "partner_required" });
  const claimId = req.query.claimId ? Number(req.query.claimId) : null;
  const ops = await db.select().from(orderPayments).where(and(eq(orderPayments.partnerId, partnerId), eq(orderPayments.status, "received_by_company")));
  const netDue = ops.reduce((s, o) => s + Number(o.netDueToCompany), 0);
  let partnerTotal = 0;
  if (claimId) {
    const [c] = await db.select().from(claims).where(eq(claims.id, claimId));
    partnerTotal = c ? Number(c.totalAmount) : 0;
  } else {
    const approved = await db.select().from(partnerCommissions).where(and(eq(partnerCommissions.partnerId, partnerId), eq(partnerCommissions.status, "claim_approved")));
    partnerTotal = approved.reduce((s, p) => s + Number(p.amount), 0);
  }
  const finalAmount = netDue - partnerTotal;
  res.json({ netDue, partnerCommissionTotal: partnerTotal, finalAmount: Math.abs(finalAmount), direction: finalAmount >= 0 ? "partner_to_company" : "company_to_partner", paymentCount: ops.length });
});

settlementsRouter.get("/:id", requirePerm("settlements:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [s] = await db.select().from(settlements).where(eq(settlements.id, id));
  if (!s) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && s.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const payments = await db.select().from(orderPayments).where(eq(orderPayments.settlementId, id));
  const commissions = await db.select().from(partnerCommissions).where(eq(partnerCommissions.settlementId, id));
  res.json({ settlement: s, payments, commissions });
});

const createInput = z.object({
  partnerId: z.coerce.number().int().optional(),
  claimId: z.coerce.number().int().optional(),
  notes: z.string().optional(),
});

settlementsRouter.post("/", requirePerm("settlements:create"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const partnerId = parsed.data.partnerId;
  if (!partnerId) return res.status(400).json({ error: "partner_required" });
  try {
    const r = await createSettlement({ partnerId, claimId: parsed.data.claimId, userId: cu.id, notes: parsed.data.notes });
    res.json(r);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg || "failed" });
  }
});

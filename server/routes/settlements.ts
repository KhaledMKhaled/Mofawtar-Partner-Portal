import { Router } from "express";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  settlements, partners, claims, claimItems, financialItems,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { createSettlement } from "../financial.js";
import { CLAIM_TYPES, type ClaimType } from "../../shared/financial.js";

export const settlementsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}
function isClaimType(v: string | undefined): v is ClaimType {
  return !!v && (CLAIM_TYPES as readonly string[]).includes(v);
}

settlementsRouter.get("/", requirePerm("settlements:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { partnerId, type } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [];
  if (partnerScoped(cu)) filters.push(eq(settlements.partnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(settlements.partnerId, Number(partnerId)));
  if (isClaimType(type)) filters.push(eq(settlements.type, type));
  const where = filters.length ? and(...filters) : undefined;
  const q = db.select({
    id: settlements.id,
    settlementNumber: settlements.settlementNumber,
    type: settlements.type,
    partnerId: settlements.partnerId,
    partnerName: partners.name,
    claimId: settlements.claimId,
    totalAmount: settlements.totalAmount,
    direction: settlements.direction,
    completedAt: settlements.completedAt,
    createdAt: settlements.createdAt,
  }).from(settlements).leftJoin(partners, eq(partners.id, settlements.partnerId));
  const rows = where
    ? await q.where(where).orderBy(desc(settlements.createdAt)).limit(200)
    : await q.orderBy(desc(settlements.createdAt)).limit(200);
  res.json(rows);
});

// Preview = what `createSettlement` would produce for a given claim.
// Each settlement is independent (no netting). Returns the claim's total
// and the direction implied by its type.
settlementsRouter.get("/preview", requirePerm("settlements:view"), async (req, res) => {
  const cu = getUser(req)!;
  const claimId = req.query.claimId ? Number(req.query.claimId) : null;
  if (!claimId) return res.status(400).json({ error: "claim_required" });
  const [c] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!c) return res.status(404).json({ error: "claim_not_found" });
  // Partner-scoped users may only preview their own partner's claims —
  // otherwise they could enumerate other partners' claim totals/types.
  if (partnerScoped(cu) && c.partnerId !== cu.partnerId) {
    return res.status(403).json({ error: "forbidden" });
  }
  const items = await db.select().from(claimItems).where(eq(claimItems.claimId, claimId));
  res.json({
    type: c.type,
    totalAmount: Number(c.totalAmount),
    itemCount: items.length,
    direction: c.type === "payment_claim" ? "partner_to_company"
             : c.type === "partner_commission_claim" ? "company_to_partner"
             : "partner_to_sales",
  });
});

settlementsRouter.get("/:id", requirePerm("settlements:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [s] = await db.select().from(settlements).where(eq(settlements.id, id));
  if (!s) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && s.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const items = await db.select({
    id: financialItems.id,
    type: financialItems.type,
    amount: financialItems.amount,
    status: financialItems.status,
  }).from(claimItems)
    .leftJoin(financialItems, eq(financialItems.id, claimItems.financialItemId))
    .where(eq(claimItems.claimId, s.claimId));
  res.json({ settlement: s, items });
});

const createInput = z.object({
  claimId: z.coerce.number().int(),
  notes: z.string().optional(),
});

settlementsRouter.post("/", requirePerm("settlements:create"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  try {
    const r = await createSettlement({ claimId: parsed.data.claimId, userId: cu.id, notes: parsed.data.notes });
    res.json(r);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg || "failed" });
  }
});

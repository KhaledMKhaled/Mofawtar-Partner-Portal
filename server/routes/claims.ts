import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  claims, claimItems, financialItems,
  partners, customers, packages, users, requests,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { createClaim, approveClaim, rejectClaim, createSettlement } from "../financial.js";
import { CLAIM_TYPES, type ClaimType } from "../../shared/financial.js";

export const claimsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

function isClaimType(v: string | undefined): v is ClaimType {
  return !!v && (CLAIM_TYPES as readonly string[]).includes(v);
}

claimsRouter.get("/", requirePerm("claims:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { status, partnerId, from, to, type } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [];
  if (partnerScoped(cu)) filters.push(eq(claims.partnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(claims.partnerId, Number(partnerId)));
  if (status) filters.push(eq(claims.status, status));
  if (isClaimType(type)) filters.push(eq(claims.type, type));
  if (from) filters.push(sql`${claims.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${claims.createdAt} <= ${new Date(to)}`);
  const where = filters.length ? and(...filters) : undefined;
  const q = db
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      type: claims.type,
      partnerId: claims.partnerId,
      partnerName: partners.name,
      status: claims.status,
      totalAmount: claims.totalAmount,
      approvedAt: claims.approvedAt,
      rejectedAt: claims.rejectedAt,
      settledAt: claims.settledAt,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .leftJoin(partners, eq(partners.id, claims.partnerId));
  const rows = where
    ? await q.where(where).orderBy(desc(claims.createdAt)).limit(200)
    : await q.orderBy(desc(claims.createdAt)).limit(200);
  res.json(rows);
});

// Eligible items for a claim of the given `type`. Returns the rows currently
// sitting at the "ready to be claimed" status for that subject type.
claimsRouter.get("/eligible", requirePerm("claims:view"), async (req, res) => {
  const cu = getUser(req)!;
  const partnerId = partnerScoped(cu) ? cu.partnerId! : Number(req.query.partnerId);
  if (!partnerId) return res.status(400).json({ error: "partner_required" });
  const type = (req.query.type as string | undefined) ?? "partner_commission_claim";
  if (!isClaimType(type)) return res.status(400).json({ error: "invalid_type" });

  const financialType = type === "partner_commission_claim" ? "partner_commission_item" : type === "payment_claim" ? "payment_item" : "sales_commission_item";
  const rows = await db
    .select({
      id: financialItems.id,
      customerName: customers.name,
      packageName: packages.name,
      salesName: users.name,
      amount: financialItems.amount,
      createdAt: financialItems.createdAt,
    })
    .from(financialItems)
    .leftJoin(customers, eq(customers.id, financialItems.relatedCustomerId))
    .leftJoin(packages, eq(packages.id, financialItems.relatedPackageId))
    .leftJoin(users, eq(users.id, financialItems.relatedSalesUserId))
    .where(and(eq(financialItems.relatedPartnerId, partnerId), eq(financialItems.type, financialType), eq(financialItems.status, "not_added_to_claim"), eq(financialItems.isClaimable, true)))
    .orderBy(desc(financialItems.createdAt));
  return res.json(rows);
});

claimsRouter.get("/:id", requirePerm("claims:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [c] = await db.select().from(claims).where(eq(claims.id, id));
  if (!c) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && c.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const items = await db
    .select({
      id: claimItems.id,
      childId: claimItems.financialItemId,
      amount: claimItems.amountSnapshot,
      customerName: customers.name,
      packageName: packages.name,
      salesName: users.name,
      financialType: financialItems.type,
    })
    .from(claimItems)
    .leftJoin(financialItems, eq(financialItems.id, claimItems.financialItemId))
    .leftJoin(customers, eq(customers.id, financialItems.relatedCustomerId))
    .leftJoin(packages, eq(packages.id, financialItems.relatedPackageId))
    .leftJoin(users, eq(users.id, financialItems.relatedSalesUserId))
    .where(eq(claimItems.claimId, id));
  const [approver] = c.approvedBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, c.approvedBy))
    : [{ name: null }];
  res.json({ claim: c, items, approverName: approver?.name ?? null });
});

const createInput = z.object({
  type: z.enum(CLAIM_TYPES),
  partnerId: z.coerce.number().int().optional(),
  itemIds: z.array(z.coerce.number().int()).min(1),
  notes: z.string().optional(),
});

claimsRouter.post("/", requirePerm("claims:create"), async (req, res) => {
  const cu = getUser(req)!;
  // Back-compat: accept the legacy `partnerCommissionIds` field as an alias
  // for `itemIds` so any existing client builds keep working during rollout.
  const body = { ...req.body };
  if (!body.itemIds && Array.isArray(body.partnerCommissionIds)) {
    body.itemIds = body.partnerCommissionIds;
  }
  if (!body.type) body.type = "partner_commission_claim";
  const parsed = createInput.safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const partnerId = partnerScoped(cu) ? cu.partnerId! : (parsed.data.partnerId ?? cu.partnerId ?? 0);
  if (!partnerId) return res.status(400).json({ error: "partner_required" });
  try {
    const result = await createClaim({
      type: parsed.data.type,
      partnerId,
      itemIds: parsed.data.itemIds,
      userId: cu.id,
      notes: parsed.data.notes,
    });
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg || "failed" });
  }
});

claimsRouter.post("/:id/approve", requirePerm("claims:approve"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  try {
    await approveClaim(Number(req.params.id), cu.id);
    res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(409).json({ error: msg });
  }
});

claimsRouter.post("/:id/settle", requirePerm("claims:approve"), async (req, res) => {
  // One-click "settle this claim" — creates the matching settlement bound
  // to the claim. Each settlement is independent (no netting).
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const id = Number(req.params.id);
  try {
    const result = await createSettlement({ claimId: id, userId: cu.id, notes: (req.body?.notes as string | undefined) });
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(409).json({ error: msg });
  }
});

const rejectInput = z.object({ reason: z.string().min(2) });
claimsRouter.post("/:id/reject", requirePerm("claims:reject"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const parsed = rejectInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    await rejectClaim(Number(req.params.id), cu.id, parsed.data.reason);
    res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(409).json({ error: msg });
  }
});

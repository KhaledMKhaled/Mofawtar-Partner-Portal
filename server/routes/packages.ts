import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { packages, packagePartners, commissionRules, partners } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";

export const packagesRouter = Router();

const OPERATION_TYPES = [
  "new_subscription",
  "renewal",
  "upgrade",
  "addon",
  "recurring_payment",
  "other_paid_service",
] as const;

packagesRouter.get("/operation-types", requirePerm("packages:view"), (_req, res) => {
  res.json(OPERATION_TYPES);
});

packagesRouter.get("/", requirePerm("packages:view"), async (_req, res) => {
  const list = await db.select().from(packages).orderBy(desc(packages.createdAt));
  res.json(list);
});

packagesRouter.get("/:id", requirePerm("packages:view"), async (req, res) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(packages).where(eq(packages.id, id));
  if (!p) return res.status(404).json({ error: "not_found" });
  const partnerLinks = await db
    .select({ partnerId: packagePartners.partnerId, partnerName: partners.name })
    .from(packagePartners)
    .innerJoin(partners, eq(partners.id, packagePartners.partnerId))
    .where(eq(packagePartners.packageId, id));
  const rules = await db.select().from(commissionRules).where(eq(commissionRules.packageId, id));
  res.json({ ...p, partners: partnerLinks, commissionRules: rules });
});

const pkgInput = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  itemPriceBeforeTax: z.coerce.number().min(0),
  taxPct: z.coerce.number().min(0).max(100).default(14),
  durationDays: z.coerce.number().int().min(1).default(365),
  packageType: z.string().default("subscription"),
  active: z.boolean().default(true),
  availableForAll: z.boolean().default(true),
  defaultPartnerCommissionPct: z.coerce.number().min(0).max(100).default(0),
  defaultSalesCommissionPct: z.coerce.number().min(0).max(100).default(0),
  partnerIds: z.array(z.coerce.number().int()).optional(),
});

function finalPrice(item: number, tax: number) {
  return Math.round((item + (item * tax) / 100) * 100) / 100;
}

packagesRouter.post("/", requirePerm("packages:create"), async (req, res) => {
  const parsed = pkgInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const d = parsed.data;
  const final = finalPrice(d.itemPriceBeforeTax, d.taxPct);
  const [p] = await db
    .insert(packages)
    .values({
      name: d.name,
      description: d.description ?? null,
      itemPriceBeforeTax: String(d.itemPriceBeforeTax),
      taxPct: String(d.taxPct),
      finalPriceAfterTax: String(final),
      durationDays: d.durationDays,
      packageType: d.packageType,
      active: d.active,
      availableForAll: d.availableForAll,
      defaultPartnerCommissionPct: String(d.defaultPartnerCommissionPct),
      defaultSalesCommissionPct: String(d.defaultSalesCommissionPct),
    })
    .returning();
  const ids = d.partnerIds ?? [];
  if (!d.availableForAll && ids.length) {
    await db.insert(packagePartners).values(ids.map((pid) => ({ packageId: p.id, partnerId: pid })));
  }
  await audit({ userId: cu.id, action: "package.created", entityType: "package", entityId: p.id, newValue: p });
  res.status(201).json(p);
});

packagesRouter.patch("/:id", requirePerm("packages:edit"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = pkgInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(packages).where(eq(packages.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  const d = parsed.data;
  const update: Partial<typeof packages.$inferInsert> = { updatedAt: new Date() };
  const item = d.itemPriceBeforeTax ?? Number(old.itemPriceBeforeTax);
  const tax = d.taxPct ?? Number(old.taxPct);
  if (d.itemPriceBeforeTax !== undefined) update.itemPriceBeforeTax = String(d.itemPriceBeforeTax);
  if (d.taxPct !== undefined) update.taxPct = String(d.taxPct);
  if (d.itemPriceBeforeTax !== undefined || d.taxPct !== undefined) update.finalPriceAfterTax = String(finalPrice(item, tax));
  if (d.name !== undefined) update.name = d.name;
  if (d.description !== undefined) update.description = d.description;
  if (d.durationDays !== undefined) update.durationDays = d.durationDays;
  if (d.packageType !== undefined) update.packageType = d.packageType;
  if (d.active !== undefined) update.active = d.active;
  if (d.availableForAll !== undefined) update.availableForAll = d.availableForAll;
  if (d.defaultPartnerCommissionPct !== undefined)
    update.defaultPartnerCommissionPct = String(d.defaultPartnerCommissionPct);
  if (d.defaultSalesCommissionPct !== undefined)
    update.defaultSalesCommissionPct = String(d.defaultSalesCommissionPct);
  const [p] = await db.update(packages).set(update).where(eq(packages.id, id)).returning();
  // Only touch partner availability links when the client explicitly sent
  // partnerIds — never silently wipe existing assignments.
  if (d.partnerIds !== undefined) {
    await db.delete(packagePartners).where(eq(packagePartners.packageId, id));
    if (!p.availableForAll && d.partnerIds.length) {
      await db.insert(packagePartners).values(d.partnerIds.map((pid) => ({ packageId: id, partnerId: pid })));
    }
  }
  await audit({ userId: cu.id, action: "package.updated", entityType: "package", entityId: id, oldValue: old, newValue: p });
  res.json(p);
});

const ruleInput = z.object({
  packageId: z.coerce.number().int(),
  partnerId: z.coerce.number().int(),
  operationType: z.enum(OPERATION_TYPES),
  partnerCommissionPct: z.coerce.number().min(0).max(100),
  salesCommissionPct: z.coerce.number().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

packagesRouter.get("/:id/commission-rules", requirePerm("packages:view"), async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select({
      id: commissionRules.id,
      packageId: commissionRules.packageId,
      partnerId: commissionRules.partnerId,
      partnerName: partners.name,
      operationType: commissionRules.operationType,
      partnerCommissionPct: commissionRules.partnerCommissionPct,
      salesCommissionPct: commissionRules.salesCommissionPct,
      active: commissionRules.active,
    })
    .from(commissionRules)
    .innerJoin(partners, eq(partners.id, commissionRules.partnerId))
    .where(eq(commissionRules.packageId, id));
  res.json(rows);
});

packagesRouter.post("/:id/commission-rules", requirePerm("packages:edit"), async (req, res) => {
  const parsed = ruleInput.safeParse({ ...req.body, packageId: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const d = parsed.data;
  const [rule] = await db
    .insert(commissionRules)
    .values({
      packageId: d.packageId,
      partnerId: d.partnerId,
      operationType: d.operationType,
      partnerCommissionPct: String(d.partnerCommissionPct),
      salesCommissionPct: String(d.salesCommissionPct),
      active: d.active,
    })
    .returning();
  await audit({ userId: cu.id, action: "commission_rule.created", entityType: "commission_rule", entityId: rule.id, newValue: rule });
  res.status(201).json(rule);
});

packagesRouter.delete("/commission-rules/:ruleId", requirePerm("packages:edit"), async (req, res) => {
  const id = Number(req.params.ruleId);
  const cu = getUser(req)!;
  const [old] = await db.select().from(commissionRules).where(eq(commissionRules.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  await db.delete(commissionRules).where(eq(commissionRules.id, id));
  await audit({ userId: cu.id, action: "commission_rule.deleted", entityType: "commission_rule", entityId: id, oldValue: old });
  res.json({ ok: true });
});

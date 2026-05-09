import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { partners, users, roles } from "../schema.js";
import { eq, desc } from "drizzle-orm";
import { getUser, hashPassword, requirePerm } from "../auth.js";
import { audit } from "../audit.js";

export const partnersRouter = Router();

function isPgError(e: unknown): e is { code: string; detail?: string } {
  return typeof e === "object" && e !== null && "code" in e &&
    typeof (e as { code: unknown }).code === "string";
}

partnersRouter.get("/", requirePerm("partners:view"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.partnerId) {
    const rows = await db.select().from(partners).where(eq(partners.id, cu.partnerId));
    return res.json(rows);
  }
  const list = await db.select().from(partners).orderBy(desc(partners.createdAt));
  res.json(list);
});

partnersRouter.get("/:id", requirePerm("partners:view"), async (req, res) => {
  const cu = getUser(req)!;
  const id = Number(req.params.id);
  if (cu.partnerId && cu.partnerId !== id) return res.status(403).json({ error: "forbidden" });
  const [p] = await db.select().from(partners).where(eq(partners.id, id));
  if (!p) return res.status(404).json({ error: "not_found" });
  res.json(p);
});

const partnerInput = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  address: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
  contractStartDate: z.string().optional().nullable(),
  partnerCommissionPct: z.coerce.number().min(0).max(100).default(0),
  commissionPeriodDays: z.coerce.number().int().min(1).default(30),
  safetyPeriodDays: z.coerce.number().int().min(0).default(14),
  claimCycleType: z.enum(["auto", "manual"]).default("manual"),
  claimCycleDays: z.coerce.number().int().min(1).default(30),
  salesCommissionEnabled: z.boolean().default(false),
  salesCommissionPct: z.coerce.number().min(0).max(100).default(0),
  salesPayoutCycle: z.enum(["monthly", "quarterly"]).default("monthly"),
  ownershipPeriodValue: z.coerce.number().int().min(1).default(3),
  ownershipPeriodUnit: z.enum(["years", "months"]).default("years"),
});

const createPartnerSchema = partnerInput.extend({
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

partnersRouter.post("/", requirePerm("partners:create"), async (req, res) => {
  const parsed = createPartnerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const data = parsed.data;
  const cu = getUser(req)!;

  try {
    const [partner] = await db
      .insert(partners)
      .values({
        name: data.name,
        code: data.code,
        address: data.address ?? null,
        imageUrl: data.imageUrl ?? null,
        status: data.status,
        contractStartDate: data.contractStartDate ? new Date(data.contractStartDate) : null,
        partnerCommissionPct: String(data.partnerCommissionPct),
        commissionPeriodDays: data.commissionPeriodDays,
        safetyPeriodDays: data.safetyPeriodDays,
        claimCycleType: data.claimCycleType,
        claimCycleDays: data.claimCycleDays,
        salesCommissionEnabled: data.salesCommissionEnabled,
        salesCommissionPct: String(data.salesCommissionPct),
        salesPayoutCycle: data.salesPayoutCycle,
        ownershipPeriodValue: data.ownershipPeriodValue,
        ownershipPeriodUnit: data.ownershipPeriodUnit,
      })
      .returning();

    const [adminRole] = await db.select().from(roles).where(eq(roles.key, "partner_admin"));
    if (!adminRole) throw new Error("partner_admin role missing");

    const hash = await hashPassword(data.adminPassword);
    const [adminUser] = await db
      .insert(users)
      .values({
        name: data.adminName,
        email: data.adminEmail.toLowerCase(),
        passwordHash: hash,
        roleId: adminRole.id,
        partnerId: partner.id,
        status: "active",
      })
      .returning();

    await audit({
      userId: cu.id,
      action: "partner.created",
      entityType: "partner",
      entityId: partner.id,
      newValue: partner,
      partnerId: partner.id,
    });
    await audit({
      userId: cu.id,
      action: "user.created",
      entityType: "user",
      entityId: adminUser.id,
      newValue: { id: adminUser.id, email: adminUser.email, role: "partner_admin" },
      partnerId: partner.id,
    });

    res.status(201).json({ partner, adminUser: { id: adminUser.id, email: adminUser.email } });
  } catch (e) {
    if (isPgError(e) && e.code === "23505") return res.status(409).json({ error: "duplicate", detail: e.detail });
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

partnersRouter.patch("/:id", requirePerm("partners:edit"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = partnerInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(partners).where(eq(partners.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  const d = parsed.data;
  const update: Partial<typeof partners.$inferInsert> = { updatedAt: new Date() };
  for (const k of Object.keys(d) as (keyof typeof d)[]) {
    const v = d[k];
    if (v === undefined) continue;
    if (k === "partnerCommissionPct" || k === "salesCommissionPct") {
      (update as Record<string, unknown>)[k] = String(v);
    } else if (k === "contractStartDate") {
      (update as Record<string, unknown>)[k] = v ? new Date(v as string) : null;
    } else {
      (update as Record<string, unknown>)[k] = v;
    }
  }
  const [updated] = await db.update(partners).set(update).where(eq(partners.id, id)).returning();
  await audit({
    userId: cu.id,
    action: "partner.updated",
    entityType: "partner",
    entityId: id,
    oldValue: old,
    newValue: updated,
    partnerId: id,
  });
  res.json(updated);
});

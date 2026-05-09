import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { customerOwnership, customers, partners, users, requests as requestsTbl } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";
import { notify } from "../notify.js";
import { addOwnershipPeriod, getOwnerAt, markExpiredOwnerships } from "../ownership.js";

export const ownershipRouter = Router();

ownershipRouter.get("/", requirePerm("ownership:view"), async (req, res) => {
  const cu = getUser(req)!;
  const filters = [];
  if (req.query.status) filters.push(eq(customerOwnership.status, String(req.query.status)));
  if (req.query.partnerId) filters.push(eq(customerOwnership.partnerId, Number(req.query.partnerId)));
  if (cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    filters.push(eq(customerOwnership.partnerId, cu.partnerId));
  }
  const where = filters.length ? and(...filters) : undefined;
  const baseQuery = db
    .select({
      id: customerOwnership.id,
      customerId: customerOwnership.customerId,
      customerName: customers.name,
      taxCardNumber: customers.taxCardNumber,
      partnerId: customerOwnership.partnerId,
      partnerName: partners.name,
      startDate: customerOwnership.startDate,
      endDate: customerOwnership.endDate,
      status: customerOwnership.status,
      reason: customerOwnership.reason,
      createdAt: customerOwnership.createdAt,
    })
    .from(customerOwnership)
    .leftJoin(customers, eq(customers.id, customerOwnership.customerId))
    .leftJoin(partners, eq(partners.id, customerOwnership.partnerId));
  const rows = where
    ? await baseQuery.where(where).orderBy(desc(customerOwnership.createdAt)).limit(500)
    : await baseQuery.orderBy(desc(customerOwnership.createdAt)).limit(500);
  res.json(rows);
});

// Per-partner ownership summary used by Partner profile.
ownershipRouter.get("/partner/:id/summary", requirePerm("partners:view"), async (req, res) => {
  const partnerId = Number(req.params.id);
  const cu = getUser(req)!;
  if (cu.partnerId && cu.partnerId !== partnerId) return res.status(403).json({ error: "forbidden" });
  const owned = await db
    .select({
      id: customerOwnership.id,
      customerId: customerOwnership.customerId,
      customerName: customers.name,
      taxCardNumber: customers.taxCardNumber,
      startDate: customerOwnership.startDate,
      endDate: customerOwnership.endDate,
      status: customerOwnership.status,
    })
    .from(customerOwnership)
    .innerJoin(customers, eq(customers.id, customerOwnership.customerId))
    .where(eq(customerOwnership.partnerId, partnerId))
    .orderBy(desc(customerOwnership.createdAt));
  const counts = {
    active: owned.filter((o) => o.status === "active" || o.status === "extended").length,
    expired: owned.filter((o) => o.status === "expired").length,
    transferred: owned.filter((o) => o.status === "transferred").length,
    returnedToCompany: owned.filter((o) => o.status === "returned_to_company").length,
    total: owned.length,
  };
  res.json({ counts, owned });
});

// Extend ownership (Super Admin).
const extendInput = z.object({
  reason: z.string().min(2),
  newEndDate: z.string().optional(),
  extendByDays: z.coerce.number().int().min(1).optional(),
});
ownershipRouter.post("/:id/extend", requirePerm("ownership:manage"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = extendInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(customerOwnership).where(eq(customerOwnership.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  let newEnd: Date;
  if (parsed.data.newEndDate) newEnd = new Date(parsed.data.newEndDate);
  else if (parsed.data.extendByDays) newEnd = new Date(old.endDate.getTime() + parsed.data.extendByDays * 86400000);
  else return res.status(400).json({ error: "extension_required" });
  const [updated] = await db
    .update(customerOwnership)
    .set({ endDate: newEnd, status: "extended", reason: parsed.data.reason })
    .where(eq(customerOwnership.id, id))
    .returning();
  await audit({
    userId: cu.id,
    action: "ownership.extended",
    entityType: "ownership",
    entityId: id,
    customerId: old.customerId,
    partnerId: old.partnerId ?? undefined,
    oldValue: old,
    newValue: updated,
    note: parsed.data.reason,
  });
  if (old.partnerId) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.partnerId, old.partnerId));
    for (const a of admins) {
      await notify({
        userId: a.id,
        type: "ownership.extended",
        titleEn: "Ownership extended",
        titleAr: "تم تمديد ملكية العميل",
        entityType: "customer",
        entityId: old.customerId,
        linkPath: `/customers/${old.customerId}`,
      });
    }
  }
  res.json(updated);
});

// Transfer ownership.
const transferInput = z.object({
  toPartnerId: z.coerce.number().int(),
  reason: z.string().min(2),
});
ownershipRouter.post("/:id/transfer", requirePerm("ownership:manage"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = transferInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(customerOwnership).where(eq(customerOwnership.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  const [toPartner] = await db.select().from(partners).where(eq(partners.id, parsed.data.toPartnerId));
  if (!toPartner) return res.status(400).json({ error: "invalid_partner" });
  if (toPartner.id === old.partnerId) return res.status(400).json({ error: "same_partner" });

  // Close current row.
  await db
    .update(customerOwnership)
    .set({ status: "transferred", reason: parsed.data.reason, endDate: new Date() })
    .where(eq(customerOwnership.id, id));
  const start = new Date();
  const end = addOwnershipPeriod(start, toPartner);
  const [created] = await db
    .insert(customerOwnership)
    .values({
      customerId: old.customerId,
      partnerId: toPartner.id,
      startDate: start,
      endDate: end,
      status: "active",
      transferredFromPartnerId: old.partnerId,
      reason: parsed.data.reason,
      createdByUserId: cu.id,
    })
    .returning();
  await audit({
    userId: cu.id,
    action: "ownership.transferred",
    entityType: "ownership",
    entityId: id,
    customerId: old.customerId,
    partnerId: toPartner.id,
    oldValue: old,
    newValue: created,
    note: parsed.data.reason,
  });
  // Notify both partners.
  const partnerIds = [old.partnerId, toPartner.id].filter((p): p is number => p != null);
  for (const pid of partnerIds) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.partnerId, pid));
    for (const a of admins) {
      await notify({
        userId: a.id,
        type: "ownership.transferred",
        titleEn: "Ownership transferred",
        titleAr: "تم نقل ملكية العميل",
        entityType: "customer",
        entityId: old.customerId,
        linkPath: `/customers/${old.customerId}`,
      });
    }
  }
  res.json(created);
});

ownershipRouter.post("/housekeep", requirePerm("ownership:manage"), async (_req, res) => {
  const result = await markExpiredOwnerships();
  res.json(result);
});

ownershipRouter.get("/customer/:id/current", requirePerm("customers:view"), async (req, res) => {
  const cu = getUser(req)!;
  const customerId = Number(req.params.id);
  // Partner-scoped users may only probe customers their partner has either
  // owned or has a request for.
  if (cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    const [hasOwner] = await db
      .select({ id: customerOwnership.id })
      .from(customerOwnership)
      .where(and(eq(customerOwnership.customerId, customerId), eq(customerOwnership.partnerId, cu.partnerId)))
      .limit(1);
    if (!hasOwner) {
      const [hasReq] = await db
        .select({ id: requestsTbl.id })
        .from(requestsTbl)
        .where(and(eq(requestsTbl.customerId, customerId), eq(requestsTbl.partnerId, cu.partnerId)))
        .limit(1);
      if (!hasReq) return res.status(403).json({ error: "forbidden" });
    }
  }
  const owner = await getOwnerAt(customerId);
  res.json(owner);
});

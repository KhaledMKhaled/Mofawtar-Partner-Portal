import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { users, roles, partners } from "../schema.js";
import { getUser, hashPassword, requirePerm } from "../auth.js";
import { audit } from "../audit.js";

export const usersRouter = Router();

const baseSelect = {
  id: users.id,
  name: users.name,
  email: users.email,
  status: users.status,
  imageUrl: users.imageUrl,
  address: users.address,
  roleId: users.roleId,
  roleKey: roles.key,
  roleNameEn: roles.nameEn,
  roleNameAr: roles.nameAr,
  partnerId: users.partnerId,
  partnerName: partners.name,
  teamLeaderId: users.teamLeaderId,
  createdAt: users.createdAt,
};

usersRouter.get("/", requirePerm("users:view"), async (req, res) => {
  const cu = getUser(req)!;
  const partnerFilter = cu.roleKey.startsWith("partner_") || cu.roleKey === "team_leader" || cu.roleKey === "sales"
    ? cu.partnerId
    : req.query.partnerId
      ? Number(req.query.partnerId)
      : null;

  const where = partnerFilter ? eq(users.partnerId, partnerFilter) : undefined;
  const rows = await db
    .select(baseSelect)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(partners, eq(partners.id, users.partnerId))
    .where(where as any)
    .orderBy(desc(users.createdAt));
  res.json(rows);
});

const userInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  roleId: z.coerce.number().int(),
  partnerId: z.coerce.number().int().optional().nullable(),
  teamLeaderId: z.coerce.number().int().optional().nullable(),
  address: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
});

usersRouter.post("/", requirePerm("users:create"), async (req, res) => {
  const parsed = userInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const d = parsed.data;
  if (!d.password) return res.status(400).json({ error: "password_required" });

  // Partner Admin can only create users inside their own partner.
  let partnerId = d.partnerId ?? null;
  if (cu.roleKey === "partner_admin") partnerId = cu.partnerId!;

  // Look up role to enforce scoping
  const [role] = await db.select().from(roles).where(eq(roles.id, d.roleId));
  if (!role) return res.status(400).json({ error: "invalid_role" });
  if (role.scope === "partner" && !partnerId) return res.status(400).json({ error: "partner_required" });
  if (role.scope === "company") partnerId = null;

  // Partner Admin cannot create company-scoped users
  if (cu.roleKey === "partner_admin" && role.scope !== "partner") {
    return res.status(403).json({ error: "forbidden_role" });
  }

  try {
    const hash = await hashPassword(d.password);
    const [u] = await db
      .insert(users)
      .values({
        name: d.name,
        email: d.email.toLowerCase(),
        passwordHash: hash,
        roleId: d.roleId,
        partnerId,
        teamLeaderId: d.teamLeaderId ?? null,
        address: d.address ?? null,
        imageUrl: d.imageUrl ?? null,
        status: d.status,
      })
      .returning();
    await audit({
      userId: cu.id,
      action: "user.created",
      entityType: "user",
      entityId: u.id,
      newValue: { id: u.id, email: u.email, roleId: u.roleId, partnerId: u.partnerId },
      partnerId: u.partnerId ?? undefined,
    });
    res.status(201).json(u);
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "email_taken" });
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

usersRouter.patch("/:id", requirePerm("users:edit"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = userInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(users).where(eq(users.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  if (cu.roleKey === "partner_admin" && old.partnerId !== cu.partnerId)
    return res.status(403).json({ error: "forbidden" });

  const d = parsed.data;
  // If a new roleId is being set, validate scope and partner-admin restrictions
  if (d.roleId !== undefined) {
    const [newRole] = await db.select().from(roles).where(eq(roles.id, d.roleId));
    if (!newRole) return res.status(400).json({ error: "invalid_role" });
    if (cu.roleKey === "partner_admin" && newRole.scope !== "partner") {
      return res.status(403).json({ error: "forbidden_role" });
    }
  }
  const update: any = { updatedAt: new Date() };
  for (const k of ["name", "email", "roleId", "address", "imageUrl", "status", "teamLeaderId"] as const) {
    if ((d as any)[k] !== undefined) update[k] = (d as any)[k];
  }
  if (d.email) update.email = d.email.toLowerCase();
  if (d.password) update.passwordHash = await hashPassword(d.password);
  // partnerId is locked for partner-scoped users
  if (cu.roleKey === "company_super_admin" && d.partnerId !== undefined) update.partnerId = d.partnerId;

  const [u] = await db.update(users).set(update).where(eq(users.id, id)).returning();
  await audit({
    userId: cu.id,
    action: "user.updated",
    entityType: "user",
    entityId: id,
    oldValue: { ...old, passwordHash: undefined },
    newValue: { ...u, passwordHash: undefined },
    partnerId: u.partnerId ?? undefined,
  });
  res.json(u);
});

usersRouter.get("/team-leaders", requirePerm("users:view"), async (req, res) => {
  const cu = getUser(req)!;
  const partnerId = cu.partnerId ?? Number(req.query.partnerId);
  if (!partnerId) return res.json([]);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.partnerId, partnerId), eq(roles.key, "team_leader")));
  res.json(rows);
});

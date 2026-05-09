import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db.js";
import { users, roles, partners } from "../schema.js";
import { getUser, hashPassword, requirePerm } from "../auth.js";
import { audit } from "../audit.js";

export const usersRouter = Router();

// Partner Admin can only assign these partner-scoped roles when creating or
// editing users (cannot create another partner_admin or any company role).
const PARTNER_ADMIN_ASSIGNABLE_ROLES = new Set([
  "partner_accountant",
  "team_leader",
  "sales",
]);

function isPgError(e: unknown): e is { code: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
}

// Alias for self-join to fetch the team leader's name.
const teamLeaders = alias(users, "team_leaders");

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
  teamLeaderName: teamLeaders.name,
  createdAt: users.createdAt,
};

usersRouter.get("/", requirePerm("users:view"), async (req, res) => {
  const cu = getUser(req)!;
  const partnerFilter = cu.roleKey.startsWith("partner_") || cu.roleKey === "team_leader" || cu.roleKey === "sales"
    ? cu.partnerId
    : req.query.partnerId
      ? Number(req.query.partnerId)
      : null;

  const baseQuery = db
    .select(baseSelect)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(partners, eq(partners.id, users.partnerId))
    .leftJoin(teamLeaders, eq(teamLeaders.id, users.teamLeaderId));
  const rows = partnerFilter
    ? await baseQuery.where(eq(users.partnerId, partnerFilter)).orderBy(desc(users.createdAt))
    : await baseQuery.orderBy(desc(users.createdAt));
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

  // Partner Admin can only create the explicitly allowed partner-scoped roles
  // (Partner Accountant, Team Leader, Sales) — never another Partner Admin
  // and never company-scoped roles.
  if (cu.roleKey === "partner_admin" && !PARTNER_ADMIN_ASSIGNABLE_ROLES.has(role.key)) {
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
  } catch (e) {
    if (isPgError(e) && e.code === "23505") return res.status(409).json({ error: "email_taken" });
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

  // Prevent any user from changing their own role or deactivating themselves.
  if (cu.id === id) {
    if (d.roleId !== undefined && d.roleId !== old.roleId)
      return res.status(403).json({ error: "cannot_change_own_role" });
    if (d.status !== undefined && d.status !== old.status)
      return res.status(403).json({ error: "cannot_change_own_status" });
  }

  // If a new roleId is being set, validate scope and partner-admin restrictions
  if (d.roleId !== undefined) {
    const [newRole] = await db.select().from(roles).where(eq(roles.id, d.roleId));
    if (!newRole) return res.status(400).json({ error: "invalid_role" });
    if (cu.roleKey === "partner_admin" && !PARTNER_ADMIN_ASSIGNABLE_ROLES.has(newRole.key)) {
      return res.status(403).json({ error: "forbidden_role" });
    }
  }
  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (d.name !== undefined) update.name = d.name;
  if (d.email !== undefined) update.email = d.email.toLowerCase();
  if (d.roleId !== undefined) update.roleId = d.roleId;
  if (d.address !== undefined) update.address = d.address;
  if (d.imageUrl !== undefined) update.imageUrl = d.imageUrl;
  if (d.status !== undefined) update.status = d.status;
  if (d.teamLeaderId !== undefined) update.teamLeaderId = d.teamLeaderId;
  if (d.password) update.passwordHash = await hashPassword(d.password);
  // partnerId is locked for partner-scoped users
  if (cu.roleKey === "company_super_admin" && d.partnerId !== undefined) update.partnerId = d.partnerId;

  let u: typeof users.$inferSelect;
  try {
    [u] = await db.update(users).set(update).where(eq(users.id, id)).returning();
  } catch (e) {
    if (isPgError(e) && e.code === "23505") return res.status(409).json({ error: "email_taken" });
    throw e;
  }
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

// Sales reps assignable by the current actor when creating a Draft SR.
// Team leaders see only their direct reports; partner admins see all sales
// in their partner; company users may pass ?partnerId=. Permission gate is
// `requests:create` so team leaders can resolve assignees without `users:view`.
usersRouter.get("/sales-assignable", requirePerm("requests:create"), async (req, res) => {
  const cu = getUser(req)!;
  let partnerId: number | null = cu.partnerId ?? null;
  if (!partnerId && req.query.partnerId) partnerId = Number(req.query.partnerId);
  if (!partnerId) return res.json([]);
  const filters = [eq(users.partnerId, partnerId), eq(roles.key, "sales")];
  if (cu.roleKey === "team_leader") filters.push(eq(users.teamLeaderId, cu.id));
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(...filters))
    .orderBy(users.name);
  res.json(rows);
});

usersRouter.get("/team-leaders", requirePerm("users:create"), async (req, res) => {
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

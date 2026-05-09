import { Router } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { roles, users } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";
import { ACTIONS, MODULES } from "../../shared/permissions.js";

export const rolesRouter = Router();

function isPgError(e: unknown): e is { code: string } {
  return typeof e === "object" && e !== null && "code" in e &&
    typeof (e as { code: unknown }).code === "string";
}

rolesRouter.get("/meta", requirePerm("roles:view"), (_req, res) => {
  res.json({ modules: MODULES, actions: ACTIONS });
});

rolesRouter.get("/", requirePerm("roles:view"), async (_req, res) => {
  const rows = await db
    .select({
      id: roles.id,
      key: roles.key,
      nameEn: roles.nameEn,
      nameAr: roles.nameAr,
      scope: roles.scope,
      isSystem: roles.isSystem,
      permissions: roles.permissions,
      userCount: sql<number>`(SELECT COUNT(*)::int FROM ${users} WHERE ${users.roleId} = ${roles.id})`,
    })
    .from(roles)
    .orderBy(roles.id);
  res.json(rows);
});

const roleInput = z.object({
  key: z.string().min(2),
  nameEn: z.string().min(2),
  nameAr: z.string().min(2),
  scope: z.enum(["company", "partner"]),
  permissions: z.array(z.string()).default([]),
});

rolesRouter.post("/", requirePerm("roles:create"), async (req, res) => {
  const parsed = roleInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  try {
    const [r] = await db.insert(roles).values({ ...parsed.data, isSystem: false }).returning();
    await audit({ userId: cu.id, action: "role.created", entityType: "role", entityId: r.id, newValue: r });
    res.status(201).json(r);
  } catch (e) {
    if (isPgError(e) && e.code === "23505") return res.status(409).json({ error: "duplicate_key" });
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

rolesRouter.patch("/:id", requirePerm("roles:edit"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = roleInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(roles).where(eq(roles.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  // Allow editing permissions on system roles, but not key/scope renames
  const update: Partial<typeof roles.$inferInsert> = {};
  if (!old.isSystem) {
    if (parsed.data.key) update.key = parsed.data.key;
    if (parsed.data.scope) update.scope = parsed.data.scope;
  }
  if (parsed.data.nameEn) update.nameEn = parsed.data.nameEn;
  if (parsed.data.nameAr) update.nameAr = parsed.data.nameAr;
  if (parsed.data.permissions) update.permissions = parsed.data.permissions;
  const [r] = await db.update(roles).set(update).where(eq(roles.id, id)).returning();
  await audit({ userId: cu.id, action: "role.updated", entityType: "role", entityId: id, oldValue: old, newValue: r });
  res.json(r);
});

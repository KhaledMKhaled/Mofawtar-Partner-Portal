import { Router } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import { auditLog, users } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";

export const auditLogRouter = Router();

auditLogRouter.get("/", requirePerm("audit_log:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { action, entityType, partnerId, q, from, to } = req.query as Record<string, string | undefined>;
  const filters: any[] = [];
  if (cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    filters.push(eq(auditLog.partnerId, cu.partnerId));
  } else if (partnerId) {
    filters.push(eq(auditLog.partnerId, Number(partnerId)));
  }
  if (action) filters.push(ilike(auditLog.action, `%${action}%`));
  if (entityType) filters.push(eq(auditLog.entityType, entityType));
  if (q) filters.push(or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.note, `%${q}%`))!);
  if (from) filters.push(sql`${auditLog.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${auditLog.createdAt} <= ${new Date(to)}`);
  const where = filters.length ? and(...filters) : undefined;
  const baseQ = db.select({
    id: auditLog.id,
    userId: auditLog.userId,
    userName: users.name,
    action: auditLog.action,
    entityType: auditLog.entityType,
    entityId: auditLog.entityId,
    note: auditLog.note,
    partnerId: auditLog.partnerId,
    customerId: auditLog.customerId,
    requestId: auditLog.requestId,
    oldValue: auditLog.oldValue,
    newValue: auditLog.newValue,
    createdAt: auditLog.createdAt,
  }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId));
  const rows = where ? await baseQ.where(where).orderBy(desc(auditLog.createdAt)).limit(500) : await baseQ.orderBy(desc(auditLog.createdAt)).limit(500);
  res.json(rows);
});

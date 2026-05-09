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

auditLogRouter.get("/export.csv", requirePerm("audit_log:view"), async (req, res) => {
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
    id: auditLog.id, userName: users.name, action: auditLog.action,
    entityType: auditLog.entityType, entityId: auditLog.entityId, note: auditLog.note,
    partnerId: auditLog.partnerId, customerId: auditLog.customerId, requestId: auditLog.requestId,
    createdAt: auditLog.createdAt,
  }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId));
  const rows = where ? await baseQ.where(where).orderBy(desc(auditLog.createdAt)).limit(5000) : await baseQ.orderBy(desc(auditLog.createdAt)).limit(5000);
  const headers = ["id","createdAt","userName","action","entityType","entityId","partnerId","customerId","requestId","note"];
  const esc = (v: unknown) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc((r as Record<string, unknown>)[h])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log.csv"`);
  res.send(csv);
});

import { Router } from "express";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db.js";
import { auditLog, users } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";

export const auditLogRouter = Router();

function buildFilters(req: import("express").Request, cu: NonNullable<ReturnType<typeof getUser>>): SQL | undefined {
  const { action, entityType, partnerId, customerId, requestId, userId, q, from, to } = req.query as Record<string, string | undefined>;
  const filters: SQL[] = [];
  if (cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    filters.push(eq(auditLog.partnerId, cu.partnerId));
  } else if (partnerId) {
    filters.push(eq(auditLog.partnerId, Number(partnerId)));
  }
  if (customerId) filters.push(eq(auditLog.customerId, Number(customerId)));
  if (requestId) filters.push(eq(auditLog.requestId, Number(requestId)));
  if (userId) filters.push(eq(auditLog.userId, Number(userId)));
  if (action) filters.push(ilike(auditLog.action, `%${action}%`));
  if (entityType) filters.push(eq(auditLog.entityType, entityType));
  if (q) filters.push(or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.note, `%${q}%`))!);
  if (from) filters.push(sql`${auditLog.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${auditLog.createdAt} <= ${new Date(to)}`);
  return filters.length ? and(...filters) : undefined;
}

auditLogRouter.get("/", requirePerm("audit_log:view"), async (req, res) => {
  const cu = getUser(req)!;
  const where = buildFilters(req, cu);
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

async function fetchExportRows(req: import("express").Request) {
  const cu = getUser(req)!;
  const where = buildFilters(req, cu);
  const baseQ = db.select({
    id: auditLog.id, userName: users.name, action: auditLog.action,
    entityType: auditLog.entityType, entityId: auditLog.entityId, note: auditLog.note,
    partnerId: auditLog.partnerId, customerId: auditLog.customerId, requestId: auditLog.requestId,
    createdAt: auditLog.createdAt,
  }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId));
  return where
    ? await baseQ.where(where).orderBy(desc(auditLog.createdAt)).limit(5000)
    : await baseQ.orderBy(desc(auditLog.createdAt)).limit(5000);
}

const EXPORT_HEADERS = ["id","createdAt","userName","action","entityType","entityId","partnerId","customerId","requestId","note"] as const;

auditLogRouter.get("/export.csv", requirePerm("audit_log:view"), async (req, res) => {
  const rows = await fetchExportRows(req);
  const esc = (v: unknown) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
  const csv = [EXPORT_HEADERS.join(","), ...rows.map((r) => EXPORT_HEADERS.map((h) => esc((r as Record<string, unknown>)[h])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log.csv"`);
  res.send(csv);
});

auditLogRouter.get("/export.xlsx", requirePerm("audit_log:view"), async (req, res) => {
  const rows = await fetchExportRows(req);
  const data = rows.map((r) => Object.fromEntries(EXPORT_HEADERS.map((h) => [h, (r as Record<string, unknown>)[h] ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data, { header: [...EXPORT_HEADERS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "AuditLog");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log.xlsx"`);
  res.send(buf);
});

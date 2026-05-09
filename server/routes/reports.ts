import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  orderPayments, partnerCommissions, salesCommissions, claims, requests, customers, partners, packages, customerOwnership, users,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import * as XLSX from "xlsx";

export const reportsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

const REPORTS = [
  "payments_summary",
  "partner_commissions_summary",
  "sales_commissions_summary",
  "claims_summary",
  "requests_summary",
  "ownership_summary",
] as const;
type ReportKey = (typeof REPORTS)[number];

interface ReportFilters {
  partnerId?: number;
  from?: string;
  to?: string;
  status?: string;
  salesUserId?: number;
  packageId?: number;
  operationType?: string;
}
import type { SQL } from "drizzle-orm";
async function fetchReport(key: ReportKey, f: ReportFilters): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const { partnerId, from, to, status, salesUserId, packageId, operationType } = f;
  const dateFilter = (col: SQL.Aliased | typeof requests.createdAt): SQL[] => {
    const fs: SQL[] = [];
    if (from) fs.push(sql`${col} >= ${new Date(from)}`);
    if (to) fs.push(sql`${col} <= ${new Date(to)}`);
    return fs;
  };
  switch (key) {
    case "payments_summary": {
      const filters: SQL[] = [...dateFilter(orderPayments.createdAt as unknown as SQL.Aliased)];
      if (partnerId) filters.push(eq(orderPayments.partnerId, partnerId));
      if (status) filters.push(eq(orderPayments.status, status));
      if (packageId) filters.push(eq(orderPayments.packageId, packageId));
      const where = filters.length ? and(...filters) : undefined;
      const q = db.select({
        id: orderPayments.id,
        partnerName: partners.name,
        customerName: customers.name,
        packageName: packages.name,
        gross: orderPayments.grossAmount,
        net: orderPayments.netAmount,
        commission: orderPayments.partnerCommissionAmount,
        netDue: orderPayments.netDueToCompany,
        status: orderPayments.status,
        createdAt: orderPayments.createdAt,
      }).from(orderPayments)
        .leftJoin(partners, eq(partners.id, orderPayments.partnerId))
        .leftJoin(customers, eq(customers.id, orderPayments.customerId))
        .leftJoin(packages, eq(packages.id, orderPayments.packageId));
      const rows = where ? await q.where(where).orderBy(desc(orderPayments.createdAt)).limit(2000) : await q.orderBy(desc(orderPayments.createdAt)).limit(2000);
      return { headers: ["id","partner","customer","package","gross","net","commission","netDue","status","createdAt"], rows: rows.map((r) => ({
        id: r.id, partner: r.partnerName, customer: r.customerName, package: r.packageName,
        gross: r.gross, net: r.net, commission: r.commission, netDue: r.netDue, status: r.status, createdAt: r.createdAt,
      })) };
    }
    case "partner_commissions_summary": {
      const filters: SQL[] = [...dateFilter(partnerCommissions.createdAt as unknown as SQL.Aliased)];
      if (partnerId) filters.push(eq(partnerCommissions.partnerId, partnerId));
      if (status) filters.push(eq(partnerCommissions.status, status));
      if (packageId) filters.push(eq(partnerCommissions.packageId, packageId));
      const where = filters.length ? and(...filters) : undefined;
      const q = db.select({
        id: partnerCommissions.id,
        partnerName: partners.name,
        customerName: customers.name,
        packageName: packages.name,
        baseAmount: partnerCommissions.baseAmount,
        pct: partnerCommissions.pct,
        amount: partnerCommissions.amount,
        status: partnerCommissions.status,
        createdAt: partnerCommissions.createdAt,
      }).from(partnerCommissions)
        .leftJoin(partners, eq(partners.id, partnerCommissions.partnerId))
        .leftJoin(customers, eq(customers.id, partnerCommissions.customerId))
        .leftJoin(packages, eq(packages.id, partnerCommissions.packageId));
      const raw = where ? await q.where(where).orderBy(desc(partnerCommissions.createdAt)).limit(2000) : await q.orderBy(desc(partnerCommissions.createdAt)).limit(2000);
      const rows = raw.map((r) => ({ id: r.id, partner: r.partnerName, customer: r.customerName, package: r.packageName, baseAmount: r.baseAmount, pct: r.pct, amount: r.amount, status: r.status, createdAt: r.createdAt }));
      return { headers: ["id","partner","customer","package","baseAmount","pct","amount","status","createdAt"], rows };
    }
    case "sales_commissions_summary": {
      const filters: SQL[] = [...dateFilter(salesCommissions.createdAt as unknown as SQL.Aliased)];
      if (partnerId) filters.push(eq(salesCommissions.partnerId, partnerId));
      if (status) filters.push(eq(salesCommissions.status, status));
      if (salesUserId) filters.push(eq(salesCommissions.salesUserId, salesUserId));
      if (packageId) filters.push(eq(salesCommissions.packageId, packageId));
      const where = filters.length ? and(...filters) : undefined;
      const q = db.select({
        id: salesCommissions.id,
        partnerName: partners.name,
        salesName: users.name,
        customerName: customers.name,
        packageName: packages.name,
        amount: salesCommissions.amount,
        pct: salesCommissions.pct,
        status: salesCommissions.status,
        createdAt: salesCommissions.createdAt,
      }).from(salesCommissions)
        .leftJoin(partners, eq(partners.id, salesCommissions.partnerId))
        .leftJoin(users, eq(users.id, salesCommissions.salesUserId))
        .leftJoin(customers, eq(customers.id, salesCommissions.customerId))
        .leftJoin(packages, eq(packages.id, salesCommissions.packageId));
      const raw = where ? await q.where(where).orderBy(desc(salesCommissions.createdAt)).limit(2000) : await q.orderBy(desc(salesCommissions.createdAt)).limit(2000);
      const rows = raw.map((r) => ({ id: r.id, partner: r.partnerName, sales: r.salesName, customer: r.customerName, package: r.packageName, pct: r.pct, amount: r.amount, status: r.status, createdAt: r.createdAt }));
      return { headers: ["id","partner","sales","customer","package","pct","amount","status","createdAt"], rows };
    }
    case "claims_summary": {
      const filters: SQL[] = [...dateFilter(claims.createdAt as unknown as SQL.Aliased)];
      if (partnerId) filters.push(eq(claims.partnerId, partnerId));
      if (status) filters.push(eq(claims.status, status));
      const where = filters.length ? and(...filters) : undefined;
      const q = db.select({
        id: claims.id, claimNumber: claims.claimNumber,
        partnerName: partners.name, status: claims.status, totalAmount: claims.totalAmount,
        autoGenerated: claims.autoGenerated, createdAt: claims.createdAt,
      }).from(claims).leftJoin(partners, eq(partners.id, claims.partnerId));
      const raw = where ? await q.where(where).orderBy(desc(claims.createdAt)).limit(2000) : await q.orderBy(desc(claims.createdAt)).limit(2000);
      const rows = raw.map((r) => ({ id: r.id, claimNumber: r.claimNumber, partner: r.partnerName, status: r.status, totalAmount: r.totalAmount, autoGenerated: r.autoGenerated, createdAt: r.createdAt }));
      return { headers: ["id","claimNumber","partner","status","totalAmount","autoGenerated","createdAt"], rows };
    }
    case "requests_summary": {
      const filters: SQL[] = [...dateFilter(requests.createdAt)];
      if (partnerId) filters.push(eq(requests.partnerId, partnerId));
      if (status) filters.push(eq(requests.status, status));
      if (operationType) filters.push(eq(requests.operationType, operationType));
      if (salesUserId) filters.push(eq(requests.salesUserId, salesUserId));
      if (packageId) filters.push(eq(requests.packageId, packageId));
      const where = filters.length ? and(...filters) : undefined;
      const q = db.select({
        id: requests.id, srNumber: requests.srNumber,
        partnerName: partners.name, customerName: customers.name, packageName: packages.name,
        operationType: requests.operationType, status: requests.status, createdAt: requests.createdAt,
      }).from(requests)
        .leftJoin(partners, eq(partners.id, requests.partnerId))
        .leftJoin(customers, eq(customers.id, requests.customerId))
        .leftJoin(packages, eq(packages.id, requests.packageId));
      const raw = where ? await q.where(where).orderBy(desc(requests.createdAt)).limit(2000) : await q.orderBy(desc(requests.createdAt)).limit(2000);
      const rows = raw.map((r) => ({ id: r.id, srNumber: r.srNumber, partner: r.partnerName, customer: r.customerName, package: r.packageName, operationType: r.operationType, status: r.status, createdAt: r.createdAt }));
      return { headers: ["id","srNumber","partner","customer","package","operationType","status","createdAt"], rows };
    }
    case "ownership_summary": {
      const filters: SQL[] = [];
      if (partnerId) filters.push(eq(customerOwnership.partnerId, partnerId));
      if (status) filters.push(eq(customerOwnership.status, status));
      const where = filters.length ? and(...filters) : undefined;
      const q = db.select({
        id: customerOwnership.id,
        partnerName: partners.name,
        customerName: customers.name,
        startDate: customerOwnership.startDate,
        endDate: customerOwnership.endDate,
        status: customerOwnership.status,
      }).from(customerOwnership)
        .leftJoin(partners, eq(partners.id, customerOwnership.partnerId))
        .leftJoin(customers, eq(customers.id, customerOwnership.customerId));
      const raw = where ? await q.where(where).orderBy(desc(customerOwnership.createdAt)).limit(2000) : await q.orderBy(desc(customerOwnership.createdAt)).limit(2000);
      const rows = raw.map((r) => ({ id: r.id, partner: r.partnerName, customer: r.customerName, startDate: r.startDate, endDate: r.endDate, status: r.status }));
      return { headers: ["id","partner","customer","startDate","endDate","status"], rows };
    }
  }
}

function readFilters(req: import("express").Request, cu: ReturnType<typeof getUser>): ReportFilters {
  const u = cu!;
  return {
    partnerId: partnerScoped(u) ? u.partnerId! : (req.query.partnerId ? Number(req.query.partnerId) : undefined),
    from: (req.query.from as string) || undefined,
    to: (req.query.to as string) || undefined,
    status: (req.query.status as string) || undefined,
    salesUserId: req.query.salesUserId ? Number(req.query.salesUserId) : undefined,
    packageId: req.query.packageId ? Number(req.query.packageId) : undefined,
    operationType: (req.query.operationType as string) || undefined,
  };
}

// NOTE: /dashboard/kpis is registered BEFORE /:key so the literal segment
// "dashboard" is not captured by the dynamic route.
reportsRouter.get("/dashboard/kpis", async (req, res) => {
  if (!getUser(req)) return res.status(401).json({ error: "unauthorized" });
  return dashboardKpisHandler(req, res);
});

reportsRouter.get("/:key", requirePerm("reports:view"), async (req, res) => {
  const key = req.params.key as ReportKey;
  if (!REPORTS.includes(key)) return res.status(404).json({ error: "unknown_report" });
  const cu = getUser(req)!;
  const data = await fetchReport(key, readFilters(req, cu));
  res.json(data);
});

reportsRouter.get("/:key/export.xlsx", requirePerm("reports:export"), async (req, res) => {
  const key = req.params.key as ReportKey;
  if (!REPORTS.includes(key)) return res.status(404).json({ error: "unknown_report" });
  const cu = getUser(req)!;
  const data = await fetchReport(key, readFilters(req, cu));
  const ws = XLSX.utils.json_to_sheet(data.rows, { header: data.headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, key.slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${key}.xlsx"`);
  res.send(buf);
});

reportsRouter.get("/:key/export.pdf", requirePerm("reports:export"), async (req, res) => {
  const key = req.params.key as ReportKey;
  if (!REPORTS.includes(key)) return res.status(404).json({ error: "unknown_report" });
  const cu = getUser(req)!;
  const data = await fetchReport(key, readFilters(req, cu));
  // Real PDF binary using pdfkit (not an HTML print fallback).
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${key}.pdf"`);
  doc.pipe(res);
  doc.fillColor("#4046B5").fontSize(16).text(key.replace(/_/g, " ").toUpperCase());
  doc.moveDown(0.2).fillColor("#5b6478").fontSize(9).text(`Generated ${new Date().toLocaleString()} · ${data.rows.length} rows`);
  doc.moveDown(0.6);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = data.headers.length > 0 ? pageWidth / data.headers.length : pageWidth;
  const drawRow = (cells: string[], opts: { header?: boolean } = {}) => {
    const startX = doc.page.margins.left;
    const y = doc.y;
    if (opts.header) doc.fillColor("#4046B5").fontSize(9);
    else doc.fillColor("#0F1115").fontSize(8);
    let maxH = 0;
    cells.forEach((c, i) => {
      const h = doc.heightOfString(c, { width: colW - 4 });
      if (h > maxH) maxH = h;
    });
    cells.forEach((c, i) => {
      doc.text(c, startX + i * colW + 2, y + 2, { width: colW - 4 });
    });
    doc.moveTo(startX, y + maxH + 6).lineTo(startX + pageWidth, y + maxH + 6).strokeColor("#e5e7eb").stroke();
    doc.y = y + maxH + 8;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
  };
  drawRow(data.headers.map(String), { header: true });
  for (const r of data.rows) {
    drawRow(data.headers.map((h) => String((r as Record<string, unknown>)[h] ?? "")));
  }
  doc.end();
});

// Aggregate KPIs for the dashboard, role-tailored.
// Dashboard KPIs are visible to every authenticated user; the response is
// role-tailored server-side so each role only sees cards they have permission
// to act on. Registered above with /dashboard/kpis literal precedence.
async function dashboardKpisHandler(req: import("express").Request, res: import("express").Response) {
  const cu = getUser(req)!;
  const scoped = partnerScoped(cu);
  const partnerFilter = scoped ? sql`partner_id = ${cu.partnerId}` : sql`TRUE`;

  type Card = { key: string; label: string; value: number; format: "money" | "count"; tone?: "violet"|"success"|"warning"|"danger" };
  const cards: Card[] = [];

  const exec1 = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> => {
    const result = await db.execute(query);
    const rows = (result as unknown as { rows: T[] }).rows ?? (result as unknown as T[]);
    return (rows[0] ?? {}) as T;
  };

  // Payments
  const paymentsAgg = await exec1<{ pending_count: string; net_total: string }>(sql`
    SELECT COUNT(*) FILTER (WHERE status NOT IN ('settled','refunded','cancelled'))::text AS pending_count,
           COALESCE(SUM(net_due_to_company) FILTER (WHERE status NOT IN ('settled','refunded','cancelled')),0)::text AS net_total
    FROM order_payments WHERE ${partnerFilter}`);

  const pcAgg = await exec1<{ safety_total: string; eligible_total: string; eligible_count: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN status='in_safety_period' THEN amount ELSE 0 END),0)::text AS safety_total,
           COALESCE(SUM(CASE WHEN status='eligible_for_claim' THEN amount ELSE 0 END),0)::text AS eligible_total,
           COUNT(*) FILTER (WHERE status='eligible_for_claim')::text AS eligible_count
    FROM partner_commissions WHERE ${partnerFilter}`);

  const scAgg = await exec1<{ open_total: string; paid_ytd: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN status NOT IN ('paid','rejected') THEN amount ELSE 0 END),0)::text AS open_total,
           COALESCE(SUM(CASE WHEN status='paid' AND created_at >= date_trunc('year', NOW()) THEN amount ELSE 0 END),0)::text AS paid_ytd
    FROM sales_commissions WHERE ${partnerFilter}`);

  const claimsAgg = await exec1<{ open_count: string }>(sql`
    SELECT COUNT(*) FILTER (WHERE status='draft')::text AS open_count
    FROM claims WHERE ${partnerFilter}`);

  const settlAgg = await exec1<{ ready_total: string }>(sql`
    SELECT COALESCE(SUM(amount) FILTER (WHERE status='ready_for_settlement'),0)::text AS ready_total
    FROM partner_commissions WHERE ${partnerFilter}`);

  const reqAgg = await exec1<{ active_count: string; activated_month: string }>(sql`
    SELECT COUNT(*) FILTER (WHERE status NOT IN ('activated','rejected','failed'))::text AS active_count,
           COUNT(*) FILTER (WHERE status='activated' AND activated_at >= date_trunc('month', NOW()))::text AS activated_month
    FROM requests WHERE ${partnerFilter}`);
  const revAgg = await exec1<{ revenue_month: string }>(sql`
    SELECT COALESCE(SUM(gross_amount) FILTER (WHERE created_at >= date_trunc('month', NOW())),0)::text AS revenue_month
    FROM order_payments WHERE ${partnerFilter}`);

  const ownAgg = await exec1<{ expiring_soon: string }>(sql`
    SELECT COUNT(*) FILTER (WHERE status IN ('active','extended') AND end_date <= NOW() + INTERVAL '30 days' AND end_date > NOW())::text AS expiring_soon
    FROM customer_ownership WHERE ${partnerFilter}`);

  const num = (s: string | undefined | null) => Number(s ?? 0) || 0;

  if (cu.roleKey === "company_super_admin" || cu.roleKey === "company_accountant") {
    const partnersCount = await exec1<{ c: string }>(sql`SELECT COUNT(*)::text AS c FROM partners WHERE status='active'`);
    cards.push({ key: "total_partners", label: "Partners", value: num(partnersCount.c), format: "count" });
  }
  cards.push(
    { key: "active_requests", label: "Active requests", value: num(reqAgg.active_count), format: "count" },
    { key: "activated_this_month", label: "Activated this month", value: num(reqAgg.activated_month), format: "count", tone: "success" },
    { key: "revenue_this_month", label: "Revenue this month", value: num(revAgg.revenue_month), format: "money", tone: "violet" },
    { key: "pending_payments", label: "Pending payments", value: num(paymentsAgg.net_total), format: "money", tone: "warning" },
    { key: "partner_commissions_pending", label: "Commissions in safety", value: num(pcAgg.safety_total), format: "money" },
    { key: "partner_commissions_eligible", label: "Commissions eligible", value: num(pcAgg.eligible_total), format: "money", tone: "success" },
    { key: "open_claims", label: "Open claims", value: num(claimsAgg.open_count), format: "count", tone: "warning" },
    { key: "pending_settlements", label: "Pending settlements", value: num(settlAgg.ready_total), format: "money", tone: "warning" },
    { key: "ownership_expiring_soon", label: "Ownership expiring soon", value: num(ownAgg.expiring_soon), format: "count", tone: num(ownAgg.expiring_soon) > 0 ? "danger" : "violet" },
  );
  if (cu.roleKey === "team_leader" || cu.roleKey === "sales") {
    cards.push({ key: "sales_commissions_open", label: "Sales open", value: num(scAgg.open_total), format: "money" });
    cards.push({ key: "sales_commissions_paid_ytd", label: "Sales paid YTD", value: num(scAgg.paid_ytd), format: "money", tone: "success" });
  }

  res.json({ cards });
}

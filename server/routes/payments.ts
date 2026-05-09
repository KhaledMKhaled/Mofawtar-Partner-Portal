import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  orderPayments, orderPaymentStatusHistory, customers, partners, packages, requests, users,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { transitionOrderPayment } from "../financial.js";
import { ORDER_PAYMENT_STATUSES, type OrderPaymentStatus } from "../../shared/financial.js";

export const paymentsRouter = Router();

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

paymentsRouter.get("/", requirePerm("payments:view"), async (req, res) => {
  const cu = getUser(req)!;
  const { status, partnerId, from, to } = req.query as Record<string, string | undefined>;
  const filters: any[] = [];
  if (partnerScoped(cu)) filters.push(eq(orderPayments.partnerId, cu.partnerId!));
  else if (partnerId) filters.push(eq(orderPayments.partnerId, Number(partnerId)));
  if (status) filters.push(eq(orderPayments.status, status));
  if (from) filters.push(sql`${orderPayments.createdAt} >= ${new Date(from)}`);
  if (to) filters.push(sql`${orderPayments.createdAt} <= ${new Date(to)}`);
  const where = filters.length ? and(...filters) : undefined;
  const baseQuery = db
    .select({
      id: orderPayments.id,
      requestId: orderPayments.requestId,
      srNumber: requests.srNumber,
      partnerId: orderPayments.partnerId,
      partnerName: partners.name,
      customerId: orderPayments.customerId,
      customerName: customers.name,
      taxCardNumber: customers.taxCardNumber,
      packageId: orderPayments.packageId,
      packageName: packages.name,
      grossAmount: orderPayments.grossAmount,
      netAmount: orderPayments.netAmount,
      partnerCommissionAmount: orderPayments.partnerCommissionAmount,
      netDueToCompany: orderPayments.netDueToCompany,
      status: orderPayments.status,
      receivedAt: orderPayments.receivedAt,
      settledAt: orderPayments.settledAt,
      createdAt: orderPayments.createdAt,
    })
    .from(orderPayments)
    .leftJoin(requests, eq(requests.id, orderPayments.requestId))
    .leftJoin(customers, eq(customers.id, orderPayments.customerId))
    .leftJoin(partners, eq(partners.id, orderPayments.partnerId))
    .leftJoin(packages, eq(packages.id, orderPayments.packageId));
  const rows = where
    ? await baseQuery.where(where).orderBy(desc(orderPayments.createdAt)).limit(500)
    : await baseQuery.orderBy(desc(orderPayments.createdAt)).limit(500);
  res.json(rows);
});

paymentsRouter.get("/:id", requirePerm("payments:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [op] = await db
    .select()
    .from(orderPayments)
    .where(eq(orderPayments.id, id));
  if (!op) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && op.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const history = await db
    .select({
      id: orderPaymentStatusHistory.id,
      fromStatus: orderPaymentStatusHistory.fromStatus,
      toStatus: orderPaymentStatusHistory.toStatus,
      reason: orderPaymentStatusHistory.reason,
      createdAt: orderPaymentStatusHistory.createdAt,
      userName: users.name,
    })
    .from(orderPaymentStatusHistory)
    .leftJoin(users, eq(users.id, orderPaymentStatusHistory.changedByUserId))
    .where(eq(orderPaymentStatusHistory.orderPaymentId, id))
    .orderBy(desc(orderPaymentStatusHistory.createdAt));
  res.json({ payment: op, history });
});

const transitionInput = z.object({
  toStatus: z.enum(ORDER_PAYMENT_STATUSES as unknown as [string, ...string[]]),
  reason: z.string().optional().nullable(),
});

paymentsRouter.post("/:id/transition", requirePerm("payments:change_status"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = transitionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [op] = await db.select().from(orderPayments).where(eq(orderPayments.id, id));
  if (!op) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && op.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });

  // Partner-side users can only progress through partner-side statuses (held_by_partner → net_amount_due_to_company).
  // Company-side statuses (received_by_company, settled) are restricted to company users.
  const companyOnly = ["received_by_company", "settled"];
  if (companyOnly.includes(parsed.data.toStatus) && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    return res.status(403).json({ error: "forbidden" });
  }
  const result = await transitionOrderPayment({
    id, toStatus: parsed.data.toStatus as OrderPaymentStatus, userId: cu.id, reason: parsed.data.reason,
  });
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});

paymentsRouter.get("/summary/totals", requirePerm("payments:view"), async (req, res) => {
  const cu = getUser(req)!;
  const where = partnerScoped(cu) ? eq(orderPayments.partnerId, cu.partnerId!) : undefined;
  const rows = where
    ? await db
        .select({ status: orderPayments.status, count: sql<number>`COUNT(*)::int`, total: sql<string>`COALESCE(SUM(net_due_to_company),0)::text` })
        .from(orderPayments).where(where).groupBy(orderPayments.status)
    : await db
        .select({ status: orderPayments.status, count: sql<number>`COUNT(*)::int`, total: sql<string>`COALESCE(SUM(net_due_to_company),0)::text` })
        .from(orderPayments).groupBy(orderPayments.status);
  res.json(rows);
});

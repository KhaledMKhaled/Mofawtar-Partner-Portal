import { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
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
  const filters: SQL[] = [];
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

paymentsRouter.get("/:id(\\d+)", requirePerm("payments:view"), async (req, res) => {
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

paymentsRouter.post("/:id(\\d+)/transition", requirePerm("payments:change_status"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = transitionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [op] = await db.select().from(orderPayments).where(eq(orderPayments.id, id));
  if (!op) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && op.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });

  // Company-side statuses (received_by_company, settled) are restricted
  // to company users AND are claim-gated: the normal path is via
  // settlement of an approved claim, which auto-transitions the payment.
  // A direct call to either of these statuses is therefore treated as a
  // MANUAL OVERRIDE and requires the dedicated permission.
  const claimGated = ["received_by_company", "settled"];
  if (claimGated.includes(parsed.data.toStatus)) {
    if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
      return res.status(403).json({ error: "forbidden", detail: "company_users_only" });
    }
    if (!cu.permissions?.includes("payments:manual_override")) {
      return res.status(403).json({
        error: "forbidden",
        detail: "manual_override_required",
        hint: "هذا الانتقال يحدث تلقائياً عند تسوية المطالبة. للاستثناء استخدم صلاحية التجاوز اليدوي.",
      });
    }
  }
  const result = await transitionOrderPayment({
    id,
    toStatus: parsed.data.toStatus as OrderPaymentStatus,
    userId: cu.id,
    reason: parsed.data.reason,
    viaManualOverride: claimGated.includes(parsed.data.toStatus),
  });
  if (!result.ok) return res.status(409).json(result);
  res.json({ ok: true });
});


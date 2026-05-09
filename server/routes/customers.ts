import { Router } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  customers,
  customerOwnership,
  partners,
  requests,
  packages,
  users,
  requestStatusHistory,
  requestReassignments,
  auditLog,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { getOwnerAt } from "../ownership.js";

export const customersRouter = Router();

// List / search customers. Permission scoping:
// - Company users see all customers.
// - Partner-scoped users see customers their partner currently owns
//   (active/extended ownership) or has ever owned.
customersRouter.get("/", requirePerm("customers:view"), async (req, res) => {
  const cu = getUser(req)!;
  const q = String(req.query.q ?? "").trim();
  const baseSelect = {
    id: customers.id,
    taxCardNumber: customers.taxCardNumber,
    name: customers.name,
    contactPerson: customers.contactPerson,
    contactPhone: customers.contactPhone,
    email: customers.email,
    createdAt: customers.createdAt,
  };

  const filters = [];
  if (q) {
    filters.push(
      or(
        ilike(customers.name, `%${q}%`),
        ilike(customers.taxCardNumber, `%${q}%`),
      )!,
    );
  }
  if (cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") {
    filters.push(
      sql`EXISTS (SELECT 1 FROM customer_ownership o WHERE o.customer_id = ${customers.id} AND o.partner_id = ${cu.partnerId})`,
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const rows = where
    ? await db.select(baseSelect).from(customers).where(where).orderBy(desc(customers.createdAt)).limit(200)
    : await db.select(baseSelect).from(customers).orderBy(desc(customers.createdAt)).limit(200);
  res.json(rows);
});

// Customer 360 detail.
customersRouter.get("/:id", requirePerm("customers:view"), async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) return res.status(404).json({ error: "not_found" });
  const cu = getUser(req)!;

  const owners = await db
    .select({
      id: customerOwnership.id,
      partnerId: customerOwnership.partnerId,
      partnerName: partners.name,
      startDate: customerOwnership.startDate,
      endDate: customerOwnership.endDate,
      status: customerOwnership.status,
      reason: customerOwnership.reason,
      transferredFromPartnerId: customerOwnership.transferredFromPartnerId,
      createdAt: customerOwnership.createdAt,
    })
    .from(customerOwnership)
    .leftJoin(partners, eq(partners.id, customerOwnership.partnerId))
    .where(eq(customerOwnership.customerId, id))
    .orderBy(desc(customerOwnership.createdAt));

  const currentOwner = await getOwnerAt(id);
  // Permission scoping: partner-scoped users may only view a customer
  // their partner has owned or currently owns.
  if (
    cu.partnerId &&
    cu.roleKey !== "company_super_admin" &&
    cu.roleKey !== "company_accountant" &&
    !owners.some((o) => o.partnerId === cu.partnerId)
  ) {
    return res.status(403).json({ error: "forbidden" });
  }

  const reqs = await db
    .select({
      id: requests.id,
      srNumber: requests.srNumber,
      status: requests.status,
      operationType: requests.operationType,
      partnerId: requests.partnerId,
      partnerName: partners.name,
      packageId: requests.packageId,
      packageName: packages.name,
      salesUserId: requests.salesUserId,
      salesName: users.name,
      paymentStatus: requests.paymentStatus,
      activatedAt: requests.activatedAt,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .leftJoin(partners, eq(partners.id, requests.partnerId))
    .leftJoin(packages, eq(packages.id, requests.packageId))
    .leftJoin(users, eq(users.id, requests.salesUserId))
    .where(eq(requests.customerId, id))
    .orderBy(desc(requests.createdAt));

  const timeline = await db
    .select({
      id: requestStatusHistory.id,
      requestId: requestStatusHistory.requestId,
      fromStatus: requestStatusHistory.fromStatus,
      toStatus: requestStatusHistory.toStatus,
      reason: requestStatusHistory.reason,
      createdAt: requestStatusHistory.createdAt,
      changedByUserId: requestStatusHistory.changedByUserId,
      userName: users.name,
    })
    .from(requestStatusHistory)
    .leftJoin(users, eq(users.id, requestStatusHistory.changedByUserId))
    .where(
      sql`${requestStatusHistory.requestId} IN (SELECT id FROM requests WHERE customer_id = ${id})`,
    )
    .orderBy(desc(requestStatusHistory.createdAt))
    .limit(200);

  const reassignments = await db
    .select({
      id: requestReassignments.id,
      requestId: requestReassignments.requestId,
      fromSalesUserId: requestReassignments.fromSalesUserId,
      toSalesUserId: requestReassignments.toSalesUserId,
      reason: requestReassignments.reason,
      createdAt: requestReassignments.createdAt,
      byUserName: users.name,
    })
    .from(requestReassignments)
    .leftJoin(users, eq(users.id, requestReassignments.byUserId))
    .where(
      sql`${requestReassignments.requestId} IN (SELECT id FROM requests WHERE customer_id = ${id})`,
    )
    .orderBy(desc(requestReassignments.createdAt))
    .limit(100);

  const auditRows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      note: auditLog.note,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.customerId, id))
    .orderBy(desc(auditLog.createdAt))
    .limit(100);

  res.json({
    customer: c,
    currentOwner,
    ownership: owners,
    requests: reqs,
    timeline,
    reassignments,
    audit: auditRows,
  });
});

import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  customers,
  customerOwnership,
  packages,
  partners,
  requests,
  requestReassignments,
  requestStatusHistory,
  users,
  roles,
  packagePartners,
} from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";
import { notify } from "../notify.js";
import {
  ALLOWED_TRANSITIONS,
  OPERATION_TYPES,
  REOPEN_TARGETS,
  formatSrNumber,
  isAllowedTransition,
  type OperationType,
  type RequestStatus,
} from "../../shared/requests.js";
import { getOwnerAt, getLatestOwnership, hasPreviousActivation, startOwnership } from "../ownership.js";

export const requestsRouter = Router();

const TAX_RE = /^\d{9,15}$/;

function isPgError(e: unknown): e is { code: string; detail?: string } {
  return typeof e === "object" && e !== null && "code" in e &&
    typeof (e as { code: unknown }).code === "string";
}

const STATUS_TITLES: Record<string, { en: string; ar: string }> = {
  "request.submitted": { en: "Request submitted", ar: "تم إرسال الطلب" },
  "request.received": { en: "Request received", ar: "تم استلام الطلب" },
  "request.under_activation": { en: "Request under activation", ar: "الطلب قيد التفعيل" },
  "request.activated": { en: "Request activated", ar: "تم تفعيل الطلب" },
  "request.rejected": { en: "Request rejected", ar: "تم رفض الطلب" },
  "request.failed": { en: "Request failed", ar: "فشل الطلب" },
  "request.reopened": { en: "Request reopened", ar: "تم إعادة فتح الطلب" },
  "request.reassigned": { en: "Request reassigned", ar: "تم إعادة إسناد الطلب" },
};

// ---------- Helpers ----------

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

async function nextSrNumber(taxCardNumber: string, when: Date): Promise<string> {
  const base = formatSrNumber(taxCardNumber, when);
  const dupes = await db
    .select({ srNumber: requests.srNumber })
    .from(requests)
    .where(ilike(requests.srNumber, `${base}%`));
  if (!dupes.find((d) => d.srNumber === base)) return base;
  // find next NN suffix
  const taken = new Set(dupes.map((d) => d.srNumber));
  for (let i = 1; i < 100; i++) {
    const candidate = `${base}-${String(i).padStart(2, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("sr_number_collision_overflow");
}

async function notifyRequestStatus(
  requestId: number,
  type:
    | "request.submitted"
    | "request.received"
    | "request.under_activation"
    | "request.activated"
    | "request.rejected"
    | "request.failed"
    | "request.reopened"
    | "request.reassigned",
  partnerId: number,
  customerId: number,
) {
  const titles = STATUS_TITLES[type];
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      sql`(${roles.key} IN ('company_super_admin','company_accountant')) OR (${users.partnerId} = ${partnerId} AND ${roles.key} IN ('partner_admin','partner_accountant'))`
    );
  for (const r of recipients) {
    await notify({
      userId: r.id,
      type,
      titleEn: titles.en,
      titleAr: titles.ar,
      entityType: "request",
      entityId: requestId,
      linkPath: `/requests/${requestId}`,
    });
  }
  // Also notify the assigned sales user when known.
  const [reqRow] = await db.select({ salesUserId: requests.salesUserId, teamLeaderId: requests.teamLeaderId }).from(requests).where(eq(requests.id, requestId));
  if (reqRow?.salesUserId) {
    await notify({
      userId: reqRow.salesUserId,
      type,
      titleEn: titles.en,
      titleAr: titles.ar,
      entityType: "request",
      entityId: requestId,
      linkPath: `/requests/${requestId}`,
    });
  }
  if (reqRow?.teamLeaderId && reqRow.teamLeaderId !== reqRow.salesUserId) {
    await notify({
      userId: reqRow.teamLeaderId,
      type,
      titleEn: titles.en,
      titleAr: titles.ar,
      entityType: "request",
      entityId: requestId,
      linkPath: `/requests/${requestId}`,
    });
  }
  // Suppress unused param warning while keeping signature ergonomic.
  void customerId;
}

// ---------- Tax-card lookup with ownership and duplicate checks ----------

requestsRouter.get("/lookup/:tax", requirePerm("requests:view"), async (req, res) => {
  const tax = String(req.params.tax || "").trim();
  if (!TAX_RE.test(tax)) return res.status(400).json({ error: "invalid_tax_card" });
  const cu = getUser(req)!;

  const [cust] = await db.select().from(customers).where(eq(customers.taxCardNumber, tax));
  if (!cust) return res.json({ found: false });

  const owner = await getOwnerAt(cust.id);
  const latest = await getLatestOwnership(cust.id);
  // Active in-progress request under any partner blocks duplicates.
  const inProgress = await db
    .select({
      id: requests.id,
      srNumber: requests.srNumber,
      status: requests.status,
      partnerId: requests.partnerId,
      partnerName: partners.name,
    })
    .from(requests)
    .leftJoin(partners, eq(partners.id, requests.partnerId))
    .where(
      and(
        eq(requests.customerId, cust.id),
        inArray(requests.status, ["draft_sr", "new_request", "received", "under_activation"]),
      )
    );

  // Decide eligibility for the current actor.
  let canCreate = true;
  let blockReason: string | null = null;

  if (inProgress.length > 0) {
    canCreate = false;
    blockReason = "duplicate_active_request";
  } else if (
    owner && owner.partnerId &&
    (owner.status === "active" || owner.status === "extended") &&
    owner.partnerId !== cu.partnerId
  ) {
    // Active ownership by another partner blocks creation for ALL roles.
    canCreate = false;
    blockReason = "owned_by_other_partner";
  } else if (
    partnerScoped(cu) &&
    latest && (latest.status === "expired" || latest.status === "returned_to_company")
  ) {
    // Released back to the company — partner users cannot create without a
    // company action; company users may proceed.
    canCreate = false;
    blockReason = "owned_by_company_only";
  }

  // Partner-scoped users may not see PII for customers they don't own and have
  // never had a request for — return only minimal gating metadata.
  let exposedCustomer: typeof cust | { id: number; taxCardNumber: string } = cust;
  if (partnerScoped(cu)) {
    const [hasReq] = await db
      .select({ id: requests.id })
      .from(requests)
      .where(and(eq(requests.customerId, cust.id), eq(requests.partnerId, cu.partnerId!)))
      .limit(1);
    const ownsNow = owner && owner.partnerId === cu.partnerId;
    if (!hasReq && !ownsNow) {
      exposedCustomer = { id: cust.id, taxCardNumber: cust.taxCardNumber };
    }
  }

  res.json({
    found: true,
    customer: exposedCustomer,
    currentOwner: owner,
    activeRequests: inProgress,
    canCreate,
    blockReason,
  });
});

// ---------- Step 2: create/update Customer + Draft SR ----------

const customerInput = z.object({
  taxCardNumber: z.string().regex(TAX_RE),
  name: z.string().min(2),
  nameOnTaxCard: z.string().optional().nullable(),
  commercialRegistry: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  primaryPhone: z.string().optional().nullable(),
  primaryPhoneWhatsapp: z.boolean().optional(),
  altPhone: z.string().optional().nullable(),
  altPhoneWhatsapp: z.boolean().optional(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  address: z.string().optional().nullable(),
  taxOffice: z.string().optional().nullable(),
  businessActivity: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const draftInput = z.object({
  customer: customerInput,
  partnerId: z.coerce.number().int().optional(),
  salesUserId: z.coerce.number().int().optional(),
});

requestsRouter.post("/draft", requirePerm("requests:create"), async (req, res) => {
  const parsed = draftInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const d = parsed.data;

  // Resolve partnerId
  let partnerId: number | null = cu.partnerId ?? null;
  if (!partnerId && d.partnerId) partnerId = d.partnerId;
  if (!partnerId) return res.status(400).json({ error: "partner_required" });

  // Resolve sales user. Sales acts on themselves; TL must pick one of their sales reps; PA can choose any sales user in their partner.
  let salesUserId: number | null = null;
  let teamLeaderId: number | null = null;
  if (cu.roleKey === "sales") {
    salesUserId = cu.id;
    teamLeaderId = cu.teamLeaderId ?? null;
  } else if (
    cu.roleKey === "team_leader" ||
    cu.roleKey === "partner_admin" ||
    cu.roleKey === "company_super_admin" ||
    cu.roleKey === "company_accountant"
  ) {
    // All higher-than-sales roles must explicitly assign the request to a real,
    // active sales rep belonging to the chosen partner. Server-side guard so
    // direct API calls cannot route the request to a non-sales / inactive user.
    if (!d.salesUserId) return res.status(400).json({ error: "sales_user_required" });
    const [s] = await db
      .select({
        id: users.id,
        partnerId: users.partnerId,
        teamLeaderId: users.teamLeaderId,
        status: users.status,
        roleKey: roles.key,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, d.salesUserId));
    if (!s || s.partnerId !== partnerId || s.roleKey !== "sales" || s.status !== "active") {
      return res.status(403).json({ error: "invalid_sales_user" });
    }
    // Team leaders are responsible only for their own direct reports.
    if (cu.roleKey === "team_leader" && s.teamLeaderId !== cu.id) {
      return res.status(403).json({ error: "invalid_sales_user" });
    }
    salesUserId = s.id;
    teamLeaderId = cu.roleKey === "team_leader" ? cu.id : s.teamLeaderId;
  }

  // Tax card ownership / duplicate gate
  const [existingCustomer] = await db.select().from(customers).where(eq(customers.taxCardNumber, d.customer.taxCardNumber));
  if (existingCustomer) {
    const inProgress = await db
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.customerId, existingCustomer.id),
          inArray(requests.status, ["draft_sr", "new_request", "received", "under_activation"]),
        )
      );
    if (inProgress.length > 0) return res.status(409).json({ error: "duplicate_active_request" });
    const owner = await getOwnerAt(existingCustomer.id);
    const latest = await getLatestOwnership(existingCustomer.id);
    if (
      owner && owner.partnerId &&
      (owner.status === "active" || owner.status === "extended") &&
      owner.partnerId !== partnerId
    ) {
      // Active ownership by another partner blocks creation for ALL roles.
      return res.status(409).json({ error: "owned_by_other_partner" });
    }
    if (
      partnerScoped(cu) &&
      latest && (latest.status === "expired" || latest.status === "returned_to_company")
    ) {
      return res.status(409).json({ error: "owned_by_company_only" });
    }
  }

  // Upsert customer
  let customer;
  if (existingCustomer) {
    const [updated] = await db
      .update(customers)
      .set({
        name: d.customer.name,
        nameOnTaxCard: d.customer.nameOnTaxCard ?? existingCustomer.nameOnTaxCard,
        commercialRegistry: d.customer.commercialRegistry ?? existingCustomer.commercialRegistry,
        nationalId: d.customer.nationalId ?? existingCustomer.nationalId,
        contactPerson: d.customer.contactPerson ?? existingCustomer.contactPerson,
        contactPhone: d.customer.contactPhone ?? existingCustomer.contactPhone,
        primaryPhone: d.customer.primaryPhone ?? existingCustomer.primaryPhone,
        primaryPhoneWhatsapp: d.customer.primaryPhoneWhatsapp ?? existingCustomer.primaryPhoneWhatsapp,
        altPhone: d.customer.altPhone ?? existingCustomer.altPhone,
        altPhoneWhatsapp: d.customer.altPhoneWhatsapp ?? existingCustomer.altPhoneWhatsapp,
        email: d.customer.email || existingCustomer.email,
        address: d.customer.address ?? existingCustomer.address,
        taxOffice: d.customer.taxOffice ?? existingCustomer.taxOffice,
        businessActivity: d.customer.businessActivity ?? existingCustomer.businessActivity,
        notes: d.customer.notes ?? existingCustomer.notes,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, existingCustomer.id))
      .returning();
    customer = updated;
  } else {
    try {
      const [inserted] = await db
        .insert(customers)
        .values({
          taxCardNumber: d.customer.taxCardNumber,
          name: d.customer.name,
          nameOnTaxCard: d.customer.nameOnTaxCard ?? null,
          commercialRegistry: d.customer.commercialRegistry ?? null,
          nationalId: d.customer.nationalId ?? null,
          contactPerson: d.customer.contactPerson ?? null,
          contactPhone: d.customer.contactPhone ?? null,
          primaryPhone: d.customer.primaryPhone ?? null,
          primaryPhoneWhatsapp: d.customer.primaryPhoneWhatsapp ?? false,
          altPhone: d.customer.altPhone ?? null,
          altPhoneWhatsapp: d.customer.altPhoneWhatsapp ?? false,
          email: d.customer.email || null,
          address: d.customer.address ?? null,
          taxOffice: d.customer.taxOffice ?? null,
          businessActivity: d.customer.businessActivity ?? null,
          notes: d.customer.notes ?? null,
        })
        .returning();
      customer = inserted;
    } catch (e) {
      if (isPgError(e) && e.code === "23505") return res.status(409).json({ error: "duplicate_customer" });
      throw e;
    }
  }

  // Create the Draft SR.
  const now = new Date();
  const sr = await nextSrNumber(d.customer.taxCardNumber, now);
  const [draft] = await db
    .insert(requests)
    .values({
      srNumber: sr,
      customerId: customer.id,
      partnerId,
      salesUserId,
      teamLeaderId,
      status: "draft_sr",
      paymentStatus: "pending_collection_confirmation",
      createdByUserId: cu.id,
    })
    .returning();
  await db.insert(requestStatusHistory).values({
    requestId: draft.id,
    fromStatus: null,
    toStatus: "draft_sr",
    changedByUserId: cu.id,
  });
  await audit({
    userId: cu.id,
    action: "request.draft_created",
    entityType: "request",
    entityId: draft.id,
    customerId: customer.id,
    partnerId,
    requestId: draft.id,
    newValue: draft,
  });

  res.status(201).json({ customer, request: draft });
});

// ---------- Step 3: pick package + collection confirmation ----------

const packageInput = z.object({
  packageId: z.coerce.number().int(),
  operationType: z.enum(OPERATION_TYPES),
  realReceiptNumber: z.string().optional().nullable(),
  collectionConfirmed: z.boolean().default(false),
});

requestsRouter.patch("/:id/package", requirePerm("requests:create"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = packageInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(requests).where(eq(requests.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  if (old.status !== "draft_sr") return res.status(409).json({ error: "not_a_draft" });
  if (cu.partnerId && old.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });

  // Validate operation type vs customer history.
  const d = parsed.data;
  const previouslyActivated = await hasPreviousActivation(old.customerId, old.partnerId);
  if (d.operationType === "new_subscription" && previouslyActivated) {
    return res.status(409).json({ error: "operation_not_allowed_history" });
  }
  if (d.operationType === "renewal" && !previouslyActivated) {
    return res.status(409).json({ error: "operation_requires_history" });
  }

  // Validate package availability for this partner.
  const [pkg] = await db.select().from(packages).where(eq(packages.id, d.packageId));
  if (!pkg || !pkg.active) return res.status(400).json({ error: "invalid_package" });
  if (!pkg.availableForAll) {
    const [link] = await db
      .select()
      .from(packagePartners)
      .where(and(eq(packagePartners.packageId, d.packageId), eq(packagePartners.partnerId, old.partnerId)));
    if (!link) return res.status(403).json({ error: "package_not_available_for_partner" });
  }

  const update: Partial<typeof requests.$inferInsert> = {
    packageId: d.packageId,
    operationType: d.operationType,
    realReceiptNumber: d.realReceiptNumber ?? null,
    paymentStatus: d.collectionConfirmed ? "collected_by_sales" : "pending_collection_confirmation",
    updatedAt: new Date(),
  };
  const [updated] = await db.update(requests).set(update).where(eq(requests.id, id)).returning();
  await audit({
    userId: cu.id,
    action: "request.draft_updated",
    entityType: "request",
    entityId: id,
    requestId: id,
    customerId: old.customerId,
    partnerId: old.partnerId,
    oldValue: old,
    newValue: updated,
  });
  res.json(updated);
});

// ---------- Step 4: submit ----------

requestsRouter.post("/:id/submit", requirePerm("requests:create"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [old] = await db.select().from(requests).where(eq(requests.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  if (cu.partnerId && old.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  if (old.status !== "draft_sr") return res.status(409).json({ error: "not_a_draft" });
  if (!old.packageId || !old.operationType) return res.status(400).json({ error: "package_required" });
  if (old.paymentStatus !== "collected_by_sales") return res.status(400).json({ error: "collection_required" });

  const [updated] = await db
    .update(requests)
    .set({ status: "new_request", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(requests.id, id))
    .returning();
  await db.insert(requestStatusHistory).values({
    requestId: id,
    fromStatus: "draft_sr",
    toStatus: "new_request",
    changedByUserId: cu.id,
  });
  await audit({
    userId: cu.id,
    action: "request.submitted",
    entityType: "request",
    entityId: id,
    requestId: id,
    customerId: old.customerId,
    partnerId: old.partnerId,
    oldValue: { status: "draft_sr" },
    newValue: { status: "new_request" },
  });
  await notifyRequestStatus(id, "request.submitted", old.partnerId, old.customerId);
  res.json(updated);
});

// ---------- List + filters ----------

requestsRouter.get("/", requirePerm("requests:view"), async (req, res) => {
  const cu = getUser(req)!;
  const filters = [];
  if (req.query.status) filters.push(eq(requests.status, String(req.query.status)));
  if (req.query.partnerId) filters.push(eq(requests.partnerId, Number(req.query.partnerId)));
  if (req.query.salesUserId) filters.push(eq(requests.salesUserId, Number(req.query.salesUserId)));
  if (req.query.packageId) filters.push(eq(requests.packageId, Number(req.query.packageId)));
  if (req.query.operationType) filters.push(eq(requests.operationType, String(req.query.operationType)));
  if (req.query.fromDate) {
    const d = new Date(String(req.query.fromDate));
    if (!Number.isNaN(d.getTime())) filters.push(sql`${requests.createdAt} >= ${d}`);
  }
  if (req.query.toDate) {
    const d = new Date(String(req.query.toDate));
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      filters.push(sql`${requests.createdAt} <= ${d}`);
    }
  }
  if (req.query.q) {
    const q = `%${String(req.query.q)}%`;
    filters.push(or(
      ilike(requests.srNumber, q),
      ilike(customers.name, q),
      ilike(customers.taxCardNumber, q),
      ilike(users.name, q),
      ilike(partners.name, q),
    )!);
  }
  if (partnerScoped(cu)) {
    filters.push(eq(requests.partnerId, cu.partnerId!));
    if (cu.roleKey === "sales") filters.push(eq(requests.salesUserId, cu.id));
    if (cu.roleKey === "team_leader") {
      filters.push(
        sql`(${requests.teamLeaderId} = ${cu.id} OR ${requests.salesUserId} IN (SELECT id FROM users WHERE team_leader_id = ${cu.id}))`,
      );
    }
  }

  const where = filters.length ? and(...filters) : undefined;
  const baseQuery = db
    .select({
      id: requests.id,
      srNumber: requests.srNumber,
      status: requests.status,
      paymentStatus: requests.paymentStatus,
      operationType: requests.operationType,
      partnerId: requests.partnerId,
      partnerName: partners.name,
      customerId: requests.customerId,
      customerName: customers.name,
      taxCardNumber: customers.taxCardNumber,
      packageId: requests.packageId,
      packageName: packages.name,
      finalPrice: packages.finalPriceAfterTax,
      salesUserId: requests.salesUserId,
      salesName: users.name,
      createdAt: requests.createdAt,
      submittedAt: requests.submittedAt,
      activatedAt: requests.activatedAt,
    })
    .from(requests)
    .leftJoin(customers, eq(customers.id, requests.customerId))
    .leftJoin(partners, eq(partners.id, requests.partnerId))
    .leftJoin(packages, eq(packages.id, requests.packageId))
    .leftJoin(users, eq(users.id, requests.salesUserId));
  const rows = where
    ? await baseQuery.where(where).orderBy(desc(requests.createdAt)).limit(500)
    : await baseQuery.orderBy(desc(requests.createdAt)).limit(500);
  res.json(rows);
});

// ---------- Operation types (i18n list) ----------
// Defined before `/:id` so the static path is not captured by the param.
requestsRouter.get("/meta/operation-types", requirePerm("requests:view"), (_req, res) => {
  res.json(OPERATION_TYPES as readonly OperationType[]);
});

// ---------- Detail ----------

requestsRouter.get("/:id", requirePerm("requests:view"), async (req, res) => {
  const id = Number(req.params.id);
  const cu = getUser(req)!;
  const [row] = await db
    .select({
      id: requests.id,
      srNumber: requests.srNumber,
      status: requests.status,
      paymentStatus: requests.paymentStatus,
      operationType: requests.operationType,
      realReceiptNumber: requests.realReceiptNumber,
      rejectionReason: requests.rejectionReason,
      partnerId: requests.partnerId,
      partnerName: partners.name,
      customerId: requests.customerId,
      customerName: customers.name,
      taxCardNumber: customers.taxCardNumber,
      packageId: requests.packageId,
      packageName: packages.name,
      finalPrice: packages.finalPriceAfterTax,
      itemPriceBeforeTax: packages.itemPriceBeforeTax,
      taxPct: packages.taxPct,
      salesUserId: requests.salesUserId,
      salesName: users.name,
      teamLeaderId: requests.teamLeaderId,
      submittedAt: requests.submittedAt,
      activatedAt: requests.activatedAt,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .leftJoin(customers, eq(customers.id, requests.customerId))
    .leftJoin(partners, eq(partners.id, requests.partnerId))
    .leftJoin(packages, eq(packages.id, requests.packageId))
    .leftJoin(users, eq(users.id, requests.salesUserId))
    .where(eq(requests.id, id));
  if (!row) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && row.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });

  const history = await db
    .select({
      id: requestStatusHistory.id,
      fromStatus: requestStatusHistory.fromStatus,
      toStatus: requestStatusHistory.toStatus,
      reason: requestStatusHistory.reason,
      createdAt: requestStatusHistory.createdAt,
      userName: users.name,
    })
    .from(requestStatusHistory)
    .leftJoin(users, eq(users.id, requestStatusHistory.changedByUserId))
    .where(eq(requestStatusHistory.requestId, id))
    .orderBy(desc(requestStatusHistory.createdAt));

  const reassignments = await db
    .select()
    .from(requestReassignments)
    .where(eq(requestReassignments.requestId, id))
    .orderBy(desc(requestReassignments.createdAt));

  res.json({ request: row, history, reassignments });
});

// ---------- Status transitions ----------

const transitionInput = z.object({
  toStatus: z.enum(["received", "under_activation", "activated", "failed", "rejected"]),
  reason: z.string().optional().nullable(),
});

requestsRouter.post("/:id/transition", requirePerm("requests:change_status"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = transitionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(requests).where(eq(requests.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && old.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  const from = old.status as RequestStatus;
  const to = parsed.data.toStatus as RequestStatus;
  if (!isAllowedTransition(from, to)) {
    return res.status(409).json({ error: "invalid_transition", from, to, allowed: ALLOWED_TRANSITIONS[from] });
  }
  if ((to === "failed" || to === "rejected") && !parsed.data.reason) {
    return res.status(400).json({ error: "reason_required" });
  }

  const update: Partial<typeof requests.$inferInsert> = {
    status: to,
    updatedAt: new Date(),
  };
  if (to === "activated") update.activatedAt = new Date();
  if (to === "failed" || to === "rejected") update.rejectionReason = parsed.data.reason ?? null;

  // Run the status flip, status-history row, audit entry, ownership
  // bootstrap, and financial bootstrap (order_payment + commissions) in
  // ONE atomic transaction. If anything inside throws — including the
  // financial side — Postgres rolls back the whole unit, so the request
  // is never left activated without its full financial track. We do not
  // need a compensating revert anymore: the transaction is the rollback.
  let updated: typeof requests.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [u] = await tx.update(requests).set(update).where(eq(requests.id, id)).returning();
      await tx.insert(requestStatusHistory).values({
        requestId: id,
        fromStatus: from,
        toStatus: to,
        reason: parsed.data.reason ?? null,
        changedByUserId: cu.id,
      });
      await audit({
        userId: cu.id,
        action: `request.${to}`,
        entityType: "request",
        entityId: id,
        requestId: id,
        customerId: old.customerId,
        partnerId: old.partnerId,
        oldValue: { status: from },
        newValue: { status: to, reason: parsed.data.reason ?? null },
      });

      if (to === "activated") {
        const had = await tx
          .select({ id: customerOwnership.id })
          .from(customerOwnership)
          .where(
            and(
              eq(customerOwnership.customerId, old.customerId),
              eq(customerOwnership.partnerId, old.partnerId),
            )
          )
          .limit(1);
        if (had.length === 0) {
          await startOwnership({ customerId: old.customerId, partnerId: old.partnerId, userId: cu.id }, tx);
        }
        const { onRequestActivated } = await import("../financial.js");
        await onRequestActivated({ requestId: id, userId: cu.id }, tx);
      }
      return u;
    });
  } catch (e: unknown) {
    // Transaction was rolled back — request status is unchanged.
    if (to === "activated") {
      return res.status(409).json({
        error: "activation_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }

  await notifyRequestStatus(
    id,
    `request.${to}` as
      | "request.received"
      | "request.under_activation"
      | "request.activated"
      | "request.failed"
      | "request.rejected",
    old.partnerId,
    old.customerId,
  );
  res.json(updated);
});

// ---------- Reopen ----------

const reopenInput = z.object({
  toStatus: z.enum(["draft_sr", "new_request"]),
  reason: z.string().min(2),
});

requestsRouter.post("/:id/reopen", requirePerm("requests:reopen"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = reopenInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(requests).where(eq(requests.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  if (partnerScoped(cu) && old.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  if (old.status !== "failed" && old.status !== "rejected") {
    return res.status(409).json({ error: "not_reopenable" });
  }
  const to = parsed.data.toStatus;
  if (!REOPEN_TARGETS.includes(to)) return res.status(400).json({ error: "invalid_reopen_target" });
  const [updated] = await db
    .update(requests)
    .set({ status: to, rejectionReason: null, updatedAt: new Date() })
    .where(eq(requests.id, id))
    .returning();
  await db.insert(requestStatusHistory).values({
    requestId: id,
    fromStatus: old.status,
    toStatus: to,
    reason: parsed.data.reason,
    changedByUserId: cu.id,
  });
  await audit({
    userId: cu.id,
    action: "request.reopened",
    entityType: "request",
    entityId: id,
    requestId: id,
    customerId: old.customerId,
    partnerId: old.partnerId,
    oldValue: { status: old.status },
    newValue: { status: to },
    note: parsed.data.reason,
  });
  await notifyRequestStatus(id, "request.reopened", old.partnerId, old.customerId);
  res.json(updated);
});

// ---------- Reassign ----------

const reassignInput = z.object({
  toSalesUserId: z.coerce.number().int(),
  reason: z.string().optional().nullable(),
});

requestsRouter.post("/:id/reassign", requirePerm("requests:reassign"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = reassignInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const [old] = await db.select().from(requests).where(eq(requests.id, id));
  if (!old) return res.status(404).json({ error: "not_found" });
  if (cu.partnerId && old.partnerId !== cu.partnerId) return res.status(403).json({ error: "forbidden" });
  if (old.status !== "draft_sr") return res.status(409).json({ error: "only_draft_reassignable" });
  const [s] = await db.select().from(users).where(eq(users.id, parsed.data.toSalesUserId));
  if (!s || s.partnerId !== old.partnerId) return res.status(400).json({ error: "invalid_sales_user" });
  const [salesRole] = await db.select().from(roles).where(eq(roles.id, s.roleId));
  if (salesRole?.key !== "sales") return res.status(400).json({ error: "invalid_sales_user" });

  const fromSales = old.salesUserId;
  const [updated] = await db
    .update(requests)
    .set({ salesUserId: s.id, teamLeaderId: s.teamLeaderId ?? null, updatedAt: new Date() })
    .where(eq(requests.id, id))
    .returning();
  await db.insert(requestReassignments).values({
    requestId: id,
    fromSalesUserId: fromSales,
    toSalesUserId: s.id,
    reason: parsed.data.reason ?? null,
    byUserId: cu.id,
  });
  await audit({
    userId: cu.id,
    action: "request.reassigned",
    entityType: "request",
    entityId: id,
    requestId: id,
    customerId: old.customerId,
    partnerId: old.partnerId,
    oldValue: { salesUserId: fromSales },
    newValue: { salesUserId: s.id },
    note: parsed.data.reason ?? undefined,
  });
  await notifyRequestStatus(id, "request.reassigned", old.partnerId, old.customerId);
  res.json(updated);

});

import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db.js";
import { customers, packages, requests, financialItems } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";
import { ALLOWED_TRANSITIONS, REQUEST_STATUSES } from "../../shared/requests.js";
import {
  ORDER_PAYMENT_STATUSES, PARTNER_COMMISSION_STATUSES, SALES_COMMISSION_STATUSES,
  type OrderPaymentStatus, type PartnerCommissionStatus, type SalesCommissionStatus,
} from "../../shared/financial.js";

export const excelImportRouter = Router();

const ENTITIES = ["customers", "packages", "requests", "payments", "order_payments", "partner_commissions", "sales_commissions"] as const;
type Entity = (typeof ENTITIES)[number];

const TEMPLATE_HEADERS: Record<Entity, string[]> = {
  customers: ["taxCardNumber", "name", "contactPerson", "contactPhone", "email", "address", "taxOffice", "businessActivity"],
  packages: ["id", "name", "itemPriceBeforeTax", "taxPct", "finalPriceAfterTax", "durationDays", "active"],
  requests: ["id", "status"],
  payments: ["id", "status"],
  order_payments: ["id", "status"],
  partner_commissions: ["id", "status"],
  sales_commissions: ["id", "status"],
};

// Step 1 of the 3-step Upload → Preview/Validate → Confirm flow:
// the client downloads a per-entity template so column names always match.
excelImportRouter.get("/template/:entity", requirePerm("excel_import:import"), (req, res) => {
  const entity = req.params.entity as Entity;
  if (!ENTITIES.includes(entity)) return res.status(400).json({ error: "invalid_entity" });
  const headers = TEMPLATE_HEADERS[entity];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, entity);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${entity}-template.xlsx"`);
  res.send(buf);
});

const importInput = z.object({
  entity: z.enum(ENTITIES),
  rows: z.array(z.record(z.unknown())).min(1).max(2000),
  dryRun: z.boolean().optional(),
});

// Step 2 of the wizard: preview/validate without writing. Mirrors the same
// row-by-row checks the confirm step uses, so the user sees the exact same
// error taxonomy before they commit.
excelImportRouter.post("/validate", requirePerm("excel_import:import"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const parsed = importInput.safeParse({ ...req.body, dryRun: true });
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const { ok, failures } = await validateRows(parsed.data.entity, parsed.data.rows);
  res.json({ valid: failures.length === 0, totalRows: parsed.data.rows.length, okRows: ok, failures });
});

async function validateRows(entity: Entity, rows: Array<Record<string, unknown>>): Promise<{ ok: number; failures: Array<{ row: number; error: string }> }> {
  let ok = 0;
  const failures: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    let err: string | null = null;
    if (entity === "customers") {
      const tax = String(r.taxCardNumber ?? r.tax_card_number ?? "").trim();
      if (!tax) err = "missing_tax_card";
      else {
        const [existing] = await db.select().from(customers).where(eq(customers.taxCardNumber, tax));
        if (!existing) err = "not_found";
      }
    } else if (entity === "packages") {
      const id = Number(r.id);
      if (!id) err = "missing_id";
      else {
        const [existing] = await db.select().from(packages).where(eq(packages.id, id));
        if (!existing) err = "not_found";
      }
    } else if (entity === "requests" || entity === "payments" || entity === "order_payments" || entity === "partner_commissions" || entity === "sales_commissions") {
      const id = Number(r.id);
      const toStatus = String(r.status ?? r.toStatus ?? "").trim();
      if (!id || !toStatus) err = "missing_id_or_status";
      else {
        const allowedStatuses: readonly string[] =
          entity === "requests" ? REQUEST_STATUSES :
          entity === "payments" || entity === "order_payments" ? ORDER_PAYMENT_STATUSES :
          entity === "partner_commissions" ? PARTNER_COMMISSION_STATUSES :
          SALES_COMMISSION_STATUSES;
        if (!allowedStatuses.includes(toStatus)) err = "invalid_status";
      }
    }
    if (err) failures.push({ row: rowNum, error: err }); else ok++;
  }
  return { ok, failures };
}

excelImportRouter.post("/", requirePerm("excel_import:import"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant") return res.status(403).json({ error: "forbidden" });
  const parsed = importInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });

  let updated = 0;
  let failed = 0;
  const failures: Array<{ row: number; error: string }> = [];

  if (parsed.data.entity === "customers") {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i] as Record<string, unknown>;
      const tax = String(r.taxCardNumber ?? r.tax_card_number ?? "").trim();
      if (!tax) { failed++; failures.push({ row: i + 2, error: "missing_tax_card" }); continue; }
      const [existing] = await db.select().from(customers).where(eq(customers.taxCardNumber, tax));
      if (!existing) { failed++; failures.push({ row: i + 2, error: "not_found" }); continue; }
      const update: Partial<typeof customers.$inferInsert> = { updatedAt: new Date() };
      if (r.name) update.name = String(r.name);
      if (r.contactPerson || r.contact_person) update.contactPerson = String(r.contactPerson ?? r.contact_person);
      if (r.contactPhone || r.contact_phone) update.contactPhone = String(r.contactPhone ?? r.contact_phone);
      if (r.email) update.email = String(r.email);
      if (r.address) update.address = String(r.address);
      if (r.taxOffice || r.tax_office) update.taxOffice = String(r.taxOffice ?? r.tax_office);
      if (r.businessActivity || r.business_activity) update.businessActivity = String(r.businessActivity ?? r.business_activity);
      await db.update(customers).set(update).where(eq(customers.id, existing.id));
      await audit({ userId: cu.id, action: "customer.bulk_updated", entityType: "customer", entityId: existing.id, customerId: existing.id, oldValue: existing, newValue: update });
      updated++;
    }
  } else if (parsed.data.entity === "packages") {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i] as Record<string, unknown>;
      const id = Number(r.id);
      if (!id) { failed++; failures.push({ row: i + 2, error: "missing_id" }); continue; }
      const [existing] = await db.select().from(packages).where(eq(packages.id, id));
      if (!existing) { failed++; failures.push({ row: i + 2, error: "not_found" }); continue; }
      const update: Partial<typeof packages.$inferInsert> = { updatedAt: new Date() };
      if (r.name) update.name = String(r.name);
      if (r.itemPriceBeforeTax !== undefined) update.itemPriceBeforeTax = String(r.itemPriceBeforeTax);
      if (r.taxPct !== undefined) update.taxPct = String(r.taxPct);
      if (r.finalPriceAfterTax !== undefined) update.finalPriceAfterTax = String(r.finalPriceAfterTax);
      if (r.durationDays !== undefined) update.durationDays = Number(r.durationDays);
      if (r.active !== undefined) update.active = String(r.active).toLowerCase() === "true";
      await db.update(packages).set(update).where(eq(packages.id, id));
      await audit({ userId: cu.id, action: "package.bulk_updated", entityType: "package", entityId: id, oldValue: existing, newValue: update });
      updated++;
    }
  } else if (parsed.data.entity === "requests") {
    // Bulk request status updates re-use the same side-effect chain as the
    // UI transition route: ALLOWED_TRANSITIONS guard + onRequestActivated
    // (financial bootstrap + ownership) when crossing into `activated`.
    const { onRequestActivated } = await import("../financial.js");
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i] as Record<string, unknown>;
      const id = Number(r.id);
      const toStatus = String(r.status ?? r.toStatus ?? "").trim();
      if (!id || !toStatus) { failed++; failures.push({ row: i + 2, error: "missing_id_or_status" }); continue; }
      if (!REQUEST_STATUSES.includes(toStatus as typeof REQUEST_STATUSES[number])) { failed++; failures.push({ row: i + 2, error: "invalid_status" }); continue; }
      const [existing] = await db.select().from(requests).where(eq(requests.id, id));
      if (!existing) { failed++; failures.push({ row: i + 2, error: "not_found" }); continue; }
      const allowed = ALLOWED_TRANSITIONS[existing.status as keyof typeof ALLOWED_TRANSITIONS] ?? [];
      if (!allowed.includes(toStatus as never)) { failed++; failures.push({ row: i + 2, error: `transition_not_allowed_from_${existing.status}` }); continue; }
      await db.update(requests).set({ status: toStatus, updatedAt: toStatus === "activated" ? new Date() : new Date(), activatedAt: toStatus === "activated" ? new Date() : existing.activatedAt }).where(eq(requests.id, id));
      await audit({ userId: cu.id, action: "request.bulk_status_change", entityType: "request", entityId: id, requestId: id, oldValue: { status: existing.status }, newValue: { status: toStatus } });
      if (toStatus === "activated" && existing.status !== "activated") {
        try {
          await onRequestActivated({ requestId: id, userId: cu.id });
        } catch (e: unknown) {
          // Roll the status back so the activation isn't half-applied.
          await db.update(requests).set({ status: existing.status, activatedAt: existing.activatedAt }).where(eq(requests.id, id));
          failed++;
          failures.push({ row: i + 2, error: `activation_failed: ${e instanceof Error ? e.message : String(e)}` });
          continue;
        }
      }
      updated++;
    }
  } else if (parsed.data.entity === "payments" || parsed.data.entity === "order_payments") {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i] as Record<string, unknown>;
      const id = Number(r.id);
      const toStatus = String(r.status ?? r.toStatus ?? "").trim() as OrderPaymentStatus;
      if (!id || !toStatus) { failed++; failures.push({ row: i + 2, error: "missing_id_or_status" }); continue; }
      if (!ORDER_PAYMENT_STATUSES.includes(toStatus)) { failed++; failures.push({ row: i + 2, error: "invalid_status" }); continue; }
      const claimGated = ["received_by_company", "settled"];
      const isOverride = claimGated.includes(toStatus);
      if (isOverride && !cu.permissions?.includes("payments:manual_override")) {
        failed++; failures.push({ row: i + 2, error: "manual_override_required" }); continue;
      }
      await db.update(financialItems).set({ status: toStatus, updatedAt: new Date() }).where(and(eq(financialItems.id, id), eq(financialItems.type, "payment_item"))); updated++;
    }
  } else if (parsed.data.entity === "partner_commissions") {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i] as Record<string, unknown>;
      const id = Number(r.id);
      const toStatus = String(r.status ?? r.toStatus ?? "").trim() as PartnerCommissionStatus;
      if (!id || !toStatus) { failed++; failures.push({ row: i + 2, error: "missing_id_or_status" }); continue; }
      if (!PARTNER_COMMISSION_STATUSES.includes(toStatus)) { failed++; failures.push({ row: i + 2, error: "invalid_status" }); continue; }
      const gated = ["in_claim", "claim_approved", "ready_for_settlement", "settled_successfully"];
      const isOverride = gated.includes(toStatus);
      if (isOverride && !cu.permissions?.includes("partner_commissions:manual_override")) {
        failed++; failures.push({ row: i + 2, error: "manual_override_required" }); continue;
      }
      await db.update(financialItems).set({ status: toStatus, updatedAt: new Date() }).where(and(eq(financialItems.id, id), eq(financialItems.type, "partner_commission_item"))); updated++;
    }
  } else if (parsed.data.entity === "sales_commissions") {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i] as Record<string, unknown>;
      const id = Number(r.id);
      const toStatus = String(r.status ?? r.toStatus ?? "").trim() as SalesCommissionStatus;
      if (!id || !toStatus) { failed++; failures.push({ row: i + 2, error: "missing_id_or_status" }); continue; }
      if (!SALES_COMMISSION_STATUSES.includes(toStatus)) { failed++; failures.push({ row: i + 2, error: "invalid_status" }); continue; }
      const gated = ["added_to_claim", "approved", "settled"];
      const isOverride = gated.includes(toStatus);
      if (isOverride && !cu.permissions?.includes("sales_commissions:manual_override")) {
        failed++; failures.push({ row: i + 2, error: "manual_override_required" }); continue;
      }
      await db.update(financialItems).set({ status: toStatus, updatedAt: new Date() }).where(and(eq(financialItems.id, id), eq(financialItems.type, "sales_commission_item"))); updated++;
    }
  }

  res.json({ updated, failed, failures });
});

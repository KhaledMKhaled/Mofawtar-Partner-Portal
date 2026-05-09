import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { customers, packages } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";

export const excelImportRouter = Router();

// Bulk-update endpoint accepts an array of {entity, key, fields} rows after the
// client has parsed an Excel/CSV file. Server-side parsing happens via xlsx in
// the browser already; this endpoint is the safety net that validates and
// applies the updates inside an audited transaction-like loop.
const importInput = z.object({
  entity: z.enum(["customers", "packages"]),
  rows: z.array(z.record(z.unknown())).min(1).max(2000),
});

excelImportRouter.post("/", requirePerm("excel_import:import"), async (req, res) => {
  const cu = getUser(req)!;
  if (cu.roleKey !== "company_super_admin") return res.status(403).json({ error: "forbidden" });
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
  }

  res.json({ updated, failed, failures });
});

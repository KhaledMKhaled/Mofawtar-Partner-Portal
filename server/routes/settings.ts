import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { settings } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import { audit } from "../audit.js";

export const settingsRouter = Router();

const DEFAULTS: Record<string, unknown> = {
  language: "ar",
  direction: "rtl",
  currency: "EGP",
  timezone: "Africa/Cairo",
  ownership_expiry_warning_days: 30,
  commission_calculation_base: "before_tax",
};

settingsRouter.get("/", requirePerm("settings:view"), async (_req, res) => {
  const rows = await db.select().from(settings);
  const map: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  res.json(map);
});

settingsRouter.get("/public", async (_req, res) => {
  const rows = await db.select().from(settings);
  const map: Record<string, unknown> = {
    language: DEFAULTS.language,
    direction: DEFAULTS.direction,
    currency: DEFAULTS.currency,
    timezone: DEFAULTS.timezone,
  };
  for (const r of rows) {
    if (["language", "direction", "currency", "timezone"].includes(r.key)) map[r.key] = r.value;
  }
  res.json(map);
});

const updateSchema = z.record(z.string(), z.any());

settingsRouter.put("/", requirePerm("settings:edit"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const cu = getUser(req)!;
  for (const [key, value] of Object.entries(parsed.data)) {
    const existing = await db.select().from(settings).where(eq(settings.key, key));
    if (existing[0]) {
      await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }
  await audit({ userId: cu.id, action: "settings.updated", entityType: "settings", newValue: parsed.data });
  res.json({ ok: true });
});

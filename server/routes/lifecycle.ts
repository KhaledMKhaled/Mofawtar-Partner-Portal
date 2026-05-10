import { Router, type Request } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { requests } from "../schema.js";
import { getUser, requirePerm } from "../auth.js";
import {
  advanceMasterStage,
  cancelRefundRequest,
  failRequest,
  reopenRequest,
  cloneFromCancelled,
  getLifecycleSnapshot,
} from "../lifecycle.js";
import {
  MASTER_LIFECYCLE_STAGES,
  MASTER_REOPEN_TARGETS,
  type MasterLifecycleStage,
} from "../../shared/financial.js";

export const lifecycleRouter = Router();

const stageSchema = z.enum(MASTER_LIFECYCLE_STAGES);

function partnerScoped(cu: { roleKey: string; partnerId: number | null }) {
  return cu.partnerId && cu.roleKey !== "company_super_admin" && cu.roleKey !== "company_accountant";
}

async function loadAndAuthorize(req: Request, requestId: number) {
  const cu = getUser(req)!;
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!r) return { error: "not_found" as const };
  if (partnerScoped(cu) && r.partnerId !== cu.partnerId) return { error: "forbidden" as const };
  return { row: r, user: cu };
}

// ---------- GET /api/orders/:id/lifecycle ----------
lifecycleRouter.get("/:id/lifecycle", requirePerm("requests:view"), async (req, res) => {
  const id = Number(req.params.id);
  const auth = await loadAndAuthorize(req, id);
  if ("error" in auth) return res.status(auth.error === "forbidden" ? 403 : 404).json({ error: auth.error });
  const snap = await getLifecycleSnapshot(id);
  if (!snap) return res.status(404).json({ error: "not_found" });
  res.json(snap);
});

// ---------- POST /api/orders/:id/lifecycle/advance ----------
const advanceSchema = z.object({
  toStage: stageSchema,
  reason: z.string().optional().nullable(),
});

lifecycleRouter.post("/:id/lifecycle/advance", requirePerm("requests:advance_lifecycle"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const auth = await loadAndAuthorize(req, id);
  if ("error" in auth) return res.status(auth.error === "forbidden" ? 403 : 404).json({ error: auth.error });
  try {
    const result = await advanceMasterStage(id, parsed.data.toStage, auth.user.id, {
      reason: parsed.data.reason ?? null,
    });
    res.json(result);
  } catch (e: unknown) {
    res.status(409).json({ error: "advance_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- POST /api/orders/lifecycle/bulk-advance ----------
const bulkSchema = z.object({
  ids: z.array(z.coerce.number().int()).min(1).max(200),
  toStage: stageSchema,
  reason: z.string().optional().nullable(),
});

lifecycleRouter.post("/lifecycle/bulk-advance", requirePerm("requests:advance_lifecycle"), async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const cu = getUser(req)!;
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const id of parsed.data.ids) {
    try {
      const [r] = await db.select().from(requests).where(eq(requests.id, id));
      if (!r) { results.push({ id, ok: false, error: "not_found" }); continue; }
      if (partnerScoped(cu) && r.partnerId !== cu.partnerId) {
        results.push({ id, ok: false, error: "forbidden" }); continue;
      }
      await advanceMasterStage(id, parsed.data.toStage, cu.id, { reason: parsed.data.reason ?? null });
      results.push({ id, ok: true });
    } catch (e: unknown) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  res.json({ total: results.length, succeeded, failed: results.length - succeeded, results });
});

// ---------- POST /api/orders/:id/cancel-refund ----------
const cancelSchema = z.object({ reason: z.string().min(2) });

lifecycleRouter.post("/:id/cancel-refund", requirePerm("requests:advance_lifecycle"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const auth = await loadAndAuthorize(req, id);
  if ("error" in auth) return res.status(auth.error === "forbidden" ? 403 : 404).json({ error: auth.error });
  try {
    await cancelRefundRequest(id, auth.user.id, parsed.data.reason);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(409).json({ error: "cancel_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- POST /api/orders/:id/fail ----------
lifecycleRouter.post("/:id/fail", requirePerm("requests:advance_lifecycle"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const auth = await loadAndAuthorize(req, id);
  if ("error" in auth) return res.status(auth.error === "forbidden" ? 403 : 404).json({ error: auth.error });
  try {
    await failRequest(id, auth.user.id, parsed.data.reason);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(409).json({ error: "fail_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- POST /api/orders/:id/lifecycle/reopen ----------
const reopenSchema = z.object({
  toStage: z.enum(MASTER_REOPEN_TARGETS as [MasterLifecycleStage, ...MasterLifecycleStage[]]),
  reason: z.string().min(2),
});

lifecycleRouter.post("/:id/lifecycle/reopen", requirePerm("requests:reopen"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = reopenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const auth = await loadAndAuthorize(req, id);
  if ("error" in auth) return res.status(auth.error === "forbidden" ? 403 : 404).json({ error: auth.error });
  try {
    await reopenRequest(id, auth.user.id, parsed.data.toStage, parsed.data.reason);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(409).json({ error: "reopen_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

// ---------- POST /api/orders/:id/clone-from-cancelled ----------
lifecycleRouter.post("/:id/clone-from-cancelled", requirePerm("requests:create"), async (req, res) => {
  const id = Number(req.params.id);
  const auth = await loadAndAuthorize(req, id);
  if ("error" in auth) return res.status(auth.error === "forbidden" ? 403 : 404).json({ error: auth.error });
  try {
    const created = await cloneFromCancelled(id, auth.user.id);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(409).json({ error: "clone_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

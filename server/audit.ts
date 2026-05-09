import { db } from "./db.js";
import { auditLog } from "./schema.js";

// Audit writes are intentionally fire-and-forget and run on the shared
// connection pool (NOT on a caller's transaction handle): a transient
// audit-log failure must never break the user-visible action it
// records, and must never abort an enclosing transaction by poisoning
// it. The trade-off is that audit rows are not rolled back together
// with a failed transaction; that matches the historical behaviour and
// is the right call for an observability sink.
export async function audit(entry: {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: string | number;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string;
  partnerId?: number;
  customerId?: number;
  requestId?: number;
}) {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : undefined,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      note: entry.note,
      partnerId: entry.partnerId,
      customerId: entry.customerId,
      requestId: entry.requestId,
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}

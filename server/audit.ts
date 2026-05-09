import { db } from "./db.js";
import { auditLog } from "./schema.js";

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

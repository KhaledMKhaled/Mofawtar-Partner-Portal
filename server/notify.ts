import { db } from "./db.js";
import { notifications } from "./schema.js";
import type { NotificationType } from "../shared/requests.js";

// Notifications are intentionally fire-and-forget and run on the shared
// connection pool (NOT on a caller's transaction handle): a transient
// notification-write failure must never break the user-visible action
// that triggered it, and must never abort an enclosing transaction by
// poisoning it. Notifications are not rolled back together with a
// failed transaction; that's acceptable for a best-effort delivery sink.
export async function notify(entry: {
  userId: number;
  type: NotificationType;
  titleEn: string;
  titleAr: string;
  bodyEn?: string;
  bodyAr?: string;
  entityType?: string;
  entityId?: string | number;
  linkPath?: string;
}) {
  try {
    await db.insert(notifications).values({
      userId: entry.userId,
      type: entry.type,
      titleEn: entry.titleEn,
      titleAr: entry.titleAr,
      bodyEn: entry.bodyEn,
      bodyAr: entry.bodyAr,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : undefined,
      linkPath: entry.linkPath,
    });
  } catch (e) {
    console.error("notify failed", e);
  }
}

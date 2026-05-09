import { db } from "./db.js";
import { notifications } from "./schema.js";
import type { NotificationType } from "../shared/requests.js";

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

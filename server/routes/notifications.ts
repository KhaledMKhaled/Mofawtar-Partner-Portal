import { Router } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db.js";
import { notifications } from "../schema.js";
import { getUser, requireAuth } from "../auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res) => {
  const cu = getUser(req)!;
  const onlyUnread = req.query.unread === "1";
  const where = onlyUnread
    ? and(eq(notifications.userId, cu.id), isNull(notifications.readAt))
    : eq(notifications.userId, cu.id);
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(100);
  res.json(rows);
});

notificationsRouter.get("/unread-count", async (req, res) => {
  const cu = getUser(req)!;
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, cu.id), isNull(notifications.readAt)));
  res.json({ count: row?.c ?? 0 });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const cu = getUser(req)!;
  const id = Number(req.params.id);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, cu.id)));
  res.json({ ok: true });
});

notificationsRouter.post("/read-all", async (req, res) => {
  const cu = getUser(req)!;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, cu.id), isNull(notifications.readAt)));
  res.json({ ok: true });
});

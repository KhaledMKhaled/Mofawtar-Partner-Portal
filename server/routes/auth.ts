import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { users } from "../schema.js";
import { eq } from "drizzle-orm";
import {
  hashPassword,
  loadCurrentUser,
  requireAuth,
  verifyPassword,
} from "../auth.js";
import { audit } from "../audit.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { email, password } = parsed.data;
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!u || u.status !== "active") return res.status(401).json({ error: "invalid_credentials" });
  const ok = await verifyPassword(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  req.session.userId = u.id;
  await audit({ userId: u.id, action: "user.login", entityType: "user", entityId: u.id });
  const cu = await loadCurrentUser(u.id);
  res.json(cu);
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get("/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "unauthorized" });
  const cu = await loadCurrentUser(req.session.userId);
  if (!cu) return res.status(401).json({ error: "unauthorized" });
  res.json(cu);
});

const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePwSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const [u] = await db.select().from(users).where(eq(users.id, req.session.userId!));
  if (!u) return res.status(404).json({ error: "not_found" });
  const ok = await verifyPassword(parsed.data.currentPassword, u.passwordHash);
  if (!ok) return res.status(400).json({ error: "wrong_password" });
  const hash = await hashPassword(parsed.data.newPassword);
  await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, u.id));
  await audit({ userId: u.id, action: "user.password_changed", entityType: "user", entityId: u.id });
  res.json({ ok: true });
});

const forgotSchema = z.object({ email: z.string().email() });

// Demo-mode forgot/reset: in this phase, returns a deterministic token tied to the email
// so the demo flow works without an email provider. Real email/SMS is out of scope.
authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  res.json({ ok: true, demoNote: "In this demo, please contact your administrator to reset the password." });
});

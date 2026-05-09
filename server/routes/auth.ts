import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { db } from "../db.js";
import { users, passwordResets } from "../schema.js";
import { and, eq, gt, isNull } from "drizzle-orm";
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

// Demo-mode forgot/reset: when the email exists, mint a reset token and return it
// directly in the response so the bundled UI flow works without an email provider.
// In production this token would be emailed/SMS'd to the user instead of returned.
authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const email = parsed.data.email.toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || u.status !== "active") {
    // Don't leak which emails exist.
    return res.json({ ok: true });
  }
  // The raw token is delivered to the user (out-of-band in prod, echoed in
  // dev demo mode). Only its SHA-256 hash is persisted at rest, so a leaked
  // password_resets row cannot be used to take over the account.
  const rawToken = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.insert(passwordResets).values({ userId: u.id, token: tokenHash, expiresAt });
  await audit({
    userId: u.id,
    action: "user.password_reset_requested",
    entityType: "user",
    entityId: u.id,
  });
  // Only expose the token to the client in non-production so the bundled demo
  // flow can complete without an email provider. In production this token must
  // be delivered out-of-band (email/SMS) and never echoed in API responses.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    return res.json({ ok: true });
  }
  res.json({
    ok: true,
    demoToken: rawToken,
    demoNote: "In production this link would be emailed to the user.",
  });
});

const resetSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { token, newPassword } = parsed.data;
  const now = new Date();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.token, tokenHash),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, now),
      ),
    );
  if (!row) return res.status(400).json({ error: "invalid_or_expired_token" });
  const hash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: hash, updatedAt: now })
    .where(eq(users.id, row.userId));
  await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(eq(passwordResets.id, row.id));
  await audit({
    userId: row.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: row.userId,
  });
  res.json({ ok: true });
});

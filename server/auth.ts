import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { users, roles, partners } from "./schema.js";
import { eq } from "drizzle-orm";
import type { Permission } from "../shared/permissions.js";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    currentUser?: CurrentUser;
  }
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  imageUrl: string | null;
  roleId: number;
  roleKey: string;
  roleNameEn: string;
  roleNameAr: string;
  permissions: string[];
  partnerId: number | null;
  partnerName: string | null;
  teamLeaderId: number | null;
  status: string;
}

export async function loadCurrentUser(userId: number): Promise<CurrentUser | null> {
  const rows = await db
    .select({
      u: users,
      r: roles,
      p: partners,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(partners, eq(partners.id, users.partnerId))
    .where(eq(users.id, userId));
  if (!rows[0]) return null;
  const { u, r, p } = rows[0];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    imageUrl: u.imageUrl,
    roleId: r.id,
    roleKey: r.key,
    roleNameEn: r.nameEn,
    roleNameAr: r.nameAr,
    permissions: r.permissions ?? [],
    partnerId: u.partnerId ?? null,
    partnerName: p?.name ?? null,
    teamLeaderId: u.teamLeaderId ?? null,
    status: u.status,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

export function requirePerm(...perms: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) return res.status(401).json({ error: "unauthorized" });
    const user = await loadCurrentUser(req.session.userId);
    if (!user || user.status !== "active") {
      return res.status(403).json({ error: "forbidden" });
    }
    const has = perms.every((p) => user.permissions.includes(p));
    if (!has) return res.status(403).json({ error: "forbidden", missing: perms });
    req.currentUser = user;
    next();
  };
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  if (req.session.userId) {
    const user = await loadCurrentUser(req.session.userId);
    if (user) req.currentUser = user;
  }
  next();
}

export function getUser(req: Request): CurrentUser | undefined {
  return req.currentUser;
}

import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";

const SESSION_COOKIE = "swn_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string): Promise<boolean> {
  const row = await db.query.authUser.findFirst({ where: eq(schema.authUser.id, 1) });
  if (!row) return false;
  try {
    return Bun.password.verify(password, row.passwordHash);
  } catch {
    return false;
  }
}

export async function setPassword(password: string): Promise<void> {
  const hash = await hashPassword(password);
  await db
    .insert(schema.authUser)
    .values({ id: 1, passwordHash: hash })
    .onConflictDoUpdate({ target: schema.authUser.id, set: { passwordHash: hash } });
}

export async function isFirstRun(): Promise<boolean> {
  const row = await db.query.authUser.findFirst({ where: eq(schema.authUser.id, 1) });
  return !row;
}

export async function createSession(): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await db.insert(schema.session).values({ id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return id;
}

export async function destroySession(id: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.id, id));
}

export async function validSession(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const row = await db.query.session.findFirst({ where: eq(schema.session.id, id) });
  if (!row) return false;
  return row.expiresAt.getTime() > Date.now();
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (await isFirstRun()) {
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/api/auth")) {
      return c.json({ error: "first_run", message: "Initial setup required" }, 401);
    }
    return next();
  }
  const sid = getCookie(c, SESSION_COOKIE);
  if (!(await validSession(sid))) return c.json({ error: "unauthorized" }, 401);
  return next();
};

export function setSessionCookie(c: Context, sid: string): void {
  setCookie(c, SESSION_COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: env.PUBLIC_ORIGIN.startsWith("https://"),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function getSessionId(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

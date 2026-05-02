import { eq, gt } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import sodium from "libsodium-wrappers";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";

await sodium.ready;

const SESSION_COOKIE = "swn_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return sodium.crypto_pwhash_str(
    password,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE
  );
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return sodium.crypto_pwhash_str_verify(hash, password);
  } catch {
    return false;
  }
}

export function isFirstRun(): boolean {
  return !env.USER_PASSWORD_HASH;
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
  if (isFirstRun()) {
    // Allow access to /api/auth/setup; everything else gets 401 to force setup.
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

export function constantTimeEq(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  if (ah.length !== bh.length) return false;
  let r = 0;
  for (let i = 0; i < ah.length; i++) r |= ah[i]! ^ bh[i]!;
  return r === 0;
}

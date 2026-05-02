import { Hono } from "hono";
import { z } from "zod";
import {
  createSession,
  destroySession,
  isFirstRun,
  setPassword,
  setSessionCookie,
  clearSessionCookie,
  getSessionId,
  verifyPassword,
} from "../auth.ts";

export const authRoutes = new Hono();

authRoutes.get("/status", async (c) => c.json({ firstRun: await isFirstRun() }));

// First-run setup: stores the password hash in the DB and immediately logs the
// user in. No restart required.
authRoutes.post("/setup", async (c) => {
  if (!(await isFirstRun())) return c.json({ error: "already_initialized" }, 400);
  const Body = z.object({ password: z.string().min(8) });
  const { password } = Body.parse(await c.req.json());
  await setPassword(password);
  const sid = await createSession();
  setSessionCookie(c, sid);
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  if (await isFirstRun()) return c.json({ error: "not_initialized" }, 400);
  const Body = z.object({ password: z.string() });
  const { password } = Body.parse(await c.req.json());
  const ok = await verifyPassword(password);
  if (!ok) return c.json({ error: "invalid" }, 401);
  const sid = await createSession();
  setSessionCookie(c, sid);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  const sid = getSessionId(c);
  if (sid) await destroySession(sid);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

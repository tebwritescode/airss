import { Hono } from "hono";
import { z } from "zod";
import {
  createSession,
  destroySession,
  hashPassword,
  isFirstRun,
  setSessionCookie,
  clearSessionCookie,
  getSessionId,
  verifyPassword,
} from "../auth.ts";
import { env } from "../env.ts";

export const authRoutes = new Hono();

authRoutes.get("/status", (c) => c.json({ firstRun: isFirstRun() }));

// First-run setup: sets the user password hash. The hash is written to stdout
// and must be persisted to USER_PASSWORD_HASH env var by the operator (Docker
// secret, .env, etc.) — we don't write env files from the app.
authRoutes.post("/setup", async (c) => {
  if (!isFirstRun()) return c.json({ error: "already_initialized" }, 400);
  const Body = z.object({ password: z.string().min(8) });
  const { password } = Body.parse(await c.req.json());
  const hash = await hashPassword(password);
  console.log(
    "\n=== swift-newt: setup complete ===\n" +
      "Add this line to your .env (or docker-compose env_file) and restart the server:\n\n" +
      `USER_PASSWORD_HASH='${hash}'\n\n` +
      "================================\n"
  );
  return c.json({ ok: true, message: "Setup complete. Check server logs for the env var to add." });
});

authRoutes.post("/login", async (c) => {
  const Body = z.object({ password: z.string() });
  const { password } = Body.parse(await c.req.json());
  if (!env.USER_PASSWORD_HASH) return c.json({ error: "not_initialized" }, 400);
  const ok = await verifyPassword(password, env.USER_PASSWORD_HASH);
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

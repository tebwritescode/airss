import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { env } from "./env.ts";
import { requireAuth } from "./auth.ts";
import { authRoutes } from "./routes/auth.ts";
import { sourceRoutes } from "./routes/sources.ts";
import { feedRoutes } from "./routes/feed.ts";
import { signalRoutes } from "./routes/signals.ts";
import { profileRoutes } from "./routes/profile.ts";
import { providerRoutes } from "./routes/providers.ts";
import { refreshRoutes } from "./routes/refresh.ts";
import { itemRoutes } from "./routes/items.ts";
import { startScheduler } from "./jobs/scheduler.ts";

const app = new Hono();
app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: env.PUBLIC_ORIGIN,
    credentials: true,
  })
);

app.get("/api/health", (c) => c.json({ ok: true }));

// Auth routes are open (login/setup); everything else under /api requires session.
app.route("/api/auth", authRoutes);
app.use("/api/*", requireAuth);
app.route("/api/sources", sourceRoutes);
app.route("/api/feed", feedRoutes);
app.route("/api/signals", signalRoutes);
app.route("/api/profile", profileRoutes);
app.route("/api/providers", providerRoutes);
app.route("/api/refresh", refreshRoutes);
app.route("/api/items", itemRoutes);

// Serve the built PWA at the root; fall back to index.html for SPA routes.
app.use("/*", serveStatic({ root: env.PWA_DIST }));
app.get("*", (c) => c.body(Bun.file(`${env.PWA_DIST}/index.html`)));

startScheduler();

console.log(`swift-newt server listening on :${env.PORT}`);
export default {
  port: env.PORT,
  fetch: app.fetch,
};

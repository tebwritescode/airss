import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { fetchSource } from "../fetcher/index.ts";
import { normalizeRedditUrl } from "../fetcher/reddit.ts";
import { resolveYouTubeChannelId } from "../fetcher/youtube.ts";

export const sourceRoutes = new Hono();

sourceRoutes.get("/", async (c) => {
  const rows = await db
    .select()
    .from(schema.sources)
    .orderBy(desc(schema.sources.createdAt));
  return c.json({ sources: rows });
});

sourceRoutes.post("/", async (c) => {
  const Body = z.object({
    kind: z.enum(["rss", "reddit", "youtube", "web"]),
    url: z.string().min(1),
    title: z.string().optional(),
    pollIntervalS: z.number().int().min(60).max(86400).optional(),
  });
  const body = Body.parse(await c.req.json());

  let url = body.url.trim();
  if (body.kind === "reddit") url = normalizeRedditUrl(url);
  if (body.kind === "youtube") url = await resolveYouTubeChannelId(url);

  const [row] = await db
    .insert(schema.sources)
    .values({
      kind: body.kind,
      url,
      title: body.title,
      pollIntervalS: body.pollIntervalS ?? 1800,
    })
    .onConflictDoUpdate({
      target: schema.sources.url,
      set: { enabled: true, title: body.title },
    })
    .returning();

  // Kick a fetch immediately so the user sees items without waiting for cron.
  if (row) {
    fetchSource(row.id).catch((err) => console.error("[sources] initial fetch failed:", err));
  }

  return c.json({ source: row });
});

sourceRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad_id" }, 400);
  await db.delete(schema.sources).where(eq(schema.sources.id, id));
  return c.json({ ok: true });
});

sourceRoutes.post("/:id/refresh", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad_id" }, 400);
  const r = await fetchSource(id);
  return c.json(r);
});

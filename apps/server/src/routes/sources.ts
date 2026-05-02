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

// ── OPML import / export ────────────────────────────────────────────────────

function detectKind(url: string): "rss" | "reddit" | "youtube" | "web" {
  const u = url.toLowerCase();
  if (u.includes("reddit.com")) return "reddit";
  if (u.includes("youtube.com/feeds/videos.xml")) return "youtube";
  return "rss";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Parse <outline xmlUrl="..." title="..."/> tags from OPML XML.
// Tolerant of different attribute order and missing title.
function parseOpml(xml: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  const re = /<outline\b[^>]*?\/?>/g;
  for (const match of xml.matchAll(re)) {
    const tag = match[0];
    const url = (tag.match(/\bxmlUrl\s*=\s*"([^"]+)"/i) ?? tag.match(/\bxmlUrl\s*=\s*'([^']+)'/i))?.[1];
    if (!url || seen.has(url)) continue;
    const title =
      (tag.match(/\btitle\s*=\s*"([^"]+)"/i) ?? tag.match(/\btitle\s*=\s*'([^']+)'/i))?.[1] ?? "";
    seen.add(url);
    out.push({ url, title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") });
  }
  return out;
}

sourceRoutes.post("/opml/import", async (c) => {
  const body = await c.req.text();
  if (!body || body.length < 10) return c.json({ error: "empty_body" }, 400);
  const feeds = parseOpml(body);
  let added = 0;
  let skipped = 0;
  for (const f of feeds) {
    let url = f.url.trim();
    const kind = detectKind(url);
    try {
      if (kind === "reddit") url = normalizeRedditUrl(url);
      if (kind === "youtube") url = await resolveYouTubeChannelId(url);
      const [row] = await db
        .insert(schema.sources)
        .values({ kind, url, title: f.title || null, pollIntervalS: 1800 })
        .onConflictDoUpdate({ target: schema.sources.url, set: { enabled: true, title: f.title || null } })
        .returning({ id: schema.sources.id });
      if (row) added++;
    } catch {
      skipped++;
    }
  }
  return c.json({ ok: true, added, skipped, total: feeds.length });
});

sourceRoutes.get("/opml/export", async (c) => {
  const rows = await db
    .select({ url: schema.sources.url, title: schema.sources.title, kind: schema.sources.kind })
    .from(schema.sources)
    .orderBy(desc(schema.sources.createdAt));
  const outlines = rows
    .map(
      (r) =>
        `<outline type="rss" title="${escapeXml(r.title || r.url)}" xmlUrl="${escapeXml(r.url)}"/>`,
    )
    .join("\n  ");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>swift-newt subscriptions</title></head>
  <body>
  ${outlines}
  </body>
</opml>`;
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="swift-newt-${new Date().toISOString().slice(0, 10)}.opml"`,
    },
  });
});

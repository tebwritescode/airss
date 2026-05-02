import { Hono } from "hono";
import { desc, eq, sql, and, lt, gte, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getItemEmbedding, cosine } from "../enricher/embed.ts";
import { computeLikedCentroid } from "../enricher/score.ts";

export const feedRoutes = new Hono();

const PAGE_SIZE = 30;

feedRoutes.get("/", async (c) => {
  const cursor = c.req.query("cursor"); // "<relevance>:<itemId>"
  const minScore = Number(c.req.query("minScore") ?? "0");
  const sourceId = c.req.query("sourceId") ? Number(c.req.query("sourceId")) : undefined;

  // Hide items that have a hide/dislike signal.
  const hidden = await db
    .selectDistinct({ itemId: schema.signals.itemId })
    .from(schema.signals)
    .where(inArray(schema.signals.kind, ["hide", "dislike"]));
  const hiddenIds = new Set(hidden.map((h) => h.itemId));

  let q = db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      author: schema.items.author,
      publishedAt: schema.items.publishedAt,
      imageUrl: schema.items.imageUrl,
      contentText: schema.items.contentText,
      sourceId: schema.items.sourceId,
      sourceTitle: schema.sources.title,
      sourceKind: schema.sources.kind,
      relevance: schema.scores.relevance,
      rationale: schema.scores.rationale,
    })
    .from(schema.items)
    .leftJoin(schema.scores, eq(schema.scores.itemId, schema.items.id))
    .leftJoin(schema.sources, eq(schema.sources.id, schema.items.sourceId))
    .$dynamic();

  const filters = [gte(schema.scores.relevance, minScore)];
  if (sourceId) filters.push(eq(schema.items.sourceId, sourceId));
  if (cursor) {
    const [relStr, idStr] = cursor.split(":");
    const rel = Number(relStr), id = Number(idStr);
    // Keyset: rows where (relevance, id) < (cursor.relevance, cursor.id) under DESC ordering.
    filters.push(sql`(${schema.scores.relevance}, ${schema.items.id}) < (${rel}, ${id})`);
  }

  const rows = await q
    .where(and(...filters))
    .orderBy(desc(schema.scores.relevance), desc(schema.items.id))
    .limit(PAGE_SIZE * 2); // overfetch to absorb hidden filtering

  const visible = rows.filter((r) => !hiddenIds.has(r.id)).slice(0, PAGE_SIZE);
  const last = visible[visible.length - 1];
  const nextCursor = last && last.relevance != null ? `${last.relevance}:${last.id}` : null;

  return c.json({ items: visible, nextCursor });
});

// Embedding-based recommendations: items similar to what the user has liked/lingered on.
feedRoutes.get("/related", async (c) => {
  const excludeIds = (c.req.query("excludeIds") ?? "")
    .split(",")
    .map(Number)
    .filter(Boolean);
  const limit = Math.min(Number(c.req.query("limit") ?? "6"), 20);

  const centroid = await computeLikedCentroid();
  if (!centroid) return c.json({ items: [] });

  // Hidden items should not appear in recommendations.
  const hidden = await db
    .selectDistinct({ itemId: schema.signals.itemId })
    .from(schema.signals)
    .where(inArray(schema.signals.kind, ["hide", "dislike"]));
  const hiddenIds = new Set([...hidden.map((h) => h.itemId), ...excludeIds]);

  // Candidate pool: scored items not already excluded.
  const candidates = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      author: schema.items.author,
      publishedAt: schema.items.publishedAt,
      imageUrl: schema.items.imageUrl,
      contentText: schema.items.contentText,
      sourceId: schema.items.sourceId,
      sourceTitle: schema.sources.title,
      sourceKind: schema.sources.kind,
      relevance: schema.scores.relevance,
      rationale: schema.scores.rationale,
    })
    .from(schema.items)
    .leftJoin(schema.scores, eq(schema.scores.itemId, schema.items.id))
    .leftJoin(schema.sources, eq(schema.sources.id, schema.items.sourceId))
    .where(gte(schema.scores.relevance, 0))
    .orderBy(desc(schema.items.id))
    .limit(200);

  // Rank by cosine similarity to interest centroid.
  const ranked: { item: typeof candidates[0]; sim: number }[] = [];
  for (const item of candidates) {
    if (hiddenIds.has(item.id)) continue;
    const vec = await getItemEmbedding(item.id);
    if (!vec) continue;
    ranked.push({ item, sim: cosine(centroid, vec) });
  }
  ranked.sort((a, b) => b.sim - a.sim);

  return c.json({ items: ranked.slice(0, limit).map((r) => r.item) });
});

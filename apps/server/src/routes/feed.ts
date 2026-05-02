import { Hono } from "hono";
import { desc, eq, sql, and, lt, gte, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getItemEmbedding, cosine } from "../enricher/embed.ts";
import { computeInterestCentroid } from "../enricher/score.ts";

export const feedRoutes = new Hono();

const PAGE_SIZE = 30;

feedRoutes.get("/", async (c) => {
  // Cursor format: "<effectiveRelevance>:<publishedAtMs>:<itemId>".
  // effectiveRelevance = COALESCE(scores.relevance, 0.5) so unscored items
  // appear in the middle of the ranking ordered by recency.
  const cursor = c.req.query("cursor");
  const minScore = Number(c.req.query("minScore") ?? "0");
  const sourceId = c.req.query("sourceId") ? Number(c.req.query("sourceId")) : undefined;

  // Hide items that have a hide/dislike signal.
  const hidden = await db
    .selectDistinct({ itemId: schema.signals.itemId })
    .from(schema.signals)
    .where(inArray(schema.signals.kind, ["hide", "dislike"]));
  const hiddenIds = new Set(hidden.map((h) => h.itemId));

  // SQL expressions used in both ORDER BY and the keyset cursor predicate.
  const effRelevance = sql<number>`COALESCE(${schema.scores.relevance}, 0.5)`;
  const effPublished = sql<number>`COALESCE(${schema.items.publishedAt}, ${schema.items.createdAt})`;

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
      effRel: effRelevance,
      effPub: effPublished,
    })
    .from(schema.items)
    .leftJoin(schema.scores, eq(schema.scores.itemId, schema.items.id))
    .leftJoin(schema.sources, eq(schema.sources.id, schema.items.sourceId))
    .$dynamic();

  const filters: any[] = [];
  // minScore filter only triggers if the caller explicitly asks for one > 0.
  if (minScore > 0) filters.push(gte(effRelevance, minScore));
  if (sourceId) filters.push(eq(schema.items.sourceId, sourceId));
  if (cursor) {
    const [relStr, pubStr, idStr] = cursor.split(":");
    const rel = Number(relStr), pub = Number(pubStr), id = Number(idStr);
    // Keyset under (effRel DESC, effPub DESC, id DESC).
    filters.push(
      sql`(${effRelevance} < ${rel})
       OR (${effRelevance} = ${rel} AND ${effPublished} < ${pub})
       OR (${effRelevance} = ${rel} AND ${effPublished} = ${pub} AND ${schema.items.id} < ${id})`
    );
  }

  const rows = await (filters.length > 0 ? q.where(and(...filters)) : q)
    .orderBy(desc(effRelevance), desc(effPublished), desc(schema.items.id))
    .limit(PAGE_SIZE * 2); // overfetch to absorb hidden filtering

  const visible = rows.filter((r) => !hiddenIds.has(r.id)).slice(0, PAGE_SIZE);
  const last = visible[visible.length - 1];
  // Strip helper fields from the response.
  const items = visible.map(({ effRel, effPub, ...rest }) => rest);
  const nextCursor = last
    ? `${last.effRel}:${last.effPub ?? 0}:${last.id}`
    : null;

  return c.json({ items, nextCursor });
});

// Embedding-based recommendations: items similar to what the user has liked/lingered on.
feedRoutes.get("/related", async (c) => {
  const excludeIds = (c.req.query("excludeIds") ?? "")
    .split(",")
    .map(Number)
    .filter(Boolean);
  const limit = Math.min(Number(c.req.query("limit") ?? "6"), 20);

  const centroid = await computeInterestCentroid();
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

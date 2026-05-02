import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, raw, schema } from "../db/index.ts";

export const itemRoutes = new Hono();

itemRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      author: schema.items.author,
      publishedAt: schema.items.publishedAt,
      imageUrl: schema.items.imageUrl,
      contentHtml: schema.items.contentHtml,
      contentText: schema.items.contentText,
      sourceTitle: schema.sources.title,
      sourceKind: schema.sources.kind,
      relevance: schema.scores.relevance,
      rationale: schema.scores.rationale,
    })
    .from(schema.items)
    .leftJoin(schema.scores, eq(schema.scores.itemId, schema.items.id))
    .leftJoin(schema.sources, eq(schema.sources.id, schema.items.sourceId))
    .where(eq(schema.items.id, id))
    .get();

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});

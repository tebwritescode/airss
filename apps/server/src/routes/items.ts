import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { extractFromUrl } from "../enricher/extract.ts";

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

  // If the full article hasn't been extracted yet, do it now so the reader
  // has real content immediately — don't make the user follow an external link.
  if (!row.contentHtml && row.url) {
    const ext = await extractFromUrl(row.url);
    if (ext) {
      row.contentHtml = ext.html ?? null;
      row.contentText = ext.text ?? row.contentText;
      row.imageUrl = row.imageUrl ?? ext.imageUrl ?? null;
      // Cache it so future loads are instant.
      await db
        .update(schema.items)
        .set({ contentHtml: row.contentHtml, contentText: row.contentText, imageUrl: row.imageUrl })
        .where(eq(schema.items.id, id));
    }
  }

  return c.json({ item: row });
});

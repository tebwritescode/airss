import { Hono } from "hono";
import { fetchAllDue } from "../fetcher/index.ts";
import { enrichBacklog } from "../enricher/index.ts";
import { db, schema } from "../db/index.ts";
import { getItemEmbedding, getProfileEmbedding } from "../enricher/embed.ts";
import { scoreAndStoreBatch, computeInterestCentroid } from "../enricher/score.ts";

export const refreshRoutes = new Hono();

refreshRoutes.post("/", async (c) => {
  const f = await fetchAllDue();
  const e = await enrichBacklog(500);
  return c.json({ checked: f.checked, inserted: f.inserted, enrichQueued: e });
});

// One-shot drain — queues *every* unenriched item. Use after an OPML import
// or when the backlog is large.
refreshRoutes.post("/enrich-all", async (c) => {
  const e = await enrichBacklog(100_000);
  return c.json({ enrichQueued: e });
});

// Rescore all items with the current interest centroid (embeddings must exist).
// Called automatically after the interest centroid changes meaningfully.
refreshRoutes.post("/rescore", async (c) => {
  const profile = await getProfileEmbedding();
  const interest = await computeInterestCentroid();
  const items = await db.select({ id: schema.items.id }).from(schema.items);
  let rescored = 0;
  for (const item of items) {
    const vec = await getItemEmbedding(item.id);
    if (!vec) continue;
    await scoreAndStoreBatch(item.id, vec, { profile, interest });
    rescored++;
  }
  return c.json({ rescored });
});

import { Hono } from "hono";
import { fetchAllDue } from "../fetcher/index.ts";
import { enrichBacklog } from "../enricher/index.ts";
import { db, schema } from "../db/index.ts";
import { getItemEmbedding } from "../enricher/embed.ts";
import { scoreAndStore } from "../enricher/score.ts";

export const refreshRoutes = new Hono();

refreshRoutes.post("/", async (c) => {
  const f = await fetchAllDue();
  const e = await enrichBacklog(200);
  return c.json({ checked: f.checked, inserted: f.inserted, enrichQueued: e });
});

// Rescore all items with the current interest centroid (embeddings must exist).
// Called automatically after the interest centroid changes meaningfully.
refreshRoutes.post("/rescore", async (c) => {
  const items = await db.select({ id: schema.items.id }).from(schema.items);
  let rescored = 0;
  for (const item of items) {
    const vec = await getItemEmbedding(item.id);
    if (!vec) continue;
    await scoreAndStore(item.id, vec);
    rescored++;
  }
  return c.json({ rescored });
});

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { refreshProfileEmbedding } from "../enricher/embed.ts";

export const profileRoutes = new Hono();

profileRoutes.get("/", async (c) => {
  const p = await db.query.profile.findFirst();
  return c.json({ profile: p ?? { promptText: "" } });
});

profileRoutes.put("/", async (c) => {
  const Body = z.object({ promptText: z.string().max(8000) });
  const { promptText } = Body.parse(await c.req.json());
  const existing = await db.query.profile.findFirst();
  if (existing) {
    await db
      .update(schema.profile)
      .set({ promptText, updatedAt: new Date() })
      .where(eq(schema.profile.id, existing.id));
  } else {
    await db.insert(schema.profile).values({ promptText });
  }
  // Re-embed in the background so future scoring uses the new prompt.
  refreshProfileEmbedding().catch((err) =>
    console.error("[profile] embedding refresh failed:", err instanceof Error ? err.message : err)
  );
  return c.json({ ok: true });
});

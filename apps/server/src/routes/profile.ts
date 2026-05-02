import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { refreshProfileEmbedding } from "../enricher/embed.ts";
import { generateAIProfile, isRegenerating, lastRegenAt } from "../enricher/profile-ai.ts";

const MANUAL_COOLDOWN_MS = 30 * 1000;

export const profileRoutes = new Hono();

profileRoutes.get("/", async (c) => {
  const p = await db.query.profile.findFirst();
  return c.json({ profile: p ?? { promptText: "", updatedAt: null } });
});

// Manual text override (user can still edit the AI-generated profile).
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
  refreshProfileEmbedding().catch((err) =>
    console.error("[profile] embedding refresh failed:", err instanceof Error ? err.message : err)
  );
  return c.json({ ok: true });
});

// Trigger an immediate AI profile regeneration.
profileRoutes.post("/regenerate", async (c) => {
  if (isRegenerating()) {
    return c.json({ ok: false, error: "regen already in progress" }, 429);
  }
  const since = Date.now() - (await lastRegenAt());
  if (since < MANUAL_COOLDOWN_MS) {
    const wait = Math.ceil((MANUAL_COOLDOWN_MS - since) / 1000);
    return c.json({ ok: false, error: `cooldown — try again in ${wait}s` }, 429);
  }
  const text = await generateAIProfile();
  if (!text) return c.json({ ok: false, error: "LLM call failed — is a provider configured?" }, 503);
  return c.json({ ok: true, profile: text });
});

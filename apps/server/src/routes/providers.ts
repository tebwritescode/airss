import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { encryptKey } from "../crypto/keys.ts";
import { invalidateProviderCache } from "../ai/registry.ts";

export const providerRoutes = new Hono();

providerRoutes.get("/", async (c) => {
  const keys = await db
    .select({ provider: schema.providerKeys.provider, createdAt: schema.providerKeys.createdAt })
    .from(schema.providerKeys);
  const config = await db.select().from(schema.providerConfig);
  return c.json({ keys, config });
});

providerRoutes.post("/keys", async (c) => {
  const Body = z.object({
    provider: z.enum(["anthropic", "openai", "openrouter", "ollama"]),
    key: z.string().min(1),
  });
  const { provider, key } = Body.parse(await c.req.json());
  const enc = encryptKey(key);
  await db
    .insert(schema.providerKeys)
    .values({ provider, ciphertext: enc.ciphertext, nonce: enc.nonce })
    .onConflictDoUpdate({
      target: schema.providerKeys.provider,
      set: { ciphertext: enc.ciphertext, nonce: enc.nonce, createdAt: new Date() },
    });
  invalidateProviderCache(provider);
  return c.json({ ok: true });
});

providerRoutes.delete("/keys/:provider", async (c) => {
  const provider = c.req.param("provider") as "anthropic" | "openai" | "openrouter" | "ollama";
  await db.delete(schema.providerKeys).where(eq(schema.providerKeys.provider, provider));
  invalidateProviderCache(provider);
  return c.json({ ok: true });
});

providerRoutes.put("/config/:task", async (c) => {
  const task = c.req.param("task") as "embed" | "score_judge" | "summarize" | "digest";
  const Body = z.object({
    provider: z.enum(["anthropic", "openai", "openrouter", "ollama"]),
    model: z.string().min(1),
  });
  const body = Body.parse(await c.req.json());
  await db
    .insert(schema.providerConfig)
    .values({ task, provider: body.provider, model: body.model })
    .onConflictDoUpdate({
      target: schema.providerConfig.task,
      set: { provider: body.provider, model: body.model },
    });
  return c.json({ ok: true });
});

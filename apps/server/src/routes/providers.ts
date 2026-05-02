import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { encryptKey } from "../crypto/keys.ts";
import { invalidateProviderCache } from "../ai/registry.ts";

export const providerRoutes = new Hono();

providerRoutes.get("/", async (c) => {
  const keys = await db
    .select({
      provider: schema.providerKeys.provider,
      baseUrl: schema.providerKeys.baseUrl,
      hasKey: schema.providerKeys.ciphertext, // returned as "" or non-empty; client only checks truthiness
      createdAt: schema.providerKeys.createdAt,
    })
    .from(schema.providerKeys);
  // Don't ship raw ciphertexts; only signal whether a key is set.
  const safeKeys = keys.map((k) => ({
    provider: k.provider,
    baseUrl: k.baseUrl,
    hasKey: !!k.hasKey,
    createdAt: k.createdAt,
  }));
  const config = await db.select().from(schema.providerConfig);
  return c.json({ keys: safeKeys, config });
});

providerRoutes.post("/keys", async (c) => {
  const Body = z.object({
    provider: z.enum(["anthropic", "openai", "openrouter", "ollama"]),
    // Empty string allowed for keyless providers (Ollama).
    key: z.string().default(""),
    // Optional override of the provider's HTTP base URL. Pass empty string or
    // omit to use the default. Validated as a URL when provided.
    baseUrl: z.string().url().nullish().or(z.literal("")),
  });
  const body = Body.parse(await c.req.json());

  const enc = body.key ? await encryptKey(body.key) : { ciphertext: "", nonce: "" };
  const baseUrl = body.baseUrl ? body.baseUrl : null;

  await db
    .insert(schema.providerKeys)
    .values({
      provider: body.provider,
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      baseUrl,
    })
    .onConflictDoUpdate({
      target: schema.providerKeys.provider,
      set: {
        // Only overwrite ciphertext when a new key is actually provided so the
        // user can update just the baseUrl without re-pasting their secret.
        ...(body.key
          ? { ciphertext: enc.ciphertext, nonce: enc.nonce }
          : {}),
        baseUrl,
        createdAt: new Date(),
      },
    });
  invalidateProviderCache(body.provider);
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

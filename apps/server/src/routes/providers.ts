import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { encryptKey, decryptKey } from "../crypto/keys.ts";
import { invalidateProviderCache } from "../ai/registry.ts";

export const providerRoutes = new Hono();

// Hardcoded model menus for providers without a public model-list API.
const STATIC_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
  ollama: [
    "llama3",
    "llama3.1",
    "llama3.2",
    "qwen2.5",
    "mistral",
    "nomic-embed-text",
    "mxbai-embed-large",
  ],
};

// Cache the OpenRouter / OpenAI model lists in memory; they change rarely.
const modelCache = new Map<string, { ts: number; models: string[] }>();
const CACHE_MS = 60 * 60 * 1000;

async function fetchOpenRouterModels(_apiKey: string, baseUrl: string | null): Promise<string[]> {
  const url = `${baseUrl || "https://openrouter.ai/api/v1"}/models`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const data = (await res.json()) as { data: { id: string }[] };
  return data.data.map((m) => m.id).sort();
}

async function fetchOpenAIModels(apiKey: string, baseUrl: string | null): Promise<string[]> {
  const url = `${baseUrl || "https://api.openai.com/v1"}/models`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const data = (await res.json()) as { data: { id: string }[] };
  return data.data.map((m) => m.id).sort();
}

async function fetchOllamaModels(_apiKey: string, baseUrl: string | null): Promise<string[]> {
  const url = `${baseUrl || "http://localhost:11434"}/api/tags`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const data = (await res.json()) as { models: { name: string }[] };
  return data.models.map((m) => m.name).sort();
}

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

// List available models for a provider — used by the searchable model picker.
providerRoutes.get("/models/:provider", async (c) => {
  const provider = c.req.param("provider");
  const cacheKey = provider;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return c.json({ models: cached.models, cached: true });
  }

  // Static menu when there's no API to query.
  if (provider === "anthropic" || provider === "ollama") {
    if (provider === "anthropic" || !STATIC_MODELS[provider]) {
      return c.json({ models: STATIC_MODELS[provider] ?? [], cached: false });
    }
    // Try a live ollama tags call; fall back to static if unreachable.
    const row = await db.query.providerKeys.findFirst({ where: eq(schema.providerKeys.provider, "ollama") });
    try {
      const models = await fetchOllamaModels("", row?.baseUrl ?? null);
      modelCache.set(cacheKey, { ts: Date.now(), models });
      return c.json({ models, cached: false });
    } catch {
      return c.json({ models: STATIC_MODELS.ollama, cached: false });
    }
  }

  // Live fetch for openai / openrouter — needs the saved key.
  const row = await db.query.providerKeys.findFirst({
    where: eq(schema.providerKeys.provider, provider as any),
  });
  if (!row || !row.ciphertext) return c.json({ models: [], error: "no_key" }, 200);

  try {
    const apiKey = await decryptKey(row.ciphertext, row.nonce);
    const fetcher = provider === "openrouter" ? fetchOpenRouterModels : fetchOpenAIModels;
    const models = await fetcher(apiKey, row.baseUrl);
    modelCache.set(cacheKey, { ts: Date.now(), models });
    return c.json({ models, cached: false });
  } catch (err) {
    return c.json({ models: [], error: (err as Error).message }, 200);
  }
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

import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { decryptKey } from "../crypto/keys.ts";
import type { Provider, ProviderName, Task } from "./provider.ts";
import { makeAnthropic } from "./anthropic.ts";
import { makeOpenAI, makeOpenRouter } from "./openai.ts";
import { makeOllama } from "./ollama.ts";

const cache = new Map<ProviderName, Provider>();

export async function getProvider(name: ProviderName): Promise<Provider> {
  const cached = cache.get(name);
  if (cached) return cached;

  const row = await db.query.providerKeys.findFirst({ where: eq(schema.providerKeys.provider, name) });

  if (name === "ollama") {
    const p = makeOllama(row?.baseUrl ?? null);
    cache.set(name, p);
    return p;
  }

  if (!row || !row.ciphertext) throw new Error(`No API key configured for provider: ${name}`);
  const key = await decryptKey(row.ciphertext, row.nonce);
  const baseUrl = row.baseUrl ?? null;

  const p =
    name === "anthropic" ? makeAnthropic(key, baseUrl) :
    name === "openai" ? makeOpenAI(key, baseUrl) :
    name === "openrouter" ? makeOpenRouter(key, baseUrl) :
    (() => { throw new Error(`Unknown provider: ${name}`); })();

  cache.set(name, p);
  return p;
}

export function invalidateProviderCache(name?: ProviderName) {
  if (name) cache.delete(name);
  else cache.clear();
}

export async function getTaskConfig(task: Task): Promise<{ provider: ProviderName; model: string }> {
  const row = await db.query.providerConfig.findFirst({ where: eq(schema.providerConfig.task, task) });
  if (!row) {
    return DEFAULTS[task];
  }
  return { provider: row.provider, model: row.model };
}

const DEFAULTS: Record<Task, { provider: ProviderName; model: string }> = {
  embed: { provider: "openai", model: "text-embedding-3-small" },
  score_judge: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  summarize: { provider: "anthropic", model: "claude-sonnet-4-6" },
  digest: { provider: "anthropic", model: "claude-opus-4-7" },
};

const DEFAULT_CHAT_MODEL: Record<ProviderName, string> = {
  anthropic:  "claude-haiku-4-5-20251001",
  openrouter: "anthropic/claude-3.5-haiku",
  openai:     "gpt-4o-mini",
  ollama:     "llama3",
};

export function getDefaultChatModel(name: ProviderName): string {
  return DEFAULT_CHAT_MODEL[name];
}

/**
 * Returns a chat-capable provider, preferring the one configured for `task`,
 * but falling back to any other provider that has a key. Throws only if no
 * provider has a key.
 */
export async function getChatProviderWithFallback(
  task: Task
): Promise<{ provider: Provider; model: string; usedFallback: boolean }> {
  const cfg = await getTaskConfig(task);
  try {
    const p = await getProvider(cfg.provider);
    return { provider: p, model: cfg.model, usedFallback: false };
  } catch {
    const keys = await db
      .select({ provider: schema.providerKeys.provider, ciphertext: schema.providerKeys.ciphertext })
      .from(schema.providerKeys);
    const candidate = keys.find((k) => k.ciphertext !== "" || k.provider === "ollama");
    if (!candidate) throw new Error("No chat provider configured");
    const p = await getProvider(candidate.provider as ProviderName);
    return { provider: p, model: getDefaultChatModel(candidate.provider as ProviderName), usedFallback: true };
  }
}

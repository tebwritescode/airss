import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getProvider, getTaskConfig } from "../ai/registry.ts";
import { refreshProfileEmbedding, getItemEmbedding, getProfileEmbedding } from "./embed.ts";
import { scoreAndStoreBatch, computeInterestCentroid } from "./score.ts";
import type { Provider } from "../ai/provider.ts";

// Regenerate after this many new engagement signals accumulate.
const SIGNAL_THRESHOLD = 8;
const MAX_ITEMS_IN_PROMPT = 40;
const REGEN_COOLDOWN_MS = 60 * 1000; // minimum gap between regenerations

// In-process guard against concurrent regenerations (auto-tick + manual /regenerate).
let regenerating = false;

export function isRegenerating(): boolean { return regenerating; }
export async function lastRegenAt(): Promise<number> {
  const p = await db.query.profile.findFirst();
  return p?.updatedAt?.getTime() ?? 0;
}

/**
 * Check whether enough new signals have come in since the last profile
 * update to justify an AI regeneration. Runs on every scheduler tick.
 */
export async function maybeRegenerateProfile(): Promise<void> {
  if (regenerating) return;
  const profile = await db.query.profile.findFirst();
  const lastUpdate = profile?.updatedAt?.getTime() ?? 0;

  // Don't burn tokens running again right after a successful regen.
  if (Date.now() - lastUpdate < REGEN_COOLDOWN_MS && profile?.promptText) return;

  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.signals)
    .where(
      sql`ts > ${lastUpdate} AND kind IN ('like','share','open','dwell_ms')`
    );

  const newSignals = Number(row?.n ?? 0);

  // Always run on first boot (no profile) or when enough new signals arrive.
  if (profile?.promptText && newSignals < SIGNAL_THRESHOLD) return;

  await generateAIProfile();
}

/**
 * Build an LLM-based interest profile from what the user subscribes to
 * and how they interact with content. Updates profile.promptText,
 * re-embeds it, and rescores every item.
 */
export async function generateAIProfile(): Promise<string | null> {
  if (regenerating) return null;
  regenerating = true;
  try {
    return await generateAIProfileInner();
  } finally {
    regenerating = false;
  }
}

async function generateAIProfileInner(): Promise<string | null> {
  // ── Gather context ─────────────────────────────────────────────────
  const sources = await db
    .select({ url: schema.sources.url, title: schema.sources.title, kind: schema.sources.kind })
    .from(schema.sources)
    .where(eq(schema.sources.enabled, true));

  // Engagement signals (most recent first)
  const signals = await db
    .select({ itemId: schema.signals.itemId, kind: schema.signals.kind, value: schema.signals.value })
    .from(schema.signals)
    .where(sql`kind IN ('like','share','open') OR (kind = 'dwell_ms' AND value >= 4000)`)
    .orderBy(desc(schema.signals.ts))
    .limit(MAX_ITEMS_IN_PROMPT * 2);

  const engagedIds = [...new Set(signals.map((s) => s.itemId))].slice(0, MAX_ITEMS_IN_PROMPT);
  const strongIds = new Set(
    signals.filter((s) => s.kind === "like" || s.kind === "share").map((s) => s.itemId)
  );

  let engagedItems: { id: number; title: string; contentText: string | null }[] = [];
  if (engagedIds.length > 0) {
    engagedItems = await db
      .select({ id: schema.items.id, title: schema.items.title, contentText: schema.items.contentText })
      .from(schema.items)
      .where(inArray(schema.items.id, engagedIds));
  }

  // Most recent feed items (shows what the user is being exposed to)
  const recentItems = await db
    .select({ title: schema.items.title })
    .from(schema.items)
    .orderBy(desc(schema.items.createdAt))
    .limit(30);

  // ── Build prompt ───────────────────────────────────────────────────
  const sourceList = sources
    .map((s) => `  - ${s.title || s.url} (${s.kind})`)
    .join("\n") || "  (none yet)";

  const engagedList = engagedItems.length
    ? engagedItems.map((i) => `  - ${i.title}`).join("\n")
    : "  (none yet)";

  const strongList = engagedItems.filter((i) => strongIds.has(i.id)).length
    ? engagedItems.filter((i) => strongIds.has(i.id)).map((i) => `  - ${i.title}`).join("\n")
    : "  (none yet)";

  const recentList = recentItems.map((i) => `  - ${i.title}`).join("\n") || "  (none yet)";

  const userMessage = `Build an interest profile for a personal news reader based on the data below.

SUBSCRIBED SOURCES:
${sourceList}

ITEMS THE USER READ OR SPENT TIME ON:
${engagedList}

ITEMS THE USER EXPLICITLY LIKED OR SHARED:
${strongList}

RECENT ITEMS IN THEIR FEED (context for topic areas):
${recentList}

Write a concise interest profile (3-5 sentences). Rules:
- Be specific: name actual topics, technologies, domains, and story types — not vague categories like "technology"
- Infer what they DON'T want based on what they skip (items in feed but never opened)
- Write in second person: "You are interested in..."
- Plain prose only — no bullet points, headers, or markdown
- End with one sentence about what to deprioritize`;

  // ── Call LLM ───────────────────────────────────────────────────────
  try {
    // Try the configured summarize provider first; fall back to any keyed provider.
    const cfg = await getTaskConfig("summarize");
    let provider: Provider;
    let model: string;
    try {
      provider = await getProvider(cfg.provider);
      model = cfg.model;
    } catch {
      // Configured provider has no key — try any provider that has a key
      const keys = await db.select({ provider: schema.providerKeys.provider, ciphertext: schema.providerKeys.ciphertext })
        .from(schema.providerKeys)
        .where(sql`ciphertext != ''`);
      const fallback = keys.find((k) => k.provider !== cfg.provider);
      if (!fallback) throw new Error("No chat provider configured");
      provider = await getProvider(fallback.provider as any);
      model = fallback.provider === "anthropic" ? "claude-haiku-4-5-20251001"
            : fallback.provider === "openrouter" ? "anthropic/claude-3.5-haiku"
            : fallback.provider === "openai"     ? "gpt-4o-mini"
            : "llama3";
    }

    const resp = await provider.chat({
      model,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You are a recommendation engine assistant. Your job is to write accurate, specific interest profiles that help rank news articles for a user.",
        },
        { role: "user", content: userMessage },
      ],
    });

    const profileText = resp.text.trim();
    if (!profileText) return null;

    // ── Persist ────────────────────────────────────────────────────────
    const existing = await db.query.profile.findFirst();
    if (existing) {
      await db
        .update(schema.profile)
        .set({ promptText: profileText, updatedAt: new Date() })
        .where(eq(schema.profile.id, existing.id));
    } else {
      await db.insert(schema.profile).values({ promptText: profileText });
    }

    // Re-embed the new profile so cosine scoring uses it immediately.
    await refreshProfileEmbedding();

    // Rescore all items with the updated profile in the background.
    rescoreAll().catch((e) =>
      console.error("[profile-ai] rescore failed:", e instanceof Error ? e.message : e)
    );

    console.log(`[profile-ai] regenerated (${resp.inputTokens ?? "?"}→${resp.outputTokens ?? "?"} tokens)`);
    return profileText;
  } catch (err) {
    console.warn("[profile-ai] LLM call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function rescoreAll(): Promise<void> {
  // Compute the centroid + profile once, then score every item against them.
  // Avoids the O(N * 150) embedding fetches the per-item path triggered.
  const profile = await getProfileEmbedding();
  const interest = await computeInterestCentroid();
  const items = await db.select({ id: schema.items.id }).from(schema.items);
  let n = 0;
  for (const item of items) {
    const vec = await getItemEmbedding(item.id);
    if (!vec) continue;
    await scoreAndStoreBatch(item.id, vec, { profile, interest });
    n++;
  }
  console.log(`[profile-ai] rescored ${n} items`);
}

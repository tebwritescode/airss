import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { cosine, getItemEmbedding, getProfileEmbedding } from "./embed.ts";

const LIKE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RECENT_LIKE_LIMIT = 50;
const FEED_ITEM_LIMIT = 100;

// Weight of one feed item relative to one explicit like (1.0).
// 10 feed items ≈ 1 like, so subscribed content shapes scoring softly
// but explicit engagement dominates once it exists.
const FEED_ITEM_WEIGHT = 0.1;

export interface ScoreInput {
  itemId: number;
  itemEmbedding: number[];
}

export interface ScoreResult {
  relevance: number;
  rationale: string;
}

export async function scoreItem(input: ScoreInput): Promise<ScoreResult> {
  const profile = await getProfileEmbedding();
  const interestCentroid = await computeInterestCentroid();

  const profileSim   = profile         ? cosine(input.itemEmbedding, profile)         : 0;
  const interestSim  = interestCentroid ? cosine(input.itemEmbedding, interestCentroid) : 0;

  let relevance: number;
  let rationale: string;

  if (profile && interestCentroid) {
    relevance = 0.6 * profileSim + 0.4 * interestSim;
    rationale = `profile_sim=${profileSim.toFixed(3)} interest_sim=${interestSim.toFixed(3)}`;
  } else if (profile) {
    relevance = profileSim;
    rationale = `profile_sim=${profileSim.toFixed(3)} (no feed signals yet)`;
  } else if (interestCentroid) {
    relevance = interestSim;
    rationale = `interest_sim=${interestSim.toFixed(3)} (no profile prompt)`;
  } else {
    relevance = 0.5;
    rationale = "no signals yet — neutral";
  }

  // Map cosine [-1,1] to [0,1]: 0.5 + sim/2
  relevance = clamp01(0.5 + relevance / 2);
  return { relevance, rationale };
}

export async function scoreAndStore(itemId: number, itemEmbedding: number[]): Promise<ScoreResult> {
  const r = await scoreItem({ itemId, itemEmbedding });
  await persistScore(itemId, r);
  return r;
}

// Like scoreAndStore but accepts a precomputed centroid + profile so a batch
// of items can be scored without recomputing the centroid for each one.
export async function scoreAndStoreBatch(
  itemId: number,
  itemEmbedding: number[],
  ctx: { profile: number[] | null; interest: number[] | null }
): Promise<ScoreResult> {
  const profileSim  = ctx.profile  ? cosine(itemEmbedding, ctx.profile)  : 0;
  const interestSim = ctx.interest ? cosine(itemEmbedding, ctx.interest) : 0;

  let relevance: number;
  let rationale: string;
  if (ctx.profile && ctx.interest) {
    relevance = 0.6 * profileSim + 0.4 * interestSim;
    rationale = `profile_sim=${profileSim.toFixed(3)} interest_sim=${interestSim.toFixed(3)}`;
  } else if (ctx.profile)  { relevance = profileSim;  rationale = `profile_sim=${profileSim.toFixed(3)} (no feed signals yet)`; }
    else if (ctx.interest) { relevance = interestSim; rationale = `interest_sim=${interestSim.toFixed(3)} (no profile prompt)`; }
    else                   { relevance = 0.5;         rationale = "no signals yet — neutral"; }

  relevance = clamp01(0.5 + relevance / 2);
  if (!Number.isFinite(relevance)) relevance = 0.5;
  const r = { relevance, rationale };
  await persistScore(itemId, r);
  return r;
}

async function persistScore(itemId: number, r: ScoreResult): Promise<void> {
  await db
    .insert(schema.scores)
    .values({ itemId, relevance: r.relevance, rationale: r.rationale, model: "embedding-blend-v1" })
    .onConflictDoUpdate({
      target: schema.scores.itemId,
      set: { relevance: r.relevance, rationale: r.rationale, model: "embedding-blend-v1", scoredAt: new Date() },
    });
}

/**
 * Blended interest centroid combining:
 *   1. Explicit signals  — like / share (weight 1.0) and long dwell ≥5 s (weight proportional)
 *   2. Feed baseline     — every subscribed item at low weight (0.1),
 *                          so the user's chosen sources shape scoring from day one
 *
 * Explicit engagement still dominates: one like outweighs ten feed items.
 */
export async function computeInterestCentroid(): Promise<number[] | null> {
  const now = Date.now();
  let acc: number[] | null = null;
  let weightSum = 0;

  // ── 1. Explicit engagement signals ────────────────────────────────────
  const signals = await db
    .select({ itemId: schema.signals.itemId, ts: schema.signals.ts, value: schema.signals.value, kind: schema.signals.kind })
    .from(schema.signals)
    .where(sql`kind IN ('like','share') OR (kind = 'dwell_ms' AND value >= 5000)`)
    .orderBy(desc(schema.signals.ts))
    .limit(RECENT_LIKE_LIMIT);

  for (const sig of signals) {
    const vec = await getItemEmbedding(sig.itemId);
    if (!vec) continue;
    const ageMs = now - sig.ts.getTime();
    const base = sig.kind === "dwell_ms" ? Math.min(sig.value / 30000, 0.8) : 1.0;
    const w = base * Math.pow(0.5, ageMs / LIKE_HALF_LIFE_MS);
    if (!acc) acc = new Array(vec.length).fill(0);
    for (let i = 0; i < vec.length; i++) acc[i]! += vec[i]! * w;
    weightSum += w;
  }

  // ── 2. Feed baseline — all subscribed items at low weight ─────────────
  const feedItems = await db
    .select({ id: schema.items.id, createdAt: schema.items.createdAt })
    .from(schema.items)
    .orderBy(desc(schema.items.createdAt))
    .limit(FEED_ITEM_LIMIT);

  for (const item of feedItems) {
    const vec = await getItemEmbedding(item.id);
    if (!vec) continue;
    const ageMs = now - item.createdAt.getTime();
    const w = FEED_ITEM_WEIGHT * Math.pow(0.5, ageMs / LIKE_HALF_LIFE_MS);
    if (!acc) acc = new Array(vec.length).fill(0);
    for (let i = 0; i < vec.length; i++) acc[i]! += vec[i]! * w;
    weightSum += w;
  }

  // Guard against ages so old that all weights collapse to ~0; would make centroid NaN.
  if (!acc || weightSum < 1e-6) return null;
  for (let i = 0; i < acc.length; i++) acc[i] = acc[i]! / weightSum;
  return acc;
}

// Keep old name as alias so the feed/related route still compiles.
export const computeLikedCentroid = computeInterestCentroid;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

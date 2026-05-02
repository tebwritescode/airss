import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { cosine, getItemEmbedding, getProfileEmbedding } from "./embed.ts";

const LIKE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RECENT_LIKE_LIMIT = 50;

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
  const likedCentroid = await computeLikedCentroid();

  const profileSim = profile ? cosine(input.itemEmbedding, profile) : 0;
  const likedSim = likedCentroid ? cosine(input.itemEmbedding, likedCentroid) : 0;

  // Weighted blend. If profile is missing, lean entirely on likes; if both missing, neutral 0.5.
  let relevance: number;
  let rationale: string;
  if (profile && likedCentroid) {
    relevance = 0.6 * profileSim + 0.4 * likedSim;
    rationale = `profile_sim=${profileSim.toFixed(3)} liked_sim=${likedSim.toFixed(3)}`;
  } else if (profile) {
    relevance = profileSim;
    rationale = `profile_sim=${profileSim.toFixed(3)} (no likes yet)`;
  } else if (likedCentroid) {
    relevance = likedSim;
    rationale = `liked_sim=${likedSim.toFixed(3)} (no profile prompt)`;
  } else {
    relevance = 0.5;
    rationale = "no profile or likes — neutral";
  }

  // Map cosine [-1,1] roughly to [0,1] for display; centered around 0.5 + sim/2.
  relevance = clamp01(0.5 + relevance / 2);
  return { relevance, rationale };
}

export async function scoreAndStore(itemId: number, itemEmbedding: number[]): Promise<ScoreResult> {
  const r = await scoreItem({ itemId, itemEmbedding });
  await db
    .insert(schema.scores)
    .values({ itemId, relevance: r.relevance, rationale: r.rationale, model: "embedding-blend-v1" })
    .onConflictDoUpdate({
      target: schema.scores.itemId,
      set: { relevance: r.relevance, rationale: r.rationale, model: "embedding-blend-v1", scoredAt: new Date() },
    });
  return r;
}

// Exported so the /feed/related route can reuse it.
export async function computeLikedCentroid(): Promise<number[] | null> {
  // Pull recent likes AND long dwells (>5 s), decayed by recency.
  const likes = await db
    .select({ itemId: schema.signals.itemId, ts: schema.signals.ts, value: schema.signals.value, kind: schema.signals.kind })
    .from(schema.signals)
    .where(sql`kind IN ('like','share') OR (kind = 'dwell_ms' AND value >= 5000)`)
    .orderBy(desc(schema.signals.ts))
    .limit(RECENT_LIKE_LIMIT);

  if (likes.length === 0) return null;

  const now = Date.now();
  let acc: number[] | null = null;
  let weightSum = 0;

  for (const like of likes) {
    const vec = await getItemEmbedding(like.itemId);
    if (!vec) continue;
    const ageMs = now - like.ts.getTime();
    // dwell signals carry weight proportional to seconds spent (capped at 0.8 of a full like)
    const baseWeight = like.kind === "dwell_ms" ? Math.min(like.value / 30000, 0.8) : 1;
    const w = baseWeight * Math.pow(0.5, ageMs / LIKE_HALF_LIFE_MS);
    if (!acc) acc = new Array(vec.length).fill(0);
    for (let i = 0; i < vec.length; i++) acc[i]! += vec[i]! * w;
    weightSum += w;
  }
  if (!acc || weightSum === 0) return null;
  for (let i = 0; i < acc.length; i++) acc[i] = acc[i]! / weightSum;
  return acc;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

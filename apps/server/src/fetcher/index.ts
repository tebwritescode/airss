import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import type { FetchedItem, Fetcher } from "./types.ts";
import { rssFetcher } from "./rss.ts";
import { redditFetcher } from "./reddit.ts";
import { youtubeFetcher } from "./youtube.ts";
import { webFetcher } from "./web.ts";

const FETCHERS: Record<string, Fetcher> = {
  rss: rssFetcher,
  reddit: redditFetcher,
  youtube: youtubeFetcher,
  web: webFetcher,
};

// Cap the per-source backoff so a permanently dead source eventually gets
// retried (in case the user fixes the URL or it comes back online).
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 hours

function backoffFor(failures: number): number {
  // 1 → 1 min, 2 → 4 min, 3 → 9 min, 4 → 16 min, ... capped.
  return Math.min(MAX_BACKOFF_MS, failures * failures * 60_000);
}

export async function fetchSource(sourceId: number): Promise<{ inserted: number; total: number }> {
  const src = await db.query.sources.findFirst({ where: eq(schema.sources.id, sourceId) });
  if (!src) throw new Error(`source ${sourceId} not found`);
  if (!src.enabled) return { inserted: 0, total: 0 };

  const fetcher = FETCHERS[src.kind];
  if (!fetcher) throw new Error(`no fetcher for kind=${src.kind}`);

  try {
    const result = await fetcher({ url: src.url, etag: src.etag, lastModified: src.lastModified });

    await db
      .update(schema.sources)
      .set({
        etag: result.etag ?? src.etag,
        lastModified: result.lastModified ?? src.lastModified,
        lastFetchedAt: new Date(),
        consecutiveFailures: 0,
        nextRetryAt: null,
        lastError: null,
        ...(result.sourceTitle && !src.title ? { title: result.sourceTitle } : {}),
      })
      .where(eq(schema.sources.id, sourceId));

    if (result.notModified || result.items.length === 0) return { inserted: 0, total: 0 };

    const inserted = await insertNew(sourceId, result.items);
    return { inserted, total: result.items.length };
  } catch (err) {
    // Record failure + schedule next retry with exponential backoff.
    const failures = (src.consecutiveFailures ?? 0) + 1;
    const wait = backoffFor(failures);
    await db
      .update(schema.sources)
      .set({
        consecutiveFailures: failures,
        nextRetryAt: new Date(Date.now() + wait),
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        lastFetchedAt: new Date(),
      })
      .where(eq(schema.sources.id, sourceId));
    throw err;
  }
}

async function insertNew(sourceId: number, items: FetchedItem[]): Promise<number> {
  let inserted = 0;
  for (const it of items) {
    const r = await db
      .insert(schema.items)
      .values({
        sourceId,
        externalId: it.externalId,
        url: it.url,
        title: it.title,
        author: it.author,
        publishedAt: it.publishedAt,
        imageUrl: it.imageUrl,
        contentHtml: it.contentHtml,
        contentText: it.contentText,
      })
      .onConflictDoNothing({ target: [schema.items.sourceId, schema.items.externalId] })
      .returning({ id: schema.items.id });
    if (r.length > 0) inserted++;
  }
  return inserted;
}

export async function fetchAllDue(): Promise<{ checked: number; inserted: number }> {
  const now = Date.now();
  // A source is "due" if: enabled AND (no nextRetryAt OR nextRetryAt has passed)
  // AND (never fetched OR pollIntervalS has elapsed).
  const all = await db.query.sources.findMany({ where: eq(schema.sources.enabled, true) });
  const due = all.filter((s) => {
    if (s.nextRetryAt && s.nextRetryAt.getTime() > now) return false; // in backoff cooldown
    if (!s.lastFetchedAt) return true;
    return now - s.lastFetchedAt.getTime() >= s.pollIntervalS * 1000;
  });

  let inserted = 0;
  for (const s of due) {
    try {
      const r = await fetchSource(s.id);
      inserted += r.inserted;
    } catch (err) {
      // fetchSource already persisted the failure + backoff; just log here.
      console.error(`[fetcher] source=${s.id} url=${s.url} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: due.length, inserted };
}

import { eq } from "drizzle-orm";
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

export async function fetchSource(sourceId: number): Promise<{ inserted: number; total: number }> {
  const src = await db.query.sources.findFirst({ where: eq(schema.sources.id, sourceId) });
  if (!src) throw new Error(`source ${sourceId} not found`);
  if (!src.enabled) return { inserted: 0, total: 0 };

  const fetcher = FETCHERS[src.kind];
  if (!fetcher) throw new Error(`no fetcher for kind=${src.kind}`);

  const result = await fetcher({ url: src.url, etag: src.etag, lastModified: src.lastModified });

  await db
    .update(schema.sources)
    .set({
      etag: result.etag ?? src.etag,
      lastModified: result.lastModified ?? src.lastModified,
      lastFetchedAt: new Date(),
      ...(result.sourceTitle && !src.title ? { title: result.sourceTitle } : {}),
    })
    .where(eq(schema.sources.id, sourceId));

  if (result.notModified || result.items.length === 0) {
    return { inserted: 0, total: 0 };
  }

  const inserted = await insertNew(sourceId, result.items);
  return { inserted, total: result.items.length };
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
  const all = await db.query.sources.findMany({ where: eq(schema.sources.enabled, true) });
  const due = all.filter((s) => {
    if (!s.lastFetchedAt) return true;
    return now - s.lastFetchedAt.getTime() >= s.pollIntervalS * 1000;
  });

  let inserted = 0;
  for (const s of due) {
    try {
      const r = await fetchSource(s.id);
      inserted += r.inserted;
    } catch (err) {
      console.error(`[fetcher] source=${s.id} url=${s.url} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: due.length, inserted };
}

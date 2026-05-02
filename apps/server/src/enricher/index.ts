import { and, eq, isNull } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../db/index.ts";
import { extractFromUrl } from "./extract.ts";
import { embedText, storeItemEmbedding } from "./embed.ts";
import { scoreAndStore } from "./score.ts";

// 8 parallel enrichments — Ollama on GPU handles this easily, and even
// CPU embeds can keep up since extract+score is mostly I/O.
const queue = new PQueue({ concurrency: 8 });

export function enqueueEnrich(itemId: number): void {
  queue.add(() => enrichOne(itemId)).catch((err) => {
    console.error(`[enricher] item=${itemId} failed:`, err instanceof Error ? err.message : err);
  });
}

export async function enrichOne(itemId: number): Promise<void> {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (!item || item.enrichedAt) return;

  let imageUrl = item.imageUrl;
  let contentText = item.contentText;
  let contentHtml = item.contentHtml;

  // Always run Readability if we haven't extracted the full article yet.
  // A short RSS contentSnippet in contentText does NOT count — we need the full article.
  if (!contentHtml) {
    const ext = await extractFromUrl(item.url);
    if (ext) {
      contentText = ext.text ?? contentText; // prefer full Readability text over RSS snippet
      contentHtml = ext.html ?? contentHtml;
      imageUrl ??= ext.imageUrl;
    }
  }

  await db
    .update(schema.items)
    .set({ imageUrl, contentText, contentHtml, enrichedAt: new Date() })
    .where(eq(schema.items.id, itemId));

  // Embed + score (best-effort; if no embed provider configured, skip).
  try {
    const text = `${item.title}\n\n${(contentText ?? "").slice(0, 1500)}`;
    const vec = await embedText(text);
    await storeItemEmbedding(itemId, vec);
    await scoreAndStore(itemId, vec);
  } catch (err) {
    console.warn(`[enricher] item=${itemId} embed/score skipped:`, err instanceof Error ? err.message : err);
  }
}

export async function enrichBacklog(limit = 50): Promise<number> {
  const due = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(isNull(schema.items.enrichedAt))
    .limit(limit);
  for (const r of due) enqueueEnrich(r.id);
  return due.length;
}

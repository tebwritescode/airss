import Parser from "rss-parser";
import type { Fetcher, FetchedItem } from "./types.ts";
import { conditionalFetch } from "./http.ts";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "media:content", { keepArray: true }],
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ["enclosure", "enclosure"],
    ],
  },
});

export const rssFetcher: Fetcher = async (ctx) => {
  const r = await conditionalFetch(ctx.url, { etag: ctx.etag, lastModified: ctx.lastModified });
  if (r.status === 304) return { items: [], notModified: true, etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
  if (r.status >= 400) throw new Error(`rss fetch ${ctx.url} ${r.status}`);

  const feed = await parser.parseString(r.body);
  const items: FetchedItem[] = feed.items.map((it) => ({
    externalId: it.guid ?? it.id ?? it.link ?? `${it.title}-${it.pubDate ?? ""}`,
    url: it.link ?? "",
    title: it.title ?? "(untitled)",
    author: (it.creator ?? it.author)?.trim(),
    publishedAt: it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : undefined,
    imageUrl: extractImage(it),
    contentHtml: it["content:encoded"] ?? it.content,
    contentText: it.contentSnippet,
  }));

  return { items, sourceTitle: feed.title, etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
};

function extractImage(it: Record<string, any>): string | undefined {
  const mc = it["media:content"]?.[0]?.$?.url;
  if (mc) return mc;
  const mt = it["media:thumbnail"]?.[0]?.$?.url;
  if (mt) return mt;
  const enc = it.enclosure?.url;
  if (enc && /image/i.test(it.enclosure?.type ?? "")) return enc;
  // Fallback: first <img> in content.
  const html: string | undefined = it["content:encoded"] ?? it.content;
  if (!html) return undefined;
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m?.[1];
}

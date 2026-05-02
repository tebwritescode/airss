import { createHash } from "node:crypto";
import type { Fetcher, FetchedItem } from "./types.ts";
import { conditionalFetch } from "./http.ts";

// Fallback for sites without a feed. Polls the page; if the body hash changes,
// emits a single item representing "this page updated". Useful for changelogs,
// release notes, "press" pages — not for high-volume content sites.
export const webFetcher: Fetcher = async (ctx) => {
  const r = await conditionalFetch(ctx.url, {
    etag: ctx.etag,
    lastModified: ctx.lastModified,
    accept: "text/html,application/xhtml+xml",
  });
  if (r.status === 304) return { items: [], notModified: true, etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
  if (r.status >= 400) throw new Error(`web fetch ${ctx.url} ${r.status}`);

  const hash = createHash("sha1").update(r.body).digest("hex").slice(0, 16);
  const title = extractTitle(r.body) ?? ctx.url;
  const item: FetchedItem = {
    externalId: hash,
    url: ctx.url,
    title,
    publishedAt: new Date(),
    imageUrl: extractOgImage(r.body) ?? undefined,
    contentHtml: r.body,
  };
  return { items: [item], etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
};

function extractTitle(html: string): string | undefined {
  return /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
}

function extractOgImage(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) return og[1];
  const tw = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  return tw?.[1];
}

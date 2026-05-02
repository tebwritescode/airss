import type { Fetcher, FetchedItem } from "./types.ts";
import { conditionalFetch } from "./http.ts";

// Accept any subreddit URL form: bare ("r/selfhosted"), full URL, or
// the .rss suffix that some OPML exports include. Always normalize to the
// canonical .json listing endpoint.
export function normalizeRedditUrl(input: string): string {
  let s = input.trim().replace(/\/$/, "");
  // Strip a trailing .rss / .json so we can re-append /.json?limit=50 cleanly.
  s = s.replace(/\.(rss|json)$/i, "");
  if (/^https?:\/\//i.test(s)) {
    return s + "/.json?limit=50";
  }
  const m = /^(?:r\/)?([A-Za-z0-9_]+)$/.exec(s);
  if (m) return `https://www.reddit.com/r/${m[1]}/.json?limit=50`;
  throw new Error(`Unrecognized Reddit source: ${input}`);
}

export const redditFetcher: Fetcher = async (ctx) => {
  const r = await conditionalFetch(ctx.url, {
    etag: ctx.etag,
    lastModified: ctx.lastModified,
    accept: "application/json",
  });
  if (r.status === 304) return { items: [], notModified: true, etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
  if (r.status >= 400) throw new Error(`reddit fetch ${ctx.url} ${r.status}`);

  type Listing = {
    data: { children: { data: RedditPost }[] };
  };
  type RedditPost = {
    id: string;
    name: string;
    title: string;
    author: string;
    permalink: string;
    url: string;
    url_overridden_by_dest?: string;
    selftext?: string;
    selftext_html?: string;
    created_utc: number;
    thumbnail?: string;
    preview?: { images: { source: { url: string } }[] };
    is_self: boolean;
    stickied: boolean;
  };

  const json = JSON.parse(r.body) as Listing;
  const items: FetchedItem[] = json.data.children
    .map((c) => c.data)
    .filter((p) => !p.stickied)
    .map((p) => ({
      externalId: p.name,
      url: `https://www.reddit.com${p.permalink}`,
      title: p.title,
      author: p.author,
      publishedAt: new Date(p.created_utc * 1000),
      imageUrl: pickRedditImage(p),
      contentHtml: p.selftext_html ?? undefined,
      contentText: p.selftext || (p.is_self ? "" : p.url),
    }));

  return { items, etag: r.etag ?? undefined, lastModified: r.lastModified ?? undefined };
};

function pickRedditImage(p: { thumbnail?: string; preview?: { images: { source: { url: string } }[] }; url?: string }) {
  const prev = p.preview?.images?.[0]?.source?.url;
  if (prev) return prev.replace(/&amp;/g, "&");
  if (p.thumbnail && /^https?:\/\//.test(p.thumbnail)) return p.thumbnail;
  if (p.url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(p.url)) return p.url;
  return undefined;
}

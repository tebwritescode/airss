import { throttle, noteRetryAfter } from "./rate-limit.ts";

// Reddit's API rules ask for a descriptive UA. A generic UA gets aggressively
// rate-limited; a descriptive one moves to the higher unauthenticated bucket.
const USER_AGENT =
  "swift-newt/0.1 (self-hosted feed reader; +https://github.com/tebwritescode/airss)";

const FETCH_TIMEOUT_MS = 15_000;

export async function conditionalFetch(
  url: string,
  opts: { etag?: string | null; lastModified?: string | null; accept?: string } = {}
): Promise<{ status: number; body: string; etag: string | null; lastModified: string | null }> {
  const host = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();
  if (host) await throttle(host);

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: opts.accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // 429 / 503 → record the cooldown so subsequent calls to this host wait.
  if ((res.status === 429 || res.status === 503) && host) {
    noteRetryAfter(host, res.headers.get("retry-after"));
  }

  return {
    status: res.status,
    body: res.status === 304 ? "" : await res.text(),
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

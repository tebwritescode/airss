import type { Fetcher } from "./types.ts";
import { rssFetcher } from "./rss.ts";

// YouTube exposes a per-channel feed at:
//   https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx
// We accept either a channel URL, a /channel/UCxxx URL, or a handle (@something).
// Handles must be resolved to channel IDs at add-time (see resolveYouTubeChannelId).

export async function resolveYouTubeChannelId(input: string): Promise<string> {
  const trimmed = input.trim();
  const idMatch = /channel_id=([A-Za-z0-9_-]+)/.exec(trimmed) ?? /\/channel\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (idMatch) return `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`;

  // Handle (@name) or /c/name or /user/name — fetch the channel page and scrape the channelId.
  const url = trimmed.startsWith("http") ? trimmed : `https://www.youtube.com/${trimmed.replace(/^\//, "")}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 swift-newt" } });
  if (!res.ok) throw new Error(`Could not resolve YouTube channel: ${url} (${res.status})`);
  const html = await res.text();
  const m = /"channelId":"(UC[A-Za-z0-9_-]+)"/.exec(html);
  if (!m) throw new Error(`No channelId found on page ${url}`);
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
}

// Once normalized to the feed URL, YouTube is just RSS.
export const youtubeFetcher: Fetcher = (ctx) => rssFetcher(ctx);

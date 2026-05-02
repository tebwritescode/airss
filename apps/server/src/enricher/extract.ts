import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface Extracted {
  title?: string;
  text?: string;
  html?: string;
  imageUrl?: string;
  excerpt?: string;
}

export async function extractFromUrl(url: string): Promise<Extracted | null> {
  // Block obvious SSRF: only http(s), reject private/loopback hosts.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isPrivateHost(parsed.hostname)) return null;

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible) swift-newt/0.1",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    // Cap body size to defend against zip-bomb / huge-page memory blow-ups.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const MAX = 4 * 1024 * 1024;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX) { reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return extractFromHtml(html, url);
  } catch {
    return null;
  }
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv4 ranges: 10/8, 127/8, 169.254/16 (link-local), 172.16-31, 192.168/16
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 loopback / unique local
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

export function extractFromHtml(html: string, baseUrl: string): Extracted | null {
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    const ogImage = pickMeta(dom.window.document, ["og:image", "twitter:image"]);
    return {
      title: parsed?.title ?? undefined,
      text: parsed?.textContent ?? undefined,
      html: parsed?.content ?? undefined,
      excerpt: parsed?.excerpt ?? undefined,
      imageUrl: ogImage ?? undefined,
    };
  } catch {
    return null;
  }
}

function pickMeta(doc: Document, names: string[]): string | undefined {
  for (const n of names) {
    const el =
      doc.querySelector(`meta[property="${n}"]`) ?? doc.querySelector(`meta[name="${n}"]`);
    const c = el?.getAttribute("content");
    if (c) return c;
  }
  return undefined;
}

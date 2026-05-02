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
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible) swift-newt/0.1",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractFromHtml(html, url);
  } catch {
    return null;
  }
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

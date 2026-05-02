export async function conditionalFetch(
  url: string,
  opts: { etag?: string | null; lastModified?: string | null; accept?: string } = {}
): Promise<{ status: number; body: string; etag: string | null; lastModified: string | null }> {
  const headers: Record<string, string> = {
    "user-agent": "swift-newt/0.1 (+https://github.com/local/swift-newt)",
    accept: opts.accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

  const res = await fetch(url, { headers, redirect: "follow" });
  return {
    status: res.status,
    body: res.status === 304 ? "" : await res.text(),
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

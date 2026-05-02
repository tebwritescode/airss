export type FullItem = FeedItem & { contentHtml: string | null };

export type FeedItem = {
  id: number;
  title: string;
  url: string;
  author: string | null;
  publishedAt: number | null;
  imageUrl: string | null;
  contentText: string | null;
  sourceId: number;
  sourceTitle: string | null;
  sourceKind: string | null;
  relevance: number | null;
  rationale: string | null;
  _liked?: boolean;
};

export type Source = {
  id: number;
  kind: "rss" | "reddit" | "youtube" | "web";
  url: string;
  title: string | null;
  pollIntervalS: number;
  enabled: boolean;
  lastFetchedAt: number | null;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  authStatus: () => call<{ firstRun: boolean }>("/api/auth/status"),
  setup: (password: string) => call("/api/auth/setup", { method: "POST", body: JSON.stringify({ password }) }),
  login: (password: string) => call("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => call("/api/auth/logout", { method: "POST" }),

  getFeed: (cursor?: string | null, minScore = 0) =>
    call<{ items: FeedItem[]; nextCursor: string | null }>(
      `/api/feed?${new URLSearchParams({ ...(cursor ? { cursor } : {}), minScore: String(minScore) })}`
    ),

  listSources: () => call<{ sources: Source[] }>("/api/sources"),
  addSource: (s: { kind: Source["kind"]; url: string; title?: string }) =>
    call<{ source: Source }>("/api/sources", { method: "POST", body: JSON.stringify(s) }),
  deleteSource: (id: number) => call(`/api/sources/${id}`, { method: "DELETE" }),
  refreshAll: () => call("/api/refresh", { method: "POST" }),

  getProfile: () => call<{ profile: { promptText: string } }>("/api/profile"),
  saveProfile: (promptText: string) => call("/api/profile", { method: "PUT", body: JSON.stringify({ promptText }) }),

  getProviders: () =>
    call<{
      keys: { provider: string; baseUrl: string | null; hasKey: boolean; createdAt: number }[];
      config: { task: string; provider: string; model: string }[];
    }>("/api/providers"),
  saveProviderKey: (provider: string, key: string, baseUrl?: string | null) =>
    call("/api/providers/keys", {
      method: "POST",
      body: JSON.stringify({ provider, key, baseUrl: baseUrl ?? "" }),
    }),
  deleteProviderKey: (provider: string) => call(`/api/providers/keys/${provider}`, { method: "DELETE" }),
  saveTaskConfig: (task: string, provider: string, model: string) =>
    call(`/api/providers/config/${task}`, { method: "PUT", body: JSON.stringify({ provider, model }) }),

  getItem: (id: number) => call<{ item: FullItem }>(`/api/items/${id}`),
  getRelated: (excludeIds: number[], limit = 6) =>
    call<{ items: FeedItem[] }>(
      `/api/feed/related?excludeIds=${excludeIds.join(",")}&limit=${limit}`
    ),

  signal: (itemId: number, kind: string, value = 1) =>
    call("/api/signals", { method: "POST", body: JSON.stringify({ itemId, kind, value }) }),
  signalBatch: (signals: { itemId: number; kind: string; value?: number }[]) =>
    call("/api/signals/batch", { method: "POST", body: JSON.stringify({ signals }) }),
};

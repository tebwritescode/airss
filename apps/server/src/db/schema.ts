import { sqliteTable, integer, text, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["rss", "reddit", "youtube", "web"] }).notNull(),
    url: text("url").notNull(),
    title: text("title"),
    pollIntervalS: integer("poll_interval_s").notNull().default(1800),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    urlIdx: uniqueIndex("sources_url_idx").on(t.url),
  })
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    imageUrl: text("image_url"),
    contentHtml: text("content_html"),
    contentText: text("content_text"),
    clusterId: integer("cluster_id"),
    enrichedAt: integer("enriched_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    sourceExternalIdx: uniqueIndex("items_source_external_idx").on(t.sourceId, t.externalId),
    publishedIdx: index("items_published_idx").on(t.publishedAt),
    clusterIdx: index("items_cluster_idx").on(t.clusterId),
  })
);

export const scores = sqliteTable(
  "scores",
  {
    itemId: integer("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
    relevance: real("relevance").notNull(),
    rationale: text("rationale"),
    model: text("model"),
    scoredAt: integer("scored_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    relevanceIdx: index("scores_relevance_idx").on(t.relevance),
  })
);

export const signals = sqliteTable(
  "signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["dwell_ms", "like", "dislike", "save", "hide", "open", "share"] }).notNull(),
    value: real("value").notNull().default(1),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    itemKindIdx: index("signals_item_kind_idx").on(t.itemId, t.kind),
    tsIdx: index("signals_ts_idx").on(t.ts),
  })
);

export const clusters = sqliteTable("clusters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  representativeItemId: integer("representative_item_id").references(() => items.id, { onDelete: "set null" }),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  promptText: text("prompt_text").notNull().default(""),
  promptEmbedding: text("prompt_embedding"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const providerKeys = sqliteTable(
  "provider_keys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider", { enum: ["anthropic", "openai", "openrouter", "ollama"] }).notNull(),
    // Empty string when the provider is keyless (e.g. local Ollama).
    ciphertext: text("ciphertext").notNull().default(""),
    nonce: text("nonce").notNull().default(""),
    // Optional override for the provider's HTTP base URL. NULL means "use the
    // built-in default for this provider". Lets a user point openai-compatible
    // providers at OpenRouter, a self-hosted proxy, etc.
    baseUrl: text("base_url"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    providerIdx: uniqueIndex("provider_keys_provider_idx").on(t.provider),
  })
);

export const providerConfig = sqliteTable("provider_config", {
  task: text("task", { enum: ["embed", "score_judge", "summarize", "digest"] }).primaryKey(),
  provider: text("provider", { enum: ["anthropic", "openai", "openrouter", "ollama"] }).notNull(),
  model: text("model").notNull(),
});

export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
  html: text("html").notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const authUser = sqliteTable("auth_user", {
  id: integer("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

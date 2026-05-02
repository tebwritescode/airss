import { raw } from "./index.ts";

// Idempotent bootstrap. We don't ship drizzle-kit-generated SQL because this is
// a single-user app with a small fixed schema; running on first boot is friendlier
// than asking the user to run a generator step.
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('rss','reddit','youtube','web')),
    url TEXT NOT NULL,
    title TEXT,
    poll_interval_s INTEGER NOT NULL DEFAULT 1800,
    etag TEXT,
    last_modified TEXT,
    last_fetched_at INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sources_url_idx ON sources(url)`,

  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    published_at INTEGER,
    image_url TEXT,
    content_html TEXT,
    content_text TEXT,
    cluster_id INTEGER,
    enriched_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS items_source_external_idx ON items(source_id, external_id)`,
  `CREATE INDEX IF NOT EXISTS items_published_idx ON items(published_at)`,
  `CREATE INDEX IF NOT EXISTS items_cluster_idx ON items(cluster_id)`,

  `CREATE TABLE IF NOT EXISTS scores (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    relevance REAL NOT NULL,
    rationale TEXT,
    model TEXT,
    scored_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS scores_relevance_idx ON scores(relevance)`,

  `CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('dwell_ms','like','dislike','save','hide','open')),
    value REAL NOT NULL DEFAULT 1,
    ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS signals_item_kind_idx ON signals(item_id, kind)`,
  `CREATE INDEX IF NOT EXISTS signals_ts_idx ON signals(ts)`,

  `CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    representative_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    summary TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_text TEXT NOT NULL DEFAULT '',
    prompt_embedding TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS provider_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK(provider IN ('anthropic','openai','openrouter','ollama')),
    ciphertext TEXT NOT NULL DEFAULT '',
    nonce TEXT NOT NULL DEFAULT '',
    base_url TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS provider_keys_provider_idx ON provider_keys(provider)`,

  `CREATE TABLE IF NOT EXISTS provider_config (
    task TEXT PRIMARY KEY CHECK(task IN ('embed','score_judge','summarize','digest')),
    provider TEXT NOT NULL CHECK(provider IN ('anthropic','openai','openrouter','ollama')),
    model TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    html TEXT NOT NULL,
    generated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS auth_user (
    id INTEGER PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
];

// In-place ALTERs for forward migrations. SQLite ignores duplicate column
// errors via try/catch since "ADD COLUMN IF NOT EXISTS" doesn't exist.
const ALTERS: { sql: string; description: string }[] = [
  { sql: `ALTER TABLE provider_keys ADD COLUMN base_url TEXT`, description: "provider_keys.base_url" },
];

for (const stmt of STATEMENTS) raw.exec(stmt);
for (const a of ALTERS) {
  try {
    raw.exec(a.sql);
    console.log(`[migrate] added ${a.description}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

// Optional vector index — only when sqlite-vec is loadable.
try {
  raw.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
      item_id INTEGER PRIMARY KEY,
      embedding FLOAT[1536]
    )
  `);
} catch {
  // Without sqlite-vec, embed.ts uses an embeddings_json fallback table created lazily.
}

console.log("[migrate] schema ready");

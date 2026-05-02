import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

mkdirSync(dirname(env.DB_PATH), { recursive: true });

const sqlite = new Database(env.DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

// sqlite-vec is loaded by the migrate script via `SELECT load_extension('vec0')`.
// On Bun the extension is opt-in per connection; we attempt to load and tolerate failure
// (vector search is optional in Phase 1 — falls back to manual cosine in JS).
try {
  // @ts-expect-error Bun's Database#loadExtension exists at runtime
  sqlite.loadExtension?.("vec0");
} catch {
  // ok — fallback path used in enricher/embed.ts
}

export const db = drizzle(sqlite, { schema });
export { schema };
export const raw = sqlite;

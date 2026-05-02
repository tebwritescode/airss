import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db, raw } from "./index.ts";

migrate(db, { migrationsFolder: "./drizzle" });

raw.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
    item_id INTEGER PRIMARY KEY,
    embedding FLOAT[1536]
  );
`);

console.log("migrations complete");

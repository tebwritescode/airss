import { eq, sql } from "drizzle-orm";
import { db, raw, schema } from "../db/index.ts";
import { getProvider, getTaskConfig } from "../ai/registry.ts";

const VEC_DIM = 1536;

let vecAvailable: boolean | null = null;
function vecOk(): boolean {
  if (vecAvailable !== null) return vecAvailable;
  try {
    raw.exec(`SELECT count(*) FROM embeddings LIMIT 1`);
    vecAvailable = true;
  } catch {
    vecAvailable = false;
  }
  return vecAvailable;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export async function embedText(text: string): Promise<number[]> {
  const cfg = await getTaskConfig("embed");
  const provider = await getProvider(cfg.provider);
  const r = await provider.embed({ model: cfg.model, input: text.slice(0, 8000) });
  return r.vectors[0]!;
}

export async function storeItemEmbedding(itemId: number, vec: number[]): Promise<void> {
  if (vecOk()) {
    raw.run(
      `INSERT OR REPLACE INTO embeddings(item_id, embedding) VALUES (?, ?)`,
      itemId,
      new Float32Array(vec.length === VEC_DIM ? vec : padOrTrim(vec, VEC_DIM))
    );
  } else {
    // Fallback: stash as JSON on the item itself via a side column doesn't exist;
    // we shadow into a tiny table.
    raw.exec(`CREATE TABLE IF NOT EXISTS embeddings_json(item_id INTEGER PRIMARY KEY, vec TEXT NOT NULL)`);
    raw.run(`INSERT OR REPLACE INTO embeddings_json(item_id, vec) VALUES (?, ?)`, itemId, JSON.stringify(vec));
  }
}

export async function getItemEmbedding(itemId: number): Promise<number[] | null> {
  if (vecOk()) {
    const row = raw.query(`SELECT embedding FROM embeddings WHERE item_id = ?`).get(itemId) as { embedding: ArrayBuffer } | undefined;
    if (!row) return null;
    return Array.from(new Float32Array(row.embedding));
  }
  const row = raw.query(`SELECT vec FROM embeddings_json WHERE item_id = ?`).get(itemId) as { vec: string } | undefined;
  return row ? (JSON.parse(row.vec) as number[]) : null;
}

export async function getProfileEmbedding(): Promise<number[] | null> {
  const p = await db.query.profile.findFirst();
  if (!p?.promptEmbedding) return null;
  return JSON.parse(p.promptEmbedding) as number[];
}

export async function refreshProfileEmbedding(): Promise<void> {
  const p = await db.query.profile.findFirst();
  if (!p || !p.promptText) return;
  const vec = await embedText(p.promptText);
  await db.update(schema.profile).set({ promptEmbedding: JSON.stringify(vec), updatedAt: new Date() }).where(eq(schema.profile.id, p.id));
}

function padOrTrim(v: number[], n: number): number[] {
  if (v.length === n) return v;
  if (v.length > n) return v.slice(0, n);
  return v.concat(new Array(n - v.length).fill(0));
}

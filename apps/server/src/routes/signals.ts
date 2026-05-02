import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/index.ts";

export const signalRoutes = new Hono();

signalRoutes.post("/", async (c) => {
  const Body = z.object({
    itemId: z.number().int(),
    kind: z.enum(["dwell_ms", "like", "dislike", "save", "hide", "open"]),
    value: z.number().optional(),
  });
  const body = Body.parse(await c.req.json());
  await db.insert(schema.signals).values({
    itemId: body.itemId,
    kind: body.kind,
    value: body.value ?? 1,
  });
  return c.json({ ok: true });
});

// Batch endpoint for dwell pings — PWA flushes a queue periodically.
signalRoutes.post("/batch", async (c) => {
  const Body = z.object({
    signals: z
      .array(
        z.object({
          itemId: z.number().int(),
          kind: z.enum(["dwell_ms", "like", "dislike", "save", "hide", "open"]),
          value: z.number().optional(),
        })
      )
      .max(200),
  });
  const { signals } = Body.parse(await c.req.json());
  if (signals.length === 0) return c.json({ ok: true, written: 0 });
  await db.insert(schema.signals).values(
    signals.map((s) => ({ itemId: s.itemId, kind: s.kind, value: s.value ?? 1 }))
  );
  return c.json({ ok: true, written: signals.length });
});

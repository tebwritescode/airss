import { Hono } from "hono";
import { fetchAllDue } from "../fetcher/index.ts";
import { enrichBacklog } from "../enricher/index.ts";

export const refreshRoutes = new Hono();

refreshRoutes.post("/", async (c) => {
  const f = await fetchAllDue();
  const e = await enrichBacklog(200);
  return c.json({ checked: f.checked, inserted: f.inserted, enrichQueued: e });
});

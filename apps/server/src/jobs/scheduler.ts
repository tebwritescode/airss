import cron from "node-cron";
import { fetchAllDue } from "../fetcher/index.ts";
import { enrichBacklog } from "../enricher/index.ts";

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  // Every 5 minutes: check for due sources, then drain the enrich backlog.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const f = await fetchAllDue();
      const e = await enrichBacklog(100);
      if (f.inserted > 0 || e > 0) {
        console.log(`[cron] checked=${f.checked} inserted=${f.inserted} enrich_queued=${e}`);
      }
    } catch (err) {
      console.error("[cron] tick failed:", err);
    }
  });

  // Kick once on boot so a fresh container doesn't sit idle.
  setTimeout(async () => {
    try {
      await fetchAllDue();
      await enrichBacklog(100);
    } catch (err) {
      console.error("[cron] boot tick failed:", err);
    }
  }, 5_000);

  console.log("[scheduler] started (5-minute cron)");
}

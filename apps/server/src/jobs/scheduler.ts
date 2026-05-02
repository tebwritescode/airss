import cron from "node-cron";
import { fetchAllDue } from "../fetcher/index.ts";
import { enrichBacklog } from "../enricher/index.ts";
import { maybeRegenerateProfile } from "../enricher/profile-ai.ts";

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  // Every 5 minutes: fetch due sources, drain enrich backlog, maybe update profile.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const f = await fetchAllDue();
      const e = await enrichBacklog(500);
      if (f.inserted > 0 || e > 0) {
        console.log(`[cron] checked=${f.checked} inserted=${f.inserted} enrich_queued=${e}`);
      }
      await maybeRegenerateProfile();
    } catch (err) {
      console.error("[cron] tick failed:", err);
    }
  });

  // Boot tick: seed content and do an initial profile generation if needed.
  setTimeout(async () => {
    try {
      await fetchAllDue();
      await enrichBacklog(500);
      await maybeRegenerateProfile();
    } catch (err) {
      console.error("[cron] boot tick failed:", err);
    }
  }, 8_000);

  console.log("[scheduler] started (5-minute cron)");
}

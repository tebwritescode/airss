import { api } from "./api";

// Tracks how long each item is visible above the fold and ships the totals
// to the server periodically. We treat ">=50% visible" as "visible enough".

interface PendingSignal {
  itemId: number;
  kind: string;
  value?: number;
}

const visible = new Map<number, number>(); // itemId -> ts when it became visible
const accum = new Map<number, number>();   // itemId -> total dwell ms
const pending: PendingSignal[] = [];

let observer: IntersectionObserver | null = null;
let flushTimer: number | null = null;

function ensureObserver() {
  if (observer || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(
    (entries) => {
      const now = Date.now();
      for (const e of entries) {
        const id = Number((e.target as HTMLElement).dataset.itemId);
        if (!Number.isFinite(id)) continue;
        if (e.intersectionRatio >= 0.5) {
          if (!visible.has(id)) visible.set(id, now);
        } else {
          const start = visible.get(id);
          if (start !== undefined) {
            accum.set(id, (accum.get(id) ?? 0) + (now - start));
            visible.delete(id);
          }
        }
      }
    },
    { threshold: [0, 0.5, 1] }
  );
}

export function observeItem(el: HTMLElement) {
  ensureObserver();
  observer?.observe(el);
  return () => observer?.unobserve(el);
}

export function recordSignal(itemId: number, kind: string, value?: number) {
  pending.push({ itemId, kind, value });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(flush, 5000) as unknown as number;
}

async function flush() {
  flushTimer = null;
  // Roll dwell accumulators into pending.
  const now = Date.now();
  for (const [id, start] of visible) {
    accum.set(id, (accum.get(id) ?? 0) + (now - start));
    visible.set(id, now);
  }
  for (const [id, ms] of accum) {
    if (ms >= 1000) pending.push({ itemId: id, kind: "dwell_ms", value: ms });
  }
  accum.clear();

  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  try {
    await api.signalBatch(batch);
  } catch (err) {
    // Re-queue on failure so we don't lose dwell.
    pending.unshift(...batch);
    console.warn("[dwell] flush failed:", err);
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.setInterval(flush, 30_000);
}

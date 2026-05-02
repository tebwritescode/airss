// Per-domain token-bucket rate limiter. Defaults are conservative; specific
// hosts (reddit) get tighter limits because they 429 aggressively.
//
// Usage: await throttle("reddit.com");

interface Bucket {
  capacity: number;       // max tokens
  tokens: number;         // current tokens
  refillPerSec: number;   // tokens added per second
  lastRefillMs: number;
  blockedUntilMs: number; // honored Retry-After timestamp
}

// host → bucket
const buckets = new Map<string, Bucket>();

// Per-host policy. Hosts not listed get DEFAULT.
const POLICY: Record<string, { capacity: number; perSec: number }> = {
  "reddit.com":     { capacity: 1, perSec: 1 },        // ~60/min (Reddit unauth limit)
  "www.reddit.com": { capacity: 1, perSec: 1 },
  "old.reddit.com": { capacity: 1, perSec: 1 },
  "youtube.com":    { capacity: 5, perSec: 5 },
  "www.youtube.com":{ capacity: 5, perSec: 5 },
};
const DEFAULT = { capacity: 5, perSec: 5 };

function bucketFor(host: string): Bucket {
  const key = host.toLowerCase();
  let b = buckets.get(key);
  if (!b) {
    const policy = POLICY[key] ?? DEFAULT;
    b = {
      capacity: policy.capacity,
      tokens: policy.capacity,
      refillPerSec: policy.perSec,
      lastRefillMs: Date.now(),
      blockedUntilMs: 0,
    };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket): void {
  const now = Date.now();
  const elapsed = (now - b.lastRefillMs) / 1000;
  if (elapsed > 0) {
    b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerSec);
    b.lastRefillMs = now;
  }
}

/**
 * Block until a token is available for `host` AND we're not in a Retry-After
 * cooldown. Caller should pass the URL's hostname.
 */
export async function throttle(host: string): Promise<void> {
  const b = bucketFor(host);
  while (true) {
    const now = Date.now();
    if (now < b.blockedUntilMs) {
      await sleep(b.blockedUntilMs - now);
      continue;
    }
    refill(b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    // wait until enough tokens accrue
    const needSecs = (1 - b.tokens) / b.refillPerSec;
    await sleep(Math.max(50, needSecs * 1000));
  }
}

/**
 * After a 429 / 503, mark the host as blocked for `seconds` seconds.
 * Pass the value from the `Retry-After` header (seconds or HTTP-date).
 */
export function noteRetryAfter(host: string, retryAfter: string | null): void {
  const b = bucketFor(host);
  let ms = 60 * 1000; // default cooldown if header missing
  if (retryAfter) {
    const asNum = Number(retryAfter);
    if (Number.isFinite(asNum)) ms = asNum * 1000;
    else {
      const parsedDate = Date.parse(retryAfter);
      if (Number.isFinite(parsedDate)) ms = Math.max(0, parsedDate - Date.now());
    }
  }
  b.blockedUntilMs = Math.max(b.blockedUntilMs, Date.now() + ms);
}
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

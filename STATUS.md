# Status

Snapshot of where the project stands. Update this when you finish meaningful work.

## What's built (Phase 1)

End-to-end MVP scaffold. None of it has been executed yet — the original build environment had no Bun/Node/Docker, so everything is source-only and committed.

### Server (`apps/server`)
- **Runtime:** Bun (Node 22 should also work; not tested).
- **HTTP:** Hono, mounted at `/api/*` plus static-serves the built PWA.
- **DB:** SQLite via `bun:sqlite` + Drizzle ORM. Idempotent bootstrap in `src/db/migrate.ts` (no drizzle-kit step needed).
- **Schema:** sources, items, scores, signals, clusters, profile, providerKeys, providerConfig, digests, session, authUser.
- **Auth:** single-user, password stored as argon2id (libsodium) in `auth_user` table. First-run setup happens entirely in the PWA, no env hash required.
- **Crypto:** BYO API keys encrypted with libsodium secretbox; master key from `MASTER_KEY` env var.
- **AI providers:** adapter interface in `src/ai/`, with built-in implementations for Anthropic, OpenAI, OpenRouter (OpenAI-compatible), and Ollama. Each accepts an optional `baseURL` so any OpenAI-compatible endpoint works.
- **Per-task model routing:** `provider_config(task)` row picks provider+model for `embed | score_judge | summarize | digest`.
- **Fetcher:** `src/fetcher/{rss,reddit,youtube,web}.ts`. Reddit accepts `r/name` or full URL; YouTube resolves @handles to channel IDs at add-time; web fetcher does page-hash change detection for sites without feeds.
- **Enricher:** Mozilla Readability text extraction + OG image fallback, embedding via the configured embed provider, score = blend of profile-prompt cosine + decayed liked-items centroid cosine. Stores rationale in `scores.rationale`.
- **Scheduler:** `node-cron` 5-minute tick that fetches due sources then drains the enrichment backlog. p-queue, concurrency 2.
- **API routes:** `/api/auth`, `/api/sources` (CRUD + per-source refresh), `/api/feed` (keyset paginated, hides items with `hide`/`dislike` signals), `/api/signals` (single + batch for dwell pings), `/api/profile`, `/api/providers` (keys + per-task config; ciphertext never returned to client), `/api/refresh`.

### PWA (`apps/pwa`)
- **Stack:** SvelteKit (static adapter, SPA mode), Vite, `vite-plugin-pwa` for the manifest + Workbox runtime caching (NetworkFirst on `/api/feed`, CacheFirst on images).
- **Routes:** `/` (feed, infinite scroll, pull-to-refresh button), `/sources`, `/settings`, `/setup`, `/login`.
- **Dwell tracking:** `src/lib/dwell.ts` uses IntersectionObserver + visibility events; ships dwell-ms + click signals via `/api/signals/batch` every 5–30s and on `pagehide`.
- **iOS install:** `apple-mobile-web-app-*` meta + safe-area padding. Add-to-Home-Screen → standalone mode. Web Push not yet wired.

### Docker
- Multi-stage `docker/Dockerfile` (build PWA → install server deps → slim runtime on `oven/bun:1.1-slim`).
- `docker-compose.yml` exposes `8787` and mounts `./data:/data`.
- `.env.example` documents `MASTER_KEY` / `SESSION_SECRET` / `PUBLIC_ORIGIN`.

## What's *not* built yet

These are deferred to Phase 2 / 3 per `/root/.claude/plans/i-am-working-on-swift-newt.md`:

- **LLM judge** for borderline scores (only embedding-blend ranking right now). Provider adapter is wired; just need to plug it into `src/enricher/score.ts`.
- **On-demand summaries** (`GET /api/items/:id/summary`). Route is stubbed in the plan but not in the code.
- **Clustering** of near-duplicate stories across sources. `clusterId` column exists on items; logic is not.
- **Weekly digest** generation. Table + cron slot exist; generator does not.
- **Web Push notifications** for the digest / high-score items.
- **OPML import.**
- **Source health dashboard / failure backoff** (currently a failed fetch just logs and waits for the next tick).
- **Tests.** None written.

## Hasn't been run

Phase 1 is committed but **never executed**. First build is likely to surface bugs, especially around:
- `bun install` resolving the dep tree (no lockfile committed).
- Drizzle's typed-query helpers vs. our hand-written bootstrap SQL — should be compatible since both target the same column names, but worth a sanity check.
- `sqlite-vec` extension: not bundled. The code falls back to a JSON column when the extension isn't loadable, but that path hasn't been exercised.
- Reddit JSON endpoint occasionally rate-limits unauth'd requests (HTTP 429). Add a User-Agent and back off if you see this.

## Resume here

When you next pick this up:
1. Clone, `cp .env.example .env`, generate `MASTER_KEY` and `SESSION_SECRET` with `openssl rand -base64 32`.
2. `docker compose up --build` and watch logs.
3. Hit `http://<host>:8787` → set a password → Settings → paste a provider key → Sources → add 2–3 feeds → wait one cron tick.
4. Fix whatever the first run breaks. Update this file.

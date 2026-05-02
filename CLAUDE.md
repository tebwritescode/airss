# CLAUDE.md

Guidance for Claude (or any AI agent) working in this repo. Read this first.

## What this is

`swift-newt` is a single-user, self-hosted, AI-curated personal feed aggregator. One Docker container. Sources: RSS, Reddit, YouTube, generic web pages. AI ranks items against a user-written interest profile + signals (likes, dwell time). PWA frontend usable from iOS via Add-to-Home-Screen. BYO model — supports Anthropic, OpenAI, OpenRouter, and Ollama, each with a configurable base URL.

The locked design lives in `/root/.claude/plans/i-am-working-on-swift-newt.md` (on the original machine). The short version is in `README.md`. Current build status is in `STATUS.md` — read it before starting work.

## Layout

```
apps/server/   Hono API + cron fetcher + enricher pipeline
apps/pwa/      SvelteKit PWA (static adapter, SPA mode)
docker/        Multi-stage Dockerfile
docker-compose.yml
.env.example
```

Key files:
- `apps/server/src/db/schema.ts` — Drizzle schema. Source of truth for tables.
- `apps/server/src/db/migrate.ts` — idempotent bootstrap. Add new tables as `CREATE TABLE IF NOT EXISTS`; for new columns on existing tables, append to the `ALTERS` array (errors on `duplicate column name` are swallowed).
- `apps/server/src/ai/` — provider adapters. Add a new provider by implementing `Provider` from `provider.ts` and wiring it in `registry.ts`.
- `apps/server/src/fetcher/{rss,reddit,youtube,web}.ts` — one file per source kind. The interface is `Fetcher` from `fetcher/types.ts`.
- `apps/server/src/enricher/{extract,embed,score}.ts` — the per-item AI pipeline. `score.ts` is intentionally simple (cosine blend); the LLM judge step belongs here when it lands.
- `apps/pwa/src/lib/api.ts` — typed fetch client. Keep it in sync with the server routes.
- `apps/pwa/src/lib/dwell.ts` — dwell + signal batching. Don't replace with a per-event POST; we batch on purpose.

## Running it

```bash
cp .env.example .env
openssl rand -base64 32 >> /tmp/mk && echo "MASTER_KEY=$(cat /tmp/mk)" >> .env
openssl rand -base64 32 >> /tmp/ss && echo "SESSION_SECRET=$(cat /tmp/ss)" >> .env
rm /tmp/mk /tmp/ss
docker compose up --build
```

Open `http://<host>:8787`, set a password, paste a provider key in Settings, add sources.

## Conventions

- **Schema changes:** edit `schema.ts` (for Drizzle types) AND `migrate.ts` (for the actual SQL). They're parallel — don't let them drift.
- **Don't depend on drizzle-kit migrations.** The bootstrap in `migrate.ts` is the migration system; it's idempotent on purpose so a fresh container Just Works.
- **API key handling:** keys go into `provider_keys` encrypted via `crypto/keys.ts` (libsodium secretbox). Plaintext keys must never appear in logs, responses, or error messages. The `GET /api/providers` route returns a `hasKey` boolean only.
- **Never commit secrets.** `.env` is gitignored. The OpenRouter test key shared in early conversations is *not* in this repo (verified). If you find one in code or git history, treat it as an incident.
- **Phase-1 vs later work:** see `STATUS.md` "What's not built yet." Keep new features inside the named phase boundaries unless the user asks to expand scope.
- **Auth model:** single user. Password hash in `auth_user` (DB row, id=1). First-run setup writes the hash and immediately creates a session — no restart, no env-var dance. Don't reintroduce a `USER_PASSWORD_HASH` env requirement.
- **No tests yet.** When you add the first test, prefer Bun's built-in test runner (`bun test`) over adding a new framework.

## Tone for commit messages

Conventional-commit prefix (`feat`, `fix`, `chore`, `refactor`), short subject, body explains *why* not *what*. The git log to date is the style guide.

## When the user says "run it"

The original build environment had no toolchain — Bun install was denied, apt was denied. If your environment has Docker, `docker compose up --build` from the repo root should be enough. If it doesn't, write code, commit, and tell the user what to run on their box. Don't fake a "running" state.

## Memory of the project

- v1 target = rank + on-demand summaries + clustering + weekly digest, but only ranking is shipped.
- BYO-keys is core, not a nice-to-have. Every AI call must go through `getProvider(name)` so the adapter can pick the right URL/key.
- The user prefers terse output and concrete deliverables. They will course-correct if you over-explain.

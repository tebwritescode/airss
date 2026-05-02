# swift-newt

AI-curated personal feed aggregator. One inbox for Reddit, YouTube channels, websites, and RSS feeds, ranked against your interests, with image previews. Installable PWA so it works on iOS without an App Store release. Bring your own AI provider (Anthropic, OpenAI, OpenRouter, Ollama).

Single-user, self-hosted, one Docker container.

## Status

Phase 1 (MVP) scaffold. See `apps/server` and `apps/pwa`.

## Quick start

```bash
# 1. Generate a master key for encrypting BYO provider keys
openssl rand -base64 32 > .secret-master-key

# 2. Build & run
docker compose up --build

# 3. Open http://localhost:8787 (or your tunneled HTTPS URL on iPhone Safari)
#    "Add to Home Screen" to install as a PWA.
```

First run: the app prompts for a single-user password, then for an API key. In Settings → Provider keys you can pick **OpenRouter** and paste any OpenRouter key — then in Settings → Per-task model use any catalog model id (e.g. `anthropic/claude-3.5-sonnet`, `openai/gpt-4o-mini`, `meta-llama/llama-3.1-8b-instruct`). Each provider also accepts an optional **base URL** override, so you can point any OpenAI-compatible endpoint at a self-hosted proxy or alternate gateway.

Add a few sources (a subreddit URL, a YouTube channel URL, an RSS feed URL), write a one-paragraph interest description in Settings, and the feed populates within one fetch cycle.

## Architecture

See `/root/.claude/plans/i-am-working-on-swift-newt.md` for the full design. Short version:

- **Fetcher** — cron worker, polls sources, dedups by url/guid.
- **Enricher** — extracts OG image + readable text, embeds, scores against your interest profile.
- **API + PWA** — Hono server serves both the JSON API and the built static PWA.
- **DB** — SQLite + `sqlite-vec` for vector search.

All three run in one Bun process.

## Phased rollout

- **Phase 1 (this scaffold):** add sources, fetch, embedding-based ranking, like+dwell signals, PWA shell, Anthropic adapter.
- **Phase 2:** LLM judge for borderline items, on-demand summaries, multi-provider routing.
- **Phase 3:** clustering, weekly digest, push notifications, OPML import.

## License

Private / personal use.

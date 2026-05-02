<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api, type FeedItem, type FullItem } from "$lib/api";
  import { observeItem, recordSignal } from "$lib/dwell";

  // ── Feed state ──────────────────────────────────────
  let items = $state<FeedItem[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(false);
  let refreshing = $state(false);
  let error = $state<string | null>(null);

  // ── View modes ──────────────────────────────────────
  let viewMode = $state<"scroll" | "swipe">("scroll");

  // ── Swipe state ─────────────────────────────────────
  let swipeIdx = $state(0);
  let touchStartX = 0;
  let touchStartY = 0;
  let dragX = $state(0);
  let dragging = $state(false);

  // ── Reader state ────────────────────────────────────
  let reading = $state<FullItem | null>(null);
  let readingLoading = $state(false);

  // ── Recommendations ──────────────────────────────────
  let related = $state<FeedItem[]>([]);
  let relatedLoaded = $state(false);

  // ── Feed logic ───────────────────────────────────────
  async function loadMore() {
    if (loading) return;
    loading = true;
    try {
      const r = await api.getFeed(cursor);
      items = [...items, ...r.items];
      cursor = r.nextCursor;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    refreshing = true;
    try {
      await api.refreshAll();
      items = [];
      cursor = null;
      swipeIdx = 0;
      relatedLoaded = false;
      related = [];
      await loadMore();
    } finally {
      refreshing = false;
    }
  }

  async function loadRelated() {
    if (relatedLoaded || items.length === 0) return;
    relatedLoaded = true;
    try {
      const r = await api.getRelated(items.map((i) => i.id));
      related = r.items;
    } catch { /* non-critical */ }
  }

  // ── Reader ───────────────────────────────────────────
  async function openReader(item: FeedItem) {
    readingLoading = true;
    recordSignal(item.id, "open");
    try {
      const r = await api.getItem(item.id);
      reading = r.item;
    } catch {
      reading = { ...item, contentHtml: null } as FullItem;
    } finally {
      readingLoading = false;
    }
  }

  function closeReader() { reading = null; }

  async function share(item: FeedItem | FullItem) {
    recordSignal(item.id, "share");
    if (navigator.share) {
      await navigator.share({ title: item.title, url: item.url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(item.url).catch(() => {});
    }
  }

  // ── Card signals ─────────────────────────────────────
  function like(item: FeedItem) {
    recordSignal(item.id, "like");
    item._liked = true;
  }

  function hide(item: FeedItem) {
    recordSignal(item.id, "hide");
    items = items.filter((i) => i.id !== item.id);
  }

  function attach(node: HTMLElement) {
    return { destroy: observeItem(node) };
  }

  // ── Mode ─────────────────────────────────────────────
  function setMode(mode: "scroll" | "swipe") {
    viewMode = mode;
    if (typeof localStorage !== "undefined") localStorage.setItem("swn_view", mode);
    if (mode === "swipe") swipeIdx = 0;
    if (mode === "scroll") loadRelated();
  }

  // ── Swipe gestures ────────────────────────────────────
  function maybeLoadMore() {
    if (!loading && cursor && swipeIdx >= items.length - 4) loadMore();
  }

  function nextCard() { swipeIdx = Math.min(swipeIdx + 1, items.length); maybeLoadMore(); }
  function prevCard() { if (swipeIdx > 0) swipeIdx--; }

  function swipeLike() {
    const item = items[swipeIdx];
    if (item) { like(item); nextCard(); }
  }

  function swipeHide() {
    const item = items[swipeIdx];
    if (item) { recordSignal(item.id, "hide"); items = items.filter((i) => i.id !== item.id); maybeLoadMore(); }
  }

  function onTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0]!.clientX;
    touchStartY = e.touches[0]!.clientY;
    dragging = true; dragX = 0;
  }
  function onTouchMove(e: TouchEvent) {
    if (!dragging) return;
    dragX = e.touches[0]!.clientX - touchStartX;
  }
  function onTouchEnd(e: TouchEvent) {
    dragging = false;
    const dx = e.changedTouches[0]!.clientX - touchStartX;
    const dy = e.changedTouches[0]!.clientY - touchStartY;
    dragX = 0;
    const t = 70;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > t) { dx > 0 ? swipeLike() : swipeHide(); }
    else if (Math.abs(dy) > t) { dy < 0 ? nextCard() : prevCard(); }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (reading) { if (e.key === "Escape") { e.preventDefault(); closeReader(); } return; }
    if (viewMode !== "swipe") return;
    if (e.key === "ArrowRight") { e.preventDefault(); swipeLike(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); swipeHide(); }
    else if (e.key === "ArrowUp" || e.key === " ") { e.preventDefault(); nextCard(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); prevCard(); }
    else if (e.key === "Escape") setMode("scroll");
  }

  onMount(() => {
    loadMore().then(loadRelated);
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("swn_view");
      if (saved === "swipe" || saved === "scroll") viewMode = saved as "scroll" | "swipe";
    }
    window.addEventListener("keydown", onKeyDown);
  });

  onDestroy(() => window.removeEventListener("keydown", onKeyDown));

  const HINT_T = 35;

  function fmt(iso: number | null) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // Strip dangerous tags from article HTML before rendering.
  function sanitize(html: string): string {
    return html.replace(/<(script|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, "")
               .replace(/<(script|iframe|object|embed|form)[^>]*\/?>[ \t]*/gi, "");
  }
</script>

<!-- ── Reader overlay ─────────────────────────────── -->
{#if reading || readingLoading}
  {@const item = reading}
  <div class="reader-sheet slide-up">
    <div class="reader-handle"></div>
    <div class="reader-topbar">
      <button class="btn-icon" onclick={closeReader} aria-label="Close">✕</button>
      <h1>Reader</h1>
      {#if item}
        <button class="btn-icon" onclick={() => share(item)} aria-label="Share">⬆</button>
      {/if}
    </div>

    {#if readingLoading}
      <div class="empty"><p class="muted">Loading…</p></div>
    {:else if item}
      {#if item.imageUrl}
        <img class="reader-hero" src={item.imageUrl} alt="" referrerpolicy="no-referrer" loading="eager" />
      {/if}
      <div class="reader-body">
        <h2 class="reader-title">{item.title}</h2>
        <div class="reader-meta">
          {#if item.sourceTitle}<span>{item.sourceTitle}</span>{/if}
          {#if item.author}<span>· {item.author}</span>{/if}
          {#if item.publishedAt}<span>· {fmt(item.publishedAt)}</span>{/if}
          {#if item.relevance != null}
            <span class="score-pill">{Math.round(item.relevance * 100)}%</span>
          {/if}
        </div>

        {#if item.contentHtml}
          <div class="reader-text" role="article">{@html sanitize(item.contentHtml)}</div>
        {:else if item.contentText}
          <p class="reader-text">{item.contentText}</p>
        {:else}
          <p class="muted" style="text-align:center; padding:2rem 0;">
            Could not extract article — try reading at the source.
          </p>
        {/if}

        <div class="reader-actions">
          <a class="btn" href={item.url} target="_blank" rel="noopener" onclick={() => recordSignal(item.id, "open")}>
            Read original ↗
          </a>
          <button class="btn-ghost" onclick={() => { like(item); }}>{item._liked ? "Liked ✓" : "❤ Like"}</button>
          <button class="btn-ghost" onclick={() => share(item)}>⬆ Share</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ── Swipe mode overlay ─────────────────────────── -->
{#if viewMode === "swipe"}
  {@const card = items[swipeIdx]}
  <div
    class="swipe-overlay"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    {#if card?.imageUrl}
      <img class="swipe-bg" src={card.imageUrl} alt="" referrerpolicy="no-referrer" />
      <div class="swipe-bg-dim"></div>
    {:else}
      <div class="swipe-bg-plain"></div>
    {/if}

    <div class="swipe-topbar">
      <span class="muted" style="font-size:0.78rem">{swipeIdx + 1} / {items.length}{cursor ? "+" : ""}</span>
      <div style="flex:1"></div>
      <button class="btn-ghost" style="font-size:0.8rem;padding:.3rem .8rem;" onclick={() => setMode("scroll")}>≡ Scroll</button>
    </div>

    <div
      class="swipe-card"
      style="transform: translateX({dragX}px) rotate({dragX * 0.025}deg); opacity: {1 - Math.abs(dragX) / 380}"
    >
      {#if card}
        <div class="swipe-meta">
          <span class="badge" style="background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);border-radius:6px;padding:0.05rem 0.45rem;font-size:0.68rem;text-transform:uppercase;">{card.sourceKind ?? "?"}</span>
          {#if card.sourceTitle}<span>{card.sourceTitle}</span>{/if}
          {#if card.relevance != null}<span class="score-pill" style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);">{Math.round(card.relevance * 100)}%</span>{/if}
        </div>
        <h2 class="swipe-title">{card.title}</h2>
        {#if card.contentText}
          <p class="swipe-excerpt">{card.contentText.slice(0, 180)}{card.contentText.length > 180 ? "…" : ""}</p>
        {/if}
        {#if card.author}<p class="swipe-author">{card.author}</p>{/if}
      {:else if loading}
        <p class="muted" style="text-align:center">Loading…</p>
      {:else}
        <p class="muted" style="text-align:center;font-size:1.1rem;">All caught up ✓</p>
      {/if}
    </div>

    {#if dragX > HINT_T}
      <div class="swipe-hint swipe-hint-like">❤ Like</div>
    {:else if dragX < -HINT_T}
      <div class="swipe-hint swipe-hint-skip">✕ Hide</div>
    {/if}

    {#if card}
      <div class="swipe-actions">
        <button class="swipe-btn skip" onclick={swipeHide} title="Hide (←)">✕</button>
        <button class="swipe-btn open" onclick={() => openReader(card)} title="Read">✦</button>
        <button class="swipe-btn share" onclick={() => share(card)} title="Share">⬆</button>
        <button class="swipe-btn like" onclick={swipeLike} title="Like (→)">{card._liked ? "❤" : "♡"}</button>
      </div>
    {/if}
  </div>
{/if}

<!-- ── Scroll feed ────────────────────────────────── -->
<div class="feed-header">
  <h2>For you</h2>
  <div class="feed-controls">
    <button class="mode-btn" class:active={viewMode === "scroll"} onclick={() => setMode("scroll")} title="Scroll">≡</button>
    <button class="mode-btn" class:active={viewMode === "swipe"} onclick={() => setMode("swipe")} title="Swipe">⧉</button>
    <button class="btn-icon" onclick={refresh} disabled={refreshing} title="Refresh" style="margin-left:0.2rem;">
      <span style:animation={refreshing ? "spin 1s linear infinite" : "none"}>↺</span>
    </button>
  </div>
</div>

{#if error}<div class="empty" style="padding:1.5rem 1rem;"><p class="muted">Error: {error}</p></div>{/if}

{#if items.length === 0 && !loading}
  <div class="empty">
    <p>Nothing here yet.</p>
    <p class="muted">Add a source, then check back after a refresh.</p>
    <a class="btn" href="/sources" style="margin-top:0.75rem;">Add sources</a>
  </div>
{/if}

{#each items as item, i (item.id)}
  <article class="card" use:attach data-item-id={item.id}>
    {#if item.imageUrl}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <img
        class="thumb" loading="lazy"
        src={item.imageUrl} alt=""
        referrerpolicy="no-referrer"
        onclick={() => openReader(item)}
        onkeydown={(e) => e.key === "Enter" && openReader(item)}
      />
    {/if}
    <div class="body" role="button" tabindex="0"
      onclick={() => openReader(item)}
      onkeydown={(e) => e.key === "Enter" && openReader(item)}
      style="cursor:pointer;"
    >
      <div class="meta">
        <span class="badge">{item.sourceKind ?? "?"}</span>
        {#if item.sourceTitle}<span>{item.sourceTitle}</span>{/if}
        {#if item.author}<span>· {item.author}</span>{/if}
        {#if item.relevance != null}
          <span class="score-pill" title={item.rationale ?? ""}>{Math.round(item.relevance * 100)}%</span>
        {/if}
      </div>
      <h3 class="title">{item.title}</h3>
      {#if item.contentText}
        <p class="muted" style="margin:0; font-size:0.875rem; line-height:1.5;">{item.contentText.slice(0, 200)}{item.contentText.length > 200 ? "…" : ""}</p>
      {/if}
    </div>
    <div class="actions">
      <button onclick={() => like(item)} class:active={item._liked}>{item._liked ? "Liked ✓" : "❤ Like"}</button>
      <button onclick={() => share(item)}>⬆ Share</button>
      <button onclick={() => hide(item)}>Hide</button>
      <button onclick={() => openReader(item)} style="color:var(--blue);">Read</button>
    </div>

    <!-- Discovery suggestion injected every 5th card -->
    {#if (i + 1) % 5 === 0 && related.length > 0 && i < 5}
      <div class="related-section" style="margin-top:0.25rem;">
        <h3>You may also like</h3>
        <div class="related-scroll">
          {#each related as rel (rel.id)}
            <button class="related-card" onclick={() => openReader(rel)}>
              {#if rel.imageUrl}
                <img src={rel.imageUrl} alt="" referrerpolicy="no-referrer" loading="lazy" />
              {:else}
                <div style="height:110px;background:var(--surface-2);"></div>
              {/if}
              <div class="rc-body">
                <p class="rc-title">{rel.title}</p>
                <p class="rc-meta">{rel.sourceTitle ?? rel.sourceKind ?? ""}</p>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </article>
{/each}

{#if cursor}
  <div style="text-align:center; padding:1rem;">
    <button class="btn-ghost" onclick={loadMore} disabled={loading}>
      {loading ? "Loading…" : "Load more"}
    </button>
  </div>
{/if}

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
</style>

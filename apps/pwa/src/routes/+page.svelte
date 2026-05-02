<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api, type FeedItem } from "$lib/api";
  import { observeItem, recordSignal } from "$lib/dwell";

  let items = $state<FeedItem[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(false);
  let refreshing = $state(false);
  let error = $state<string | null>(null);

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
      await loadMore();
    } finally {
      refreshing = false;
    }
  }

  function open(item: FeedItem) {
    recordSignal(item.id, "open");
    window.open(item.url, "_blank", "noopener");
  }

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

  onMount(loadMore);
</script>

<div class="row" style="margin: 0.5rem 0;">
  <h2 class="muted" style="margin:0; text-transform:uppercase; font-size:0.8rem; letter-spacing:0.05em;">
    For you
  </h2>
  <button class="btn-ghost" onclick={refresh} disabled={refreshing}>
    {refreshing ? "Refreshing…" : "Refresh"}
  </button>
</div>

{#if error}
  <div class="empty">Error: {error}</div>
{/if}

{#if items.length === 0 && !loading}
  <div class="empty">
    <p>No items yet.</p>
    <p class="muted">Add a source to get started, then write your interest profile in Settings.</p>
    <a class="btn" href="/sources">Add sources</a>
  </div>
{/if}

{#each items as item (item.id)}
  <article class="card" use:attach data-item-id={item.id}>
    {#if item.imageUrl}
      <img class="thumb" loading="lazy" src={item.imageUrl} alt="" referrerpolicy="no-referrer" />
    {/if}
    <div class="body">
      <div class="meta">
        <span class="badge">{item.sourceKind ?? "?"}</span>
        {#if item.sourceTitle}<span>{item.sourceTitle}</span>{/if}
        {#if item.author}<span>· {item.author}</span>{/if}
        {#if item.relevance != null}
          <span class="score-pill" title={item.rationale ?? ""}>
            {Math.round(item.relevance * 100)}%
          </span>
        {/if}
      </div>
      <h3 class="title"><a href={item.url} target="_blank" rel="noopener" onclick={() => recordSignal(item.id, "open")}>{item.title}</a></h3>
      {#if item.contentText}
        <p class="muted" style="margin:0; font-size:0.9rem;">{item.contentText.slice(0, 220)}{item.contentText.length > 220 ? "…" : ""}</p>
      {/if}
    </div>
    <div class="actions">
      <button class="btn-ghost" onclick={() => like(item)}>{item._liked ? "Liked ✓" : "Like"}</button>
      <button class="btn-ghost" onclick={() => recordSignal(item.id, "save")}>Save</button>
      <button class="btn-ghost" onclick={() => hide(item)}>Hide</button>
      <button class="btn-ghost" onclick={() => open(item)}>Open ↗</button>
    </div>
  </article>
{/each}

{#if cursor}
  <div style="text-align:center; padding:1rem;">
    <button class="btn-ghost" onclick={loadMore} disabled={loading}>
      {loading ? "Loading…" : "Load more"}
    </button>
  </div>
{/if}

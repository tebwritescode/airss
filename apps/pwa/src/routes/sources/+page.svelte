<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Source } from "$lib/api";

  let sources = $state<Source[]>([]);
  let kind = $state<Source["kind"]>("rss");
  let url = $state("");
  let busy = $state(false);
  let err = $state<string | null>(null);
  let importing = $state(false);
  let importMsg = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function load() {
    sources = (await api.listSources()).sources;
  }

  async function add() {
    if (!url.trim()) return;
    busy = true; err = null;
    try {
      await api.addSource({ kind, url: url.trim() });
      url = "";
      await load();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function remove(id: number) {
    await api.deleteSource(id);
    await load();
  }

  async function importOpml(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importing = true; importMsg = null;
    try {
      const xml = await file.text();
      const r = await fetch("/api/sources/opml/import", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/xml" },
        body: xml,
      });
      const data = await r.json();
      if (r.ok) importMsg = `Added ${data.added} of ${data.total} feeds.`;
      else importMsg = `Import failed: ${data.error ?? r.statusText}`;
      await load();
    } catch (e) {
      importMsg = `Import failed: ${(e as Error).message}`;
    } finally {
      importing = false;
      input.value = "";
    }
  }

  function exportOpml() {
    // Open in new tab so the browser respects the Content-Disposition download.
    window.location.href = "/api/sources/opml/export";
  }

  onMount(load);
</script>

<section class="section">
  <h2>Add source</h2>
  <div class="row">
    <select bind:value={kind} style="flex:0 0 auto; max-width:8rem;">
      <option value="rss">RSS</option>
      <option value="reddit">Reddit</option>
      <option value="youtube">YouTube</option>
      <option value="web">Web page</option>
    </select>
    <input
      bind:value={url}
      placeholder={kind === "reddit" ? "r/selfhosted or full URL" : kind === "youtube" ? "@handle, /channel/UC… or URL" : "https://…"}
    />
    <button class="btn" onclick={add} disabled={busy}>Add</button>
  </div>
  {#if err}<p style="color:var(--bad)">{err}</p>{/if}
</section>

<section class="section">
  <h2>Import / Export</h2>
  <p class="muted" style="font-size:0.85rem; margin-top:0;">
    OPML is the standard subscription format used by most RSS readers.
  </p>
  <div class="row" style="gap:0.5rem;">
    <button class="btn-ghost" onclick={() => fileInput.click()} disabled={importing}>
      {importing ? "Importing…" : "↓ Import OPML"}
    </button>
    <button class="btn-ghost" onclick={exportOpml}>↑ Export OPML</button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".opml,.xml,application/xml,text/xml"
      onchange={importOpml}
      style="display:none;"
    />
  </div>
  {#if importMsg}<p class="muted" style="font-size:0.85rem; margin:0.4rem 0 0;">{importMsg}</p>{/if}
</section>

<section class="section">
  <h2>Sources ({sources.length})</h2>
  {#each sources as s (s.id)}
    <div class="source-row">
      <span class="kind">{s.kind}</span>
      <span class="url">{s.title ?? s.url}</span>
      <button onclick={() => remove(s.id)}>Remove</button>
    </div>
  {:else}
    <p class="muted">No sources yet.</p>
  {/each}
</section>

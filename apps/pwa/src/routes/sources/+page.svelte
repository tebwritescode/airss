<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Source } from "$lib/api";

  let sources = $state<Source[]>([]);
  let kind = $state<Source["kind"]>("rss");
  let url = $state("");
  let busy = $state(false);
  let err = $state<string | null>(null);

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

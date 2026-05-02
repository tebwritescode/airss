<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";

  let promptText = $state("");
  let savedAt = $state<number | null>(null);
  let savingProfile = $state(false);

  let providers = $state<{ provider: string; createdAt: number }[]>([]);
  let configs = $state<{ task: string; provider: string; model: string }[]>([]);
  let newProvider = $state<"anthropic" | "openai" | "openrouter" | "ollama">("anthropic");
  let newKey = $state("");

  let taskRows = $state<Record<string, { provider: string; model: string }>>({
    embed: { provider: "openai", model: "text-embedding-3-small" },
    score_judge: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    summarize: { provider: "anthropic", model: "claude-sonnet-4-6" },
    digest: { provider: "anthropic", model: "claude-opus-4-7" },
  });

  async function loadAll() {
    const p = await api.getProfile();
    promptText = p.profile.promptText ?? "";
    const all = await api.getProviders();
    providers = all.keys;
    configs = all.config;
    for (const c of all.config) {
      taskRows[c.task] = { provider: c.provider, model: c.model };
    }
  }

  async function saveProfile() {
    savingProfile = true;
    try {
      await api.saveProfile(promptText);
      savedAt = Date.now();
    } finally {
      savingProfile = false;
    }
  }

  async function addKey() {
    if (!newKey.trim()) return;
    await api.saveProviderKey(newProvider, newKey.trim());
    newKey = "";
    await loadAll();
  }

  async function removeKey(provider: string) {
    await api.deleteProviderKey(provider);
    await loadAll();
  }

  async function saveTask(task: string) {
    const r = taskRows[task];
    if (!r) return;
    await api.saveTaskConfig(task, r.provider, r.model);
  }

  onMount(loadAll);
</script>

<section class="section">
  <h2>Interest profile</h2>
  <p class="muted" style="margin-top:0">
    Plain-language description of what you care about. Used to score every new item.
  </p>
  <textarea bind:value={promptText} placeholder="I'm interested in self-hosted infrastructure, Rust systems programming, and Wendell-from-L1Techs-style hardware deep dives. I don't care about crypto, celebrity news, or US political horse-race coverage." />
  <div class="row" style="margin-top:0.5rem">
    <span class="muted">{savedAt ? "Saved" : ""}</span>
    <button class="btn" onclick={saveProfile} disabled={savingProfile}>{savingProfile ? "Saving…" : "Save"}</button>
  </div>
</section>

<section class="section">
  <h2>Provider keys</h2>
  <div class="row">
    <select bind:value={newProvider} style="flex:0 0 auto; max-width:9rem;">
      <option value="anthropic">Anthropic</option>
      <option value="openai">OpenAI</option>
      <option value="openrouter">OpenRouter</option>
      <option value="ollama">Ollama (no key)</option>
    </select>
    <input bind:value={newKey} placeholder="API key" type="password" />
    <button class="btn" onclick={addKey}>Save</button>
  </div>
  <p class="muted" style="font-size:0.85rem">Keys are encrypted server-side with libsodium and never returned to the browser.</p>
  {#each providers as k (k.provider)}
    <div class="source-row">
      <span class="kind">{k.provider}</span>
      <span class="url muted">configured · {new Date(k.createdAt).toLocaleString()}</span>
      <button onclick={() => removeKey(k.provider)}>Remove</button>
    </div>
  {/each}
</section>

<section class="section">
  <h2>Per-task model</h2>
  {#each Object.keys(taskRows) as task}
    <div class="row">
      <span class="muted" style="flex:0 0 7rem;">{task}</span>
      <select bind:value={taskRows[task].provider} style="flex:0 0 auto; max-width:9rem;">
        <option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option>
        <option value="openrouter">OpenRouter</option>
        <option value="ollama">Ollama</option>
      </select>
      <input bind:value={taskRows[task].model} placeholder="model id" />
      <button class="btn-ghost" onclick={() => saveTask(task)}>Save</button>
    </div>
  {/each}
</section>

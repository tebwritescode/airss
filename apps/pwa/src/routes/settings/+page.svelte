<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";

  let promptText = $state("");
  let savedAt = $state<number | null>(null);
  let savingProfile = $state(false);

  type ProviderName = "anthropic" | "openai" | "openrouter" | "ollama";

  let providers = $state<{ provider: string; baseUrl: string | null; hasKey: boolean; createdAt: number }[]>([]);
  let configs = $state<{ task: string; provider: string; model: string }[]>([]);

  let newProvider = $state<ProviderName>("openrouter");
  let newKey = $state("");
  let newBaseUrl = $state("");

  // Default base URL hint per provider — shown as the input placeholder.
  const DEFAULT_BASE_URL: Record<ProviderName, string> = {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    ollama: "http://localhost:11434",
  };

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
    // Allow saving baseUrl alone (e.g. updating just an existing entry's URL)
    // — the server preserves the existing key when `key` is empty.
    if (!newKey.trim() && !newBaseUrl.trim()) return;
    await api.saveProviderKey(newProvider, newKey.trim(), newBaseUrl.trim() || null);
    newKey = "";
    newBaseUrl = "";
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
  <p class="muted" style="font-size:0.85rem; margin-top:0">
    Pick a provider, paste an API key, and optionally override the base URL
    (useful for OpenRouter, self-hosted proxies, or pointing OpenAI-compatible
    endpoints at any backend). Keys are encrypted server-side with libsodium and
    never returned to the browser.
  </p>
  <div class="row">
    <select bind:value={newProvider} style="flex:0 0 auto; max-width:9rem;">
      <option value="anthropic">Anthropic</option>
      <option value="openai">OpenAI</option>
      <option value="openrouter">OpenRouter</option>
      <option value="ollama">Ollama (no key)</option>
    </select>
    <input bind:value={newKey} placeholder={newProvider === "ollama" ? "(no key required)" : "API key"} type="password" disabled={newProvider === "ollama"} />
  </div>
  <div class="row">
    <input bind:value={newBaseUrl} placeholder={`Base URL (default: ${DEFAULT_BASE_URL[newProvider]})`} />
    <button class="btn" onclick={addKey} style="flex:0 0 auto;">Save</button>
  </div>

  {#each providers as k (k.provider)}
    <div class="source-row">
      <span class="kind">{k.provider}</span>
      <span class="url muted">
        {k.hasKey ? "key set" : "no key"}{k.baseUrl ? ` · ${k.baseUrl}` : ` · ${DEFAULT_BASE_URL[k.provider as ProviderName] ?? "default"}`}
        · {new Date(k.createdAt).toLocaleString()}
      </span>
      <button onclick={() => removeKey(k.provider)}>Remove</button>
    </div>
  {/each}
</section>

<section class="section">
  <h2>Per-task model</h2>
  <p class="muted" style="font-size:0.85rem; margin-top:0">
    Route each AI task to whichever provider+model fits. With OpenRouter set as
    a provider you can use any model in their catalog as the model id (e.g.
    <code>anthropic/claude-3.5-sonnet</code>, <code>openai/gpt-4o-mini</code>,
    or <code>meta-llama/llama-3.1-8b-instruct</code>).
  </p>
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

<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";

  let promptText = $state("");
  let profileUpdatedAt = $state<string | null>(null);
  let savingProfile = $state(false);
  let regenerating = $state(false);
  let regenStatus = $state<"idle" | "ok" | "err">("idle");

  type ProviderName = "anthropic" | "openai" | "openrouter" | "ollama";

  let providers = $state<{ provider: string; baseUrl: string | null; hasKey: boolean; createdAt: number }[]>([]);
  let configs = $state<{ task: string; provider: string; model: string }[]>([]);
  let newProvider = $state<ProviderName>("openrouter");
  let newKey = $state("");
  let newBaseUrl = $state("");

  const DEFAULT_BASE_URL: Record<ProviderName, string> = {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    ollama: "http://localhost:11434",
  };

  let taskRows = $state<Record<string, { provider: string; model: string }>>({
    embed:       { provider: "openai",     model: "text-embedding-3-small" },
    score_judge: { provider: "anthropic",  model: "claude-haiku-4-5-20251001" },
    summarize:   { provider: "anthropic",  model: "claude-sonnet-4-6" },
    digest:      { provider: "anthropic",  model: "claude-opus-4-7" },
  });

  async function loadAll() {
    const p = await api.getProfile();
    promptText = p.profile.promptText ?? "";
    profileUpdatedAt = p.profile.updatedAt
      ? new Date(p.profile.updatedAt).toLocaleString()
      : null;
    const all = await api.getProviders();
    providers = all.keys;
    configs = all.config;
    for (const c of all.config) taskRows[c.task] = { provider: c.provider, model: c.model };
  }

  async function saveProfile() {
    savingProfile = true;
    try {
      await api.saveProfile(promptText);
    } finally {
      savingProfile = false;
    }
  }

  async function regenerateProfile() {
    regenerating = true;
    regenStatus = "idle";
    try {
      const r = await fetch("/api/profile/regenerate", { method: "POST", credentials: "include" });
      if (r.ok) {
        const data = await r.json() as { profile: string };
        promptText = data.profile;
        profileUpdatedAt = new Date().toLocaleString();
        regenStatus = "ok";
      } else {
        regenStatus = "err";
      }
    } catch {
      regenStatus = "err";
    } finally {
      regenerating = false;
    }
  }

  async function addKey() {
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
  <p class="muted" style="margin-top:0; font-size:0.85rem;">
    AI builds this automatically from your feeds and reading behaviour.
    You can edit it directly — your edits are preserved until the next auto-update.
  </p>

  <div style="position:relative;">
    <textarea
      bind:value={promptText}
      placeholder="Add a source and read a few articles — AI will build your profile automatically."
      style="padding-right: 2.5rem;"
    />
    {#if promptText}
      <span
        title="AI-generated"
        style="position:absolute;top:0.6rem;right:0.65rem;font-size:1rem;opacity:0.5;pointer-events:none;"
      >✦</span>
    {/if}
  </div>

  {#if profileUpdatedAt}
    <p class="muted" style="font-size:0.75rem; margin:0.25rem 0 0;">Last updated {profileUpdatedAt}</p>
  {/if}

  <div class="row" style="margin-top:0.6rem; gap:0.5rem;">
    <button
      class="btn-ghost"
      onclick={regenerateProfile}
      disabled={regenerating}
      title="Ask AI to rebuild the profile from your current reading history"
    >
      {#if regenerating}
        ✦ Building…
      {:else if regenStatus === "ok"}
        ✦ Updated
      {:else if regenStatus === "err"}
        ✦ Failed — is a provider configured?
      {:else}
        ✦ Rebuild with AI
      {/if}
    </button>
    <div style="flex:1;"></div>
    <button class="btn" onclick={saveProfile} disabled={savingProfile}>
      {savingProfile ? "Saving…" : "Save"}
    </button>
  </div>
</section>

<section class="section">
  <h2>Provider keys</h2>
  <p class="muted" style="font-size:0.85rem; margin-top:0">
    Pick a provider, paste an API key, and optionally override the base URL.
    Keys are encrypted server-side and never returned to the browser.
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
      <span class="kind">{k.provider.toUpperCase()}</span>
      <span class="url muted">
        {k.hasKey ? "key set" : "no key"}{k.baseUrl ? ` · ${k.baseUrl}` : ""} · {new Date(k.createdAt).toLocaleString()}
      </span>
      <button onclick={() => removeKey(k.provider)}>Remove</button>
    </div>
  {/each}
</section>

<section class="section">
  <h2>Per-task model</h2>
  <p class="muted" style="font-size:0.85rem; margin-top:0">
    Route each AI task to whichever provider+model fits. With OpenRouter you can use
    any model in their catalog (e.g. <code>anthropic/claude-3.5-sonnet</code>,
    <code>openai/gpt-4o-mini</code>).
    The <strong>summarize</strong> task is used for AI profile generation.
  </p>
  {#each Object.keys(taskRows) as task}
    <div class="row">
      <span class="muted" style="flex:0 0 7rem; font-size:0.85rem;">{task}</span>
      <select bind:value={taskRows[task].provider} style="flex:0 0 auto; max-width:8.5rem;">
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

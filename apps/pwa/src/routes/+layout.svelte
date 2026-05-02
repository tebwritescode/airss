<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";

  let { children } = $props();
  let booted = $state(false);
  let path = $derived($page.url.pathname);

  onMount(async () => {
    try {
      const s = await api.authStatus();
      if (s.firstRun && path !== "/setup") goto("/setup");
    } catch {
      // ignore — pages handle 401s
    } finally {
      booted = true;
    }
  });

  const hideTabBar = ["/setup", "/login"].includes(path);
</script>

<main class="shell">
  {#if booted}
    {@render children()}
  {/if}
</main>

{#if booted && !hideTabBar}
  <nav class="tabbar">
    <a class="tab" class:active={path === "/"} href="/">
      <span class="icon">⌂</span>
      <span>Feed</span>
    </a>
    <a class="tab" class:active={path.startsWith("/sources")} href="/sources">
      <span class="icon">＋</span>
      <span>Sources</span>
    </a>
    <a class="tab" class:active={path.startsWith("/settings")} href="/settings">
      <span class="icon">⚙</span>
      <span>Settings</span>
    </a>
  </nav>
{/if}

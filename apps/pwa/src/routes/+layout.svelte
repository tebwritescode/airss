<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";

  let { children } = $props();
  let booted = $state(false);

  onMount(async () => {
    try {
      const s = await api.authStatus();
      const path = $page.url.pathname;
      if (s.firstRun && path !== "/setup") goto("/setup");
    } catch {
      // ignore — page itself can show login state via 401s
    } finally {
      booted = true;
    }
  });
</script>

<nav class="topnav">
  <h1>swift-newt</h1>
  <a href="/" class:active={$page.url.pathname === "/"}>Feed</a>
  <a href="/sources" class:active={$page.url.pathname.startsWith("/sources")}>Sources</a>
  <a href="/settings" class:active={$page.url.pathname.startsWith("/settings")}>Settings</a>
</nav>

<main class="shell">
  {#if booted}
    {@render children()}
  {/if}
</main>

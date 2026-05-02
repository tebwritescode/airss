<script lang="ts">
  import { api } from "$lib/api";

  import { goto } from "$app/navigation";

  let password = $state("");
  let confirm = $state("");
  let busy = $state(false);
  let done = $state(false);
  let err = $state<string | null>(null);

  async function submit() {
    err = null;
    if (password.length < 8) { err = "Password must be at least 8 characters."; return; }
    if (password !== confirm) { err = "Passwords don't match."; return; }
    busy = true;
    try {
      await api.setup(password);
      done = true;
      goto("/");
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="section">
  <h2>Initial setup</h2>
  {#if done}
    <p>Logged in. Redirecting…</p>
  {:else}
    <p class="muted" style="margin-top:0">Pick a password for this single-user instance.</p>
    <div class="row"><input bind:value={password} type="password" placeholder="Password (min 8)" /></div>
    <div class="row"><input bind:value={confirm} type="password" placeholder="Confirm" /></div>
    {#if err}<p style="color:var(--bad)">{err}</p>{/if}
    <div class="row"><button class="btn" onclick={submit} disabled={busy}>{busy ? "…" : "Create"}</button></div>
  {/if}
</section>

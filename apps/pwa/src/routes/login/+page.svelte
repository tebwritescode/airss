<script lang="ts">
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";

  let password = $state("");
  let busy = $state(false);
  let err = $state<string | null>(null);

  async function submit() {
    busy = true; err = null;
    try {
      await api.login(password);
      goto("/");
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="section">
  <h2>Sign in</h2>
  <div class="row"><input bind:value={password} type="password" placeholder="Password" /></div>
  {#if err}<p style="color:var(--bad)">{err}</p>{/if}
  <div class="row"><button class="btn" onclick={submit} disabled={busy}>{busy ? "…" : "Sign in"}</button></div>
</section>

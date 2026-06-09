<script lang="ts">
  // /calls station root — exists for navigability; the wizard at /calls/work is
  // the meaningful surface, so redirect there immediately on mount.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  onMount(() => {
    goto(`${base}/calls/work`, { replaceState: true });
  });
</script>

<svelte:head><title>Calls · Studio44</title></svelte:head>

<p class="redirecting">Opening the Calls wizard…</p>

<style>
  .redirecting {
    color: #a1a1aa;
    padding: 2rem 0;
  }
</style>

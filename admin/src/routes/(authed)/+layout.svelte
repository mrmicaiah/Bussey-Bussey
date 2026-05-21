<script lang="ts">
  import Header from '$lib/components/Header.svelte';
  let { data, children }: { data: { user: import('$lib/types').AdminUser }; children: import('svelte').Snippet } = $props();
</script>

<Header user={data.user} />
<main>
  {@render children()}
</main>

<style>
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-6);
  }
</style>

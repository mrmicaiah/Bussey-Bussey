<script lang="ts">
  let {
    label,
    hint,
    error,
    children,
  }: {
    label: string;
    hint?: string;
    error?: string | null;
    children: import('svelte').Snippet;
  } = $props();
</script>

<label class="field">
  <span class="label">{label}</span>
  {@render children()}
  {#if hint}<span class="hint">{hint}</span>{/if}
  {#if error}<span class="err">{error}</span>{/if}
</label>

<style>
  .field { display: flex; flex-direction: column; gap: 0.3rem; }
  .label { font-size: 0.9rem; font-weight: 500; color: var(--text); }
  .hint  { font-size: 0.8rem; color: var(--muted); }
  .err   { font-size: 0.8rem; color: var(--danger); }

  .field :global(input),
  .field :global(textarea),
  .field :global(select) {
    padding: 0.55rem 0.7rem;
    font-size: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: inherit;
    color: var(--text);
  }
  .field :global(input:focus),
  .field :global(textarea:focus),
  .field :global(select:focus) {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .field :global(textarea) { min-height: 5rem; resize: vertical; }
</style>

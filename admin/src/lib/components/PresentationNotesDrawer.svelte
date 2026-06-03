<script lang="ts">
  import { untrack } from 'svelte';
  type Props = {
    value: string;
    readOnly: boolean;
    onsave: (next: string) => Promise<void>;
    /** Called externally before navigation away to flush any pending save. */
    flushKey?: number;
  };
  let { value, readOnly, onsave, flushKey = 0 }: Props = $props();

  let local = $state(untrack(() => value));
  let collapsed = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let lastSaved = $state(untrack(() => value));
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let lastFlushKey = untrack(() => flushKey);

  $effect(() => {
    if (value !== lastSaved) {
      // Server refreshed the value (e.g. after clone load) — sync local without firing a save.
      local = value;
      lastSaved = value;
    }
  });

  async function save(force: boolean) {
    if (readOnly) return;
    if (local === lastSaved && !force) return;
    if (debounceHandle) { clearTimeout(debounceHandle); debounceHandle = null; }
    saving = true;
    saveError = null;
    const sending = local;
    try {
      await onsave(sending);
      lastSaved = sending;
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed.';
    } finally {
      saving = false;
    }
  }

  function onInput() {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => { void save(false); }, 1000);
  }

  $effect(() => {
    if (flushKey !== lastFlushKey) {
      lastFlushKey = flushKey;
      void save(true);
    }
  });

  function toggle() { collapsed = !collapsed; }
</script>

<section class="drawer" class:collapsed>
  <header>
    <button type="button" class="toggle" onclick={toggle}>
      {collapsed ? '▶' : '▼'} Presentation notes
    </button>
    <div class="status muted small">
      {#if saving}saving…{:else if saveError}<span class="error">{saveError}</span>{:else if local !== lastSaved}unsaved{:else}saved{/if}
    </div>
  </header>
  {#if !collapsed}
    <p class="muted small">
      Internal-only. Written during the sales conversation; copied to the project on activation.
      Never visible to the client.
    </p>
    <textarea
      bind:value={local}
      oninput={onInput}
      onblur={() => save(false)}
      disabled={readOnly}
      placeholder="What did they say? What context matters for delivery? Who decides? What's the next move?"
    ></textarea>
  {/if}
</section>

<style>
  .drawer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-3) var(--space-4);
  }
  header { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  .toggle {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    color: var(--text);
  }
  textarea {
    width: 100%;
    min-height: 120px;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font: inherit;
    resize: vertical;
    margin-top: 0.5rem;
    background: var(--surface);
    color: var(--text);
  }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  textarea:disabled { background: var(--border); }
  .error { color: var(--danger); }
</style>

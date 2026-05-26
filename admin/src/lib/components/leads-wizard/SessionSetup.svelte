<script lang="ts">
  // Studio44 Layer 1 — session setup (§2.1). Choose Cold or Follow-ups + a target,
  // Start enters the card loop. READ-ONLY: Start just triggers the queue fetch.
  import type { QueueMode, QueueTargetKind } from '$lib/types';

  let {
    onstart,
    loading = false,
    error = null,
  }: {
    onstart: (opts: { mode: QueueMode; target_kind: QueueTargetKind; target: number }) => void;
    loading?: boolean;
    error?: string | null;
  } = $props();

  let mode = $state<QueueMode>('cold');
  let targetKind = $state<QueueTargetKind>('book');
  let target = $state(3);

  function start() {
    if (loading) return;
    const n = Number.isFinite(target) && target >= 1 ? Math.floor(target) : 1;
    onstart({ mode, target_kind: targetKind, target: n });
  }
</script>

<div class="setup">
  <h1>Work leads</h1>
  <p class="lede">Pick a mode, set a target, and start the session. You'll get one lead at a time.</p>

  <div class="group">
    <span class="glabel">Mode</span>
    <div class="toggle">
      <button type="button" class:active={mode === 'cold'} onclick={() => (mode = 'cold')}>
        <strong>Cold calling</strong><span>Never-contacted leads</span>
      </button>
      <button type="button" class:active={mode === 'followups'} onclick={() => (mode = 'followups')}>
        <strong>Follow-ups</strong><span>Leads with a follow-up due</span>
      </button>
    </div>
  </div>

  <div class="group">
    <span class="glabel">Session target</span>
    <div class="target-row">
      <input type="number" min="1" step="1" bind:value={target} aria-label="Target count" />
      <div class="toggle small">
        <button type="button" class:active={targetKind === 'book'} onclick={() => (targetKind = 'book')}>
          assessments booked
        </button>
        <button type="button" class:active={targetKind === 'call'} onclick={() => (targetKind = 'call')}>
          calls made
        </button>
      </div>
    </div>
  </div>

  {#if error}<div class="err">{error}</div>{/if}

  <button type="button" class="start" onclick={start} disabled={loading}>
    {loading ? 'Loading queue…' : 'Start session →'}
  </button>
</div>

<style>
  .setup { max-width: 540px; }
  h1 { color: var(--s44-text, #f4f4f5); margin: 0 0 0.25rem; font-size: 1.6rem; }
  .lede { color: var(--s44-muted, #a1a1aa); margin: 0 0 1.5rem; }
  .group { margin-bottom: 1.4rem; }
  .glabel { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--s44-muted, #a1a1aa); margin-bottom: 0.5rem; }
  .toggle { display: flex; gap: 0.6rem; }
  .toggle button {
    flex: 1; cursor: pointer; text-align: left; font: inherit;
    background: var(--s44-surface, #141416); border: 1px solid var(--s44-border, #2a2a2e);
    border-radius: 10px; padding: 0.8rem 0.9rem; color: var(--s44-text, #f4f4f5);
    display: flex; flex-direction: column; gap: 0.2rem;
  }
  .toggle button span { font-size: 0.78rem; color: var(--s44-muted, #a1a1aa); }
  .toggle button:hover { border-color: var(--s44-crimson, #d40b1e); }
  .toggle button.active { border-color: var(--s44-crimson, #d40b1e); box-shadow: inset 0 0 0 1px var(--s44-crimson, #d40b1e); }
  .toggle.small button { flex: none; padding: 0.5rem 0.8rem; }

  .target-row { display: flex; gap: 0.8rem; align-items: stretch; flex-wrap: wrap; }
  .target-row input {
    width: 90px; font: inherit; font-size: 1.1rem; text-align: center;
    background: var(--s44-surface, #141416); border: 1px solid var(--s44-border, #2a2a2e);
    border-radius: 10px; color: var(--s44-text, #f4f4f5); padding: 0.4rem;
  }

  .err {
    background: rgba(212, 11, 30, 0.12); border: 1px solid var(--s44-crimson, #d40b1e);
    color: #fca5a5; border-radius: 8px; padding: 0.6rem 0.8rem; margin-bottom: 1rem; font-size: 0.88rem;
  }
  .start {
    width: 100%; cursor: pointer; font: inherit; font-weight: 700; font-size: 1rem;
    background: var(--s44-crimson, #d40b1e); color: #fff; border: none; border-radius: 10px; padding: 0.85rem;
  }
  .start:disabled { opacity: 0.6; cursor: not-allowed; }
  .start:not(:disabled):hover { filter: brightness(1.1); }
</style>

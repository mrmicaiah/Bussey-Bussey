<script lang="ts">
  // Studio44 Layer 1 — always-on call framework (§2.2). All four stages visible at
  // once; each shows its selected variant's text + inline usage rollup, with a
  // picker to switch. READ-ONLY: picking a variant only changes client-side
  // selection — nothing is persisted (usage is logged at outcome time in step 4+).
  import type { ScriptVariantsByStage, ScriptVariantStage, ScriptVariantWithUsage } from '$lib/types';

  let {
    variants,
    selected,
    onpick,
  }: {
    variants: ScriptVariantsByStage;
    selected: Record<ScriptVariantStage, string | null>;
    onpick: (stage: ScriptVariantStage, variantId: string) => void;
  } = $props();

  const STAGES: { stage: ScriptVariantStage; label: string; timing: string }[] = [
    { stage: 'opener', label: 'Opener', timing: '15–20s · pattern interrupt + permission' },
    { stage: 'hook', label: 'Hook', timing: '30–45s · specific outcome, not features' },
    { stage: 'discovery', label: 'Discovery', timing: '2–3 min · open questions, qualify' },
    { stage: 'close', label: 'Close', timing: 'book it — two times. Do not pitch.' },
  ];

  function pct(v: ScriptVariantWithUsage): string {
    return `${Math.round(v.usage.book_rate * 100)}%`;
  }
  function selectedVariant(stage: ScriptVariantStage): ScriptVariantWithUsage | null {
    const id = selected[stage];
    return variants[stage].find((v) => v.id === id) ?? variants[stage][0] ?? null;
  }
</script>

<div class="framework">
  {#each STAGES as s (s.stage)}
    {@const sel = selectedVariant(s.stage)}
    {@const others = variants[s.stage]}
    <section class="stage">
      <header class="stage-head">
        <span class="stage-name">{s.label}</span>
        <span class="stage-timing">{s.timing}</span>
      </header>

      {#if sel}
        <p class="variant-body">{sel.body}</p>
        <div class="variant-meta">
          {#if sel.label}<span class="variant-label">{sel.label}</span>{/if}
          <span class="stat">used {sel.usage.used_count}×</span>
          <span class="stat">booked {sel.usage.booked_count}</span>
          <span class="stat rate">{pct(sel)} book-rate</span>
        </div>

        {#if others.length > 1}
          <details class="picker">
            <summary>+ {others.length} variants</summary>
            <ul>
              {#each others as v (v.id)}
                <li>
                  <button
                    type="button"
                    class="pick"
                    class:active={v.id === sel.id}
                    onclick={() => onpick(s.stage, v.id)}
                  >
                    <span class="pick-body">{v.body}</span>
                    <span class="pick-stat">used {v.usage.used_count}× · {pct(v)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      {:else}
        <p class="empty">No {s.label.toLowerCase()} variant yet.</p>
      {/if}
    </section>
  {/each}
</div>

<style>
  .framework { display: flex; flex-direction: column; gap: 0.75rem; }
  .stage {
    border: 1px solid var(--s44-border, #2a2a2e);
    border-left: 3px solid var(--s44-crimson, #d40b1e);
    border-radius: 8px;
    background: var(--s44-surface-2, #1c1c1f);
    padding: 0.7rem 0.85rem;
  }
  .stage-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.35rem; }
  .stage-name { font-weight: 600; color: var(--s44-text, #f4f4f5); letter-spacing: 0.02em; }
  .stage-timing { font-size: 0.72rem; color: var(--s44-muted, #a1a1aa); text-align: right; }
  .variant-body { margin: 0 0 0.4rem; color: var(--s44-text, #f4f4f5); line-height: 1.45; font-size: 0.92rem; }
  .variant-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; font-size: 0.74rem; }
  .variant-label {
    color: var(--s44-crimson, #d40b1e);
    border: 1px solid var(--s44-crimson, #d40b1e);
    border-radius: 999px; padding: 0.05rem 0.45rem; font-weight: 600;
  }
  .stat { color: var(--s44-muted, #a1a1aa); }
  .stat.rate { color: var(--s44-text, #f4f4f5); font-weight: 600; }
  .picker { margin-top: 0.45rem; }
  .picker summary {
    cursor: pointer; color: var(--s44-crimson, #d40b1e); font-size: 0.78rem; font-weight: 600;
    list-style: none;
  }
  .picker summary::-webkit-details-marker { display: none; }
  .picker ul { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .pick {
    width: 100%; text-align: left; cursor: pointer;
    background: var(--s44-surface, #141416);
    border: 1px solid var(--s44-border, #2a2a2e); border-radius: 6px;
    padding: 0.45rem 0.6rem; font: inherit; color: var(--s44-text, #f4f4f5);
    display: flex; flex-direction: column; gap: 0.2rem;
  }
  .pick:hover { border-color: var(--s44-crimson, #d40b1e); }
  .pick.active { border-color: var(--s44-crimson, #d40b1e); box-shadow: inset 0 0 0 1px var(--s44-crimson, #d40b1e); }
  .pick-body { font-size: 0.85rem; line-height: 1.4; }
  .pick-stat { font-size: 0.72rem; color: var(--s44-muted, #a1a1aa); }
  .empty { margin: 0; color: var(--s44-muted, #a1a1aa); font-size: 0.85rem; font-style: italic; }
</style>

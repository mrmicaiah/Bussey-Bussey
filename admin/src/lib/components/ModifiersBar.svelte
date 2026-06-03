<script lang="ts">
  import { untrack } from 'svelte';
  import type { ProposalModifiers } from '$lib/types';

  type Props = {
    modifiers: ProposalModifiers;
    readOnly: boolean;
    onchange: (next: Partial<ProposalModifiers>) => Promise<void>;
  };
  let { modifiers, readOnly, onchange }: Props = $props();

  let complexity = $state(untrack(() => modifiers.complexity_multiplier));
  let urgency = $state(untrack(() => modifiers.urgency_multiplier));
  let discount = $state(untrack(() => modifiers.custom_discount_percent));
  let saving = $state(false);

  $effect(() => {
    complexity = modifiers.complexity_multiplier;
    urgency = modifiers.urgency_multiplier;
    discount = modifiers.custom_discount_percent;
  });

  async function persist(field: keyof ProposalModifiers, value: number) {
    if (readOnly) return;
    saving = true;
    try {
      await onchange({ [field]: value });
    } finally {
      saving = false;
    }
  }

  async function onComplexityBlur() {
    const n = Number(complexity);
    if (!Number.isFinite(n) || n <= 0) { complexity = modifiers.complexity_multiplier; return; }
    if (n > 1.5) {
      if (!confirm(`Complexity multiplier ${n} is above the typical 1.5 ceiling. Confirm?`)) {
        complexity = modifiers.complexity_multiplier;
        return;
      }
    }
    if (n === modifiers.complexity_multiplier) return;
    await persist('complexity_multiplier', n);
  }

  async function onUrgencyBlur() {
    const n = Number(urgency);
    if (!Number.isFinite(n) || n <= 0) { urgency = modifiers.urgency_multiplier; return; }
    if (n > 1.3) {
      if (!confirm(`Urgency multiplier ${n} is above the typical 1.3 ceiling. Confirm?`)) {
        urgency = modifiers.urgency_multiplier;
        return;
      }
    }
    if (n === modifiers.urgency_multiplier) return;
    await persist('urgency_multiplier', n);
  }

  async function onDiscountBlur() {
    const n = Number(discount);
    if (!Number.isFinite(n) || n < 0 || n > 100) { discount = modifiers.custom_discount_percent; return; }
    if (n > 25) {
      if (!confirm(`Discount ${n}% is above the typical 25% ceiling. Confirm?`)) {
        discount = modifiers.custom_discount_percent;
        return;
      }
    }
    if (n === modifiers.custom_discount_percent) return;
    await persist('custom_discount_percent', n);
  }
</script>

<div class="mods">
  <h3>Modifiers</h3>
  <div class="row">
    <label>
      <span>Complexity ×</span>
      <input type="number" step="0.05" min="0" bind:value={complexity} onblur={onComplexityBlur} disabled={readOnly} />
    </label>
    <label>
      <span>Urgency ×</span>
      <input type="number" step="0.05" min="0" bind:value={urgency} onblur={onUrgencyBlur} disabled={readOnly} />
    </label>
    <label>
      <span>Discount %</span>
      <input type="number" step="0.5" min="0" max="100" bind:value={discount} onblur={onDiscountBlur} disabled={readOnly} />
    </label>
    {#if saving}<span class="muted small">saving…</span>{/if}
  </div>
</div>

<style>
  .mods {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-3);
  }
  h3 {
    margin: 0 0 var(--space-2);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .row { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-end; }
  label { display: flex; flex-direction: column; gap: 0.2rem; }
  label span { font-size: 0.78rem; color: var(--muted); }
  input { width: 80px; padding: 0.3rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font: inherit; text-align: right; background: var(--surface); color: var(--text); }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  input:disabled { background: var(--border); }
</style>

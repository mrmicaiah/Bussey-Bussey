<script lang="ts">
  import Button from '../Button.svelte';

  let {
    setupTotal,
    monthlyTotal,
    monthlyStartsOn,
  }: {
    setupTotal: number;
    monthlyTotal: number;
    monthlyStartsOn: string;
  } = $props();

  function fmt(amount: number): string {
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  }

  function fmtDate(iso: string): string {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<div class="surface step">
  <h1>Set up payment</h1>
  <p class="muted">
    Here's what you'll be charged. Payment setup will be enabled shortly.
  </p>

  <div class="summary">
    <div class="row-2">
      <span class="label">Setup fee (charged today)</span>
      <span class="amount">{fmt(setupTotal)}</span>
    </div>
    <div class="row-2">
      <span class="label">Monthly subscription</span>
      <span class="amount">{fmt(monthlyTotal)} / mo</span>
    </div>
    <div class="row-2 sub">
      <span class="label">First monthly charge</span>
      <span class="amount">{fmtDate(monthlyStartsOn)}</span>
    </div>
  </div>

  <div class="callout">
    <strong>Payment isn't connected yet in this build.</strong>
    The next iteration (step J2) wires up Stripe — secure card capture, the
    setup-fee charge, and the recurring monthly subscription. For now you
    can review the totals above; you'll come back here to add a card when
    we let you know it's ready.
  </div>

  <div class="cta">
    <Button disabled>Set up payment</Button>
    <span class="muted small">Enabled in step J2.</span>
  </div>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-4); }
  .summary {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .row-2 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .row-2.sub { padding-top: 0.6rem; border-top: 1px dashed var(--border); }
  .row-2 .label { color: var(--muted); }
  .row-2 .amount { font-weight: 600; font-variant-numeric: tabular-nums; }
  .callout {
    background: #fff7e6;
    border: 1px solid #f1d8a3;
    border-radius: var(--radius);
    padding: var(--space-3) var(--space-4);
    font-size: 0.9rem;
    color: #6b4a06;
  }
  .cta { display: flex; align-items: center; gap: var(--space-3); }
</style>

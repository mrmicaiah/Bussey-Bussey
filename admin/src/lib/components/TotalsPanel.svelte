<script lang="ts">
  import type { Proposal, ProposalLineItem, ProposalSnapshot } from '$lib/types';

  type Props = {
    proposal: Proposal;
    lineItems: ProposalLineItem[];
    snapshot: ProposalSnapshot;
  };
  let { proposal, lineItems, snapshot }: Props = $props();

  /** Unmodified subtotals, for showing the modifier math transparently. */
  const subtotals = $derived(() => {
    let setup = 0;
    let monthly = 0;
    for (const li of lineItems) {
      const comp = snapshot.components[li.component_code];
      const unitType = comp?.unit_type ?? (li.component_code === 'custom_line_item' ? 'per_item_setup' : null);
      if (!unitType) continue;
      if (unitType === 'flat_setup' || unitType === 'per_item_setup') setup += li.line_total;
      else if (unitType === 'flat_monthly' || unitType === 'per_item_monthly') monthly += li.line_total;
      else if (unitType === 'setup_and_monthly') { setup += li.line_total; monthly += li.line_total; }
    }
    return { setup, monthly };
  });

  function fmt(n: number): string {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
</script>

<aside class="totals">
  <h3>Totals</h3>

  <div class="row sub">
    <span>Setup subtotal</span>
    <span class="num">${fmt(subtotals().setup)}</span>
  </div>
  <div class="row sub">
    <span>Monthly subtotal</span>
    <span class="num">${fmt(subtotals().monthly)}</span>
  </div>

  <div class="divider"></div>

  <div class="row mod">
    <span>Complexity</span>
    <span class="num">× {proposal.modifiers.complexity_multiplier}</span>
  </div>
  <div class="row mod">
    <span>Urgency</span>
    <span class="num">× {proposal.modifiers.urgency_multiplier}</span>
  </div>
  <div class="row mod">
    <span>Discount</span>
    <span class="num">− {proposal.modifiers.custom_discount_percent}%</span>
  </div>

  <div class="divider"></div>

  <div class="row total">
    <span>Setup total</span>
    <span class="num">${fmt(proposal.setup_total)}</span>
  </div>
  <div class="row total">
    <span>Monthly</span>
    <span class="num">${fmt(proposal.monthly_total)}<span class="per-month">/mo</span></span>
  </div>

  <div class="margin">
    <p class="muted small">
      <strong>Margin / buffer:</strong> not tracked yet — requires cost data.
      See <code>notes/deferred-cleanup.md</code>.
    </p>
  </div>
</aside>

<style>
  .totals {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4);
    position: sticky;
    top: var(--space-4);
  }
  h3 {
    margin: 0 0 var(--space-3);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .row { display: flex; justify-content: space-between; padding: 0.2rem 0; }
  .row.sub { color: var(--muted); font-size: 0.9rem; }
  .row.mod { color: var(--muted); font-size: 0.88rem; }
  .row.total { font-size: 1.05rem; font-weight: 600; }
  .row.total .num { color: var(--accent); }
  .num { font-variant-numeric: tabular-nums; }
  .per-month { font-size: 0.75rem; color: var(--muted); margin-left: 2px; }
  .divider { height: 1px; background: var(--border); margin: var(--space-3) 0; }
  .margin { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px dashed var(--border); }
  code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; font-size: 0.8rem; }
</style>

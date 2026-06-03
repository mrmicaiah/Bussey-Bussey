<script lang="ts">
  import { untrack } from 'svelte';
  import type { ProposalLineItem, PricingComponent, ProposalSnapshot } from '$lib/types';

  type Props = {
    line: ProposalLineItem;
    snapshot: ProposalSnapshot;
    readOnly: boolean;
    onupdate: (id: string, fields: { quantity?: number; description_override?: string | null; unit_price?: number }) => Promise<void>;
    onremove: (id: string) => Promise<void>;
  };
  let { line, snapshot, readOnly, onupdate, onremove }: Props = $props();

  let qty = $state(untrack(() => line.quantity));
  let desc = $state(untrack(() => line.description_override ?? ''));
  let unitPrice = $state(untrack(() => line.unit_price_at_snapshot));
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  $effect(() => {
    qty = line.quantity;
    desc = line.description_override ?? '';
    unitPrice = line.unit_price_at_snapshot;
  });

  const comp: PricingComponent | undefined = $derived(snapshot.components[line.component_code]);
  const isCustom = $derived(line.component_code === 'custom_line_item');
  const unitType = $derived(comp?.unit_type ?? (isCustom ? 'per_item_setup' : null));
  const bucketLabel = $derived(unitType === 'flat_monthly' || unitType === 'per_item_monthly' ? 'monthly' : 'setup');
  const displayName = $derived(isCustom ? desc || '(custom line item)' : comp?.name ?? line.component_code);

  async function persist(fields: { quantity?: number; description_override?: string | null; unit_price?: number }) {
    if (readOnly) return;
    saving = true;
    saveError = null;
    try {
      await onupdate(line.id, fields);
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed.';
    } finally {
      saving = false;
    }
  }

  async function onQtyBlur() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      qty = line.quantity; // revert
      return;
    }
    if (n === line.quantity) return;
    await persist({ quantity: n });
  }

  async function onDescBlur() {
    const next = desc.trim() === '' ? null : desc;
    if (next === (line.description_override ?? null)) return;
    await persist({ description_override: next });
  }

  async function onUnitPriceBlur() {
    if (!isCustom) return;
    const n = Number(unitPrice);
    if (!Number.isFinite(n) || n < 0) {
      unitPrice = line.unit_price_at_snapshot;
      return;
    }
    if (n === line.unit_price_at_snapshot) return;
    await persist({ unit_price: n });
  }
</script>

<tr class:saving>
  <td class="name-cell">
    <div class="name">{displayName}</div>
    <div class="muted small">
      <span class="bucket bucket-{bucketLabel}">{bucketLabel}</span>
      <span class="code">{line.component_code}</span>
    </div>
  </td>
  <td>
    <input
      type="number"
      min="1"
      step="1"
      bind:value={qty}
      onblur={onQtyBlur}
      disabled={readOnly}
      class="qty"
    />
  </td>
  <td class="num">
    {#if isCustom}
      <input
        type="number"
        min="0"
        step="0.01"
        bind:value={unitPrice}
        onblur={onUnitPriceBlur}
        disabled={readOnly}
        class="unit-price"
      />
    {:else}
      ${line.unit_price_at_snapshot.toLocaleString()}
    {/if}
  </td>
  <td class="num"><strong>${line.line_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
  <td>
    <input
      type="text"
      bind:value={desc}
      onblur={onDescBlur}
      placeholder={isCustom ? 'Description (required)' : 'Override default description (optional)'}
      disabled={readOnly}
      class="desc"
    />
  </td>
  <td class="actions">
    {#if !readOnly}
      <button type="button" onclick={() => onremove(line.id)} aria-label="Remove line item" class="remove">×</button>
    {/if}
    {#if saving}<span class="muted small">saving…</span>{/if}
    {#if saveError}<span class="error small">{saveError}</span>{/if}
  </td>
</tr>

<style>
  .name-cell { min-width: 220px; }
  .name { font-weight: 500; }
  .code { font-family: ui-monospace, monospace; font-size: 0.78rem; }
  .bucket {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-right: 0.4rem;
  }
  /* Bucket pills mapped to the badge families: setup = crimson (navy was the old
     accent), monthly = amber. Text uses the family's light text token — --accent
     itself lacks contrast at this size on dark. */
  .bucket-setup { background: rgba(212, 11, 30, 0.12); color: var(--danger); }
  .bucket-monthly { background: rgba(250, 199, 117, 0.12); color: var(--warning); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .qty { width: 70px; text-align: right; }
  .unit-price { width: 95px; text-align: right; }
  .desc { width: 100%; min-width: 180px; }
  .actions { white-space: nowrap; }
  .remove {
    background: none;
    border: none;
    font-size: 1.4rem;
    line-height: 1;
    color: var(--muted);
    cursor: pointer;
    padding: 0 0.4rem;
  }
  .remove:hover { color: var(--danger); }
  tr.saving td { background: var(--surface-2); }
  .error { color: var(--danger); }
  input { padding: 0.25rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font: inherit; background: var(--surface); color: var(--text); }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  input:disabled { background: var(--border); color: var(--muted); }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api } from '$lib/api';
  import type { PortalChangeOrderSummary } from '$lib/types';

  let changeOrders = $state<PortalChangeOrderSummary[]>([]);
  let loaded = $state(false);

  function fmt(n: number): string {
    const sign = n < 0 ? '-' : n > 0 ? '+' : '';
    return `${sign}${Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}`;
  }

  onMount(async () => {
    try {
      const res = await api.get<{ change_orders: PortalChangeOrderSummary[] }>(
        '/api/portal/change-orders',
      );
      changeOrders = res.change_orders;
    } catch {
      changeOrders = [];
    } finally {
      loaded = true;
    }
  });

  const pending = $derived(changeOrders.filter((c) => c.status === 'proposed'));
  const past = $derived(changeOrders.filter((c) => c.status !== 'proposed'));
</script>

<svelte:head><title>Change orders · Bussey Client Portal</title></svelte:head>

<h1>Change orders</h1>
<p class="muted">Amendments to your engagement. Review pending change orders to approve or reject; past ones are kept for your records.</p>

{#if !loaded}
  <p class="muted">Loading…</p>
{:else}
  {#if pending.length === 0 && past.length === 0}
    <div class="surface" style="margin-top: var(--space-4);">
      <p class="muted">No change orders yet. If you'd like to request a change, your Bussey contact will scope and propose one for you to review here.</p>
    </div>
  {:else}
    {#if pending.length > 0}
      <h2 style="margin-top: var(--space-5);">Pending your review</h2>
      <div class="list">
        {#each pending as co (co.id)}
          <a class="card surface" href={`${base}/change-orders/${co.id}`}>
            <div class="card-head">
              <strong>{co.name}</strong>
              <span class="muted small">Proposed {co.proposed_at ? new Date(co.proposed_at).toLocaleDateString() : ''}</span>
            </div>
            <div class="card-deltas">
              <span>Setup <strong>{fmt(co.setup_delta)}</strong></span>
              <span>Monthly <strong>{fmt(co.monthly_delta)} / mo</strong></span>
            </div>
            <span class="link">Review →</span>
          </a>
        {/each}
      </div>
    {/if}

    {#if past.length > 0}
      <h2 style="margin-top: var(--space-5);">Past</h2>
      <div class="list">
        {#each past as co (co.id)}
          <a class="card surface" href={`${base}/change-orders/${co.id}`}>
            <div class="card-head">
              <strong>{co.name}</strong>
              <span class="muted small">{co.status}</span>
            </div>
            <div class="card-deltas">
              <span>Setup <strong>{fmt(co.setup_delta)}</strong></span>
              <span>Monthly <strong>{fmt(co.monthly_delta)} / mo</strong></span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
{/if}

<style>
  .list { display: flex; flex-direction: column; gap: 0.6rem; margin-top: var(--space-3); }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: inherit;
    text-decoration: none;
  }
  .card:hover { border-color: var(--accent); }
  .card-head { display: flex; justify-content: space-between; }
  .card-deltas { display: flex; gap: var(--space-4); font-size: 0.92rem; font-variant-numeric: tabular-nums; }
  .link { color: var(--accent); font-size: 0.85rem; }
</style>

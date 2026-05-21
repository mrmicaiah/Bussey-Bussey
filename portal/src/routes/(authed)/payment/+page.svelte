<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  type Summary = {
    subscription: {
      id: string;
      stripe_subscription_id: string;
      status: string;
      monthly_amount: number;
      current_period_end: string | null;
    } | null;
    payment_method: {
      status: string;
      last_4: string | null;
      brand: string | null;
    } | null;
  };

  type Invoice = {
    id: string;
    stripe_invoice_id: string;
    kind: string;
    amount: number;
    status: string;
    paid_at: string | null;
    created_at: string;
  };

  let summary = $state<Summary | null>(null);
  let invoices = $state<Invoice[]>([]);
  let loaded = $state(false);
  let portalSessionBusy = $state(false);
  let portalSessionError = $state<string | null>(null);

  function fmtCurrency(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }
  function fmtDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  }
  function kindLabel(k: string): string {
    return k === 'setup'
      ? 'Setup'
      : k === 'change_order_setup'
        ? 'Change order setup'
        : k === 'other'
          ? 'Monthly'
          : k;
  }

  async function openPortalSession() {
    portalSessionBusy = true;
    portalSessionError = null;
    try {
      const res = await api.post<{ url: string; dev_placeholder: boolean }>(
        '/api/portal/payment/portal-session',
        {},
      );
      window.location.href = res.url;
    } catch (e) {
      portalSessionError =
        e instanceof ApiError
          ? `Couldn't open the billing portal (${e.errorCode ?? e.status}).`
          : 'Network error.';
    } finally {
      portalSessionBusy = false;
    }
  }

  onMount(async () => {
    try {
      const [sm, inv] = await Promise.all([
        api.get<Summary>('/api/portal/payment/summary'),
        api.get<{ invoices: Invoice[] }>('/api/portal/payment/invoices'),
      ]);
      summary = sm;
      invoices = inv.invoices;
    } catch {
      // Leave empty.
    } finally {
      loaded = true;
    }
  });
</script>

<svelte:head><title>Payment & Billing · Bussey Client Portal</title></svelte:head>

<h1>Payment & Billing</h1>
<p class="muted">Your subscription, card on file, and invoice history.</p>

{#if !loaded}
  <p class="muted">Loading…</p>
{:else}
  <div class="grid">
    <div class="surface">
      <h2>Subscription</h2>
      {#if summary?.subscription}
        <div class="kv"><span class="muted">Monthly</span><span>{fmtCurrency(summary.subscription.monthly_amount)} / mo</span></div>
        <div class="kv"><span class="muted">Status</span><span>{summary.subscription.status}</span></div>
        <div class="kv"><span class="muted">Next bill</span><span>{fmtDate(summary.subscription.current_period_end)}</span></div>
      {:else}
        <p class="muted">No active subscription on file.</p>
      {/if}
    </div>

    <div class="surface">
      <h2>Payment method</h2>
      {#if summary?.payment_method}
        <p>
          {summary.payment_method.brand && summary.payment_method.last_4
            ? `${summary.payment_method.brand} ending in ${summary.payment_method.last_4}`
            : 'Card on file'}
        </p>
        <Button variant="secondary" onclick={openPortalSession} disabled={portalSessionBusy}>
          {portalSessionBusy ? 'Opening…' : 'Update payment method'}
        </Button>
        {#if portalSessionError}<p class="error" style="margin-top: var(--space-3);">{portalSessionError}</p>{/if}
      {:else}
        <p class="muted">No payment method on file yet.</p>
      {/if}
    </div>
  </div>

  <div class="surface" style="margin-top: var(--space-4);">
    <h2>Invoices</h2>
    {#if invoices.length === 0}
      <p class="muted">No invoices yet.</p>
    {:else}
      <table>
        <thead>
          <tr><th>Date</th><th>Kind</th><th style="text-align: right;">Amount</th><th>Status</th></tr>
        </thead>
        <tbody>
          {#each invoices as inv (inv.id)}
            <tr>
              <td>{fmtDate(inv.created_at)}</td>
              <td>{kindLabel(inv.kind)}</td>
              <td style="text-align: right; font-variant-numeric: tabular-nums;">{fmtCurrency(inv.amount)}</td>
              <td>
                <span class="status status-{inv.status}">{inv.status}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}

<style>
  h1 { margin-bottom: var(--space-2); }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .kv:last-of-type { border-bottom: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--border); font-size: 0.92rem; }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .status { padding: 2px 8px; border-radius: 999px; font-size: 0.78rem; background: #ececea; color: var(--muted); text-transform: capitalize; }
  .status-paid { background: #d8e8d8; color: #146c43; }
  .status-failed { background: #f1d3d1; color: #b3261e; }
  .status-open, .status-uncollectible { background: #fde7c4; color: #b15c00; }
</style>

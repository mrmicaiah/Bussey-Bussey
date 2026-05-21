<script lang="ts">
  import Button from '../Button.svelte';
  import { api, ApiError } from '$lib/api';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  let {
    clientCompanyName,
    primaryContactName,
    setupTotal,
    monthlyTotal,
    monthlyStartsOn,
    contractBody,
    opportunityName,
  }: {
    clientCompanyName: string;
    primaryContactName: string | null;
    setupTotal: number;
    monthlyTotal: number;
    monthlyStartsOn: string;
    contractBody: string | null;
    opportunityName: string;
  } = $props();

  let submitting = $state(false);
  let error = $state<string | null>(null);

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

  async function enterPortal() {
    submitting = true;
    error = null;
    try {
      const res = await api.post<{ ok: boolean; redirect?: string }>(
        '/api/portal/walkthrough/complete',
        {},
      );
      const target = res.redirect ?? `${base}/`;
      // Server may return `/portal/`; let the SvelteKit router handle it.
      goto(target.startsWith('/portal') ? target : `${base}/`, { replaceState: true });
    } catch (e) {
      error =
        e instanceof ApiError
          ? `Couldn't finish (${e.errorCode ?? e.status}).`
          : 'Network error — try again.';
      submitting = false;
    }
  }

  function downloadContract() {
    if (!contractBody) return;
    // Markdown for now; PDF generation is deferred (see notes/deferred-cleanup.md).
    const blob = new Blob([contractBody], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = clientCompanyName.replace(/[^\w-]+/g, '_');
    a.href = url;
    a.download = `${safeName}-contract.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="surface done">
  <h1>You're all set, {clientCompanyName}.</h1>
  <p class="lede">Welcome to Bussey and Bussey.</p>

  <ul class="next">
    <li>Your project officially kicks off shortly. We'll be in touch within 24 hours with concrete next steps.</li>
    <li>Your portal is unlocked — return any time to view documents, payment history, project status, or request changes.</li>
    <li>A receipt for your setup fee was issued by our payment processor; your first monthly invoice will land on the billing date above.</li>
  </ul>

  <div class="summary">
    <div class="row-2">
      <span class="label">Setup fee</span>
      <span class="amount">{fmt(setupTotal)} — paid today</span>
    </div>
    <div class="row-2">
      <span class="label">Monthly subscription</span>
      <span class="amount">{fmt(monthlyTotal)} / mo</span>
    </div>
    <div class="row-2 sub">
      <span class="label">First monthly charge</span>
      <span class="amount">{fmtDate(monthlyStartsOn)}</span>
    </div>
    <div class="row-2 sub">
      <span class="label">Opportunity</span>
      <span class="amount">{opportunityName}</span>
    </div>
  </div>

  {#if error}<div class="error">{error}</div>{/if}

  <div class="cta">
    <Button onclick={enterPortal} disabled={submitting}>
      {submitting ? 'Wrapping up…' : 'Enter portal'}
    </Button>
    {#if contractBody}
      <Button variant="secondary" onclick={downloadContract}>
        Download signed contract
      </Button>
    {/if}
  </div>

  {#if primaryContactName}
    <p class="muted small signoff">Talk soon, {primaryContactName}.</p>
  {/if}
</div>

<style>
  .done { display: flex; flex-direction: column; gap: var(--space-4); }
  .lede { font-size: 1.05rem; margin: 0; }
  .next {
    margin: 0;
    padding-left: 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    line-height: 1.5;
  }
  .summary {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .row-2 { display: flex; justify-content: space-between; align-items: baseline; }
  .row-2.sub { padding-top: 0.45rem; border-top: 1px dashed var(--border); }
  .row-2 .label { color: var(--muted); }
  .row-2 .amount { font-weight: 600; font-variant-numeric: tabular-nums; }
  .cta { display: flex; gap: var(--space-3); flex-wrap: wrap; }
  .signoff { margin: 0; }
</style>

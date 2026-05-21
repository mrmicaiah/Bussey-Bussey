<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import type { PortalChangeOrderDetail } from '$lib/types';

  const coId = $derived(page.params['co_id']!);

  let detail = $state<PortalChangeOrderDetail | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let typedName = $state('');
  let agreementChecked = $state(false);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  let rejectModalOpen = $state(false);
  let rejectReason = $state('');

  async function load() {
    loading = true;
    loadError = null;
    try {
      detail = await api.get<PortalChangeOrderDetail>(`/api/portal/change-orders/${coId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        loadError = "We couldn't find that change order — it may have been withdrawn.";
      } else {
        loadError = e instanceof ApiError ? `Load failed (${e.errorCode ?? e.status}).` : 'Network error.';
      }
    } finally {
      loading = false;
    }
  }

  function fmt(n: number): string {
    const sign = n < 0 ? '-' : n > 0 ? '+' : '';
    return `${sign}${Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}`;
  }

  const canApprove = $derived(
    detail?.change_order.status === 'proposed' &&
      agreementChecked &&
      typedName.trim().length > 0,
  );

  async function approve() {
    if (!detail) return;
    submitting = true;
    submitError = null;
    try {
      await api.post(`/api/portal/change-orders/${coId}/approve`, {
        typed_name: typedName.trim(),
      });
      successMessage = 'Approved. Your subscription will reflect the change at the next billing cycle.';
      await load();
    } catch (e) {
      submitError = renderApiError(e, 'approve');
    } finally {
      submitting = false;
    }
  }

  async function reject() {
    if (!detail) return;
    submitting = true;
    submitError = null;
    try {
      await api.post(`/api/portal/change-orders/${coId}/reject`, {
        reason: rejectReason.trim() || null,
      });
      rejectModalOpen = false;
      successMessage = 'Marked as rejected. Your Bussey contact will follow up.';
      await load();
    } catch (e) {
      submitError = renderApiError(e, 'reject');
    } finally {
      submitting = false;
    }
  }

  function renderApiError(e: unknown, action: 'approve' | 'reject'): string {
    if (e instanceof ApiError) {
      if (e.errorCode === 'stripe_error') {
        return 'Payment processor rejected the charge. Please check your card and try again.';
      }
      if (e.errorCode === 'change_order_not_approvable' || e.errorCode === 'change_order_not_rejectable') {
        return 'This change order can no longer be acted on.';
      }
      return `Couldn't ${action} (${e.errorCode ?? e.status}).`;
    }
    return 'Network error — try again.';
  }

  onMount(load);
</script>

<svelte:head><title>Change order · Bussey Client Portal</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/change-orders`} class="muted small">← Change orders</a>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if loadError}
  <div class="error">{loadError}</div>
{:else if detail}
  {@const co = detail.change_order}
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <h1>{co.name}</h1>
      <p class="muted small">
        For <strong>{co.opportunity_name}</strong>
        · Status: {co.status}
        {#if co.proposed_at}· Proposed {new Date(co.proposed_at).toLocaleString()}{/if}
        {#if co.approved_at}· Approved {new Date(co.approved_at).toLocaleString()}{/if}
      </p>
    </div>
  </div>

  {#if successMessage}
    <div class="success" style="margin-top: var(--space-3);">{successMessage}</div>
  {/if}
  {#if submitError}
    <div class="error" style="margin-top: var(--space-3);">{submitError}</div>
  {/if}

  {#if co.reason}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2>Why we're proposing this</h2>
      <p style="white-space: pre-wrap; margin: 0;">{co.reason}</p>
    </div>
  {/if}

  <div class="surface" style="margin-top: var(--space-4);">
    <h2>What's changing</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Action</th>
          <th style="text-align: right;">Quantity</th>
          <th style="text-align: right;">Delta</th>
        </tr>
      </thead>
      <tbody>
        {#each detail.line_items as line (line.id)}
          <tr>
            <td>{line.description_override ?? line.component_code}</td>
            <td>{line.action === 'add' ? 'Added' : 'Removed'}</td>
            <td style="text-align: right;">{line.quantity}</td>
            <td style="text-align: right; font-variant-numeric: tabular-nums;">{fmt(line.line_total_delta)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="surface" style="margin-top: var(--space-4);">
    <h2>Net impact</h2>
    <div class="totals">
      <div class="row-2"><span class="muted">Setup adjustment (charged today on approve)</span><span class="amt">{fmt(co.setup_delta)}</span></div>
      <div class="row-2"><span class="muted">Monthly adjustment (starts at next billing cycle)</span><span class="amt">{fmt(co.monthly_delta)} / mo</span></div>
    </div>
  </div>

  {#if co.status === 'proposed'}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2>Approve</h2>
      <p class="muted">
        By signing below you authorize the setup adjustment to be charged now
        and the monthly change to take effect at your next billing cycle.
      </p>
      <Field label="Type your full legal name to sign">
        <input type="text" autocomplete="name" bind:value={typedName} />
      </Field>
      <label class="checkbox" style="margin-top: var(--space-3);">
        <input type="checkbox" bind:checked={agreementChecked} />
        <span>I have read and agree to this amendment.</span>
      </label>
      <div class="cta">
        <Button onclick={approve} disabled={!canApprove || submitting}>
          {submitting ? 'Submitting…' : 'Approve and sign'}
        </Button>
        <Button variant="secondary" onclick={() => (rejectModalOpen = true)} disabled={submitting}>
          Reject
        </Button>
      </div>
    </div>
  {:else if co.status === 'approved'}
    <div class="surface success" style="margin-top: var(--space-4);">
      Approved on {new Date(co.approved_at ?? '').toLocaleString()}.
    </div>
  {:else if co.status === 'rejected'}
    <div class="surface" style="margin-top: var(--space-4); border-color: #f1c0bd;">
      Marked as rejected.
    </div>
  {:else if co.status === 'withdrawn'}
    <div class="surface" style="margin-top: var(--space-4);">
      Your Bussey contact withdrew this change order. No further action needed.
    </div>
  {/if}
{/if}

{#if rejectModalOpen}
  <div class="backdrop" role="presentation" onclick={() => (rejectModalOpen = false)}></div>
  <div class="modal surface" role="dialog" aria-modal="true" aria-labelledby="reject-title">
    <h2 id="reject-title">Reject this change order</h2>
    <p class="muted small">
      Add a note (optional) — your Bussey contact will see it and follow up.
    </p>
    <Field label="Reason (optional)">
      <textarea bind:value={rejectReason} placeholder="Anything you want them to know?"></textarea>
    </Field>
    <div class="cta" style="justify-content: flex-end;">
      <Button variant="secondary" onclick={() => (rejectModalOpen = false)} disabled={submitting}>
        Cancel
      </Button>
      <Button variant="danger" onclick={reject} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Reject change order'}
      </Button>
    </div>
  </div>
{/if}

<style>
  .totals { display: flex; flex-direction: column; gap: 0.4rem; }
  .row-2 { display: flex; justify-content: space-between; align-items: baseline; }
  .amt { font-weight: 600; font-variant-numeric: tabular-nums; }
  .checkbox { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.95rem; }
  .checkbox input { margin-top: 0.2rem; }
  .cta { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.42);
    z-index: 50;
  }
  .modal {
    position: fixed;
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, 92vw);
    z-index: 51;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  }
</style>

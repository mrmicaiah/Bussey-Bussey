<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import type {
    ChangeOrder,
    ChangeOrderLineItem,
    ProposalDetail,
    PricingComponent,
  } from '$lib/types';

  const clientId = $derived(page.params['id']!);
  const oppId = $derived(page.params['opp_id']!);
  const coId = $derived(page.params['co_id']!);

  let co = $state<ChangeOrder | null>(null);
  let lineItems = $state<ChangeOrderLineItem[]>([]);
  let snapshot = $state<Record<string, PricingComponent>>({});
  let proposalId = $state<string | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // Editor buffers
  let name = $state('');
  let reason = $state('');
  let pickedComponent = $state<string>('');
  let pickedAction = $state<'add' | 'remove'>('add');
  let pickedQuantity = $state<number>(1);

  async function load() {
    loading = true;
    error = null;
    try {
      const detail = await api.get<{
        change_order: ChangeOrder;
        line_items: ChangeOrderLineItem[];
      }>(`/api/admin/change-orders/${coId}`);
      co = detail.change_order;
      lineItems = detail.line_items;
      name = co.name;
      reason = co.reason ?? '';

      // Fetch the proposal to get the locked snapshot.
      proposalId = co.proposal_id;
      const proposal = await api.get<ProposalDetail>(`/api/admin/proposals/${proposalId}`);
      snapshot = proposal.snapshot.components;
      // Pre-select the first component for convenience.
      const codes = Object.keys(snapshot);
      if (codes.length > 0 && !pickedComponent) pickedComponent = codes[0]!;
    } catch (e) {
      error = e instanceof ApiError ? `Load failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function fmtCurrency(n: number): string {
    const sign = n < 0 ? '-' : n > 0 ? '+' : '';
    return `${sign}${Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}`;
  }

  const componentList = $derived(Object.values(snapshot).sort((a, b) => a.name.localeCompare(b.name)));
  const isDraft = $derived(co?.status === 'draft');
  const isProposed = $derived(co?.status === 'proposed');
  const isTerminal = $derived(co !== null && co.status !== 'draft' && co.status !== 'proposed');

  async function saveMeta() {
    if (!co || !isDraft) return;
    saving = true;
    error = null;
    try {
      const res = await api.put<{ change_order: ChangeOrder }>(
        `/api/admin/change-orders/${coId}`,
        { name, reason: reason || null },
      );
      co = res.change_order;
    } catch (e) {
      error = e instanceof ApiError ? `Save failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function addLineItem() {
    if (!co || !isDraft || !pickedComponent || pickedQuantity <= 0) return;
    saving = true;
    error = null;
    try {
      const res = await api.post<{
        change_order: ChangeOrder;
        line_items: ChangeOrderLineItem[];
      }>(`/api/admin/change-orders/${coId}/line-items`, {
        component_code: pickedComponent,
        action: pickedAction,
        quantity: pickedQuantity,
      });
      co = res.change_order;
      lineItems = res.line_items;
    } catch (e) {
      error = e instanceof ApiError ? `Add line item failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function removeLineItem(lineId: string) {
    if (!co || !isDraft) return;
    saving = true;
    error = null;
    try {
      const res = await api.delete<{
        change_order: ChangeOrder;
        line_items: ChangeOrderLineItem[];
      }>(`/api/admin/change-orders/${coId}/line-items/${lineId}`);
      co = res.change_order;
      lineItems = res.line_items;
    } catch (e) {
      error = e instanceof ApiError ? `Remove failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function propose() {
    if (!co || !isDraft) return;
    if (lineItems.length === 0) {
      error = 'Add at least one line item before proposing.';
      return;
    }
    if (!confirm('Propose this change order to the client? They will be notified by email.')) return;
    saving = true;
    error = null;
    try {
      const res = await api.post<{ change_order: ChangeOrder }>(
        `/api/admin/change-orders/${coId}/propose`,
        {},
      );
      co = res.change_order;
    } catch (e) {
      error = e instanceof ApiError ? `Propose failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function withdraw() {
    if (!co || !isProposed) return;
    if (!confirm('Withdraw this proposed change order? The client will no longer see it.')) return;
    saving = true;
    error = null;
    try {
      const res = await api.post<{ change_order: ChangeOrder }>(
        `/api/admin/change-orders/${coId}/withdraw`,
        {},
      );
      co = res.change_order;
    } catch (e) {
      error = e instanceof ApiError ? `Withdraw failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function deleteDraft() {
    if (!co || !isDraft) return;
    if (!confirm('Delete this draft change order? This cannot be undone.')) return;
    saving = true;
    error = null;
    try {
      await api.delete(`/api/admin/change-orders/${coId}`);
      goto(`${base}/clients/${clientId}/opportunities/${oppId}`, { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? `Delete failed (${e.errorCode ?? e.status}).` : 'Network error.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Change order · Bussey Admin</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/clients/${clientId}/opportunities/${oppId}`} class="muted small">← Back to opportunity</a>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error && !co}
  <div class="error">{error}</div>
{:else if !co}
  <div class="error">Change order not found.</div>
{:else}
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <h1>{co.name}</h1>
      <p class="muted small">
        Status: <span class="badge badge-{co.status}">{co.status}</span>
        · Created {new Date(co.created_at).toLocaleString()}
        {#if co.proposed_at}
          · Proposed {new Date(co.proposed_at).toLocaleString()}
        {/if}
        {#if co.approved_at}
          · Approved {new Date(co.approved_at).toLocaleString()}
        {/if}
      </p>
    </div>
  </div>

  {#if error}<div class="error" style="margin-top: var(--space-3);">{error}</div>{/if}

  <div class="grid">
    <!-- Meta editor -->
    <div class="surface">
      <h2>Details</h2>
      <Field label="Name">
        <input bind:value={name} disabled={!isDraft} />
      </Field>
      <Field label="Reason / context for the client">
        <textarea bind:value={reason} disabled={!isDraft} placeholder="Why are you proposing this change?"></textarea>
      </Field>
      {#if isDraft}
        <Button onclick={saveMeta} disabled={saving}>Save details</Button>
      {:else}
        <p class="muted small">Locked after proposing.</p>
      {/if}
    </div>

    <!-- Totals -->
    <div class="surface">
      <h2>Net impact</h2>
      <div class="totals">
        <div class="row-2"><span class="muted">Setup adjustment</span><span class="amt">{fmtCurrency(co.setup_delta)}</span></div>
        <div class="row-2"><span class="muted">Monthly adjustment</span><span class="amt">{fmtCurrency(co.monthly_delta)} / mo</span></div>
      </div>
      <p class="muted small" style="margin-top: var(--space-3);">
        The monthly adjustment takes effect at the next billing cycle. The setup
        adjustment is charged immediately when the client approves.
      </p>
    </div>
  </div>

  <!-- Line items -->
  <div class="surface" style="margin-top: var(--space-4);">
    <h2>Line items</h2>
    {#if isDraft}
      <div class="adder">
        <Field label="Component">
          <select bind:value={pickedComponent}>
            {#each componentList as c}
              <option value={c.code}>
                {c.name} ({c.unit_type}) — ${c.unit_price.toLocaleString()}
              </option>
            {/each}
          </select>
        </Field>
        <Field label="Action">
          <select bind:value={pickedAction}>
            <option value="add">Add (charge client)</option>
            <option value="remove">Remove (credit client)</option>
          </select>
        </Field>
        <Field label="Quantity">
          <input type="number" min="1" bind:value={pickedQuantity} />
        </Field>
        <Button onclick={addLineItem} disabled={saving || !pickedComponent || pickedQuantity <= 0}>
          Add line item
        </Button>
      </div>
    {/if}

    {#if lineItems.length === 0}
      <p class="muted small">No line items yet.</p>
    {:else}
      <table style="margin-top: var(--space-3);">
        <thead>
          <tr>
            <th>Action</th>
            <th>Component</th>
            <th style="text-align: right;">Qty</th>
            <th style="text-align: right;">Unit (snapshot)</th>
            <th style="text-align: right;">Delta</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each lineItems as line (line.id)}
            {@const comp = snapshot[line.component_code]}
            <tr>
              <td>{line.action}</td>
              <td>{comp ? comp.name : line.component_code}</td>
              <td style="text-align: right;">{line.quantity}</td>
              <td style="text-align: right;">${line.unit_price_from_snapshot.toLocaleString()}</td>
              <td style="text-align: right; font-variant-numeric: tabular-nums;">{fmtCurrency(line.line_total_delta)}</td>
              <td style="text-align: right;">
                {#if isDraft}
                  <button class="link" onclick={() => removeLineItem(line.id)} disabled={saving}>Remove</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <!-- Actions -->
  <div class="surface" style="margin-top: var(--space-4);">
    <div class="row" style="justify-content: space-between;">
      <div>
        {#if isDraft}
          <Button variant="danger" onclick={deleteDraft} disabled={saving}>Delete draft</Button>
        {:else if isProposed}
          <Button variant="danger" onclick={withdraw} disabled={saving}>Withdraw</Button>
        {/if}
      </div>
      <div>
        {#if isDraft}
          <Button onclick={propose} disabled={saving || lineItems.length === 0}>
            Propose to client
          </Button>
        {:else if isTerminal}
          <span class="muted small">Terminal status: no further actions.</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  .totals { display: flex; flex-direction: column; gap: 0.4rem; font-size: 1rem; }
  .row-2 { display: flex; justify-content: space-between; }
  .amt { font-weight: 600; font-variant-numeric: tabular-nums; }
  .adder {
    display: grid;
    grid-template-columns: 2fr 1fr 0.6fr auto;
    gap: var(--space-3);
    align-items: end;
    margin-bottom: var(--space-3);
  }
  .link {
    background: transparent;
    border: 0;
    color: var(--danger);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }
  .link:hover { text-decoration: underline; }
</style>

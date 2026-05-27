<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import LogCallModal from '$lib/components/LogCallModal.svelte';

  type Card = {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    industry: string | null;
    call_date: string;
    status: string;
  };

  let cards = $state<Card[]>([]);
  let selected = $state<Set<string>>(new Set());
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Filters
  let status = $state('');
  let from = $state('');
  let to = $state('');
  let industry = $state('');
  let q = $state('');

  // Bulk reschedule
  let bulkDate = $state('');
  let bulkBusy = $state(false);

  // Log modal
  let logOpenFor = $state<Card | null>(null);

  async function load() {
    loading = true;
    error = null;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (industry) params.set('industry', industry);
    if (q) params.set('q', q);
    try {
      const res = await api.get<{ cards: Card[] }>(`/api/admin/calling-list?${params.toString()}`);
      cards = res.cards;
      // Drop selected ids that are no longer in the result set.
      const visible = new Set(cards.map((c) => c.id));
      const next = new Set<string>();
      for (const id of selected) if (visible.has(id)) next.add(id);
      selected = next;
    } catch (e) {
      error = e instanceof ApiError ? `Load failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  async function bulkReschedule() {
    if (!bulkDate || selected.size === 0) return;
    if (!confirm(`Reschedule ${selected.size} card(s) to ${bulkDate}?`)) return;
    bulkBusy = true;
    error = null;
    try {
      const res = await api.post<{ updated: number }>('/api/admin/calling-list/bulk-reschedule', {
        ids: [...selected],
        call_date: bulkDate,
      });
      selected = new Set();
      bulkDate = '';
      await load();
      // small success ping
      alert(`Rescheduled ${res.updated} card(s).`);
    } catch (e) {
      error = e instanceof ApiError ? `Bulk reschedule failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      bulkBusy = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Calling list · Studio44</title></svelte:head>

<div class="row" style="justify-content: space-between; align-items: baseline;">
  <h1>Calling list</h1>
  <div class="row" style="gap: var(--space-3);">
    <a href={`${base}/calling-list/today`} class="muted small">Today only</a>
    <a href={`${base}/calling-list/import`}><Button variant="secondary">Import CSV</Button></a>
  </div>
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <h2>Filters</h2>
  <div class="filter-grid">
    <Field label="Status">
      <select bind:value={status}>
        <option value="">Any</option>
        <option value="pending">Pending</option>
        <option value="called">Called</option>
        <option value="no_answer">No answer</option>
        <option value="followup">Follow-up</option>
        <option value="completed">Completed</option>
        <option value="disqualified">Disqualified</option>
        <option value="converted_to_lead">Converted to lead</option>
      </select>
    </Field>
    <Field label="From"><input type="date" bind:value={from} /></Field>
    <Field label="To"><input type="date" bind:value={to} /></Field>
    <Field label="Industry"><input bind:value={industry} placeholder="e.g. Home Health" /></Field>
    <Field label="Search"><input bind:value={q} placeholder="Company, contact, email" /></Field>
  </div>
  <div class="row" style="margin-top: var(--space-3); gap: var(--space-3);">
    <Button onclick={load} disabled={loading}>Apply filters</Button>
    <Button variant="secondary" onclick={() => { status=''; from=''; to=''; industry=''; q=''; load(); }} disabled={loading}>Clear</Button>
  </div>
</div>

{#if selected.size > 0}
  <div class="surface" style="margin-top: var(--space-3);">
    <div class="row" style="justify-content: space-between;">
      <strong>{selected.size} selected</strong>
      <div class="row" style="gap: var(--space-3);">
        <input type="date" bind:value={bulkDate} placeholder="YYYY-MM-DD" />
        <Button onclick={bulkReschedule} disabled={bulkBusy || !bulkDate}>
          {bulkBusy ? 'Saving…' : 'Bulk reschedule'}
        </Button>
        <Button variant="secondary" onclick={() => (selected = new Set())}>Clear selection</Button>
      </div>
    </div>
  </div>
{/if}

{#if error}<div class="error" style="margin-top: var(--space-3);">{error}</div>{/if}

<div class="surface" style="margin-top: var(--space-3);">
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if cards.length === 0}
    <p class="muted">No cards match these filters.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th style="width: 2rem;"></th>
          <th>Company</th>
          <th>Contact</th>
          <th>Industry</th>
          <th>Call date</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each cards as c (c.id)}
          <tr>
            <td>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onchange={() => toggleSelect(c.id)}
              />
            </td>
            <td>{c.company_name}</td>
            <td class="muted small">
              {c.contact_name ?? '—'}
              {#if c.contact_email}<br /><span>{c.contact_email}</span>{/if}
              {#if c.contact_phone}<br /><span>{c.contact_phone}</span>{/if}
            </td>
            <td class="muted small">{c.industry ?? '—'}</td>
            <td>{c.call_date}</td>
            <td><span class="badge badge-{c.status === 'converted_to_lead' ? 'approved' : c.status === 'disqualified' ? 'rejected' : c.status === 'pending' ? 'draft' : 'sent'}">{c.status.replace(/_/g, ' ')}</span></td>
            <td>
              {#if c.status === 'pending' || c.status === 'no_answer' || c.status === 'followup'}
                <button class="action-btn" onclick={() => (logOpenFor = c)}>Log call</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<LogCallModal
  open={logOpenFor !== null}
  cardId={logOpenFor?.id ?? ''}
  cardLabel={logOpenFor?.company_name ?? ''}
  onclose={() => (logOpenFor = null)}
  oncomplete={async () => { logOpenFor = null; await load(); }}
/>

<style>
  h1 { margin-bottom: 0; }
  .filter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--border); font-size: 0.92rem; }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .action-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.25rem 0.55rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .action-btn:hover { border-color: var(--accent); }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import LogCallModal from '$lib/components/LogCallModal.svelte';

  type Card = {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    industry: string | null;
    source: string | null;
    call_date: string;
    status: string;
    notes: string | null;
  };

  let today = $state('');
  let cards = $state<Card[]>([]);
  let progress = $state<{ remaining: number; completed: number; total: number }>({ remaining: 0, completed: 0, total: 0 });
  let loading = $state(true);
  let error = $state<string | null>(null);

  let logOpenFor = $state<Card | null>(null);
  let rescheduleOpenFor = $state<Card | null>(null);
  let rescheduleDate = $state('');
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.get<{ today: string; cards: Card[]; progress: typeof progress }>(
        '/api/admin/calling-list/today',
      );
      today = res.today;
      cards = res.cards;
      progress = res.progress;
    } catch (e) {
      error = e instanceof ApiError ? `Load failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }

  async function disqualify(card: Card) {
    if (!confirm(`Disqualify ${card.company_name}?`)) return;
    actionBusy = true;
    actionError = null;
    try {
      await api.post(`/api/admin/calling-list/${card.id}/disqualify`, {});
      await load();
    } catch (e) {
      actionError = e instanceof ApiError ? `Disqualify failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      actionBusy = false;
    }
  }

  async function submitReschedule() {
    if (!rescheduleOpenFor || !rescheduleDate) return;
    actionBusy = true;
    actionError = null;
    try {
      await api.post(`/api/admin/calling-list/${rescheduleOpenFor.id}/reschedule`, {
        call_date: rescheduleDate,
      });
      rescheduleOpenFor = null;
      rescheduleDate = '';
      await load();
    } catch (e) {
      actionError = e instanceof ApiError ? `Reschedule failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      actionBusy = false;
    }
  }

  onMount(load);
</script>

<svelte:head><title>Calling list · Today · Studio44</title></svelte:head>

<div class="row" style="justify-content: space-between; align-items: baseline;">
  <div>
    <h1>Today's calls</h1>
    <p class="muted small">{today}</p>
  </div>
  <div class="row" style="gap: var(--space-3);">
    <a href={`${base}/calling-list`} class="muted small">All cards</a>
    <a href={`${base}/calling-list/import`}><Button variant="secondary">Import CSV</Button></a>
  </div>
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <div class="row" style="justify-content: space-between;">
    <strong>{progress.remaining} of {progress.total || progress.remaining} calls remaining</strong>
    <span class="muted small">{progress.completed} completed today</span>
  </div>
</div>

{#if error}<div class="error" style="margin-top: var(--space-3);">{error}</div>{/if}
{#if actionError}<div class="error" style="margin-top: var(--space-3);">{actionError}</div>{/if}

{#if loading}
  <p class="muted" style="margin-top: var(--space-4);">Loading…</p>
{:else if cards.length === 0}
  <div class="surface" style="margin-top: var(--space-4);">
    <p class="muted">No calls scheduled for today. Take the win.</p>
  </div>
{:else}
  <div class="cards">
    {#each cards as c (c.id)}
      <div class="surface card">
        <div class="card-head">
          <div>
            <strong>{c.company_name}</strong>
            {#if c.industry}<span class="muted small"> · {c.industry}</span>{/if}
          </div>
          {#if c.source}<span class="badge badge-draft">{c.source}</span>{/if}
        </div>
        {#if c.contact_name}<div class="muted small">{c.contact_name}</div>{/if}
        <div class="contact">
          {#if c.contact_phone}
            <a href={`tel:${c.contact_phone}`} class="action-link">📞 {c.contact_phone}</a>
          {/if}
          {#if c.contact_email}
            <a href={`mailto:${c.contact_email}`} class="action-link">✉ {c.contact_email}</a>
          {/if}
        </div>
        {#if c.notes}<p class="notes">{c.notes}</p>{/if}
        <div class="actions">
          <Button onclick={() => (logOpenFor = c)}>Log call</Button>
          <Button variant="secondary" onclick={() => { rescheduleOpenFor = c; rescheduleDate = ''; }}>
            Reschedule
          </Button>
          <Button variant="danger" onclick={() => disqualify(c)} disabled={actionBusy}>
            Disqualify
          </Button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<LogCallModal
  open={logOpenFor !== null}
  cardId={logOpenFor?.id ?? ''}
  cardLabel={logOpenFor?.company_name ?? ''}
  onclose={() => (logOpenFor = null)}
  oncomplete={async (res) => {
    logOpenFor = null;
    if (res.converted_lead_id) {
      // Optional: navigate to the new lead. Just reload for now.
    }
    await load();
  }}
/>

{#if rescheduleOpenFor}
  <div class="backdrop" role="presentation" onclick={() => (rescheduleOpenFor = null)}></div>
  <div class="dialog surface" role="dialog" aria-modal="true">
    <h2>Reschedule {rescheduleOpenFor.company_name}</h2>
    <label class="field-inline">
      New call date
      <input type="date" bind:value={rescheduleDate} required />
    </label>
    <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-3);">
      <Button variant="secondary" onclick={() => (rescheduleOpenFor = null)} disabled={actionBusy}>Cancel</Button>
      <Button onclick={submitReschedule} disabled={actionBusy || !rescheduleDate}>
        {actionBusy ? 'Saving…' : 'Reschedule'}
      </Button>
    </div>
  </div>
{/if}

<style>
  .cards { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-4); }
  .card { display: flex; flex-direction: column; gap: 0.5rem; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; }
  .contact { display: flex; gap: var(--space-3); flex-wrap: wrap; font-size: 0.9rem; }
  .action-link { color: var(--accent); text-decoration: none; }
  .action-link:hover { text-decoration: underline; }
  .notes {
    background: #fafaf8;
    border: 1px solid var(--border);
    padding: 0.45rem 0.7rem;
    margin: 0;
    border-radius: var(--radius);
    font-size: 0.9rem;
    white-space: pre-wrap;
  }
  .actions { display: flex; gap: var(--space-3); flex-wrap: wrap; }
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.42);
    z-index: 50;
  }
  .dialog {
    position: fixed;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(420px, 92vw);
    z-index: 51;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .field-inline {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .field-inline input { padding: 0.45rem 0.6rem; border: 1px solid var(--border); border-radius: var(--radius); font: inherit; }
</style>

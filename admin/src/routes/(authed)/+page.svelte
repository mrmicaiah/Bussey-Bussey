<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api } from '$lib/api';

  let { data }: { data: { user: import('$lib/types').AdminUser } } = $props();

  type WalkthroughState = 'new' | 'password_set' | 'contract_signed' | 'payment_set' | 'complete';
  type PendingActivation = {
    opportunity_id: string;
    opportunity_name: string;
    accepted_at: string | null;
    client_id: string;
    client_company_name: string;
    portal_email: string;
    walkthrough_state: WalkthroughState;
  };

  let pending = $state<PendingActivation[]>([]);
  let loaded = $state(false);

  const WALKTHROUGH_LABELS: Record<WalkthroughState, string> = {
    new: 'Credentials issued',
    password_set: 'Password set',
    contract_signed: 'Contract signed',
    payment_set: 'Payment added',
    complete: 'Complete',
  };

  function daysSince(iso: string | null): number | null {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  function alertLevel(days: number | null): 'ok' | 'warn' | 'escalate' {
    if (days === null) return 'ok';
    if (days >= 7) return 'escalate';
    if (days >= 3) return 'warn';
    return 'ok';
  }

  function timeAgoLabel(iso: string | null): string {
    if (!iso) return 'unknown';
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days === 0) {
      const hours = Math.floor(ms / (1000 * 60 * 60));
      if (hours === 0) return 'just now';
      return `${hours}h ago`;
    }
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }

  onMount(async () => {
    try {
      const res = await api.get<{ pending_activations: PendingActivation[] }>(
        '/api/admin/pending-activations',
      );
      pending = res.pending_activations;
    } catch {
      pending = [];
    } finally {
      loaded = true;
    }
  });
</script>

<svelte:head><title>Dashboard · Bussey Admin</title></svelte:head>

<h1>Hi, {data.user.name.split(' ')[0]}.</h1>
<p class="muted">Pick a section to get started.</p>

{#if loaded && pending.length > 0}
  <div class="surface" style="margin-top: var(--space-5);">
    <div class="row" style="justify-content: space-between; align-items: baseline;">
      <h2 style="margin: 0;">Pending activation</h2>
      <span class="muted small">{pending.length} {pending.length === 1 ? 'account' : 'accounts'}</span>
    </div>
    <p class="muted small" style="margin: var(--space-2) 0 var(--space-3);">
      Opportunities accepted but waiting on the client to complete the portal walkthrough.
    </p>
    <ul class="pending-list">
      {#each pending as p (p.opportunity_id)}
        {@const days = daysSince(p.accepted_at)}
        {@const level = alertLevel(days)}
        <li class="pending-item alert-{level}">
          <div class="pending-main">
            <a href={`${base}/clients/${p.client_id}/opportunities/${p.opportunity_id}`}>
              <strong>{p.client_company_name}</strong> — {p.opportunity_name}
            </a>
            <div class="muted small">
              <span class="state-pill">{WALKTHROUGH_LABELS[p.walkthrough_state]}</span>
              · {p.portal_email}
            </div>
          </div>
          <div class="pending-meta">
            <span class="time" title={p.accepted_at ?? ''}>{timeAgoLabel(p.accepted_at)}</span>
            {#if level === 'escalate'}
              <span class="badge-escalate">7+ days</span>
            {:else if level === 'warn'}
              <span class="badge-warn">3+ days</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<div class="grid">
  <a href={`${base}/leads`} class="card surface">
    <h2>Leads</h2>
    <p class="muted">Inbox of incoming prospects. Qualify and convert to clients.</p>
  </a>
  <a href={`${base}/clients`} class="card surface">
    <h2>Clients</h2>
    <p class="muted">Active business relationships. Manage opportunities and projects.</p>
  </a>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-4);
    margin-top: var(--space-6);
  }
  .card {
    display: block;
    color: inherit;
    text-decoration: none;
  }
  .card:hover {
    border-color: var(--accent);
  }
  .card h2 { margin: 0 0 var(--space-2); color: var(--accent); }
  .card p { margin: 0; }

  .pending-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .pending-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: #fafaf8;
  }
  .pending-item.alert-warn { border-left: 4px solid #d28f15; }
  .pending-item.alert-escalate { border-left: 4px solid #b53737; background: #fdf3f3; }
  .pending-main a { text-decoration: none; color: inherit; }
  .pending-main a:hover { color: var(--accent); }
  .state-pill {
    display: inline-block;
    background: #ececeb;
    border-radius: 4px;
    padding: 0.05rem 0.45rem;
    font-size: 0.78rem;
    margin-right: 0.4rem;
  }
  .pending-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .time { font-size: 0.85rem; color: var(--muted); }
  .badge-warn, .badge-escalate {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
  }
  .badge-warn { background: #fff4d9; color: #8a5a00; }
  .badge-escalate { background: #ffd7d7; color: #8a1a1a; }
</style>

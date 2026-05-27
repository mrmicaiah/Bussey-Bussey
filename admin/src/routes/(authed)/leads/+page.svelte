<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Lead, LeadStatus } from '$lib/types';
  import Button from '$lib/components/Button.svelte';

  let leads = $state<Lead[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let statusFilter = $state<LeadStatus | ''>('');

  async function load() {
    loading = true;
    error = null;
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const data = await api.get<{ leads: Lead[] }>(`/api/admin/leads${qs}`);
      leads = data.leads;
    } catch (e) {
      error = e instanceof ApiError ? `Failed to load (${e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function fmtDate(s: string) {
    try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return s; }
  }

  function displayName(l: Lead) {
    return l.name || l.email || l.phone || '(unknown)';
  }
</script>

<svelte:head><title>Leads · Studio44</title></svelte:head>

<div class="row" style="justify-content: space-between; margin-bottom: var(--space-4);">
  <h1>Leads</h1>
  <div class="row" style="gap: var(--space-3);">
    <a href={`${base}/leads/work`}><Button>Work leads</Button></a>
    <a href={`${base}/leads/new`}><Button variant="secondary">New lead</Button></a>
  </div>
</div>

<div class="row" style="margin-bottom: var(--space-4);">
  <label class="row" style="gap: var(--space-2);">
    <span class="small muted">Status:</span>
    <select bind:value={statusFilter} onchange={load}>
      <option value="">All</option>
      <option value="new">New</option>
      <option value="reviewed">Reviewed</option>
      <option value="contacted">Contacted</option>
      <option value="qualified">Qualified</option>
      <option value="disqualified">Disqualified</option>
      <option value="converted">Converted</option>
    </select>
  </label>
  <span class="muted small">{leads.length} {leads.length === 1 ? 'lead' : 'leads'}</span>
</div>

{#if error}<div class="error">{error}</div>{/if}

<div class="surface" style="padding: 0;">
  {#if loading}
    <p class="muted" style="padding: var(--space-4);">Loading…</p>
  {:else if leads.length === 0}
    <p class="muted" style="padding: var(--space-4);">No leads yet. <a href={`${base}/leads/new`}>Create one</a>.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Name / Contact</th>
          <th>Company</th>
          <th>Industry</th>
          <th>Source</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {#each leads as lead (lead.id)}
          <tr style="cursor: pointer;" onclick={() => (window.location.href = `${base}/leads/${lead.id}`)}>
            <td>
              <a href={`${base}/leads/${lead.id}`}>{displayName(lead)}</a>
              {#if lead.email}<div class="muted small">{lead.email}</div>{/if}
            </td>
            <td>{lead.company ?? '—'}</td>
            <td>{lead.industry ?? '—'}</td>
            <td><span class="muted small">{lead.source ?? '—'}</span></td>
            <td><span class="badge badge-{lead.status}">{lead.status}</span></td>
            <td><span class="muted small">{fmtDate(lead.created_at)}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

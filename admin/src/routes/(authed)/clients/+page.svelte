<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Client } from '$lib/types';
  import Button from '$lib/components/Button.svelte';

  let clients = $state<Client[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const { clients: rows } = await api.get<{ clients: Client[] }>('/api/admin/clients');
      clients = rows;
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
</script>

<svelte:head><title>Clients · Bussey Admin</title></svelte:head>

<div class="row" style="justify-content: space-between; margin-bottom: var(--space-4);">
  <h1>Clients</h1>
  <a href={`${base}/clients/new`}><Button>New client</Button></a>
</div>

<p class="muted small">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</p>

{#if error}<div class="error">{error}</div>{/if}

<div class="surface" style="padding: 0; margin-top: var(--space-4);">
  {#if loading}
    <p class="muted" style="padding: var(--space-4);">Loading…</p>
  {:else if clients.length === 0}
    <p class="muted" style="padding: var(--space-4);">No clients yet. <a href={`${base}/clients/new`}>Create one</a>.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Primary contact</th>
          <th>Industry</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {#each clients as c (c.id)}
          <tr style="cursor: pointer;" onclick={() => (window.location.href = `${base}/clients/${c.id}`)}>
            <td><a href={`${base}/clients/${c.id}`}>{c.company_name}</a></td>
            <td>
              {c.primary_contact_name ?? '—'}
              {#if c.primary_contact_email}<div class="muted small">{c.primary_contact_email}</div>{/if}
            </td>
            <td>{c.industry ?? '—'}</td>
            <td><span class="badge badge-{c.status}">{c.status}</span></td>
            <td><span class="muted small">{fmtDate(c.created_at)}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

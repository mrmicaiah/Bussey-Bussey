<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Client, Opportunity } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  type DeletePreview = {
    cascades: Record<string, number>;
    orphans: Record<string, number>;
  };
  let confirmOpen = $state(false);
  let preview = $state<DeletePreview | null>(null);

  const id = $derived(page.params['id']!);

  let client = $state<Client | null>(null);
  let opportunities = $state<Opportunity[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saveMessage = $state<string | null>(null);
  let tab = $state<'overview' | 'opportunities' | 'documents'>('overview');

  // edit buffer
  let company_name = $state('');
  let primary_contact_name = $state('');
  let primary_contact_email = $state('');
  let primary_contact_phone = $state('');
  let industry = $state('');
  let billing_address = $state('');
  let status = $state<Client['status']>('prospect');
  let notes = $state('');

  async function load() {
    loading = true;
    error = null;
    try {
      const [{ client: c }, { opportunities: opps }] = await Promise.all([
        api.get<{ client: Client }>(`/api/admin/clients/${id}`),
        api.get<{ opportunities: Opportunity[] }>(`/api/admin/opportunities?client_id=${id}`),
      ]);
      client = c;
      opportunities = opps;
      company_name = c.company_name;
      primary_contact_name = c.primary_contact_name ?? '';
      primary_contact_email = c.primary_contact_email ?? '';
      primary_contact_phone = c.primary_contact_phone ?? '';
      industry = c.industry ?? '';
      billing_address = c.billing_address ?? '';
      status = c.status;
      notes = c.notes ?? '';
    } catch (e) {
      error = e instanceof ApiError && e.status === 404 ? 'Client not found.' : 'Failed to load.';
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (!client) return;
    saving = true;
    error = null;
    saveMessage = null;
    try {
      const body = {
        company_name,
        primary_contact_name: primary_contact_name || null,
        primary_contact_email: primary_contact_email || null,
        primary_contact_phone: primary_contact_phone || null,
        industry: industry || null,
        billing_address: billing_address || null,
        status,
        notes: notes || null,
      };
      const { client: updated } = await api.put<{ client: Client }>(`/api/admin/clients/${id}`, body);
      client = updated;
      saveMessage = 'Saved.';
      setTimeout(() => (saveMessage = null), 2000);
    } catch (e) {
      error = e instanceof ApiError ? `Save failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function openDeleteDialog() {
    if (!client) return;
    error = null;
    try {
      preview = await api.get<DeletePreview>(`/api/admin/clients/${id}/delete-preview`);
      confirmOpen = true;
    } catch (e) {
      error = e instanceof ApiError ? `Couldn't load delete preview (${e.status}).` : 'Network error.';
    }
  }

  async function confirmDelete() {
    confirmOpen = false;
    try {
      await api.delete(`/api/admin/clients/${id}`);
      goto(`${base}/clients`, { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? `Delete failed (${e.status}).` : 'Network error.';
    }
  }

  function fmtDate(s: string) {
    try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return s; }
  }

  onMount(load);
</script>

<svelte:head><title>Client · Studio44</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/clients`} class="muted small">← Back to clients</a>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if !client}
  <div class="error">{error ?? 'Client not found.'}</div>
{:else}
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <h1>{client.company_name}</h1>
      <p class="muted small">Created {new Date(client.created_at).toLocaleString()}</p>
    </div>
    <span class="badge badge-{client.status}">{client.status}</span>
  </div>

  <div class="tabs">
    <button class="tab" class:active={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
    <button class="tab" class:active={tab === 'opportunities'} onclick={() => (tab = 'opportunities')}>
      Opportunities {#if opportunities.length}<span class="count">{opportunities.length}</span>{/if}
    </button>
    <button class="tab" class:active={tab === 'documents'} onclick={() => (tab = 'documents')}>Documents</button>
  </div>

  {#if error}<div class="error" style="margin-top: var(--space-4);">{error}</div>{/if}
  {#if saveMessage}<div class="muted small" style="margin-top: var(--space-2);">{saveMessage}</div>{/if}

  {#if tab === 'overview'}
    <div class="surface col" style="margin-top: var(--space-4);">
      <Field label="Company name *"><input bind:value={company_name} required /></Field>
      <div class="grid">
        <Field label="Primary contact name"><input bind:value={primary_contact_name} /></Field>
        <Field label="Industry"><input bind:value={industry} /></Field>
        <Field label="Primary contact email"><input type="email" bind:value={primary_contact_email} /></Field>
        <Field label="Primary contact phone"><input bind:value={primary_contact_phone} /></Field>
        <Field label="Status">
          <select bind:value={status}>
            <option value="prospect">Prospect</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="former">Former</option>
          </select>
        </Field>
      </div>
      <Field label="Billing address"><textarea bind:value={billing_address}></textarea></Field>
      <Field label="Notes"><textarea bind:value={notes}></textarea></Field>

      <div class="row" style="justify-content: space-between;">
        <Button variant="danger" onclick={openDeleteDialog}>Delete client</Button>
        <Button onclick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      {#if client.origin_lead_id}
        <p class="muted small">
          Converted from <a href={`${base}/leads/${client.origin_lead_id}`}>this lead</a>.
        </p>
      {/if}
    </div>
  {:else if tab === 'opportunities'}
    <div style="margin-top: var(--space-4);">
      <div class="row" style="justify-content: space-between; margin-bottom: var(--space-4);">
        <h2 style="margin: 0;">Opportunities</h2>
        <a href={`${base}/clients/${id}/opportunities/new`}>
          <Button>New opportunity</Button>
        </a>
      </div>
      <div class="surface" style="padding: 0;">
        {#if opportunities.length === 0}
          <p class="muted" style="padding: var(--space-4);">No opportunities yet for this client.</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Setup</th>
                <th>Monthly</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {#each opportunities as o (o.id)}
                <tr
                  style="cursor: pointer;"
                  onclick={() => (window.location.href = `${base}/clients/${id}/opportunities/${o.id}`)}
                >
                  <td><a href={`${base}/clients/${id}/opportunities/${o.id}`}>{o.name}</a></td>
                  <td><span class="badge badge-{o.status}">{o.status}</span></td>
                  <td>{o.value_setup != null ? `$${o.value_setup.toLocaleString()}` : '—'}</td>
                  <td>{o.value_monthly != null ? `$${o.value_monthly.toLocaleString()}/mo` : '—'}</td>
                  <td><span class="muted small">{fmtDate(o.created_at)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {:else if tab === 'documents'}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2>Documents</h2>
      <p class="muted small">
        Contracts and change orders show up here once the client has accepted an opportunity. Nothing
        to show yet.
      </p>
    </div>
  {/if}

  <ConfirmDialog
    open={confirmOpen}
    title={`Delete "${client.company_name}"?`}
    message="This removes the client and everything cascading from it. This cannot be undone."
    cascadeCounts={preview?.cascades}
    orphanCounts={preview?.orphans}
    confirmLabel="Delete client"
    confirmVariant="danger"
    onconfirm={confirmDelete}
    oncancel={() => (confirmOpen = false)}
  />
{/if}

<style>
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .tab {
    background: none;
    border: none;
    padding: 0.5rem 0.9rem;
    font-size: 0.95rem;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-family: inherit;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-color: var(--accent); }
  .count {
    margin-left: 0.4rem;
    padding: 1px 7px;
    background: #ececea;
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
  }
</style>

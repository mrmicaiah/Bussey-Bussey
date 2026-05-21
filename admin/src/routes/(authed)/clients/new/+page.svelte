<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import type { Client, Lead } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';

  const fromLeadId = $derived(page.url.searchParams.get('from_lead'));

  let company_name = $state('');
  let primary_contact_name = $state('');
  let primary_contact_email = $state('');
  let primary_contact_phone = $state('');
  let industry = $state('');
  let billing_address = $state('');
  let notes = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let prefillSource = $state<Lead | null>(null);
  let prefillError = $state<string | null>(null);

  onMount(async () => {
    if (!fromLeadId) return;
    try {
      const { lead } = await api.get<{ lead: Lead }>(`/api/admin/leads/${fromLeadId}`);
      prefillSource = lead;
      company_name = lead.company ?? '';
      primary_contact_name = lead.name ?? '';
      primary_contact_email = lead.email ?? '';
      primary_contact_phone = lead.phone ?? '';
      industry = lead.industry ?? '';
      if (lead.notes || lead.pain_summary) {
        const parts: string[] = [];
        if (lead.pain_summary) parts.push(`Pain (from lead): ${lead.pain_summary}`);
        if (lead.notes) parts.push(`Lead notes: ${lead.notes}`);
        notes = parts.join('\n\n');
      }
    } catch (e) {
      prefillError = e instanceof ApiError && e.status === 404 ? 'Source lead not found.' : 'Could not load source lead.';
    }
  });

  async function onSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = null;
    try {
      const body: Record<string, unknown> = {
        company_name,
        primary_contact_name: primary_contact_name || null,
        primary_contact_email: primary_contact_email || null,
        primary_contact_phone: primary_contact_phone || null,
        industry: industry || null,
        billing_address: billing_address || null,
        notes: notes || null,
      };
      if (fromLeadId) body['origin_lead_id'] = fromLeadId;
      const { client } = await api.post<{ client: Client }>('/api/admin/clients', body);
      goto(`${base}/clients/${client.id}`, { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? `Couldn't create client (${err.errorCode ?? err.status}).` : 'Network error.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>New client · Bussey Admin</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/clients`} class="muted small">← Back to clients</a>
</div>

<h1>{fromLeadId ? 'Convert lead to client' : 'New client'}</h1>
{#if fromLeadId && prefillSource}
  <p class="muted small">
    Converting from lead <a href={`${base}/leads/${prefillSource.id}`}>{prefillSource.name ?? prefillSource.email ?? prefillSource.id}</a>.
    Lead will be marked converted on submit.
  </p>
{:else if fromLeadId && prefillError}
  <div class="error" style="margin-top: var(--space-2);">{prefillError}</div>
{/if}

<form onsubmit={onSubmit} class="surface col" style="max-width: 600px; margin-top: var(--space-4);">
  <Field label="Company name *">
    <input bind:value={company_name} required />
  </Field>
  <div class="grid">
    <Field label="Primary contact name"><input bind:value={primary_contact_name} /></Field>
    <Field label="Industry"><input bind:value={industry} /></Field>
    <Field label="Primary contact email"><input type="email" bind:value={primary_contact_email} /></Field>
    <Field label="Primary contact phone"><input bind:value={primary_contact_phone} /></Field>
  </div>
  <Field label="Billing address"><textarea bind:value={billing_address}></textarea></Field>
  <Field label="Notes"><textarea bind:value={notes}></textarea></Field>

  {#if error}<div class="error">{error}</div>{/if}

  <div class="row" style="justify-content: flex-end; gap: var(--space-3);">
    <a href={fromLeadId ? `${base}/leads/${fromLeadId}` : `${base}/clients`}>
      <Button variant="secondary">Cancel</Button>
    </a>
    <Button type="submit" disabled={submitting}>
      {submitting ? 'Creating…' : fromLeadId ? 'Create client & convert lead' : 'Create client'}
    </Button>
  </div>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
  }
</style>

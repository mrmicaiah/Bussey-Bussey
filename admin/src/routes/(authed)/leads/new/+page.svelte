<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Lead } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';

  let name = $state('');
  let email = $state('');
  let phone = $state('');
  let company = $state('');
  let industry = $state('');
  let pain_summary = $state('');
  let urgency = $state<'' | 'immediate' | 'weeks' | 'months' | 'exploring'>('');
  let notes = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = null;
    try {
      const body = {
        name: name || null,
        email: email || null,
        phone: phone || null,
        company: company || null,
        industry: industry || null,
        pain_summary: pain_summary || null,
        urgency: urgency || null,
        notes: notes || null,
        source: 'manual',
      };
      const { lead } = await api.post<{ lead: Lead }>('/api/admin/leads', body);
      goto(`${base}/leads/${lead.id}`, { replaceState: true });
    } catch (err) {
      if (err instanceof ApiError) {
        error = `Couldn't create lead (${err.errorCode ?? err.status}).`;
      } else {
        error = 'Network error.';
      }
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>New lead · Bussey Admin</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/leads`} class="muted small">← Back to leads</a>
</div>

<h1>New lead</h1>
<p class="muted small">At least one of name, email, phone, or company is required.</p>

<form onsubmit={onSubmit} class="surface col" style="max-width: 600px; margin-top: var(--space-4);">
  <div class="grid">
    <Field label="Name"><input bind:value={name} /></Field>
    <Field label="Email"><input type="email" bind:value={email} /></Field>
    <Field label="Phone"><input bind:value={phone} /></Field>
    <Field label="Company"><input bind:value={company} /></Field>
    <Field label="Industry"><input bind:value={industry} /></Field>
    <Field label="Urgency">
      <select bind:value={urgency}>
        <option value="">—</option>
        <option value="immediate">Immediate</option>
        <option value="weeks">Weeks</option>
        <option value="months">Months</option>
        <option value="exploring">Exploring</option>
      </select>
    </Field>
  </div>
  <Field label="Pain summary"><textarea bind:value={pain_summary}></textarea></Field>
  <Field label="Notes (internal)"><textarea bind:value={notes}></textarea></Field>

  {#if error}<div class="error">{error}</div>{/if}

  <div class="row" style="justify-content: flex-end; gap: var(--space-3);">
    <a href={`${base}/leads`}><Button variant="secondary">Cancel</Button></a>
    <Button type="submit" disabled={submitting}>
      {submitting ? 'Creating…' : 'Create lead'}
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

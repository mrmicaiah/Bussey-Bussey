<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Opportunity } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';

  const clientId = $derived(page.params['id']!);

  let name = $state('');
  let description = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = null;
    try {
      const { opportunity } = await api.post<{ opportunity: Opportunity }>('/api/admin/opportunities', {
        client_id: clientId,
        name,
        description: description || null,
      });
      goto(`${base}/clients/${clientId}/opportunities/${opportunity.id}`, { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? `Couldn't create opportunity (${err.errorCode ?? err.status}).` : 'Network error.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>New opportunity · Bussey Admin</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/clients/${clientId}`} class="muted small">← Back to client</a>
</div>

<h1>New opportunity</h1>
<p class="muted small">Just the basics for now. The calculator and proposal builder come later.</p>

<form onsubmit={onSubmit} class="surface col" style="max-width: 600px; margin-top: var(--space-4);">
  <Field label="Name *" hint="e.g. Audit-Ready Hiring System">
    <input bind:value={name} required />
  </Field>
  <Field label="Description">
    <textarea bind:value={description}></textarea>
  </Field>
  {#if error}<div class="error">{error}</div>{/if}
  <div class="row" style="justify-content: flex-end; gap: var(--space-3);">
    <a href={`${base}/clients/${clientId}`}><Button variant="secondary">Cancel</Button></a>
    <Button type="submit" disabled={submitting}>
      {submitting ? 'Creating…' : 'Create opportunity'}
    </Button>
  </div>
</form>

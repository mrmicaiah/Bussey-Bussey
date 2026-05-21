<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';

  let description = $state('');
  let urgency = $state<'routine' | 'soon' | 'urgent'>('routine');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let successId = $state<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (submitting || description.trim().length === 0) return;
    submitting = true;
    error = null;
    try {
      const res = await api.post<{ change_request_id: string }>(
        '/api/portal/change-requests',
        { description: description.trim(), urgency },
      );
      successId = res.change_request_id;
    } catch (e2) {
      error = e2 instanceof ApiError ? `Submission failed (${e2.errorCode ?? e2.status}).` : 'Network error.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Request a change · Bussey Client Portal</title></svelte:head>

<h1>Request a change</h1>
<p class="muted">
  Tell us what you'd like adjusted. Your Bussey contact will scope and price
  it, then send a change order to your portal for review.
</p>

{#if successId}
  <div class="surface" style="margin-top: var(--space-4);">
    <div class="success">Got it — we'll be in touch shortly with next steps.</div>
    <p class="muted small" style="margin-top: var(--space-3);">
      Request ID <code>{successId}</code>
    </p>
    <div class="row" style="margin-top: var(--space-3);">
      <a href={`${base}/`}><Button variant="secondary">Back to portal home</Button></a>
    </div>
  </div>
{:else}
  <form class="surface col" onsubmit={submit} style="margin-top: var(--space-4);">
    <Field label="What would you like to change?">
      <textarea
        bind:value={description}
        placeholder="Describe what you'd like added, removed, or adjusted."
        required
      ></textarea>
    </Field>
    <Field label="Urgency">
      <select bind:value={urgency}>
        <option value="routine">Routine — no rush</option>
        <option value="soon">Soon — within a couple weeks</option>
        <option value="urgent">Urgent — this is blocking something</option>
      </select>
    </Field>

    {#if error}<div class="error">{error}</div>{/if}

    <div class="row">
      <Button type="submit" disabled={submitting || description.trim().length === 0}>
        {submitting ? 'Submitting…' : 'Submit request'}
      </Button>
    </div>
  </form>
{/if}

<style>
  h1 { margin-bottom: var(--space-2); }
  form { gap: var(--space-4); }
  code {
    background: rgba(0,0,0,0.06);
    padding: 0 0.3rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Lead, LeadStatus, LeadUrgency } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  type DeletePreview = {
    cascades: Record<string, number>;
    orphans: Record<string, number>;
    note?: string;
  };
  let confirmOpen = $state(false);
  let preview = $state<DeletePreview | null>(null);

  type ChatTranscriptMessage = { role: string; content: string; created_at: string };
  let transcript = $state<ChatTranscriptMessage[] | null>(null);
  let transcriptLoading = $state(false);
  let transcriptError = $state<string | null>(null);

  const id = $derived(page.params['id']!);

  let lead = $state<Lead | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saveMessage = $state<string | null>(null);

  // edit buffer
  let name = $state('');
  let email = $state('');
  let phone = $state('');
  let company = $state('');
  let industry = $state('');
  let pain_summary = $state('');
  let urgency = $state<'' | LeadUrgency>('');
  let status = $state<LeadStatus>('new');
  let notes = $state('');

  const canConvert = $derived(
    lead !== null && (lead.status === 'qualified' || lead.status === 'contacted'),
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const { lead: l } = await api.get<{ lead: Lead }>(`/api/admin/leads/${id}`);
      lead = l;
      name = l.name ?? '';
      email = l.email ?? '';
      phone = l.phone ?? '';
      company = l.company ?? '';
      industry = l.industry ?? '';
      pain_summary = l.pain_summary ?? '';
      urgency = l.urgency ?? '';
      status = l.status;
      notes = l.notes ?? '';
      if (l.source === 'chat') void loadTranscript();
    } catch (e) {
      error = e instanceof ApiError && e.status === 404 ? 'Lead not found.' : 'Failed to load.';
    } finally {
      loading = false;
    }
  }

  async function loadTranscript() {
    transcriptLoading = true;
    transcriptError = null;
    try {
      const { messages } = await api.get<{ messages: ChatTranscriptMessage[] }>(`/api/admin/leads/${id}/chat-transcript`);
      transcript = messages;
    } catch (e) {
      transcriptError = e instanceof ApiError ? `Couldn't load transcript (${e.status}).` : 'Network error.';
    } finally {
      transcriptLoading = false;
    }
  }

  async function save() {
    if (!lead) return;
    saving = true;
    error = null;
    saveMessage = null;
    try {
      const body = {
        name: name || null,
        email: email || null,
        phone: phone || null,
        company: company || null,
        industry: industry || null,
        pain_summary: pain_summary || null,
        urgency: urgency || null,
        status,
        notes: notes || null,
      };
      const { lead: updated } = await api.put<{ lead: Lead }>(`/api/admin/leads/${id}`, body);
      lead = updated;
      saveMessage = 'Saved.';
      setTimeout(() => (saveMessage = null), 2000);
    } catch (e) {
      error = e instanceof ApiError ? `Save failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  function convertToClient() {
    if (!lead) return;
    const qs = new URLSearchParams({ from_lead: lead.id });
    goto(`${base}/clients/new?${qs}`);
  }

  async function openDeleteDialog() {
    if (!lead) return;
    error = null;
    try {
      preview = await api.get<DeletePreview>(`/api/admin/leads/${id}/delete-preview`);
      confirmOpen = true;
    } catch (e) {
      error = e instanceof ApiError ? `Couldn't load delete preview (${e.status}).` : 'Network error.';
    }
  }

  async function confirmDelete() {
    confirmOpen = false;
    try {
      await api.delete(`/api/admin/leads/${id}`);
      goto(`${base}/leads`, { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? `Delete failed (${e.status}).` : 'Network error.';
    }
  }

  onMount(load);
</script>

<svelte:head><title>Lead · Studio44</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/leads`} class="muted small">← Back to leads</a>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if !lead}
  <div class="error">{error ?? 'Lead not found.'}</div>
{:else}
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <h1>{lead.name ?? lead.email ?? lead.phone ?? '(unnamed lead)'}</h1>
      <p class="muted small">
        Created {new Date(lead.created_at).toLocaleString()} · Source: {lead.source ?? '—'}
      </p>
    </div>
    <span class="badge badge-{lead.status}">{lead.status}</span>
  </div>

  {#if error}<div class="error" style="margin-top: var(--space-4);">{error}</div>{/if}
  {#if saveMessage}<div class="muted small" style="margin-top: var(--space-2);">{saveMessage}</div>{/if}

  <div class="surface col" style="margin-top: var(--space-4);">
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
      <Field label="Status">
        <select bind:value={status}>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="disqualified">Disqualified</option>
          <option value="converted" disabled={lead.status !== 'converted'}>Converted</option>
        </select>
      </Field>
    </div>
    <Field label="Pain summary"><textarea bind:value={pain_summary}></textarea></Field>
    <Field label="Notes (internal)"><textarea bind:value={notes}></textarea></Field>

    <div class="row" style="justify-content: space-between;">
      <Button variant="danger" onclick={openDeleteDialog}>Delete lead</Button>
      <div class="row" style="gap: var(--space-3);">
        <Button
          variant="secondary"
          disabled={!canConvert}
          onclick={convertToClient}
        >
          Convert to client
        </Button>
        <Button onclick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
    {#if !canConvert && lead.status !== 'converted'}
      <p class="muted small">
        Convert is enabled once the lead reaches <strong>contacted</strong> or
        <strong>qualified</strong>.
      </p>
    {/if}
  </div>

  {#if lead.source === 'chat'}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2 style="margin: 0 0 var(--space-3);">Chat transcript</h2>
      {#if transcriptLoading}
        <p class="muted small">Loading transcript…</p>
      {:else if transcriptError}
        <div class="error">{transcriptError}</div>
      {:else if transcript && transcript.length > 0}
        <div class="transcript">
          {#each transcript as msg}
            <div class="bubble bubble-{msg.role}">
              <div class="meta muted small">
                {msg.role === 'user' ? 'Visitor' : msg.role === 'assistant' ? 'Bussey assistant' : msg.role}
                · {new Date(msg.created_at).toLocaleString()}
              </div>
              <div class="content">{msg.content}</div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted small">No transcript available.</p>
      {/if}
    </div>
  {/if}

  <ConfirmDialog
    open={confirmOpen}
    title={`Delete lead "${lead.name ?? lead.email ?? lead.id}"?`}
    message="This cannot be undone."
    cascadeCounts={preview?.cascades}
    orphanCounts={preview?.orphans}
    note={preview?.note}
    confirmLabel="Delete lead"
    confirmVariant="danger"
    onconfirm={confirmDelete}
    oncancel={() => (confirmOpen = false)}
  />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
  }
  .transcript { display: flex; flex-direction: column; gap: 0.5rem; }
  .bubble {
    padding: 0.6rem 0.9rem;
    border-radius: 10px;
    max-width: 75%;
    white-space: pre-wrap;
  }
  /* Dark chat pattern (reskin pass 3): crimson tint = the brand's voice (assistant),
     neutral surface = the visitor. Alignment unchanged. The tint is the established
     rgba-off-token precedent (no token expresses a low-opacity accent). */
  .bubble-user      { align-self: flex-end;   background: var(--surface-2); border: 1px solid var(--border-soft); color: var(--text); }
  .bubble-assistant { align-self: flex-start; background: rgba(212, 11, 30, 0.12); border: 1px solid rgba(212, 11, 30, 0.35); color: var(--text); }
  .meta { margin-bottom: 0.2rem; }
  .content { line-height: 1.45; }
</style>

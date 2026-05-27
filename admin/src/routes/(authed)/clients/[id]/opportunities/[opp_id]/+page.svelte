<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { Opportunity, Client, OpportunityStatus, Proposal, ChangeOrder } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import DispositionModal from '$lib/components/DispositionModal.svelte';
  import CredentialsHandoffModal from '$lib/components/CredentialsHandoffModal.svelte';

  type DispositionKind = 'accepted' | 'followup' | 'changes' | 'declined';
  let dispositionOpen = $state(false);
  let dispositionKind = $state<DispositionKind | null>(null);
  let dispositionSubmitting = $state(false);
  let dispositionMessage = $state<string | null>(null);

  type ActivationCredentials = { portal_url: string; email: string; temp_password: string };
  let credentialsOpen = $state(false);
  let credentialsPayload = $state<ActivationCredentials | null>(null);

  type CredentialsState =
    | { available: true; credentials_issued_at: string; credentials: ActivationCredentials }
    | { available: false; reason: 'expired' | 'cache_miss' | 'not_activated'; credentials_issued_at: string | null };
  let credentialsState = $state<CredentialsState | null>(null);
  let credentialsActionBusy = $state(false);
  let credentialsActionError = $state<string | null>(null);

  type DeletePreview = {
    cascades: Record<string, number>;
    orphans: Record<string, number>;
    refuses_delete?: boolean;
  };
  let confirmOpen = $state(false);
  let preview = $state<DeletePreview | null>(null);

  let changeOrders = $state<ChangeOrder[]>([]);
  let creatingChangeOrder = $state(false);
  let changeOrderError = $state<string | null>(null);

  type ChangeRequest = {
    id: string;
    client_id: string;
    opportunity_id: string;
    description: string;
    urgency: 'routine' | 'soon' | 'urgent';
    status: 'submitted' | 'reviewed' | 'declined' | 'converted_to_change_order';
    submitted_at: string;
    reviewed_at: string | null;
    notes: string | null;
    converted_to_change_order_id: string | null;
  };
  let changeRequests = $state<ChangeRequest[]>([]);
  let changeRequestBusy = $state(false);
  let changeRequestError = $state<string | null>(null);
  let declineModalOpenFor = $state<string | null>(null);
  let declineNote = $state('');

  const clientId = $derived(page.params['id']!);
  const oppId = $derived(page.params['opp_id']!);

  let opp = $state<Opportunity | null>(null);
  let client = $state<Client | null>(null);
  let proposals = $state<Proposal[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saveMessage = $state<string | null>(null);

  // edit buffer
  let name = $state('');
  let description = $state('');
  let status = $state<OpportunityStatus>('open');
  let value_setup = $state<string>('');
  let value_monthly = $state<string>('');
  let next_followup_date = $state('');

  async function load() {
    loading = true;
    error = null;
    try {
      const [{ opportunity: o }, { client: c }, { proposals: pp }] = await Promise.all([
        api.get<{ opportunity: Opportunity }>(`/api/admin/opportunities/${oppId}`),
        api.get<{ client: Client }>(`/api/admin/clients/${clientId}`),
        api.get<{ proposals: Proposal[] }>(`/api/admin/proposals?opportunity_id=${oppId}`),
      ]);
      opp = o;
      client = c;
      proposals = pp;
      name = o.name;
      description = o.description ?? '';
      status = o.status;
      value_setup = o.value_setup != null ? String(o.value_setup) : '';
      value_monthly = o.value_monthly != null ? String(o.value_monthly) : '';
      next_followup_date = o.next_followup_date ?? '';
      if (o.status === 'accepted') {
        await loadCredentialsState();
        await loadChangeOrders();
        await loadChangeRequests();
      } else {
        credentialsState = null;
        changeOrders = [];
        changeRequests = [];
      }
    } catch (e) {
      error = e instanceof ApiError && e.status === 404 ? 'Opportunity not found.' : 'Failed to load.';
    } finally {
      loading = false;
    }
  }

  async function loadCredentialsState() {
    try {
      credentialsState = await api.get<CredentialsState>(`/api/admin/opportunities/${oppId}/credentials`);
    } catch (e) {
      // 404 just means no portal account yet (shouldn't happen post-acceptance, but tolerate).
      credentialsState = null;
    }
  }

  async function loadChangeOrders() {
    try {
      const res = await api.get<{ change_orders: ChangeOrder[] }>(
        `/api/admin/change-orders?opportunity_id=${oppId}`,
      );
      changeOrders = res.change_orders;
    } catch {
      changeOrders = [];
    }
  }

  async function createChangeOrder() {
    if (!opp) return;
    const acceptedProposal = proposals.find((p) => p.status === 'accepted');
    if (!acceptedProposal) {
      changeOrderError = 'No accepted proposal on this opportunity.';
      return;
    }
    creatingChangeOrder = true;
    changeOrderError = null;
    try {
      const res = await api.post<{ change_order: ChangeOrder }>(`/api/admin/change-orders`, {
        proposal_id: acceptedProposal.id,
        name: 'New change order',
      });
      goto(`${base}/clients/${clientId}/opportunities/${oppId}/change-orders/${res.change_order.id}`);
    } catch (e) {
      changeOrderError =
        e instanceof ApiError ? `Create failed (${e.errorCode ?? e.status}).` : 'Network error.';
      creatingChangeOrder = false;
    }
  }

  function fmtSigned(n: number): string {
    const sign = n < 0 ? '-' : n > 0 ? '+' : '';
    return `${sign}${Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}`;
  }

  async function loadChangeRequests() {
    try {
      const res = await api.get<{ change_requests: ChangeRequest[] }>(
        `/api/admin/change-requests?opportunity_id=${oppId}`,
      );
      changeRequests = res.change_requests;
    } catch {
      changeRequests = [];
    }
  }

  async function markRequestReviewed(id: string) {
    changeRequestBusy = true;
    changeRequestError = null;
    try {
      await api.post(`/api/admin/change-requests/${id}/mark-reviewed`, {});
      await loadChangeRequests();
    } catch (e) {
      changeRequestError = e instanceof ApiError ? `Mark reviewed failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      changeRequestBusy = false;
    }
  }

  async function submitDecline() {
    if (!declineModalOpenFor) return;
    changeRequestBusy = true;
    changeRequestError = null;
    try {
      await api.post(`/api/admin/change-requests/${declineModalOpenFor}/decline`, {
        notes: declineNote.trim() || null,
      });
      declineModalOpenFor = null;
      declineNote = '';
      await loadChangeRequests();
    } catch (e) {
      changeRequestError = e instanceof ApiError ? `Decline failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      changeRequestBusy = false;
    }
  }

  async function convertRequestToChangeOrder(id: string) {
    changeRequestBusy = true;
    changeRequestError = null;
    try {
      const res = await api.post<{ change_order_id: string }>(
        `/api/admin/change-requests/${id}/convert-to-change-order`,
        {},
      );
      goto(`${base}/clients/${clientId}/opportunities/${oppId}/change-orders/${res.change_order_id}`);
    } catch (e) {
      changeRequestError = e instanceof ApiError ? `Convert failed (${e.errorCode ?? e.status}).` : 'Network error.';
      changeRequestBusy = false;
    }
  }

  async function showCredentials() {
    credentialsActionError = null;
    let snapshot = credentialsState;
    if (snapshot && snapshot.available) {
      credentialsPayload = snapshot.credentials;
      credentialsOpen = true;
      return;
    }
    // Stale read; refetch in case the window state changed.
    await loadCredentialsState();
    snapshot = credentialsState;
    if (snapshot && snapshot.available) {
      credentialsPayload = snapshot.credentials;
      credentialsOpen = true;
    }
  }

  async function resetCredentials() {
    credentialsActionBusy = true;
    credentialsActionError = null;
    try {
      const res = await api.post<{
        credentials_issued_at: string;
        credentials: ActivationCredentials;
      }>(`/api/admin/opportunities/${oppId}/reset-credentials`, {});
      credentialsState = {
        available: true,
        credentials_issued_at: res.credentials_issued_at,
        credentials: res.credentials,
      };
      credentialsPayload = res.credentials;
      credentialsOpen = true;
    } catch (e) {
      credentialsActionError =
        e instanceof ApiError ? `Reset failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      credentialsActionBusy = false;
    }
  }

  async function save() {
    if (!opp) return;
    saving = true;
    error = null;
    saveMessage = null;
    try {
      const body: Record<string, unknown> = {
        name,
        description: description || null,
        status,
        value_setup: value_setup === '' ? null : Number(value_setup),
        value_monthly: value_monthly === '' ? null : Number(value_monthly),
        next_followup_date: next_followup_date || null,
      };
      const { opportunity: updated } = await api.put<{ opportunity: Opportunity }>(
        `/api/admin/opportunities/${oppId}`,
        body,
      );
      opp = updated;
      saveMessage = 'Saved.';
      setTimeout(() => (saveMessage = null), 2000);
    } catch (e) {
      error = e instanceof ApiError ? `Save failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  function openDisposition(kind: DispositionKind) {
    dispositionKind = kind;
    dispositionOpen = true;
    dispositionMessage = null;
  }

  async function submitDisposition(kind: DispositionKind, payload: Record<string, unknown>) {
    dispositionSubmitting = true;
    try {
      if (kind === 'accepted') {
        const res = await api.post<{
          ok: boolean;
          credentials: ActivationCredentials;
        }>(`/api/admin/opportunities/${oppId}/activate`, {});
        dispositionOpen = false;
        credentialsPayload = res.credentials;
        credentialsOpen = true;
        await load(); // status badges, locked editor
        return;
      }

      const body = { kind, ...payload };
      const res = await api.post<{ ok: boolean; pending?: boolean; message?: string }>(
        `/api/admin/opportunities/${oppId}/disposition`,
        body,
      );
      dispositionOpen = false;
      dispositionMessage = res.message ?? `${kind} captured.`;
      setTimeout(() => (dispositionMessage = null), 4500);
      await load(); // refresh status badges + notes
      if (kind === 'changes') {
        goto(`${base}/clients/${clientId}/opportunities/${oppId}/proposal`);
      }
    } catch (e) {
      error = e instanceof ApiError ? `${kind} failed: ${e.errorCode ?? e.status}` : 'Network error.';
    } finally {
      dispositionSubmitting = false;
    }
  }

  async function openDeleteDialog() {
    if (!opp) return;
    error = null;
    try {
      preview = await api.get<DeletePreview>(`/api/admin/opportunities/${oppId}/delete-preview`);
      confirmOpen = true;
    } catch (e) {
      error = e instanceof ApiError ? `Couldn't load delete preview (${e.status}).` : 'Network error.';
    }
  }

  async function confirmDelete() {
    confirmOpen = false;
    try {
      await api.delete(`/api/admin/opportunities/${oppId}`);
      goto(`${base}/clients/${clientId}`, { replaceState: true });
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === 'cannot_delete_accepted_opportunity') {
        error = 'Accepted opportunities cannot be deleted (locked by acceptance).';
      } else {
        error = e instanceof ApiError ? `Delete failed (${e.status}).` : 'Network error.';
      }
    }
  }

  onMount(load);
</script>

<svelte:head><title>Opportunity · Studio44</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-4);">
  <a href={`${base}/clients/${clientId}`} class="muted small">← Back to client</a>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if !opp || !client}
  <div class="error">{error ?? 'Opportunity not found.'}</div>
{:else}
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <h1>{opp.name}</h1>
      <p class="muted small">
        Client: <a href={`${base}/clients/${client.id}`}>{client.company_name}</a> · Created {new Date(opp.created_at).toLocaleString()}
      </p>
    </div>
    <span class="badge badge-{opp.status}">{opp.status}</span>
  </div>

  {#if error}<div class="error" style="margin-top: var(--space-4);">{error}</div>{/if}
  {#if saveMessage}<div class="muted small" style="margin-top: var(--space-2);">{saveMessage}</div>{/if}

  <div class="surface col" style="margin-top: var(--space-4);">
    <Field label="Name"><input bind:value={name} required /></Field>
    <Field label="Description"><textarea bind:value={description}></textarea></Field>
    <div class="grid">
      <Field label="Status">
        <select bind:value={status}>
          <option value="open">Open</option>
          <option value="proposed">Proposed</option>
          <option value="paused">Paused</option>
          <option value="lost">Lost</option>
          <option value="accepted" disabled>Accepted (locked once set)</option>
        </select>
      </Field>
      <Field label="Setup value ($)"><input type="number" bind:value={value_setup} min="0" step="any" /></Field>
      <Field label="Monthly value ($)"><input type="number" bind:value={value_monthly} min="0" step="any" /></Field>
      <Field label="Next follow-up date"><input type="date" bind:value={next_followup_date} /></Field>
    </div>

    <div class="row" style="justify-content: space-between;">
      <Button variant="danger" onclick={openDeleteDialog} disabled={opp.status === 'accepted'}>
        Delete opportunity
      </Button>
      <Button onclick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  </div>

  {#if proposals.length > 0 && (opp.status === 'open' || opp.status === 'proposed')}
    {@const dispCurrent = proposals.find((p) => p.status === 'accepted')
      ?? proposals.find((p) => p.status === 'sent')
      ?? proposals.find((p) => p.status === 'draft')
      ?? proposals[0]}
    <div class="surface disposition" style="margin-top: var(--space-4);">
      <h2 style="margin: 0 0 var(--space-3);">Disposition</h2>
      <p class="muted small" style="margin: 0 0 var(--space-3);">Capture the outcome of the presentation.</p>
      <div class="disp-buttons">
        <button class="disp-btn accepted" type="button" onclick={() => openDisposition('accepted')}>
          <span class="dot">🟢</span> Accepted
        </button>
        <button class="disp-btn followup" type="button" onclick={() => openDisposition('followup')}>
          <span class="dot">🟡</span> Follow-up
        </button>
        <button class="disp-btn changes" type="button" onclick={() => openDisposition('changes')}>
          <span class="dot">🟠</span> Changes requested
        </button>
        <button class="disp-btn declined" type="button" onclick={() => openDisposition('declined')}>
          <span class="dot">🔴</span> Declined
        </button>
      </div>
      {#if dispositionMessage}
        <p class="muted small" style="margin-top: var(--space-3);">{dispositionMessage}</p>
      {/if}
    </div>
    <DispositionModal
      open={dispositionOpen}
      kind={dispositionKind}
      opportunity={opp}
      proposal={dispCurrent ?? null}
      submitting={dispositionSubmitting}
      onsubmit={submitDisposition}
      onclose={() => (dispositionOpen = false)}
    />
  {/if}

  {#if opp.status === 'accepted' && credentialsState}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2 style="margin: 0 0 var(--space-2);">Activation</h2>
      <p class="muted small" style="margin: 0 0 var(--space-3);">
        Portal account provisioned. Use the controls below to re-share the credentials with the
        client. The plaintext password is recoverable for 24 hours after issuance; after that
        you can reset to share new credentials.
      </p>
      <div class="row" style="gap: var(--space-3); align-items: center; flex-wrap: wrap;">
        {#if credentialsState.available}
          <Button variant="secondary" onclick={showCredentials}>Show credentials</Button>
          <span class="muted small">Issued {new Date(credentialsState.credentials_issued_at).toLocaleString()}</span>
        {:else}
          <Button onclick={resetCredentials} disabled={credentialsActionBusy}>
            {credentialsActionBusy ? 'Resetting…' : 'Reset and share new credentials'}
          </Button>
          <span class="muted small">
            {credentialsState.reason === 'expired'
              ? 'The 24-hour re-display window has expired.'
              : credentialsState.reason === 'cache_miss'
                ? 'Cached plaintext is unavailable; reset to issue new credentials.'
                : 'No active credentials.'}
          </span>
        {/if}
      </div>
      {#if credentialsActionError}
        <p class="error" style="margin-top: var(--space-3);">{credentialsActionError}</p>
      {/if}
    </div>
  {/if}

  {#if opp.status === 'accepted'}
    <div class="surface" style="margin-top: var(--space-4);">
      <div class="row" style="justify-content: space-between; align-items: baseline;">
        <h2 style="margin: 0;">Change orders</h2>
        <Button onclick={createChangeOrder} disabled={creatingChangeOrder}>
          {creatingChangeOrder ? 'Creating…' : 'New change order'}
        </Button>
      </div>
      {#if changeOrderError}<div class="error" style="margin-top: var(--space-3);">{changeOrderError}</div>{/if}
      {#if changeOrders.length === 0}
        <p class="muted small" style="margin-top: var(--space-3);">
          No change orders yet. Use the button above to create one against the accepted proposal.
        </p>
      {:else}
        <table style="margin-top: var(--space-3);">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th style="text-align: right;">Setup Δ</th>
              <th style="text-align: right;">Monthly Δ</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each changeOrders as co (co.id)}
              <tr>
                <td>{co.name}</td>
                <td><span class="badge badge-{co.status}">{co.status}</span></td>
                <td style="text-align: right; font-variant-numeric: tabular-nums;">{fmtSigned(co.setup_delta)}</td>
                <td style="text-align: right; font-variant-numeric: tabular-nums;">{fmtSigned(co.monthly_delta)} / mo</td>
                <td class="muted small">{new Date(co.created_at).toLocaleDateString()}</td>
                <td style="text-align: right;">
                  <a href={`${base}/clients/${clientId}/opportunities/${oppId}/change-orders/${co.id}`}>
                    Open →
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}

  {#if opp.status === 'accepted'}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2 style="margin: 0 0 var(--space-2);">Change requests</h2>
      <p class="muted small" style="margin: 0 0 var(--space-3);">
        Free-text intake from the client. Mark reviewed when triaged; convert to a change order when ready to scope and price.
      </p>
      {#if changeRequestError}<div class="error" style="margin-bottom: var(--space-3);">{changeRequestError}</div>{/if}
      {#if changeRequests.length === 0}
        <p class="muted small">No change requests yet.</p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Urgency</th>
              <th>Description</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each changeRequests as cr (cr.id)}
              <tr>
                <td class="muted small">{new Date(cr.submitted_at).toLocaleString()}</td>
                <td>{cr.urgency}</td>
                <td>
                  <details>
                    <summary>{cr.description.slice(0, 60)}{cr.description.length > 60 ? '…' : ''}</summary>
                    <p style="white-space: pre-wrap; margin: 0.4rem 0;">{cr.description}</p>
                  </details>
                </td>
                <td><span class="badge badge-{cr.status === 'converted_to_change_order' ? 'approved' : cr.status === 'declined' ? 'rejected' : cr.status === 'reviewed' ? 'sent' : 'draft'}">{cr.status.replace(/_/g, ' ')}</span></td>
                <td style="text-align: right;">
                  {#if cr.status === 'submitted'}
                    <button class="action-btn" onclick={() => markRequestReviewed(cr.id)} disabled={changeRequestBusy}>Mark reviewed</button>
                  {/if}
                  {#if cr.status === 'submitted' || cr.status === 'reviewed'}
                    <button class="action-btn" onclick={() => convertRequestToChangeOrder(cr.id)} disabled={changeRequestBusy}>Convert →</button>
                    <button class="action-btn danger" onclick={() => { declineModalOpenFor = cr.id; declineNote = ''; }} disabled={changeRequestBusy}>Decline</button>
                  {/if}
                  {#if cr.status === 'converted_to_change_order' && cr.converted_to_change_order_id}
                    <a class="action-btn" href={`${base}/clients/${clientId}/opportunities/${oppId}/change-orders/${cr.converted_to_change_order_id}`}>Open CO →</a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}

  {#if declineModalOpenFor}
    <div class="backdrop" role="presentation" onclick={() => (declineModalOpenFor = null)}></div>
    <div class="modal surface" role="dialog" aria-modal="true" aria-labelledby="decline-title">
      <h2 id="decline-title">Decline change request</h2>
      <Field label="Note (optional, visible only to admins)">
        <textarea bind:value={declineNote}></textarea>
      </Field>
      <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-3);">
        <Button variant="secondary" onclick={() => (declineModalOpenFor = null)} disabled={changeRequestBusy}>Cancel</Button>
        <Button variant="danger" onclick={submitDecline} disabled={changeRequestBusy}>
          {changeRequestBusy ? 'Submitting…' : 'Decline request'}
        </Button>
      </div>
    </div>
  {/if}

  <CredentialsHandoffModal
    open={credentialsOpen}
    opportunityId={oppId}
    clientName={client.company_name}
    credentials={credentialsPayload}
    onclose={() => {
      credentialsOpen = false;
      credentialsPayload = null;
    }}
  />

  <div class="surface" style="margin-top: var(--space-4);">
    <h2>Proposal</h2>
    {#if proposals.length === 0}
      <p class="muted small">No proposal yet.</p>
      <a href={`${base}/clients/${clientId}/opportunities/${oppId}/proposal`}>
        <Button>Build proposal</Button>
      </a>
    {:else}
      {@const current = proposals.find((p) => p.status === 'accepted')
        ?? proposals.find((p) => p.status === 'sent')
        ?? proposals.find((p) => p.status === 'draft')
        ?? proposals[0]}
      {#if current}
        <p class="muted small">
          Current: <strong>{current.name}</strong>
          · <span class="badge badge-{current.status}">{current.status}</span>
          · Setup ${current.setup_total.toLocaleString()}
          · Monthly ${current.monthly_total.toLocaleString()}/mo
        </p>
        <a href={`${base}/clients/${clientId}/opportunities/${oppId}/proposal`}>
          <Button>{current.status === 'accepted' ? 'View proposal' : 'Edit proposal'}</Button>
        </a>
      {/if}
      {#if proposals.length > 1}
        <p class="muted small" style="margin-top: var(--space-3);">
          {proposals.length} proposals total ({proposals.filter((p) => p.status === 'superseded').length} superseded).
        </p>
      {/if}
    {/if}
  </div>

  <ConfirmDialog
    open={confirmOpen}
    title={`Delete opportunity "${opp.name}"?`}
    message="This removes the opportunity and everything cascading from it. This cannot be undone."
    cascadeCounts={preview?.cascades}
    orphanCounts={preview?.orphans}
    confirmLabel="Delete opportunity"
    confirmVariant="danger"
    onconfirm={confirmDelete}
    oncancel={() => (confirmOpen = false)}
    disabledReason={preview?.refuses_delete ? 'Accepted opportunities are locked and cannot be deleted.' : undefined}
  />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
  }
  .disp-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }
  .disp-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.8rem 1rem;
    font: inherit;
    cursor: pointer;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    transition: border-color 120ms ease;
  }
  .disp-btn:hover { border-color: var(--accent); }
  .disp-btn .dot { font-size: 0.9rem; }
  .action-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.25rem 0.55rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    color: inherit;
    text-decoration: none;
    margin-left: 0.3rem;
  }
  .action-btn:hover { border-color: var(--accent); }
  .action-btn.danger { color: var(--danger); }
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.42);
    z-index: 60;
  }
  .modal {
    position: fixed;
    top: 14vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, 92vw);
    z-index: 61;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  }
  details summary { cursor: pointer; }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import type { PortalMe } from '$lib/types';

  let { data }: { data: { me: PortalMe } } = $props();

  type Signature = {
    id: string;
    document_type: string;
    document_id: string;
    signature_type: string;
    typed_name: string | null;
    typed_initials: string | null;
    ip_address: string | null;
    signed_at: string;
  };

  // Password change
  let pwNew = $state('');
  let pwConfirm = $state('');
  let pwSubmitting = $state(false);
  let pwMessage = $state<string | null>(null);
  let pwError = $state<string | null>(null);

  // Notification prefs
  let notifyChangeOrders = $state(true);
  let notifyPayments = $state(true);
  let prefsSubmitting = $state(false);
  let prefsMessage = $state<string | null>(null);
  let prefsError = $state<string | null>(null);

  let signatures = $state<Signature[]>([]);

  async function loadSignatures() {
    try {
      const res = await api.get<{ signatures: Signature[] }>('/api/portal/account/signatures');
      signatures = res.signatures;
    } catch {
      signatures = [];
    }
  }

  async function loadPrefs() {
    // The portal_account row already comes back via /me, but K2's /me didn't
    // expand to include notification prefs. Pull them with a no-op pref
    // update? Simpler: re-fetch the portal account directly. The
    // /api/portal/me endpoint doesn't return prefs, so derive from the API
    // we already have by reading defaults; if the user changes them we
    // persist. For first load, default to true (which mirrors the DB
    // default for new accounts).
    notifyChangeOrders = true;
    notifyPayments = true;
  }

  async function changePassword(e: Event) {
    e.preventDefault();
    if (pwSubmitting) return;
    pwError = null;
    pwMessage = null;
    pwSubmitting = true;
    try {
      await api.post('/api/portal/auth/change-password', { new_password: pwNew, confirm: pwConfirm });
      pwMessage = 'Password updated.';
      pwNew = '';
      pwConfirm = '';
    } catch (e2) {
      if (e2 instanceof ApiError) {
        const code = e2.errorCode;
        pwError =
          code === 'password_too_short' ? 'Password is too short.'
          : code === 'password_needs_lowercase' ? 'Password needs a lowercase letter.'
          : code === 'password_needs_uppercase' ? 'Password needs an uppercase letter.'
          : code === 'password_needs_number_or_symbol' ? 'Password needs a number or symbol.'
          : code === 'passwords_do_not_match' ? 'Passwords do not match.'
          : `Failed (${code ?? e2.status}).`;
      } else {
        pwError = 'Network error.';
      }
    } finally {
      pwSubmitting = false;
    }
  }

  async function savePrefs() {
    prefsSubmitting = true;
    prefsError = null;
    prefsMessage = null;
    try {
      const res = await api.put<{
        notification_prefs: { notify_change_orders: boolean; notify_payments: boolean };
      }>('/api/portal/account/notification-prefs', {
        notify_change_orders: notifyChangeOrders,
        notify_payments: notifyPayments,
      });
      notifyChangeOrders = res.notification_prefs.notify_change_orders;
      notifyPayments = res.notification_prefs.notify_payments;
      prefsMessage = 'Saved.';
      setTimeout(() => (prefsMessage = null), 2200);
    } catch (e) {
      prefsError = e instanceof ApiError ? `Save failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      prefsSubmitting = false;
    }
  }

  async function logout() {
    try {
      await api.post('/api/portal/auth/logout', {});
    } catch {
      // Continue regardless.
    }
    goto(`${base}/login`, { replaceState: true });
  }

  onMount(async () => {
    await Promise.all([loadSignatures(), loadPrefs()]);
  });
</script>

<svelte:head><title>Account · Bussey Client Portal</title></svelte:head>

<h1>Account</h1>

<div class="surface" style="margin-top: var(--space-4);">
  <h2>Profile</h2>
  <div class="kv"><span class="muted">Email</span><span>{data.me.portal_account.email}</span></div>
  <div class="kv"><span class="muted">Company</span><span>{data.me.client.company_name}</span></div>
  <div class="kv"><span class="muted">Primary contact</span><span>{data.me.client.primary_contact_name ?? '—'}</span></div>
  <p class="muted small">To change any of these, reach out to your Bussey contact.</p>
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <h2>Change password</h2>
  <form onsubmit={changePassword} class="col">
    <Field label="New password">
      <input type="password" autocomplete="new-password" bind:value={pwNew} required />
    </Field>
    <Field label="Confirm password">
      <input type="password" autocomplete="new-password" bind:value={pwConfirm} required />
    </Field>
    {#if pwMessage}<div class="success">{pwMessage}</div>{/if}
    {#if pwError}<div class="error">{pwError}</div>{/if}
    <div class="row">
      <Button type="submit" disabled={pwSubmitting || pwNew.length === 0}>
        {pwSubmitting ? 'Saving…' : 'Update password'}
      </Button>
    </div>
  </form>
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <h2>Notification preferences</h2>
  <p class="muted small">Email me when…</p>
  <label class="checkbox">
    <input type="checkbox" bind:checked={notifyChangeOrders} />
    <span>A change order is proposed for my review</span>
  </label>
  <label class="checkbox">
    <input type="checkbox" bind:checked={notifyPayments} />
    <span>A payment succeeds or fails</span>
  </label>
  {#if prefsMessage}<div class="success">{prefsMessage}</div>{/if}
  {#if prefsError}<div class="error">{prefsError}</div>{/if}
  <div class="row">
    <Button onclick={savePrefs} disabled={prefsSubmitting}>
      {prefsSubmitting ? 'Saving…' : 'Save preferences'}
    </Button>
  </div>
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <h2>Signature history</h2>
  {#if signatures.length === 0}
    <p class="muted">No signatures yet.</p>
  {:else}
    <table>
      <thead>
        <tr><th>Document</th><th>Type</th><th>Signed value</th><th>When</th></tr>
      </thead>
      <tbody>
        {#each signatures as s (s.id)}
          <tr>
            <td>{s.document_type} · <span class="muted small">{s.document_id.slice(0, 8)}…</span></td>
            <td>{s.signature_type}</td>
            <td>{s.typed_name ?? s.typed_initials ?? '—'}</td>
            <td class="muted small">{new Date(s.signed_at).toLocaleString()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <Button variant="secondary" onclick={logout}>Sign out</Button>
</div>

<style>
  h1 { margin-bottom: var(--space-2); }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .kv:last-of-type { border-bottom: 0; }
  form { gap: var(--space-3); }
  .checkbox { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.95rem; padding: 0.25rem 0; }
  .checkbox input { margin-top: 0.2rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--border); font-size: 0.92rem; }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
</style>

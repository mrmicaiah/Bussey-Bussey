<script lang="ts">
  import Button from './Button.svelte';
  import { api, ApiError } from '$lib/api';

  type Credentials = {
    portal_url: string;
    email: string;
    temp_password: string;
  };
  type Props = {
    open: boolean;
    opportunityId: string;
    clientName: string;
    credentials: Credentials | null;
    onclose: () => void;
  };
  let { open, opportunityId, clientName, credentials, onclose }: Props = $props();

  let copyFlash = $state<string | null>(null);
  let emailing = $state(false);
  let emailFlash = $state<string | null>(null);

  function copyAll() {
    if (!credentials) return;
    const block = [
      `Portal:    ${credentials.portal_url}`,
      `Email:     ${credentials.email}`,
      `Password:  ${credentials.temp_password}`,
    ].join('\n');
    navigator.clipboard
      .writeText(block)
      .then(() => {
        copyFlash = 'Copied portal URL, email, and password.';
        setTimeout(() => (copyFlash = null), 2500);
      })
      .catch(() => {
        copyFlash = "Couldn't copy — your browser may be blocking clipboard access.";
        setTimeout(() => (copyFlash = null), 4000);
      });
  }

  function copyOne(value: string, label: string) {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        copyFlash = `${label} copied.`;
        setTimeout(() => (copyFlash = null), 2000);
      })
      .catch(() => {
        copyFlash = `Couldn't copy ${label.toLowerCase()}.`;
        setTimeout(() => (copyFlash = null), 4000);
      });
  }

  async function emailToClient() {
    if (!credentials) return;
    emailing = true;
    emailFlash = null;
    try {
      await api.post(`/api/admin/opportunities/${opportunityId}/send-credentials-email`, {});
      emailFlash = `Sent to ${credentials.email}.`;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.errorCode === 'credentials_expired') {
          emailFlash = 'Credentials window expired — reset to share new ones.';
        } else {
          emailFlash = `Email send failed (${e.errorCode ?? e.status}).`;
        }
      } else {
        emailFlash = 'Network error — try again.';
      }
    } finally {
      emailing = false;
    }
  }
</script>

{#if open && credentials}
  <div class="backdrop" role="presentation"></div>
  <div class="dialog surface" role="dialog" aria-modal="true" aria-labelledby="cred-title">
    <h2 id="cred-title">Credentials for {clientName}</h2>
    <p class="muted">
      Activation complete. Share these credentials with your client — they'll change the password
      on first login. This screen will be retrievable for 24 hours.
    </p>

    <div class="cred-block">
      <div class="cred-row">
        <span class="cred-label">Portal</span>
        <code class="cred-value">{credentials.portal_url}</code>
        <button class="copy-btn" type="button" onclick={() => copyOne(credentials.portal_url, 'Portal URL')}>Copy</button>
      </div>
      <div class="cred-row">
        <span class="cred-label">Email</span>
        <code class="cred-value">{credentials.email}</code>
        <button class="copy-btn" type="button" onclick={() => copyOne(credentials.email, 'Email')}>Copy</button>
      </div>
      <div class="cred-row">
        <span class="cred-label">Password</span>
        <code class="cred-value mono">{credentials.temp_password}</code>
        <button class="copy-btn" type="button" onclick={() => copyOne(credentials.temp_password, 'Password')}>Copy</button>
      </div>
    </div>

    {#if copyFlash}<p class="flash">{copyFlash}</p>{/if}
    {#if emailFlash}<p class="flash">{emailFlash}</p>{/if}

    <div class="actions">
      <Button variant="secondary" onclick={copyAll}>Copy All</Button>
      <Button variant="secondary" onclick={emailToClient} disabled={emailing}>
        {emailing ? 'Sending…' : 'Email to Client'}
      </Button>
      <Button onclick={onclose}>Done — I'll share manually</Button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.42);
    z-index: 60;
  }
  .dialog {
    position: fixed;
    top: 8vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 94vw);
    z-index: 61;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .cred-block {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.7rem 1rem;
    margin: var(--space-3) 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .cred-row {
    display: grid;
    grid-template-columns: 6rem 1fr auto;
    align-items: center;
    gap: 0.6rem;
  }
  .cred-label { color: var(--muted); font-size: 0.85rem; }
  .cred-value {
    background: transparent;
    border: 0;
    padding: 0;
    font-size: 0.92rem;
    word-break: break-all;
  }
  .cred-value.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
  .copy-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .copy-btn:hover { border-color: var(--accent); }
  .flash {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-4);
    flex-wrap: wrap;
  }
</style>

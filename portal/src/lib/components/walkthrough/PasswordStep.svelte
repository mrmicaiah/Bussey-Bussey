<script lang="ts">
  import Button from '../Button.svelte';
  import Field from '../Field.svelte';
  import { api, ApiError } from '$lib/api';

  let { onAdvance }: { onAdvance: () => Promise<void> | void } = $props();

  let newPassword = $state('');
  let confirm = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // Client-side mirror of server requirements (worker validatePasswordRequirements).
  // Server is the source of truth; this is just so the user gets feedback before
  // they submit.
  const checks = $derived([
    { ok: newPassword.length >= 10, label: 'At least 10 characters' },
    {
      ok: /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword),
      label: 'Mixed case (upper + lower)',
    },
    {
      ok: /[0-9]/.test(newPassword) || /[^A-Za-z0-9]/.test(newPassword),
      label: 'A number or symbol',
    },
    { ok: newPassword.length > 0 && newPassword === confirm, label: 'Matches confirmation' },
  ]);
  const allChecksPass = $derived(checks.every((c) => c.ok));

  const SERVER_ERROR_MESSAGES: Record<string, string> = {
    password_too_short: 'Password is too short.',
    password_needs_lowercase: 'Password needs a lowercase letter.',
    password_needs_uppercase: 'Password needs an uppercase letter.',
    password_needs_number_or_symbol: 'Password needs a number or symbol.',
    passwords_do_not_match: 'Passwords do not match.',
    state_machine_violation: 'This step is no longer available.',
  };

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = null;
    submitting = true;
    try {
      await api.post('/api/portal/auth/change-password', {
        new_password: newPassword,
        confirm,
      });
      await onAdvance();
    } catch (err) {
      if (err instanceof ApiError) {
        const code = err.errorCode;
        error =
          (code && SERVER_ERROR_MESSAGES[code]) ||
          `Couldn't set your password (${code ?? err.status}).`;
      } else {
        error = 'Network error — please try again.';
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="surface step">
  <h1>Secure your account</h1>
  <p class="muted">
    Set a permanent password. Your temporary password will stop working
    once you've changed it.
  </p>

  <form onsubmit={onSubmit} class="col">
    <Field label="New password">
      <input
        type="password"
        autocomplete="new-password"
        bind:value={newPassword}
        required
      />
    </Field>
    <Field label="Confirm password">
      <input
        type="password"
        autocomplete="new-password"
        bind:value={confirm}
        required
      />
    </Field>

    <ul class="checks">
      {#each checks as c}
        <li class:done={c.ok}>
          <span class="mark">{c.ok ? '✓' : '·'}</span>
          {c.label}
        </li>
      {/each}
    </ul>

    {#if error}<div class="error">{error}</div>{/if}

    <div class="cta">
      <Button type="submit" disabled={submitting || !allChecksPass}>
        {submitting ? 'Saving…' : 'Set password and continue'}
      </Button>
    </div>
  </form>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-4); }
  form { gap: var(--space-4); }
  .checks {
    list-style: none;
    padding: 0.6rem 0.9rem;
    margin: 0;
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .checks li.done { color: var(--success); }
  .checks .mark {
    display: inline-block;
    width: 1rem;
    text-align: center;
    font-weight: 600;
  }
  .cta { margin-top: var(--space-2); }
</style>

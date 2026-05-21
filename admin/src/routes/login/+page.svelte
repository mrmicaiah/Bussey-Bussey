<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = null;
    submitting = true;
    try {
      await api.post('/api/admin/auth/login', { email, password });
      const next = page.url.searchParams.get('next');
      goto(next && next.startsWith(`${base}/`) ? next : `${base}/`, { replaceState: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errorCode === 'rate_limited') {
          const retry = (err.body as { retry_after_seconds?: number })?.retry_after_seconds;
          error = `Too many attempts. Try again in ${retry ?? '?'}s.`;
        } else if (err.status === 401) {
          error = 'Invalid email or password.';
        } else if (err.status === 400) {
          error = 'Please provide both email and password.';
        } else {
          error = `Login failed (${err.status}).`;
        }
      } else {
        error = 'Network error.';
        console.error(err);
      }
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Sign in · Bussey Admin</title></svelte:head>

<main>
  <div class="card surface">
    <h1>Bussey · Admin</h1>
    <p class="muted small">Sign in to continue.</p>

    <form onsubmit={onSubmit} class="col">
      <Field label="Email">
        <input
          type="email"
          autocomplete="username"
          bind:value={email}
          required
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
        />
      </Field>

      {#if error}<div class="error">{error}</div>{/if}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  </div>
</main>

<style>
  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: var(--space-6);
  }
  .card {
    width: 100%;
    max-width: 380px;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  h1 { margin: 0; }
  .muted { margin: 0; }
  form { gap: var(--space-4); }
</style>

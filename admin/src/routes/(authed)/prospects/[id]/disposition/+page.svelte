<script lang="ts">
  // Studio44 Presentation room — Tab 2 (the disposition screen).
  //
  // NORMAL authed layout (full admin chrome) — this tab is opened off the
  // screen-share by the room's "Next →" button. Three outcomes: Close (runs the
  // existing /activate + credentials handoff), Follow-up (no write, back to the
  // workspace), No deal (POST /disposition {kind:'declined'}). An already-settled
  // opportunity short-circuits to a calm acknowledgement.
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import NotesField from '$lib/components/prospect-workspace/NotesField.svelte';
  import CredentialsHandoffModal from '$lib/components/CredentialsHandoffModal.svelte';
  import type { ProspectWorkspace, Opportunity } from '$lib/types';

  const id = $derived(page.params['id']!);

  let ws = $state<ProspectWorkspace | null>(null);
  let opportunity = $state<Opportunity | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  const company = $derived(ws?.prospect.company ?? '');
  const settled = $derived(
    !!opportunity && ['accepted', 'lost', 'paused'].includes(opportunity.status),
  );

  // Which card's sub-flow is open. Close & Follow-up act from their card button;
  // No deal reveals its form.
  let selected = $state<'close' | 'followup' | 'nodeal' | null>(null);

  // Close sub-flow.
  let activating = $state(false);
  let activateError = $state<string | null>(null);
  type ActivationCredentials = { portal_url: string; email: string; temp_password: string };
  let credentialsOpen = $state(false);
  let credentialsPayload = $state<ActivationCredentials | null>(null);
  let closedAck = $state(false);

  // Follow-up sub-flow.
  let followingUp = $state(false);

  // No deal sub-flow.
  const REASONS = [
    { value: 'price', label: 'Price / budget' },
    { value: 'timing', label: 'Timing — not now' },
    { value: 'not_a_fit', label: 'Not a fit' },
    { value: 'went_with_competitor', label: 'Went with a competitor' },
    { value: 'silent', label: 'Went silent' },
    { value: 'other', label: 'Other' },
  ] as const;
  type Reason = (typeof REASONS)[number]['value'];
  let reason = $state<Reason | null>(null);
  let otherText = $state('');
  let lostThreadNotes = $state('');
  let nodealConfirmOpen = $state(false);
  let marking = $state(false);
  let markError = $state<string | null>(null);
  let lostAck = $state(false);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [w, o] = await Promise.all([
        api.get<ProspectWorkspace>(`/api/admin/prospects/${id}`),
        api.get<{ opportunity: Opportunity }>(`/api/admin/opportunities/${id}`),
      ]);
      ws = w;
      opportunity = o.opportunity;
    } catch (e) {
      loadError = e instanceof ApiError ? `Couldn't load (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  // ── Close ──────────────────────────────────────────────────────────────────
  async function closeDeal() {
    if (activating) return;
    activating = true;
    activateError = null;
    try {
      const res = await api.post<{ ok: boolean; credentials: ActivationCredentials }>(
        `/api/admin/opportunities/${id}/activate`,
        {},
      );
      credentialsPayload = res.credentials;
      credentialsOpen = true;
    } catch (e) {
      activateError = e instanceof ApiError ? `Couldn't close (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      activating = false;
    }
  }
  function onCredentialsClose() {
    credentialsOpen = false;
    closedAck = true; // the deal is activated — show the "All set" screen
  }

  // ── Follow-up ────────────────────────────────────────────────────────────────
  function followUp() {
    if (followingUp) return;
    followingUp = true;
    // Brief acknowledgement, then to the workspace (no state change).
    setTimeout(() => {
      window.location.href = `${base}/prospects/${id}`;
    }, 250);
  }

  // ── No deal ──────────────────────────────────────────────────────────────────
  // Compose lost_notes: "Other: <text>" (if Other + text) joined to the thread
  // notes with " — ". Either piece may be absent; null when both are.
  function composeLostNotes(): string | null {
    const parts: string[] = [];
    if (reason === 'other' && otherText.trim()) parts.push(`Other: ${otherText.trim()}`);
    if (lostThreadNotes.trim()) parts.push(lostThreadNotes.trim());
    return parts.length ? parts.join(' — ') : null;
  }

  async function confirmNoDeal() {
    if (marking || !reason) return;
    marking = true;
    markError = null;
    try {
      await api.post(`/api/admin/opportunities/${id}/disposition`, {
        kind: 'declined',
        reason,
        lost_notes: composeLostNotes(),
      });
      nodealConfirmOpen = false;
      lostAck = true;
    } catch (e) {
      markError = e instanceof ApiError ? `Couldn't save (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      marking = false;
    }
  }
</script>

<svelte:head><title>How did it go? · {company || 'Prospect'} · Studio44</title></svelte:head>

<nav class="crumb">
  <span class="brand">Studio44</span>
  <span class="sep">/</span>
  <span>{company || '…'}</span>
  <span class="sep">/</span>
  <span class="here">How did it go?</span>
</nav>

{#if loading}
  <p class="muted">Loading…</p>
{:else if loadError}
  <div class="error">{loadError}</div>
{:else if closedAck}
  <div class="ack">
    <h1>All set</h1>
    <p>{company} is now active. The portal link is ready to send.</p>
    <a class="ack-link" href={`${base}/`}>Return to dashboard →</a>
  </div>
{:else if lostAck}
  <div class="ack">
    <h1>Marked as lost</h1>
    <p>{company} has been moved to no-deal. The reason is recorded.</p>
    <a class="ack-link" href={`${base}/`}>Return to dashboard →</a>
  </div>
{:else if settled}
  <div class="ack">
    <h1>Already dispositioned</h1>
    <p>This presentation has already been dispositioned. Status: <strong>{opportunity?.status}</strong>.</p>
    <a class="ack-link" href={`${base}/prospects/${id}`}>Return to the prospect →</a>
  </div>
{:else}
  <header class="top">
    <h1>The meeting wrapped — what happened?</h1>
    <p class="sub">Pick the outcome. You can come back to this prospect any time.</p>
  </header>

  <div class="grid">
    <!-- CLOSE — pre-emphasized -->
    <section class="card close" class:active={selected === 'close'}>
      <button type="button" class="card-head" onclick={() => (selected = 'close')}>
        <h2>Close the deal</h2>
        <p>Client said yes — let's set them up.</p>
      </button>
      {#if selected === 'close'}
        <div class="sub-flow">
          {#if activateError}<div class="error">{activateError}</div>{/if}
          <Button onclick={closeDeal} disabled={activating}>
            {activating ? 'Closing…' : 'Close & onboard'}
          </Button>
        </div>
      {/if}
    </section>

    <!-- FOLLOW-UP -->
    <section class="card followup" class:active={selected === 'followup'}>
      <button type="button" class="card-head" onclick={() => (selected = 'followup')}>
        <h2>Follow up later</h2>
        <p>Needs more time / wants to think / loop in someone.</p>
      </button>
      {#if selected === 'followup'}
        <div class="sub-flow">
          <Button variant="secondary" onclick={followUp} disabled={followingUp}>
            {followingUp ? 'Saving…' : 'Save & follow up'}
          </Button>
        </div>
      {/if}
    </section>

    <!-- NO DEAL -->
    <section class="card nodeal" class:active={selected === 'nodeal'}>
      <button type="button" class="card-head" onclick={() => (selected = 'nodeal')}>
        <h2>Mark as lost</h2>
        <p>Won't close. Let's record why.</p>
      </button>
      {#if selected === 'nodeal'}
        <div class="sub-flow">
          <div class="pills">
            {#each REASONS as r (r.value)}
              <button
                type="button"
                class="pill"
                class:selected={reason === r.value}
                onclick={() => (reason = r.value)}
              >
                {r.label}
              </button>
            {/each}
          </div>
          {#if reason === 'other'}
            <input class="other-input" type="text" placeholder="Tell me what" bind:value={otherText} />
          {/if}
          <NotesField
            label="Notes (optional)"
            hint="Anything worth remembering about why this didn't close."
            icon="📝"
            bind:value={lostThreadNotes}
          />
          {#if markError}<div class="error">{markError}</div>{/if}
          <Button variant="danger" onclick={() => (nodealConfirmOpen = true)} disabled={!reason || marking}>
            Mark as lost
          </Button>
        </div>
      {/if}
    </section>
  </div>

  <p class="foot">Close runs the existing activation — opens credentials handoff right here. Nothing fires until you pick.</p>
{/if}

<!-- No-deal danger confirm -->
{#if nodealConfirmOpen}
  <div class="backdrop" role="presentation" onclick={() => (nodealConfirmOpen = false)}></div>
  <div class="dialog surface" role="dialog" aria-modal="true" aria-labelledby="nodeal-title">
    <h2 id="nodeal-title">Mark {company} as lost?</h2>
    <p class="muted">This permanently marks the opportunity as lost. Continue?</p>
    {#if markError}<div class="error">{markError}</div>{/if}
    <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4);">
      <Button variant="secondary" onclick={() => (nodealConfirmOpen = false)} disabled={marking}>Cancel</Button>
      <Button variant="danger" onclick={confirmNoDeal} disabled={marking}>
        {marking ? 'Saving…' : 'Mark as lost'}
      </Button>
    </div>
  </div>
{/if}

<CredentialsHandoffModal
  open={credentialsOpen}
  opportunityId={id}
  clientName={company}
  credentials={credentialsPayload}
  onclose={onCredentialsClose}
/>

<style>
  .crumb { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--muted); margin-bottom: var(--space-6); }
  .crumb .brand { font-weight: 800; letter-spacing: 0.04em; color: var(--text); }
  .crumb .sep { color: var(--muted-4); }
  .crumb .here { color: var(--text); }

  .top { max-width: 720px; margin: 0 auto var(--space-6); text-align: center; }
  .top h1 { margin: 0 0 var(--space-2); font-size: 1.6rem; }
  .top .sub { margin: 0; color: var(--muted); }

  .grid { max-width: 720px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.9rem; align-items: start; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

  .card { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
  .card-head {
    display: block; width: 100%; text-align: left; cursor: pointer;
    background: transparent; border: none; font: inherit; color: var(--text);
    padding: 1rem 1.05rem;
  }
  .card-head h2 { margin: 0 0 0.3rem; font-size: 1.05rem; }
  .card-head p { margin: 0; color: var(--muted); font-size: 0.88rem; line-height: 1.4; }

  /* Close is pre-emphasized (crimson). */
  .card.close { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(212, 11, 30, 0.25), 0 6px 20px rgba(212, 11, 30, 0.12); }
  .card.close.active, .card.close:hover { border-color: var(--accent); }
  .card.followup.active, .card.followup:hover { border-color: var(--warning); }
  .card.nodeal.active, .card.nodeal:hover { border-color: var(--danger); }

  .sub-flow { padding: 0 1.05rem 1.05rem; display: flex; flex-direction: column; gap: 0.7rem; }

  .pills { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .pill {
    font: inherit; font-size: 0.8rem; cursor: pointer;
    background: var(--surface-2); color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px; padding: 0.35rem 0.7rem;
  }
  .pill:hover { color: var(--text); }
  .pill.selected { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }

  .other-input {
    width: 100%; font: inherit; font-size: 0.9rem;
    background: var(--surface-2); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius); padding: 0.5rem 0.6rem;
  }

  .foot { max-width: 720px; margin: var(--space-6) auto 0; text-align: center; color: var(--muted); font-size: 0.82rem; }

  .ack { max-width: 560px; margin: 2rem auto; text-align: center; }
  .ack h1 { margin: 0 0 var(--space-2); }
  .ack p { color: var(--muted); margin: 0 0 var(--space-4); }
  .ack-link { color: var(--accent); text-decoration: none; font-weight: 600; }
  .ack-link:hover { text-decoration: underline; }

  .muted { color: var(--muted); }

  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.42); z-index: 50; }
  .dialog {
    position: fixed; top: 22vh; left: 50%; transform: translateX(-50%);
    width: min(440px, 92vw); z-index: 51;
    display: flex; flex-direction: column; gap: var(--space-2);
  }
</style>

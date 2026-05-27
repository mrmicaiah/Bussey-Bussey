<script lang="ts">
  // Studio44 Layer 1 — the calling session card loop (§2.1 + §2.2).
  //
  // READ-ONLY: consumes the three step-2 read endpoints only
  //   GET /api/admin/leads/queue, /api/admin/leads/:id/card, /api/admin/script-variants
  // No outcome button persists anything — booking and activity logging are steps 4–5.
  // The card-dwell timer and selected-variant ids are held in client state for
  // later persistence; nothing is written here. No Alice wiring.
  //
  // The Studio44 dark palette is declared on the `.s44` wrapper below, so it is
  // SCOPED to this subtree — it does not touch app.css tokens or any other screen.
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type {
    QueueMode,
    QueueTargetKind,
    LeadQueueResponse,
    LeadQueueItem,
    CallingSession,
    LeadCardResponse,
    LeadCard,
    LeadActivity,
    ScriptVariantsResponse,
    ScriptVariantsByStage,
    ScriptVariantStage,
    NonBookingOutcome,
    LogActivityRequest,
    LogActivityResponse,
    BookingRequest,
    BookingResponse,
  } from '$lib/types';
  import SessionSetup from '$lib/components/leads-wizard/SessionSetup.svelte';
  import CallCard from '$lib/components/leads-wizard/CallCard.svelte';

  type Phase = 'setup' | 'card' | 'booking' | 'done';
  let phase = $state<Phase>('setup');

  let session = $state<CallingSession | null>(null);
  let queue = $state<LeadQueueItem[]>([]);
  let variants = $state<ScriptVariantsByStage | null>(null);
  let selected = $state<Record<ScriptVariantStage, string | null>>({
    opener: null, hook: null, discovery: null, close: null,
  });
  let index = $state(0);

  let card = $state<LeadCard | null>(null);
  let timeline = $state<LeadActivity[]>([]);

  let starting = $state(false);
  let setupError = $state<string | null>(null);
  let cardLoading = $state(false);
  let cardError = $state<string | null>(null);
  // Outcome POST in flight + inline error (failed POST must NOT advance the card).
  let posting = $state(false);
  let postError = $state<string | null>(null);

  // Scoreboard — real now: incremented on a successful booking.
  let bookedCount = $state(0);

  // Booking-step state.
  let bookScheduledAt = $state('');
  let bookingPosting = $state(false);
  let bookingError = $state<string | null>(null);
  let toast = $state<string | null>(null);

  // Card-dwell timer. One interval for the page lifetime; dwellStart resets per card.
  let dwellStart = $state(Date.now());
  let now = $state(Date.now());
  const dwellMs = $derived(now - dwellStart);

  const denom = $derived(session?.target ?? queue.length);
  const position = $derived(Math.min(index + 1, Math.max(denom, 1)));
  const progressPct = $derived(denom > 0 ? Math.min(index / denom, 1) * 100 : 0);

  function fmtMs(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const dwellLabel = $derived(fmtMs(dwellMs));

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });

  function resetDwell() {
    dwellStart = Date.now();
    now = Date.now();
  }

  function initSelected(v: ScriptVariantsByStage) {
    selected = {
      opener: v.opener[0]?.id ?? null,
      hook: v.hook[0]?.id ?? null,
      discovery: v.discovery[0]?.id ?? null,
      close: v.close[0]?.id ?? null,
    };
  }

  async function startSession(opts: { mode: QueueMode; target_kind: QueueTargetKind; target: number }) {
    if (starting) return;
    starting = true;
    setupError = null;
    try {
      const qs = `?mode=${opts.mode}&target_kind=${opts.target_kind}&target=${opts.target}`;
      const [q, sv] = await Promise.all([
        api.get<LeadQueueResponse>(`/api/admin/leads/queue${qs}`),
        api.get<ScriptVariantsResponse>('/api/admin/script-variants'),
      ]);
      session = q.session;
      queue = q.queue;
      variants = sv.variants;
      initSelected(sv.variants);
      index = 0;
      if (queue.length === 0) {
        phase = 'done';
      } else {
        phase = 'card';
        await loadCard();
      }
    } catch (e) {
      setupError = e instanceof ApiError ? `Couldn't start (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      starting = false;
    }
  }

  async function loadCard() {
    const item = queue[index];
    if (!item) return;
    cardLoading = true;
    cardError = null;
    card = null;
    timeline = [];
    postError = null;
    resetDwell();
    try {
      const res = await api.get<LeadCardResponse>(`/api/admin/leads/${item.id}/card`);
      card = res.card;
      timeline = res.timeline;
    } catch (e) {
      cardError = e instanceof ApiError ? `Couldn't load card (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      cardLoading = false;
    }
  }

  function onpick(stage: ScriptVariantStage, variantId: string) {
    selected = { ...selected, [stage]: variantId };
  }

  function advance() {
    const next = index + 1;
    if (next >= queue.length) {
      phase = 'done';
    } else {
      index = next;
      phase = 'card';
      void loadCard();
    }
  }

  // Non-booking outcomes (and skip) persist via the step-4 activity endpoint, then
  // advance ON SUCCESS only. Card dwell is snapshotted at click. A failed POST shows
  // an inline error and does NOT advance — nothing is silently lost.
  async function logOutcome(outcome: NonBookingOutcome, extra?: { next_followup_at?: string }) {
    if (posting || !card) return;
    posting = true;
    postError = null;
    const dwell = dwellMs; // snapshot the dwell timer at the moment of the outcome
    try {
      const reqBody: LogActivityRequest = {
        outcome,
        session_id: session?.id ?? null,
        card_dwell_ms: dwell,
        opener_variant_id: selected.opener,
        hook_variant_id: selected.hook,
        discovery_variant_id: selected.discovery,
        close_variant_id: selected.close,
        next_followup_at: extra?.next_followup_at ?? null,
      };
      await api.post<LogActivityResponse>(`/api/admin/leads/${card.id}/activity`, reqBody);
      advance();
    } catch (e) {
      postError = e instanceof ApiError ? `Couldn't log (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      posting = false;
    }
  }

  function handleBook() {
    bookScheduledAt = '';
    bookingError = null;
    phase = 'booking';
  }

  function localDatetime(daysAhead: number, hour = 10): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // The money moment: one atomic POST → silent Lead→Prospect + assessment #1.
  // Tick the scoreboard + advance ON SUCCESS; on failure show an inline error and
  // do NOT advance (mirrors the step-4 no-silent-loss behavior).
  async function confirmBooking() {
    if (bookingPosting || !card || !bookScheduledAt) return;
    bookingPosting = true;
    bookingError = null;
    const dwell = dwellMs; // real card→book dwell
    try {
      const reqBody: BookingRequest = {
        scheduled_at: bookScheduledAt,
        session_id: session?.id ?? null,
        card_dwell_ms: dwell,
        opener_variant_id: selected.opener,
        hook_variant_id: selected.hook,
        discovery_variant_id: selected.discovery,
        close_variant_id: selected.close,
      };
      await api.post<BookingResponse>(`/api/admin/leads/${card.id}/book`, reqBody);
      bookedCount += 1;
      toast = 'Assessment booked.';
      setTimeout(() => (toast = null), 2500);
      bookScheduledAt = '';
      advance(); // straight back into the loop, next card
    } catch (e) {
      bookingError = e instanceof ApiError ? `Couldn't book (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      bookingPosting = false;
    }
  }

  function endSession() {
    phase = 'setup';
    session = null;
    queue = [];
    card = null;
    timeline = [];
    index = 0;
    bookedCount = 0;
  }
</script>

<svelte:head><title>Work leads · Studio44</title></svelte:head>

<div class="s44">
  {#if phase === 'setup'}
    <SessionSetup onstart={startSession} loading={starting} error={setupError} />
  {:else if phase === 'done'}
    <div class="done">
      <div class="brand">Studio44</div>
      <h1>Session complete</h1>
      <p>
        {#if queue.length === 0}
          No leads matched this session. Try the other mode, or import more leads.
        {:else}
          You worked {queue.length} {queue.length === 1 ? 'lead' : 'leads'} · {bookedCount} booked.
        {/if}
      </p>
      <div class="done-actions">
        <button type="button" class="primary" onclick={endSession}>Start another session</button>
        <a class="ghost" href={`${base}/leads`}>Back to leads</a>
      </div>
    </div>
  {:else}
    <!-- card + booking phases share the session header -->
    <header class="s44-head">
      <div class="head-left">
        <span class="brand">Studio44</span>
        <span class="mode">{session?.mode === 'cold' ? 'Cold calling session' : 'Follow-ups'}</span>
      </div>
      <div class="head-mid">
        <div class="progress-line">
          <span>{position} / {Math.max(denom, 1)}</span>
          <span class="score">{bookedCount}{session?.target_kind === 'book' ? ` / ${session?.target ?? '–'}` : ''} booked</span>
          <span class="dwell">card time {dwellLabel}</span>
        </div>
        <div class="bar"><div class="bar-fill" style={`width:${progressPct}%`}></div></div>
      </div>
      <button type="button" class="end" onclick={endSession}>End session</button>
    </header>

    {#if phase === 'card'}
      {#if cardLoading}
        <p class="loading">Loading card…</p>
      {:else if cardError}
        <div class="cardErr">{cardError} <button type="button" onclick={loadCard}>Retry</button> · <button type="button" onclick={advance}>Skip</button></div>
      {:else if card && variants}
        <CallCard
          {card}
          {timeline}
          {variants}
          {selected}
          {onpick}
          onoutcome={logOutcome}
          onbook={handleBook}
          onskip={() => logOutcome('skipped')}
          {dwellLabel}
          busy={posting}
          error={postError}
        />
      {/if}
    {:else if phase === 'booking'}
      <div class="booking">
        <h2>Book the assessment{card?.company ? ` · ${card.company}` : ''}</h2>
        <p class="booking-lede">Just pick a time. The rest happens for you.</p>

        <div class="book-field">
          <span class="book-label">When</span>
          <div class="book-quick">
            <button type="button" onclick={() => (bookScheduledAt = localDatetime(1, 10))} disabled={bookingPosting}>Tomorrow 10am</button>
            <button type="button" onclick={() => (bookScheduledAt = localDatetime(2, 14))} disabled={bookingPosting}>In 2 days, 2pm</button>
          </div>
          <input type="datetime-local" bind:value={bookScheduledAt} disabled={bookingPosting} aria-label="Assessment date and time" />
        </div>

        <!-- Value is Alice's job (L4) — dormant, not an operator input. -->
        <div class="alice-value" aria-label="Deal value (inactive)">
          <div class="av-head"><span class="av-tag">Value</span><span class="av-l4">Alice · L4</span></div>
          <p class="av-note">Alice derives the deal value from the rate card after the assessment. Not your call to make here.</p>
        </div>

        <!-- Reassurance, not steps. Never framed as operator actions. -->
        <div class="behind">
          <div class="behind-title">Happening behind the scenes</div>
          <ul>
            <li>This lead becomes a <strong>prospect</strong></li>
            <li>Their workspace is set up</li>
            <li>Assessment #1 is placed on the calendar</li>
          </ul>
        </div>

        {#if bookingError}<div class="cardErr">{bookingError}</div>{/if}

        <div class="booking-actions">
          <button type="button" class="ghost" onclick={() => (phase = 'card')} disabled={bookingPosting}>← Back to the call</button>
          <button type="button" class="primary" onclick={confirmBooking} disabled={bookingPosting || !bookScheduledAt}>
            {bookingPosting ? 'Booking…' : 'Confirm booking & next lead'}
          </button>
        </div>
      </div>
    {/if}

    {#if toast}<div class="toast">{toast}</div>{/if}
  {/if}
</div>

<style>
  /* Studio44 dark palette — declared HERE so it is scoped to this subtree only.
     app.css tokens (--accent navy, etc.) and all other screens are untouched. */
  .s44 {
    --s44-bg: #0a0a0b;
    --s44-surface: #141416;
    --s44-surface-2: #1c1c1f;
    --s44-border: #2a2a2e;
    --s44-crimson: #d40b1e;
    --s44-text: #f4f4f5;
    --s44-muted: #a1a1aa;
    --s44-amber: #f5a623;

    background: var(--s44-bg);
    color: var(--s44-text);
    border: 1px solid var(--s44-border);
    border-radius: 12px;
    padding: 1.25rem;
    min-height: 70vh;
  }

  .brand { font-weight: 800; letter-spacing: 0.04em; color: var(--s44-text); }

  .s44-head {
    display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;
    padding-bottom: 0.9rem; border-bottom: 1px solid var(--s44-border);
  }
  .head-left { display: flex; flex-direction: column; gap: 0.1rem; }
  .head-left .mode { color: var(--s44-muted); font-size: 0.8rem; }
  .head-mid { flex: 1; }
  .progress-line { display: flex; gap: 1rem; align-items: baseline; color: var(--s44-text); font-size: 0.9rem; }
  .progress-line .score { color: var(--s44-crimson); font-weight: 700; }
  .progress-line .dwell { margin-left: auto; color: var(--s44-muted); font-variant-numeric: tabular-nums; }
  .bar { margin-top: 0.4rem; height: 3px; background: var(--s44-surface-2); border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--s44-crimson); transition: width 0.2s ease; }
  .end {
    background: transparent; border: 1px solid var(--s44-border); color: var(--s44-muted);
    border-radius: 8px; padding: 0.4rem 0.7rem; font: inherit; font-size: 0.82rem; cursor: pointer;
  }
  .end:hover { color: var(--s44-text); border-color: var(--s44-muted); }

  .loading { color: var(--s44-muted); }
  .cardErr {
    background: rgba(212, 11, 30, 0.12); border: 1px solid var(--s44-crimson);
    color: #fca5a5; border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.9rem;
  }
  .cardErr button { background: none; border: none; color: var(--s44-crimson); cursor: pointer; font: inherit; text-decoration: underline; }

  .booking { max-width: 560px; }
  .booking h2 { color: var(--s44-text); margin: 0 0 0.25rem; }
  .booking-lede { color: var(--s44-muted); margin: 0 0 1.25rem; }

  .book-field { margin-bottom: 1.1rem; }
  .book-label { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--s44-muted); margin-bottom: 0.5rem; }
  .book-quick { display: flex; gap: 0.5rem; margin-bottom: 0.6rem; }
  .book-quick button {
    flex: 1; cursor: pointer; font: inherit; font-size: 0.85rem;
    background: var(--s44-surface-2); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 8px; padding: 0.55rem;
  }
  .book-quick button:hover { border-color: var(--s44-crimson); }
  .book-quick button:disabled { opacity: 0.55; cursor: not-allowed; }
  .book-field input {
    width: 100%; font: inherit; background: var(--s44-surface); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 8px; padding: 0.5rem 0.6rem;
  }

  .alice-value {
    border: 1px dashed var(--s44-border); border-radius: 10px; padding: 0.8rem 0.9rem; margin-bottom: 1.1rem;
    background: repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.012) 8px, rgba(255,255,255,0.012) 16px);
  }
  .av-head { display: flex; align-items: baseline; gap: 0.5rem; }
  .av-tag { font-weight: 700; color: var(--s44-text); }
  .av-l4 { font-size: 0.72rem; color: var(--s44-muted); border: 1px solid var(--s44-border); border-radius: 999px; padding: 0.05rem 0.45rem; }
  .av-note { margin: 0.35rem 0 0; color: var(--s44-muted); font-size: 0.82rem; line-height: 1.45; }

  .behind { border: 1px solid var(--s44-border); border-radius: 10px; padding: 0.8rem 0.9rem; background: var(--s44-surface); margin-bottom: 1.1rem; }
  .behind-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--s44-muted); margin-bottom: 0.4rem; }
  .behind ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .behind li { color: var(--s44-muted); font-size: 0.88rem; }
  .behind strong { color: var(--s44-crimson); }

  .booking-actions { display: flex; justify-content: space-between; margin-top: 0.5rem; gap: 0.8rem; }

  .toast {
    position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 60;
    background: var(--s44-crimson); color: #fff; font-weight: 600; font-size: 0.9rem;
    padding: 0.6rem 1rem; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }

  .done { max-width: 520px; }
  .done h1 { color: var(--s44-text); margin: 0.5rem 0 0.4rem; }
  .done p { color: var(--s44-muted); }
  .done-actions { display: flex; gap: 0.8rem; align-items: center; margin-top: 1.2rem; }

  .primary {
    background: var(--s44-crimson); color: #fff; border: none; border-radius: 8px;
    padding: 0.6rem 1rem; font: inherit; font-weight: 700; cursor: pointer;
  }
  .primary:hover { filter: brightness(1.1); }
  .ghost {
    background: transparent; border: 1px solid var(--s44-border); color: var(--s44-text);
    border-radius: 8px; padding: 0.6rem 1rem; font: inherit; cursor: pointer; text-decoration: none;
  }
  .ghost:hover { border-color: var(--s44-muted); }
</style>

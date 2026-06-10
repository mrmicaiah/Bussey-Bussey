<script lang="ts">
  // Studio44 Calls layer — the cold-call wizard (§4.2 session start + §4.3 card loop).
  //
  // READ-ONLY this step. Consumes step-2's two read endpoints
  //   GET /api/admin/calls/funnel-vital, GET /api/admin/calls/queue
  // plus the existing GET /api/admin/script-variants (Layer 1) for opener variants.
  // NOTHING is persisted: the "Log & next" button is intentionally disabled — the
  // log endpoint ships in step 4. Outcome / next-move / notes / card-dwell are held
  // in client state only, mirroring the leads wizard's pre-persistence shape.
  //
  // The Studio44 dark palette is declared on the `.s44` wrapper, SCOPED to this
  // subtree (it does not touch app.css tokens or any other screen) — same as
  // /leads/work.
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type {
    CallQueueCard,
    CallQueueResponse,
    CallQueueMode,
    CallFunnelVitalResponse,
    CallLogResponse,
    ScriptVariantsResponse,
    ScriptVariantWithUsage,
  } from '$lib/types';
  import { addBusinessDays, toDateInputValue } from '$lib/business-days';

  type Phase = 'setup' | 'card' | 'done';
  type NextMove = 'pass' | 'retry' | 'promote' | 'book';

  // The 8 call outcomes (§4.3 mockup). Spoke-* outcomes require a note.
  const OUTCOMES: { value: string; label: string }[] = [
    { value: 'voicemail', label: 'Voicemail' },
    { value: 'no_answer', label: 'No answer' },
    { value: 'gatekeeper', label: 'Gatekeeper' },
    { value: 'spoke_qualified', label: 'Spoke — qualified' },
    { value: 'spoke_interested', label: 'Spoke — interested' },
    { value: 'spoke_not_interested', label: 'Spoke — not interested' },
    { value: 'spoke_callback_later', label: 'Spoke — callback later' },
    { value: 'wrong_number', label: 'Wrong number' },
    { value: 'disconnected', label: 'Disconnected' },
  ];

  const NEXT_MOVES: { value: NextMove; label: string }[] = [
    { value: 'pass', label: 'Pass / Disqualify' },
    { value: 'retry', label: 'Retry later' },
    { value: 'promote', label: 'Promote to lead' },
    { value: 'book', label: 'Book assessment NOW →' },
  ];

  const ATTEMPT_CAP = 8;

  let phase = $state<Phase>('setup');

  // ── Setup-screen data (fetched once on mount) ─────────────────────────────
  let vital = $state<CallFunnelVitalResponse | null>(null);
  // The full mixed-eligible set, used to (a) extract the industry dropdown and
  // (b) gate the Start button by an EXACT, industry-aware mode count without an
  // extra round-trip. mode=mixed returns cold (attempt_count=0) ∪ callbacks-due.
  let allMixedCards = $state<CallQueueCard[]>([]);
  let openerVariants = $state<ScriptVariantWithUsage[]>([]);
  let loadingSetup = $state(true);
  let setupError = $state<string | null>(null);

  // ── Setup-screen selections ───────────────────────────────────────────────
  let mode = $state<CallQueueMode>('mixed');
  let industry = $state<string>(''); // '' = all industries
  let pushTarget = $state<string>(''); // display-only goal; gates nothing
  let starting = $state(false);
  let startError = $state<string | null>(null);

  // ── Active session ────────────────────────────────────────────────────────
  let queue = $state<CallQueueCard[]>([]);
  let index = $state(0);

  // ── Per-card working state (reset on each card) ───────────────────────────
  let outcome = $state<string | null>(null);
  let nextMove = $state<NextMove | null>(null);
  let nextActionDate = $state<string>('');
  let notes = $state<string>('');
  let selectedVariantId = $state<string | null>(null);
  let showScript = $state(false);
  let showAllAttempts = $state(false);
  let dwellStart = $state(Date.now());
  let scheduledAt = $state<string>(''); // datetime-local "YYYY-MM-DDTHH:mm"; book only
  let logging = $state(false);
  let logError = $state<string | null>(null);

  // datetime-local default: tomorrow at 10:00 AM local (sensible starting point).
  function defaultScheduledAt(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const currentCard = $derived<CallQueueCard | null>(queue[index] ?? null);
  const count = $derived(queue.length);
  const selectedVariant = $derived<ScriptVariantWithUsage | null>(
    openerVariants.find((v) => v.id === selectedVariantId) ?? null,
  );
  const notesRequired = $derived(outcome?.startsWith('spoke_') ?? false);
  const showRetryDate = $derived(nextMove === 'retry');
  const atCap = $derived((currentCard?.attempt_count ?? 0) >= ATTEMPT_CAP);

  // The log button is enabled only once the payload is server-valid: an outcome,
  // a next-move, a retry date when retrying, a future scheduled_at when booking,
  // and a note for spoke_* outcomes.
  const showBookSchedule = $derived(nextMove === 'book');
  const scheduledAtValid = $derived(
    scheduledAt !== '' && new Date(scheduledAt).getTime() > Date.now(),
  );
  const canLog = $derived(
    outcome !== null &&
      nextMove !== null &&
      (nextMove !== 'retry' || nextActionDate !== '') &&
      (nextMove !== 'book' || scheduledAtValid) &&
      (!notesRequired || notes.trim() !== ''),
  );

  const industries = $derived(
    Array.from(
      new Set(allMixedCards.map((c) => c.industry).filter((x): x is string => !!x)),
    ).sort((a, b) => a.localeCompare(b)),
  );

  // Exact eligible count for the selected (mode, industry), from allMixedCards.
  const currentModeCount = $derived(eligibleCount(mode, industry));

  function eligibleCount(m: CallQueueMode, ind: string): number {
    return allMixedCards.filter((c) => {
      if (ind && c.industry !== ind) return false;
      if (m === 'cold') return c.attempt_count === 0;
      if (m === 'callbacks') return c.attempt_count > 0;
      return true; // mixed
    }).length;
  }

  onMount(async () => {
    loadingSetup = true;
    setupError = null;
    try {
      const [v, q, sv] = await Promise.all([
        api.get<CallFunnelVitalResponse>('/api/admin/calls/funnel-vital'),
        api.get<CallQueueResponse>('/api/admin/calls/queue?mode=mixed&limit=200'),
        api.get<ScriptVariantsResponse>('/api/admin/script-variants'),
      ]);
      vital = v;
      allMixedCards = q.cards;
      openerVariants = sv.variants.opener;
    } catch (e) {
      setupError =
        e instanceof ApiError ? `Couldn't load (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loadingSetup = false;
    }
  });

  function resetCardState() {
    outcome = null;
    nextMove = null;
    nextActionDate = '';
    notes = '';
    showScript = false;
    showAllAttempts = false;
    selectedVariantId = openerVariants[0]?.id ?? null;
    dwellStart = Date.now();
    scheduledAt = defaultScheduledAt();
    logging = false;
    logError = null;
  }

  async function startSession() {
    if (starting || currentModeCount === 0) return;
    starting = true;
    startError = null;
    try {
      const params = new URLSearchParams({ mode, limit: '200' });
      if (industry) params.set('industry', industry);
      const q = await api.get<CallQueueResponse>(`/api/admin/calls/queue?${params.toString()}`);
      queue = q.cards;
      index = 0;
      if (queue.length === 0) {
        phase = 'done';
      } else {
        resetCardState();
        phase = 'card';
      }
    } catch (e) {
      startError =
        e instanceof ApiError ? `Couldn't start (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      starting = false;
    }
  }

  function selectOutcome(value: string) {
    outcome = value;
    applyPrefill(value);
  }

  // §4.4 outcome → next-move + next_action_date defaults. Operator overrides freely.
  function applyPrefill(value: string) {
    const today = new Date();
    switch (value) {
      case 'voicemail':
        nextMove = 'retry';
        nextActionDate = toDateInputValue(addBusinessDays(today, 2));
        break;
      case 'no_answer':
        nextMove = 'retry';
        nextActionDate = toDateInputValue(addBusinessDays(today, 1));
        break;
      case 'gatekeeper':
        nextMove = 'retry';
        nextActionDate = toDateInputValue(addBusinessDays(today, 3));
        break;
      case 'spoke_callback_later':
        nextMove = 'retry';
        nextActionDate = ''; // operator picks the date
        break;
      case 'spoke_qualified':
        // Softened default: 'promote', not 'book'. Booking fires a client +
        // opportunity transaction — too heavy to pre-arm. The operator picks
        // "Book assessment NOW" deliberately; qualified just defaults to a lead.
        nextMove = 'promote';
        nextActionDate = '';
        break;
      case 'spoke_interested':
        nextMove = 'promote';
        nextActionDate = '';
        break;
      case 'spoke_not_interested':
      case 'wrong_number':
      case 'disconnected':
        nextMove = 'pass';
        nextActionDate = '';
        break;
      default:
        break;
    }
  }

  function advance() {
    const next = index + 1;
    if (next >= queue.length) {
      phase = 'done';
    } else {
      index = next;
      resetCardState();
    }
  }

  function skipCard() {
    advance();
  }

  // Step 4: persist the outcome + next-move, then advance. card_dwell_ms (the
  // Alice attribution hook) rides the payload as a snapshot of time-on-card.
  async function logAndNext() {
    if (logging || !canLog || !currentCard) return;
    logging = true;
    logError = null;
    try {
      await api.post<CallLogResponse>(`/api/admin/calls/${currentCard.id}/log`, {
        outcome,
        next_move: nextMove,
        next_action_date: nextMove === 'retry' ? nextActionDate : null,
        notes: notes.trim() === '' ? null : notes.trim(),
        script_variant_id: selectedVariantId,
        card_dwell_ms: Date.now() - dwellStart,
        // datetime-local is "YYYY-MM-DDTHH:mm" (local) → normalize to ISO 8601 UTC.
        scheduled_at: nextMove === 'book' ? new Date(scheduledAt).toISOString() : null,
      });
      advance();
    } catch (e) {
      logError =
        e instanceof ApiError ? `Couldn't log (${e.errorCode ?? e.status}).` : 'Network error.';
      logging = false;
    }
  }

  function endSession() {
    if (outcome !== null && !confirm('Discard the outcome you selected for this card?')) return;
    phase = 'setup';
    queue = [];
    index = 0;
    resetCardState();
  }

  function switchToCallbacks() {
    mode = 'callbacks';
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  function fmtImported(s: string): string {
    try {
      return new Date(s).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return s;
    }
  }

  function fmtAttempt(s: string): string {
    try {
      const d = new Date(s);
      const datePart = toDateInputValue(d); // YYYY-MM-DD local
      let h = d.getHours();
      const m = d.getMinutes();
      const ap = h >= 12 ? 'pm' : 'am';
      h = h % 12;
      if (h === 0) h = 12;
      return `${datePart}, ${h}:${String(m).padStart(2, '0')}${ap}`;
    } catch {
      return s;
    }
  }
</script>

<svelte:head><title>Work calls · Studio44</title></svelte:head>

<div class="s44">
  {#if phase === 'setup'}
    <!-- ═══ STATE 1 — session start ═══ -->
    <div class="setup">
      <div class="brand">Studio44</div>
      <h1>Calls</h1>
      <p class="subhead">Cold-call calling cards. Each call adds to the card's history.</p>

      {#if loadingSetup}
        <p class="loading">Loading your queue…</p>
      {:else if setupError}
        <div class="cardErr">{setupError}</div>
      {:else}
        <!-- Funnel-vitals row -->
        <div class="vitals">
          <div class="vital-num">{vital?.count ?? 0}</div>
          <div class="vital-body">
            <div class="vital-label">cards in your queue</div>
            <div class="vital-sub">{vital?.subline ?? ''}</div>
          </div>
        </div>

        {#if (vital?.count ?? 0) === 0}
          <!-- Empty queue, all modes (§4.7) -->
          <div class="empty">
            <p>No calls to make.</p>
            <a class="primary" href={`${base}/calling-list/import`}>Import a list →</a>
          </div>
        {:else}
          <!-- Mode picker -->
          <div class="field">
            <span class="field-label">Mode</span>
            <div class="pills">
              <button
                type="button"
                class="pill"
                class:active={mode === 'cold'}
                onclick={() => (mode = 'cold')}>Fresh cold</button
              >
              <button
                type="button"
                class="pill"
                class:active={mode === 'callbacks'}
                onclick={() => (mode = 'callbacks')}>Callbacks due</button
              >
              <button
                type="button"
                class="pill"
                class:active={mode === 'mixed'}
                onclick={() => (mode = 'mixed')}>Mixed</button
              >
            </div>
          </div>

          <!-- Fresh-cold empty but callbacks waiting (§4.7) -->
          {#if mode === 'cold' && (vital?.never_called_count ?? 0) === 0 && (vital?.callbacks_due_today_count ?? 0) > 0}
            <div class="inline-note">
              No fresh cold calls. You have {vital?.callbacks_due_today_count} callbacks due —
              <button type="button" class="link" onclick={switchToCallbacks}
                >Switch to Callbacks mode</button
              >
            </div>
          {/if}

          <!-- Industry filter -->
          <div class="field">
            <span class="field-label">Industry</span>
            <select bind:value={industry} aria-label="Industry filter">
              <option value="">All industries</option>
              {#each industries as ind (ind)}
                <option value={ind}>{ind}</option>
              {/each}
            </select>
          </div>

          <!-- Push target (display goal only) -->
          <div class="field">
            <span class="field-label">Target (optional)</span>
            <input
              type="number"
              min="1"
              bind:value={pushTarget}
              placeholder="Calls this session"
              aria-label="Push target"
            />
          </div>

          {#if startError}<div class="cardErr">{startError}</div>{/if}

          <div class="setup-actions">
            <button
              type="button"
              class="primary"
              onclick={startSession}
              disabled={starting || currentModeCount === 0}
              title={currentModeCount === 0 ? 'No cards match this mode / industry' : ''}
            >
              {starting ? 'Starting…' : `Start session (${currentModeCount})`}
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {:else if phase === 'done'}
    <!-- ═══ Terminal — session complete (§4.7) ═══ -->
    <div class="done">
      <div class="brand">Studio44</div>
      <h1>Session complete</h1>
      <p>
        {#if count === 0}
          No cards matched this session. Try another mode, or import a new list.
        {:else}
          {count} {count === 1 ? 'card' : 'cards'} worked.
        {/if}
      </p>
      <div class="done-actions">
        <button type="button" class="primary" onclick={endSession}>Start another session</button>
        <a class="ghost" href={`${base}/`}>Return to dashboard →</a>
      </div>
    </div>
  {:else if currentCard}
    <!-- ═══ STATE 2 — card loop ═══ -->
    <header class="s44-head">
      <button type="button" class="end" onclick={endSession}>← End session</button>
      <div class="head-mid">Card {index + 1} of {count}</div>
      <span class="station">Calls station</span>
    </header>

    <div class="card">
      <!-- Identity -->
      <h2 class="company">{currentCard.company_name}</h2>
      <div class="meta">
        {[currentCard.industry, currentCard.source, currentCard.imported_at ? `imported ${fmtImported(currentCard.imported_at)}` : null]
          .filter(Boolean)
          .join(' · ')}
      </div>

      <!-- Contact block -->
      <div class="surface">
        {#if currentCard.contact_name}<div class="row">Contact: {currentCard.contact_name}</div>{/if}
        {#if currentCard.contact_phone}
          <div class="row">Phone: <a class="tel" href={`tel:${currentCard.contact_phone}`}>{currentCard.contact_phone}</a></div>
        {/if}
        {#if currentCard.contact_email}<div class="row">Email: {currentCard.contact_email}</div>{/if}
        {#if currentCard.notes}<div class="row notes-import">Notes (from import): {currentCard.notes}</div>{/if}
      </div>

      <!-- Attempt history (only if previously attempted) -->
      {#if currentCard.attempt_count > 0}
        <div class="section-label">ATTEMPT {currentCard.attempt_count + 1} OF {ATTEMPT_CAP}</div>
        {#if currentCard.prior_attempts.length > 0}
          {@const last = currentCard.prior_attempts[0]}
          <div class="surface">
            <div class="row">Last call — {fmtAttempt(last.created_at)}</div>
            <div class="row">Outcome: {last.outcome ?? '—'}</div>
            {#if last.notes}<div class="row">Note: {last.notes}</div>{/if}
          </div>
          {#if currentCard.prior_attempts.length > 1}
            <button type="button" class="link" onclick={() => (showAllAttempts = !showAllAttempts)}>
              {showAllAttempts ? 'Hide' : `Show all ${currentCard.prior_attempts.length}`} prior attempts {showAllAttempts ? '↑' : '↓'}
            </button>
            {#if showAllAttempts}
              <div class="surface stacked">
                {#each currentCard.prior_attempts.slice(1) as a (a.id)}
                  <div class="attempt-row">
                    <div class="row">{fmtAttempt(a.created_at)} — {a.outcome ?? '—'}</div>
                    {#if a.notes}<div class="row sub">Note: {a.notes}</div>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {/if}
      {/if}

      <!-- Framework prompt (opener only for cold; informational) -->
      <div class="divider">Framework prompt</div>
      <div class="section-label">Stage 1 of 3 — Opener</div>
      <div class="field">
        <select bind:value={selectedVariantId} aria-label="Opener variant">
          {#if openerVariants.length === 0}
            <option value={null}>No opener variants</option>
          {/if}
          {#each openerVariants as v (v.id)}
            <option value={v.id}>{v.label ?? v.body.slice(0, 48)}</option>
          {/each}
        </select>
        {#if selectedVariant}
          <button type="button" class="link" onclick={() => (showScript = !showScript)}>
            {showScript ? 'Hide script ↑' : 'Show script ↓'}
          </button>
          {#if showScript}
            <div class="surface script">{selectedVariant.body}</div>
          {/if}
        {/if}
      </div>

      <!-- Outcome selector -->
      <div class="divider">Outcome selector</div>
      <div class="section-label">What happened?</div>
      <div class="pills wrap">
        {#each OUTCOMES as o (o.value)}
          <button
            type="button"
            class="pill"
            class:active={outcome === o.value}
            onclick={() => selectOutcome(o.value)}>{o.label}</button
          >
        {/each}
      </div>

      <!-- Next-move selector (enabled once an outcome is picked) -->
      {#if outcome}
        <div class="divider">What to do with this card?</div>

        {#if atCap}
          <div class="cap-note">
            {ATTEMPT_CAP} attempts, no contact — consider parking this card (Pass / Disqualify).
          </div>
        {/if}

        <div class="pills wrap">
          {#each NEXT_MOVES as nm (nm.value)}
            <button
              type="button"
              class="pill"
              class:active={nextMove === nm.value}
              onclick={() => (nextMove = nm.value)}>{nm.label}</button
            >
          {/each}
        </div>

        {#if showRetryDate}
          <div class="field inline">
            <span class="field-label">Next action date</span>
            <input type="date" bind:value={nextActionDate} aria-label="Next action date" />
          </div>
        {/if}

        <!-- Notes -->
        <div class="field">
          <span class="field-label">
            Notes{#if notesRequired}<span class="req"> · required</span>{/if}
          </span>
          <textarea
            bind:value={notes}
            maxlength="280"
            rows="2"
            placeholder="What happened that matters"
            aria-label="Call notes"
          ></textarea>
        </div>
      {/if}

      <!-- Assessment scheduling — revealed only when booking (§ step-4 revision) -->
      {#if showBookSchedule}
        <div class="field book-schedule">
          <span class="field-label">When is the assessment scheduled?</span>
          <input
            type="datetime-local"
            bind:value={scheduledAt}
            aria-label="Assessment scheduled date and time"
          />
          <p class="caption">
            This creates the assessment record. You can adjust the time later in the prospect
            workspace if needed.
          </p>
          {#if scheduledAt !== '' && !scheduledAtValid}
            <p class="caption warn">Pick a date and time in the future.</p>
          {/if}
        </div>
      {/if}

      {#if logError}<div class="cardErr">{logError}</div>{/if}

      <!-- Action buttons -->
      <div class="card-actions">
        <button type="button" class="ghost" onclick={skipCard} disabled={logging}>Skip card</button>
        <button
          type="button"
          class="primary"
          onclick={logAndNext}
          disabled={!canLog || logging}
          title={!canLog ? 'Pick an outcome, a next move, and any required note/date' : ''}
        >
          {logging ? 'Logging…' : 'Log & next →'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Studio44 dark palette — scoped to this subtree only (mirrors /leads/work). */
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
  h1 { color: var(--s44-text); margin: 0.4rem 0 0.3rem; font-size: 1.9rem; }
  h2 { color: var(--s44-text); }
  .subhead { color: var(--s44-muted); margin: 0 0 1.25rem; }
  .loading { color: var(--s44-muted); }

  .cardErr {
    background: rgba(212, 11, 30, 0.12); border: 1px solid var(--s44-crimson);
    color: #fca5a5; border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.9rem; margin: 0.6rem 0;
  }

  /* ── Setup screen ── */
  .setup { max-width: 560px; }
  .vitals {
    display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;
    background: var(--s44-surface); border: 1px solid var(--s44-border);
    border-radius: 10px; padding: 1rem 1.1rem;
  }
  .vital-num { font-size: 2.4rem; font-weight: 800; color: var(--s44-crimson); line-height: 1; }
  .vital-label { color: var(--s44-text); font-weight: 600; }
  .vital-sub { color: var(--s44-muted); font-size: 0.85rem; margin-top: 0.15rem; }

  .field { margin-bottom: 1.1rem; }
  .field.inline { max-width: 240px; }
  .field-label {
    display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--s44-muted); margin-bottom: 0.5rem;
  }
  .req { color: var(--s44-amber); text-transform: none; letter-spacing: 0; }

  /* Inputs need explicit surface + text (UA defaults render white-on-dark otherwise). */
  select, input, textarea {
    width: 100%; font: inherit;
    background: var(--s44-surface); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 8px; padding: 0.5rem 0.6rem;
  }
  textarea { resize: vertical; }
  select:focus, input:focus, textarea:focus { outline: none; border-color: var(--s44-crimson); }

  .pills { display: flex; gap: 0.5rem; }
  .pills.wrap { flex-wrap: wrap; }
  .pill {
    cursor: pointer; font: inherit; font-size: 0.85rem;
    background: var(--s44-surface-2); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 8px; padding: 0.5rem 0.8rem;
  }
  .pill:hover { border-color: var(--s44-muted); }
  .pill.active { background: var(--s44-crimson); border-color: var(--s44-crimson); color: #fff; font-weight: 600; }

  .inline-note {
    background: var(--s44-surface); border: 1px solid var(--s44-amber);
    color: var(--s44-text); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.86rem; margin-bottom: 1.1rem;
  }
  .link { background: none; border: none; color: var(--s44-crimson); cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }

  .empty { color: var(--s44-muted); display: flex; flex-direction: column; gap: 0.8rem; align-items: flex-start; }
  .setup-actions { margin-top: 0.5rem; }

  /* ── Card loop ── */
  .s44-head {
    display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;
    padding-bottom: 0.9rem; border-bottom: 1px solid var(--s44-border);
  }
  .head-mid { flex: 1; text-align: center; color: var(--s44-text); font-weight: 600; }
  .station { color: var(--s44-muted); font-size: 0.8rem; }
  .end {
    background: transparent; border: 1px solid var(--s44-border); color: var(--s44-muted);
    border-radius: 8px; padding: 0.4rem 0.7rem; font: inherit; font-size: 0.82rem; cursor: pointer;
  }
  .end:hover { color: var(--s44-text); border-color: var(--s44-muted); }

  .card { max-width: 680px; }
  .company { font-size: 1.6rem; margin: 0 0 0.25rem; }
  .meta { color: var(--s44-muted); font-size: 0.88rem; margin-bottom: 1rem; }

  .surface {
    background: var(--s44-surface); border: 1px solid var(--s44-border);
    border-radius: 10px; padding: 0.8rem 0.9rem; margin-bottom: 1rem;
  }
  .surface.stacked { display: flex; flex-direction: column; gap: 0.6rem; }
  .surface.script { white-space: pre-wrap; color: var(--s44-text); font-size: 0.9rem; line-height: 1.5; }
  .row { color: var(--s44-text); font-size: 0.92rem; line-height: 1.5; }
  .row.sub { color: var(--s44-muted); font-size: 0.86rem; }
  .row.notes-import { color: var(--s44-muted); margin-top: 0.3rem; }
  .attempt-row { border-top: 1px solid var(--s44-border); padding-top: 0.5rem; }
  .attempt-row:first-child { border-top: none; padding-top: 0; }
  .tel { color: var(--s44-crimson); text-decoration: none; }
  .tel:hover { text-decoration: underline; }

  .section-label {
    font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--s44-muted); margin: 0 0 0.6rem;
  }
  .divider {
    margin: 1.4rem 0 0.7rem; padding-top: 0.8rem; border-top: 1px solid var(--s44-border);
    color: var(--s44-text); font-weight: 600; font-size: 0.95rem;
  }
  .cap-note {
    background: rgba(245, 166, 35, 0.12); border: 1px solid var(--s44-amber);
    color: #fcd9a0; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.86rem; margin-bottom: 0.8rem;
  }

  .book-schedule {
    background: var(--s44-surface); border: 1px solid var(--s44-border);
    border-radius: 10px; padding: 0.85rem 0.9rem; margin-top: 0.4rem;
  }
  .book-schedule input { max-width: 280px; }
  .caption { color: var(--s44-muted); font-size: 0.8rem; margin: 0.5rem 0 0; line-height: 1.4; }
  .caption.warn { color: var(--s44-amber); }

  .card-actions { display: flex; justify-content: space-between; gap: 0.8rem; margin-top: 1.5rem; }

  /* ── Terminal / shared buttons ── */
  .done { max-width: 520px; }
  .done h1 { margin: 0.5rem 0 0.4rem; }
  .done p { color: var(--s44-muted); }
  .done-actions { display: flex; gap: 0.8rem; align-items: center; margin-top: 1.2rem; }

  .primary {
    background: var(--s44-crimson); color: #fff; border: none; border-radius: 8px;
    padding: 0.6rem 1rem; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none;
    display: inline-block;
  }
  .primary:hover { filter: brightness(1.1); }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
  .ghost {
    background: transparent; border: 1px solid var(--s44-border); color: var(--s44-text);
    border-radius: 8px; padding: 0.6rem 1rem; font: inherit; cursor: pointer; text-decoration: none;
  }
  .ghost:hover { border-color: var(--s44-muted); }
</style>

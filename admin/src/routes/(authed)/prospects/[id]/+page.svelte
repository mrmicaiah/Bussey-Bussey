<script lang="ts">
  // Studio44 Layer 2 — Prospect workspace (§2.1/§2.2). Mode-aware: dig mode shows the
  // three dig fields + "Complete & book the next" (step 4); build-pitch mode shows the
  // five build fields + a DISPLAY-ONLY "Complete → hand to Alice" button (the handoff
  // is step 6). The mode toggle flips dig → build_pitch (forward-only, confirmed,
  // server-stamped). Mode is PER-ASSESSMENT. Dark palette scoped to the .s44 wrapper.
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type {
    ProspectWorkspace,
    SaveAssessmentNotesRequest,
    SaveAssessmentNotesResponse,
    CompleteDigRequest,
    CompleteDigResponse,
    CompletePitchRequest,
    CompletePitchResponse,
    UpdateDemoSpecRequest,
    UpdateDemoSpecResponse,
    DemoSpecStatusRequest,
    DemoSpecStatusResponse,
    DemoSpecStatus,
  } from '$lib/types';
  import NotesField from '$lib/components/prospect-workspace/NotesField.svelte';

  const id = $derived(page.params['id']!);

  let ws = $state<ProspectWorkspace | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Local note buffers — dig (3) + build-pitch (5).
  let heardLearned = $state('');
  let researchNeeded = $state('');
  let notesLoose = $state('');
  let buildWhat = $state('');
  let buildEmphasize = $state('');
  let buildIgnore = $state('');
  let buildToPrice = $state('');
  let buildNotes = $state('');

  // The current assessment's mode drives which fields + completion button render.
  const currentMode = $derived(ws?.current_assessment?.mode ?? 'dig');
  // Does the thread contain a flipped assessment? (drives the "The presentation" label)
  const hasFlip = $derived((ws?.thread ?? []).some((t) => t.mode_flipped_at));

  // Flip state (dig → build_pitch, confirmed).
  let flipConfirmOpen = $state(false);
  let flipping = $state(false);
  let flipError = $state<string | null>(null);

  // Handoff state (complete-pitch).
  let handoffConfirmOpen = $state(false);
  let handingOff = $state(false);
  let handoffError = $state<string | null>(null);

  // Demo-spec editor state. The body editor saves via the body-only PUT; the status
  // select is a separate live control on the lifecycle endpoint (step 5).
  let demoBody = $state('');
  let demoStatus = $state<DemoSpecStatus>('draft');
  let demoDirty = $state(false);
  let demoSaving = $state(false);
  let demoSaved = $state(false);
  let demoError = $state<string | null>(null);

  // Demo-spec status control state (PUT /api/admin/demo-specs/:id/status).
  let statusPending = $state<DemoSpecStatus | null>(null); // forward move awaiting confirm
  let statusSaving = $state(false);
  let statusError = $state<string | null>(null);
  let statusToast = $state<string | null>(null);
  let statusToastTimer: ReturnType<typeof setTimeout> | null = null;

  // Save state.
  let dirty = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state<string | null>(null);

  // Complete-&-book state.
  let pickerOpen = $state(false);
  let nextAppt = $state('');
  let completing = $state(false);
  let completeError = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.get<ProspectWorkspace>(`/api/admin/prospects/${id}`);
      ws = res;
      const cur = res.current_assessment;
      heardLearned = cur?.notes_heard_learned ?? '';
      researchNeeded = cur?.notes_research_needed ?? '';
      notesLoose = cur?.notes_loose ?? '';
      buildWhat = cur?.build_what ?? '';
      buildEmphasize = cur?.build_emphasize ?? '';
      buildIgnore = cur?.build_ignore ?? '';
      buildToPrice = cur?.build_to_price ?? '';
      buildNotes = cur?.build_notes ?? '';
      dirty = false;
      saved = false;
      saveError = null;
      completeError = null;
      pickerOpen = false;
      nextAppt = '';
      flipConfirmOpen = false;
      flipError = null;
      handoffConfirmOpen = false;
      handoffError = null;
      demoBody = res.demo_spec?.body ?? '';
      demoStatus = res.demo_spec?.status ?? 'draft';
      demoDirty = false;
      demoSaved = false;
      demoError = null;
      statusPending = null;
      statusError = null;
      statusToast = null;
    } catch (e) {
      error =
        e instanceof ApiError
          ? e.status === 404
            ? 'Prospect not found.'
            : `Failed to load (${e.errorCode ?? e.status}).`
          : 'Network error.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function fmtDateTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
  function threadClass(status: string): string {
    if (status === 'completed') return 'done';
    if (status === 'in_progress') return 'here';
    return 'next'; // booked / others
  }

  function markDirty() {
    dirty = true;
    saved = false;
  }

  function localDatetime(daysAhead: number, hour = 10): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // The active mode's note fields (the frontend only sends those — prior-mode notes
  // are never touched).
  function notePayload(): SaveAssessmentNotesRequest {
    if (currentMode === 'build_pitch') {
      return {
        build_what: buildWhat,
        build_emphasize: buildEmphasize,
        build_ignore: buildIgnore,
        build_to_price: buildToPrice,
        build_notes: buildNotes,
      };
    }
    return {
      notes_heard_learned: heardLearned,
      notes_research_needed: researchNeeded,
      notes_loose: notesLoose,
    };
  }

  // The flip is a recorded event — affirm before flipping.
  function requestFlip() {
    if (currentMode !== 'dig') return;
    flipError = null;
    flipConfirmOpen = true;
  }

  // Confirm: PUT carries the dig notes typed so far (no silent loss) + mode flip.
  // On success reload (current → build_pitch, mode_flipped_at set, thread marker).
  async function confirmFlip() {
    if (flipping || !ws?.current_assessment) return;
    flipping = true;
    flipError = null;
    try {
      const body: SaveAssessmentNotesRequest = { ...notePayload(), mode: 'build_pitch' };
      await api.put<SaveAssessmentNotesResponse>(`/api/admin/assessments/${ws.current_assessment.id}`, body);
      flipConfirmOpen = false;
      await load();
    } catch (e) {
      flipError = e instanceof ApiError ? `Couldn't flip (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      flipping = false;
    }
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  // The handoff: complete the build-pitch assessment → create draft proposal + demo
  // spec. Affirm first. On success reload (workspace returns demo_spec + proposal).
  function requestHandoff() {
    if (currentMode !== 'build_pitch') return;
    handoffError = null;
    handoffConfirmOpen = true;
  }
  async function confirmHandoff() {
    if (handingOff || !ws?.current_assessment) return;
    handingOff = true;
    handoffError = null;
    try {
      const body: CompletePitchRequest = notePayload();
      await api.post<CompletePitchResponse>(
        `/api/admin/assessments/${ws.current_assessment.id}/complete-pitch`,
        body,
      );
      handoffConfirmOpen = false;
      await load();
    } catch (e) {
      handoffError = e instanceof ApiError ? `Couldn't hand off (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      handingOff = false;
    }
  }

  function markDemoDirty() {
    demoDirty = true;
    demoSaved = false;
  }
  // Body-only save — status moved to its own lifecycle endpoint (step 5).
  async function saveDemoSpec() {
    if (demoSaving || !ws?.demo_spec) return;
    demoSaving = true;
    demoError = null;
    try {
      const body: UpdateDemoSpecRequest = { body: demoBody };
      const res = await api.put<UpdateDemoSpecResponse>(`/api/admin/demo-specs/${ws.demo_spec.id}`, body);
      if (ws.demo_spec) {
        ws.demo_spec.body = res.demo_spec.body;
      }
      demoDirty = false;
      demoSaved = true;
    } catch (e) {
      demoError = e instanceof ApiError ? `Couldn't save (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      demoSaving = false;
    }
  }

  // ── Demo-spec status control (lifecycle endpoint) ──────────────────────────
  // Lifecycle order; transitions are ±1 step (server-enforced; mirrored here so the
  // operator gets the message before a round-trip).
  const DEMO_STATUS_ORDER: DemoSpecStatus[] = ['draft', 'ready', 'handed_off', 'built'];
  const DEMO_STATUS_LABEL: Record<DemoSpecStatus, string> = {
    draft: 'draft', ready: 'ready', handed_off: 'handed off', built: 'built',
  };

  function onStatusSelect() {
    if (!ws?.demo_spec || statusSaving) return;
    statusError = null;
    statusPending = null;
    const from = ws.demo_spec.status;
    const to = demoStatus;
    if (to === from) return;
    const step = DEMO_STATUS_ORDER.indexOf(to) - DEMO_STATUS_ORDER.indexOf(from);
    if (Math.abs(step) > 1) {
      demoStatus = from; // revert the select
      statusError = 'Move one step at a time.';
      return;
    }
    // Forward into handed_off / built stamps a timestamp — confirm first.
    if (step === 1 && (to === 'handed_off' || to === 'built')) {
      statusPending = to;
      return;
    }
    // draft↔ready and backward corrections fire directly.
    void putStatus(to);
  }

  async function putStatus(to: DemoSpecStatus) {
    if (!ws?.demo_spec || statusSaving) return;
    const from = ws.demo_spec.status;
    statusSaving = true;
    statusError = null;
    try {
      const body: DemoSpecStatusRequest = { status: to };
      const res = await api.put<DemoSpecStatusResponse>(`/api/admin/demo-specs/${ws.demo_spec.id}/status`, body);
      if (ws.demo_spec) ws.demo_spec.status = res.demo_spec.status;
      demoStatus = res.demo_spec.status;
      statusPending = null;
      statusToast = `Moved to ${DEMO_STATUS_LABEL[res.demo_spec.status]}`;
      if (statusToastTimer) clearTimeout(statusToastTimer);
      statusToastTimer = setTimeout(() => (statusToast = null), 2500);
    } catch (e) {
      demoStatus = from; // revert to the persisted value
      statusPending = null;
      statusError = e instanceof ApiError ? `Couldn't move (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      statusSaving = false;
    }
  }

  function cancelStatusPending() {
    if (ws?.demo_spec) demoStatus = ws.demo_spec.status; // revert the select
    statusPending = null;
  }

  function fmtDateTimeShort(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  // Save the three dig fields. On success: clear dirty, show "saved", reflect any
  // booked→in_progress transition locally. On failure: surface error, keep buffers.
  async function save() {
    if (saving || !ws?.current_assessment) return;
    saving = true;
    saveError = null;
    try {
      const res = await api.put<SaveAssessmentNotesResponse>(
        `/api/admin/assessments/${ws.current_assessment.id}`,
        notePayload(),
      );
      if (ws.current_assessment) {
        ws.current_assessment.status = res.assessment.status;
        // reflect the status in the thread (booked→in_progress) without a full reload
        const t = ws.thread.find((x) => x.id === res.assessment.id);
        if (t) t.status = res.assessment.status;
      }
      dirty = false;
      saved = true;
    } catch (e) {
      saveError = e instanceof ApiError ? `Couldn't save (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      saving = false;
    }
  }

  // Complete the dig assessment and book the next. On success: reload the workspace
  // (the booked next becomes current; the thread grows). On failure: surface error,
  // do NOT advance, keep the picker + buffers.
  async function completeAndBook() {
    if (completing || !ws?.current_assessment || !nextAppt) return;
    completing = true;
    completeError = null;
    try {
      const body: CompleteDigRequest = { scheduled_at: nextAppt, ...notePayload() };
      await api.post<CompleteDigResponse>(
        `/api/admin/assessments/${ws.current_assessment.id}/complete-dig`,
        body,
      );
      await load(); // authoritative refresh: new current + grown thread
    } catch (e) {
      completeError = e instanceof ApiError ? `Couldn't complete (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      completing = false;
    }
  }
</script>

<svelte:head><title>Prospect · Studio44</title></svelte:head>

<div class="s44">
  <div class="topbar">
    <a class="back" href={`${base}/prospects`}>← Prospects</a>
  </div>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error || !ws}
    <div class="err">{error ?? 'Prospect not found.'}</div>
  {:else}
    <header class="hd">
      <div>
        <span class="brand">Studio44 · Prospect</span>
        <h1>{ws.prospect.company}</h1>
      </div>
      <div class="hd-meta">
        <span>{ws.thread.length} {ws.thread.length === 1 ? 'assessment' : 'assessments'}</span>
        <span class="dot">·</span>
        <span>{ws.prospect.days_in_funnel} {ws.prospect.days_in_funnel === 1 ? 'day' : 'days'} in funnel</span>
      </div>
    </header>

    <div class="identity">
      <div class="who">
        <span class="company">{ws.prospect.company}</span>
        <span class="sub">
          {#if ws.prospect.contact}{ws.prospect.contact}{/if}{#if ws.prospect.contact && ws.prospect.industry} · {/if}{#if ws.prospect.industry}{ws.prospect.industry}{/if}
        </span>
      </div>
      <!-- Mode toggle — functional, forward-only. Flipping is a recorded event. -->
      <div class="toggle" role="group" aria-label="Mode">
        {#if currentMode === 'build_pitch'}
          <!-- forward-only: the dig side is inert once flipped -->
          <span class="seg disabled" title="Flipped — forward-only">
            Digging
            {#if ws.current_assessment?.mode_flipped_at}<span class="flipped-on">flipped {fmtDate(ws.current_assessment.mode_flipped_at)}</span>{/if}
          </span>
          <span class="seg active">Build the pitch</span>
        {:else}
          <span class="seg active">Digging</span>
          <button type="button" class="seg clickable" onclick={requestFlip} disabled={!ws.current_assessment}>Build the pitch →</button>
        {/if}
      </div>
    </div>
    <p class="toggle-hint">Flip to “Build the pitch” when the client signals “what would that cost?”</p>

    {#if flipConfirmOpen}
      <div class="flip-confirm">
        <span>Flip to build-the-pitch? This records the turn — it can't be undone.</span>
        {#if flipError}<span class="flip-err">{flipError}</span>{/if}
        <div class="flip-actions">
          <button type="button" class="ghost" onclick={() => (flipConfirmOpen = false)} disabled={flipping}>Cancel</button>
          <button type="button" class="complete" onclick={confirmFlip} disabled={flipping}>{flipping ? 'Flipping…' : 'Flip & record'}</button>
        </div>
      </div>
    {/if}

    <div class="grid">
      <!-- LEFT: the meeting thread -->
      <aside class="thread">
        <h3>The thread</h3>
        {#if ws.thread.length === 0}
          <p class="muted small">No assessments yet.</p>
        {:else}
          <ul>
            {#each ws.thread as t (t.id)}
              <li class={`t ${threadClass(t.status)}`}>
                <div class="t-top">
                  <span class="t-seq">#{t.sequence_number}</span>
                  {#if t.status === 'in_progress'}<span class="t-here">you are here</span>{/if}
                  {#if t.status === 'booked' && hasFlip}<span class="t-present">The presentation</span>{/if}
                  <span class="t-date">{fmtDateTime(t.scheduled_at)}</span>
                </div>
                <div class="t-summary">{t.summary ?? '—'}</div>
                <div class="t-mode">{t.mode === 'build_pitch' ? 'pitch' : 'dig'}</div>
                {#if t.mode_flipped_at}<div class="t-turned">↳ turned to pitch here</div>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </aside>

      <!-- CENTER: the current assessment's dig notes -->
      <section class="center">
        {#if !ws.current_assessment}
          <div class="calm">
            <p>No open assessment.</p>
            <p class="muted small">Every meeting in the thread is complete. The next one will appear here when it's booked.</p>
          </div>
        {:else}
          <div class="cur-head">
            <span>Assessment #{ws.current_assessment.sequence_number}</span>
            <span class="cur-mode">{currentMode === 'build_pitch' ? 'Build the pitch' : 'Digging'}</span>
            <span class="cur-when">{fmtDateTime(ws.current_assessment.scheduled_at)}</span>
          </div>

          <div class="fields">
            {#if currentMode === 'build_pitch'}
              <!-- Build-pitch fields (§2.2), forward-only — five, in order. -->
              <NotesField label="What gets built" icon="🔧" bind:value={buildWhat} onchange={markDirty} />
              <NotesField label="What to emphasize" hint="What the client cares about." icon="★" bind:value={buildEmphasize} onchange={markDirty} />
              <NotesField label="What doesn't matter" hint="Where not to spend effort." icon="✕" bind:value={buildIgnore} onchange={markDirty} />
              <NotesField label="To price out" tag="Alice prices this" hint="Line-item fodder for Alice." icon="💲" bind:value={buildToPrice} onchange={markDirty} />
              <NotesField label="Notes" hint="Anything else." icon="✎" bind:value={buildNotes} onchange={markDirty} />
            {:else}
              <!-- Dig fields (§2.1) — three, in order. -->
              <NotesField label="Heard / Learned" icon="👂" bind:value={heardLearned} onchange={markDirty} />
              <NotesField label="Research needed" tag="Alice acts on this" icon="🔎" bind:value={researchNeeded} onchange={markDirty} />
              <NotesField label="Notes" hint="Anything loose." icon="✎" bind:value={notesLoose} onchange={markDirty} />
            {/if}
          </div>

          {#if saveError}<div class="err">{saveError}</div>{/if}
          {#if completeError}<div class="err">{completeError}</div>{/if}

          <div class="actions">
            <button type="button" class="save" onclick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {#if saved && !dirty}
              <span class="saved small">✓ Saved</span>
            {:else if dirty}
              <span class="muted small">Unsaved changes</span>
            {/if}

            {#if currentMode === 'build_pitch'}
              <button type="button" class="complete" onclick={requestHandoff} disabled={handingOff}>
                Complete → hand to Alice
              </button>
            {:else}
              <button type="button" class="complete" onclick={() => { pickerOpen = !pickerOpen; completeError = null; }} disabled={completing}>
                Complete &amp; book the next →
              </button>
            {/if}
          </div>

          {#if handoffConfirmOpen}
            <div class="flip-confirm">
              <span>Hand this to Alice? Creates a draft proposal and a demo spec from these notes.</span>
              {#if handoffError}<span class="flip-err">{handoffError}</span>{/if}
              <div class="flip-actions">
                <button type="button" class="ghost" onclick={() => (handoffConfirmOpen = false)} disabled={handingOff}>Cancel</button>
                <button type="button" class="complete" onclick={confirmHandoff} disabled={handingOff}>{handingOff ? 'Handing off…' : 'Hand to Alice'}</button>
              </div>
            </div>
          {/if}

          {#if currentMode === 'dig' && pickerOpen}
            <div class="picker">
              <div class="picker-label">Set the next appointment</div>
              <div class="picker-quick">
                <button type="button" onclick={() => (nextAppt = localDatetime(1, 10))} disabled={completing}>Tomorrow 10am</button>
                <button type="button" onclick={() => (nextAppt = localDatetime(3, 10))} disabled={completing}>In 3 days</button>
              </div>
              <input type="datetime-local" bind:value={nextAppt} disabled={completing} aria-label="Next appointment date and time" />
              <div class="picker-actions">
                <button type="button" class="ghost" onclick={() => (pickerOpen = false)} disabled={completing}>Cancel</button>
                <button type="button" class="complete" onclick={completeAndBook} disabled={completing || !nextAppt}>
                  {completing ? 'Completing…' : 'Complete & book'}
                </button>
              </div>
              <p class="muted small">Completing saves these notes, closes this assessment, and books the next dig appointment.</p>
            </div>
          {/if}
        {/if}
      </section>

      <!-- RIGHT: dormant Alice slot + capture strip (mode-aware) -->
      <aside class="right">
        <div class="alice" aria-label="Alice (inactive)">
          {#if currentMode === 'build_pitch'}
            <div class="alice-head"><span class="alice-tag">Alice · standing by</span><span class="alice-l4">wires in L4</span></div>
            <p class="alice-note">On completion, Alice interrogates the scope, prices it, and specs the demo — turning these notes into a proposal and a build brief.</p>
          {:else}
            <div class="alice-head"><span class="alice-tag">Alice · prep</span><span class="alice-l4">wires in L4</span></div>
            <p class="alice-note">Between meetings, Alice reads “Research needed” and does the digging — so you walk into the next one armed.</p>
          {/if}
        </div>

        <div class="capture">
          <div class="capture-title">Captured per assessment</div>
          <ul>
            {#if currentMode === 'build_pitch'}
              <li>what gets built</li>
              <li>what to emphasize</li>
              <li>what doesn't matter</li>
              <li>to price out</li>
              <li>notes</li>
            {:else}
              <li>heard / learned</li>
              <li>research needed</li>
              <li>notes</li>
            {/if}
            <li>sequence #</li>
            <li>mode at completion <strong>({currentMode === 'build_pitch' ? 'pitch' : 'dig'})</strong></li>
          </ul>
        </div>
      </aside>
    </div>

    <!-- HANDOFF (§2.3) — appears once the build-pitch meeting has been handed to Alice. -->
    {#if ws.demo_spec && ws.proposal}
      {@const pitched = ws.thread.find((t) => t.mode === 'build_pitch' && t.status === 'completed')}
      <section class="handoff">
        <div class="handoff-head">
          <div>
            <span class="brand">The handoff</span>
            <div class="banner">
              {pitched ? `Assessment #${pitched.sequence_number} complete` : 'Pitch-mode meeting complete'} — handed to Alice.
            </div>
          </div>
          <div class="presentation">
            {#if ws.next_appointment}
              <span class="p-label">The presentation</span>
              <span class="p-when">{fmtDateTimeShort(ws.next_appointment.scheduled_at)}</span>
            {:else}
              <span class="p-none">No presentation booked</span>
            {/if}
          </div>
        </div>

        <div class="handoff-grid">
          <!-- LEFT — Alice interrogation (DORMANT, illustrative) -->
          <div class="interrogation">
            <div class="alice-head"><span class="alice-tag">Alice · interrogation</span><span class="alice-l4">wires in L4</span></div>
            <p class="illus-label">Illustrative — Alice is not wired in this layer.</p>
            <ul class="illus">
              <li><span class="q">Alice:</span> Which line item is the anchor of this build?</li>
              <li><span class="q">Alice:</span> What's the one outcome the client said they care about most?</li>
              <li><span class="q">Alice:</span> Anything in scope we should deliberately keep thin?</li>
              <li><span class="q">Alice:</span> What number lands this — and what's the floor?</li>
            </ul>
            <p class="fallback">Until Alice is wired, you can fill the proposal &amp; demo spec by hand — the containers work either way.</p>
          </div>

          <!-- RIGHT — the two output containers -->
          <div class="outputs">
            <div class="container">
              <div class="container-head">
                <span class="c-title">Priced proposal</span>
                <span class="c-status">{ws.proposal.status}</span>
              </div>
              {#if ws.proposal.line_items.length === 0}
                <p class="muted small">No line items seeded — add them in the proposal.</p>
              {:else}
                <ul class="lines">
                  {#each ws.proposal.line_items as li (li.id)}
                    <li>
                      <span class="li-desc">{li.description_override ?? li.component_code}</span>
                      <span class="li-price">{li.line_total > 0 ? `$${li.line_total.toLocaleString()}` : '—'}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
              <a class="open-proposal" href={`${base}/clients/${ws.prospect.client_id}/opportunities/${ws.prospect.id}/proposal`}>
                Open proposal →
              </a>
            </div>

            <div class="container">
              <div class="container-head">
                <span class="c-title">Demo-spec prompt</span>
                <div class="status-control">
                  {#if statusToast}<span class="status-toast small">✓ {statusToast}</span>{/if}
                  <select class="demo-status" bind:value={demoStatus} onchange={onStatusSelect} disabled={statusSaving} aria-label="Demo-spec status">
                    <option value="draft">draft</option>
                    <option value="ready">ready</option>
                    <option value="handed_off">handed off</option>
                    <option value="built">built</option>
                  </select>
                </div>
              </div>
              {#if statusError}<div class="status-err small">{statusError}</div>{/if}
              {#if statusPending}
                <div class="status-confirm">
                  <span>
                    {statusPending === 'handed_off'
                      ? 'Hand this spec off to the builder? Stamps the handoff time.'
                      : 'Mark the demo built? Stamps the build time.'}
                  </span>
                  <div class="status-confirm-actions">
                    <button type="button" class="ghost" onclick={cancelStatusPending} disabled={statusSaving}>Cancel</button>
                    <button type="button" class="save" onclick={() => statusPending && putStatus(statusPending)} disabled={statusSaving}>
                      {statusSaving ? 'Moving…' : statusPending === 'handed_off' ? 'Hand off' : 'Mark built'}
                    </button>
                  </div>
                </div>
              {/if}
              <NotesField
                label="The brief"
                hint="What to build / emphasize / ignore / the value to land. Prose — Alice authors this at L4."
                icon="📝"
                bind:value={demoBody}
                onchange={markDemoDirty}
              />
              {#if demoError}<div class="err">{demoError}</div>{/if}
              <div class="demo-actions">
                <button type="button" class="save" onclick={saveDemoSpec} disabled={demoSaving || !demoDirty}>
                  {demoSaving ? 'Saving…' : 'Save demo spec'}
                </button>
                {#if demoSaved && !demoDirty}<span class="saved small">✓ Saved</span>{:else if demoDirty}<span class="muted small">Unsaved changes</span>{/if}
              </div>
            </div>
          </div>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .s44 {
    --s44-bg: #0a0a0b;
    --s44-surface: #141416;
    --s44-surface-2: #1c1c1f;
    --s44-border: #2a2a2e;
    --s44-crimson: #d40b1e;
    --s44-text: #f4f4f5;
    --s44-muted: #a1a1aa;
    --s44-amber: #f5a623;
    --s44-green: #34d399;
    background: var(--s44-bg);
    color: var(--s44-text);
    border: 1px solid var(--s44-border);
    border-radius: 12px;
    padding: 1.25rem;
    min-height: 70vh;
  }
  .topbar { margin-bottom: 0.75rem; }
  .back { color: var(--s44-muted); text-decoration: none; font-size: 0.85rem; }
  .back:hover { color: var(--s44-text); }
  .muted { color: var(--s44-muted); }
  .small { font-size: 0.85rem; }
  .dot { opacity: 0.5; margin: 0 0.35rem; }
  .err { background: rgba(212, 11, 30, 0.12); border: 1px solid var(--s44-crimson); color: #fca5a5; border-radius: 8px; padding: 0.7rem 0.9rem; font-size: 0.9rem; }

  .hd { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 0.9rem; border-bottom: 1px solid var(--s44-border); }
  .brand { font-weight: 800; letter-spacing: 0.04em; color: var(--s44-muted); font-size: 0.74rem; text-transform: uppercase; }
  .hd h1 { margin: 0.15rem 0 0; color: var(--s44-text); font-size: 1.5rem; }
  .hd-meta { color: var(--s44-muted); font-size: 0.85rem; }

  .identity { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 1rem; flex-wrap: wrap; }
  .who { display: flex; flex-direction: column; gap: 0.15rem; }
  .who .company { font-weight: 700; font-size: 1.1rem; }
  .who .sub { color: var(--s44-muted); font-size: 0.88rem; }
  .toggle { display: inline-flex; border: 1px solid var(--s44-border); border-radius: 999px; overflow: hidden; }
  .seg { padding: 0.4rem 0.9rem; font-size: 0.85rem; font: inherit; background: transparent; border: none; color: var(--s44-muted); cursor: default; display: inline-flex; align-items: center; gap: 0.4rem; }
  .seg.active { background: var(--s44-crimson); color: #fff; font-weight: 600; }
  .seg.disabled { cursor: not-allowed; opacity: 0.7; }
  .soon { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid var(--s44-border); border-radius: 999px; padding: 0.02rem 0.35rem; }
  .toggle-hint { margin: 0.5rem 0 0; color: var(--s44-text); font-size: 0.82rem; }
  .seg.clickable { cursor: pointer; }
  .seg.clickable:hover:not(:disabled) { background: var(--s44-surface-2); color: var(--s44-text); }
  .seg.clickable:disabled { opacity: 0.6; cursor: not-allowed; }
  .flipped-on { font-size: 0.62rem; color: var(--s44-amber); margin-left: 0.4rem; }

  .flip-confirm {
    margin-top: 0.6rem; border: 1px solid var(--s44-amber); border-radius: 10px;
    padding: 0.7rem 0.85rem; background: rgba(245, 166, 35, 0.08);
    display: flex; flex-direction: column; gap: 0.5rem; max-width: 520px;
    color: var(--s44-text); font-size: 0.9rem;
  }
  .flip-err { color: #fca5a5; font-size: 0.82rem; }
  .flip-actions { display: flex; justify-content: flex-end; gap: 0.6rem; }

  .cur-mode {
    margin-left: 0.5rem; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--s44-crimson); border: 1px solid var(--s44-crimson); border-radius: 999px; padding: 0.05rem 0.45rem;
  }

  .grid { display: grid; grid-template-columns: 230px 1fr 250px; gap: 1rem; margin-top: 1.25rem; align-items: start; }
  @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }

  .thread h3, .center .cur-head, .right .capture-title { color: var(--s44-muted); }
  .thread h3 { margin: 0 0 0.5rem; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .thread ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .t { border: 1px solid var(--s44-border); border-left: 3px solid var(--s44-border); border-radius: 8px; padding: 0.5rem 0.65rem; background: var(--s44-surface); }
  .t.done { border-left-color: var(--s44-green); }
  .t.here { border-left-color: var(--s44-crimson); box-shadow: inset 0 0 0 1px rgba(212,11,30,0.25); }
  .t.next { border-left-style: dashed; border-left-color: var(--s44-amber); }
  .t-top { display: flex; align-items: baseline; gap: 0.4rem; }
  .t-seq { font-weight: 700; font-size: 0.85rem; }
  .t-here { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--s44-crimson); }
  .t-date { margin-left: auto; color: var(--s44-muted); font-size: 0.72rem; }
  .t-summary { color: var(--s44-text); font-size: 0.82rem; margin-top: 0.2rem; line-height: 1.35; }
  .t-mode { margin-top: 0.2rem; color: var(--s44-muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .t-present { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--s44-amber); }
  .t-turned { margin-top: 0.25rem; color: var(--s44-amber); font-size: 0.7rem; font-weight: 600; }

  .center { display: flex; flex-direction: column; gap: 0.75rem; }
  .cur-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; }
  .cur-when { color: var(--s44-muted); }
  .fields { display: flex; flex-direction: column; gap: 0.6rem; }
  .actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.25rem; flex-wrap: wrap; }
  .save {
    background: var(--s44-surface-2); color: var(--s44-text); border: 1px solid var(--s44-border);
    border-radius: 8px; padding: 0.5rem 0.9rem; font: inherit; cursor: pointer;
  }
  .save:hover:not(:disabled) { border-color: var(--s44-muted); }
  .save:disabled { color: var(--s44-muted); cursor: not-allowed; opacity: 0.7; }
  .saved { color: var(--s44-green); }
  .complete {
    margin-left: auto; background: var(--s44-crimson); color: #fff; border: none;
    border-radius: 8px; padding: 0.5rem 0.9rem; font: inherit; font-weight: 700; cursor: pointer;
  }
  .complete:hover:not(:disabled) { filter: brightness(1.1); }
  .complete:disabled { opacity: 0.6; cursor: not-allowed; }
  .picker {
    margin-top: 0.6rem; border: 1px solid var(--s44-border); border-radius: 10px;
    padding: 0.8rem; background: var(--s44-surface); display: flex; flex-direction: column; gap: 0.5rem;
  }
  .picker-label { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--s44-muted); }
  .picker-quick { display: flex; gap: 0.5rem; }
  .picker-quick button {
    flex: 1; cursor: pointer; font: inherit; font-size: 0.82rem;
    background: var(--s44-surface-2); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 6px; padding: 0.45rem;
  }
  .picker-quick button:hover:not(:disabled) { border-color: var(--s44-crimson); }
  .picker-quick button:disabled { opacity: 0.55; cursor: not-allowed; }
  .picker input {
    font: inherit; background: var(--s44-bg); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 6px; padding: 0.45rem 0.6rem;
  }
  .picker-actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
  .ghost {
    background: transparent; border: 1px solid var(--s44-border); color: var(--s44-text);
    border-radius: 8px; padding: 0.5rem 0.9rem; font: inherit; cursor: pointer;
  }
  .ghost:hover:not(:disabled) { border-color: var(--s44-muted); }
  .ghost:disabled { opacity: 0.6; cursor: not-allowed; }
  .calm { border: 1px dashed var(--s44-border); border-radius: 10px; padding: 1.5rem 1.1rem; text-align: center; color: var(--s44-text); }
  .calm p { margin: 0 0 0.3rem; }

  .right { display: flex; flex-direction: column; gap: 0.75rem; }
  .alice { border: 1px dashed var(--s44-border); border-radius: 10px; padding: 0.8rem 0.75rem;
    background: repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.012) 8px, rgba(255,255,255,0.012) 16px); }
  .alice-head { display: flex; align-items: baseline; gap: 0.5rem; }
  .alice-tag { font-weight: 700; color: var(--s44-text); font-size: 0.85rem; }
  .alice-l4 { font-size: 0.66rem; color: var(--s44-muted); border: 1px solid var(--s44-border); border-radius: 999px; padding: 0.05rem 0.4rem; }
  .alice-note { margin: 0.4rem 0 0; color: var(--s44-muted); font-size: 0.8rem; line-height: 1.45; }
  .capture { border: 1px solid var(--s44-border); border-radius: 10px; padding: 0.6rem 0.75rem; }
  .capture-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.35rem; }
  .capture ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .capture li { color: var(--s44-muted); font-size: 0.78rem; }

  /* ── Handoff (§2.3) ── */
  .handoff { margin-top: 1.5rem; border-top: 1px solid var(--s44-border); padding-top: 1.25rem; }
  .handoff-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .banner { margin-top: 0.2rem; color: var(--s44-text); font-size: 1.05rem; font-weight: 600; }
  .presentation { text-align: right; display: flex; flex-direction: column; gap: 0.1rem; }
  .p-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--s44-amber); }
  .p-when { color: var(--s44-text); font-size: 0.9rem; }
  .p-none { color: var(--s44-muted); font-style: italic; font-size: 0.85rem; }

  .handoff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; align-items: start; }
  @media (max-width: 880px) { .handoff-grid { grid-template-columns: 1fr; } }

  .interrogation {
    border: 1px dashed var(--s44-border); border-radius: 10px; padding: 0.9rem;
    background: repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.012) 8px, rgba(255,255,255,0.012) 16px);
  }
  .illus-label { margin: 0.4rem 0 0.5rem; color: var(--s44-amber); font-size: 0.72rem; }
  .illus { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; opacity: 0.55; }
  .illus li { color: var(--s44-muted); font-size: 0.82rem; }
  .illus .q { color: var(--s44-text); font-weight: 600; margin-right: 0.3rem; }
  .fallback { margin: 0.7rem 0 0; color: var(--s44-muted); font-size: 0.8rem; line-height: 1.45; border-top: 1px solid var(--s44-border); padding-top: 0.6rem; }

  .outputs { display: flex; flex-direction: column; gap: 0.85rem; }
  .container { border: 1px solid var(--s44-border); border-radius: 10px; padding: 0.85rem; background: var(--s44-surface); }
  .container-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
  .c-title { font-weight: 700; color: var(--s44-text); }
  .c-status { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--s44-muted); border: 1px solid var(--s44-border); border-radius: 999px; padding: 0.05rem 0.45rem; }
  .lines { list-style: none; margin: 0 0 0.7rem; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .lines li { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.85rem; border-bottom: 1px solid var(--s44-border); padding-bottom: 0.3rem; }
  .li-desc { color: var(--s44-text); }
  .li-price { color: var(--s44-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .open-proposal { display: inline-block; color: var(--s44-crimson); text-decoration: none; font-weight: 600; font-size: 0.88rem; }
  .open-proposal:hover { text-decoration: underline; }
  .demo-status {
    font: inherit; font-size: 0.78rem; background: var(--s44-surface-2); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 6px; padding: 0.2rem 0.4rem;
  }
  .demo-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.6rem; }

  /* Demo-spec status control (step 5) — confirm strip mirrors .flip-confirm. */
  .status-control { display: flex; align-items: center; gap: 0.5rem; }
  .status-toast { color: var(--s44-green); font-size: 0.78rem; }
  .status-err { color: #fca5a5; font-size: 0.82rem; margin-top: 0.4rem; }
  .status-confirm {
    margin-top: 0.6rem; border: 1px solid var(--s44-amber); border-radius: 10px;
    padding: 0.7rem 0.85rem; background: rgba(245, 166, 35, 0.08);
    display: flex; flex-direction: column; gap: 0.5rem;
    color: var(--s44-text); font-size: 0.9rem;
  }
  .status-confirm-actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
</style>

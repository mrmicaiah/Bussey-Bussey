<script lang="ts">
  // Studio44 Layer 2 — Prospect workspace, DIG MODE ONLY (§2.1). READ-ONLY data:
  // consumes GET /api/admin/prospects/:id. The operator can TYPE in the note fields
  // (local state) but there is NO save this step (wiring is step 4) — nothing is
  // POSTed. The mode toggle is DISPLAY-ONLY (the flip + build-pitch fields are
  // step 5). Dark palette scoped to the .s44 wrapper below.
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { ProspectWorkspace } from '$lib/types';
  import NotesField from '$lib/components/prospect-workspace/NotesField.svelte';

  const id = $derived(page.params['id']!);

  let ws = $state<ProspectWorkspace | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Local dig-note buffers (no persistence this step).
  let heardLearned = $state('');
  let researchNeeded = $state('');
  let notesLoose = $state('');

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
      <!-- Mode toggle — DISPLAY-ONLY this step. Flip + build-pitch fields are step 5. -->
      <div class="toggle" role="group" aria-label="Mode (display only)">
        <span class="seg active">Digging</span>
        <button type="button" class="seg disabled" disabled title="Wires in step 5">Build the pitch <span class="soon">soon</span></button>
      </div>
    </div>
    <p class="toggle-hint">Flip to “Build the pitch” when the client signals “what would that cost?” <span class="muted">(coming soon)</span></p>

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
                  <span class="t-date">{fmtDateTime(t.scheduled_at)}</span>
                </div>
                <div class="t-summary">{t.summary ?? '—'}</div>
                <div class="t-mode">{t.mode === 'build_pitch' ? 'pitch' : 'dig'}</div>
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
            <span class="cur-when">{fmtDateTime(ws.current_assessment.scheduled_at)}</span>
          </div>

          <div class="fields">
            <NotesField label="Heard / Learned" icon="👂" bind:value={heardLearned} />
            <NotesField
              label="Research needed"
              tag="Alice acts on this"
              icon="🔎"
              bind:value={researchNeeded}
            />
            <NotesField label="Notes" hint="Anything loose." icon="✎" bind:value={notesLoose} />
          </div>

          <div class="actions">
            <button type="button" class="save" disabled title="Saving wires in step 4">Save · wiring next</button>
            <span class="muted small">Notes aren't saved yet — persistence lands in the next step.</span>
          </div>
        {/if}
      </section>

      <!-- RIGHT: dormant Alice slot + capture strip -->
      <aside class="right">
        <div class="alice" aria-label="Alice prep (inactive)">
          <div class="alice-head"><span class="alice-tag">Alice · prep</span><span class="alice-l4">wires in L4</span></div>
          <p class="alice-note">Between meetings, Alice reads “Research needed” and does the digging — so you walk into the next one armed.</p>
        </div>

        <div class="capture">
          <div class="capture-title">Captured per assessment</div>
          <ul>
            <li>heard / learned</li>
            <li>research needed</li>
            <li>notes</li>
            <li>sequence #</li>
            <li>outcome</li>
            <li>mode at completion</li>
          </ul>
        </div>
      </aside>
    </div>
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

  .center { display: flex; flex-direction: column; gap: 0.75rem; }
  .cur-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; }
  .cur-when { color: var(--s44-muted); }
  .fields { display: flex; flex-direction: column; gap: 0.6rem; }
  .actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.25rem; flex-wrap: wrap; }
  .save { background: var(--s44-surface-2); color: var(--s44-muted); border: 1px solid var(--s44-border); border-radius: 8px; padding: 0.5rem 0.9rem; font: inherit; cursor: not-allowed; }
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
</style>

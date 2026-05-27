<script lang="ts">
  // Studio44 Dashboard — funnel vitals + four work stations (spec §1/§5).
  // Consumes GET /api/admin/dashboard. Inherits the GLOBAL Studio44 tokens from the
  // reskin foundation — NO local .s44 palette here. STEP 3: read-only. The cold-calling
  // +/- control and the Mark-built action are DISPLAY-ONLY (render + acknowledge clicks
  // but POST nothing — wiring is steps 4/5).
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { DashboardResponse, ColdCallingTargetResponse } from '$lib/types';
  import Button from '$lib/components/Button.svelte';

  let { data }: { data: { user: import('$lib/types').AdminUser } } = $props();

  let dash = $state<DashboardResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Mark-built confirm dialog (display-only this step — step 5 wires it).
  let markBuiltFor = $state<{ company: string; demo_spec_id: string } | null>(null);

  // Cold-calling push-target write state: debounced PUT, optimistic, error-reverting.
  let ccSaving = $state(false);
  let ccError = $state<string | null>(null);
  let ccTimer: ReturnType<typeof setTimeout> | null = null;
  // Snapshot of {effective_target, override_active} from BEFORE the current click-burst,
  // so a failed PUT reverts to the real pre-edit state.
  let ccRevert: { effective_target: number; override_active: boolean } | null = null;

  async function load() {
    loading = true;
    error = null;
    try {
      dash = await api.get<DashboardResponse>('/api/admin/dashboard');
    } catch (e) {
      error = e instanceof ApiError ? `Failed to load (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const priority = $derived(dash != null && dash.funnel.presentations.health !== 'calm');

  // Cold-calling +/-: optimistic + debounced (one PUT after a click-burst) + error-revert.
  function bumpTarget(delta: number) {
    if (!dash || ccSaving) return;
    const cc = dash.stations.cold_calling;
    const next = Math.max(5, Math.min(100, cc.effective_target + delta));
    if (next === cc.effective_target) return; // at a bound — no-op
    // Capture the real pre-burst state once, so a later failure reverts cleanly.
    if (ccRevert === null) ccRevert = { effective_target: cc.effective_target, override_active: cc.override_active };
    cc.effective_target = next; // optimistic
    cc.override_active = true; // so the "your push" reason can render
    ccError = null;
    if (ccTimer) clearTimeout(ccTimer);
    ccTimer = setTimeout(() => void flushTarget(), 300);
  }

  async function flushTarget() {
    if (!dash) return;
    ccTimer = null;
    const cc = dash.stations.cold_calling;
    const revert = ccRevert;
    ccRevert = null;
    ccSaving = true;
    try {
      const res = await api.put<ColdCallingTargetResponse>('/api/admin/cold-calling-target', {
        target: cc.effective_target,
      });
      // Server is the source of truth (keep calls_this_week; replace the rest).
      cc.effective_target = res.effective_target;
      cc.override_active = res.override_active;
      cc.suggested_target = res.suggested_target;
      cc.reason = res.reason;
    } catch (e) {
      if (revert) {
        cc.effective_target = revert.effective_target;
        cc.override_active = revert.override_active;
      }
      ccError = "couldn't save — try again";
    } finally {
      ccSaving = false;
    }
  }

  function confirmMarkBuilt() {
    // wiring next (step 5) — intentionally does not POST the status transition.
    console.log('[dashboard] mark-built is display-only this step');
    markBuiltFor = null;
  }

  const PRES_HEALTH_LABEL = { crimson: 'running thin', amber: 'watch this', calm: 'in flight' } as const;

  function fmtShort(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
  function inDays(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now();
    const d = Math.round(ms / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'tomorrow';
    return `in ${d} days`;
  }
  function pct(n: number, d: number): number {
    return Math.min(100, Math.round((n / Math.max(d, 1)) * 100));
  }
  function bookedCount(slots: { booked: unknown | null }[]): number {
    return slots.filter((x) => x.booked).length;
  }
  function pillTitle(kind: 'spec' | 'demo' | 'price', state: string): string {
    if (kind === 'spec') return state === 'green' ? 'spec written' : 'spec not written';
    if (kind === 'demo')
      return state === 'green' ? 'demo built' : state === 'amber' ? 'demo handed off, waiting on build' : 'demo not started';
    return state === 'green' ? 'priced' : state === 'amber' ? 'line items present, not priced' : 'needs pricing';
  }
</script>

<svelte:head><title>Dashboard · Studio44</title></svelte:head>

<h1 class="greeting">Hi, {data.user.name.split(' ')[0]}.</h1>

{#if loading}
  <p class="muted">Loading…</p>
{:else if error || !dash}
  <div class="error">{error ?? 'Could not load the dashboard.'}</div>
{:else}
  {@const f = dash.funnel}
  {@const s = dash.stations}

  <!-- ── TOP: funnel vitals ── -->
  <div class="funnel">
    <div class="vital">
      <div class="v-label">Leads</div>
      <div class="v-big">{f.leads.total}</div>
      <div class="v-sub">
        {#if f.leads.this_week_delta > 0}<span class="delta">+{f.leads.this_week_delta} this week</span>{:else}<span class="muted">+0 this week</span>{/if}
      </div>
      <div class="v-foot muted">callable now: {f.leads.callable_now}</div>
    </div>

    <div class="arrow" aria-hidden="true">→</div>

    <div class="vital health-{f.prospects.health}">
      <div class="v-label">Prospects</div>
      <div class="v-big">{f.prospects.total}</div>
      <div class="v-sub">
        {f.prospects.digging} digging · <span class="pitch">{f.prospects.building_pitch} building pitch</span>
      </div>
      <div class="v-foot muted">avg in funnel: {f.prospects.avg_days_in_funnel} days</div>
    </div>

    <div class="arrow" aria-hidden="true">→</div>

    <div class="vital health-{f.presentations.health}">
      <div class="v-label">Presentations</div>
      <div class="v-big">{f.presentations.total}</div>
      <div class="v-sub health-text-{f.presentations.health}">{PRES_HEALTH_LABEL[f.presentations.health]}</div>
      <div class="v-foot muted">
        {#if f.presentations.next}next: {f.presentations.next.company}, {fmtShort(f.presentations.next.scheduled_at)}{:else}next: —{/if}
      </div>
    </div>
  </div>

  {#if f.presentations.health === 'crimson'}
    <p class="system-note"><span class="warn-dot">●</span> Presentations is thin — cold-calling target raised to keep the front fed.</p>
  {/if}

  <!-- ── BOTTOM: four work stations ── -->
  <div class="stations">
    <!-- 1. Cold calling -->
    <section class="station cold" class:priority>
      <header class="st-head">
        <h2>Cold calling &amp; outreach</h2>
        {#if priority}<span class="chip chip-amber">feed the pipe</span>{/if}
      </header>
      <div class="cc-count">{s.cold_calling.calls_this_week} of {s.cold_calling.effective_target} calls</div>
      <div class="bar"><div class="bar-fill" class:priority style={`width:${pct(s.cold_calling.calls_this_week, s.cold_calling.effective_target)}%`}></div></div>

      <div class="cc-actions">
        <a href={`${base}/leads/work`}><Button>Work →</Button></a>
      </div>

      <div class="target">
        <div class="target-label muted small">Suggested target (push it if you're up for it)</div>
        <div class="target-control">
          <button type="button" class="step" onclick={() => bumpTarget(-5)} disabled={ccSaving || s.cold_calling.effective_target <= 5} title="Lower target" aria-label="Lower target">−</button>
          <div class="target-num">
            <span class="big">{s.cold_calling.effective_target}</span>
            <span class="unit muted small">calls / week</span>
          </div>
          <button type="button" class="step" onclick={() => bumpTarget(5)} disabled={ccSaving || s.cold_calling.effective_target >= 100} title="Raise target" aria-label="Raise target">+</button>
        </div>
        <div class="reason muted small">{s.cold_calling.reason}</div>
        {#if ccError}<div class="cc-error">{ccError}</div>{/if}
      </div>
    </section>

    <!-- 2. Today's appointments -->
    <section class="station">
      <header class="st-head">
        <h2>Today · appointments</h2>
        {#if s.today_appointments.is_weekday}
          <span class="muted small">{bookedCount(s.today_appointments.slots)} booked · {s.today_appointments.slots.length - bookedCount(s.today_appointments.slots)} open</span>
        {/if}
      </header>
      {#if !s.today_appointments.is_weekday}
        <p class="muted empty">No appointments — weekend.</p>
      {:else}
        <ul class="slots">
          {#each s.today_appointments.slots as slot (slot.window)}
            <li class="slot">
              <span class="win muted small">{slot.window}</span>
              {#if slot.booked}
                <a class="slot-booked" href={`${base}/prospects/${slot.booked.opportunity_id}`}>
                  <span class="co">{slot.booked.company}</span>
                  <span class="alabel" class:pitch={slot.booked.mode === 'build_pitch'}>{slot.booked.assessment_label}</span>
                  <span class="go" aria-hidden="true">→</span>
                </a>
              {:else}
                <span class="slot-open">open — Alice can book</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- 3. Research & prep -->
    <section class="station">
      <header class="st-head">
        <h2>Research &amp; prep</h2>
        <span class="chip {s.research_and_prep.total > 0 ? 'chip-amber' : 'chip-calm'}">{s.research_and_prep.total} waiting</span>
      </header>
      {#if s.research_and_prep.waiting.length === 0}
        <p class="muted empty">Nothing waiting on prep.</p>
      {:else}
        <ul class="rows">
          {#each s.research_and_prep.waiting as r (r.assessment_id)}
            <li>
              <a class="prow" href={`${base}/prospects/${r.opportunity_id}`}>
                <span class="r-main">{r.company} — <span class="muted">{r.prep_type}</span></span>
                <span class="r-due muted small">by {fmtShort(r.due_at)}</span>
              </a>
            </li>
          {/each}
        </ul>
        {#if s.research_and_prep.total > s.research_and_prep.waiting.length}
          <p class="more muted small">+ {s.research_and_prep.total - s.research_and_prep.waiting.length} more</p>
        {/if}
      {/if}
      <div class="st-foot">
        {#if s.research_and_prep.waiting.length > 0}
          <a href={`${base}/prospects/${s.research_and_prep.waiting[0].opportunity_id}`}><Button variant="secondary">Work the prep →</Button></a>
        {:else}
          <Button variant="secondary" disabled>Work the prep →</Button>
        {/if}
      </div>
    </section>

    <!-- 4. Presentations -->
    <section class="station">
      <header class="st-head">
        <h2>Presentations</h2>
        {#if s.presentations.upcoming.length === 0}
          <span class="chip chip-muted">none upcoming</span>
        {:else if s.presentations.not_ready > 0}
          <span class="chip chip-crimson">{s.presentations.not_ready} not ready</span>
        {:else}
          <span class="chip chip-green">all ready</span>
        {/if}
      </header>
      {#if s.presentations.upcoming.length === 0}
        <p class="muted empty">No presentations upcoming.</p>
      {:else}
        <ul class="rows">
          {#each s.presentations.upcoming as p (p.opportunity_id)}
            <li class="prez">
              <a class="prez-main" href={`${base}/prospects/${p.opportunity_id}#handoff`}>
                <span class="co">{p.company}</span>
                <span class="when muted small">{fmtShort(p.scheduled_at)} · {inDays(p.scheduled_at)}</span>
              </a>
              <div class="pills">
                <span class="pill pill-{p.spec}" title={pillTitle('spec', p.spec)}>spec</span>
                <span class="pill pill-{p.demo}" title={pillTitle('demo', p.demo)}>demo</span>
                {#if p.demo === 'amber'}
                  <button type="button" class="mark-built" onclick={() => (markBuiltFor = { company: p.company, demo_spec_id: p.demo_spec_id })} title="Wiring next (step 5)">Mark built</button>
                {/if}
                <span class="pill pill-{p.price}" title={pillTitle('price', p.price)}>price</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="st-foot">
        {#if s.presentations.upcoming.length > 0}
          <a href={`${base}/prospects/${s.presentations.upcoming[0].opportunity_id}#handoff`}><Button variant="secondary">Work the pitches →</Button></a>
        {:else}
          <Button variant="secondary" disabled>Work the pitches →</Button>
        {/if}
      </div>
    </section>
  </div>
{/if}

<!-- Mark-built confirm dialog — renders, but Confirm is a no-op this step (wiring next). -->
{#if markBuiltFor}
  <div class="backdrop" role="presentation" onclick={() => (markBuiltFor = null)}></div>
  <div class="dialog surface" role="dialog" aria-modal="true" aria-labelledby="mb-title">
    <h2 id="mb-title">Mark demo built for {markBuiltFor.company}?</h2>
    <p class="muted small">This confirms the demo is built and uploaded.</p>
    <div class="dialog-actions">
      <Button variant="secondary" onclick={() => (markBuiltFor = null)}>Cancel</Button>
      <Button onclick={confirmMarkBuilt}>Confirm</Button>
    </div>
    <p class="muted small wiring">Wiring next (step 5) — Confirm does not yet save.</p>
  </div>
{/if}

<style>
  .greeting { margin-bottom: var(--space-4); }

  /* ── Funnel vitals ── */
  .funnel { display: flex; align-items: stretch; gap: var(--space-3); flex-wrap: wrap; }
  .vital {
    flex: 1; min-width: 200px;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--space-4) var(--space-6);
  }
  .vital.health-amber { border-color: rgba(250, 199, 117, 0.5); background: rgba(250, 199, 117, 0.04); }
  .vital.health-crimson { border-color: rgba(212, 11, 30, 0.5); background: rgba(212, 11, 30, 0.05); }
  .v-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-2); }
  .v-big { font-size: 2.4rem; font-weight: 700; line-height: 1.1; color: var(--text); }
  .v-sub { font-size: 0.9rem; color: var(--text); margin-top: 0.1rem; }
  .v-sub .pitch { color: var(--warning); }
  .v-foot { font-size: 0.8rem; margin-top: 0.25rem; }
  .delta { color: var(--success); }
  .health-text-crimson { color: var(--danger); }
  .health-text-amber { color: var(--warning); }
  .health-text-calm { color: var(--muted); }
  .arrow { display: flex; align-items: center; color: var(--muted-3); font-size: 1.2rem; }

  .system-note { margin: var(--space-3) 0 0; color: var(--warning); font-size: 0.9rem; }
  .warn-dot { color: var(--warning); }

  /* ── Stations grid ── */
  .stations { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin-top: var(--space-6); }
  @media (max-width: 760px) { .stations { grid-template-columns: 1fr; } }
  .station {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--space-4) var(--space-6); display: flex; flex-direction: column; gap: var(--space-3);
  }
  .station.cold.priority { border-color: rgba(212, 11, 30, 0.45); box-shadow: 0 0 0 1px rgba(212, 11, 30, 0.25), 0 6px 20px rgba(212, 11, 30, 0.12); }
  .st-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  .st-head h2 { margin: 0; font-size: 1.05rem; }
  .empty { margin: 0; }
  .st-foot { margin-top: auto; padding-top: var(--space-2); }

  .chip { font-size: 0.72rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); }
  .chip-amber { background: #2a1a0a; color: var(--warning); border-color: #854f0b66; }
  .chip-crimson { background: #15090b; color: var(--danger); border-color: #501313; }
  .chip-green { background: #0f1410; color: var(--success); border-color: #1d3a1f; }
  .chip-calm, .chip-muted { background: #161618; color: var(--muted); border-color: var(--border); }

  /* Cold calling */
  .cc-count { font-size: 1.1rem; font-weight: 600; color: var(--text); }
  .bar { height: 6px; background: var(--surface-2); border: 1px solid var(--border-soft); border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: rgba(212, 11, 30, 0.45); transition: width 0.2s ease; }
  .bar-fill.priority { background: var(--accent); }
  .cc-actions { margin: 0.1rem 0; }
  .target { border-top: 1px solid var(--border-soft); padding-top: var(--space-3); }
  .target-control { display: flex; align-items: center; gap: var(--space-4); margin: 0.4rem 0; }
  .step {
    width: 2rem; height: 2rem; border-radius: var(--radius); cursor: pointer; font: inherit; font-size: 1.1rem;
    background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
  }
  .step:hover:not(:disabled) { border-color: var(--muted); }
  .step:disabled { opacity: 0.45; cursor: not-allowed; }
  .target-num { display: flex; flex-direction: column; align-items: center; }
  .target-num .big { font-size: 1.8rem; font-weight: 700; line-height: 1; }
  .reason { margin-top: 0.2rem; }
  .cc-error { margin-top: 0.3rem; font-size: 0.78rem; color: var(--danger); }

  /* Today slots */
  .slots, .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .slot { display: flex; align-items: center; gap: var(--space-3); }
  .slot .win { flex-shrink: 0; width: 3.2rem; }
  .slot-booked { display: flex; align-items: center; gap: 0.5rem; flex: 1; text-decoration: none; color: var(--text); }
  .slot-booked:hover { text-decoration: none; }
  .slot-booked:hover .co { color: var(--accent); }
  .slot-booked .alabel { color: var(--muted); font-size: 0.82rem; }
  .slot-booked .alabel.pitch { color: var(--warning); }
  .slot-booked .go { margin-left: auto; color: var(--muted-3); }
  .slot-open { flex: 1; font-style: italic; color: var(--muted-3); font-size: 0.85rem; }

  /* Research rows */
  .prow { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); text-decoration: none; color: var(--text); padding: 0.2rem 0; }
  .prow:hover { text-decoration: none; }
  .prow:hover .r-main { color: var(--accent); }
  .more { margin: 0.2rem 0 0; }

  /* Presentations rows */
  .prez { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
  .prez-main { display: flex; flex-direction: column; gap: 0.05rem; text-decoration: none; color: var(--text); flex: 1; }
  .prez-main:hover { text-decoration: none; }
  .prez-main:hover .co { color: var(--accent); }
  .co { font-weight: 600; }
  .pills { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
  .pill { font-size: 0.68rem; font-weight: 600; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border); text-transform: lowercase; }
  .pill-green { background: #0f1410; color: var(--success); border-color: #1d3a1f; }
  .pill-amber { background: #2a1a0a; color: var(--warning); border-color: #854f0b66; }
  .pill-crimson { background: #15090b; color: var(--danger); border-color: #501313; }
  .mark-built {
    font-size: 0.68rem; cursor: pointer; font: inherit; font-weight: 600;
    background: transparent; color: var(--warning); border: 1px solid #854f0b66; border-radius: var(--radius);
    padding: 1px 6px;
  }
  .mark-built:hover { filter: brightness(1.12); }

  /* Mark-built dialog */
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 50; }
  .dialog {
    position: fixed; top: 22vh; left: 50%; transform: translateX(-50%);
    width: min(420px, 92vw); z-index: 51; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .dialog h2 { margin: 0 0 var(--space-2); font-size: 1.1rem; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
  .wiring { margin: var(--space-2) 0 0; text-align: right; }
</style>

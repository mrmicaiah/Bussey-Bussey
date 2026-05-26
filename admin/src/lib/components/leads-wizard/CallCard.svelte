<script lang="ts">
  // Studio44 Layer 1 — the call card (§2.2). READ-ONLY: outcome buttons advance
  // the loop in client state only. NONE of them persist anything (no logging, no
  // booking) — that is steps 4–5. The Alice slot is a dormant placeholder; the
  // capture strip is static informational UI showing what WILL be recorded later.
  import type {
    LeadCard,
    LeadActivity,
    ScriptVariantsByStage,
    ScriptVariantStage,
  } from '$lib/types';
  import CallFramework from './CallFramework.svelte';

  export type CardOutcome =
    | 'callback'
    | 'no_answer'
    | 'voicemail'
    | 'dead_number'
    | 'do_not_call';

  let {
    card,
    timeline,
    variants,
    selected,
    onpick,
    onoutcome,
    onbook,
    onskip,
    dwellLabel,
  }: {
    card: LeadCard;
    timeline: LeadActivity[];
    variants: ScriptVariantsByStage;
    selected: Record<ScriptVariantStage, string | null>;
    onpick: (stage: ScriptVariantStage, variantId: string) => void;
    onoutcome: (outcome: CardOutcome) => void;
    onbook: () => void;
    onskip: () => void;
    dwellLabel: string;
  } = $props();

  const inConversionZone = $derived(card.attempt_count >= 6);

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
  function activityLabel(a: LeadActivity): string {
    return (a.outcome ?? a.kind).replace(/_/g, ' ');
  }
</script>

<div class="card">
  <!-- LEFT: the work -->
  <div class="work">
    <div class="identity">
      <div class="company">{card.company ?? card.name ?? '(no company)'}</div>
      <div class="sub">
        {#if card.name}<span>{card.name}</span>{/if}
        {#if card.industry}<span class="dot">·</span><span>{card.industry}</span>{/if}
        {#if card.source}<span class="dot">·</span><span class="source">{card.source}</span>{/if}
      </div>
      <div class="contactlinks">
        {#if card.phone}<a href={`tel:${card.phone}`}>📞 {card.phone}</a>{/if}
        {#if card.email}<a href={`mailto:${card.email}`}>✉ {card.email}</a>{/if}
      </div>
    </div>

    <div class="attempt" class:zone={inConversionZone}>
      <span class="attempt-n">Attempt #{card.attempt_count + 1}</span>
      {#if inConversionZone}
        <span class="attempt-nudge">Conversion zone — most books happen after 6+ touches. Keep going.</span>
      {/if}
    </div>

    <section class="timeline">
      <h3>Prior calls</h3>
      {#if timeline.length === 0}
        <p class="empty">No prior calls logged. This is a fresh touch.</p>
      {:else}
        <ul>
          {#each timeline as a (a.id)}
            <li>
              <div class="t-head">
                <span class="t-outcome">{activityLabel(a)}</span>
                <span class="t-date">{fmtDate(a.created_at)}</span>
              </div>
              {#if a.notes}<p class="t-notes">{a.notes}</p>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="framework-wrap">
      <h3>Call framework</h3>
      <CallFramework {variants} {selected} {onpick} />
    </section>
  </div>

  <!-- RIGHT: actions + Alice -->
  <div class="actions">
    <button type="button" class="out out-book" onclick={onbook}>Booked assessment</button>
    <div class="out-grid">
      <button type="button" class="out out-neutral" onclick={() => onoutcome('callback')}>Call back</button>
      <button type="button" class="out out-neutral" onclick={() => onoutcome('no_answer')}>No answer</button>
      <button type="button" class="out out-neutral" onclick={() => onoutcome('voicemail')}>Voicemail</button>
      <button type="button" class="out out-neutral" onclick={() => onoutcome('dead_number')}>Dead number</button>
    </div>
    <button type="button" class="out out-dnc" onclick={() => onoutcome('do_not_call')}>Do not call</button>
    <button type="button" class="out out-skip" onclick={onskip}>Skip / snooze →</button>

    <!-- Dormant Alice coach slot — wires in Layer 4. No capability here. -->
    <div class="alice" aria-label="Alice coach panel (inactive)">
      <span class="alice-tag">Alice coach</span>
      <span class="alice-note">wires in L4</span>
    </div>

    <!-- Static: what this call WILL capture (persisted in a later step). -->
    <div class="capture">
      <div class="capture-title">This call will capture</div>
      <ul>
        <li>opener id · hook id</li>
        <li>industry · attempt #{card.attempt_count + 1}</li>
        <li>outcome · timestamp</li>
        <li>phone duration</li>
        <li>card time · <strong>{dwellLabel}</strong></li>
      </ul>
    </div>
  </div>
</div>

<style>
  .card { display: grid; grid-template-columns: 1fr 320px; gap: 1rem; align-items: start; }
  @media (max-width: 860px) { .card { grid-template-columns: 1fr; } }

  .work { display: flex; flex-direction: column; gap: 0.85rem; }

  .identity {
    background: var(--s44-surface, #141416);
    border: 1px solid var(--s44-border, #2a2a2e); border-radius: 8px; padding: 0.85rem 1rem;
  }
  .company { font-size: 1.25rem; font-weight: 700; color: var(--s44-text, #f4f4f5); }
  .sub { color: var(--s44-muted, #a1a1aa); font-size: 0.88rem; margin-top: 0.2rem; display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .sub .dot { opacity: 0.5; }
  .sub .source { text-transform: capitalize; }
  .contactlinks { display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.88rem; }
  .contactlinks a { color: var(--s44-crimson, #d40b1e); text-decoration: none; }
  .contactlinks a:hover { text-decoration: underline; }

  .attempt {
    display: flex; flex-direction: column; gap: 0.2rem;
    background: rgba(245, 166, 35, 0.08);
    border: 1px solid rgba(245, 166, 35, 0.4); border-radius: 8px; padding: 0.5rem 0.8rem;
  }
  .attempt-n { color: var(--s44-amber, #f5a623); font-weight: 700; font-size: 0.9rem; }
  .attempt.zone { background: rgba(245, 166, 35, 0.14); border-color: var(--s44-amber, #f5a623); }
  .attempt-nudge { color: var(--s44-amber, #f5a623); font-size: 0.78rem; }

  .timeline h3, .framework-wrap h3 {
    margin: 0 0 0.45rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--s44-muted, #a1a1aa);
  }
  .timeline ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .timeline li { border-left: 2px solid var(--s44-crimson, #d40b1e); padding: 0.1rem 0 0.1rem 0.7rem; }
  .t-head { display: flex; justify-content: space-between; gap: 0.5rem; }
  .t-outcome { color: var(--s44-text, #f4f4f5); font-size: 0.85rem; text-transform: capitalize; font-weight: 500; }
  .t-date { color: var(--s44-muted, #a1a1aa); font-size: 0.76rem; }
  .t-notes { margin: 0.2rem 0 0; color: var(--s44-muted, #a1a1aa); font-size: 0.82rem; white-space: pre-wrap; }
  .empty { margin: 0; color: var(--s44-muted, #a1a1aa); font-size: 0.85rem; font-style: italic; }

  .actions { display: flex; flex-direction: column; gap: 0.5rem; position: sticky; top: 1rem; }
  .out {
    width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px; font: inherit; font-weight: 600;
    cursor: pointer; border: 1px solid transparent; transition: filter 0.1s ease;
  }
  .out:hover { filter: brightness(1.12); }
  .out-book { background: var(--s44-crimson, #d40b1e); color: #fff; font-size: 1rem; padding: 0.8rem; }
  .out-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .out-neutral {
    background: var(--s44-surface-2, #1c1c1f); color: var(--s44-text, #f4f4f5);
    border-color: var(--s44-border, #2a2a2e); font-weight: 500;
  }
  .out-dnc { background: transparent; color: #f87171; border-color: #7f1d1d; }
  .out-skip { background: transparent; color: var(--s44-muted, #a1a1aa); border-color: transparent; font-weight: 500; }
  .out-skip:hover { color: var(--s44-text, #f4f4f5); filter: none; }

  .alice {
    margin-top: 0.4rem; border: 1px dashed var(--s44-border, #2a2a2e); border-radius: 8px;
    padding: 0.9rem 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
    background: repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.012) 8px, rgba(255,255,255,0.012) 16px);
  }
  .alice-tag { color: var(--s44-muted, #a1a1aa); font-weight: 600; font-size: 0.85rem; }
  .alice-note { color: var(--s44-muted, #a1a1aa); font-size: 0.72rem; opacity: 0.75; }

  .capture { border: 1px solid var(--s44-border, #2a2a2e); border-radius: 8px; padding: 0.6rem 0.75rem; }
  .capture-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--s44-muted, #a1a1aa); margin-bottom: 0.35rem; }
  .capture ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .capture li { font-size: 0.76rem; color: var(--s44-muted, #a1a1aa); }
  .capture strong { color: var(--s44-text, #f4f4f5); }
</style>

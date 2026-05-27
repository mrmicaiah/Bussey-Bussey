<script lang="ts">
  // Studio44 Layer 2 — Prospects list (§6). READ-ONLY: consumes GET /api/admin/prospects.
  // Operator language only — "prospects" + "assessments", never client/opportunity.
  // Dark palette declared on the .s44 wrapper below — scoped to this route.
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type { ProspectsListResponse, ProspectListItem } from '$lib/types';

  let prospects = $state<ProspectListItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.get<ProspectsListResponse>('/api/admin/prospects');
      prospects = res.prospects;
    } catch (e) {
      error = e instanceof ApiError ? `Failed to load (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function fmtAppt(iso: string | null): string {
    if (!iso) return 'No appointment set';
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
</script>

<svelte:head><title>Prospects · Studio44</title></svelte:head>

<div class="s44">
  <header class="hd">
    <div>
      <span class="brand">Studio44</span>
      <h1>Prospects</h1>
    </div>
    <span class="count">{prospects.length} {prospects.length === 1 ? 'prospect' : 'prospects'}</span>
  </header>

  {#if error}<div class="err">{error}</div>{/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if prospects.length === 0}
    <div class="empty">
      <p>No prospects yet.</p>
      <p class="muted small">Book an assessment from <a href={`${base}/leads/work`}>Work leads</a> and the prospect lands here.</p>
    </div>
  {:else}
    <ul class="list">
      {#each prospects as p (p.id)}
        <li>
          <a class="row" href={`${base}/prospects/${p.id}`}>
            <div class="who">
              <span class="company">{p.company}</span>
              <span class="sub">
                {#if p.contact}{p.contact}{/if}{#if p.contact && p.industry} · {/if}{#if p.industry}{p.industry}{/if}
              </span>
            </div>
            <div class="meta">
              <span class="assessments">{p.assessment_count} {p.assessment_count === 1 ? 'assessment' : 'assessments'}</span>
              <span class="appt" class:none={!p.next_appointment_at}>{fmtAppt(p.next_appointment_at)}</span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
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
    background: var(--s44-bg);
    color: var(--s44-text);
    border: 1px solid var(--s44-border);
    border-radius: 12px;
    padding: 1.25rem;
    min-height: 70vh;
  }
  .brand { font-weight: 800; letter-spacing: 0.04em; color: var(--s44-text); font-size: 0.8rem; opacity: 0.7; }
  .hd { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.25rem; padding-bottom: 0.9rem; border-bottom: 1px solid var(--s44-border); }
  .hd h1 { margin: 0.15rem 0 0; color: var(--s44-text); font-size: 1.5rem; }
  .count { color: var(--s44-muted); font-size: 0.85rem; }
  .muted { color: var(--s44-muted); }
  .small { font-size: 0.85rem; }
  .err {
    background: rgba(212, 11, 30, 0.12); border: 1px solid var(--s44-crimson);
    color: #fca5a5; border-radius: 8px; padding: 0.7rem 0.9rem; margin-bottom: 1rem; font-size: 0.9rem;
  }
  .empty { color: var(--s44-text); }
  .empty a { color: var(--s44-crimson); text-decoration: none; }
  .empty a:hover { text-decoration: underline; }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .row {
    display: flex; justify-content: space-between; align-items: center; gap: 1rem;
    padding: 0.8rem 1rem; border: 1px solid var(--s44-border); border-radius: 10px;
    background: var(--s44-surface); text-decoration: none; color: inherit;
  }
  .row:hover { border-color: var(--s44-crimson); }
  .who { display: flex; flex-direction: column; gap: 0.15rem; }
  .company { font-weight: 700; font-size: 1.05rem; color: var(--s44-text); }
  .sub { color: var(--s44-muted); font-size: 0.85rem; }
  .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 0.2rem; flex-shrink: 0; }
  .assessments { color: var(--s44-muted); font-size: 0.8rem; }
  .appt { color: var(--s44-text); font-size: 0.85rem; }
  .appt.none { color: var(--s44-muted); font-style: italic; }
</style>

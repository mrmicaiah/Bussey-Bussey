<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';

  type ProjectStatus = {
    id: string;
    name: string;
    current_phase: string | null;
    build_status_note: string | null;
    next_milestone: string | null;
    created_at: string;
    updated_at: string | null;
  };

  let project = $state<ProjectStatus | null>(null);
  let loaded = $state(false);

  function fmt(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : '—';
  }

  onMount(async () => {
    try {
      const res = await api.get<{ project: ProjectStatus }>('/api/portal/project-status');
      project = res.project;
    } catch {
      project = null;
    } finally {
      loaded = true;
    }
  });
</script>

<svelte:head><title>Project status · Bussey Client Portal</title></svelte:head>

<h1>Project status</h1>
<p class="muted">Where we are on delivery. Updated by your Bussey contact.</p>

{#if !loaded}
  <p class="muted">Loading…</p>
{:else if !project}
  <div class="surface" style="margin-top: var(--space-4);">
    <p class="muted">No project linked yet.</p>
  </div>
{:else}
  <div class="surface" style="margin-top: var(--space-4);">
    <h2 style="margin-top: 0;">{project.name}</h2>
    <div class="kv"><span class="muted">Current phase</span><span>{project.current_phase ?? '—'}</span></div>
    <div class="kv"><span class="muted">Next milestone</span><span>{project.next_milestone ?? '—'}</span></div>
    <div class="kv"><span class="muted">Started</span><span>{fmt(project.created_at)}</span></div>
    <div class="kv"><span class="muted">Last update</span><span>{fmt(project.updated_at)}</span></div>
    {#if project.build_status_note}
      <h3 style="margin-top: var(--space-4);">Latest note</h3>
      <p class="note">{project.build_status_note}</p>
    {/if}
  </div>
{/if}

<style>
  h1 { margin-bottom: var(--space-2); }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .kv:last-of-type { border-bottom: 0; }
  .note {
    background: #fafaf8;
    border: 1px solid var(--border);
    padding: 0.8rem 1rem;
    border-radius: var(--radius);
    white-space: pre-wrap;
    margin: 0;
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api } from '$lib/api';

  type Doc = {
    doc_type: 'contract' | 'proposal' | 'change_order';
    doc_id: string;
    title: string;
    status: string;
    signed_at: string | null;
    created_at: string;
    setup_delta?: number;
    monthly_delta?: number;
  };

  let docs = $state<Doc[]>([]);
  let loaded = $state(false);

  function fmtDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  }
  function labelType(t: Doc['doc_type']): string {
    return t === 'contract' ? 'Contract' : t === 'proposal' ? 'Proposal' : 'Change order';
  }

  onMount(async () => {
    try {
      const res = await api.get<{ documents: Doc[] }>('/api/portal/documents');
      docs = res.documents;
    } catch {
      docs = [];
    } finally {
      loaded = true;
    }
  });
</script>

<svelte:head><title>Documents · Bussey Client Portal</title></svelte:head>

<h1>Documents</h1>
<p class="muted">Your contracts, proposal, and change orders — view, download, and audit signatures.</p>

{#if !loaded}
  <p class="muted">Loading…</p>
{:else if docs.length === 0}
  <div class="surface" style="margin-top: var(--space-4);">
    <p class="muted">No documents yet.</p>
  </div>
{:else}
  <div class="list">
    {#each docs as d (`${d.doc_type}:${d.doc_id}`)}
      <a class="card surface" href={`${base}/documents/${d.doc_type}/${d.doc_id}`}>
        <div class="card-head">
          <div>
            <strong>{d.title}</strong>
            <span class="muted small"> · {labelType(d.doc_type)}</span>
          </div>
          <span class="badge">{d.status}</span>
        </div>
        <div class="muted small">
          {d.signed_at ? `Signed ${fmtDate(d.signed_at)}` : `Issued ${fmtDate(d.created_at)}`}
        </div>
      </a>
    {/each}
  </div>
{/if}

<style>
  h1 { margin-bottom: var(--space-2); }
  .list { display: flex; flex-direction: column; gap: 0.6rem; margin-top: var(--space-4); }
  .card { display: flex; flex-direction: column; gap: 0.4rem; color: inherit; text-decoration: none; }
  .card:hover { border-color: var(--accent); }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.78rem;
    background: #ececea;
    color: var(--muted);
    text-transform: capitalize;
  }
</style>

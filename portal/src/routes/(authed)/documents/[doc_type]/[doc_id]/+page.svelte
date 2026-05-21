<script lang="ts">
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  type Signature = {
    id: string;
    signature_type: string;
    typed_name: string | null;
    typed_initials: string | null;
    ip_address: string | null;
    signed_at: string;
  };

  type Doc = {
    doc_type: 'contract' | 'proposal' | 'change_order';
    doc_id: string;
    title: string;
    body: string;
    signed_at: string | null;
    generated_at: string;
    signatures: Signature[];
  };

  const docType = $derived(page.params['doc_type']!);
  const docId = $derived(page.params['doc_id']!);

  let doc = $state<Doc | null>(null);
  let loadError = $state<string | null>(null);

  marked.setOptions({ gfm: true, breaks: false });
  const rendered = $derived(doc ? (marked.parse(doc.body, { async: false }) as string) : '');

  onMount(async () => {
    try {
      doc = await api.get<Doc>(`/api/portal/documents/${docType}/${docId}`);
    } catch (e) {
      loadError = e instanceof ApiError ? `Load failed (${e.errorCode ?? e.status}).` : 'Network error.';
    }
  });

  function download() {
    if (!doc) return;
    const blob = new Blob([doc.body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = doc.title.replace(/[^\w-]+/g, '_');
    a.href = url;
    a.download = `${safe}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>{doc?.title ?? 'Document'} · Bussey Client Portal</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-3);">
  <a href={`${base}/documents`} class="muted small">← Documents</a>
</div>

{#if loadError}
  <div class="error">{loadError}</div>
{:else if !doc}
  <p class="muted">Loading…</p>
{:else}
  <div class="row" style="justify-content: space-between; align-items: flex-start;">
    <div>
      <h1>{doc.title}</h1>
      <p class="muted small">
        {doc.signed_at ? `Signed ${new Date(doc.signed_at).toLocaleString()}` : `Issued ${new Date(doc.generated_at).toLocaleString()}`}
      </p>
    </div>
    <Button variant="secondary" onclick={download}>Download (.md)</Button>
  </div>

  <article class="body surface">
    {@html rendered}
  </article>

  {#if doc.signatures.length > 0}
    <div class="surface" style="margin-top: var(--space-4);">
      <h2>Signature audit</h2>
      <table>
        <thead>
          <tr><th>Type</th><th>Signed value</th><th>IP</th><th>When</th></tr>
        </thead>
        <tbody>
          {#each doc.signatures as s (s.id)}
            <tr>
              <td>{s.signature_type}</td>
              <td>{s.typed_name ?? s.typed_initials ?? '—'}</td>
              <td class="muted small">{s.ip_address ?? '—'}</td>
              <td class="muted small">{new Date(s.signed_at).toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

<style>
  .body {
    line-height: 1.55;
    max-height: 70vh;
    overflow-y: auto;
  }
  .body :global(h1) { font-size: 1.35rem; margin-top: 0; }
  .body :global(h2) { font-size: 1.1rem; margin-top: 1.4rem; }
  .body :global(p) { margin: 0.6rem 0; }
  .body :global(ul) { padding-left: 1.4rem; margin: 0.6rem 0; }
  .body :global(blockquote) {
    border-left: 3px solid var(--border);
    margin: 0.6rem 0;
    padding: 0.2rem 0 0.2rem 0.8rem;
    color: var(--muted);
  }
  .body :global(hr) {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 1rem 0;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); font-size: 0.92rem; }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
</style>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';

  type ImportResult = {
    summary: { total_rows: number; created: number; updated: number; skipped: number; errors: number };
    row_errors: Array<{ line: number; reason: string }>;
    skipped: Array<{ line: number; reason: string; matched_id?: string }>;
    updated: Array<{ line: number; matched_id: string }>;
  };

  let mode = $state<'skip' | 'update' | 'create_anyway'>('skip');
  let csvText = $state('');
  let fileName = $state<string | null>(null);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let result = $state<ImportResult | null>(null);

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileName = file.name;
    csvText = await file.text();
  }

  async function submit() {
    if (!csvText.trim()) {
      error = 'Pick a CSV file or paste content.';
      return;
    }
    submitting = true;
    error = null;
    result = null;
    try {
      // Send raw CSV as the body. content-type is informational; the
      // worker reads the body as text regardless.
      const res = await fetch(`/api/admin/calling-list/import?mode=${mode}`, {
        method: 'POST',
        body: csvText,
        headers: { 'content-type': 'text/csv' },
        credentials: 'include',
      });
      const body = (await res.json()) as ImportResult & { error?: string; message?: string };
      if (!res.ok) {
        error = body.message ?? body.error ?? `Import failed (${res.status}).`;
        return;
      }
      result = body;
    } catch (e) {
      error = e instanceof ApiError ? `Import failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Import calling list · Studio44</title></svelte:head>

<div class="row" style="margin-bottom: var(--space-3);">
  <a href={`${base}/calling-list`} class="muted small">← Calling list</a>
</div>

<h1>Import calling list (CSV)</h1>
<p class="muted">
  Required columns: <code>company_name</code>, <code>call_date</code> (YYYY-MM-DD), and one of
  <code>contact_email</code> or <code>contact_phone</code>. Optional:
  <code>contact_name</code>, <code>industry</code>, <code>source</code>, <code>notes</code>.
  Any extra columns are stored as JSON on each row.
</p>

<div class="surface" style="margin-top: var(--space-4);">
  <Field label="CSV file">
    <input type="file" accept=".csv,text/csv" onchange={onFile} />
  </Field>
  {#if fileName}<p class="muted small">Selected: {fileName} ({csvText.length.toLocaleString()} chars)</p>{/if}
  <Field label="Or paste CSV content">
    <textarea bind:value={csvText} rows="6" placeholder="company_name,contact_email,call_date,..."></textarea>
  </Field>

  <Field label="Duplicate handling">
    <select bind:value={mode}>
      <option value="skip">Skip — do nothing for matches</option>
      <option value="update">Update — overwrite the existing card</option>
      <option value="create_anyway">Create anyway — allow duplicates</option>
    </select>
  </Field>

  {#if error}<div class="error">{error}</div>{/if}

  <div class="row">
    <Button onclick={submit} disabled={submitting || !csvText.trim()}>
      {submitting ? 'Importing…' : 'Import'}
    </Button>
  </div>
</div>

{#if result}
  <div class="surface" style="margin-top: var(--space-4);">
    <h2>Import summary</h2>
    <div class="grid">
      <div><strong>{result.summary.total_rows}</strong><span class="muted small"> total rows</span></div>
      <div class="success-text"><strong>{result.summary.created}</strong><span class="muted small"> created</span></div>
      <div><strong>{result.summary.updated}</strong><span class="muted small"> updated</span></div>
      <div><strong>{result.summary.skipped}</strong><span class="muted small"> skipped</span></div>
      <div class="danger-text"><strong>{result.summary.errors}</strong><span class="muted small"> errors</span></div>
    </div>

    {#if result.row_errors.length > 0}
      <h3 style="margin-top: var(--space-4);">Per-row errors</h3>
      <table>
        <thead><tr><th>Line</th><th>Reason</th></tr></thead>
        <tbody>
          {#each result.row_errors as e}
            <tr><td>{e.line}</td><td>{e.reason}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if result.skipped.length > 0}
      <h3 style="margin-top: var(--space-4);">Skipped (duplicates)</h3>
      <table>
        <thead><tr><th>Line</th><th>Reason</th><th>Existing ID</th></tr></thead>
        <tbody>
          {#each result.skipped as s}
            <tr><td>{s.line}</td><td>{s.reason}</td><td class="muted small">{s.matched_id ?? '—'}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <div class="row" style="margin-top: var(--space-4);">
      <a href={`${base}/calling-list/today`}><Button>View today's cards</Button></a>
      <a href={`${base}/calling-list`}><Button variant="secondary">All cards</Button></a>
    </div>
  </div>
{/if}

<style>
  h1 { margin-bottom: var(--space-2); }
  code { background: rgba(0,0,0,0.06); padding: 0 0.3rem; border-radius: 4px; font-size: 0.85rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .grid div { font-size: 1.2rem; display: flex; flex-direction: column; gap: 0.2rem; }
  .grid .muted { font-size: 0.8rem; }
  .success-text strong { color: var(--success); }
  .danger-text strong { color: var(--danger); }
  table { width: 100%; border-collapse: collapse; margin-top: var(--space-3); }
  th, td { text-align: left; padding: 0.45rem 0.7rem; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
  th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
</style>

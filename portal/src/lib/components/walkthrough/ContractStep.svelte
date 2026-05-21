<script lang="ts">
  import { marked } from 'marked';
  import Button from '../Button.svelte';
  import Field from '../Field.svelte';
  import { api, ApiError } from '$lib/api';

  type MarkerKind = 'sig' | 'print' | 'initial' | 'date';
  type Marker = { kind: MarkerKind; label: string; key: string };

  let {
    contractBody,
    contractSignedAt,
    onAdvance,
  }: {
    contractBody: string;
    contractSignedAt: string | null;
    onAdvance: () => Promise<void> | void;
  } = $props();

  // Configure marked: GitHub-flavored markdown without HTML passthrough so
  // we don't have to worry about template content opening tags.
  marked.setOptions({ gfm: true, breaks: false });

  const todayIso = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Extract every marker in declaration order. Markers are uniquely keyed by
  // their full `kind:label`.
  const MARKER_REGEX = /\{\{(sig|print|initial|date):([A-Za-z0-9_]+)\}\}/g;
  const markers: Marker[] = (() => {
    const found = new Map<string, Marker>();
    for (const m of contractBody.matchAll(MARKER_REGEX)) {
      const kind = m[1] as MarkerKind;
      const label = m[2] as string;
      const key = `${kind}:${label}`;
      if (!found.has(key)) found.set(key, { kind, label, key });
    }
    return [...found.values()];
  })();

  // Typed values, keyed by marker. Date markers auto-fill on mount.
  let values = $state<Record<string, string>>({});
  for (const m of markers) {
    if (m.kind === 'date') values[m.key] = todayIso;
  }

  let agreementChecked = $state(false);
  let agreementName = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  // Modal state.
  let modalMarker = $state<Marker | null>(null);
  let modalDraft = $state('');

  // Render markdown → HTML, then replace markers with sentinel button elements.
  // Re-runs whenever any value changes so the buttons reflect the latest input.
  const renderedHtml = $derived.by(() => {
    const html = marked.parse(contractBody, { async: false }) as string;
    return html.replace(MARKER_REGEX, (_match, kind, label) => {
      const key = `${kind}:${label}`;
      const val = values[key] ?? '';
      const filled = val.length > 0;
      const ariaLabel = `${labelForKind(kind as MarkerKind)} — ${label.replace(/_/g, ' ')}`;
      const display = filled
        ? escapeHtml(val)
        : placeholderForKind(kind as MarkerKind);
      const cls = `marker marker-${kind} ${filled ? 'marker-filled' : 'marker-empty'}`;
      // The data-marker attribute is what the click handler uses to dispatch.
      // Buttons are typed inline so they're not submitting the surrounding form.
      return `<button type="button" class="${cls}" data-marker="${escapeAttr(key)}" data-kind="${kind}" data-label="${escapeAttr(label)}" aria-label="${escapeAttr(ariaLabel)}">${display}</button>`;
    });
  });

  function labelForKind(k: MarkerKind): string {
    return k === 'sig' ? 'Sign' : k === 'initial' ? 'Initials' : k === 'print' ? 'Printed' : 'Date';
  }
  function placeholderForKind(k: MarkerKind): string {
    return k === 'sig'
      ? '✎ Sign here'
      : k === 'initial'
        ? '✎ Initials'
        : k === 'print'
          ? '✎ Type here'
          : '— date —';
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s: string): string {
    return escapeHtml(s);
  }

  function onContainerClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest('button[data-marker]') as HTMLButtonElement | null;
    if (!btn) return;
    const kind = btn.dataset['kind'] as MarkerKind | undefined;
    const label = btn.dataset['label'];
    const markerKey = btn.dataset['marker'];
    if (!kind || !label || !markerKey) return;
    if (kind === 'date') {
      // Date markers are read-only — auto-filled, not clickable. No-op.
      return;
    }
    modalMarker = { kind, label, key: markerKey };
    // Pre-fill: for `print`, default to the most recent typed name from any
    // sig marker, then any other print value, then empty.
    if (kind === 'print') {
      const lastSig = Object.entries(values)
        .filter(([k]) => k.startsWith('sig:'))
        .map(([, v]) => v)
        .filter(Boolean)
        .at(-1);
      modalDraft = lastSig ?? values[markerKey] ?? '';
    } else {
      modalDraft = values[markerKey] ?? '';
    }
  }

  function commitModal() {
    if (!modalMarker) return;
    const v = modalDraft.trim();
    if (!v) return;
    values[modalMarker.key] = v;
    modalMarker = null;
    modalDraft = '';
  }
  function cancelModal() {
    modalMarker = null;
    modalDraft = '';
  }

  const allMarkersFilled = $derived(
    markers.every((m) => (values[m.key] ?? '').trim().length > 0),
  );
  const canSubmit = $derived(
    allMarkersFilled && agreementChecked && agreementName.trim().length > 0,
  );

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    submitError = null;
    submitting = true;
    try {
      const signatures = markers.map((m) => ({
        marker: m.key,
        kind: m.kind,
        label: m.label,
        typed_value: values[m.key] ?? '',
      }));
      await api.post('/api/portal/walkthrough/sign-contract', {
        signatures,
        agreement_typed_name: agreementName.trim(),
      });
      await onAdvance();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errorCode === 'markers_missing') {
          submitError = 'One or more required fields are missing — please fill every signature/initial line.';
        } else if (err.errorCode === 'state_machine_violation') {
          submitError = 'This step is no longer available — refreshing.';
        } else {
          submitError = `Submission failed (${err.errorCode ?? err.status}).`;
        }
      } else {
        submitError = 'Network error — try again.';
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="surface step">
  <h1>Review and sign the contract</h1>
  <p class="muted">
    Read through, fill in each <strong>Sign</strong>, <strong>Initials</strong>,
    and <strong>Printed</strong> field, then agree at the bottom. Date fields
    are filled in automatically.
  </p>

  {#if contractSignedAt}
    <div class="success">
      Signed on {new Date(contractSignedAt).toLocaleString()}.
    </div>
  {/if}

  <!-- Click events are delegated to the marker buttons inside; keyboard
       activation works natively through the buttons themselves. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <article
    class="contract"
    onclick={onContainerClick}
    role="document"
    aria-label="Master Service Agreement"
  >
    {@html renderedHtml}
  </article>

  <form class="agreement col" onsubmit={onSubmit}>
    <label class="checkbox">
      <input type="checkbox" bind:checked={agreementChecked} />
      <span>I have read and agree to the above contract.</span>
    </label>

    <Field label="Type your full legal name to sign">
      <input
        type="text"
        autocomplete="name"
        placeholder="e.g. Pat Tester"
        bind:value={agreementName}
      />
    </Field>

    {#if submitError}<div class="error">{submitError}</div>{/if}

    <div class="cta">
      <Button type="submit" disabled={!canSubmit || submitting}>
        {submitting ? 'Submitting…' : 'Sign and continue'}
      </Button>
      {#if !allMarkersFilled}
        <span class="muted small">
          {markers.filter((m) => (values[m.key] ?? '').trim().length === 0).length}
          field(s) left to fill.
        </span>
      {/if}
    </div>
  </form>
</div>

{#if modalMarker}
  {@const m = modalMarker}
  <div class="backdrop" role="presentation" onclick={cancelModal}></div>
  <div class="modal surface" role="dialog" aria-modal="true" aria-labelledby="marker-modal-title">
    <h2 id="marker-modal-title">
      {m.kind === 'sig'
        ? 'Sign here'
        : m.kind === 'initial'
          ? 'Initial here'
          : 'Type to print'}
    </h2>
    <p class="muted small">
      {m.kind === 'sig'
        ? 'Type your full legal name. This becomes your signature on this line.'
        : m.kind === 'initial'
          ? 'Type your initials.'
          : 'Type the text that should appear on this line.'}
    </p>
    <Field label={m.kind === 'sig' ? 'Full legal name' : m.kind === 'initial' ? 'Initials' : 'Value'}>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        autofocus
        bind:value={modalDraft}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitModal(); } }}
      />
    </Field>
    <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4);">
      <Button variant="secondary" onclick={cancelModal}>Cancel</Button>
      <Button onclick={commitModal} disabled={modalDraft.trim().length === 0}>
        Save
      </Button>
    </div>
  </div>
{/if}

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-4); }
  .contract {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-6);
    max-height: 60vh;
    overflow-y: auto;
    line-height: 1.55;
  }
  .contract :global(h1) { font-size: 1.35rem; margin-top: 0; }
  .contract :global(h2) { font-size: 1.1rem; margin-top: 1.4rem; }
  .contract :global(p)  { margin: 0.6rem 0; }
  .contract :global(ul) { padding-left: 1.4rem; margin: 0.6rem 0; }
  .contract :global(blockquote) {
    border-left: 3px solid var(--border);
    margin: 0.6rem 0;
    padding: 0.2rem 0 0.2rem 0.8rem;
    color: var(--muted);
  }
  .contract :global(hr) {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 1rem 0;
  }

  .contract :global(.marker) {
    display: inline-block;
    background: #fff4d9;
    border: 1px dashed #b15c00;
    border-radius: 4px;
    padding: 0.05rem 0.45rem;
    font: inherit;
    font-size: 0.92rem;
    color: #8a5a00;
    cursor: pointer;
    transition: background 0.1s ease, border-color 0.1s ease;
  }
  .contract :global(.marker:hover) { background: #ffe7a8; }
  .contract :global(.marker-filled) {
    background: #d8e8d8;
    border-style: solid;
    border-color: var(--success);
    color: var(--text);
    font-weight: 500;
  }
  .contract :global(.marker-date) {
    cursor: default;
    background: #ececea;
    border-color: var(--border);
    color: var(--muted);
  }

  .agreement {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4) var(--space-6);
    gap: var(--space-4);
  }
  .checkbox { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.95rem; }
  .checkbox input { margin-top: 0.2rem; }

  .cta { display: flex; align-items: center; gap: var(--space-3); }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 50;
  }
  .modal {
    position: fixed;
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, 92vw);
    z-index: 51;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>

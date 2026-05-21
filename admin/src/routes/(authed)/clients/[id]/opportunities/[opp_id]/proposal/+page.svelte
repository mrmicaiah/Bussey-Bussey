<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import type {
    Client,
    Opportunity,
    Proposal,
    ProposalDetail,
    ProposalLineItem,
    ProposalModifiers,
    ProposalSnapshot,
    PricingComponent,
    PricingDisplayMode,
  } from '$lib/types';
  import Button from '$lib/components/Button.svelte';
  import ComponentPalette from '$lib/components/ComponentPalette.svelte';
  import LineItemRow from '$lib/components/LineItemRow.svelte';
  import ModifiersBar from '$lib/components/ModifiersBar.svelte';
  import TotalsPanel from '$lib/components/TotalsPanel.svelte';
  import PresentationNotesDrawer from '$lib/components/PresentationNotesDrawer.svelte';
  import ProposalStatusBanner from '$lib/components/ProposalStatusBanner.svelte';

  const clientId = $derived(page.params['id']!);
  const oppId = $derived(page.params['opp_id']!);

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let proposal = $state<Proposal | null>(null);
  let lineItems = $state<ProposalLineItem[]>([]);
  let snapshot = $state<ProposalSnapshot | null>(null); // cached client-side; never re-fetched
  let components = $state<PricingComponent[]>([]);
  let client = $state<Client | null>(null);
  let opportunity = $state<Opportunity | null>(null);
  let flushNotesKey = $state(0);

  const readOnly = $derived(proposal != null && proposal.status !== 'draft' && proposal.status !== 'sent');

  async function bootstrap() {
    loading = true;
    loadError = null;
    try {
      // Parallel: client, opportunity, live pricing_components, existing proposals.
      const [{ client: c }, { opportunity: o }, { components: comps }, propsRes] = await Promise.all([
        api.get<{ client: Client }>(`/api/admin/clients/${clientId}`),
        api.get<{ opportunity: Opportunity }>(`/api/admin/opportunities/${oppId}`),
        api.get<{ components: PricingComponent[] }>(`/api/admin/pricing-components`),
        api.get<{ proposals: Proposal[] }>(`/api/admin/proposals?opportunity_id=${oppId}`),
      ]);
      client = c;
      opportunity = o;
      components = comps;

      // Pick the proposal to open: prefer accepted, then sent, then draft, then most recent of others.
      const ordered = [...propsRes.proposals].sort((a, b) => {
        const rank = (s: string) => (s === 'accepted' ? 1 : s === 'sent' ? 2 : s === 'draft' ? 3 : 4);
        const ra = rank(a.status);
        const rb = rank(b.status);
        if (ra !== rb) return ra - rb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      let target = ordered[0];

      // If no proposals exist, create a fresh draft.
      if (!target) {
        const created = await api.post<ProposalDetail>('/api/admin/proposals', {
          opportunity_id: oppId,
          name: o.name,
        });
        proposal = created.proposal;
        lineItems = created.line_items;
        snapshot = created.snapshot;
        loading = false;
        return;
      }

      // Otherwise load the picked proposal's full detail (which includes the snapshot).
      const detail = await api.get<ProposalDetail>(`/api/admin/proposals/${target.id}`);
      proposal = detail.proposal;
      lineItems = detail.line_items;
      snapshot = detail.snapshot;
    } catch (e) {
      loadError = e instanceof ApiError ? `Failed to load (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      loading = false;
    }
  }

  // Line item operations.

  async function addLine(code: string, opts?: { unit_price?: number; description_override?: string | null }) {
    if (!proposal) return;
    try {
      const body: Record<string, unknown> = { component_code: code };
      if (opts?.unit_price !== undefined) body['unit_price'] = opts.unit_price;
      if (opts?.description_override !== undefined) body['description_override'] = opts.description_override;
      const res = await api.post<{ line_item: ProposalLineItem; proposal: Proposal }>(
        `/api/admin/proposals/${proposal.id}/line-items`,
        body,
      );
      lineItems = [...lineItems, res.line_item];
      proposal = res.proposal;
    } catch (e) {
      alert(e instanceof ApiError ? `Add failed: ${e.errorCode ?? e.status}` : 'Network error.');
    }
  }

  async function updateLine(lineId: string, fields: { quantity?: number; description_override?: string | null; unit_price?: number }) {
    if (!proposal) return;
    const res = await api.put<{ line_item: ProposalLineItem; proposal: Proposal }>(
      `/api/admin/proposals/${proposal.id}/line-items/${lineId}`,
      fields,
    );
    lineItems = lineItems.map((li) => (li.id === lineId ? res.line_item : li));
    proposal = res.proposal;
  }

  async function removeLine(lineId: string) {
    if (!proposal) return;
    const res = await api.delete<{ ok: boolean; proposal: Proposal }>(`/api/admin/proposals/${proposal.id}/line-items/${lineId}`);
    lineItems = lineItems.filter((li) => li.id !== lineId);
    proposal = res.proposal;
  }

  async function replacePlatform(oldCode: string, newCode: string) {
    if (!proposal) return;
    const target = lineItems.find((li) => li.component_code === oldCode);
    if (!target) return;
    await removeLine(target.id);
    await addLine(newCode);
  }

  async function addCustom() {
    if (!proposal) return;
    const description = prompt('Custom line item description:');
    if (!description) return;
    const priceStr = prompt('Unit price (USD)?', '0');
    if (priceStr === null) return;
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price < 0) {
      alert('Unit price must be a non-negative number.');
      return;
    }
    await addLine('custom_line_item', { unit_price: price, description_override: description });
  }

  async function updateModifiers(next: Partial<ProposalModifiers>) {
    if (!proposal) return;
    const res = await api.put<{ proposal: Proposal }>(`/api/admin/proposals/${proposal.id}`, {
      modifiers: { ...proposal.modifiers, ...next },
    });
    proposal = res.proposal;
  }

  async function updateProposalField<K extends keyof Proposal>(field: K, value: Proposal[K]) {
    if (!proposal) return;
    const res = await api.put<{ proposal: Proposal }>(`/api/admin/proposals/${proposal.id}`, { [field]: value });
    proposal = res.proposal;
  }

  async function savePresentationNotes(next: string) {
    if (!proposal) return;
    const res = await api.put<{ proposal: Proposal }>(`/api/admin/proposals/${proposal.id}`, {
      presentation_notes: next.trim() === '' ? null : next,
    });
    proposal = res.proposal;
  }

  async function saveAndClose() {
    // Bump the flush key so the notes drawer flushes any pending debounced save before we navigate.
    flushNotesKey += 1;
    await new Promise((r) => setTimeout(r, 150));
    goto(`${base}/clients/${clientId}/opportunities/${oppId}`);
  }

  function previewPresentation() {
    if (!opportunity) return;
    // The presentation lives on the Worker (same origin in prod; localhost:8787 in dev). Open in a new tab.
    const url = `http://localhost:8787/p/${opportunity.presentation_token}`;
    window.open(url, '_blank', 'noopener');
  }

  async function cloneProposal() {
    if (!proposal) return;
    const msg = proposal.status === 'accepted'
      ? 'Clone this accepted proposal? A new opportunity will be created under the same client.'
      : 'Clone this proposal? The source will be marked superseded.';
    if (!confirm(msg)) return;
    try {
      const res = await api.post<ProposalDetail>(`/api/admin/proposals/${proposal.id}/clone`);
      // If the clone moved to a new opportunity, navigate there.
      const newOppId = res.proposal.opportunity_id;
      goto(`${base}/clients/${clientId}/opportunities/${newOppId}/proposal`, { replaceState: true });
    } catch (e) {
      alert(e instanceof ApiError ? `Clone failed: ${e.errorCode ?? e.status}` : 'Network error.');
    }
  }

  onMount(bootstrap);
</script>

<svelte:head><title>Calculator · Bussey Admin</title></svelte:head>

{#if loading}
  <p class="muted">Loading proposal…</p>
{:else if loadError}
  <div class="error">{loadError}</div>
{:else if proposal && snapshot && client && opportunity}
  <div class="breadcrumb muted small">
    <a href={`${base}/clients/${clientId}`}>{client.company_name}</a>
    &nbsp;›&nbsp;
    <a href={`${base}/clients/${clientId}/opportunities/${oppId}`}>{opportunity.name}</a>
    &nbsp;›&nbsp;
    Calculator
  </div>

  <ProposalStatusBanner proposal={proposal} onclone={cloneProposal} />

  <header class="hd">
    <div>
      <h1>{proposal.name}</h1>
      <p class="muted small">
        Status: <span class="badge badge-{proposal.status}">{proposal.status}</span>
        · Snapshot frozen {new Date(snapshot.taken_at).toLocaleDateString()}
      </p>
    </div>
    <div class="actions">
      <Button variant="secondary" onclick={previewPresentation}>Preview presentation</Button>
      <Button variant="secondary" onclick={cloneProposal}>Clone</Button>
      <a href={`${base}/clients/${clientId}/opportunities/${oppId}`}><Button variant="secondary">Cancel</Button></a>
      <Button onclick={saveAndClose}>Save &amp; close</Button>
    </div>
  </header>

  <div class="grid">
    <div class="left">
      <ComponentPalette
        components={components}
        lineItems={lineItems}
        readOnly={readOnly}
        onadd={(code) => void addLine(code)}
        onreplacePlatform={(oldCode, newCode) => void replacePlatform(oldCode, newCode)}
        onaddCustom={() => void addCustom()}
      />
    </div>

    <div class="middle">
      <div class="narrative surface">
        <h3>Presentation content</h3>
        <label class="field">
          <span>Display mode</span>
          <select
            value={proposal.pricing_display_mode}
            onchange={(e) => void updateProposalField('pricing_display_mode', (e.target as HTMLSelectElement).value as PricingDisplayMode)}
            disabled={readOnly}
          >
            <option value="summary">Summary (totals only)</option>
            <option value="categorical">Categorical (group by category)</option>
            <option value="full">Full (every line item)</option>
          </select>
        </label>
        <label class="field">
          <span>Challenge narrative</span>
          <textarea
            value={proposal.narrative_challenge ?? ''}
            onblur={(e) => void updateProposalField('narrative_challenge', (e.target as HTMLTextAreaElement).value || null)}
            disabled={readOnly}
            placeholder="Their pain, in their words."
          ></textarea>
        </label>
        <label class="field">
          <span>Solution narrative</span>
          <textarea
            value={proposal.narrative_solution ?? ''}
            onblur={(e) => void updateProposalField('narrative_solution', (e.target as HTMLTextAreaElement).value || null)}
            disabled={readOnly}
            placeholder="What we'll build, anchored to outcomes."
          ></textarea>
        </label>
      </div>

      <div class="line-items-card surface">
        <h3>Line items</h3>
        {#if lineItems.length === 0}
          <p class="muted small">No line items yet. Click a component in the palette to add one.</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Qty</th>
                <th class="num">Unit</th>
                <th class="num">Line total</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each lineItems as line (line.id)}
                <LineItemRow
                  line={line}
                  snapshot={snapshot}
                  readOnly={readOnly}
                  onupdate={updateLine}
                  onremove={removeLine}
                />
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <PresentationNotesDrawer
        value={proposal.presentation_notes ?? ''}
        readOnly={readOnly}
        onsave={savePresentationNotes}
        flushKey={flushNotesKey}
      />
    </div>

    <div class="right">
      <ModifiersBar modifiers={proposal.modifiers} readOnly={readOnly} onchange={updateModifiers} />
      <TotalsPanel proposal={proposal} lineItems={lineItems} snapshot={snapshot} />
    </div>
  </div>
{/if}

<style>
  .breadcrumb { margin-bottom: var(--space-3); }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .hd h1 { margin: 0; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .grid {
    display: grid;
    grid-template-columns: 260px 1fr 280px;
    gap: var(--space-4);
    align-items: start;
  }
  @media (max-width: 1100px) {
    .grid { grid-template-columns: 1fr; }
  }
  .narrative.surface, .line-items-card.surface { padding: var(--space-4); margin-bottom: var(--space-3); }
  .narrative h3, .line-items-card h3 {
    margin: 0 0 var(--space-3);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .field { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: var(--space-3); }
  .field span { font-size: 0.85rem; color: var(--muted); }
  .field select, .field textarea {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
  }
  .field select:disabled, .field textarea:disabled { background: #f5f5f3; }
  .field textarea { min-height: 4rem; resize: vertical; }
  .num { text-align: right; }
</style>

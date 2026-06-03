<script lang="ts">
  import type { PricingComponent, ProposalLineItem } from '$lib/types';

  type Props = {
    components: PricingComponent[];
    lineItems: ProposalLineItem[];
    readOnly: boolean;
    onadd: (code: string) => void;
    onreplacePlatform: (oldCode: string, newCode: string) => void;
    onaddCustom: () => void;
  };
  let { components, lineItems, readOnly, onadd, onreplacePlatform, onaddCustom }: Props = $props();

  /** Components grouped by category, but with `custom` handled separately. */
  const grouped = $derived(() => {
    const map: Record<string, PricingComponent[]> = {};
    for (const c of components) {
      if (c.category === 'custom') continue;
      (map[c.category] ??= []).push(c);
    }
    return map;
  });

  const presentPlatform = $derived(() => lineItems.find((li) => li.component_code.startsWith('platform_base_'))?.component_code ?? null);

  function handleClick(c: PricingComponent) {
    if (readOnly) return;
    if (c.code.startsWith('platform_base_')) {
      const existing = presentPlatform();
      if (existing && existing !== c.code) {
        const ok = confirm(`Replace ${existing} with ${c.code}?\n\nThis removes the current platform tier and adds the selected one.`);
        if (!ok) return;
        onreplacePlatform(existing, c.code);
        return;
      }
      if (existing === c.code) return;
    }
    onadd(c.code);
  }

  const ORDER = ['table', 'role', 'workflow', 'integration', 'ai', 'dashboard', 'setup', 'subscription'];
  const categoriesInOrder = $derived(() => ORDER.filter((k) => grouped()[k]?.length));

  function categoryLabel(k: string): string {
    return k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
  }
</script>

<aside class="palette">
  <h2>Components</h2>
  <p class="muted small">Click to add. Snapshot rates win — current rates shown here are informational.</p>

  {#each categoriesInOrder() as cat}
    <section>
      <h3>{categoryLabel(cat)}</h3>
      <ul>
        {#each grouped()[cat] ?? [] as c (c.code)}
          {@const isPlatform = c.code.startsWith('platform_base_')}
          {@const isPresentPlatform = isPlatform && presentPlatform() === c.code}
          {@const isAlternatePlatform = isPlatform && presentPlatform() !== null && !isPresentPlatform}
          <li>
            <button
              type="button"
              onclick={() => handleClick(c)}
              disabled={readOnly || isPresentPlatform}
              class:on-proposal={isPresentPlatform}
              class:dimmed={isAlternatePlatform}
              title={c.description ?? ''}
            >
              <span class="name">{c.name}</span>
              <span class="rate">${c.unit_price.toLocaleString()}</span>
              {#if c.description}<span class="desc small muted">{c.description}</span>{/if}
              {#if isPresentPlatform}<span class="tag">on proposal</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <section>
    <h3>Custom</h3>
    <button type="button" class="custom-add" onclick={onaddCustom} disabled={readOnly}>
      + Custom line item (free-form name + price)
    </button>
  </section>
</aside>

<style>
  .palette {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4);
    max-height: 80vh;
    overflow-y: auto;
    position: sticky;
    top: var(--space-4);
  }
  h2 { margin-top: 0; }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  li button {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 0.5rem;
    row-gap: 0.15rem;
    width: 100%;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    cursor: pointer;
    font: inherit;
    color: var(--text);
  }
  li button:hover:not(:disabled) { border-color: var(--accent); background: var(--surface); }
  li button:disabled { opacity: 0.65; cursor: not-allowed; }
  li button.on-proposal { background: rgba(93, 202, 165, 0.12); border-color: rgba(93, 202, 165, 0.35); }
  li button.dimmed { opacity: 0.45; }
  .name { font-weight: 500; font-size: 0.92rem; }
  .rate { font-variant-numeric: tabular-nums; font-size: 0.88rem; color: var(--muted); }
  .desc { grid-column: 1 / -1; font-size: 0.78rem; line-height: 1.3; }
  .tag {
    grid-column: 1 / -1;
    margin-top: 0.2rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--success);
  }
  .custom-add {
    width: 100%;
    text-align: left;
    background: var(--surface-2);
    border: 1px dashed var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    cursor: pointer;
    font: inherit;
    color: var(--accent);
  }
  .custom-add:hover:not(:disabled) { background: var(--surface); border-color: var(--accent); }
  .custom-add:disabled { opacity: 0.55; cursor: not-allowed; }
</style>

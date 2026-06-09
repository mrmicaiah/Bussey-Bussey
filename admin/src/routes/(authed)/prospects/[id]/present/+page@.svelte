<script lang="ts">
  // Studio44 Presentation room — Tab 1 (the live screen-share surface).
  //
  // `+page@.svelte` (root layout reset) — NO admin chrome: the operator
  // screen-shares this and the client must not see the admin nav/header. The
  // auth guard + data load live in the sibling +page.ts. This component only
  // renders: a fixed left rail (identity + investment + Next) and the demo
  // iframe in the main area. No writes happen here.
  import { base } from '$app/paths';
  import type { ProspectWorkspace, Opportunity } from '$lib/types';

  let { data }: { data: { id: string; prospect: ProspectWorkspace; opportunity: Opportunity } } = $props();

  const company = $derived(data.prospect.prospect.company);
  const demoUrl = $derived(data.prospect.demo_spec?.demo_url ?? null);
  const proposal = $derived(data.prospect.proposal);

  // Initials for the avatar: first letters of up to two words, else first two chars.
  const initials = $derived.by(() => {
    const words = company.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '—';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  });

  // Reload re-mounts the iframe via a keyed block (re-fetches the demo cleanly).
  let reloadKey = $state(0);
  function reloadDemo() {
    reloadKey += 1;
  }
  function popOut() {
    if (demoUrl) window.open(demoUrl, '_blank', 'noopener');
  }
  function next() {
    // Open the disposition tab off-screen-share, leaving the demo untouched.
    window.open(`${base}/prospects/${data.id}/disposition`, '_blank');
  }

  function money(n: number): string {
    return `$${Math.round(n).toLocaleString()}`;
  }
</script>

<svelte:head><title>{company} · Presentation room · Studio44</title></svelte:head>

<div class="room">
  <!-- LEFT RAIL — fixed identity + investment + Next. No other chrome. -->
  <aside class="rail">
    <div class="rail-top">
      <div class="meeting">
        <div class="avatar" aria-hidden="true">{initials}</div>
        <div class="company">{company}</div>
      </div>

      <div class="investment">
        {#if proposal}
          <div class="inv-row">
            <span class="inv-label">Setup</span>
            <span class="inv-value">{money(proposal.setup_total)}</span>
          </div>
          <div class="inv-divider"></div>
          <div class="inv-row">
            <span class="inv-label">Monthly</span>
            <span class="inv-value">{money(proposal.monthly_total)}<span class="inv-per">/mo</span></span>
          </div>
        {:else}
          <div class="inv-pending">Pricing pending</div>
        {/if}
      </div>
    </div>

    <button type="button" class="next" onclick={next}>Next →</button>
  </aside>

  <!-- MAIN — the demo iframe (or a calm empty state). -->
  <main class="stage">
    {#if demoUrl}
      <div class="stage-bar">
        <span class="stage-url" title={demoUrl}>{demoUrl}</span>
        <div class="stage-controls">
          <button type="button" onclick={reloadDemo}>Reload</button>
          <button type="button" onclick={popOut}>Pop out ↗</button>
        </div>
      </div>
      {#key reloadKey}
        <iframe
          class="demo"
          src={demoUrl}
          title="Demo for {company}"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      {/key}
    {:else}
      <div class="empty">
        <div class="empty-card">
          <h2>No demo URL set</h2>
          <p>Set one in the workspace before presenting.</p>
          <a class="empty-link" href={`${base}/prospects/${data.id}`}>← Back to the prospect</a>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  /* Studio44 dark — declared here so it owns the whole viewport (this page has
     no app chrome / app.css <main> wrapper). Scoped to .room. */
  .room {
    --s44-bg: #0a0a0b;
    --s44-surface: #141416;
    --s44-surface-2: #1c1c1f;
    --s44-border: #2a2a2e;
    --s44-crimson: #d40b1e;
    --s44-text: #f4f4f5;
    --s44-muted: #a1a1aa;

    position: fixed;
    inset: 0;
    display: grid;
    grid-template-columns: 340px 1fr;
    background: var(--s44-bg);
    color: var(--s44-text);
  }

  /* LEFT RAIL */
  .rail {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--s44-border);
    padding: 1.5rem 1.25rem;
    gap: 1.25rem;
    overflow-y: auto;
  }
  .rail-top { display: flex; flex-direction: column; gap: 1.5rem; flex: 1; }

  .meeting { display: flex; align-items: center; gap: 0.9rem; }
  .avatar {
    width: 52px; height: 52px; flex: 0 0 52px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(212, 11, 30, 0.16);
    color: #fca5a5;
    border: 1px solid rgba(212, 11, 30, 0.4);
    font-weight: 700; font-size: 1.05rem; letter-spacing: 0.02em;
  }
  .company { font-size: 1.35rem; font-weight: 700; line-height: 1.2; }

  .investment {
    background: var(--s44-surface);
    border: 1px solid var(--s44-border);
    border-radius: 12px;
    padding: 1rem 1.1rem;
  }
  .inv-row { display: flex; align-items: baseline; justify-content: space-between; }
  .inv-label { color: var(--s44-muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .inv-value { font-size: 1.5rem; font-weight: 700; }
  .inv-per { font-size: 0.9rem; font-weight: 500; color: var(--s44-muted); margin-left: 0.1rem; }
  .inv-divider { height: 1px; background: var(--s44-border); margin: 0.85rem 0; }
  .inv-pending { color: var(--s44-muted); font-size: 0.95rem; text-align: center; padding: 0.5rem 0; }

  .next {
    width: 100%;
    background: var(--s44-crimson); color: #fff;
    border: none; border-radius: 10px;
    padding: 0.85rem 1rem;
    font: inherit; font-weight: 700; font-size: 1rem;
    cursor: pointer;
  }
  .next:hover { filter: brightness(1.1); }

  /* MAIN STAGE */
  .stage { display: flex; flex-direction: column; min-width: 0; }
  .stage-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    padding: 0.5rem 0.9rem;
    border-bottom: 1px solid var(--s44-border);
    background: var(--s44-surface);
  }
  .stage-url {
    color: var(--s44-muted); font-size: 0.82rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .stage-controls { display: flex; gap: 0.5rem; flex: 0 0 auto; }
  .stage-controls button {
    background: var(--s44-surface-2); color: var(--s44-text);
    border: 1px solid var(--s44-border); border-radius: 8px;
    padding: 0.35rem 0.7rem; font: inherit; font-size: 0.82rem; cursor: pointer;
  }
  .stage-controls button:hover { border-color: var(--s44-muted); }

  .demo { flex: 1; width: 100%; border: none; background: #fff; }

  .empty { flex: 1; display: flex; align-items: center; justify-content: center; }
  .empty-card {
    text-align: center;
    border: 1px solid var(--s44-border);
    background: var(--s44-surface);
    border-radius: 12px;
    padding: 2rem 2.5rem;
    max-width: 420px;
  }
  .empty-card h2 { margin: 0 0 0.4rem; color: var(--s44-text); }
  .empty-card p { margin: 0 0 1.1rem; color: var(--s44-muted); }
  .empty-link { color: var(--s44-crimson); text-decoration: none; font-weight: 600; }
  .empty-link:hover { text-decoration: underline; }
</style>

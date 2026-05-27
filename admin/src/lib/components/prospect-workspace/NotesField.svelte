<script lang="ts">
  import { untrack } from 'svelte';
  // Studio44 Layer 2 — reusable expand/contract auto-grow notes field (§2.4).
  // Used by dig mode now and build-pitch mode in step 5.
  //  - Auto-growing textarea: height follows content, NO inner scrollbar.
  //  - Collapsible: the header line toggles open/closed; collapsed shows a
  //    filled/empty + char-count indicator.
  // value is $bindable so the parent holds the local buffer; onchange is also
  // emitted. NO persistence here — saving is step 4.
  let {
    label,
    hint = '',
    tag = '',
    icon = '',
    value = $bindable(''),
    onchange,
    startOpen = true,
  }: {
    label: string;
    hint?: string;
    tag?: string;
    icon?: string;
    value?: string;
    onchange?: (v: string) => void;
    startOpen?: boolean;
  } = $props();

  // Capture the initial open state once (startOpen is a default, not a live binding).
  let open = $state(untrack(() => startOpen));
  let ta: HTMLTextAreaElement | undefined = $state();

  function autosize() {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  // Re-size when the field opens or the value changes (incl. initial populate).
  $effect(() => {
    void value;
    if (open) queueMicrotask(autosize);
  });

  function handleInput() {
    autosize();
    onchange?.(value);
  }

  const count = $derived(value?.length ?? 0);
</script>

<section class="nf" class:open>
  <button type="button" class="nf-head" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="caret">{open ? '▾' : '▸'}</span>
    {#if icon}<span class="icon" aria-hidden="true">{icon}</span>{/if}
    <span class="label">{label}</span>
    {#if tag}<span class="tag">{tag}</span>{/if}
    <span class="ind" class:filled={count > 0}>{count > 0 ? `${count} chars` : 'empty'}</span>
  </button>

  {#if open}
    {#if hint}<p class="hint">{hint}</p>{/if}
    <textarea
      bind:this={ta}
      bind:value
      oninput={handleInput}
      rows="2"
      placeholder="Type here…"
    ></textarea>
  {/if}
</section>

<style>
  .nf {
    border: 1px solid var(--s44-border, #2a2a2e);
    border-radius: 8px;
    background: var(--s44-surface, #141416);
    overflow: hidden;
  }
  .nf.open { border-color: var(--s44-border, #2a2a2e); }
  .nf-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    background: transparent;
    border: none;
    font: inherit;
    color: var(--s44-text, #f4f4f5);
    padding: 0.6rem 0.75rem;
    text-align: left;
  }
  .nf-head:hover { background: var(--s44-surface-2, #1c1c1f); }
  .caret { color: var(--s44-muted, #a1a1aa); width: 0.9rem; flex-shrink: 0; }
  .icon { flex-shrink: 0; }
  .label { font-weight: 600; }
  .tag {
    font-size: 0.7rem;
    color: var(--s44-crimson, #d40b1e);
    border: 1px solid var(--s44-crimson, #d40b1e);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }
  .ind {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--s44-muted, #a1a1aa);
    flex-shrink: 0;
  }
  .ind.filled { color: var(--s44-text, #f4f4f5); }
  .hint {
    margin: 0;
    padding: 0 0.75rem 0.4rem;
    color: var(--s44-muted, #a1a1aa);
    font-size: 0.8rem;
  }
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    resize: none; /* height is driven by content (autosize), no manual drag */
    overflow: hidden; /* NO inner scrollbar — grows to fit */
    border: none;
    border-top: 1px solid var(--s44-border, #2a2a2e);
    background: var(--s44-bg, #0a0a0b);
    color: var(--s44-text, #f4f4f5);
    font: inherit;
    line-height: 1.5;
    padding: 0.6rem 0.75rem;
    min-height: 2.6rem;
  }
  textarea:focus { outline: none; box-shadow: inset 0 0 0 1px var(--s44-crimson, #d40b1e); }
  textarea::placeholder { color: var(--s44-muted, #a1a1aa); opacity: 0.6; }
</style>

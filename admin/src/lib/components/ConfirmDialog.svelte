<script lang="ts">
  import Button from './Button.svelte';

  type Props = {
    open: boolean;
    title: string;
    message?: string;
    cascadeCounts?: Record<string, number> | undefined;
    orphanCounts?: Record<string, number> | undefined;
    note?: string | undefined;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: 'primary' | 'danger';
    disabledReason?: string | undefined;
    onconfirm: () => void;
    oncancel: () => void;
  };

  let {
    open,
    title,
    message,
    cascadeCounts,
    orphanCounts,
    note,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmVariant = 'danger',
    disabledReason,
    onconfirm,
    oncancel,
  }: Props = $props();

  function hasAny(counts: Record<string, number> | undefined): boolean {
    if (!counts) return false;
    return Object.values(counts).some((n) => n > 0);
  }

  function entries(counts: Record<string, number> | undefined): [string, number][] {
    if (!counts) return [];
    return Object.entries(counts).filter(([, n]) => n > 0);
  }

  function label(key: string): string {
    return key.replace(/_/g, ' ');
  }
</script>

{#if open}
  <div class="backdrop" onclick={oncancel} role="presentation"></div>
  <div class="dialog surface" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <h2 id="confirm-title">{title}</h2>
    {#if message}<p class="muted">{message}</p>{/if}

    {#if hasAny(cascadeCounts)}
      <div class="impact">
        <strong>This will also delete:</strong>
        <ul>
          {#each entries(cascadeCounts) as [k, n]}
            <li><strong>{n}</strong> {label(k)}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if hasAny(orphanCounts)}
      <div class="impact warn">
        <strong>The following will be orphaned (origin link cleared, row preserved):</strong>
        <ul>
          {#each entries(orphanCounts) as [k, n]}
            <li><strong>{n}</strong> {label(k)}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if !hasAny(cascadeCounts) && !hasAny(orphanCounts)}
      <p class="muted small">No other records will be affected.</p>
    {/if}

    {#if note}<p class="muted small">{note}</p>{/if}
    {#if disabledReason}<div class="error">{disabledReason}</div>{/if}

    <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4);">
      <Button variant="secondary" onclick={oncancel}>{cancelLabel}</Button>
      <Button variant={confirmVariant} onclick={onconfirm} disabled={!!disabledReason}>
        {confirmLabel}
      </Button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 50;
  }
  .dialog {
    position: fixed;
    top: 10vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(480px, 92vw);
    z-index: 51;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .impact {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    background: rgba(212, 11, 30, 0.10);
    color: var(--danger);
    border: 1px solid #501313;
    border-radius: var(--radius);
    font-size: 0.9rem;
  }
  .impact.warn {
    background: #2a1a0a;
    color: var(--warning);
    border-color: #854f0b66;
  }
  .impact ul {
    margin: var(--space-2) 0 0;
    padding-left: 1.2rem;
  }
</style>

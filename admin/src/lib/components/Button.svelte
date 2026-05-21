<script lang="ts">
  type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

  let {
    variant = 'primary',
    type = 'button',
    disabled = false,
    onclick,
    children,
    ...rest
  }: {
    variant?: Variant;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: import('svelte').Snippet;
  } & Record<string, unknown> = $props();
</script>

<button {type} {disabled} {onclick} class="btn btn-{variant}" {...rest}>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.45rem 0.85rem;
    font-size: 0.9rem;
    font-weight: 500;
    border-radius: var(--radius);
    border: 1px solid transparent;
    cursor: pointer;
    transition: filter 0.1s ease;
    font-family: inherit;
  }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .btn:not(:disabled):hover { filter: brightness(0.93); }

  .btn-primary { background: var(--accent); color: var(--accent-text); }
  .btn-secondary { background: var(--surface); color: var(--text); border-color: var(--border); }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-ghost { background: transparent; color: var(--accent); border-color: transparent; }
</style>

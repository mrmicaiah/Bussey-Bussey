<script lang="ts">
  type Step = { key: string; label: string };
  let {
    steps,
    currentIndex,
    completedThroughIndex,
  }: { steps: Step[]; currentIndex: number; completedThroughIndex: number } = $props();
</script>

<ol class="dots">
  {#each steps as step, i (step.key)}
    {@const state = i <= completedThroughIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming'}
    <li class="dot dot-{state}">
      <span class="num">{i + 1}</span>
      <span class="label">{step.label}</span>
    </li>
  {/each}
</ol>

<style>
  .dots {
    display: flex;
    list-style: none;
    margin: 0 0 var(--space-6);
    padding: 0;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .dot {
    flex: 1 1 6rem;
    min-width: 6rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius);
  }
  .num {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 0.85rem;
    background: #ececea;
    color: var(--muted);
  }
  .label {
    font-size: 0.8rem;
    color: var(--muted);
    text-align: center;
  }
  .dot-current .num   { background: var(--accent); color: var(--accent-text); }
  .dot-current .label { color: var(--text); font-weight: 500; }
  .dot-done .num      { background: #d8e8d8; color: var(--success); }
  .dot-done .label    { color: var(--text); }
</style>

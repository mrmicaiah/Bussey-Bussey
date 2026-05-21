<script lang="ts">
  import type { Proposal } from '$lib/types';

  let { proposal, onclone }: { proposal: Proposal; onclone: () => void } = $props();

  const accepted = $derived(proposal.status === 'accepted');
  const stale = $derived(proposal.is_stale && proposal.status === 'draft');
  const superseded = $derived(proposal.status === 'superseded');
  const declined = $derived(proposal.status === 'declined');
</script>

{#if accepted}
  <div class="banner banner-accepted">
    <strong>Accepted — locked.</strong>
    Scope and pricing are immutable. Use a change order to modify the engagement.
  </div>
{:else if stale}
  <div class="banner banner-stale">
    <strong>This draft is over 90 days old.</strong>
    Pricing may have moved since {new Date(proposal.created_at).toLocaleDateString()}.
    <button type="button" onclick={onclone}>Clone with current pricing</button>
  </div>
{:else if superseded}
  <div class="banner banner-superseded">
    <strong>Superseded.</strong>
    This proposal was replaced by a clone. See the opportunity for the current version.
  </div>
{:else if declined}
  <div class="banner banner-declined">
    <strong>Declined.</strong>
    {#if proposal.notes}<span class="reason">{proposal.notes}</span>{/if}
  </div>
{/if}

<style>
  .banner {
    padding: 0.7rem 1rem;
    border-radius: 6px;
    margin-bottom: var(--space-4);
    font-size: 0.92rem;
  }
  .banner-accepted   { background: #d8e8d8; color: #0f4d2f; border: 1px solid #b8d6b8; }
  .banner-stale      { background: #fdf1d7; color: #6b4500; border: 1px solid #efd58a; }
  .banner-superseded { background: #ececea; color: #6b6b66; border: 1px solid #d0d0cc; }
  .banner-declined   { background: #fce8e6; color: #5b1817; border: 1px solid #f1c0bd; }
  button {
    margin-left: var(--space-3);
    background: #fff;
    border: 1px solid #6b4500;
    color: #6b4500;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: #fff8e6; }
  .reason { font-style: italic; }
</style>

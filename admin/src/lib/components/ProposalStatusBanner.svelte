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
  /* Full-width status panels (not badges) — token-family tints per the
     rgba-off-token precedent: success / warning / neutral / crimson families. */
  .banner-accepted   { background: rgba(93, 202, 165, 0.12); color: var(--success); border: 1px solid rgba(93, 202, 165, 0.35); }
  .banner-stale      { background: rgba(250, 199, 117, 0.12); color: var(--warning); border: 1px solid rgba(250, 199, 117, 0.35); }
  .banner-superseded { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
  .banner-declined   { background: rgba(212, 11, 30, 0.12); color: var(--danger); border: 1px solid rgba(212, 11, 30, 0.35); }
  button {
    margin-left: var(--space-3);
    background: transparent;
    border: 1px solid var(--warning);
    color: var(--warning);
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: rgba(250, 199, 117, 0.12); }
  .reason { font-style: italic; }
</style>

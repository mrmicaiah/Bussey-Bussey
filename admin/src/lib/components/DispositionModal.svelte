<script lang="ts">
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import type { Proposal, Opportunity } from '$lib/types';

  type Kind = 'accepted' | 'followup' | 'changes' | 'declined';
  type Props = {
    open: boolean;
    kind: Kind | null;
    opportunity: Opportunity;
    proposal: Proposal | null;
    submitting: boolean;
    onsubmit: (kind: Kind, payload: Record<string, unknown>) => Promise<void>;
    onclose: () => void;
  };
  let { open, kind, opportunity, proposal, submitting, onsubmit, onclose }: Props = $props();

  let notes = $state('');
  let nextFollowupDate = $state('');
  let declinedReason = $state<'too_expensive' | 'bad_timing' | 'went_with_competitor' | 'not_a_fit' | 'other'>('too_expensive');

  $effect(() => {
    // reset when opening
    if (open) {
      notes = '';
      nextFollowupDate = '';
      declinedReason = 'too_expensive';
    }
  });

  const titles: Record<Kind, string> = {
    accepted: 'Mark opportunity as Accepted',
    followup: 'Schedule a follow-up',
    changes: 'Capture requested changes',
    declined: 'Mark opportunity as Declined',
  };

  async function submit() {
    if (!kind) return;
    if (kind === 'followup') {
      if (!nextFollowupDate) return;
      await onsubmit('followup', { next_followup_date: nextFollowupDate, notes });
    } else if (kind === 'changes') {
      await onsubmit('changes', { notes });
    } else if (kind === 'declined') {
      await onsubmit('declined', { reason: declinedReason, notes });
    } else if (kind === 'accepted') {
      await onsubmit('accepted', {});
    }
  }
</script>

{#if open && kind}
  <div class="backdrop" onclick={onclose} role="presentation"></div>
  <div class="dialog surface" role="dialog" aria-modal="true" aria-labelledby="disp-title">
    <h2 id="disp-title">{titles[kind]}</h2>

    {#if kind === 'accepted'}
      <p class="muted">
        This will lock the pricing snapshot, create the project, generate the contract, and
        provision the client's portal account. You'll get one-time credentials to hand off to
        the client.
      </p>
      {#if proposal}
        <div class="summary">
          <div><span class="label">Opportunity:</span> {opportunity.name}</div>
          <div><span class="label">Setup:</span> ${proposal.setup_total.toLocaleString()}</div>
          <div><span class="label">Monthly:</span> ${proposal.monthly_total.toLocaleString()}/mo</div>
        </div>
      {/if}
    {/if}

    {#if kind === 'followup'}
      <p class="muted">Set a date and capture context for the next touchpoint.</p>
      <Field label="Next follow-up date *">
        <input type="date" bind:value={nextFollowupDate} required />
      </Field>
      <Field label="Notes (optional)">
        <textarea bind:value={notes} placeholder="What did we agree to revisit?"></textarea>
      </Field>
    {/if}

    {#if kind === 'changes'}
      <p class="muted">
        Capture what the prospect wants changed. After saving, you'll be returned to the calculator
        to make the edits directly. The proposal stays in draft.
      </p>
      <Field label="Notes">
        <textarea bind:value={notes} placeholder="What changes are they asking for?"></textarea>
      </Field>
    {/if}

    {#if kind === 'declined'}
      <p class="muted">
        Marks the opportunity as <strong>lost</strong> and the current proposal as
        <strong>declined</strong>. Reason is recorded in the audit log.
      </p>
      <Field label="Reason *">
        <select bind:value={declinedReason}>
          <option value="too_expensive">Too expensive</option>
          <option value="bad_timing">Bad timing</option>
          <option value="went_with_competitor">Went with a competitor</option>
          <option value="not_a_fit">Not a fit</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Notes (optional)">
        <textarea bind:value={notes} placeholder="Anything we should remember?"></textarea>
      </Field>
    {/if}

    <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4);">
      <Button variant="secondary" onclick={onclose} disabled={submitting}>Cancel</Button>
      <Button onclick={submit} disabled={submitting || (kind === 'followup' && !nextFollowupDate)}>
        {submitting ? 'Saving…' : 'Confirm'}
      </Button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.42);
    z-index: 50;
  }
  .dialog {
    position: fixed;
    top: 10vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(500px, 92vw);
    z-index: 51;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .summary {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.7rem 1rem;
    margin-top: var(--space-3);
    font-size: 0.92rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .summary .label { color: var(--muted); margin-right: 0.4rem; }
</style>

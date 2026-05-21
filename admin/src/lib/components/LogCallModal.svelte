<script lang="ts">
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import { api, ApiError } from '$lib/api';

  type Outcome =
    | 'no_answer'
    | 'left_voicemail'
    | 'spoke_not_interested'
    | 'spoke_followup_needed'
    | 'disqualified'
    | 'spoke_qualified';
  type NextAction = 'done' | 'reschedule' | 'convert_to_lead';

  let {
    open,
    cardId,
    cardLabel,
    onclose,
    oncomplete,
  }: {
    open: boolean;
    cardId: string;
    cardLabel: string;
    onclose: () => void;
    oncomplete: (result: { status: string; converted_lead_id: string | null }) => void;
  } = $props();

  let outcome = $state<Outcome>('no_answer');
  let notes = $state('');
  let nextAction = $state<NextAction>('done');
  let nextDate = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open) {
      outcome = 'no_answer';
      notes = '';
      nextAction = 'done';
      nextDate = '';
      error = null;
      submitting = false;
    }
  });

  async function submit() {
    if (submitting) return;
    if (nextAction === 'reschedule' && !nextDate) {
      error = 'Pick a date to reschedule for.';
      return;
    }
    submitting = true;
    error = null;
    try {
      const res = await api.post<{ status: string; converted_lead_id: string | null }>(
        `/api/admin/calling-list/${cardId}/log`,
        {
          outcome,
          notes,
          next_action: nextAction,
          next_action_date: nextAction === 'reschedule' ? nextDate : null,
        },
      );
      oncomplete(res);
    } catch (e) {
      error = e instanceof ApiError ? `Log failed (${e.errorCode ?? e.status}).` : 'Network error.';
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={onclose}></div>
  <div class="dialog surface" role="dialog" aria-modal="true" aria-labelledby="log-call-title">
    <h2 id="log-call-title">Log call · {cardLabel}</h2>

    <Field label="Outcome">
      <select bind:value={outcome}>
        <option value="no_answer">No answer</option>
        <option value="left_voicemail">Left voicemail</option>
        <option value="spoke_not_interested">Spoke briefly — not interested</option>
        <option value="spoke_followup_needed">Spoke — interested, follow-up needed</option>
        <option value="disqualified">Disqualified (wrong fit, business closed, etc.)</option>
        <option value="spoke_qualified">Spoke — qualified, convert to lead</option>
      </select>
    </Field>

    <Field label="Notes">
      <textarea bind:value={notes} placeholder="What happened on the call?"></textarea>
    </Field>

    <Field label="Next action">
      <select bind:value={nextAction}>
        <option value="done">Done with this card</option>
        <option value="reschedule">Reschedule for…</option>
        <option value="convert_to_lead">Convert to lead now</option>
      </select>
    </Field>

    {#if nextAction === 'reschedule'}
      <Field label="New call date">
        <input type="date" bind:value={nextDate} required />
      </Field>
    {/if}

    {#if error}<div class="error">{error}</div>{/if}

    <div class="row" style="justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4);">
      <Button variant="secondary" onclick={onclose} disabled={submitting}>Cancel</Button>
      <Button onclick={submit} disabled={submitting}>
        {submitting ? 'Saving…' : 'Save log'}
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
    width: min(520px, 92vw);
    z-index: 51;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>

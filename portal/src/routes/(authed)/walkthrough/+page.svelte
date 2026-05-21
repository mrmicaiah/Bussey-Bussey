<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { PortalMe, WalkthroughStatePayload } from '$lib/types';
  import StepDots from '$lib/components/walkthrough/StepDots.svelte';
  import Welcome from '$lib/components/walkthrough/Welcome.svelte';
  import PasswordStep from '$lib/components/walkthrough/PasswordStep.svelte';
  import ContractStep from '$lib/components/walkthrough/ContractStep.svelte';
  import PaymentStep from '$lib/components/walkthrough/PaymentStep.svelte';
  import DoneStep from '$lib/components/walkthrough/DoneStep.svelte';

  let { data }: { data: { me: PortalMe } } = $props();

  // Local "intro vs work" flag: when server state is 'new', the user sees the
  // Welcome screen first, then advances to PasswordStep without any server
  // state change. After PasswordStep submits, state advances to 'password_set'.
  let welcomeAcknowledged = $state(false);

  // Server-driven walkthrough state. Refreshed after each step advance so the
  // server is the source of truth for which step is current.
  let walkthrough = $state<WalkthroughStatePayload | null>(null);
  let loadError = $state<string | null>(null);

  async function refresh() {
    try {
      walkthrough = await api.get<WalkthroughStatePayload>('/api/portal/walkthrough/state');
    } catch (e) {
      loadError = 'Could not load the walkthrough state. Please refresh the page.';
      console.error(e);
    }
  }

  onMount(refresh);

  // Maps server state → visible step index for the dots and component routing.
  // Index 0 = welcome, 1 = password, 2 = contract, 3 = payment, 4 = done.
  function stepIndex(state: string, welcomed: boolean): number {
    if (state === 'new' && !welcomed) return 0;
    if (state === 'new' && welcomed) return 1;
    if (state === 'password_set') return 2;
    if (state === 'contract_signed') return 3;
    if (state === 'payment_set' || state === 'complete') return 4;
    return 0;
  }
  function completedThrough(state: string, welcomed: boolean): number {
    // Highest index whose step is finished.
    if (state === 'new' && !welcomed) return -1;
    if (state === 'new' && welcomed) return 0; // welcome acknowledged
    if (state === 'password_set') return 1;
    if (state === 'contract_signed') return 2;
    if (state === 'payment_set') return 3;
    if (state === 'complete') return 4;
    return -1;
  }

  const STEPS = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'password', label: 'Secure account' },
    { key: 'contract', label: 'Sign contract' },
    { key: 'payment', label: 'Set up payment' },
    { key: 'done', label: 'Done' },
  ];

  const currentIdx = $derived(
    walkthrough ? stepIndex(walkthrough.walkthrough_state, welcomeAcknowledged) : 0,
  );
  const completedIdx = $derived(
    walkthrough ? completedThrough(walkthrough.walkthrough_state, welcomeAcknowledged) : -1,
  );
</script>

<svelte:head><title>Get started · Bussey Client Portal</title></svelte:head>

<div class="frame">
  <StepDots steps={STEPS} currentIndex={currentIdx} completedThroughIndex={completedIdx} />

  {#if loadError}
    <div class="error">{loadError}</div>
  {:else if !walkthrough}
    <p class="muted">Loading…</p>
  {:else if walkthrough.walkthrough_state === 'new' && !welcomeAcknowledged}
    <Welcome
      clientCompanyName={data.me.client.company_name}
      opportunityName={data.me.opportunity?.name ?? 'your project'}
      onContinue={() => (welcomeAcknowledged = true)}
    />
  {:else if walkthrough.walkthrough_state === 'new'}
    <PasswordStep onAdvance={refresh} />
  {:else if walkthrough.walkthrough_state === 'password_set' && walkthrough.contract}
    <ContractStep
      contractBody={walkthrough.contract.body}
      contractSignedAt={walkthrough.contract.signed_at}
      onAdvance={refresh}
    />
  {:else if walkthrough.walkthrough_state === 'contract_signed' && walkthrough.payment_summary}
    <PaymentStep
      setupTotal={walkthrough.payment_summary.setup_total}
      monthlyTotal={walkthrough.payment_summary.monthly_total}
      monthlyStartsOn={walkthrough.payment_summary.monthly_starts_on}
      onAdvance={refresh}
    />
  {:else if walkthrough.walkthrough_state === 'payment_set' && walkthrough.payment_summary}
    <DoneStep
      clientCompanyName={data.me.client.company_name}
      primaryContactName={data.me.client.primary_contact_name}
      setupTotal={walkthrough.payment_summary.setup_total}
      monthlyTotal={walkthrough.payment_summary.monthly_total}
      monthlyStartsOn={walkthrough.payment_summary.monthly_starts_on}
      contractBody={walkthrough.contract?.body ?? null}
      opportunityName={data.me.opportunity?.name ?? 'your project'}
    />
  {:else}
    <div class="surface">
      <h1>You're all set.</h1>
      <p class="muted">Walkthrough complete — head back to your portal.</p>
    </div>
  {/if}
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>

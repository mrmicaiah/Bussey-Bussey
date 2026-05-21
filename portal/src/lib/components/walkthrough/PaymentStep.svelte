<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../Button.svelte';
  import { api, ApiError } from '$lib/api';
  import type { Stripe, StripeElements } from '@stripe/stripe-js';

  let {
    setupTotal,
    monthlyTotal,
    monthlyStartsOn,
    onAdvance,
  }: {
    setupTotal: number;
    monthlyTotal: number;
    monthlyStartsOn: string;
    onAdvance: () => Promise<void> | void;
  } = $props();

  type ConfigState =
    | { kind: 'loading' }
    | { kind: 'dev_placeholder' }
    | { kind: 'real'; stripe: Stripe; elements: StripeElements }
    | { kind: 'error'; message: string };

  let config = $state<ConfigState>({ kind: 'loading' });
  let elementContainer: HTMLDivElement | null = $state(null);
  let cardComplete = $state(false);
  let submitting = $state(false);
  let formError = $state<string | null>(null);

  function fmt(amount: number): string {
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  }

  function fmtDate(iso: string): string {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async function bootStripe() {
    try {
      const res = await api.get<{ dev_placeholder: boolean; publishable_key: string | null }>(
        '/api/portal/walkthrough/payment-config',
      );
      if (res.dev_placeholder || !res.publishable_key) {
        config = { kind: 'dev_placeholder' };
        return;
      }
      const mod = await import('@stripe/stripe-js');
      const stripe = await mod.loadStripe(res.publishable_key);
      if (!stripe) {
        config = { kind: 'error', message: 'Stripe.js failed to load.' };
        return;
      }
      const elements = stripe.elements({
        mode: 'setup',
        currency: 'usd',
        paymentMethodCreation: 'manual',
      });
      config = { kind: 'real', stripe, elements };
    } catch (e) {
      config = {
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load payment form.',
      };
    }
  }

  $effect(() => {
    if (config.kind === 'real' && elementContainer) {
      const payment = config.elements.create('payment', {
        layout: 'tabs',
      });
      payment.on('change', (event) => {
        cardComplete = event.complete;
      });
      payment.mount(elementContainer);
      return () => payment.unmount();
    }
  });

  async function submitRealPayment() {
    if (config.kind !== 'real') return;
    submitting = true;
    formError = null;
    try {
      const { error: submitError } = await config.elements.submit();
      if (submitError) {
        formError = submitError.message ?? 'Could not validate payment method.';
        return;
      }
      const { error, paymentMethod } = await config.stripe.createPaymentMethod({
        elements: config.elements,
      });
      if (error || !paymentMethod) {
        formError = error?.message ?? 'Could not create payment method.';
        return;
      }
      await api.post('/api/portal/walkthrough/setup-payment', {
        payment_method_id: paymentMethod.id,
      });
      await onAdvance();
    } catch (e) {
      formError = stripeErrorMessage(e);
    } finally {
      submitting = false;
    }
  }

  async function submitDevPlaceholder() {
    submitting = true;
    formError = null;
    try {
      await api.post('/api/portal/walkthrough/setup-payment', {
        payment_method_id: `pm_dev_${Date.now()}`,
      });
      await onAdvance();
    } catch (e) {
      formError = stripeErrorMessage(e);
    } finally {
      submitting = false;
    }
  }

  function stripeErrorMessage(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.errorCode === 'stripe_error') {
        const msg = (e.body as { message?: string } | null)?.message;
        return msg ? `Card declined: ${msg}` : 'Card declined.';
      }
      if (e.errorCode === 'state_machine_violation') return 'This step is no longer available.';
      return `Payment setup failed (${e.errorCode ?? e.status}).`;
    }
    return 'Network error — try again.';
  }

  onMount(bootStripe);
</script>

<div class="surface step">
  <h1>Set up payment</h1>
  <p class="muted">
    Add a card to cover the setup fee (charged now) and start your monthly
    subscription.
  </p>

  <div class="summary">
    <div class="row-2">
      <span class="label">Setup fee (charged today)</span>
      <span class="amount">{fmt(setupTotal)}</span>
    </div>
    <div class="row-2">
      <span class="label">Monthly subscription</span>
      <span class="amount">{fmt(monthlyTotal)} / mo</span>
    </div>
    <div class="row-2 sub">
      <span class="label">First monthly charge</span>
      <span class="amount">{fmtDate(monthlyStartsOn)}</span>
    </div>
  </div>

  {#if config.kind === 'loading'}
    <p class="muted small">Loading payment form…</p>
  {:else if config.kind === 'error'}
    <div class="error">{config.message}</div>
  {:else if config.kind === 'dev_placeholder'}
    <div class="callout">
      <strong>Dev placeholder mode.</strong>
      Stripe isn't configured with real test keys yet. The button below
      writes a synthetic <code>dev_*</code> Stripe row so the walkthrough
      can advance end-to-end without a real card. When the team installs
      a real <code>sk_test_</code> + <code>pk_test_</code> key pair, this
      flips to a normal Stripe Elements form on the next page load.
    </div>
    {#if formError}<div class="error">{formError}</div>{/if}
    <div class="cta">
      <Button onclick={submitDevPlaceholder} disabled={submitting}>
        {submitting ? 'Submitting…' : `Use placeholder payment method (charge ${fmt(setupTotal)})`}
      </Button>
    </div>
  {:else}
    <div class="elements-mount" bind:this={elementContainer}></div>
    {#if formError}<div class="error">{formError}</div>{/if}
    <div class="cta">
      <Button onclick={submitRealPayment} disabled={submitting || !cardComplete}>
        {submitting ? 'Processing…' : `Pay ${fmt(setupTotal)} and start subscription`}
      </Button>
    </div>
  {/if}
</div>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-4); }
  .summary {
    background: #fafaf8;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .row-2 { display: flex; justify-content: space-between; align-items: baseline; }
  .row-2.sub { padding-top: 0.6rem; border-top: 1px dashed var(--border); }
  .row-2 .label { color: var(--muted); }
  .row-2 .amount { font-weight: 600; font-variant-numeric: tabular-nums; }
  .elements-mount {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4);
    min-height: 5rem;
  }
  .callout {
    background: #fff7e6;
    border: 1px solid #f1d8a3;
    border-radius: var(--radius);
    padding: var(--space-3) var(--space-4);
    font-size: 0.9rem;
    color: #6b4a06;
  }
  .callout code { background: rgba(0,0,0,.06); padding: 0 0.2rem; border-radius: 3px; }
  .cta { display: flex; align-items: center; gap: var(--space-3); }
</style>

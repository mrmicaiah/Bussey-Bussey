<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { api } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import type { PortalMe } from '$lib/types';

  let { data }: { data: { me: PortalMe } } = $props();

  type PaymentSummary = {
    subscription: {
      monthly_amount: number;
      current_period_end: string | null;
      status: string;
    } | null;
    payment_method: { status: string; last_4: string | null; brand: string | null } | null;
  };

  type ProjectStatus = {
    name: string;
    current_phase: string | null;
    build_status_note: string | null;
    next_milestone: string | null;
    updated_at: string | null;
  };

  type ActivityEvent = {
    id: string;
    action: string;
    entity_id: string;
    created_at: string;
    summary: Record<string, unknown> | null;
  };

  let payment = $state<PaymentSummary | null>(null);
  let project = $state<ProjectStatus | null>(null);
  let activity = $state<ActivityEvent[]>([]);
  let loaded = $state(false);

  function fmtCurrency(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }
  function fmtDate(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  }
  function relTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const h = Math.floor(ms / 3_600_000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return '1 day ago';
    return `${d} days ago`;
  }

  function describeActivity(e: ActivityEvent): string {
    const s = e.summary ?? {};
    switch (e.action) {
      case 'change_order.proposed':
        return 'A change order is ready for your review.';
      case 'change_order.approved':
        return 'Change order approved.';
      case 'change_order.rejected':
        return 'Change order rejected.';
      case 'change_order.withdrawn':
        return 'A change order was withdrawn.';
      case 'stripe_invoice.create':
        return s['kind'] === 'change_order_setup'
          ? `Change-order setup invoice: ${fmtCurrency(Number(s['amount'] ?? 0))}`
          : `Invoice issued: ${fmtCurrency(Number(s['amount'] ?? 0))}`;
      case 'stripe.webhook.invoice_payment_succeeded':
        return 'Payment processed successfully.';
      case 'stripe.webhook.invoice_payment_failed':
        return 'Payment failed — please review your payment method.';
      case 'project.update':
        return 'Project status updated.';
      case 'contract.signed':
        return 'Master Service Agreement signed.';
      case 'walkthrough.completed':
        return 'Account activation complete.';
      default:
        return e.action;
    }
  }

  onMount(async () => {
    try {
      const [pm, ps, ac] = await Promise.all([
        api.get<PaymentSummary>('/api/portal/payment/summary'),
        api.get<{ project: ProjectStatus }>('/api/portal/project-status'),
        api.get<{ activity: ActivityEvent[] }>('/api/portal/activity?limit=5'),
      ]);
      payment = pm;
      project = ps.project;
      activity = ac.activity;
    } catch (e) {
      console.error(e);
    } finally {
      loaded = true;
    }
  });
</script>

<svelte:head><title>Portal · Bussey and Bussey</title></svelte:head>

<h1>Welcome back, {data.me.client.primary_contact_name?.split(' ')[0] ?? 'there'}.</h1>
<p class="muted">{data.me.client.company_name}{data.me.opportunity ? ` · ${data.me.opportunity.name}` : ''}</p>

<div class="grid">
  <div class="surface">
    <h2>Engagement</h2>
    {#if data.me.opportunity}
      <div class="kv"><span class="muted">Opportunity</span><span>{data.me.opportunity.name}</span></div>
      <div class="kv"><span class="muted">Activated</span><span>{fmtDate(data.me.opportunity.accepted_at)}</span></div>
      <div class="kv"><span class="muted">Monthly</span>
        <span>
          {payment?.subscription
            ? fmtCurrency(payment.subscription.monthly_amount) + ' / mo'
            : fmtCurrency(data.me.opportunity.monthly_total) + ' / mo'}
        </span>
      </div>
      {#if payment?.subscription?.current_period_end}
        <div class="kv"><span class="muted">Next bill</span><span>{fmtDate(payment.subscription.current_period_end)}</span></div>
      {/if}
    {/if}
  </div>

  <div class="surface">
    <h2>Project status</h2>
    {#if project}
      <div class="kv"><span class="muted">Phase</span><span>{project.current_phase ?? '—'}</span></div>
      <div class="kv"><span class="muted">Next milestone</span><span>{project.next_milestone ?? '—'}</span></div>
      {#if project.build_status_note}
        <p class="note">{project.build_status_note}</p>
      {/if}
      <p class="muted small">Last updated {project.updated_at ? relTime(project.updated_at) : '—'}.</p>
    {:else}
      <p class="muted">Loading…</p>
    {/if}
  </div>
</div>

<div class="surface" style="margin-top: var(--space-4);">
  <h2>Recent activity</h2>
  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else if activity.length === 0}
    <p class="muted">No recent activity.</p>
  {:else}
    <ul class="feed">
      {#each activity as e (e.id)}
        <li>
          <span class="dot" aria-hidden="true"></span>
          <div>
            <span>{describeActivity(e)}</span>
            <span class="muted small"> · {relTime(e.created_at)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<div class="cta-row">
  <a href={`${base}/change-requests/new`}><Button>Request a change</Button></a>
  <a href={`${base}/documents`}><Button variant="secondary">View documents</Button></a>
</div>

<style>
  h1 { margin-bottom: var(--space-2); }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  .kv {
    display: flex;
    justify-content: space-between;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .kv:last-of-type { border-bottom: 0; }
  .note {
    background: #fafaf8;
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius);
    margin: 0.6rem 0 0.4rem;
    font-size: 0.9rem;
  }
  .feed { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .feed li { display: flex; gap: 0.7rem; align-items: flex-start; }
  .dot {
    width: 8px; height: 8px;
    margin-top: 0.45rem;
    background: var(--accent);
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cta-row { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }
</style>

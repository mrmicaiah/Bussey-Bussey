import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { verifyStripeSignature } from '../../services/stripe';
import { writeAudit } from '../../lib/audit';
import { sendEmail, adminNotifyRecipients } from '../../services/email';

/**
 * POST /api/webhooks/stripe
 *
 * Receives Stripe events and dispatches to handlers. Per the J2 spec,
 * signature verification is **mandatory in dev too** — the same
 * `STRIPE_WEBHOOK_SECRET` env var is used in every environment, just with
 * a different value. No dev-bypass flag.
 *
 * To verify in dev: run `stripe listen --forward-to
 * localhost:8787/api/webhooks/stripe`, copy the printed `whsec_…` value
 * into `.dev.vars` as `STRIPE_WEBHOOK_SECRET`, then `stripe trigger
 * invoice.payment_succeeded` (or any other event) to exercise the path.
 *
 * Handlers are idempotent against the existing UNIQUE constraints on
 * `stripe_invoice.stripe_invoice_id` and `stripe_subscription.stripe_subscription_id`.
 * Unknown event types return 200 `{ received: true, handled: false }`.
 */

type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

export async function stripeWebhookHandler(ctx: HandlerContext): Promise<Response> {
  const rawBody = await ctx.request.text();
  const sigHeader = ctx.request.headers.get('stripe-signature');

  if (!ctx.env.STRIPE_WEBHOOK_SECRET) {
    // Server misconfiguration — return 500 so Stripe retries (and so an admin
    // notices the configuration gap quickly).
    return json({ error: 'webhook_secret_missing' }, { status: 500 });
  }

  const verification = await verifyStripeSignature({
    rawBody,
    signatureHeader: sigHeader,
    secret: ctx.env.STRIPE_WEBHOOK_SECRET,
  });
  if (!verification.ok) {
    return json({ error: 'signature_verification_failed', reason: verification.reason }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }

  switch (event.type) {
    case 'invoice.payment_succeeded':
      return handleInvoicePaymentSucceeded(ctx, event);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(ctx, event);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(ctx, event);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(ctx, event);
    case 'payment_method.attached':
      // Recorded but no-op for v1 — we don't yet surface card-on-file in the
      // portal UI. Acknowledging keeps Stripe from retrying.
      await writeAudit(ctx.env, {
        actorType: 'system',
        actorId: null,
        action: 'stripe.webhook.payment_method_attached',
        entityType: 'stripe_event',
        entityId: event.id,
        changes: { event_type: event.type },
      });
      return json({ received: true, handled: true });
    default:
      return json({ received: true, handled: false });
  }
}

async function handleInvoicePaymentSucceeded(ctx: HandlerContext, event: StripeEvent): Promise<Response> {
  const obj = event.data.object as {
    id: string;
    status: string;
    status_transitions?: { paid_at: number | null };
    amount_paid: number;
  };
  const paidAt =
    obj.status_transitions?.paid_at !== undefined && obj.status_transitions.paid_at !== null
      ? new Date(obj.status_transitions.paid_at * 1000).toISOString()
      : new Date().toISOString();
  const result = await ctx.env.DB.prepare(
    `UPDATE stripe_invoice SET status = 'paid', paid_at = ? WHERE stripe_invoice_id = ?`,
  )
    .bind(paidAt, obj.id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'system',
    actorId: null,
    action: 'stripe.webhook.invoice_payment_succeeded',
    entityType: 'stripe_event',
    entityId: event.id,
    changes: {
      stripe_invoice_id: obj.id,
      amount_paid: obj.amount_paid,
      paid_at: paidAt,
      rows_updated: (result.meta as { changes?: number } | undefined)?.changes ?? 0,
    },
  });

  // Notify the client (receipt). Resolve recipient via the stripe_invoice
  // row → client. Skip silently if there's no row for this invoice id
  // (covers Stripe-CLI test events triggered without a corresponding D1 row).
  const recipient = await ctx.env.DB.prepare(
    `SELECT c.primary_contact_email AS email,
            c.primary_contact_name AS name,
            c.company_name AS company,
            inv.kind AS invoice_kind,
            inv.amount AS amount
       FROM stripe_invoice inv
       JOIN client c ON c.id = inv.client_id
      WHERE inv.stripe_invoice_id = ?
      LIMIT 1`,
  )
    .bind(obj.id)
    .first<{ email: string | null; name: string | null; company: string; invoice_kind: string; amount: number }>();
  if (recipient && recipient.email) {
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'payment_succeeded',
        to: recipient.email,
        subject: `Receipt — $${recipient.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} from Bussey and Bussey`,
        text: paymentSucceededEmailText({
          name: recipient.name,
          company: recipient.company,
          invoiceKind: recipient.invoice_kind,
          amount: recipient.amount,
          paidAtIso: paidAt,
        }),
        relatedEntity: { type: 'stripe_invoice', id: obj.id },
      }),
    );
  }

  return json({ received: true, handled: true });
}

async function handleInvoicePaymentFailed(ctx: HandlerContext, event: StripeEvent): Promise<Response> {
  const obj = event.data.object as { id: string; status: string; customer: string };
  await ctx.env.DB.prepare(
    `UPDATE stripe_invoice SET status = ? WHERE stripe_invoice_id = ?`,
  )
    .bind(obj.status ?? 'open', obj.id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'system',
    actorId: null,
    action: 'stripe.webhook.invoice_payment_failed',
    entityType: 'stripe_event',
    entityId: event.id,
    changes: { stripe_invoice_id: obj.id, status: obj.status, customer: obj.customer },
  });
  // Notify the admin so the failure isn't silent.
  const recipients = adminNotifyRecipients(ctx.env);
  if (recipients.length > 0) {
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'payment_failed',
        to: recipients,
        subject: `[Stripe] invoice.payment_failed ${obj.id}`,
        text: `Stripe reports invoice ${obj.id} payment_failed (status=${obj.status}).\nCustomer: ${obj.customer}\nEvent ID: ${event.id}`,
        relatedEntity: { type: 'stripe_event', id: event.id },
      }),
    );
  }

  // Notify the client too — payment failed is something they need to act on.
  const recipient = await ctx.env.DB.prepare(
    `SELECT c.primary_contact_email AS email,
            c.primary_contact_name AS name,
            c.company_name AS company,
            inv.amount AS amount
       FROM stripe_invoice inv
       JOIN client c ON c.id = inv.client_id
      WHERE inv.stripe_invoice_id = ?
      LIMIT 1`,
  )
    .bind(obj.id)
    .first<{ email: string | null; name: string | null; company: string; amount: number }>();
  if (recipient && recipient.email) {
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'payment_failed',
        to: recipient.email,
        subject: `Action needed: payment couldn't be processed`,
        text: paymentFailedEmailText({
          name: recipient.name,
          company: recipient.company,
          amount: recipient.amount,
        }),
        relatedEntity: { type: 'stripe_invoice', id: obj.id },
      }),
    );
  }
  return json({ received: true, handled: true });
}

// ─── Email copy (single-file swap point) ─────────────────────────────

function paymentSucceededEmailText(args: {
  name: string | null;
  company: string;
  invoiceKind: string;
  amount: number;
  paidAtIso: string;
}): string {
  const greeting = args.name?.trim() || 'there';
  const kindLabel =
    args.invoiceKind === 'setup'
      ? 'setup fee'
      : args.invoiceKind === 'change_order_setup'
        ? 'change order setup adjustment'
        : 'monthly subscription';
  return [
    `Hi ${greeting},`,
    '',
    `Thanks for your payment — your ${kindLabel} was processed successfully.`,
    '',
    `  Amount: $${args.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `  Date:   ${new Date(args.paidAtIso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `  Account: ${args.company}`,
    '',
    `Your full invoice history is available in your portal under Payment & Billing.`,
    '',
    '— Bussey and Bussey',
  ].join('\n');
}

function paymentFailedEmailText(args: {
  name: string | null;
  company: string;
  amount: number;
}): string {
  const greeting = args.name?.trim() || 'there';
  return [
    `Hi ${greeting},`,
    '',
    `Heads up — we tried to process a payment for ${args.company} and it didn't go through.`,
    '',
    `  Amount: $${args.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    '',
    `The most common cause is an expired or recently-changed card on file.`,
    `You can update your payment method in your portal under Payment & Billing,`,
    `and we'll retry automatically.`,
    '',
    `If you'd like help, just reply to this email.`,
    '',
    '— Bussey and Bussey',
  ].join('\n');
}

async function handleSubscriptionUpdated(ctx: HandlerContext, event: StripeEvent): Promise<Response> {
  const obj = event.data.object as {
    id: string;
    status: string;
    current_period_end: number;
    items?: { data?: Array<{ price?: { unit_amount?: number } }> };
  };
  const periodEnd = new Date(obj.current_period_end * 1000).toISOString();
  const monthlyCents = obj.items?.data?.[0]?.price?.unit_amount ?? null;
  const monthlyAmount = monthlyCents !== null ? monthlyCents / 100 : null;
  if (monthlyAmount !== null) {
    await ctx.env.DB.prepare(
      `UPDATE stripe_subscription
         SET status = ?, current_period_end = ?, current_amount_monthly = ?
       WHERE stripe_subscription_id = ?`,
    )
      .bind(normalizeSubStatus(obj.status), periodEnd, monthlyAmount, obj.id)
      .run();
  } else {
    await ctx.env.DB.prepare(
      `UPDATE stripe_subscription
         SET status = ?, current_period_end = ?
       WHERE stripe_subscription_id = ?`,
    )
      .bind(normalizeSubStatus(obj.status), periodEnd, obj.id)
      .run();
  }
  await writeAudit(ctx.env, {
    actorType: 'system',
    actorId: null,
    action: 'stripe.webhook.subscription_updated',
    entityType: 'stripe_event',
    entityId: event.id,
    changes: {
      stripe_subscription_id: obj.id,
      status: obj.status,
      current_period_end: periodEnd,
      monthly_amount: monthlyAmount,
    },
  });
  return json({ received: true, handled: true });
}

async function handleSubscriptionDeleted(ctx: HandlerContext, event: StripeEvent): Promise<Response> {
  const obj = event.data.object as { id: string };
  await ctx.env.DB.prepare(
    `UPDATE stripe_subscription SET status = 'canceled' WHERE stripe_subscription_id = ?`,
  )
    .bind(obj.id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'system',
    actorId: null,
    action: 'stripe.webhook.subscription_deleted',
    entityType: 'stripe_event',
    entityId: event.id,
    changes: { stripe_subscription_id: obj.id, status: 'canceled' },
  });
  return json({ received: true, handled: true });
}

function normalizeSubStatus(stripeStatus: string): string {
  // Project schema: ('active', 'past_due', 'canceled'). Bucket every Stripe
  // status into one of those so the CHECK constraint holds.
  if (stripeStatus === 'past_due') return 'past_due';
  if (stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired') return 'canceled';
  return 'active';
}

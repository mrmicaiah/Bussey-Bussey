import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { isStripeDevPlaceholder } from '../../services/stripe';

/**
 * Portal payment endpoints:
 *   GET  /api/portal/payment/summary       — subscription card + payment method
 *   GET  /api/portal/payment/invoices      — full invoice history
 *   POST /api/portal/payment/portal-session — Stripe Billing Portal session URL
 *
 * Payment-method last-4/brand display is sourced from
 * payment_method.attached webhook events in a future iteration. For K2
 * the field is reported as null with a `payment_method_status: 'on_file'`
 * sentinel, which is enough to render "Card on file" + an Update button.
 */

type SubscriptionRow = {
  id: string;
  stripe_subscription_id: string;
  status: string;
  current_amount_monthly: number;
  current_period_end: string | null;
  stripe_customer_id: string;
};

export async function portalPaymentSummaryHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const sub = await ctx.env.DB.prepare(
    `SELECT ss.id, ss.stripe_subscription_id, ss.status, ss.current_amount_monthly,
            ss.current_period_end,
            sc.stripe_customer_id
       FROM portal_account pa
       JOIN opportunity o ON o.client_id = pa.client_id AND o.status = 'accepted'
       JOIN stripe_subscription ss ON ss.opportunity_id = o.id
       JOIN stripe_customer sc ON sc.client_id = ss.client_id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC
      LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<SubscriptionRow>();
  if (!sub) return json({ subscription: null, payment_method: null });
  return json({
    subscription: {
      id: sub.id,
      stripe_subscription_id: sub.stripe_subscription_id,
      status: sub.status,
      monthly_amount: sub.current_amount_monthly,
      current_period_end: sub.current_period_end,
    },
    payment_method: {
      status: 'on_file',
      // last_4 + brand wired in a future iteration via payment_method.attached.
      last_4: null,
      brand: null,
    },
  });
}

export async function portalPaymentInvoicesHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const res = await ctx.env.DB.prepare(
    `SELECT inv.id, inv.stripe_invoice_id, inv.kind, inv.amount, inv.status, inv.paid_at, inv.created_at
       FROM stripe_invoice inv
       JOIN portal_account pa ON pa.client_id = inv.client_id
      WHERE pa.id = ?
      ORDER BY inv.created_at DESC`,
  )
    .bind(ctx.session.subjectId)
    .all();
  return json({ invoices: res.results ?? [] });
}

const PORTAL_RETURN_URL_BASE = 'http://localhost:5174/portal/payment'; // dev-hardcoded; see notes/deferred-cleanup.md

export async function portalPaymentPortalSessionHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const sub = await ctx.env.DB.prepare(
    `SELECT sc.stripe_customer_id
       FROM portal_account pa
       JOIN stripe_customer sc ON sc.client_id = pa.client_id
      WHERE pa.id = ?
      LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<{ stripe_customer_id: string }>();
  if (!sub) return json({ error: 'no_stripe_customer' }, { status: 409 });

  const dev = isStripeDevPlaceholder(ctx.env);
  if (dev) {
    return json({
      url: `${PORTAL_RETURN_URL_BASE}?dev_portal_session=true`,
      dev_placeholder: true,
    });
  }

  // Real Stripe: POST /v1/billing_portal/sessions.
  const params = new URLSearchParams({
    customer: sub.stripe_customer_id,
    return_url: PORTAL_RETURN_URL_BASE,
  }).toString();
  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-09-30.acacia',
    },
    body: params,
  });
  const parsed = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
  if (!res.ok || !parsed?.url) {
    return json(
      { error: 'stripe_portal_session_failed', detail: parsed?.error?.message ?? `Stripe ${res.status}` },
      { status: 502 },
    );
  }
  return json({ url: parsed.url, dev_placeholder: false });
}

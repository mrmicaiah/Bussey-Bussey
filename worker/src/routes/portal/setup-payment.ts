import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import {
  createCustomer,
  attachPaymentMethod,
  setDefaultPaymentMethod,
  createInvoiceItem,
  createAndPayInvoice,
  createSubscription,
  isStripeDevPlaceholder,
  devStripeId,
  StripeError,
} from '../../services/stripe';

/**
 * POST /api/portal/walkthrough/setup-payment
 *
 * Step 4 of the walkthrough. Creates the Stripe customer, charges the setup
 * fee immediately, and starts the monthly subscription with a billing-cycle
 * anchor at `opportunity.monthly_start_date` (or `accepted_at + 30 days` if
 * the column is NULL — see migration 0005).
 *
 * Body: `{ payment_method_id: string }`.
 *
 * Dev-placeholder mode (when `STRIPE_SECRET_KEY === 'sk_test_replace_me'`)
 * fabricates `dev_*` IDs and skips the Stripe REST calls. Real Stripe
 * activates when a real `sk_test_…` key is installed. Same pattern as
 * chat/email — see notes/deferred-cleanup.md.
 *
 * Persistence: single D1 batch with stripe_customer + stripe_subscription
 * + stripe_invoice + portal_account state advance + audit cascade (umbrella
 * `payment.setup_completed` + per-entity rows). If Stripe fails, no DB
 * rows are written and the client stays in `contract_signed` for retry.
 */

type Ctx = {
  portal_account_id: string;
  client_id: string;
  client_company_name: string;
  client_primary_contact_email: string;
  walkthrough_state: string;
  opportunity_id: string;
  opportunity_name: string;
  accepted_at: string;
  monthly_start_date: string | null;
  proposal_id: string;
  setup_total: number;
  monthly_total: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function setupPaymentHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const body = await readJsonObject(ctx.request);
  const paymentMethodId = body && typeof body['payment_method_id'] === 'string'
    ? body['payment_method_id']
    : '';
  if (!paymentMethodId) return json({ error: 'payment_method_id_required' }, { status: 400 });

  const context = await ctx.env.DB.prepare(
    `SELECT pa.id AS portal_account_id,
            pa.client_id,
            pa.walkthrough_state,
            c.company_name AS client_company_name,
            c.primary_contact_email AS client_primary_contact_email,
            o.id AS opportunity_id,
            o.name AS opportunity_name,
            o.accepted_at,
            o.monthly_start_date,
            p.id AS proposal_id,
            p.setup_total,
            p.monthly_total
       FROM portal_account pa
       JOIN client c ON c.id = pa.client_id
       JOIN opportunity o
            ON o.client_id = pa.client_id
           AND o.status = 'accepted'
       JOIN proposal p
            ON p.opportunity_id = o.id
           AND p.status = 'accepted'
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC
      LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<Ctx>();
  if (!context) return json({ error: 'walkthrough_context_missing' }, { status: 409 });
  if (context.walkthrough_state !== 'contract_signed') {
    return json(
      {
        error: 'state_machine_violation',
        current_state: context.walkthrough_state,
        message: 'Payment setup is only available after signing the contract.',
      },
      { status: 409 },
    );
  }
  if (!context.client_primary_contact_email) {
    return json({ error: 'client_missing_contact_email' }, { status: 409 });
  }

  // If a stripe_customer already exists for this client, reuse it (retry path
  // after a partial failure). Otherwise we'll create one below.
  const existingCustomer = await ctx.env.DB.prepare(
    `SELECT id, stripe_customer_id FROM stripe_customer WHERE client_id = ?`,
  )
    .bind(context.client_id)
    .first<{ id: string; stripe_customer_id: string }>();

  // Resolve the billing-cycle anchor: either the per-opportunity override or
  // the +30-day default. The Stripe API takes a Unix-seconds timestamp.
  const monthlyStartDate = resolveMonthlyStartDate(
    context.monthly_start_date,
    context.accepted_at,
  );
  const billingCycleAnchorUnix = Math.floor(
    new Date(`${monthlyStartDate}T00:00:00Z`).getTime() / 1000,
  );

  const setupAmountCents = Math.round(context.setup_total * 100);
  const monthlyAmountCents = Math.round(context.monthly_total * 100);

  const dev = isStripeDevPlaceholder(ctx.env);
  if (dev) {
    console.log(
      '[stripe:dev-placeholder] setup-payment for opportunity',
      context.opportunity_id,
      `(setup_total=${context.setup_total} monthly=${context.monthly_total} anchor=${monthlyStartDate})`,
    );
  }

  let stripeCustomerId: string;
  let stripeSubscriptionId: string;
  let stripeSubscriptionItemId: string;
  let stripeInvoiceId: string;
  let invoicePaidAt: string | null = null;
  let subscriptionPeriodEnd: string | null = null;
  let subscriptionStatus = 'active';
  let stripeOpsOk = true;

  try {
    if (dev) {
      stripeCustomerId = existingCustomer?.stripe_customer_id ?? devStripeId('cus');
      stripeSubscriptionId = devStripeId('sub');
      stripeSubscriptionItemId = devStripeId('si');
      stripeInvoiceId = devStripeId('in');
      invoicePaidAt = new Date().toISOString();
      subscriptionPeriodEnd = new Date(billingCycleAnchorUnix * 1000 + 30 * ONE_DAY_MS).toISOString();
    } else {
      // 1. Customer
      if (existingCustomer) {
        stripeCustomerId = existingCustomer.stripe_customer_id;
      } else {
        const cust = await createCustomer(ctx.env, {
          email: context.client_primary_contact_email,
          name: context.client_company_name,
          metadata: {
            client_id: context.client_id,
            opportunity_id: context.opportunity_id,
          },
        });
        stripeCustomerId = cust.id;
      }

      // 2. Attach payment method + default
      await attachPaymentMethod(ctx.env, paymentMethodId, stripeCustomerId);
      await setDefaultPaymentMethod(ctx.env, stripeCustomerId, paymentMethodId);

      // 3. Setup-fee invoice (one-time)
      await createInvoiceItem(ctx.env, {
        customerId: stripeCustomerId,
        amountCents: setupAmountCents,
        currency: 'usd',
        description: `Setup — ${context.opportunity_name}`,
        metadata: {
          opportunity_id: context.opportunity_id,
          kind: 'setup',
        },
      });
      const invoice = await createAndPayInvoice(ctx.env, {
        customerId: stripeCustomerId,
        paymentMethodId,
        metadata: {
          opportunity_id: context.opportunity_id,
          kind: 'setup',
        },
      });
      stripeInvoiceId = invoice.id;
      invoicePaidAt = invoice.paid_at
        ? new Date(invoice.paid_at * 1000).toISOString()
        : new Date().toISOString();

      // 4. Monthly subscription
      const sub = await createSubscription(ctx.env, {
        customerId: stripeCustomerId,
        priceData: {
          unit_amount_cents: monthlyAmountCents,
          currency: 'usd',
          product_name: `${context.opportunity_name} — monthly subscription`,
        },
        billingCycleAnchorUnix,
        paymentMethodId,
        metadata: {
          opportunity_id: context.opportunity_id,
          client_id: context.client_id,
        },
      });
      stripeSubscriptionId = sub.id;
      stripeSubscriptionItemId = sub.items.data[0]?.id ?? '';
      subscriptionStatus = sub.status;
      subscriptionPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    }
  } catch (e) {
    stripeOpsOk = false;
    if (e instanceof StripeError) {
      return json(
        {
          error: 'stripe_error',
          code: e.code,
          message: e.stripeMessage,
          httpStatus: e.httpStatus,
        },
        { status: 402 },
      );
    }
    throw e;
  }

  // ── Persist everything in one D1 batch ──
  const now = new Date().toISOString();
  const customerRowId = existingCustomer?.id ?? crypto.randomUUID();
  const subscriptionRowId = crypto.randomUUID();
  const invoiceRowId = crypto.randomUUID();
  const ip = ctx.session.ipAddress;
  const ua = ctx.session.userAgent;

  const stmts = [] as ReturnType<typeof ctx.env.DB.prepare>[];

  if (!existingCustomer) {
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO stripe_customer (id, client_id, stripe_customer_id)
         VALUES (?, ?, ?)`,
      ).bind(customerRowId, context.client_id, stripeCustomerId),
    );
  }

  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO stripe_subscription
         (id, client_id, opportunity_id, stripe_subscription_id, stripe_item_id, status,
          current_amount_monthly, current_period_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      subscriptionRowId,
      context.client_id,
      context.opportunity_id,
      stripeSubscriptionId,
      stripeSubscriptionItemId,
      normalizeSubscriptionStatus(subscriptionStatus),
      context.monthly_total,
      subscriptionPeriodEnd,
    ),
  );

  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO stripe_invoice
         (id, client_id, opportunity_id, stripe_invoice_id, kind, amount, status, paid_at)
       VALUES (?, ?, ?, ?, 'setup', ?, 'paid', ?)`,
    ).bind(
      invoiceRowId,
      context.client_id,
      context.opportunity_id,
      stripeInvoiceId,
      context.setup_total,
      invoicePaidAt,
    ),
  );

  stmts.push(
    ctx.env.DB.prepare(
      `UPDATE portal_account SET walkthrough_state = 'payment_set' WHERE id = ?`,
    ).bind(context.portal_account_id),
  );

  // Audit cascade — umbrella + per-entity rows per project convention.
  const auditUmbrellaId = crypto.randomUUID();
  const audit = (action: string, entityType: string, entityId: string, changes: Record<string, unknown>) =>
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      context.portal_account_id,
      action,
      entityType,
      entityId,
      JSON.stringify(changes),
      ip,
      ua,
    );

  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, 'payment.setup_completed', 'opportunity', ?, ?, ?, ?)`,
    ).bind(
      auditUmbrellaId,
      context.portal_account_id,
      context.opportunity_id,
      JSON.stringify({
        stripe_dev_placeholder: dev,
        stripe_customer_row_id: customerRowId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_row_id: subscriptionRowId,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_invoice_row_id: invoiceRowId,
        stripe_invoice_id: stripeInvoiceId,
        setup_total: context.setup_total,
        monthly_total: context.monthly_total,
        monthly_start_date: monthlyStartDate,
        // Payment method id not stored — Stripe owns that mapping.
      }),
      ip,
      ua,
    ),
  );
  if (!existingCustomer) {
    stmts.push(audit('stripe_customer.create', 'stripe_customer', customerRowId, {
      stripe_customer_id: stripeCustomerId,
      client_id: context.client_id,
    }));
  }
  stmts.push(audit('stripe_subscription.create', 'stripe_subscription', subscriptionRowId, {
    stripe_subscription_id: stripeSubscriptionId,
    opportunity_id: context.opportunity_id,
    billing_cycle_anchor: monthlyStartDate,
    monthly_amount: context.monthly_total,
  }));
  stmts.push(audit('stripe_invoice.create', 'stripe_invoice', invoiceRowId, {
    stripe_invoice_id: stripeInvoiceId,
    kind: 'setup',
    amount: context.setup_total,
    paid_at: invoicePaidAt,
  }));
  stmts.push(audit('portal_account.walkthrough_advance', 'portal_account', context.portal_account_id, {
    walkthrough_state: { from: 'contract_signed', to: 'payment_set' },
  }));

  await ctx.env.DB.batch(stmts);

  return json({
    ok: true,
    walkthrough_state: 'payment_set',
    stripe_dev_placeholder: dev,
    setup_invoice: {
      id: invoiceRowId,
      stripe_invoice_id: stripeInvoiceId,
      amount: context.setup_total,
      paid_at: invoicePaidAt,
    },
    subscription: {
      id: subscriptionRowId,
      stripe_subscription_id: stripeSubscriptionId,
      monthly_amount: context.monthly_total,
      monthly_starts_on: monthlyStartDate,
      current_period_end: subscriptionPeriodEnd,
    },
    // stripeOpsOk is true here by construction; included for future symmetry.
    _ops_ok: stripeOpsOk,
  });
}

function resolveMonthlyStartDate(
  override: string | null,
  acceptedAtIso: string,
): string {
  if (override) return override;
  const accepted = new Date(acceptedAtIso);
  const start = new Date(accepted.getTime() + 30 * ONE_DAY_MS);
  return start.toISOString().slice(0, 10);
}

function normalizeSubscriptionStatus(stripeStatus: string): string {
  // Constrain to our schema's CHECK enum: active, past_due, canceled.
  if (stripeStatus === 'active' || stripeStatus === 'past_due' || stripeStatus === 'canceled') {
    return stripeStatus;
  }
  // 'incomplete', 'trialing', 'unpaid', etc. → map to active for now; the
  // webhook handler will sync subsequent transitions.
  return 'active';
}

async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = (await req.json()) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

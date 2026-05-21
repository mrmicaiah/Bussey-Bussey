import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { sendEmail, adminNotifyRecipients } from '../../services/email';
import {
  isStripeDevPlaceholder,
  devStripeId,
  createInvoiceItem,
  createAndPayInvoice,
  updateSubscriptionItemPrice,
  StripeError,
} from '../../services/stripe';

/**
 * Portal change-order endpoints.
 *
 *   GET  /api/portal/change-orders             — list all for this client
 *   GET  /api/portal/change-orders/:id         — detail + line items
 *   POST /api/portal/change-orders/:id/approve — sign + Stripe ops + advance
 *   POST /api/portal/change-orders/:id/reject  — record reason; no Stripe
 *
 * Approval is the heart of K1: capture the client's signature, fire the
 * Stripe operations (setup_delta as a one-off invoice if nonzero; subscription
 * monthly amount updated if monthly_delta nonzero), persist a stripe_invoice
 * row + sync stripe_subscription.current_amount_monthly, and write the audit
 * cascade. If any Stripe call fails, status stays `proposed`, no rows are
 * written, and admin is notified — no orphaned data.
 *
 * Dev-placeholder mode mirrors setup-payment: fabricate `dev_*` IDs and skip
 * the real Stripe calls.
 */

type ChangeOrderJoinRow = {
  id: string;
  proposal_id: string;
  name: string;
  status: string;
  reason: string | null;
  setup_delta: number;
  monthly_delta: number;
  proposed_at: string | null;
  approved_at: string | null;
  approved_by_portal_account_id: string | null;
  created_at: string;
  client_id: string;
  client_company_name: string;
  client_primary_contact_name: string | null;
  client_primary_contact_email: string;
  opportunity_id: string;
  opportunity_name: string;
};

async function loadChangeOrderForClient(
  env: HandlerContext['env'],
  portalAccountId: string,
  changeOrderId: string,
): Promise<ChangeOrderJoinRow | null> {
  return env.DB.prepare(
    `SELECT co.id, co.proposal_id, co.name, co.status, co.reason,
            co.setup_delta, co.monthly_delta, co.proposed_at, co.approved_at,
            co.approved_by_portal_account_id, co.created_at,
            c.id AS client_id,
            c.company_name AS client_company_name,
            c.primary_contact_name AS client_primary_contact_name,
            c.primary_contact_email AS client_primary_contact_email,
            o.id AS opportunity_id,
            o.name AS opportunity_name
       FROM change_order co
       JOIN proposal p ON p.id = co.proposal_id
       JOIN opportunity o ON o.id = p.opportunity_id
       JOIN client c ON c.id = o.client_id
       JOIN portal_account pa ON pa.client_id = c.id
      WHERE pa.id = ? AND co.id = ?`,
  )
    .bind(portalAccountId, changeOrderId)
    .first<ChangeOrderJoinRow>();
}

// ─── List + Fetch ────────────────────────────────────────────────────

export async function listPortalChangeOrdersHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const res = await ctx.env.DB.prepare(
    `SELECT co.id, co.name, co.status, co.reason, co.setup_delta, co.monthly_delta,
            co.proposed_at, co.approved_at, co.created_at,
            o.id AS opportunity_id, o.name AS opportunity_name
       FROM change_order co
       JOIN proposal p ON p.id = co.proposal_id
       JOIN opportunity o ON o.id = p.opportunity_id
       JOIN client c ON c.id = o.client_id
       JOIN portal_account pa ON pa.client_id = c.id
      WHERE pa.id = ? AND co.status != 'draft'
      ORDER BY co.created_at DESC`,
  )
    .bind(ctx.session.subjectId)
    .all();
  return json({ change_orders: res.results ?? [] });
}

export async function fetchPortalChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const co = await loadChangeOrderForClient(ctx.env, ctx.session.subjectId, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  // Hide drafts from the client side — they don't exist for them yet.
  if (co.status === 'draft') return json({ error: 'not_found' }, { status: 404 });
  const linesRes = await ctx.env.DB.prepare(
    `SELECT id, action, component_code, quantity, unit_price_from_snapshot,
            line_total_delta, description_override
       FROM change_order_line_item WHERE change_order_id = ? ORDER BY created_at`,
  )
    .bind(id)
    .all();
  return json({ change_order: co, line_items: linesRes.results ?? [] });
}

// ─── Approve ─────────────────────────────────────────────────────────

export async function approveChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  const typedName =
    body && typeof body['typed_name'] === 'string' ? body['typed_name'].trim() : '';
  if (!typedName) return json({ error: 'signature_required' }, { status: 400 });

  const co = await loadChangeOrderForClient(ctx.env, ctx.session.subjectId, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'proposed') {
    return json(
      { error: 'change_order_not_approvable', status: co.status, message: 'Only proposed change orders can be approved.' },
      { status: 409 },
    );
  }

  // Stripe context for the operations.
  const stripeCtx = await ctx.env.DB.prepare(
    `SELECT sc.id AS stripe_customer_row_id,
            sc.stripe_customer_id,
            ss.id AS stripe_subscription_row_id,
            ss.stripe_subscription_id,
            ss.stripe_item_id,
            ss.current_amount_monthly
       FROM stripe_customer sc
       JOIN stripe_subscription ss ON ss.client_id = sc.client_id AND ss.opportunity_id = ?
      WHERE sc.client_id = ?`,
  )
    .bind(co.opportunity_id, co.client_id)
    .first<{
      stripe_customer_row_id: string;
      stripe_customer_id: string;
      stripe_subscription_row_id: string;
      stripe_subscription_id: string;
      stripe_item_id: string | null;
      current_amount_monthly: number;
    }>();
  if (!stripeCtx) {
    return json({ error: 'stripe_context_missing', message: 'No stripe customer + subscription on file.' }, { status: 409 });
  }

  const setupCents = Math.round(co.setup_delta * 100);
  const newMonthly = stripeCtx.current_amount_monthly + co.monthly_delta;
  const newMonthlyCents = Math.round(newMonthly * 100);
  const monthlyChanged = co.monthly_delta !== 0;
  const setupNonZero = setupCents !== 0;

  const dev = isStripeDevPlaceholder(ctx.env);

  let newInvoiceStripeId: string | null = null;
  let newInvoicePaidAt: string | null = null;

  try {
    if (setupNonZero) {
      if (setupCents > 0) {
        if (dev) {
          newInvoiceStripeId = devStripeId('in');
          newInvoicePaidAt = new Date().toISOString();
        } else {
          await createInvoiceItem(ctx.env, {
            customerId: stripeCtx.stripe_customer_id,
            amountCents: setupCents,
            currency: 'usd',
            description: `Change order — ${co.name}`,
            metadata: { change_order_id: co.id, kind: 'change_order_setup' },
          });
          const invoice = await createAndPayInvoice(ctx.env, {
            customerId: stripeCtx.stripe_customer_id,
            // No saved payment method id available here — Stripe uses the
            // customer's default from setup-payment. paymentMethodId stays
            // empty string and the call still works (Stripe falls back).
            paymentMethodId: '',
            metadata: { change_order_id: co.id, kind: 'change_order_setup' },
          });
          newInvoiceStripeId = invoice.id;
          newInvoicePaidAt = invoice.paid_at
            ? new Date(invoice.paid_at * 1000).toISOString()
            : new Date().toISOString();
        }
      } else {
        // Negative setup_delta: in v1 we just record the credit-intent as a
        // synthetic invoice row with kind=change_order_setup and amount<0.
        // A real customer-balance-transaction credit is out of K1 scope —
        // covered in a future iteration. Document via deferred-cleanup.
        if (dev) {
          newInvoiceStripeId = devStripeId('credit');
          newInvoicePaidAt = new Date().toISOString();
        } else {
          // Real Stripe: also a credit-balance-transaction. Skipped in K1.
          // Defer raises a controlled error so this path isn't silently
          // ignored when a real key is installed.
          return json(
            {
              error: 'negative_setup_delta_not_supported_yet',
              message: 'Setup credits via real Stripe land in a follow-up; use dev placeholder for now.',
            },
            { status: 501 },
          );
        }
      }
    }

    if (monthlyChanged) {
      if (!dev) {
        if (!stripeCtx.stripe_item_id) {
          return json(
            {
              error: 'stripe_item_id_missing',
              message: 'The subscription has no stored item id (created before migration 0006). Reactivate or re-issue the subscription before changing monthly amount.',
            },
            { status: 409 },
          );
        }
        await updateSubscriptionItemPrice(ctx.env, {
          subscriptionId: stripeCtx.stripe_subscription_id,
          itemId: stripeCtx.stripe_item_id,
          newUnitAmountCents: newMonthlyCents,
          currency: 'usd',
          productName: `${co.opportunity_name} — monthly subscription`,
        });
      }
      // In dev placeholder we just update the local record below.
    }
  } catch (e) {
    if (e instanceof StripeError) {
      // Notify admin so the failure isn't silent. There's no dedicated
      // `change_order_failed` value in the notification.kind enum, so
      // 'other' carries the subject. Tracked in notes/deferred-cleanup.md.
      const notifyTo = adminNotifyRecipients(ctx.env);
      if (notifyTo.length) {
        ctx.ctx.waitUntil(
          sendEmail(ctx.env, {
            kind: 'other',
            to: notifyTo,
            subject: `[Change order] Stripe failure on approve — ${co.name}`,
            text: `Change order ${co.id} approval Stripe failure:\n${e.code}: ${e.stripeMessage}\n\nState left at "proposed"; client did not advance.`,
            relatedEntity: { type: 'change_order', id: co.id },
          }),
        );
      }
      return json(
        { error: 'stripe_error', code: e.code, message: e.stripeMessage, httpStatus: e.httpStatus },
        { status: 402 },
      );
    }
    throw e;
  }

  // ── Persist everything in one D1 batch. ──
  const now = new Date().toISOString();
  const sigId = crypto.randomUUID();
  const ip = ctx.session.ipAddress;
  const ua = ctx.session.userAgent;

  const stmts = [] as ReturnType<typeof ctx.env.DB.prepare>[];

  stmts.push(
    ctx.env.DB.prepare(
      `UPDATE change_order
         SET status = 'approved', approved_at = ?, approved_by_portal_account_id = ?
       WHERE id = ?`,
    ).bind(now, ctx.session.subjectId, co.id),
  );

  // Signature event.
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO document_signature
         (id, portal_account_id, document_type, document_id, signature_type,
          typed_name, typed_initials, ip_address, user_agent, opportunity_id, signed_at)
       VALUES (?, ?, 'change_order', ?, 'agreement_acceptance', ?, NULL, ?, ?, ?, ?)`,
    ).bind(sigId, ctx.session.subjectId, co.id, typedName, ip, ua, co.opportunity_id, now),
  );

  // Subscription monthly amount sync (dev or real — local record).
  if (monthlyChanged) {
    stmts.push(
      ctx.env.DB.prepare(
        `UPDATE stripe_subscription SET current_amount_monthly = ? WHERE id = ?`,
      ).bind(newMonthly, stripeCtx.stripe_subscription_row_id),
    );
  }

  // stripe_invoice for the setup delta, if any.
  let newInvoiceRowId: string | null = null;
  if (setupNonZero && newInvoiceStripeId) {
    newInvoiceRowId = crypto.randomUUID();
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO stripe_invoice
           (id, client_id, opportunity_id, stripe_invoice_id, kind, amount, status, paid_at)
         VALUES (?, ?, ?, ?, 'change_order_setup', ?, 'paid', ?)`,
      ).bind(
        newInvoiceRowId,
        co.client_id,
        co.opportunity_id,
        newInvoiceStripeId,
        co.setup_delta,
        newInvoicePaidAt,
      ),
    );
  }

  // Audit cascade — umbrella + per-entity. Capture the actor locally so
  // the closure doesn't re-narrow ctx.session on every call.
  const actorId = ctx.session.subjectId;
  const audit = (action: string, entityType: string, entityId: string, changes: Record<string, unknown>) =>
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(changes),
      ip,
      ua,
    );

  stmts.push(audit('change_order.approved', 'change_order', co.id, {
    status: { from: 'proposed', to: 'approved' },
    setup_delta: co.setup_delta,
    monthly_delta: co.monthly_delta,
    new_monthly: newMonthly,
    signature_id: sigId,
    stripe_dev_placeholder: dev,
    stripe_invoice_id: newInvoiceStripeId,
    stripe_invoice_row_id: newInvoiceRowId,
  }));
  if (newInvoiceRowId) {
    stmts.push(audit('stripe_invoice.create', 'stripe_invoice', newInvoiceRowId, {
      stripe_invoice_id: newInvoiceStripeId,
      kind: 'change_order_setup',
      amount: co.setup_delta,
      paid_at: newInvoicePaidAt,
      change_order_id: co.id,
    }));
  }
  if (monthlyChanged) {
    stmts.push(audit('stripe_subscription.update', 'stripe_subscription', stripeCtx.stripe_subscription_row_id, {
      current_amount_monthly: { from: stripeCtx.current_amount_monthly, to: newMonthly },
      reason: 'change_order_approved',
      change_order_id: co.id,
    }));
  }

  await ctx.env.DB.batch(stmts);

  // Notify admin of the approval.
  const notifyTo = adminNotifyRecipients(ctx.env);
  if (notifyTo.length) {
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'change_order_approved',
        to: notifyTo,
        subject: `[Change order approved] ${co.client_company_name} — ${co.name}`,
        text:
          `${co.client_company_name} approved change order ${co.name} (${co.id}).\n` +
          `Setup delta: $${co.setup_delta.toFixed(2)}; monthly delta: $${co.monthly_delta.toFixed(2)}.\n` +
          `New monthly: $${newMonthly.toFixed(2)}.\n` +
          (dev ? '(Stripe ops ran in dev-placeholder mode — synthetic IDs.)\n' : ''),
        relatedEntity: { type: 'change_order', id: co.id },
      }),
    );
  }

  return json({
    ok: true,
    change_order_id: co.id,
    status: 'approved',
    signature_id: sigId,
    stripe_dev_placeholder: dev,
    setup_invoice: newInvoiceRowId
      ? { id: newInvoiceRowId, stripe_invoice_id: newInvoiceStripeId, amount: co.setup_delta, paid_at: newInvoicePaidAt }
      : null,
    subscription: monthlyChanged
      ? {
          stripe_subscription_id: stripeCtx.stripe_subscription_id,
          previous_monthly: stripeCtx.current_amount_monthly,
          new_monthly: newMonthly,
        }
      : null,
  });
}

// ─── Reject ──────────────────────────────────────────────────────────

export async function rejectChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  const reason =
    body && typeof body['reason'] === 'string' ? body['reason'].trim() : '';

  const co = await loadChangeOrderForClient(ctx.env, ctx.session.subjectId, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'proposed') {
    return json({ error: 'change_order_not_rejectable', status: co.status }, { status: 409 });
  }

  await ctx.env.DB.prepare(`UPDATE change_order SET status = 'rejected' WHERE id = ?`)
    .bind(id)
    .run();

  await ctx.env.DB.prepare(
    `INSERT INTO audit_log
       (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
     VALUES (?, 'portal_account', ?, 'change_order.rejected', 'change_order', ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      ctx.session.subjectId,
      id,
      JSON.stringify({
        status: { from: 'proposed', to: 'rejected' },
        reason_provided: reason || null,
      }),
      ctx.session.ipAddress,
      ctx.session.userAgent,
    )
    .run();

  const notifyTo = adminNotifyRecipients(ctx.env);
  if (notifyTo.length) {
    // No dedicated `change_order_rejected` kind in the notification enum;
    // 'other' carries the subject. See notes/deferred-cleanup.md.
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'other',
        to: notifyTo,
        subject: `[Change order rejected] ${co.client_company_name} — ${co.name}`,
        text:
          `${co.client_company_name} rejected change order ${co.name} (${co.id}).\n` +
          `Reason: ${reason || '(none provided)'}`,
        relatedEntity: { type: 'change_order', id: co.id },
      }),
    );
  }

  return json({ ok: true, change_order_id: id, status: 'rejected' });
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

import type { Env } from '../types/env';

/**
 * Stripe REST API client — raw fetch, no SDK.
 *
 * The Stripe Node SDK is ~500 KB minified; for the handful of calls we make
 * in the walkthrough flow + webhook handler it's much lighter to talk to
 * the REST API directly. Stripe's API is form-encoded; helpers below build
 * the `application/x-www-form-urlencoded` bodies with bracket-style nested
 * keys (e.g. `metadata[client_id]`).
 *
 * All callers should route through this module so the dev-placeholder mode
 * (when `STRIPE_SECRET_KEY === 'sk_test_replace_me'`) is enforced in one
 * place: `isStripeDevPlaceholder(env)` short-circuits the real API and
 * returns synthetic IDs with a `dev_` prefix. Mirrors the chat/email
 * dev-stub pattern; see notes/deferred-cleanup.md.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    public readonly stripeMessage: string,
    public readonly raw?: unknown,
  ) {
    super(`Stripe ${httpStatus} ${code}: ${stripeMessage}`);
    this.name = 'StripeError';
  }
}

export function isStripeDevPlaceholder(env: Env): boolean {
  return !env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY === 'sk_test_replace_me';
}

/** Generate a placeholder Stripe-shaped ID used in dev mode. */
export function devStripeId(prefix: string): string {
  // 24 random base32 chars — close to Stripe's own format for dev recognizability.
  const buf = new Uint8Array(15);
  crypto.getRandomValues(buf);
  let out = '';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (const b of buf) out += alphabet.charAt(b % alphabet.length);
  return `dev_${prefix}_${out}`;
}

async function stripePost<T = unknown>(
  env: Env,
  path: string,
  form: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  if (isStripeDevPlaceholder(env)) {
    throw new Error(
      'stripePost called in dev-placeholder mode — caller should branch on isStripeDevPlaceholder()',
    );
  }
  const body = formEncode(form);
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-09-30.acacia',
    },
    body,
  });
  const parsed = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error ?? null;
    throw new StripeError(
      res.status,
      err?.code ?? 'unknown_error',
      err?.message ?? `Stripe returned ${res.status}`,
      parsed,
    );
  }
  return parsed as T;
}

function formEncode(form: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(form)) {
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

// ─── Domain helpers ──────────────────────────────────────────────────

export type StripeCustomerResponse = { id: string; default_source: string | null };
export type StripeInvoiceItemResponse = { id: string; invoice: string | null };
export type StripeInvoiceResponse = {
  id: string;
  status: string;
  amount_due: number;
  amount_paid: number;
  paid_at: number | null;
};
export type StripeSubscriptionResponse = {
  id: string;
  status: string;
  current_period_end: number;
  items: { data: Array<{ id: string; price: { unit_amount: number; currency: string } }> };
};

export async function createCustomer(
  env: Env,
  args: {
    email: string;
    name: string;
    metadata: Record<string, string>;
  },
): Promise<StripeCustomerResponse> {
  return stripePost<StripeCustomerResponse>(env, '/customers', {
    email: args.email,
    name: args.name,
    ...metadataForm(args.metadata),
  });
}

export async function attachPaymentMethod(
  env: Env,
  paymentMethodId: string,
  customerId: string,
): Promise<void> {
  await stripePost(env, `/payment_methods/${paymentMethodId}/attach`, {
    customer: customerId,
  });
}

export async function setDefaultPaymentMethod(
  env: Env,
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  await stripePost(env, `/customers/${customerId}`, {
    'invoice_settings[default_payment_method]': paymentMethodId,
  });
}

export async function createInvoiceItem(
  env: Env,
  args: {
    customerId: string;
    amountCents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
  },
): Promise<StripeInvoiceItemResponse> {
  return stripePost<StripeInvoiceItemResponse>(env, '/invoiceitems', {
    customer: args.customerId,
    amount: args.amountCents,
    currency: args.currency,
    description: args.description,
    ...metadataForm(args.metadata),
  });
}

export async function createAndPayInvoice(
  env: Env,
  args: {
    customerId: string;
    paymentMethodId: string;
    metadata: Record<string, string>;
  },
): Promise<StripeInvoiceResponse> {
  // Step 1: create the invoice (collects all outstanding invoiceitems for the customer).
  const created = await stripePost<StripeInvoiceResponse & { id: string }>(env, '/invoices', {
    customer: args.customerId,
    collection_method: 'charge_automatically',
    default_payment_method: args.paymentMethodId,
    auto_advance: false,
    ...metadataForm(args.metadata),
  });
  // Step 2: finalize + pay.
  await stripePost(env, `/invoices/${created.id}/finalize`, {});
  return stripePost<StripeInvoiceResponse>(env, `/invoices/${created.id}/pay`, {});
}

export async function createSubscription(
  env: Env,
  args: {
    customerId: string;
    priceData: { unit_amount_cents: number; currency: string; product_name: string };
    billingCycleAnchorUnix: number;
    paymentMethodId: string;
    metadata: Record<string, string>;
  },
): Promise<StripeSubscriptionResponse> {
  // Inline price (no pre-created Product/Price object — keeps Stripe clean for v1).
  // billing_cycle_anchor pins the monthly to the resolved start date; proration_behavior=none
  // prevents an immediate partial-period charge between activation and the first cycle.
  return stripePost<StripeSubscriptionResponse>(env, '/subscriptions', {
    customer: args.customerId,
    'items[0][price_data][currency]': args.priceData.currency,
    'items[0][price_data][unit_amount]': args.priceData.unit_amount_cents,
    'items[0][price_data][recurring][interval]': 'month',
    'items[0][price_data][product_data][name]': args.priceData.product_name,
    billing_cycle_anchor: args.billingCycleAnchorUnix,
    proration_behavior: 'none',
    default_payment_method: args.paymentMethodId,
    ...metadataForm(args.metadata),
  });
}

export async function updateSubscriptionItemPrice(
  env: Env,
  args: {
    subscriptionId: string;
    itemId: string;
    newUnitAmountCents: number;
    currency: string;
    productName: string;
  },
): Promise<StripeSubscriptionResponse> {
  // Update the existing subscription item to a new price. proration_behavior
  // = 'none' means the change takes effect at the next billing cycle without
  // a prorated immediate charge — the default behavior spec 09 calls for.
  return stripePost<StripeSubscriptionResponse>(env, `/subscriptions/${args.subscriptionId}`, {
    'items[0][id]': args.itemId,
    'items[0][price_data][currency]': args.currency,
    'items[0][price_data][unit_amount]': args.newUnitAmountCents,
    'items[0][price_data][recurring][interval]': 'month',
    'items[0][price_data][product_data][name]': args.productName,
    proration_behavior: 'none',
  });
}

function metadataForm(metadata: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) out[`metadata[${k}]`] = v;
  return out;
}

// ─── Webhook signature verification ──────────────────────────────────

/**
 * Verify a Stripe webhook signature against the signing secret. Reject if:
 *   - The `stripe-signature` header is missing or malformed.
 *   - The `t=` timestamp is more than `toleranceSeconds` from now (default 300s).
 *   - No `v1=` signature matches the HMAC of `${t}.${rawBody}` with the secret.
 *
 * This is the hand-rolled equivalent of `stripe.webhooks.constructEvent(...)`.
 * Per the J2 spec, signature verification is mandatory in dev too — the
 * caller still validates against `STRIPE_WEBHOOK_SECRET` even when the
 * secret key is the placeholder. No dev bypass.
 */
export async function verifyStripeSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
}): Promise<{ ok: true; timestampUnix: number } | { ok: false; reason: string }> {
  const tolerance = args.toleranceSeconds ?? 300;
  if (!args.signatureHeader) return { ok: false, reason: 'missing_signature_header' };

  const parts = args.signatureHeader.split(',').map((p) => p.trim());
  let timestamp: string | null = null;
  const v1s: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!timestamp || v1s.length === 0) {
    return { ok: false, reason: 'malformed_signature_header' };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid_timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const payload = `${timestamp}.${args.rawBody}`;
  const expected = await hmacSha256Hex(args.secret, payload);
  // Constant-time compare against every v1 signature offered (Stripe rotates keys).
  let matched = false;
  for (const candidate of v1s) {
    if (constantTimeEqualHex(candidate, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: 'signature_mismatch' };

  return { ok: true, timestampUnix: ts };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

import type { Route } from '../../types/route';
import { stripeWebhookHandler } from './stripe';

/**
 * Webhook routes — authenticated by request signature, not session.
 *
 * Stripe events handled (see specs/12-architecture-backend.md):
 *   invoice.payment_succeeded
 *   invoice.payment_failed
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   payment_method.attached
 *
 * Every webhook must verify the Stripe signature before processing.
 */
export const webhookRoutes: Route[] = [
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/webhooks/stripe' }),
    description: 'Stripe webhook receiver (signature-verified).',
    handler: stripeWebhookHandler,
  },
];

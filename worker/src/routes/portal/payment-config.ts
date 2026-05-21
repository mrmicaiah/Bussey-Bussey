import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { isStripeDevPlaceholder } from '../../services/stripe';

/**
 * GET /api/portal/walkthrough/payment-config
 *
 * Returns the Stripe publishable key the portal needs to mount Stripe
 * Elements on the payment step. When the worker's STRIPE_SECRET_KEY is
 * the dev placeholder, the publishable key is reported as missing and
 * a `dev_placeholder: true` flag tells the frontend to render the
 * placeholder-payment-method affordance instead of mounting real Elements.
 */
export async function paymentConfigHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const dev = isStripeDevPlaceholder(ctx.env);
  const pk = ctx.env.STRIPE_PUBLISHABLE_KEY;
  const pkIsPlaceholder = !pk || pk === 'pk_test_replace_me';
  return json({
    dev_placeholder: dev || pkIsPlaceholder,
    publishable_key: dev || pkIsPlaceholder ? null : pk,
  });
}

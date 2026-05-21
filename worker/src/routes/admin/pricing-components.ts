import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

type PricingComponentRow = {
  code: string;
  name: string;
  description: string | null;
  category: string;
  unit_type: string;
  unit_price: number;
  active: number;
  created_at: string;
};

/**
 * GET /api/admin/pricing-components — list active rate-card components.
 *
 * Used by the calculator palette to show current live rates (informational).
 * Inserting a line item still uses the proposal's frozen snapshot rate, not
 * what's returned here.
 */
export async function listPricingComponents(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const includeInactive = url.searchParams.get('include_inactive') === '1';
  const sql = includeInactive
    ? `SELECT * FROM pricing_components ORDER BY category, code`
    : `SELECT * FROM pricing_components WHERE active = 1 ORDER BY category, code`;
  const result = await ctx.env.DB.prepare(sql).all<PricingComponentRow>();
  return json({ components: result.results ?? [] });
}

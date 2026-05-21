import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * GET /api/admin/pending-activations
 *
 * Lists opportunities that have been accepted (activation transaction
 * committed) but whose client has not yet finished the portal walkthrough.
 * Surfaces the gap between admin handoff and client self-onboarding so
 * stalled accounts don't disappear into the cracks.
 *
 * Returns one row per pending opportunity, ordered oldest-acceptance-first
 * (most-stale at the top). The frontend renders time-since-acceptance and
 * applies alert styling at 3d / 7d thresholds (spec 07).
 */

type Row = {
  opportunity_id: string;
  opportunity_name: string;
  accepted_at: string | null;
  client_id: string;
  client_company_name: string;
  portal_account_id: string;
  portal_email: string;
  walkthrough_state: string;
  walkthrough_completed: number;
};

export async function listPendingActivationsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const result = await ctx.env.DB.prepare(
    `SELECT o.id AS opportunity_id,
            o.name AS opportunity_name,
            o.accepted_at,
            c.id AS client_id,
            c.company_name AS client_company_name,
            pa.id AS portal_account_id,
            pa.email AS portal_email,
            pa.walkthrough_state,
            pa.walkthrough_completed
       FROM opportunity o
       JOIN client c ON c.id = o.client_id
       JOIN portal_account pa ON pa.client_id = c.id
      WHERE o.status = 'accepted'
        AND pa.walkthrough_completed = 0
      ORDER BY o.accepted_at ASC NULLS LAST`,
  ).all<Row>();

  return json({
    pending_activations: (result.results ?? []).map((r) => ({
      opportunity_id: r.opportunity_id,
      opportunity_name: r.opportunity_name,
      accepted_at: r.accepted_at,
      client_id: r.client_id,
      client_company_name: r.client_company_name,
      portal_email: r.portal_email,
      walkthrough_state: r.walkthrough_state,
    })),
  });
}

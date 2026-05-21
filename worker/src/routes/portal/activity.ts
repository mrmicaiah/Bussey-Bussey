import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * GET /api/portal/activity
 *
 * Returns the last N audit_log events for this client's opportunity,
 * filtered to a curated allowlist of *client-visible* actions. The admin
 * side of the audit log includes plenty of events the client should never
 * see (proposal updates pre-acceptance, internal status flips, etc.) —
 * this allowlist is the boundary.
 *
 * The shape per row is intentionally minimal: action + entity_type +
 * entity_id + created_at + a narrow `summary` derived from `changes`. The
 * portal home renders these as a feed; deeper detail lives on the
 * relevant section pages.
 */

const CLIENT_VISIBLE_ACTIONS = new Set([
  'change_order.proposed',
  'change_order.approved',
  'change_order.rejected',
  'change_order.withdrawn',
  'stripe_invoice.create',
  'stripe.webhook.invoice_payment_succeeded',
  'stripe.webhook.invoice_payment_failed',
  'project.update',
  'contract.signed',
  'walkthrough.completed',
]);

type Row = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: string | null;
  created_at: string;
};

export async function portalActivityHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(ctx.request.url);
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 10;

  // Identify the client's opportunity + change_order ids + invoice ids so
  // we can scope by entity_id (audit_log has no client_id column).
  const scope = await ctx.env.DB.prepare(
    `SELECT o.id AS opportunity_id, p.id AS proposal_id, con.id AS contract_id, pj.id AS project_id
       FROM portal_account pa
       JOIN client c ON c.id = pa.client_id
       JOIN opportunity o ON o.client_id = pa.client_id AND o.status = 'accepted'
       LEFT JOIN proposal p ON p.opportunity_id = o.id AND p.status = 'accepted'
       LEFT JOIN contract con ON con.opportunity_id = o.id
       LEFT JOIN project pj ON pj.opportunity_id = o.id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<{ opportunity_id: string; proposal_id: string | null; contract_id: string | null; project_id: string | null }>();
  if (!scope) return json({ activity: [] });

  // Change-order ids for this opportunity.
  const cosRes = await ctx.env.DB.prepare(
    `SELECT id FROM change_order WHERE proposal_id = ?`,
  )
    .bind(scope.proposal_id ?? '')
    .all<{ id: string }>();
  const coIds = (cosRes.results ?? []).map((r) => r.id);

  // Invoice ids for this opportunity.
  const invRes = await ctx.env.DB.prepare(
    `SELECT stripe_invoice_id FROM stripe_invoice WHERE opportunity_id = ?`,
  )
    .bind(scope.opportunity_id)
    .all<{ stripe_invoice_id: string }>();
  const stripeInvoiceIds = (invRes.results ?? []).map((r) => r.stripe_invoice_id);

  // Build the OR list. SQLite limits parameter count well above our needs.
  const entityIds = [
    scope.opportunity_id,
    scope.contract_id,
    scope.project_id,
    ...coIds,
    ...stripeInvoiceIds,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (entityIds.length === 0) return json({ activity: [] });

  // stripe_invoice audit rows reference the row UUID, not the stripe_invoice_id —
  // but the webhook audit rows reference stripe_invoice_id via `entity_type='stripe_event'`
  // with details inside changes. Pull both sets:
  //   (a) entity_id in the entityIds list above (covers change_order, contract,
  //       project, opportunity rows + stripe_invoice ROW IDs via the umbrella
  //       create rows from K1)
  //   (b) stripe_event rows whose changes contain our stripe_invoice_id (for
  //       webhook-originated payment_succeeded/failed)
  // For K2's "client-visible" cut, (a) is sufficient as long as we accept
  // that webhook-derived rows attach to the invoice row id via the
  // existing audit rows in approveChangeOrderHandler. The webhook handler
  // writes audit rows with entity_type='stripe_event' which aren't in the
  // allowlist — those don't surface here intentionally. Payment-success
  // surfaces via the `stripe_invoice.create` action with kind=monthly when
  // we eventually wire monthly billing audit rows.

  // For invoice rows, the local row id (not stripe_invoice_id) is what's
  // in audit_log.entity_id. Rebuild entityIds using the local row ids.
  const invRowsRes = await ctx.env.DB.prepare(
    `SELECT id FROM stripe_invoice WHERE opportunity_id = ?`,
  )
    .bind(scope.opportunity_id)
    .all<{ id: string }>();
  const invRowIds = (invRowsRes.results ?? []).map((r) => r.id);
  const ids = [
    scope.opportunity_id,
    scope.contract_id,
    scope.project_id,
    ...coIds,
    ...invRowIds,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  const placeholders = ids.map(() => '?').join(',');
  const actionPlaceholders = [...CLIENT_VISIBLE_ACTIONS].map(() => '?').join(',');
  const rowsRes = await ctx.env.DB.prepare(
    `SELECT id, action, entity_type, entity_id, changes, created_at
       FROM audit_log
      WHERE entity_id IN (${placeholders})
        AND action IN (${actionPlaceholders})
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(...ids, ...CLIENT_VISIBLE_ACTIONS, limit)
    .all<Row>();

  const activity = (rowsRes.results ?? []).map((r) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = r.changes ? (JSON.parse(r.changes) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    return {
      id: r.id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      created_at: r.created_at,
      summary: parsed,
    };
  });

  return json({ activity });
}

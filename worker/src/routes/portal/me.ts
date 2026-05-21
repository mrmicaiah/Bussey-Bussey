import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * GET /api/portal/me
 *
 * Returns the authenticated portal account along with the client and the
 * most-recently-accepted opportunity (the one that drives the walkthrough).
 * The frontend uses this to render the header (client company name) and to
 * decide whether to show the walkthrough gate.
 */

type Row = {
  portal_account_id: string;
  portal_email: string;
  must_change_password: number;
  walkthrough_completed: number;
  walkthrough_state: string;
  client_id: string;
  company_name: string;
  primary_contact_name: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  accepted_at: string | null;
  setup_total: number | null;
  monthly_total: number | null;
  contract_id: string | null;
  template_version: string | null;
  signed_at: string | null;
};

export async function portalMeHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const accountId = ctx.session.subjectId;

  const row = await ctx.env.DB.prepare(
    `SELECT pa.id AS portal_account_id,
            pa.email AS portal_email,
            pa.must_change_password,
            pa.walkthrough_completed,
            pa.walkthrough_state,
            c.id AS client_id,
            c.company_name,
            c.primary_contact_name,
            o.id AS opportunity_id,
            o.name AS opportunity_name,
            o.accepted_at,
            p.setup_total,
            p.monthly_total,
            con.id AS contract_id,
            con.template_version,
            con.signed_at
       FROM portal_account pa
       JOIN client c ON c.id = pa.client_id
       LEFT JOIN opportunity o
              ON o.client_id = pa.client_id
             AND o.status = 'accepted'
       LEFT JOIN proposal p
              ON p.opportunity_id = o.id
             AND p.status = 'accepted'
       LEFT JOIN contract con
              ON con.opportunity_id = o.id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC NULLS LAST
      LIMIT 1`,
  )
    .bind(accountId)
    .first<Row>();
  if (!row) return json({ error: 'not_found' }, { status: 404 });

  return json({
    portal_account: {
      id: row.portal_account_id,
      email: row.portal_email,
      must_change_password: row.must_change_password === 1,
      walkthrough_completed: row.walkthrough_completed === 1,
      walkthrough_state: row.walkthrough_state,
    },
    client: {
      id: row.client_id,
      company_name: row.company_name,
      primary_contact_name: row.primary_contact_name,
    },
    opportunity:
      row.opportunity_id !== null
        ? {
            id: row.opportunity_id,
            name: row.opportunity_name ?? '',
            accepted_at: row.accepted_at,
            setup_total: row.setup_total ?? 0,
            monthly_total: row.monthly_total ?? 0,
          }
        : null,
    contract:
      row.contract_id !== null
        ? {
            id: row.contract_id,
            template_version: row.template_version ?? '',
            signed_at: row.signed_at,
          }
        : null,
  });
}

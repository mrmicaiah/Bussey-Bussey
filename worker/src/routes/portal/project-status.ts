import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * GET /api/portal/project-status
 *
 * Read-only client view of the project record's client-facing fields:
 * current_phase, build_status_note, next_milestone, updated_at, plus the
 * project name + started date. Admin controls the contents via PUT
 * /api/admin/projects/:id; clients see whatever's current.
 */

type Row = {
  id: string;
  name: string;
  current_phase: string | null;
  build_status_note: string | null;
  next_milestone: string | null;
  created_at: string;
  updated_at: string | null;
};

export async function portalProjectStatusHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const row = await ctx.env.DB.prepare(
    `SELECT pj.id, pj.name, pj.current_phase, pj.build_status_note,
            pj.next_milestone, pj.created_at, pj.updated_at
       FROM portal_account pa
       JOIN opportunity o ON o.client_id = pa.client_id AND o.status = 'accepted'
       JOIN project pj ON pj.opportunity_id = o.id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC
      LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<Row>();
  if (!row) return json({ error: 'not_found' }, { status: 404 });
  return json({ project: row });
}

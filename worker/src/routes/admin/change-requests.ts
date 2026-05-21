import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit } from '../../lib/audit';

/**
 * Admin change-requests:
 *   GET  /api/admin/change-requests                            — list (filter by opportunity_id)
 *   POST /api/admin/change-requests/:id/mark-reviewed          — submitted → reviewed
 *   POST /api/admin/change-requests/:id/decline                — submitted/reviewed → declined (with note)
 *   POST /api/admin/change-requests/:id/convert-to-change-order — submitted/reviewed → converted_to_change_order
 *
 * Convert creates a draft change_order pre-filled with the request's
 * description as the `reason` and a generic name. The admin then opens
 * the builder to add line items.
 */

type ChangeRequestRow = {
  id: string;
  client_id: string;
  opportunity_id: string;
  description: string;
  urgency: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  notes: string | null;
  converted_to_change_order_id: string | null;
};

async function getChangeRequest(env: HandlerContext['env'], id: string): Promise<ChangeRequestRow | null> {
  return env.DB.prepare(`SELECT * FROM change_request WHERE id = ?`).bind(id).first<ChangeRequestRow>();
}

export async function listChangeRequestsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(ctx.request.url);
  const opportunityId = url.searchParams.get('opportunity_id');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opportunityId) {
    where.push('opportunity_id = ?');
    binds.push(opportunityId);
  }
  let sql = `SELECT * FROM change_request`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY submitted_at DESC`;
  const res = await ctx.env.DB.prepare(sql).bind(...binds).all();
  return json({ change_requests: res.results ?? [] });
}

export async function markChangeRequestReviewedHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const cr = await getChangeRequest(ctx.env, id);
  if (!cr) return json({ error: 'not_found' }, { status: 404 });
  if (cr.status !== 'submitted') {
    return json({ error: 'invalid_state_transition', status: cr.status }, { status: 409 });
  }
  const now = new Date().toISOString();
  await ctx.env.DB.prepare(
    `UPDATE change_request SET status = 'reviewed', reviewed_at = ? WHERE id = ?`,
  )
    .bind(now, id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_request.reviewed',
    entityType: 'change_request',
    entityId: id,
    changes: { status: { from: cr.status, to: 'reviewed' }, reviewed_at: now },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  const after = await getChangeRequest(ctx.env, id);
  return json({ change_request: after });
}

export async function declineChangeRequestHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const body = await readJsonObject(ctx.request);
  const note = body && typeof body['notes'] === 'string' ? body['notes'].trim() : null;

  const cr = await getChangeRequest(ctx.env, id);
  if (!cr) return json({ error: 'not_found' }, { status: 404 });
  if (cr.status !== 'submitted' && cr.status !== 'reviewed') {
    return json({ error: 'invalid_state_transition', status: cr.status }, { status: 409 });
  }
  const now = new Date().toISOString();
  await ctx.env.DB.prepare(
    `UPDATE change_request SET status = 'declined', reviewed_at = COALESCE(reviewed_at, ?), notes = ? WHERE id = ?`,
  )
    .bind(now, note, id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_request.declined',
    entityType: 'change_request',
    entityId: id,
    changes: { status: { from: cr.status, to: 'declined' }, notes: note },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  const after = await getChangeRequest(ctx.env, id);
  return json({ change_request: after });
}

export async function convertChangeRequestHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const cr = await getChangeRequest(ctx.env, id);
  if (!cr) return json({ error: 'not_found' }, { status: 404 });
  if (cr.status !== 'submitted' && cr.status !== 'reviewed') {
    return json({ error: 'invalid_state_transition', status: cr.status }, { status: 409 });
  }

  // Find the accepted proposal for this opportunity to scope the new change order.
  const proposal = await ctx.env.DB.prepare(
    `SELECT id FROM proposal WHERE opportunity_id = ? AND status = 'accepted' LIMIT 1`,
  )
    .bind(cr.opportunity_id)
    .first<{ id: string }>();
  if (!proposal) return json({ error: 'no_accepted_proposal' }, { status: 409 });

  const coId = crypto.randomUUID();
  const now = new Date().toISOString();
  const coName = 'Change order from request';
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO change_order (id, proposal_id, name, status, reason, setup_delta, monthly_delta)
       VALUES (?, ?, ?, 'draft', ?, 0, 0)`,
    ).bind(coId, proposal.id, coName, cr.description),
    ctx.env.DB.prepare(
      `UPDATE change_request
         SET status = 'converted_to_change_order',
             reviewed_at = COALESCE(reviewed_at, ?),
             converted_to_change_order_id = ?
       WHERE id = ?`,
    ).bind(now, coId, id),
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'admin_user', ?, 'change_request.converted', 'change_request', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      ctx.session.subjectId,
      id,
      JSON.stringify({
        status: { from: cr.status, to: 'converted_to_change_order' },
        new_change_order_id: coId,
      }),
      ctx.session.ipAddress,
      ctx.session.userAgent,
    ),
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'admin_user', ?, 'change_order.create', 'change_order', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      ctx.session.subjectId,
      coId,
      JSON.stringify({
        proposal_id: proposal.id,
        name: coName,
        reason: cr.description,
        status: 'draft',
        from_change_request_id: id,
      }),
      ctx.session.ipAddress,
      ctx.session.userAgent,
    ),
  ]);

  const after = await getChangeRequest(ctx.env, id);
  return json({ change_request: after, change_order_id: coId });
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

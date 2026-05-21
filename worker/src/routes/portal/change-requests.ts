import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit } from '../../lib/audit';
import { sendEmail, adminNotifyRecipients } from '../../services/email';

/**
 * Portal change-requests:
 *
 *   POST /api/portal/change-requests — submit a free-text request
 *   GET  /api/portal/change-requests — list this client's requests
 *
 * A change_request is NOT a change_order. It's the client's intake form —
 * a description of what they'd like changed, with optional urgency. Admin
 * reviews it, scopes pricing, and may convert it to a change_order via
 * /api/admin/change-requests/:id/convert-to-change-order (see
 * routes/admin/change-requests.ts).
 */

const URGENCIES = new Set(['routine', 'soon', 'urgent']);

export async function portalCreateChangeRequestHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const body = await readJsonObject(ctx.request);
  const description =
    body && typeof body['description'] === 'string' ? body['description'].trim() : '';
  if (!description) return json({ error: 'description_required' }, { status: 400 });
  const urgencyRaw =
    body && typeof body['urgency'] === 'string' ? body['urgency'] : 'routine';
  if (!URGENCIES.has(urgencyRaw)) return json({ error: 'invalid_urgency' }, { status: 400 });

  const ctxRow = await ctx.env.DB.prepare(
    `SELECT pa.client_id, o.id AS opportunity_id, c.company_name, c.primary_contact_name
       FROM portal_account pa
       JOIN client c ON c.id = pa.client_id
       JOIN opportunity o ON o.client_id = pa.client_id AND o.status = 'accepted'
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<{ client_id: string; opportunity_id: string; company_name: string; primary_contact_name: string | null }>();
  if (!ctxRow) return json({ error: 'no_active_opportunity' }, { status: 409 });

  const id = crypto.randomUUID();
  await ctx.env.DB.prepare(
    `INSERT INTO change_request (id, client_id, opportunity_id, description, urgency, status)
     VALUES (?, ?, ?, ?, ?, 'submitted')`,
  )
    .bind(id, ctxRow.client_id, ctxRow.opportunity_id, description, urgencyRaw)
    .run();

  await writeAudit(ctx.env, {
    actorType: 'portal_account',
    actorId: ctx.session.subjectId,
    action: 'change_request.submitted',
    entityType: 'change_request',
    entityId: id,
    changes: {
      client_id: ctxRow.client_id,
      opportunity_id: ctxRow.opportunity_id,
      urgency: urgencyRaw,
      description_length: description.length,
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  // Notify admin.
  const recipients = adminNotifyRecipients(ctx.env);
  if (recipients.length) {
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'other',
        to: recipients,
        subject: `[Change request] ${ctxRow.company_name} (${urgencyRaw})`,
        text:
          `${ctxRow.primary_contact_name ?? 'A client contact'} at ${ctxRow.company_name} submitted a change request.\n` +
          `Urgency: ${urgencyRaw}\nOpportunity: ${ctxRow.opportunity_id}\n\n` +
          `Description:\n${description}`,
        relatedEntity: { type: 'change_request', id },
      }),
    );
  }

  return json({ ok: true, change_request_id: id }, { status: 201 });
}

export async function portalListChangeRequestsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const res = await ctx.env.DB.prepare(
    `SELECT cr.id, cr.description, cr.urgency, cr.status, cr.submitted_at,
            cr.reviewed_at, cr.notes, cr.converted_to_change_order_id
       FROM change_request cr
       JOIN portal_account pa ON pa.client_id = cr.client_id
      WHERE pa.id = ?
      ORDER BY cr.submitted_at DESC`,
  )
    .bind(ctx.session.subjectId)
    .all();
  return json({ change_requests: res.results ?? [] });
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

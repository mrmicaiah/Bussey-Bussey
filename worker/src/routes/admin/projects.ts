import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit, shallowDiff } from '../../lib/audit';
import { sendEmail } from '../../services/email';

/**
 * Admin project routes.
 *
 * Project rows are created automatically at opportunity activation
 * (spec 07; activation service in worker/src/services/activation.ts) and
 * persist as the living delivery record. Per spec 07 § "Pending Activation"
 * and the route inventory comment, PUT is limited to administrative fields
 * — the project is the post-acceptance editable surface, while the
 * acceptance-bound proposal stays frozen.
 *
 * Editable here: presentation_notes, build_status_note, current_phase,
 * next_milestone. Status transitions and kickoff/completion timestamps
 * are intentionally NOT exposed via this endpoint; they're set elsewhere
 * (or in a future step) so editability rules stay tight.
 *
 * Optional non-row flag `notify_client` (added in K2): when true and the
 * update actually changed any of the client-facing fields
 * (build_status_note, current_phase, next_milestone), a
 * project_status_update email fires to the client's primary contact. The
 * flag is consumed but not stored.
 */

const PROJECT_EDITABLE_FIELDS = [
  'presentation_notes',
  'build_status_note',
  'current_phase',
  'next_milestone',
] as const;

const CLIENT_FACING_FIELDS = new Set(['build_status_note', 'current_phase', 'next_milestone']);

type ProjectRow = {
  id: string;
  opportunity_id: string;
  name: string;
  status: string;
  presentation_notes: string | null;
  build_status_note: string | null;
  current_phase: string | null;
  next_milestone: string | null;
  created_at: string;
  updated_at: string | null;
  kicked_off_at: string | null;
  completed_at: string | null;
};

export async function updateProjectHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const notifyClient = body['notify_client'] === true;
  // Strip the flag so it doesn't trip the unknown-key rejection below.
  const fieldBody: Record<string, unknown> = { ...body };
  delete fieldBody['notify_client'];

  const before = await ctx.env.DB.prepare(`SELECT * FROM project WHERE id = ?`)
    .bind(id)
    .first<ProjectRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const field of PROJECT_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fieldBody, field)) {
      const value = fieldBody[field];
      // Normalize empty strings to null so the column reflects "not set."
      updates[field] = typeof value === 'string' && value.length === 0 ? null : value;
    }
  }
  for (const key of Object.keys(fieldBody)) {
    if (!(PROJECT_EDITABLE_FIELDS as readonly string[]).includes(key)) {
      rejected.push(key);
    }
  }
  if (rejected.length > 0) {
    return json(
      {
        error: 'fields_not_editable',
        fields: rejected,
        message:
          'Only administrative project fields are editable via this endpoint: ' +
          PROJECT_EDITABLE_FIELDS.join(', ') + '.',
      },
      { status: 400 },
    );
  }

  if (Object.keys(updates).length === 0) return json({ project: before });

  // Bump updated_at on every successful write — the Project Status section
  // shows this to the client.
  const nowIso = new Date().toISOString();
  updates['updated_at'] = nowIso;

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  await ctx.env.DB.prepare(`UPDATE project SET ${setClause} WHERE id = ?`)
    .bind(...Object.values(updates), id)
    .run();

  const diff = shallowDiff(before as unknown as Record<string, unknown>, updates);
  if (diff !== null) {
    await writeAudit(ctx.env, {
      actorType: 'admin_user',
      actorId: ctx.session.subjectId,
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      changes: { ...diff, notify_client: notifyClient },
      ipAddress: ctx.session.ipAddress,
      userAgent: ctx.session.userAgent,
    });
  }

  // If admin asked to notify the client AND a client-facing field actually
  // changed, send the project_status_update email.
  if (notifyClient) {
    const clientFacingChanged = Object.keys(updates).some(
      (k) => CLIENT_FACING_FIELDS.has(k) && (updates as Record<string, unknown>)[k] !== (before as unknown as Record<string, unknown>)[k],
    );
    if (clientFacingChanged) {
      ctx.ctx.waitUntil(sendProjectStatusEmail(ctx.env, id));
    }
  }

  const after = await ctx.env.DB.prepare(`SELECT * FROM project WHERE id = ?`)
    .bind(id)
    .first<ProjectRow>();
  return json({ project: after });
}

async function sendProjectStatusEmail(env: HandlerContext['env'], projectId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT p.name AS project_name,
            p.current_phase, p.build_status_note, p.next_milestone, p.updated_at,
            c.primary_contact_name AS contact_name,
            c.primary_contact_email AS contact_email,
            c.company_name AS company_name,
            o.id AS opportunity_id
       FROM project p
       JOIN opportunity o ON o.id = p.opportunity_id
       JOIN client c ON c.id = o.client_id
      WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<{
      project_name: string;
      current_phase: string | null;
      build_status_note: string | null;
      next_milestone: string | null;
      updated_at: string | null;
      contact_name: string | null;
      contact_email: string | null;
      company_name: string;
      opportunity_id: string;
    }>();
  if (!row || !row.contact_email) return;
  await sendEmail(env, {
    kind: 'project_status_update',
    to: row.contact_email,
    subject: `Project update — ${row.project_name}`,
    text: projectStatusEmailText(row),
    relatedEntity: { type: 'project', id: projectId },
  });
}

// Placeholder copy — single-file swap when the real copy is ready.
function projectStatusEmailText(args: {
  contact_name: string | null;
  project_name: string;
  current_phase: string | null;
  build_status_note: string | null;
  next_milestone: string | null;
}): string {
  const greeting = args.contact_name?.trim() || 'there';
  return [
    `Hi ${greeting},`,
    '',
    `Quick update on ${args.project_name}:`,
    '',
    args.current_phase ? `  Current phase:   ${args.current_phase}` : null,
    args.build_status_note ? `  Status note:     ${args.build_status_note}` : null,
    args.next_milestone ? `  Next milestone:  ${args.next_milestone}` : null,
    '',
    `Full status is available in your portal any time.`,
    '',
    '— Bussey and Bussey',
  ]
    .filter((l) => l !== null)
    .join('\n');
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

import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit } from '../../lib/audit';

/**
 * Portal account endpoints:
 *   PUT /api/portal/account/notification-prefs — toggle notify_change_orders / notify_payments
 *   GET /api/portal/account/signatures         — signature audit history
 *
 * Notification prefs are stored on portal_account but NOT yet enforced in
 * the send logic — see notes/deferred-cleanup.md "Notification preferences
 * UI shipped but not yet enforced in send logic."
 */

export async function portalUpdateNotificationPrefsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });
  const allowed = ['notify_change_orders', 'notify_payments'] as const;
  const updates: Record<string, number> = {};
  const rejected: string[] = [];
  for (const key of Object.keys(body)) {
    if ((allowed as readonly string[]).includes(key)) {
      const v = body[key];
      if (typeof v !== 'boolean') {
        return json({ error: 'invalid_value', field: key }, { status: 400 });
      }
      updates[key] = v ? 1 : 0;
    } else {
      rejected.push(key);
    }
  }
  if (rejected.length) {
    return json({ error: 'fields_not_editable', fields: rejected }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return json({ error: 'empty_request' }, { status: 400 });
  }
  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  await ctx.env.DB.prepare(`UPDATE portal_account SET ${setClause} WHERE id = ?`)
    .bind(...Object.values(updates), ctx.session.subjectId)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'portal_account',
    actorId: ctx.session.subjectId,
    action: 'portal_account.notification_prefs_updated',
    entityType: 'portal_account',
    entityId: ctx.session.subjectId,
    changes: updates,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const after = await ctx.env.DB.prepare(
    `SELECT notify_change_orders, notify_payments FROM portal_account WHERE id = ?`,
  )
    .bind(ctx.session.subjectId)
    .first<{ notify_change_orders: number; notify_payments: number }>();
  return json({
    ok: true,
    notification_prefs: {
      notify_change_orders: after?.notify_change_orders === 1,
      notify_payments: after?.notify_payments === 1,
    },
  });
}

export async function portalSignatureHistoryHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const res = await ctx.env.DB.prepare(
    `SELECT id, document_type, document_id, signature_type, typed_name, typed_initials,
            ip_address, signed_at
       FROM document_signature
      WHERE portal_account_id = ?
      ORDER BY signed_at DESC`,
  )
    .bind(ctx.session.subjectId)
    .all();
  return json({ signatures: res.results ?? [] });
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

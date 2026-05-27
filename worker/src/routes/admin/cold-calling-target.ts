import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { auditStatement } from '../../lib/audit';
import {
  isoWeekString,
  gatherProspectData,
  selectUpcomingPresentations,
  presentationsHealthFor,
  suggestedTargetFor,
  coldCallingReason,
} from '../../lib/dashboard-metrics';

/**
 * Studio44 Dashboard — cold-calling target write (spec §4.2).
 *
 *   PUT /api/admin/cold-calling-target  — { target } → upsert the operator's per-week override.
 *
 * The ISO week and the suggested_target are computed server-side using the SAME
 * shared helpers as the dashboard read (lib/dashboard-metrics.ts) — the response
 * drops straight into the read's stations.cold_calling sub-object without a refetch.
 * One atomic DB.batch (UPSERT + audit). Auth via the /api/admin/ gate.
 */
export async function setColdCallingTargetHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const target = body['target'];
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 5 || target > 100) {
    return json({ error: 'invalid_target' }, { status: 400 });
  }

  const operatorId = ctx.session.subjectId;
  const now = new Date();
  const nowIso = now.toISOString();
  const isoWeek = isoWeekString(now); // server-computed; never trusted from client

  // suggested_target = presentation health → 25/30/40, SAME path as the read.
  const pdata = await gatherProspectData(ctx.env);
  const presTotal = selectUpcomingPresentations(pdata, nowIso).length;
  const health = presentationsHealthFor(presTotal);
  const suggested = suggestedTargetFor(health);

  // UPSERT keyed on the (admin_user_id, iso_week) UNIQUE from migration 0018.
  const id = crypto.randomUUID();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO cold_calling_target (id, admin_user_id, iso_week, target, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(admin_user_id, iso_week)
       DO UPDATE SET target = excluded.target, updated_at = excluded.updated_at`,
    ).bind(id, operatorId, isoWeek, target, nowIso),
    auditStatement(ctx.env, {
      actorType: 'admin_user',
      actorId: operatorId,
      action: 'cold_calling_target.set',
      entityType: 'cold_calling_target',
      entityId: id,
      changes: { target, iso_week: isoWeek },
      ipAddress: ctx.session.ipAddress,
      userAgent: ctx.session.userAgent,
    }),
  ]);

  return json({
    effective_target: target,
    override_active: true,
    iso_week: isoWeek,
    suggested_target: suggested,
    reason: coldCallingReason(true, suggested, health),
  });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

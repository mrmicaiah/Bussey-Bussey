import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit, shallowDiff } from '../../lib/audit';
import { randomBase64Url } from '../../lib/random';

type OpportunityRow = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: string;
  value_setup: number | null;
  value_monthly: number | null;
  next_followup_date: string | null;
  presentation_token: string;
  owner_user_id: string | null;
  accepted_at: string | null;
  lost_reason: string | null;
  notes: string | null;
  monthly_start_date: string | null;
  created_at: string;
};

const OPP_STATUSES = new Set(['open', 'proposed', 'accepted', 'lost', 'paused']);

const OPP_EDITABLE_FIELDS = [
  'name',
  'description',
  'status',
  'value_setup',
  'value_monthly',
  'next_followup_date',
  'lost_reason',
  'owner_user_id',
  'monthly_start_date', // ISO date (YYYY-MM-DD); NULL = accepted_at + 30 days (resolved at setup-payment).
] as const;

export async function listOpportunities(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const clientId = url.searchParams.get('client_id');
  const status = url.searchParams.get('status');
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (clientId) {
    where.push('client_id = ?');
    binds.push(clientId);
  }
  if (status) {
    if (!OPP_STATUSES.has(status)) return json({ error: 'invalid_status' }, { status: 400 });
    where.push('status = ?');
    binds.push(status);
  }
  let sql = `SELECT * FROM opportunity`;
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await ctx.env.DB.prepare(sql).bind(...binds).all<OpportunityRow>();
  return json({ opportunities: result.results ?? [], limit, offset });
}

export async function getOpportunity(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const row = await ctx.env.DB.prepare(`SELECT * FROM opportunity WHERE id = ?`)
    .bind(id)
    .first<OpportunityRow>();
  if (!row) return json({ error: 'not_found' }, { status: 404 });
  return json({ opportunity: row });
}

export async function createOpportunity(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const client_id = stringOrNull(body['client_id']);
  if (!client_id) return json({ error: 'client_id_required' }, { status: 400 });
  const name = stringOrNull(body['name']);
  if (!name) return json({ error: 'name_required' }, { status: 400 });

  // Make sure the client exists
  const clientExists = await ctx.env.DB.prepare(`SELECT id FROM client WHERE id = ?`)
    .bind(client_id)
    .first<{ id: string }>();
  if (!clientExists) return json({ error: 'client_not_found' }, { status: 404 });

  const id = crypto.randomUUID();
  const presentation_token = randomBase64Url(24);
  const description = stringOrNull(body['description']);
  const ownerCandidate = stringOrNull(body['owner_user_id']);
  const owner_user_id = ownerCandidate ?? ctx.session.subjectId;

  const fields = {
    id,
    client_id,
    name,
    description,
    status: 'open' as const,
    presentation_token,
    owner_user_id,
  };

  await ctx.env.DB.prepare(
    `INSERT INTO opportunity (id, client_id, name, description, status, presentation_token, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(fields.id, fields.client_id, fields.name, fields.description, fields.status, fields.presentation_token, fields.owner_user_id)
    .run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'opportunity.create',
    entityType: 'opportunity',
    entityId: id,
    changes: fields,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const row = await ctx.env.DB.prepare(`SELECT * FROM opportunity WHERE id = ?`)
    .bind(id)
    .first<OpportunityRow>();
  return json({ opportunity: row }, { status: 201 });
}

export async function updateOpportunity(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT * FROM opportunity WHERE id = ?`)
    .bind(id)
    .first<OpportunityRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  for (const field of OPP_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }

  if (updates['status'] !== undefined && !OPP_STATUSES.has(String(updates['status']))) {
    return json({ error: 'invalid_status' }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) return json({ opportunity: before });

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const sql = `UPDATE opportunity SET ${setClause} WHERE id = ?`;
  const binds = [...Object.values(updates), id];
  await ctx.env.DB.prepare(sql).bind(...binds).run();

  const diff = shallowDiff(before as unknown as Record<string, unknown>, updates);

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'opportunity.update',
    entityType: 'opportunity',
    entityId: id,
    changes: diff,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const after = await ctx.env.DB.prepare(`SELECT * FROM opportunity WHERE id = ?`)
    .bind(id)
    .first<OpportunityRow>();
  return json({ opportunity: after });
}

export async function deleteOpportunity(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT * FROM opportunity WHERE id = ?`)
    .bind(id)
    .first<OpportunityRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  // Refuse to delete an accepted opportunity — three-tier editability sanity check.
  if (before.status === 'accepted') {
    return json({ error: 'cannot_delete_accepted_opportunity' }, { status: 409 });
  }

  await ctx.env.DB.prepare(`DELETE FROM opportunity WHERE id = ?`).bind(id).run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'opportunity.delete',
    entityType: 'opportunity',
    entityId: id,
    changes: { deleted: before },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  return json({ ok: true });
}

// ── client-scoped collection: GET /api/admin/clients/:client_id/projects is in projects routes,
//    but for opportunities we already accept ?client_id= on the main list. No second handler needed.

// ── helpers ────────────────────────────────────────────────────────────

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

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

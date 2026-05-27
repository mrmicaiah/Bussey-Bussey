import type { HandlerContext } from '../../types/route';
import type { Env } from '../../types/env';
import { json } from '../../lib/responses';
import { writeAudit, shallowDiff, type AuditEntry } from '../../lib/audit';
import type { CreateBuild, AuditActor } from '../../lib/tx';

type ClientRow = {
  id: string;
  company_name: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  industry: string | null;
  billing_address: string | null;
  status: string;
  origin_lead_id: string | null;
  notes: string | null;
  created_at: string;
};

const CLIENT_STATUSES = new Set(['prospect', 'active', 'paused', 'former']);

const CLIENT_EDITABLE_FIELDS = [
  'company_name',
  'primary_contact_name',
  'primary_contact_email',
  'primary_contact_phone',
  'industry',
  'billing_address',
  'status',
  'notes',
] as const;

export async function listClients(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status');
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

  let sql = `SELECT * FROM client`;
  const binds: unknown[] = [];
  if (status) {
    if (!CLIENT_STATUSES.has(status)) return json({ error: 'invalid_status' }, { status: 400 });
    sql += ` WHERE status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await ctx.env.DB.prepare(sql).bind(...binds).all<ClientRow>();
  return json({ clients: result.results ?? [], limit, offset });
}

export async function getClient(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const row = await ctx.env.DB.prepare(`SELECT * FROM client WHERE id = ?`).bind(id).first<ClientRow>();
  if (!row) return json({ error: 'not_found' }, { status: 404 });
  return json({ client: row });
}

/** Validated params for creating a client (caller does request parsing + validation). */
export type ClientCreateParams = {
  company_name: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  industry: string | null;
  billing_address: string | null;
  status: string; // already validated against CLIENT_STATUSES by the caller
  origin_lead_id: string | null;
  notes: string | null;
};

/**
 * CORE of client creation — shared by the standalone POST /api/admin/clients
 * handler and the leads-wizard booking transaction. Builds the client INSERT
 * (+ the lead status='converted' flip when converting) and the matching audit
 * entries, returning them composable. Does NOT touch the request or run anything.
 * `originLeadStatus` is the converting lead's current status (for the lead.convert
 * audit's from→to); pass null when not converting.
 */
export function buildClientCreate(
  env: Env,
  params: ClientCreateParams,
  actor: AuditActor,
  originLeadStatus: string | null,
): CreateBuild {
  const id = crypto.randomUUID();
  const fields = { id, ...params };

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO client (id, company_name, primary_contact_name, primary_contact_email, primary_contact_phone, industry, billing_address, status, origin_lead_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      params.company_name,
      params.primary_contact_name,
      params.primary_contact_email,
      params.primary_contact_phone,
      params.industry,
      params.billing_address,
      params.status,
      params.origin_lead_id,
      params.notes,
    ),
  ];
  const audits: AuditEntry[] = [
    {
      actorType: 'admin_user',
      actorId: actor.id,
      action: params.origin_lead_id ? 'client.create.from_lead' : 'client.create',
      entityType: 'client',
      entityId: id,
      changes: fields,
      ipAddress: actor.ip,
      userAgent: actor.ua,
    },
  ];
  if (params.origin_lead_id) {
    statements.push(
      env.DB.prepare(`UPDATE lead SET status = 'converted' WHERE id = ?`).bind(params.origin_lead_id),
    );
    audits.push({
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'lead.convert',
      entityType: 'lead',
      entityId: params.origin_lead_id,
      changes: { status: { from: originLeadStatus, to: 'converted' }, converted_to_client_id: id },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    });
  }
  return { id, statements, audits };
}

export async function createClient(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const company_name = stringOrNull(body['company_name']);
  if (!company_name) return json({ error: 'company_name_required' }, { status: 400 });

  const status = typeof body['status'] === 'string' ? body['status'] : 'prospect';
  if (!CLIENT_STATUSES.has(status)) return json({ error: 'invalid_status' }, { status: 400 });

  const origin_lead_id = stringOrNull(body['origin_lead_id']);
  let leadBefore: { id: string; status: string } | null = null;
  if (origin_lead_id) {
    leadBefore = await ctx.env.DB.prepare(`SELECT id, status FROM lead WHERE id = ?`)
      .bind(origin_lead_id)
      .first<{ id: string; status: string }>();
    if (!leadBefore) return json({ error: 'origin_lead_not_found' }, { status: 400 });
  }

  const core = buildClientCreate(
    ctx.env,
    {
      company_name,
      primary_contact_name: stringOrNull(body['primary_contact_name']),
      primary_contact_email: stringOrNull(body['primary_contact_email']),
      primary_contact_phone: stringOrNull(body['primary_contact_phone']),
      industry: stringOrNull(body['industry']),
      billing_address: stringOrNull(body['billing_address']),
      status,
      origin_lead_id,
      notes: stringOrNull(body['notes']),
    },
    { id: ctx.session.subjectId, ip: ctx.session.ipAddress, ua: ctx.session.userAgent },
    leadBefore?.status ?? null,
  );

  // Same execution as before: data writes in one batch, then audit each entry.
  await ctx.env.DB.batch(core.statements);
  for (const a of core.audits) await writeAudit(ctx.env, a);

  const row = await ctx.env.DB.prepare(`SELECT * FROM client WHERE id = ?`).bind(core.id).first<ClientRow>();
  return json({ client: row }, { status: 201 });
}

export async function updateClient(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT * FROM client WHERE id = ?`).bind(id).first<ClientRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  for (const field of CLIENT_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }

  if (updates['status'] !== undefined && !CLIENT_STATUSES.has(String(updates['status']))) {
    return json({ error: 'invalid_status' }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) return json({ client: before });

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const sql = `UPDATE client SET ${setClause} WHERE id = ?`;
  const binds = [...Object.values(updates), id];
  await ctx.env.DB.prepare(sql).bind(...binds).run();

  const diff = shallowDiff(before as unknown as Record<string, unknown>, updates);

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'client.update',
    entityType: 'client',
    entityId: id,
    changes: diff,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const after = await ctx.env.DB.prepare(`SELECT * FROM client WHERE id = ?`).bind(id).first<ClientRow>();
  return json({ client: after });
}

export async function deleteClient(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT * FROM client WHERE id = ?`).bind(id).first<ClientRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  await ctx.env.DB.prepare(`DELETE FROM client WHERE id = ?`).bind(id).run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'client.delete',
    entityType: 'client',
    entityId: id,
    changes: { deleted: before },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  return json({ ok: true });
}

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

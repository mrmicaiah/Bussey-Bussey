import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit, shallowDiff } from '../../lib/audit';

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

export async function createClient(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const company_name = stringOrNull(body['company_name']);
  if (!company_name) return json({ error: 'company_name_required' }, { status: 400 });

  const id = crypto.randomUUID();
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

  const fields = {
    id,
    company_name,
    primary_contact_name: stringOrNull(body['primary_contact_name']),
    primary_contact_email: stringOrNull(body['primary_contact_email']),
    primary_contact_phone: stringOrNull(body['primary_contact_phone']),
    industry: stringOrNull(body['industry']),
    billing_address: stringOrNull(body['billing_address']),
    status,
    origin_lead_id,
    notes: stringOrNull(body['notes']),
  };

  // Insert client + (if conversion) update lead status atomically via batch().
  const stmts: D1PreparedStatement[] = [
    ctx.env.DB.prepare(
      `INSERT INTO client (id, company_name, primary_contact_name, primary_contact_email, primary_contact_phone, industry, billing_address, status, origin_lead_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      fields.id,
      fields.company_name,
      fields.primary_contact_name,
      fields.primary_contact_email,
      fields.primary_contact_phone,
      fields.industry,
      fields.billing_address,
      fields.status,
      fields.origin_lead_id,
      fields.notes,
    ),
  ];
  if (origin_lead_id) {
    stmts.push(
      ctx.env.DB.prepare(`UPDATE lead SET status = 'converted' WHERE id = ?`).bind(origin_lead_id),
    );
  }
  await ctx.env.DB.batch(stmts);

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: origin_lead_id ? 'client.create.from_lead' : 'client.create',
    entityType: 'client',
    entityId: id,
    changes: fields,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  if (origin_lead_id && leadBefore) {
    await writeAudit(ctx.env, {
      actorType: 'admin_user',
      actorId: ctx.session.subjectId,
      action: 'lead.convert',
      entityType: 'lead',
      entityId: origin_lead_id,
      changes: { status: { from: leadBefore.status, to: 'converted' }, converted_to_client_id: id },
      ipAddress: ctx.session.ipAddress,
      userAgent: ctx.session.userAgent,
    });
  }

  const row = await ctx.env.DB.prepare(`SELECT * FROM client WHERE id = ?`).bind(id).first<ClientRow>();
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

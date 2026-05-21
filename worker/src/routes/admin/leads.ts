import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit, shallowDiff } from '../../lib/audit';

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  source: string | null;
  origin_chat_session_id: string | null;
  pain_summary: string | null;
  urgency: string | null;
  status: string;
  notes: string | null;
  notification_sent_at: string | null;
  owner_user_id: string | null;
  last_contacted_at: string | null;
  created_at: string;
};

const LEAD_STATUSES = new Set([
  'new',
  'reviewed',
  'contacted',
  'qualified',
  'disqualified',
  'converted',
]);
const LEAD_SOURCES = new Set(['chat', 'manual', 'referral', 'event']);
const LEAD_URGENCIES = new Set(['immediate', 'weeks', 'months', 'exploring']);

const LEAD_EDITABLE_FIELDS = [
  'name',
  'email',
  'phone',
  'company',
  'industry',
  'source',
  'pain_summary',
  'urgency',
  'status',
  'notes',
  'last_contacted_at',
  'owner_user_id',
] as const;

export async function listLeads(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status');
  const limit = clampInt(url.searchParams.get('limit'), 25, 1, 200);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

  let sql = `SELECT * FROM lead`;
  const binds: unknown[] = [];
  if (status) {
    if (!LEAD_STATUSES.has(status)) return json({ error: 'invalid_status' }, { status: 400 });
    sql += ` WHERE status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const stmt = ctx.env.DB.prepare(sql).bind(...binds);
  const result = await stmt.all<LeadRow>();
  return json({ leads: result.results ?? [], limit, offset });
}

export async function getLead(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const row = await ctx.env.DB.prepare(`SELECT * FROM lead WHERE id = ?`).bind(id).first<LeadRow>();
  if (!row) return json({ error: 'not_found' }, { status: 404 });
  return json({ lead: row });
}

export async function createLead(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const id = crypto.randomUUID();
  const source = typeof body['source'] === 'string' ? body['source'] : 'manual';
  if (!LEAD_SOURCES.has(source)) return json({ error: 'invalid_source' }, { status: 400 });

  const status = typeof body['status'] === 'string' ? body['status'] : 'new';
  if (!LEAD_STATUSES.has(status)) return json({ error: 'invalid_status' }, { status: 400 });

  const urgency = body['urgency'] === undefined ? null : body['urgency'];
  if (urgency !== null && (typeof urgency !== 'string' || !LEAD_URGENCIES.has(urgency))) {
    return json({ error: 'invalid_urgency' }, { status: 400 });
  }

  const fields = {
    id,
    name: stringOrNull(body['name']),
    email: stringOrNull(body['email']),
    phone: stringOrNull(body['phone']),
    company: stringOrNull(body['company']),
    industry: stringOrNull(body['industry']),
    source,
    pain_summary: stringOrNull(body['pain_summary']),
    urgency: urgency as string | null,
    status,
    notes: stringOrNull(body['notes']),
    owner_user_id: ctx.session.subjectId,
  };

  // Minimum: at least one of name/email/phone/company
  if (!fields.name && !fields.email && !fields.phone && !fields.company) {
    return json({ error: 'lead_requires_one_of_name_email_phone_company' }, { status: 400 });
  }

  await ctx.env.DB.prepare(
    `INSERT INTO lead (id, name, email, phone, company, industry, source, pain_summary, urgency, status, notes, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      fields.id,
      fields.name,
      fields.email,
      fields.phone,
      fields.company,
      fields.industry,
      fields.source,
      fields.pain_summary,
      fields.urgency,
      fields.status,
      fields.notes,
      fields.owner_user_id,
    )
    .run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'lead.create',
    entityType: 'lead',
    entityId: id,
    changes: fields,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const row = await ctx.env.DB.prepare(`SELECT * FROM lead WHERE id = ?`).bind(id).first<LeadRow>();
  return json({ lead: row }, { status: 201 });
}

export async function updateLead(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT * FROM lead WHERE id = ?`).bind(id).first<LeadRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  for (const field of LEAD_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }

  if (updates['source'] !== undefined && !LEAD_SOURCES.has(String(updates['source']))) {
    return json({ error: 'invalid_source' }, { status: 400 });
  }
  if (updates['status'] !== undefined && !LEAD_STATUSES.has(String(updates['status']))) {
    return json({ error: 'invalid_status' }, { status: 400 });
  }
  if (
    updates['urgency'] !== undefined &&
    updates['urgency'] !== null &&
    !LEAD_URGENCIES.has(String(updates['urgency']))
  ) {
    return json({ error: 'invalid_urgency' }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return json({ lead: before });
  }

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const sql = `UPDATE lead SET ${setClause} WHERE id = ?`;
  const binds = [...Object.values(updates), id];
  await ctx.env.DB.prepare(sql).bind(...binds).run();

  const diff = shallowDiff(before as unknown as Record<string, unknown>, updates);

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'lead.update',
    entityType: 'lead',
    entityId: id,
    changes: diff,
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const after = await ctx.env.DB.prepare(`SELECT * FROM lead WHERE id = ?`).bind(id).first<LeadRow>();
  return json({ lead: after });
}

export async function getLeadChatTranscript(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const lead = await ctx.env.DB.prepare(`SELECT id, origin_chat_session_id, source FROM lead WHERE id = ?`)
    .bind(id)
    .first<{ id: string; origin_chat_session_id: string | null; source: string | null }>();
  if (!lead) return json({ error: 'not_found' }, { status: 404 });
  if (!lead.origin_chat_session_id) {
    return json({ messages: [], session: null });
  }
  const session = await ctx.env.DB.prepare(
    `SELECT id, started_at, last_active_at, status, source_page FROM chat_session WHERE id = ?`,
  )
    .bind(lead.origin_chat_session_id)
    .first();
  const msgs = await ctx.env.DB.prepare(
    `SELECT role, content, tool_calls, created_at FROM chat_message WHERE session_id = ? ORDER BY created_at ASC`,
  )
    .bind(lead.origin_chat_session_id)
    .all<{ role: string; content: string; tool_calls: string | null; created_at: string }>();
  return json({ session, messages: msgs.results ?? [] });
}

export async function deleteLead(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT * FROM lead WHERE id = ?`).bind(id).first<LeadRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });

  await ctx.env.DB.prepare(`DELETE FROM lead WHERE id = ?`).bind(id).run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'lead.delete',
    entityType: 'lead',
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

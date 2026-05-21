import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit } from '../../lib/audit';
import { parseCsv } from '../../services/csv';

/**
 * Admin calling-list endpoints (spec 11, step L).
 *
 *   POST /api/admin/calling-list/import        — CSV upload
 *   GET  /api/admin/calling-list/today         — today's pending cards
 *   GET  /api/admin/calling-list               — filterable history
 *   GET  /api/admin/calling-list/stats         — counts dashboard
 *   POST /api/admin/calling-list/:id/log       — record an outcome
 *   POST /api/admin/calling-list/:id/reschedule
 *   POST /api/admin/calling-list/:id/disqualify
 *   POST /api/admin/calling-list/bulk-reschedule
 *
 * Lead conversion happens inside `/log` when `next_action` is
 * `convert_to_lead`. The created lead has `source='calling_list'`
 * (migration 0008) and `calling_list_item.converted_lead_id` points
 * back at it. All state changes write umbrella + per-entity audit
 * rows following the established cascade pattern.
 *
 * **CSV import is untrusted input.** The parser doesn't execute or
 * eval anything; values are stored as-is in TEXT columns + the
 * `extra_data` JSON blob. The audit log captures only summary stats
 * + a row count — never the row contents — so accidental credentials
 * in a CSV can't leak into audit.
 */

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CSV_ROWS = 5000;

const REQUIRED_HEADERS = ['company_name', 'call_date'] as const;
const KNOWN_COLUMNS = new Set([
  'company_name',
  'contact_name',
  'contact_email',
  'contact_phone',
  'industry',
  'source',
  'call_date',
  'notes',
]);

const OUTCOMES = new Set([
  'no_answer',
  'left_voicemail',
  'spoke_not_interested',
  'spoke_followup_needed',
  'disqualified',
  'spoke_qualified',
]);

const NEXT_ACTIONS = new Set(['done', 'reschedule', 'convert_to_lead']);

const DUPLICATE_MODES = new Set(['skip', 'update', 'create_anyway']);

type CallingListItemRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  source: string | null;
  call_date: string;
  status: string;
  notes: string | null;
  extra_data: string | null;
  converted_lead_id: string | null;
  imported_at: string;
};

// ─── CSV import ───────────────────────────────────────────────────────

export async function importCallingListHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(ctx.request.url);
  const mode = (url.searchParams.get('mode') as 'skip' | 'update' | 'create_anyway' | null) ?? 'skip';
  if (!DUPLICATE_MODES.has(mode)) {
    return json({ error: 'invalid_mode' }, { status: 400 });
  }

  // Body is CSV text. Limit size.
  const text = await ctx.request.text();
  if (text.length === 0) return json({ error: 'empty_body' }, { status: 400 });
  if (text.length > MAX_CSV_BYTES) {
    return json({ error: 'csv_too_large', limit_bytes: MAX_CSV_BYTES }, { status: 413 });
  }

  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) {
    return json({
      error: 'no_rows',
      headers: parsed.headers,
      row_errors: parsed.rowErrors,
    }, { status: 400 });
  }
  if (parsed.rows.length > MAX_CSV_ROWS) {
    return json({ error: 'too_many_rows', limit_rows: MAX_CSV_ROWS, got: parsed.rows.length }, { status: 413 });
  }
  // Required headers check.
  const missingRequired = REQUIRED_HEADERS.filter((h) => !parsed.headers.includes(h));
  if (missingRequired.length > 0) {
    return json({
      error: 'missing_required_columns',
      missing: missingRequired,
      headers_found: parsed.headers,
    }, { status: 400 });
  }
  const hasEmailCol = parsed.headers.includes('contact_email');
  const hasPhoneCol = parsed.headers.includes('contact_phone');
  if (!hasEmailCol && !hasPhoneCol) {
    return json({
      error: 'missing_contact_column',
      message: 'CSV must include at least one of contact_email or contact_phone.',
    }, { status: 400 });
  }

  // Per-row processing. Errors collected, valid rows inserted.
  const valid: CallingListItemRow[] = [];
  const rowErrors: Array<{ line: number; reason: string; row?: Record<string, string> }> = [
    ...parsed.rowErrors,
  ];
  const skipped: Array<{ line: number; reason: string; matched_id?: string }> = [];
  const updated: Array<{ line: number; matched_id: string }> = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i] ?? {};
    const line = i + 1; // 1-indexed data row number
    const company = row['company_name']?.trim() ?? '';
    const callDate = row['call_date']?.trim() ?? '';
    const email = row['contact_email']?.trim() ?? '';
    const phone = row['contact_phone']?.trim() ?? '';
    if (!company) {
      rowErrors.push({ line, reason: 'company_name is empty' });
      continue;
    }
    if (!callDate || !/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
      rowErrors.push({ line, reason: 'call_date must be YYYY-MM-DD' });
      continue;
    }
    if (!email && !phone) {
      rowErrors.push({ line, reason: 'must have either contact_email or contact_phone' });
      continue;
    }

    // Duplicate detection — match by company + (email OR phone) against
    // BOTH existing calling_list_item rows and existing lead rows. Lead
    // matches surface as duplicates because someone we already have in
    // the lead pipeline shouldn't usually get a fresh calling-list card.
    let matchedId: string | null = null;
    let matchedSource: 'calling_list_item' | 'lead' | null = null;
    const dupClItem = await ctx.env.DB.prepare(
      `SELECT id FROM calling_list_item
        WHERE company_name = ?
          AND ((? <> '' AND contact_email = ?) OR (? <> '' AND contact_phone = ?))
        LIMIT 1`,
    )
      .bind(company, email, email, phone, phone)
      .first<{ id: string }>();
    if (dupClItem) {
      matchedId = dupClItem.id;
      matchedSource = 'calling_list_item';
    } else {
      const dupLead = await ctx.env.DB.prepare(
        `SELECT id FROM lead
          WHERE (company = ? OR LOWER(company) = LOWER(?))
            AND ((? <> '' AND LOWER(email) = LOWER(?)) OR (? <> '' AND phone = ?))
          LIMIT 1`,
      )
        .bind(company, company, email, email, phone, phone)
        .first<{ id: string }>();
      if (dupLead) {
        matchedId = dupLead.id;
        matchedSource = 'lead';
      }
    }

    if (matchedId && mode === 'skip') {
      skipped.push({
        line,
        reason: matchedSource === 'lead'
          ? 'duplicate of existing lead (skip mode)'
          : 'duplicate of existing calling-list card (skip mode)',
        matched_id: matchedId,
      });
      continue;
    }
    // Update mode only applies to calling_list_item matches — we don't
    // overwrite a lead from a CSV import.
    if (matchedId && mode === 'update' && matchedSource !== 'calling_list_item') {
      skipped.push({
        line,
        reason: 'duplicate of existing lead — update mode does not overwrite leads',
        matched_id: matchedId,
      });
      continue;
    }

    const extras: Record<string, string> = {};
    for (const k of Object.keys(row)) {
      if (!KNOWN_COLUMNS.has(k) && row[k]) extras[k] = row[k]!;
    }

    if (matchedId && mode === 'update') {
      await ctx.env.DB.prepare(
        `UPDATE calling_list_item
            SET contact_name = ?, contact_email = ?, contact_phone = ?,
                industry = ?, source = ?, call_date = ?, notes = ?,
                extra_data = ?
          WHERE id = ?`,
      )
        .bind(
          row['contact_name'] || null,
          email || null,
          phone || null,
          row['industry'] || null,
          row['source'] || null,
          callDate,
          row['notes'] || null,
          Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
          matchedId,
        )
        .run();
      updated.push({ line, matched_id: matchedId });
      continue;
    }

    // Create (either no duplicate, or mode === 'create_anyway').
    const id = crypto.randomUUID();
    await ctx.env.DB.prepare(
      `INSERT INTO calling_list_item
         (id, company_name, contact_name, contact_email, contact_phone,
          industry, source, call_date, status, notes, extra_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(
        id,
        company,
        row['contact_name'] || null,
        email || null,
        phone || null,
        row['industry'] || null,
        row['source'] || null,
        callDate,
        row['notes'] || null,
        Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
      )
      .run();
    valid.push({
      id,
      company_name: company,
      contact_name: row['contact_name'] || null,
      contact_email: email || null,
      contact_phone: phone || null,
      industry: row['industry'] || null,
      source: row['source'] || null,
      call_date: callDate,
      status: 'pending',
      notes: row['notes'] || null,
      extra_data: Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
      converted_lead_id: null,
      imported_at: new Date().toISOString(),
    });
  }

  // Audit summary only — row contents intentionally not logged.
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'calling_list.imported',
    entityType: 'calling_list_item',
    entityId: 'batch',
    changes: {
      mode,
      total_rows: parsed.rows.length,
      created: valid.length,
      updated: updated.length,
      skipped: skipped.length,
      errors: rowErrors.length,
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  return json({
    ok: true,
    summary: {
      total_rows: parsed.rows.length,
      created: valid.length,
      updated: updated.length,
      skipped: skipped.length,
      errors: rowErrors.length,
    },
    row_errors: rowErrors,
    skipped,
    updated,
  });
}

// ─── Today ────────────────────────────────────────────────────────────

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function callingListTodayHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const today = todayIsoDate();
  const res = await ctx.env.DB.prepare(
    `SELECT * FROM calling_list_item
       WHERE call_date = ? AND status = 'pending'
       ORDER BY company_name COLLATE NOCASE ASC`,
  )
    .bind(today)
    .all<CallingListItemRow>();
  const rows = res.results ?? [];
  // Stats for today scoped within the same SELECT-window for the progress UI.
  const completed = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM calling_list_item WHERE call_date = ? AND status != 'pending'`,
  )
    .bind(today)
    .first<{ n: number }>();
  return json({
    today,
    cards: rows,
    progress: {
      remaining: rows.length,
      completed: completed?.n ?? 0,
      total: rows.length + (completed?.n ?? 0),
    },
  });
}

// ─── History list with filters ────────────────────────────────────────

export async function callingListIndexHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const industry = url.searchParams.get('industry');
  const q = url.searchParams.get('q');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    where.push('status = ?');
    binds.push(status);
  }
  if (from) {
    where.push('call_date >= ?');
    binds.push(from);
  }
  if (to) {
    where.push('call_date <= ?');
    binds.push(to);
  }
  if (industry) {
    where.push('industry = ?');
    binds.push(industry);
  }
  if (q && q.trim()) {
    const pat = `%${q.trim()}%`;
    where.push('(company_name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)');
    binds.push(pat, pat, pat);
  }
  let sql = `SELECT * FROM calling_list_item`;
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY call_date DESC, company_name COLLATE NOCASE ASC LIMIT 500`;
  const res = await ctx.env.DB.prepare(sql).bind(...binds).all<CallingListItemRow>();
  return json({ cards: res.results ?? [] });
}

// ─── Stats ────────────────────────────────────────────────────────────

export async function callingListStatsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const today = todayIsoDate();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const todayRes = await ctx.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_today,
       SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS completed_today,
       COUNT(*) AS total_today
     FROM calling_list_item WHERE call_date = ?`,
  )
    .bind(today)
    .first<{ pending_today: number; completed_today: number; total_today: number }>();

  const weekRes = await ctx.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_worked,
       SUM(CASE WHEN status = 'converted_to_lead' THEN 1 ELSE 0 END) AS converted_this_week
     FROM calling_list_item
     WHERE call_date BETWEEN ? AND ? AND status != 'pending'`,
  )
    .bind(weekAgo, today)
    .first<{ total_worked: number; converted_this_week: number }>();

  const allTimeRes = await ctx.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'converted_to_lead' THEN 1 ELSE 0 END) AS total_converted_to_leads
     FROM calling_list_item`,
  )
    .first<{ total: number; total_converted_to_leads: number }>();

  // Clients-converted-from-calling-list: leads sourced from calling_list
  // that have an inbound client.origin_lead_id pointer.
  const clientsFromCalling = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM client c
       JOIN lead l ON l.id = c.origin_lead_id
      WHERE l.source = 'calling_list'`,
  ).first<{ n: number }>();

  return json({
    today: {
      remaining: todayRes?.pending_today ?? 0,
      completed: todayRes?.completed_today ?? 0,
      total: todayRes?.total_today ?? 0,
    },
    this_week: {
      worked: weekRes?.total_worked ?? 0,
      converted_to_leads: weekRes?.converted_this_week ?? 0,
    },
    all_time: {
      total_cards: allTimeRes?.total ?? 0,
      converted_to_leads: allTimeRes?.total_converted_to_leads ?? 0,
      converted_to_clients: clientsFromCalling?.n ?? 0,
    },
  });
}

// ─── Log a call ───────────────────────────────────────────────────────

function nextStatusFor(outcome: string, nextAction: string): string {
  if (nextAction === 'convert_to_lead') return 'converted_to_lead';
  if (nextAction === 'reschedule') return 'pending';
  // done
  switch (outcome) {
    case 'no_answer':
    case 'left_voicemail':
      return 'no_answer';
    case 'spoke_not_interested':
    case 'disqualified':
      return 'disqualified';
    case 'spoke_followup_needed':
      return 'followup';
    case 'spoke_qualified':
      return 'completed';
    default:
      return 'called';
  }
}

export async function callingListLogHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });
  const outcome = typeof body['outcome'] === 'string' ? body['outcome'] : '';
  const nextAction = typeof body['next_action'] === 'string' ? body['next_action'] : 'done';
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : null;
  const nextDate = typeof body['next_action_date'] === 'string' ? body['next_action_date'].trim() : null;
  if (!OUTCOMES.has(outcome)) return json({ error: 'invalid_outcome' }, { status: 400 });
  if (!NEXT_ACTIONS.has(nextAction)) return json({ error: 'invalid_next_action' }, { status: 400 });
  if (nextAction === 'reschedule' && !nextDate) {
    return json({ error: 'next_action_date_required' }, { status: 400 });
  }
  if (nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
    return json({ error: 'invalid_next_action_date' }, { status: 400 });
  }

  const before = await ctx.env.DB.prepare(
    `SELECT * FROM calling_list_item WHERE id = ?`,
  )
    .bind(id)
    .first<CallingListItemRow>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });
  if (before.status === 'converted_to_lead') {
    return json({ error: 'already_converted', lead_id: before.converted_lead_id }, { status: 409 });
  }

  const newStatus = nextStatusFor(outcome, nextAction);
  const now = new Date().toISOString();
  const logId = crypto.randomUUID();

  const stmts = [] as ReturnType<typeof ctx.env.DB.prepare>[];

  // Always write the calling_log row.
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO calling_log (id, calling_list_item_id, outcome, notes, next_action_date)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(logId, id, outcome, notes, nextAction === 'reschedule' ? nextDate : null),
  );

  let newLeadId: string | null = null;
  if (nextAction === 'convert_to_lead') {
    newLeadId = crypto.randomUUID();
    const prefilledNotes =
      `Converted from calling list on ${now.slice(0, 10)}.\n` +
      `Outcome: ${outcome}.` +
      (notes ? `\nCall notes: ${notes}` : '');
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO lead (id, name, email, phone, company, industry, source, status, notes, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'calling_list', 'contacted', ?, ?)`,
      ).bind(
        newLeadId,
        before.contact_name,
        before.contact_email,
        before.contact_phone,
        before.company_name,
        before.industry,
        prefilledNotes,
        ctx.session.subjectId,
      ),
    );
    stmts.push(
      ctx.env.DB.prepare(
        `UPDATE calling_list_item SET status = ?, converted_lead_id = ? WHERE id = ?`,
      ).bind(newStatus, newLeadId, id),
    );
  } else if (nextAction === 'reschedule') {
    stmts.push(
      ctx.env.DB.prepare(
        `UPDATE calling_list_item SET status = ?, call_date = ? WHERE id = ?`,
      ).bind(newStatus, nextDate, id),
    );
  } else {
    // done
    stmts.push(
      ctx.env.DB.prepare(`UPDATE calling_list_item SET status = ? WHERE id = ?`).bind(newStatus, id),
    );
  }

  // Audit cascade.
  const actorId = ctx.session.subjectId;
  const ip = ctx.session.ipAddress;
  const ua = ctx.session.userAgent;
  const audit = (action: string, entityType: string, entityId: string, changes: Record<string, unknown>) =>
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'admin_user', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), actorId, action, entityType, entityId, JSON.stringify(changes), ip, ua);

  stmts.push(
    audit('calling_list_item.call_logged', 'calling_list_item', id, {
      log_id: logId,
      outcome,
      next_action: nextAction,
      status: { from: before.status, to: newStatus },
      converted_lead_id: newLeadId,
    }),
  );
  if (newLeadId) {
    stmts.push(
      audit('lead.create.from_calling_list', 'lead', newLeadId, {
        from_calling_list_item_id: id,
        source: 'calling_list',
        status: 'contacted',
      }),
    );
    stmts.push(
      audit('calling_list_item.converted', 'calling_list_item', id, {
        converted_lead_id: newLeadId,
        outcome,
      }),
    );
  }

  await ctx.env.DB.batch(stmts);

  return json({
    ok: true,
    log_id: logId,
    status: newStatus,
    converted_lead_id: newLeadId,
  });
}

// ─── Reschedule / Disqualify / Bulk ──────────────────────────────────

export async function callingListRescheduleHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const body = await readJsonObject(ctx.request);
  const newDate = body && typeof body['call_date'] === 'string' ? body['call_date'].trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return json({ error: 'invalid_call_date' }, { status: 400 });

  const before = await ctx.env.DB.prepare(`SELECT call_date, status FROM calling_list_item WHERE id = ?`)
    .bind(id)
    .first<{ call_date: string; status: string }>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });
  if (before.status === 'converted_to_lead') {
    return json({ error: 'already_converted' }, { status: 409 });
  }
  await ctx.env.DB.prepare(
    `UPDATE calling_list_item SET call_date = ?, status = 'pending' WHERE id = ?`,
  )
    .bind(newDate, id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'calling_list_item.rescheduled',
    entityType: 'calling_list_item',
    entityId: id,
    changes: {
      call_date: { from: before.call_date, to: newDate },
      status: { from: before.status, to: 'pending' },
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  return json({ ok: true, call_date: newDate });
}

export async function callingListDisqualifyHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const before = await ctx.env.DB.prepare(`SELECT status FROM calling_list_item WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  if (!before) return json({ error: 'not_found' }, { status: 404 });
  if (before.status === 'converted_to_lead') {
    return json({ error: 'already_converted' }, { status: 409 });
  }
  await ctx.env.DB.prepare(`UPDATE calling_list_item SET status = 'disqualified' WHERE id = ?`)
    .bind(id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'calling_list_item.disqualified',
    entityType: 'calling_list_item',
    entityId: id,
    changes: { status: { from: before.status, to: 'disqualified' } },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  return json({ ok: true });
}

export async function callingListBulkRescheduleHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const body = await readJsonObject(ctx.request);
  const ids = body && Array.isArray(body['ids']) ? body['ids'] : null;
  const newDate = body && typeof body['call_date'] === 'string' ? body['call_date'].trim() : '';
  if (!ids || ids.length === 0) return json({ error: 'ids_required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return json({ error: 'invalid_call_date' }, { status: 400 });

  const idList = (ids as unknown[]).filter((s): s is string => typeof s === 'string');
  if (idList.length === 0) return json({ error: 'ids_required' }, { status: 400 });
  if (idList.length > 200) return json({ error: 'too_many_ids' }, { status: 400 });

  const placeholders = idList.map(() => '?').join(',');
  const result = await ctx.env.DB.prepare(
    `UPDATE calling_list_item
        SET call_date = ?, status = 'pending'
      WHERE id IN (${placeholders})
        AND status != 'converted_to_lead'`,
  )
    .bind(newDate, ...idList)
    .run();
  const updated = (result.meta as { changes?: number } | undefined)?.changes ?? 0;

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'calling_list.bulk_rescheduled',
    entityType: 'calling_list_item',
    entityId: 'batch',
    changes: {
      call_date: newDate,
      ids_requested: idList.length,
      ids_updated: updated,
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  return json({ ok: true, updated });
}

// ─── helpers ──────────────────────────────────────────────────────────

async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = (await req.json()) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { auditStatement, type AuditEntry } from '../../lib/audit';
import { buildClientCreate } from './clients';
import { buildOpportunityCreate } from './opportunities';

/**
 * Studio44 Layer 1 — leads-wizard endpoints.
 *
 * READ (spec §5.2):
 *   GET  /api/admin/leads/queue           — prioritized calling queue (cold | followups)
 *   GET  /api/admin/leads/:id/card        — full call-card payload + activity timeline
 *   GET  /api/admin/script-variants       — active variants by stage + usage rollups
 *
 * WRITE (spec §2.4 / §4.1 / §4.4 / §5.1):
 *   POST /api/admin/leads/:id/activity    — log a non-booking call outcome (atomic)
 *   POST /api/admin/leads/:id/book        — the one-motion booking transaction (atomic)
 *
 * The booking endpoint silently runs the Lead→Prospect conversion (client +
 * opportunity) and places assessment #1, reusing the EXTRACTED cores
 * (buildClientCreate / buildOpportunityCreate) composed into a single DB.batch —
 * the same cores the standalone /clients and /opportunities POSTs use, so business
 * logic is not duplicated.
 *
 * Auth is enforced upstream by the `/api/admin/` gate in src/index.ts, which
 * threads a verified admin SessionRecord into ctx.session; the `if (!ctx.session)`
 * guard mirrors the existing admin handlers (belt-and-suspenders).
 *
 * Sessions are runtime constructs: the queue endpoint mints an EPHEMERAL session
 * id (crypto.randomUUID) and returns it for the UI to thread into later write
 * calls as lead_activity.session_id. No session table exists or is created.
 */

const QUEUE_MODES = new Set(['cold', 'followups']);
const TARGET_KINDS = new Set(['book', 'call']);

// A lead is callable only if it hasn't converted, wasn't disqualified, and isn't
// suppressed by the do-not-call / dead-number flags. ('pre-converted' per §5.2;
// 'disqualified' is treated as non-callable, parallel to the dead-number flag.)
const CALLABLE_STATUS = `status NOT IN ('converted', 'disqualified')`;
const NOT_SUPPRESSED = `do_not_call = 0 AND is_dead_number = 0`;

const QUEUE_LIMIT = 200;

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  source: string | null;
  pain_summary: string | null;
  urgency: string | null;
  status: string;
  notes: string | null;
  owner_user_id: string | null;
  last_contacted_at: string | null;
  next_followup_at: string | null;
  attempt_count: number;
  do_not_call: number;
  is_dead_number: number;
  created_at: string;
};

type LeadActivityRow = {
  id: string;
  lead_id: string;
  kind: string;
  outcome: string | null;
  attempt_number: number | null;
  industry_at_time: string | null;
  opener_variant_id: string | null;
  hook_variant_id: string | null;
  discovery_variant_id: string | null;
  close_variant_id: string | null;
  card_dwell_ms: number | null;
  phone_duration_s: number | null;
  session_id: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

// ─── 1. Session / queue ───────────────────────────────────────────────────
//
// cold      = never-contacted leads (no lead_activity rows), callable, ordered
//             oldest-first (FIFO so nothing rots). All sit in the 'new' bucket.
// followups = leads whose next_followup_at is set and DUE (<= today), callable,
//             ordered strictly overdue → due-today, then oldest follow-up first
//             (Decision 3).
//
// Priority buckets are shared across both modes: overdue(0) → due_today(1) →
// new(2). `sort_rank` is the materialized ordering primitive. `value_weight` is
// the RESERVED slot for L4 value-weighting — always null here; when Alice fills
// it the merged ordering becomes (sort_rank, value_weight, date) with no shape
// change. Weighting itself is NOT implemented in Layer 1.

export async function leadsQueueHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(ctx.request.url);
  const mode = url.searchParams.get('mode') ?? '';
  if (!QUEUE_MODES.has(mode)) return json({ error: 'invalid_mode' }, { status: 400 });

  const targetKind = url.searchParams.get('target_kind') ?? 'book';
  if (!TARGET_KINDS.has(targetKind)) return json({ error: 'invalid_target_kind' }, { status: 400 });
  const target = optionalPositiveInt(url.searchParams.get('target'));

  let rows: LeadRow[];
  if (mode === 'cold') {
    const res = await ctx.env.DB.prepare(
      `SELECT l.* FROM lead l
         WHERE l.${CALLABLE_STATUS}
           AND l.${NOT_SUPPRESSED}
           AND NOT EXISTS (SELECT 1 FROM lead_activity a WHERE a.lead_id = l.id)
         ORDER BY l.created_at ASC
         LIMIT ?`,
    )
      .bind(QUEUE_LIMIT)
      .all<LeadRow>();
    rows = res.results ?? [];
  } else {
    // followups: next_followup_at set AND due (date-boundary compare handles both
    // 'YYYY-MM-DD' and full-ISO values via SQLite's date()).
    const res = await ctx.env.DB.prepare(
      `SELECT l.* FROM lead l
         WHERE l.${CALLABLE_STATUS}
           AND l.${NOT_SUPPRESSED}
           AND l.next_followup_at IS NOT NULL
           AND date(l.next_followup_at) <= date('now')
         ORDER BY
           CASE WHEN date(l.next_followup_at) < date('now') THEN 0 ELSE 1 END ASC,
           l.next_followup_at ASC
         LIMIT ?`,
    )
      .bind(QUEUE_LIMIT)
      .all<LeadRow>();
    rows = res.results ?? [];
  }

  const queue = rows.map((l) => toQueueItem(l, mode));
  const overdue = queue.filter((q) => q.priority_bucket === 'overdue').length;
  const due_today = queue.filter((q) => q.priority_bucket === 'due_today').length;

  return json({
    session: {
      id: crypto.randomUUID(), // ephemeral — no DB row; threaded into later writes
      mode,
      target_kind: targetKind,
      target,
      generated_at: new Date().toISOString(),
    },
    queue,
    counts:
      mode === 'followups'
        ? { queued: queue.length, overdue, due_today }
        : { queued: queue.length },
  });
}

function toQueueItem(l: LeadRow, mode: string) {
  let priority_bucket: 'overdue' | 'due_today' | 'new';
  if (mode === 'followups') {
    priority_bucket = isOverdue(l.next_followup_at) ? 'overdue' : 'due_today';
  } else {
    priority_bucket = 'new';
  }
  const sort_rank = priority_bucket === 'overdue' ? 0 : priority_bucket === 'due_today' ? 1 : 2;
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    industry: l.industry,
    source: l.source,
    email: l.email,
    phone: l.phone,
    status: l.status,
    attempt_count: l.attempt_count,
    last_contacted_at: l.last_contacted_at,
    next_followup_at: l.next_followup_at,
    priority_bucket,
    sort_rank,
    value_weight: null as number | null, // RESERVED for L4 value-weighting
  };
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const day = iso.slice(0, 10); // date part of 'YYYY-MM-DD' or full ISO
  const today = new Date().toISOString().slice(0, 10);
  return day < today;
}

// ─── 2. Lead-card read ──────────────────────────────────────────────────────
//
// Everything the prototyped card needs that the step-1 schema actually backs:
// identity (company / contact name / industry / source), attempt_count,
// last_contacted_at, and the prior lead_activity timeline (newest first).
//
// NOTE: the prototype's "contact role/title" and "rough size" sub-fields have NO
// backing column in the step-1 schema (not in lead, not added by §4). They are
// omitted here rather than improvised — flagged for the operator.

export async function leadCardHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const lead = await ctx.env.DB.prepare(`SELECT * FROM lead WHERE id = ?`)
    .bind(id)
    .first<LeadRow>();
  if (!lead) return json({ error: 'not_found' }, { status: 404 });

  const timelineRes = await ctx.env.DB.prepare(
    `SELECT * FROM lead_activity WHERE lead_id = ? ORDER BY created_at DESC`,
  )
    .bind(id)
    .all<LeadActivityRow>();

  return json({
    card: {
      id: lead.id,
      name: lead.name,
      company: lead.company,
      industry: lead.industry,
      source: lead.source,
      email: lead.email,
      phone: lead.phone,
      pain_summary: lead.pain_summary,
      urgency: lead.urgency,
      status: lead.status,
      attempt_count: lead.attempt_count,
      last_contacted_at: lead.last_contacted_at,
      next_followup_at: lead.next_followup_at,
      do_not_call: lead.do_not_call,
      is_dead_number: lead.is_dead_number,
      created_at: lead.created_at,
    },
    timeline: timelineRes.results ?? [],
  });
}

// ─── 3. Script variants + usage rollups ───────────────────────────────────────
//
// Active variants grouped by stage. The "used N×, booked M, book-rate%" stats are
// rollups computed ON READ from script_variant_usage (per §4.4 — a cached counter
// is explicitly optional/deferred and is NOT added). One LEFT JOIN + GROUP BY;
// book_rate is derived in JS (guarded against divide-by-zero). Seeded rows
// (author_kind='seed') are included like any other active variant.

type VariantRollupRow = {
  id: string;
  stage: string;
  body: string;
  author_kind: string;
  author_user_id: string | null;
  label: string | null;
  industry: string | null;
  is_active: number;
  created_at: string;
  used_count: number;
  booked_count: number;
};

export async function listScriptVariantsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(ctx.request.url);
  const stageFilter = url.searchParams.get('stage');
  const binds: unknown[] = [];
  let stageClause = '';
  if (stageFilter) {
    if (!['opener', 'hook', 'discovery', 'close'].includes(stageFilter)) {
      return json({ error: 'invalid_stage' }, { status: 400 });
    }
    stageClause = ` AND v.stage = ?`;
    binds.push(stageFilter);
  }

  const res = await ctx.env.DB.prepare(
    `SELECT v.id, v.stage, v.body, v.author_kind, v.author_user_id, v.label,
            v.industry, v.is_active, v.created_at,
            COUNT(u.id) AS used_count,
            SUM(CASE WHEN u.outcome = 'booked' THEN 1 ELSE 0 END) AS booked_count
       FROM script_variant v
       LEFT JOIN script_variant_usage u ON u.variant_id = v.id
      WHERE v.is_active = 1${stageClause}
      GROUP BY v.id
      ORDER BY v.stage ASC, v.created_at ASC`,
  )
    .bind(...binds)
    .all<VariantRollupRow>();

  const grouped: Record<'opener' | 'hook' | 'discovery' | 'close', ReturnType<typeof toVariantWithRollup>[]> = {
    opener: [],
    hook: [],
    discovery: [],
    close: [],
  };
  for (const row of res.results ?? []) {
    const stage = row.stage as 'opener' | 'hook' | 'discovery' | 'close';
    if (stage in grouped) grouped[stage].push(toVariantWithRollup(row));
  }

  return json({ variants: grouped });
}

function toVariantWithRollup(row: VariantRollupRow) {
  const used = row.used_count ?? 0;
  const booked = row.booked_count ?? 0;
  return {
    id: row.id,
    stage: row.stage,
    body: row.body,
    author_kind: row.author_kind,
    author_user_id: row.author_user_id,
    label: row.label,
    industry: row.industry,
    is_active: row.is_active,
    created_at: row.created_at,
    usage: {
      used_count: used,
      booked_count: booked,
      book_rate: used > 0 ? booked / used : 0, // 0..1; UI renders as %
    },
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function optionalPositiveInt(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

// ─── 4. Log a non-booking outcome (WRITE — atomic) ─────────────────────────────
//
// POST /api/admin/leads/:id/activity
//
// Records one of the five non-booking call outcomes (or a skip) for a lead, in a
// single DB.batch transaction (all-or-nothing). The BOOKING outcome is NOT handled
// here — it's the step-5 transaction. outcome === kind 1:1 for all six values.
//
// outcome → kind + side effects (built exactly per §2.4):
//   callback    → kind 'callback'    · set next_followup_at = provided datetime · bump + last_contacted
//   no_answer   → kind 'no_answer'   · bump + last_contacted
//   voicemail   → kind 'voicemail'   · bump + last_contacted
//   dead_number → kind 'dead_number' · set is_dead_number = 1 · bump + last_contacted
//   do_not_call → kind 'do_not_call' · set do_not_call = 1    · bump + last_contacted
//   skipped     → kind 'skipped'     · NO bump, NO last_contacted (a skip isn't a contact)
//
// For the five real outcomes: attempt_number = current count + 1 (this call IS that
// attempt) and a script_variant_usage row is appended per non-null variant id used.
// For 'skipped': attempt_number = current count (no attempt made); the chosen variant
// ids are still snapshotted onto the activity row (over-track mandate) but NO
// script_variant_usage rows are written (the script wasn't delivered — keeps
// book-rate denominators honest). industry_at_time and attempt_number are taken
// from the lead server-side, not trusted from the client.

const ACTIVITY_OUTCOMES = new Set([
  'callback',
  'no_answer',
  'voicemail',
  'dead_number',
  'do_not_call',
  'skipped',
]);

type ActivityVariantField =
  | 'opener_variant_id'
  | 'hook_variant_id'
  | 'discovery_variant_id'
  | 'close_variant_id';

const VARIANT_FIELDS: ActivityVariantField[] = [
  'opener_variant_id',
  'hook_variant_id',
  'discovery_variant_id',
  'close_variant_id',
];

export async function logLeadActivityHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const outcome = typeof body['outcome'] === 'string' ? body['outcome'] : '';
  if (!ACTIVITY_OUTCOMES.has(outcome)) return json({ error: 'invalid_outcome' }, { status: 400 });

  const nextFollowupAt =
    typeof body['next_followup_at'] === 'string' ? body['next_followup_at'].trim() : '';
  if (outcome === 'callback' && !nextFollowupAt) {
    return json({ error: 'next_followup_at_required' }, { status: 400 });
  }

  const cardDwellMs = optionalNonNegativeInt(body['card_dwell_ms']);
  const phoneDurationS = optionalNonNegativeInt(body['phone_duration_s']);
  const sessionId = stringOrNull(body['session_id']);
  const notes = stringOrNull(body['notes']);
  const variantIds: Record<ActivityVariantField, string | null> = {
    opener_variant_id: stringOrNull(body['opener_variant_id']),
    hook_variant_id: stringOrNull(body['hook_variant_id']),
    discovery_variant_id: stringOrNull(body['discovery_variant_id']),
    close_variant_id: stringOrNull(body['close_variant_id']),
  };

  const lead = await ctx.env.DB.prepare(
    `SELECT id, industry, status, attempt_count, do_not_call, is_dead_number FROM lead WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      industry: string | null;
      status: string;
      attempt_count: number;
      do_not_call: number;
      is_dead_number: number;
    }>();
  if (!lead) return json({ error: 'not_found' }, { status: 404 });

  const isSkip = outcome === 'skipped';
  const now = new Date().toISOString();
  const activityId = crypto.randomUUID();
  // attempt_number: real outcomes record THIS attempt (count + 1); a skip records
  // the current count (no attempt was made).
  const attemptNumber = isSkip ? lead.attempt_count : lead.attempt_count + 1;

  const actorId = ctx.session.subjectId;
  const ip = ctx.session.ipAddress;
  const ua = ctx.session.userAgent;

  const stmts = [] as ReturnType<typeof ctx.env.DB.prepare>[];

  // 1. The lead_activity row (always). kind === outcome (1:1).
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO lead_activity
         (id, lead_id, kind, outcome, attempt_number, industry_at_time,
          opener_variant_id, hook_variant_id, discovery_variant_id, close_variant_id,
          card_dwell_ms, phone_duration_s, session_id, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      activityId,
      id,
      outcome,
      outcome,
      attemptNumber,
      lead.industry,
      variantIds.opener_variant_id,
      variantIds.hook_variant_id,
      variantIds.discovery_variant_id,
      variantIds.close_variant_id,
      cardDwellMs,
      phoneDurationS,
      sessionId,
      notes,
      actorId,
    ),
  );

  // 2. Lead mutation — only for the five real outcomes (a skip changes nothing).
  if (!isSkip) {
    const sets = ['attempt_count = attempt_count + 1', 'last_contacted_at = ?'];
    const binds: unknown[] = [now];
    if (outcome === 'callback') {
      sets.push('next_followup_at = ?');
      binds.push(nextFollowupAt);
    }
    if (outcome === 'dead_number') sets.push('is_dead_number = 1');
    if (outcome === 'do_not_call') sets.push('do_not_call = 1');
    binds.push(id);
    stmts.push(
      ctx.env.DB.prepare(`UPDATE lead SET ${sets.join(', ')} WHERE id = ?`).bind(...binds),
    );

    // 3. script_variant_usage — one row per non-null variant actually used on the
    //    call. Skipped outcomes write none (script wasn't delivered).
    for (const field of VARIANT_FIELDS) {
      const vid = variantIds[field];
      if (!vid) continue;
      stmts.push(
        ctx.env.DB.prepare(
          `INSERT INTO script_variant_usage (id, variant_id, lead_id, activity_id, outcome)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), vid, id, activityId, outcome),
      );
    }
  }

  // 4. Audit (inlined into the same batch so it's part of the atomic write).
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'admin_user', ?, ?, 'lead', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      actorId,
      'lead.activity_logged',
      id,
      JSON.stringify({
        activity_id: activityId,
        kind: outcome,
        outcome,
        attempt_number: attemptNumber,
        attempt_count: { from: lead.attempt_count, to: isSkip ? lead.attempt_count : lead.attempt_count + 1 },
        session_id: sessionId,
        card_dwell_ms: cardDwellMs,
        next_followup_at: outcome === 'callback' ? nextFollowupAt : undefined,
        is_dead_number: outcome === 'dead_number' ? 1 : undefined,
        do_not_call: outcome === 'do_not_call' ? 1 : undefined,
      }),
      ip,
      ua,
    ),
  );

  await ctx.env.DB.batch(stmts);

  return json({
    ok: true,
    activity_id: activityId,
    lead: {
      id,
      attempt_count: isSkip ? lead.attempt_count : lead.attempt_count + 1,
      last_contacted_at: isSkip ? null : now,
      next_followup_at: outcome === 'callback' ? nextFollowupAt : null,
      do_not_call: outcome === 'do_not_call' ? 1 : lead.do_not_call,
      is_dead_number: outcome === 'dead_number' ? 1 : lead.is_dead_number,
    },
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

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function optionalNonNegativeInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

// ─── 5. Book an assessment — the one-motion transaction (WRITE — atomic) ───────
//
// POST /api/admin/leads/:id/book
//
// "Book assessment for lead X at datetime T." The money moment (§5.1). In ONE
// DB.batch (all-or-nothing) it silently runs the Lead→Prospect conversion and
// places assessment #1 — the operator never sees "create client/opportunity".
//
// All new row ids are app-generated UUIDs known BEFORE the batch, so the
// activity↔assessment FK (assessment.booked_from_activity_id → lead_activity.id)
// is set with no read-back: insert the activity earlier in the array, reference its
// known id from the assessment insert later in the same array. D1 runs the batch
// sequentially in one transaction, so parent rows exist by the time FKs are checked.
//
// stmts[] ordering (FK-safe):
//   1. client INSERT                         (buildClientCreate)
//   2. lead UPDATE status='converted'        (buildClientCreate, conversion arm)
//   3. opportunity INSERT                    (buildOpportunityCreate; FK client_id ✓)
//   4. lead UPDATE last_contacted_at + attempt_count+1   (calling columns)
//   5. lead_activity INSERT (kind='booked')  (FK lead + script_variant ✓)
//   6. assessment INSERT (booked_from_activity_id = activity id from #5)
//   7. script_variant_usage INSERT × non-null variants (outcome='booked')
//   8. (optional) calling_list_item UPDATE — keep the two systems from drifting
//   9. audit INSERTs (client.create.from_lead, lead.convert, opportunity.create,
//      lead.booked, assessment.create, [calling_list_item.*]) — inlined into the batch
//
// Opportunity value columns are intentionally left NULL — value is Alice's job (L4),
// not an operator input (operator decision; §2.3). No value is written here.

export async function bookAssessmentHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const scheduledAt = stringOrNull(body['scheduled_at']);
  if (!scheduledAt) return json({ error: 'scheduled_at_required' }, { status: 400 });

  const cardDwellMs = optionalNonNegativeInt(body['card_dwell_ms']);
  const phoneDurationS = optionalNonNegativeInt(body['phone_duration_s']);
  const sessionId = stringOrNull(body['session_id']);
  const notes = stringOrNull(body['notes']);
  const variants = {
    opener: stringOrNull(body['opener_variant_id']),
    hook: stringOrNull(body['hook_variant_id']),
    discovery: stringOrNull(body['discovery_variant_id']),
    close: stringOrNull(body['close_variant_id']),
  };

  const lead = await ctx.env.DB.prepare(
    `SELECT id, name, email, phone, company, industry, status, attempt_count FROM lead WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
      industry: string | null;
      status: string;
      attempt_count: number;
    }>();
  if (!lead) return json({ error: 'not_found' }, { status: 404 });
  if (lead.status === 'converted') return json({ error: 'already_converted' }, { status: 409 });

  // calling-list drift: if this lead came from a calling_list_item, make sure that
  // item is in its terminal converted state so it stays out of the calling pool.
  // (The enum has no prospect-specific value; 'converted_to_lead' is the terminal
  // that already removes it — see report. Almost always already set.)
  const callingItem = await ctx.env.DB.prepare(
    `SELECT id, status FROM calling_list_item WHERE converted_lead_id = ? LIMIT 1`,
  )
    .bind(id)
    .first<{ id: string; status: string }>();

  const now = new Date().toISOString();
  const actor = { id: ctx.session.subjectId, ip: ctx.session.ipAddress, ua: ctx.session.userAgent };
  const companyName = lead.company ?? lead.name ?? lead.email ?? 'Unknown company';
  const attemptNumber = lead.attempt_count + 1;
  const activityId = crypto.randomUUID();
  const assessmentId = crypto.randomUUID();

  // Cores (reused — same logic as the standalone /clients and /opportunities POSTs).
  const clientCore = buildClientCreate(
    ctx.env,
    {
      company_name: companyName,
      primary_contact_name: lead.name,
      primary_contact_email: lead.email,
      primary_contact_phone: lead.phone,
      industry: lead.industry,
      billing_address: null,
      status: 'prospect',
      origin_lead_id: id,
      notes: `Auto-created on booking an assessment (${now.slice(0, 10)}).`,
    },
    actor,
    lead.status,
  );
  const oppCore = buildOpportunityCreate(
    ctx.env,
    {
      client_id: clientCore.id, // known up-front; FK resolves within the batch
      name: `${companyName} — assessment`,
      description: null, // value_setup/value_monthly intentionally left NULL (Alice, L4)
      owner_user_id: ctx.session.subjectId,
    },
    actor,
  );

  const stmts: D1PreparedStatement[] = [];

  // 1–2. client (+ lead status='converted')
  stmts.push(...clientCore.statements);
  // 3. opportunity (open) on the new client
  stmts.push(...oppCore.statements);
  // 4. lead calling columns (status already flipped to 'converted' by the client core)
  stmts.push(
    ctx.env.DB.prepare(
      `UPDATE lead SET last_contacted_at = ?, attempt_count = attempt_count + 1 WHERE id = ?`,
    ).bind(now, id),
  );
  // 5. lead_activity (kind='booked') — MUST precede the assessment (FK target)
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO lead_activity
         (id, lead_id, kind, outcome, attempt_number, industry_at_time,
          opener_variant_id, hook_variant_id, discovery_variant_id, close_variant_id,
          card_dwell_ms, phone_duration_s, session_id, notes, created_by_user_id)
       VALUES (?, ?, 'booked', 'booked', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      activityId,
      id,
      attemptNumber,
      lead.industry,
      variants.opener,
      variants.hook,
      variants.discovery,
      variants.close,
      cardDwellMs,
      phoneDurationS,
      sessionId,
      notes,
      actor.id,
    ),
  );
  // 6. assessment #1 — booked_from_activity_id = the activity id above (no read-back)
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO assessment
         (id, opportunity_id, scheduled_at, status, sequence_number, booked_from_activity_id, created_by_user_id)
       VALUES (?, ?, ?, 'booked', 1, ?, ?)`,
    ).bind(assessmentId, oppCore.id, scheduledAt, activityId, actor.id),
  );
  // 7. script_variant_usage — one per non-null variant, outcome='booked' (makes book-rate real)
  for (const vid of [variants.opener, variants.hook, variants.discovery, variants.close]) {
    if (!vid) continue;
    stmts.push(
      ctx.env.DB.prepare(
        `INSERT INTO script_variant_usage (id, variant_id, lead_id, activity_id, outcome)
         VALUES (?, ?, ?, ?, 'booked')`,
      ).bind(crypto.randomUUID(), vid, id, activityId),
    );
  }

  // Audits — core audits + booking-specific, all inlined into the same batch.
  const audits: AuditEntry[] = [
    ...clientCore.audits,
    ...oppCore.audits,
    {
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'lead.booked',
      entityType: 'lead',
      entityId: id,
      changes: {
        activity_id: activityId,
        assessment_id: assessmentId,
        client_id: clientCore.id,
        opportunity_id: oppCore.id,
        scheduled_at: scheduledAt,
        attempt_number: attemptNumber,
        session_id: sessionId,
        card_dwell_ms: cardDwellMs,
      },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    },
    {
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'assessment.create',
      entityType: 'assessment',
      entityId: assessmentId,
      changes: {
        opportunity_id: oppCore.id,
        scheduled_at: scheduledAt,
        sequence_number: 1,
        booked_from_activity_id: activityId,
      },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    },
  ];

  // 8. calling-list drift guard (only if linked + not already terminal).
  if (callingItem && callingItem.status !== 'converted_to_lead') {
    stmts.push(
      ctx.env.DB.prepare(`UPDATE calling_list_item SET status = 'converted_to_lead' WHERE id = ?`).bind(
        callingItem.id,
      ),
    );
    audits.push({
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'calling_list_item.prospect_booked',
      entityType: 'calling_list_item',
      entityId: callingItem.id,
      changes: { status: { from: callingItem.status, to: 'converted_to_lead' }, booked_lead_id: id },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    });
  }

  // 9. audit INSERTs last (no FK dependencies).
  for (const a of audits) stmts.push(auditStatement(ctx.env, a));

  await ctx.env.DB.batch(stmts);

  return json(
    {
      ok: true,
      lead_id: id,
      client_id: clientCore.id,
      opportunity_id: oppCore.id,
      assessment_id: assessmentId,
      activity_id: activityId,
    },
    { status: 201 },
  );
}

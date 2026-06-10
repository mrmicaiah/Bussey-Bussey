import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { buildCardLogTransaction, type CardLogCardRow, type CardLogNextMove } from '../../lib/calls-tx';

/**
 * Studio44 Calls layer — read-side endpoints (spec §5.1, §6.1).
 *
 * READ-ONLY:
 *   GET /api/admin/calls/queue         — eligible call cards for a mode + prior_attempts
 *   GET /api/admin/calls/funnel-vital  — dashboard Calls vital counts + pre-formatted subline
 *
 * Auth is enforced upstream by the `/api/admin/` gate in src/index.ts (threads a
 * verified admin SessionRecord into ctx.session); the `if (!ctx.session)` guard
 * mirrors the existing admin handlers (belt-and-suspenders).
 *
 * NOTE on the eligibility predicate (deviation flagged in the step-2 report):
 * spec §5.1 lists `do_not_call IS NULL OR do_not_call=0` as part of the filter,
 * but `calling_list_item` has NO do_not_call column — that flag lives only on the
 * `lead` table (migration 0009). Referencing it would be a runtime "no such column"
 * error. It is OMITTED here. At the card layer, do-not-call suppression is already
 * achieved by card_status: a DNC'd card leaves 'pending'/'in_progress' (becomes
 * 'dead'/'disqualified' via the log endpoint), so the card_status filter already
 * excludes it. Revisit if a card-level do_not_call column is later added.
 */

const QUEUE_MODES = new Set(['cold', 'callbacks', 'mixed']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PRIOR_ATTEMPTS_LIMIT = 5;

// A card is workable only while pending or in_progress (done/dead/disqualified/
// promoted cards are out of the calling pool).
const BASE_ELIGIBLE = `card_status IN ('pending', 'in_progress')`;
// next_action_date is contractually 'YYYY-MM-DD' (migration 0021), so a plain
// lexical compare against date('now') is correct and matches the spec's SQL.
const COLD_PREDICATE = `attempt_count = 0`;
const CALLBACK_PREDICATE = `attempt_count > 0 AND next_action_date IS NOT NULL AND next_action_date <= date('now')`;

type CardRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  source: string | null;
  imported_at: string;
  notes: string | null;
  call_date: string;
  card_status: string;
  attempt_count: number;
  next_action_date: string | null;
  last_outcome: string | null;
};

type CardActivityRow = {
  id: string;
  outcome: string | null;
  notes: string | null;
  attempt_number: number;
  created_at: string;
};

const CARD_COLUMNS = `id, company_name, contact_name, contact_email, contact_phone,
  industry, source, imported_at, notes, call_date,
  card_status, attempt_count, next_action_date, last_outcome`;

// ─── 1. Queue ──────────────────────────────────────────────────────────────

export async function callsQueueHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(ctx.request.url);

  const mode = url.searchParams.get('mode') ?? 'mixed';
  if (!QUEUE_MODES.has(mode)) return json({ error: 'invalid_mode' }, { status: 400 });

  // industry: exact, case-sensitive match (the CSV import is case-sensitive, so
  // SQLite's default binary collation `=` is exactly right — no LOWER()).
  const industryRaw = url.searchParams.get('industry');
  const industry = industryRaw !== null && industryRaw.trim() !== '' ? industryRaw : null;

  const limit = clampLimit(url.searchParams.get('limit'));

  // Mode → eligibility clause + ORDER BY.
  let modeClause: string;
  let orderBy: string;
  if (mode === 'cold') {
    modeClause = COLD_PREDICATE;
    orderBy = `imported_at ASC`;
  } else if (mode === 'callbacks') {
    modeClause = CALLBACK_PREDICATE;
    orderBy = `next_action_date ASC, attempt_count ASC`;
  } else {
    // mixed: union of cold + callbacks.
    modeClause = `((${COLD_PREDICATE}) OR (${CALLBACK_PREDICATE}))`;
    // Fresh cold first (by imported_at), then callbacks (by next_action_date, then
    // attempt_count). The CASE splits the two groups; the second CASE applies the
    // per-group primary sort key; trailing keys are stable tiebreakers.
    orderBy = `CASE WHEN attempt_count = 0 THEN 0 ELSE 1 END ASC,
      CASE WHEN attempt_count = 0 THEN imported_at ELSE next_action_date END ASC,
      attempt_count ASC,
      imported_at ASC`;
  }

  const binds: unknown[] = [];
  let industryClause = '';
  if (industry !== null) {
    industryClause = ` AND industry = ?`;
    binds.push(industry);
  }
  binds.push(limit);

  const res = await ctx.env.DB.prepare(
    `SELECT ${CARD_COLUMNS}
       FROM calling_list_item
      WHERE ${BASE_ELIGIBLE}
        AND ${modeClause}${industryClause}
      ORDER BY ${orderBy}
      LIMIT ?`,
  )
    .bind(...binds)
    .all<CardRow>();

  const cards = res.results ?? [];

  // prior_attempts: a separate small SELECT per card (last 5 card_activity rows,
  // newest first). Clearer than one mega-JOIN, and N is small (<= limit <= 200).
  const withAttempts = await Promise.all(
    cards.map(async (card) => {
      const attemptsRes = await ctx.env.DB.prepare(
        `SELECT id, outcome, notes, attempt_number, created_at
           FROM card_activity
          WHERE calling_list_item_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(card.id, PRIOR_ATTEMPTS_LIMIT)
        .all<CardActivityRow>();
      return {
        ...card,
        prior_attempts: attemptsRes.results ?? [],
      };
    }),
  );

  return json({
    mode,
    industry_filter: industry,
    count: withAttempts.length,
    cards: withAttempts,
  });
}

function clampLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// ─── 2. Funnel vital ───────────────────────────────────────────────────────

type FunnelVitalRow = {
  count: number | null;
  never_called_count: number | null;
  callbacks_due_today_count: number | null;
};

export async function callsFunnelVitalHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const row = await ctx.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN card_status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS count,
       SUM(CASE WHEN card_status IN ('pending', 'in_progress') AND attempt_count = 0 THEN 1 ELSE 0 END) AS never_called_count,
       SUM(CASE WHEN card_status IN ('pending', 'in_progress') AND attempt_count > 0
                  AND next_action_date IS NOT NULL AND next_action_date <= date('now')
                THEN 1 ELSE 0 END) AS callbacks_due_today_count
     FROM calling_list_item`,
  ).first<FunnelVitalRow>();

  const count = row?.count ?? 0;
  const neverCalled = row?.never_called_count ?? 0;
  const callbacksDue = row?.callbacks_due_today_count ?? 0;

  return json({
    count,
    never_called_count: neverCalled,
    callbacks_due_today_count: callbacksDue,
    subline: `${neverCalled} never called · ${callbacksDue} callbacks due today`,
  });
}

// ─── 3. Call log (spec §5.2) ─────────────────────────────────────────────────
//
// POST /api/admin/calls/:id/log — record a call outcome and apply the operator's
// next-move (pass | retry | promote | book) in ONE atomic DB.batch. The whole
// transaction shape lives in lib/calls-tx.ts (buildCardLogTransaction); this
// handler does request validation + the workability read, then runs + reports.
//
// Notes deviation flagged in the step-4 report: the legacy `status` column is left
// untouched — the calls layer is governed by card_status, and the spec's UPDATE
// list (attempt_count, last_outcome, next_action_date, card_status) doesn't include
// it. Old surfaces reading `status` are retired in step 6.

// 9 outcomes (spec §4.4 — includes the 9th, 'spoke_interested').
const LOG_OUTCOMES = new Set([
  'voicemail',
  'no_answer',
  'gatekeeper',
  'spoke_qualified',
  'spoke_interested',
  'spoke_callback_later',
  'spoke_not_interested',
  'wrong_number',
  'disconnected',
]);
const LOG_NEXT_MOVES = new Set<CardLogNextMove>(['pass', 'retry', 'promote', 'book']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTES_MAX = 2000;

// A card is loggable only while pending or in_progress (mirrors the queue's
// BASE_ELIGIBLE — done/dead/disqualified/promoted cards are terminal).
const WORKABLE = new Set(['pending', 'in_progress']);

export async function callsLogHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const outcome = typeof body['outcome'] === 'string' ? body['outcome'] : '';
  if (!LOG_OUTCOMES.has(outcome)) return json({ error: 'invalid_outcome' }, { status: 400 });

  const nextMove = (typeof body['next_move'] === 'string' ? body['next_move'] : '') as CardLogNextMove;
  if (!LOG_NEXT_MOVES.has(nextMove)) return json({ error: 'invalid_next_move' }, { status: 400 });

  // next_action_date: required for retry, must be absent/null otherwise.
  const nextActionRaw =
    typeof body['next_action_date'] === 'string' ? body['next_action_date'].trim() : null;
  if (nextMove === 'retry') {
    if (!nextActionRaw) return json({ error: 'next_action_date_required' }, { status: 400 });
    if (!ISO_DATE.test(nextActionRaw)) {
      return json({ error: 'invalid_next_action_date' }, { status: 400 });
    }
  } else if (nextActionRaw) {
    return json({ error: 'next_action_date_not_allowed' }, { status: 400 });
  }

  // scheduled_at: required on book, must be a valid ISO datetime in the future.
  // Ignored (forced null) for every other next_move.
  let scheduledAt: string | null = null;
  if (nextMove === 'book') {
    const raw = typeof body['scheduled_at'] === 'string' ? body['scheduled_at'].trim() : '';
    if (!raw) return json({ error: 'scheduled_at_required' }, { status: 400 });
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) {
      return json({ error: 'invalid_scheduled_at' }, { status: 400 });
    }
    if (when.getTime() <= Date.now()) {
      return json({ error: 'scheduled_at_must_be_future' }, { status: 400 });
    }
    scheduledAt = when.toISOString();
  }

  // notes: required when a human conversation happened (spoke_* outcomes).
  const notes = typeof body['notes'] === 'string' ? body['notes'].trim() : null;
  if (outcome.startsWith('spoke_') && !notes) {
    return json({ error: 'notes_required' }, { status: 400 });
  }
  if (notes && notes.length > NOTES_MAX) {
    return json({ error: 'notes_too_long', limit: NOTES_MAX }, { status: 400 });
  }

  // card_dwell_ms: optional, integer >= 0.
  let cardDwellMs: number | null = null;
  if (body['card_dwell_ms'] !== undefined && body['card_dwell_ms'] !== null) {
    const n = body['card_dwell_ms'];
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      return json({ error: 'invalid_card_dwell_ms' }, { status: 400 });
    }
    cardDwellMs = n;
  }

  const scriptVariantId =
    typeof body['script_variant_id'] === 'string' && body['script_variant_id'].trim() !== ''
      ? body['script_variant_id'].trim()
      : null;

  // Load the card + assert workability.
  const card = await ctx.env.DB.prepare(
    `SELECT id, company_name, contact_name, contact_email, contact_phone,
            industry, source, imported_at, notes, attempt_count, card_status
       FROM calling_list_item WHERE id = ?`,
  )
    .bind(id)
    .first<CardLogCardRow & { card_status: string }>();
  if (!card) return json({ error: 'not_found' }, { status: 404 });
  if (!WORKABLE.has(card.card_status)) {
    return json({ error: 'card_not_workable', card_status: card.card_status }, { status: 409 });
  }

  // Validate the script variant exists (only if one was sent).
  if (scriptVariantId) {
    const v = await ctx.env.DB.prepare(`SELECT id FROM script_variant WHERE id = ?`)
      .bind(scriptVariantId)
      .first<{ id: string }>();
    if (!v) return json({ error: 'invalid_script_variant' }, { status: 400 });
  }

  const actor = { id: ctx.session.subjectId, ip: ctx.session.ipAddress, ua: ctx.session.userAgent };
  const build = buildCardLogTransaction(
    ctx.env,
    card,
    {
      outcome,
      nextMove,
      nextActionDate: nextMove === 'retry' ? nextActionRaw : null,
      notes,
      scriptVariantId,
      cardDwellMs,
      scheduledAt,
    },
    actor,
  );

  await ctx.env.DB.batch(build.statements);

  return json({
    ok: true,
    card_status: build.cardStatus,
    lead_id: build.leadId,
    opportunity_id: build.opportunityId,
    assessment_id: build.assessmentId,
  });
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

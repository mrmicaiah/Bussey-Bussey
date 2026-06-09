import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

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

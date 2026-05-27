import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * Studio44 Layer 2 — Prospect-workspace READ endpoints (spec §5).
 *
 *   GET /api/admin/prospects        — operator-language list of prospects
 *   GET /api/admin/prospects/:id     — one prospect's workspace (assessment thread + current notes)
 *
 * READ-ONLY. No handler here performs any INSERT / UPDATE / DELETE — the writes
 * (assessment save, complete-dig, complete-pitch/handoff, demo-spec edit) are
 * steps 4–6. Auth is enforced upstream by the `/api/admin/` gate in src/index.ts
 * (verified admin SessionRecord threaded into ctx.session); the `if (!ctx.session)`
 * guard mirrors the existing admin reads.
 *
 * Operator language: a "prospect" is, in plumbing terms, a client with
 * status='prospect' joined to its open opportunity (exactly what Layer 1 booking
 * creates). The operator only ever sees "prospect" / "assessments" — the
 * opportunity id is carried as the workspace key (`id`) but never labelled
 * client/opportunity/proposal in operator-facing fields.
 */

type AssessmentRow = {
  id: string;
  opportunity_id: string;
  scheduled_at: string;
  status: string;
  outcome_notes: string | null;
  sequence_number: number;
  booked_from_activity_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  mode: string;
  mode_flipped_at: string | null;
  notes_heard_learned: string | null;
  notes_research_needed: string | null;
  notes_loose: string | null;
  build_what: string | null;
  build_emphasize: string | null;
  build_ignore: string | null;
  build_to_price: string | null;
  build_notes: string | null;
};

// ─── 1. Prospects list ─────────────────────────────────────────────────────
//
// A prospect = client(status='prospect') JOIN its open opportunity (one row per
// open opportunity). assessment_count is a subquery; next_appointment_at is the
// soonest still-upcoming booked assessment. Ordered soonest-appointment-first
// (nulls last), then most-recently-created prospect.

export async function listProspectsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const now = new Date().toISOString();

  const res = await ctx.env.DB.prepare(
    `SELECT
       o.id                 AS id,
       c.company_name       AS company,
       c.primary_contact_name AS contact,
       c.industry           AS industry,
       o.created_at         AS started_at,
       (SELECT COUNT(*) FROM assessment a WHERE a.opportunity_id = o.id) AS assessment_count,
       (SELECT MIN(a2.scheduled_at) FROM assessment a2
          WHERE a2.opportunity_id = o.id AND a2.status = 'booked' AND a2.scheduled_at >= ?)
                            AS next_appointment_at
     FROM client c
     JOIN opportunity o ON o.client_id = c.id AND o.status = 'open'
     WHERE c.status = 'prospect'
     ORDER BY (next_appointment_at IS NULL) ASC, next_appointment_at ASC, o.created_at DESC
     LIMIT 200`,
  )
    .bind(now)
    .all<{
      id: string;
      company: string;
      contact: string | null;
      industry: string | null;
      started_at: string;
      assessment_count: number;
      next_appointment_at: string | null;
    }>();

  return json({ prospects: res.results ?? [] });
}

// ─── 2. Prospect workspace ───────────────────────────────────────────────────
//
// :id is the opportunity id (the workspace key the list returns). Returns the
// assessment thread, the current assessment's full structured notes, the next
// booked appointment, and the handoff containers (demo_spec + proposal) — which
// are null/absent until step 6 creates them.

export async function getProspectWorkspaceHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const oppId = ctx.params['id'];
  if (!oppId) return json({ error: 'invalid_id' }, { status: 400 });

  // Resolve the prospect via opportunity → client.
  const opp = await ctx.env.DB.prepare(
    `SELECT id, client_id, created_at FROM opportunity WHERE id = ?`,
  )
    .bind(oppId)
    .first<{ id: string; client_id: string; created_at: string }>();
  if (!opp) return json({ error: 'not_found' }, { status: 404 });

  const client = await ctx.env.DB.prepare(
    `SELECT id, company_name, primary_contact_name, industry, created_at FROM client WHERE id = ?`,
  )
    .bind(opp.client_id)
    .first<{
      id: string;
      company_name: string;
      primary_contact_name: string | null;
      industry: string | null;
      created_at: string;
    }>();
  if (!client) return json({ error: 'not_found' }, { status: 404 });

  // The assessment thread (ordered by sequence_number).
  const threadRes = await ctx.env.DB.prepare(
    `SELECT * FROM assessment WHERE opportunity_id = ? ORDER BY sequence_number ASC`,
  )
    .bind(oppId)
    .all<AssessmentRow>();
  const rows = threadRes.results ?? [];

  const thread = rows.map((a) => ({
    id: a.id,
    sequence_number: a.sequence_number,
    mode: a.mode,
    status: a.status,
    scheduled_at: a.scheduled_at,
    mode_flipped_at: a.mode_flipped_at,
    summary: summarize(a),
  }));

  // Current assessment: the in-progress one (latest by sequence), else the soonest
  // booked one (by scheduled_at). Full structured notes.
  const inProgress = rows
    .filter((a) => a.status === 'in_progress')
    .sort((x, y) => y.sequence_number - x.sequence_number)[0];
  const soonestBooked = rows
    .filter((a) => a.status === 'booked')
    .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
  const current = inProgress ?? soonestBooked ?? null;

  const current_assessment = current
    ? {
        id: current.id,
        sequence_number: current.sequence_number,
        scheduled_at: current.scheduled_at,
        status: current.status,
        mode: current.mode,
        mode_flipped_at: current.mode_flipped_at,
        outcome_notes: current.outcome_notes,
        notes_heard_learned: current.notes_heard_learned,
        notes_research_needed: current.notes_research_needed,
        notes_loose: current.notes_loose,
        build_what: current.build_what,
        build_emphasize: current.build_emphasize,
        build_ignore: current.build_ignore,
        build_to_price: current.build_to_price,
        build_notes: current.build_notes,
      }
    : null;

  // Next upcoming booked appointment (may coincide with current if current is a
  // future booked one — the UI dedups; we return it cleanly either way).
  const now = new Date().toISOString();
  const upcoming = rows
    .filter((a) => a.status === 'booked' && a.scheduled_at >= now)
    .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
  const next_appointment = upcoming ? { id: upcoming.id, scheduled_at: upcoming.scheduled_at } : null;

  // Handoff containers — usually absent until step 6. Return null cleanly.
  const demoRow = await ctx.env.DB.prepare(
    `SELECT id, status, body, author_kind FROM demo_spec WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(oppId)
    .first<{ id: string; status: string; body: string | null; author_kind: string }>();
  const demo_spec = demoRow ?? null;

  const proposalRow = await ctx.env.DB.prepare(
    `SELECT id, status, setup_total, monthly_total FROM proposal
       WHERE opportunity_id = ?
       ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1`,
  )
    .bind(oppId)
    .first<{ id: string; status: string; setup_total: number; monthly_total: number }>();
  // Include the proposal's line items (for the handoff view's seeded-line-item list).
  let proposal: {
    id: string;
    status: string;
    setup_total: number;
    monthly_total: number;
    line_items: { id: string; component_code: string; description_override: string | null; line_total: number }[];
  } | null = null;
  if (proposalRow) {
    const liRes = await ctx.env.DB.prepare(
      `SELECT id, component_code, description_override, line_total FROM proposal_line_item
         WHERE proposal_id = ? ORDER BY created_at ASC`,
    )
      .bind(proposalRow.id)
      .all<{ id: string; component_code: string; description_override: string | null; line_total: number }>();
    proposal = { ...proposalRow, line_items: liRes.results ?? [] };
  }

  const daysInFunnel = Math.max(
    0,
    Math.floor((Date.now() - new Date(opp.created_at).getTime()) / (1000 * 60 * 60 * 24)),
  );

  return json({
    prospect: {
      id: opp.id, // opportunity id — the workspace key (plumbing; never labelled to the operator)
      client_id: client.id, // plumbing — used to route into the existing proposal editor; not operator-facing
      company: client.company_name,
      contact: client.primary_contact_name,
      industry: client.industry,
      days_in_funnel: daysInFunnel,
    },
    thread,
    current_assessment,
    next_appointment,
    demo_spec,
    proposal,
  });
}

// ─── helpers ──────────────────────────────────────────────────────────────

// One-line thread summary: first line of the lead-capture field for the mode —
// notes_heard_learned (dig) or build_what (build_pitch). Null when empty.
function summarize(a: AssessmentRow): string | null {
  const src = a.mode === 'build_pitch' ? a.build_what : a.notes_heard_learned;
  return firstLine(src);
}

function firstLine(text: string | null, max = 90): string | null {
  if (!text) return null;
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

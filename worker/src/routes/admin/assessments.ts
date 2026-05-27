import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { auditStatement, type AuditEntry } from '../../lib/audit';

/**
 * Studio44 Layer 2 — assessment WRITE endpoints (spec §5).
 *
 *   PUT  /api/admin/assessments/:id               — save dig notes (+ booked→in_progress)
 *   POST /api/admin/assessments/:id/complete-dig  — complete a dig assessment + book the next
 *
 * PUT for the entity update matches the existing admin convention (updateLead/
 * updateClient/updateOpportunity are all PUT). complete-dig is a POST action verb
 * (mirrors disposition/activate/book). Each handler is ONE atomic DB.batch with the
 * audit inlined — the Layer 1 booking discipline. Server derives the next
 * assessment's opportunity_id / sequence_number / mode (never trusted from client).
 *
 * Dig mode only this step: build-pitch completion (the handoff) is step 6; the mode
 * flip is step 5. complete-dig rejects a build_pitch assessment.
 *
 * Auth: the /api/admin/ gate threads ctx.session; the if (!ctx.session) guard mirrors
 * the existing admin writes.
 */

const DIG_FIELDS = ['notes_heard_learned', 'notes_research_needed', 'notes_loose'] as const;
const BUILD_FIELDS = ['build_what', 'build_emphasize', 'build_ignore', 'build_to_price', 'build_notes'] as const;
// All note columns — the save accepts whichever are present (the frontend only sends
// the active mode's fields, so prior-mode notes are never touched). Forward-only is
// enforced on the `mode` transition below, not by restricting which fields persist.
const ALL_NOTE_FIELDS = [...DIG_FIELDS, ...BUILD_FIELDS] as const;
const MODES = new Set(['dig', 'build_pitch']);

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

// ─── Save assessment notes + mode flip (PUT) ───────────────────────────────────
//
// Updates whichever note fields are present (3 dig + 5 build-pitch) and — on the
// first save — transitions status booked → in_progress. Also handles the FORWARD-ONLY
// mode flip: an incoming mode='build_pitch' on a dig assessment stamps mode='build_pitch'
// + mode_flipped_at=now (server-side); build_pitch → dig is rejected 409. The flip
// rides along with the save (no separate endpoint). One DB.batch: [UPDATE assessment,
// audit notes_saved, (+ audit flipped_to_pitch on flip)].

export async function saveAssessmentNotesHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const cur = await ctx.env.DB.prepare(`SELECT id, status, mode FROM assessment WHERE id = ?`)
    .bind(id)
    .first<{ id: string; status: string; mode: string }>();
  if (!cur) return json({ error: 'not_found' }, { status: 404 });

  // The mode flip (forward-only). An incoming mode='build_pitch' on a dig assessment
  // IS the flip: stamp mode_flipped_at server-side. build_pitch → dig is rejected.
  let flip = false;
  const now = new Date().toISOString();
  if (Object.prototype.hasOwnProperty.call(body, 'mode')) {
    const incoming = typeof body['mode'] === 'string' ? body['mode'] : '';
    if (!MODES.has(incoming)) return json({ error: 'invalid_mode' }, { status: 400 });
    if (incoming === 'dig' && cur.mode === 'build_pitch') {
      return json({ error: 'mode_flip_is_forward_only' }, { status: 409 }); // can't revert to dig
    }
    if (incoming === 'build_pitch' && cur.mode === 'dig') flip = true;
    // incoming === cur.mode → no-op (don't re-stamp mode_flipped_at)
  }

  const setParts: string[] = [];
  const binds: unknown[] = [];
  const changedFields: string[] = [];
  for (const f of ALL_NOTE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      setParts.push(`${f} = ?`);
      binds.push(stringOrNull(body[f]));
      changedFields.push(f);
    }
  }
  const transition = cur.status === 'booked';
  if (transition) setParts.push(`status = 'in_progress'`);
  if (flip) {
    setParts.push(`mode = 'build_pitch'`);
    setParts.push(`mode_flipped_at = ?`);
    binds.push(now); // server-stamped — the client cannot set mode_flipped_at
  }

  if (setParts.length > 0) {
    binds.push(id);
    const stmts = [
      ctx.env.DB.prepare(`UPDATE assessment SET ${setParts.join(', ')} WHERE id = ?`).bind(...binds),
      auditStatement(ctx.env, {
        actorType: 'admin_user',
        actorId: ctx.session.subjectId,
        action: 'assessment.notes_saved',
        entityType: 'assessment',
        entityId: id,
        changes: {
          fields: changedFields,
          status: transition ? { from: 'booked', to: 'in_progress' } : undefined,
          flipped_to_pitch: flip || undefined,
        },
        ipAddress: ctx.session.ipAddress,
        userAgent: ctx.session.userAgent,
      }),
    ];
    if (flip) {
      stmts.push(
        auditStatement(ctx.env, {
          actorType: 'admin_user',
          actorId: ctx.session.subjectId,
          action: 'assessment.flipped_to_pitch',
          entityType: 'assessment',
          entityId: id,
          changes: { mode: { from: 'dig', to: 'build_pitch' }, mode_flipped_at: now },
          ipAddress: ctx.session.ipAddress,
          userAgent: ctx.session.userAgent,
        }),
      );
    }
    await ctx.env.DB.batch(stmts);
  }

  const row = await ctx.env.DB.prepare(`SELECT * FROM assessment WHERE id = ?`).bind(id).first<AssessmentRow>();
  return json({ ok: true, assessment: shapeAssessment(row!) });
}

// ─── Complete a dig assessment + book the next (POST) ───────────────────────────
//
// The dig loop discipline: completing requires the next appointment's datetime. One
// DB.batch:
//   1. UPDATE current → status='completed' (+ any final notes in the payload)
//   2. INSERT the next assessment (status='booked', mode='dig', sequence_number+1,
//      scheduled_at from payload) — opportunity_id/sequence/mode derived server-side
//   3. audit 'assessment.completed'  (current)
//   4. audit 'assessment.booked'     (next)
// Rejects a non-dig assessment (build-pitch completion is the step-6 handoff) and an
// already-completed/canceled one.

export async function completeDigHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const body = (await readJsonObject(ctx.request)) ?? {};
  const scheduledAt = stringOrNull(body['scheduled_at']);
  if (!scheduledAt) return json({ error: 'scheduled_at_required' }, { status: 400 });

  const cur = await ctx.env.DB.prepare(
    `SELECT id, opportunity_id, status, mode, sequence_number FROM assessment WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; opportunity_id: string; status: string; mode: string; sequence_number: number }>();
  if (!cur) return json({ error: 'not_found' }, { status: 404 });

  if (cur.mode !== 'dig') {
    return json({ error: 'not_dig_mode' }, { status: 409 }); // build-pitch completion is the handoff (step 6)
  }
  if (cur.status === 'completed' || cur.status === 'canceled') {
    return json({ error: 'not_completable', status: cur.status }, { status: 409 });
  }

  const now = new Date().toISOString();
  const nextId = crypto.randomUUID();
  const nextSeq = cur.sequence_number + 1;
  const actor = { id: ctx.session.subjectId, ip: ctx.session.ipAddress, ua: ctx.session.userAgent };

  // 1. Complete the current assessment (+ optional final dig notes).
  const setParts: string[] = [`status = 'completed'`];
  const binds: unknown[] = [];
  const finalFields: string[] = [];
  for (const f of DIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      setParts.push(`${f} = ?`);
      binds.push(stringOrNull(body[f]));
      finalFields.push(f);
    }
  }
  binds.push(id);

  const stmts = [
    ctx.env.DB.prepare(`UPDATE assessment SET ${setParts.join(', ')} WHERE id = ?`).bind(...binds),
    // 2. Book the next dig assessment (server-derived opportunity/sequence/mode).
    ctx.env.DB.prepare(
      `INSERT INTO assessment (id, opportunity_id, scheduled_at, status, sequence_number, mode, created_by_user_id)
       VALUES (?, ?, ?, 'booked', ?, 'dig', ?)`,
    ).bind(nextId, cur.opportunity_id, scheduledAt, nextSeq, actor.id),
  ] as ReturnType<typeof ctx.env.DB.prepare>[];

  const audits: AuditEntry[] = [
    {
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'assessment.completed',
      entityType: 'assessment',
      entityId: id,
      changes: {
        status: { from: cur.status, to: 'completed' },
        mode: 'dig',
        final_notes_saved: finalFields,
        next_assessment_id: nextId,
      },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    },
    {
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'assessment.booked',
      entityType: 'assessment',
      entityId: nextId,
      changes: {
        opportunity_id: cur.opportunity_id,
        sequence_number: nextSeq,
        mode: 'dig',
        scheduled_at: scheduledAt,
        from_assessment_id: cur.id,
        booked_at: now,
      },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    },
  ];
  for (const a of audits) stmts.push(auditStatement(ctx.env, a));

  await ctx.env.DB.batch(stmts);

  return json({ ok: true, completed_assessment_id: id, next_assessment_id: nextId });
}

// ─── helpers ──────────────────────────────────────────────────────────────

function shapeAssessment(r: AssessmentRow) {
  return {
    id: r.id,
    sequence_number: r.sequence_number,
    scheduled_at: r.scheduled_at,
    status: r.status,
    mode: r.mode,
    mode_flipped_at: r.mode_flipped_at,
    outcome_notes: r.outcome_notes,
    notes_heard_learned: r.notes_heard_learned,
    notes_research_needed: r.notes_research_needed,
    notes_loose: r.notes_loose,
    build_what: r.build_what,
    build_emphasize: r.build_emphasize,
    build_ignore: r.build_ignore,
    build_to_price: r.build_to_price,
    build_notes: r.build_notes,
  };
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

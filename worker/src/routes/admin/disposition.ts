import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit, auditStatement } from '../../lib/audit';

/**
 * POST /api/admin/opportunities/:id/disposition
 *
 * Captures the outcome of presenting a proposal. Three kinds handled here per
 * spec 06 — followup, changes, declined. The fourth disposition, `accepted`,
 * is handled by POST /api/admin/opportunities/:id/activate (step I): the
 * transactional activation flow needs its own endpoint because it returns
 * a one-time credentials payload that this endpoint's shape doesn't carry.
 *
 *   - followup  — schedules the next contact, optional notes
 *   - changes   — captures the requested-changes note and returns admin to the calculator
 *   - declined  — opportunity → lost (with reason), current proposal → declined
 */

// Canonical closed enum for the No-deal path (Presentation room step 2). ORDER
// MATTERS — it mirrors the disposition tab's pill order. Validation is API-side
// only; there is deliberately no DB-level CHECK on opportunity.lost_reason
// (migration 0020 leaves historical edge cases as 'other').
const DECLINED_REASONS = ['price', 'timing', 'not_a_fit', 'went_with_competitor', 'silent', 'other'] as const;
const LOST_NOTES_MAX = 2000;

type OpportunityRow = {
  id: string;
  client_id: string;
  status: string;
  notes: string | null;
};

type ProposalRow = {
  id: string;
  status: string;
};

function appendNote(existing: string | null, addition: string | null | undefined): string | null {
  const a = addition?.trim();
  if (!a) return existing;
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${a}`;
  return existing ? `${existing}\n\n${entry}` : entry;
}

async function pickCurrentProposal(env: HandlerContext['env'], opportunityId: string): Promise<ProposalRow | null> {
  return env.DB.prepare(
    `SELECT id, status FROM proposal WHERE opportunity_id = ? AND status IN ('draft', 'sent', 'accepted') ORDER BY
       CASE status WHEN 'accepted' THEN 1 WHEN 'sent' THEN 2 WHEN 'draft' THEN 3 END,
       created_at DESC LIMIT 1`,
  )
    .bind(opportunityId)
    .first<ProposalRow>();
}

export async function captureDisposition(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const oppId = ctx.params['id'];
  if (!oppId) return json({ error: 'invalid_id' }, { status: 400 });

  const body = (await readJsonObject(ctx.request)) ?? {};
  const kind = typeof body['kind'] === 'string' ? body['kind'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : null;

  const opp = await ctx.env.DB.prepare(`SELECT id, client_id, status, notes FROM opportunity WHERE id = ?`)
    .bind(oppId)
    .first<OpportunityRow>();
  if (!opp) return json({ error: 'not_found' }, { status: 404 });

  const actorId = ctx.session.subjectId;
  const ip = ctx.session.ipAddress;
  const ua = ctx.session.userAgent;

  if (kind === 'accepted') {
    return json(
      {
        error: 'use_activate_endpoint',
        message:
          'Send POST /api/admin/opportunities/:id/activate for the accepted disposition (returns one-time credentials).',
      },
      { status: 400 },
    );
  }

  if (kind === 'followup') {
    const next_followup_date =
      typeof body['next_followup_date'] === 'string' ? body['next_followup_date'].trim() : '';
    if (!next_followup_date) return json({ error: 'next_followup_date_required' }, { status: 400 });
    const newNotes = appendNote(opp.notes, notes ? `Follow-up: ${notes}` : 'Follow-up scheduled.');
    await ctx.env.DB.prepare(`UPDATE opportunity SET next_followup_date = ?, notes = ? WHERE id = ?`)
      .bind(next_followup_date, newNotes, oppId)
      .run();
    await writeAudit(ctx.env, {
      actorType: 'admin_user',
      actorId,
      action: 'opportunity.disposition.followup',
      entityType: 'opportunity',
      entityId: oppId,
      changes: { next_followup_date, note_added: notes ?? null },
      ipAddress: ip,
      userAgent: ua,
    });
    return json({ ok: true, kind: 'followup' });
  }

  if (kind === 'changes') {
    const newNotes = appendNote(opp.notes, notes ? `Changes requested: ${notes}` : 'Changes requested by client.');
    await ctx.env.DB.prepare(`UPDATE opportunity SET notes = ? WHERE id = ?`).bind(newNotes, oppId).run();
    await writeAudit(ctx.env, {
      actorType: 'admin_user',
      actorId,
      action: 'opportunity.disposition.changes_requested',
      entityType: 'opportunity',
      entityId: oppId,
      changes: { note_added: notes ?? null },
      ipAddress: ip,
      userAgent: ua,
    });
    return json({ ok: true, kind: 'changes' });
  }

  if (kind === 'declined') {
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (!(DECLINED_REASONS as readonly string[]).includes(reason)) {
      return json({ error: 'invalid_reason' }, { status: 400 });
    }
    // lost_notes — the No-deal sub-flow's composed free-form string. Distinct
    // from the activity-log line below (which the server stamps, not the client).
    const lostNotesRaw = typeof body['lost_notes'] === 'string' ? body['lost_notes'] : null;
    if (lostNotesRaw !== null && lostNotesRaw.length > LOST_NOTES_MAX) {
      return json({ error: 'lost_notes_too_long', limit: LOST_NOTES_MAX }, { status: 400 });
    }
    const lostNotes = lostNotesRaw && lostNotesRaw.trim() ? lostNotesRaw.trim() : null;
    const lostAt = new Date().toISOString();
    // Activity-log line is server-composed — the client never sends this string.
    const newNotes = appendNote(opp.notes, `Declined (${reason}).`);

    const currentProposal = await pickCurrentProposal(ctx.env, oppId);
    const declineProposal =
      !!currentProposal && (currentProposal.status === 'draft' || currentProposal.status === 'sent');

    // EVERYTHING atomic in ONE DB.batch: the opportunity update (status,
    // lost_reason, lost_notes, lost_at, activity note), the optional proposal
    // decline, and both audit rows. No split writes — a partial disposition
    // (status moved but audit missing, or vice-versa) must be impossible.
    const stmts = [
      ctx.env.DB.prepare(
        `UPDATE opportunity
            SET status = 'lost', lost_reason = ?, lost_notes = ?, lost_at = ?, notes = ?
          WHERE id = ?`,
      ).bind(reason, lostNotes, lostAt, newNotes, oppId),
    ];
    if (declineProposal) {
      stmts.push(
        ctx.env.DB.prepare(`UPDATE proposal SET status = 'declined' WHERE id = ?`).bind(currentProposal!.id),
      );
    }
    stmts.push(
      auditStatement(ctx.env, {
        actorType: 'admin_user',
        actorId,
        action: 'opportunity.disposition.declined',
        entityType: 'opportunity',
        entityId: oppId,
        changes: {
          reason,
          lost_notes: lostNotes,
          lost_at: lostAt,
          status: { from: opp.status, to: 'lost' },
          proposal_declined: declineProposal ? currentProposal!.id : null,
        },
        ipAddress: ip,
        userAgent: ua,
      }),
    );
    if (declineProposal) {
      stmts.push(
        auditStatement(ctx.env, {
          actorType: 'admin_user',
          actorId,
          action: 'proposal.declined',
          entityType: 'proposal',
          entityId: currentProposal!.id,
          changes: { status: { from: currentProposal!.status, to: 'declined' }, opportunity_id: oppId },
          ipAddress: ip,
          userAgent: ua,
        }),
      );
    }
    await ctx.env.DB.batch(stmts);

    return json({ ok: true, kind: 'declined', status: 'lost', lost_at: lostAt });
  }

  return json({ error: 'invalid_kind' }, { status: 400 });
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

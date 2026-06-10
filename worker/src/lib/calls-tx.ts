import type { Env } from '../types/env';
import type { AuditEntry } from './audit';
import { auditStatement } from './audit';
import type { AuditActor } from './tx';
import { buildClientCreate } from '../routes/admin/clients';
import { buildOpportunityCreate } from '../routes/admin/opportunities';

/**
 * Studio44 Calls layer — the call-log transaction core (spec §5.2-§5.4).
 *
 * Mirrors the composable-core pattern of buildClientCreate / buildOpportunityCreate
 * / buildProposalCreate in tx.ts: small, pure, returns a flat list of
 * D1PreparedStatement to be run in ONE atomic DB.batch by the thin route handler
 * (callsLogHandler). No request parsing, no DB reads — the caller validates the
 * body and loads the card, then hands a validated CardLogInput here.
 *
 * The four next-moves:
 *   - pass     → card_status='disqualified'. No lead.
 *   - retry    → card_status='pending', next_action_date set. No lead.
 *   - promote  → INSERT lead (source='calling_list', status='contacted') with the
 *                §5.3 promote preamble; card_status='promoted', promoted_lead_id set;
 *                mirror the call into lead_activity (keeps Layer 1's prior-attempts
 *                join working for the new lead).
 *   - book     → §5.4 short-circuit. INSERT lead (with the synthetic book preamble),
 *                then the Layer 1 booking cores (buildClientCreate +
 *                buildOpportunityCreate) sourced from the new lead, PLUS assessment #1
 *                (mode='dig', status='booked', booked_from_activity_id → the lead_activity
 *                mirror) — mirroring the Layer 1 lead→book transaction exactly. card_status=
 *                'promoted', BOTH promoted_lead_id and converted_lead_id point at the
 *                new lead (feature, not bug — §5.4); same lead_activity mirror.
 *
 * FK-safe statement ordering (D1 runs the batch sequentially in one transaction):
 *   1. card_activity INSERT       (FK → calling_list_item exists; script_variant validated)
 *   2. lead INSERT                (promote/book; precedes everything that FKs the lead)
 *   3. client INSERT (+ lead→converted)   (book; clientCore — FK origin_lead_id ✓)
 *   4. opportunity INSERT         (book; oppCore — FK client_id ✓)
 *   5. lead_activity mirror INSERT (promote/book; FK lead_id ✓)
 *   6. assessment #1 INSERT       (book; FK opportunity_id ✓, booked_from_activity_id → #5)
 *   7. calling_list_item UPDATE   (sets promoted_lead_id/converted_lead_id — lead exists)
 *   8. audit INSERTs              (polymorphic entity_id, no FK)
 */

export type CardLogCardRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  source: string | null;
  imported_at: string;
  notes: string | null;
  attempt_count: number;
};

export type CardLogNextMove = 'pass' | 'retry' | 'promote' | 'book';

export type CardLogInput = {
  outcome: string;
  nextMove: CardLogNextMove;
  /** Already normalized by the caller: the date string for retry, else null. */
  nextActionDate: string | null;
  notes: string | null;
  scriptVariantId: string | null;
  cardDwellMs: number | null;
  /** ISO 8601 datetime for the booked assessment; required + validated by the
   *  caller on next_move==='book', null otherwise. */
  scheduledAt: string | null;
};

export type CardLogBuild = {
  statements: D1PreparedStatement[];
  /** The card's new card_status after this log. */
  cardStatus: string;
  /** The new lead's id (promote/book), else null. */
  leadId: string | null;
  /** The new opportunity's id (book only), else null. */
  opportunityId: string | null;
  /** The booked assessment's id (book only), else null. */
  assessmentId: string | null;
  /** The card_activity row's id (always written). */
  activityId: string;
};

/** Today as YYYY-MM-DD (preamble timestamps; matches the wider codebase's slice). */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "imported 2026-06-09 via places_austin_law_pilot_2026_06" (source optional). */
function importedClause(card: CardLogCardRow): string {
  const impDate = card.imported_at ? card.imported_at.slice(0, 10) : 'unknown date';
  return card.source ? `imported ${impDate} via ${card.source}` : `imported ${impDate}`;
}

/** §5.3 — the promote-to-lead notes preamble. */
function promotePreamble(card: CardLogCardRow, input: CardLogInput): string {
  const attemptNumber = card.attempt_count + 1;
  const callLine = input.notes
    ? input.notes
    : `(${input.outcome}, no note)`;
  return (
    `Promoted from calling card (${importedClause(card)}).\n` +
    `Company: ${card.company_name}\n` +
    `Phone: ${card.contact_phone ?? '—'}\n` +
    `Industry: ${card.industry ?? '—'}\n` +
    `Card notes: ${card.notes ?? '—'}\n` +
    `Promoting call (${todayDate()}, attempt ${attemptNumber}): ${callLine}\n` +
    `\n` +
    `---\n` +
    `(operator's running thread starts below this line)`
  );
}

/** §5.4 — the synthetic "booked direct from card" preamble. */
function bookPreamble(card: CardLogCardRow, input: CardLogInput): string {
  const attemptNumber = card.attempt_count + 1;
  const callLine = input.notes ? `${input.notes} ` : '';
  return (
    `Booked direct from calling card (${importedClause(card)}).\n` +
    `Company: ${card.company_name}\n` +
    `Phone: ${card.contact_phone ?? '—'}\n` +
    `Industry: ${card.industry ?? '—'}\n` +
    `Card notes: ${card.notes ?? '—'}\n` +
    `Booking call (${todayDate()}, attempt ${attemptNumber}): ${callLine}Assessment booked directly from the card.\n` +
    `\n` +
    `---\n` +
    `(operator's running thread starts below this line)`
  );
}

export function buildCardLogTransaction(
  env: Env,
  card: CardLogCardRow,
  input: CardLogInput,
  actor: AuditActor,
): CardLogBuild {
  const attemptNumber = card.attempt_count + 1;
  const activityId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  const audits: AuditEntry[] = [];

  // 1. card_activity — only opener_variant_id is tracked (cold framework is the
  // shorter opener → qualifier → book/promote/pass; no hook/discovery/close).
  // phone_duration_s and session_id are future hooks (NULL for now, per task).
  statements.push(
    env.DB.prepare(
      `INSERT INTO card_activity
         (id, calling_list_item_id, kind, outcome, attempt_number, industry_at_time,
          opener_variant_id, hook_variant_id, discovery_variant_id, close_variant_id,
          card_dwell_ms, phone_duration_s, session_id, notes, created_by_user_id, created_at)
       VALUES (?, ?, 'call', ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, datetime('now'))`,
    ).bind(
      activityId,
      card.id,
      input.outcome,
      attemptNumber,
      card.industry,
      input.scriptVariantId,
      input.cardDwellMs,
      input.notes,
      actor.id,
    ),
  );

  let leadId: string | null = null;
  let opportunityId: string | null = null;
  let assessmentId: string | null = null;
  let cardStatus: string;
  let promotedLeadId: string | null = null;
  let convertedLeadId: string | null = null;
  // next_action_date is only meaningful on retry (caller already normalized it).
  const nextActionDate = input.nextMove === 'retry' ? input.nextActionDate : null;

  if (input.nextMove === 'pass') {
    cardStatus = 'disqualified';
  } else if (input.nextMove === 'retry') {
    cardStatus = 'pending';
  } else {
    // promote | book — both spawn a lead from the card's data.
    leadId = crypto.randomUUID();
    promotedLeadId = leadId;
    cardStatus = 'promoted';
    const leadNotes =
      input.nextMove === 'book' ? bookPreamble(card, input) : promotePreamble(card, input);

    // 2. lead INSERT — source/status match the legacy convert-to-lead path.
    statements.push(
      env.DB.prepare(
        `INSERT INTO lead (id, name, email, phone, company, industry, source, status, notes, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'calling_list', 'contacted', ?, ?)`,
      ).bind(
        leadId,
        card.contact_name,
        card.contact_email,
        card.contact_phone,
        card.company_name,
        card.industry,
        leadNotes,
        actor.id,
      ),
    );
    audits.push({
      actorType: 'admin_user',
      actorId: actor.id,
      action: 'lead.create.from_calling_card',
      entityType: 'lead',
      entityId: leadId,
      changes: {
        from_calling_list_item_id: card.id,
        source: 'calling_list',
        status: 'contacted',
        next_move: input.nextMove,
      },
      ipAddress: actor.ip,
      userAgent: actor.ua,
    });

    if (input.nextMove === 'book') {
      convertedLeadId = leadId;
      const companyName =
        card.company_name ?? card.contact_name ?? card.contact_email ?? 'Unknown company';

      // 3. client (+ flips the just-created lead to status='converted').
      const clientCore = buildClientCreate(
        env,
        {
          company_name: companyName,
          primary_contact_name: card.contact_name,
          primary_contact_email: card.contact_email,
          primary_contact_phone: card.contact_phone,
          industry: card.industry,
          billing_address: null,
          status: 'prospect',
          origin_lead_id: leadId,
          notes: `Auto-created on booking direct from calling card (${todayDate()}).`,
        },
        actor,
        'contacted',
      );
      // 4. opportunity (open) on the new client.
      const oppCore = buildOpportunityCreate(
        env,
        {
          client_id: clientCore.id, // known up-front; FK resolves within the batch
          name: `${companyName} — assessment`,
          description: null, // value columns left NULL (Alice, L4)
          owner_user_id: actor.id,
        },
        actor,
      );
      statements.push(...clientCore.statements, ...oppCore.statements);
      audits.push(...clientCore.audits, ...oppCore.audits);
      opportunityId = oppCore.id;
    }

    // 5. lead_activity mirror — so Layer 1's prior-attempts join works for the
    // new lead. Same shape/attribution as the card_activity row above. Its id is
    // the assessment's booked_from_activity_id anchor (book), exactly as Layer 1
    // links assessment #1 to the booking activity.
    const mirrorActivityId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `INSERT INTO lead_activity
           (id, lead_id, kind, outcome, attempt_number, industry_at_time,
            opener_variant_id, hook_variant_id, discovery_variant_id, close_variant_id,
            card_dwell_ms, phone_duration_s, session_id, notes, created_by_user_id)
         VALUES (?, ?, 'call', ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      ).bind(
        mirrorActivityId,
        leadId,
        input.outcome,
        attemptNumber,
        card.industry,
        input.scriptVariantId,
        input.cardDwellMs,
        input.notes,
        actor.id,
      ),
    );

    // 6. assessment #1 (book only). opportunityId is set in the book branch above.
    // mode='dig' + status='booked' match Layer 1's lead→book transaction; there is
    // no 'scheduled' status in the schema (CHECK is booked|in_progress|completed|
    // no_show|canceled|rescheduled), so 'booked' is the initial state. sequence_
    // number=1; booked_from_activity_id → the mirror activity above.
    if (input.nextMove === 'book' && opportunityId) {
      assessmentId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          `INSERT INTO assessment
             (id, opportunity_id, scheduled_at, status, mode, sequence_number,
              booked_from_activity_id, created_by_user_id, created_at)
           VALUES (?, ?, ?, 'booked', 'dig', 1, ?, ?, datetime('now'))`,
        ).bind(assessmentId, opportunityId, input.scheduledAt, mirrorActivityId, actor.id),
      );
      audits.push({
        actorType: 'admin_user',
        actorId: actor.id,
        action: 'assessment.create',
        entityType: 'assessment',
        entityId: assessmentId,
        changes: {
          opportunity_id: opportunityId,
          scheduled_at: input.scheduledAt,
          mode: 'dig',
          status: 'booked',
          sequence_number: 1,
          booked_from_activity_id: mirrorActivityId,
          from_calling_list_item_id: card.id,
        },
        ipAddress: actor.ip,
        userAgent: actor.ua,
      });
    }
  }

  // 6. calling_list_item UPDATE. COALESCE on the two FK columns so pass/retry
  // (both null) preserve any existing pointer; promote sets promoted_lead_id;
  // book sets both. next_action_date is overwritten outright (null off-retry).
  statements.push(
    env.DB.prepare(
      `UPDATE calling_list_item
          SET attempt_count = attempt_count + 1,
              last_outcome = ?,
              next_action_date = ?,
              card_status = ?,
              promoted_lead_id = COALESCE(?, promoted_lead_id),
              converted_lead_id = COALESCE(?, converted_lead_id)
        WHERE id = ?`,
    ).bind(input.outcome, nextActionDate, cardStatus, promotedLeadId, convertedLeadId, card.id),
  );

  // Card-level audit.
  audits.push({
    actorType: 'admin_user',
    actorId: actor.id,
    action: 'calling_list_item.card_logged',
    entityType: 'calling_list_item',
    entityId: card.id,
    changes: {
      activity_id: activityId,
      outcome: input.outcome,
      next_move: input.nextMove,
      attempt_number: attemptNumber,
      card_status: cardStatus,
      next_action_date: nextActionDate,
      promoted_lead_id: promotedLeadId,
      converted_lead_id: convertedLeadId,
      opportunity_id: opportunityId,
      assessment_id: assessmentId,
    },
    ipAddress: actor.ip,
    userAgent: actor.ua,
  });

  // 8. audit INSERTs last (no FK dependencies).
  for (const a of audits) statements.push(auditStatement(env, a));

  return { statements, cardStatus, leadId, opportunityId, assessmentId, activityId };
}

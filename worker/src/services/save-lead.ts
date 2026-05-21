import type { Env } from '../types/env';
import { writeAudit } from '../lib/audit';

/**
 * `save_lead` — the Claude tool used by the public chat to persist lead info.
 *
 * Behavior (from spec 03):
 *   - If no lead exists yet for this chat_session, create one. owner_user_id stays NULL
 *     because the chat itself has no admin user attached.
 *   - If a lead exists for this chat_session, MERGE the new info: only fill fields that
 *     are currently null. Never overwrite non-null fields. (Admins correct mistakes
 *     manually via the admin UI.)
 *   - After the write, if the lead now has a contact method (email OR phone) AND
 *     `notification_sent_at` is still null, return `should_notify: true` so the caller
 *     can fire the email. The actual email send is the caller's job — this service
 *     just persists.
 */

export type SaveLeadInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  industry?: string | null;
  pain_summary?: string | null;
  urgency?: 'immediate' | 'weeks' | 'months' | 'exploring' | null;
  additional_notes?: string | null;
};

export type SaveLeadResult = {
  lead_id: string;
  created: boolean;
  should_notify: boolean;
};

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
};

const VALID_URGENCY = new Set(['immediate', 'weeks', 'months', 'exploring']);

export async function saveLeadFromChat(
  env: Env,
  chatSessionId: string,
  input: SaveLeadInput,
): Promise<SaveLeadResult> {
  const existing = await env.DB.prepare(`SELECT * FROM lead WHERE origin_chat_session_id = ?`)
    .bind(chatSessionId)
    .first<LeadRow>();

  const cleaned = cleanInput(input);

  if (!existing) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO lead (id, name, email, phone, company, industry, source, origin_chat_session_id, pain_summary, urgency, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, 'chat', ?, ?, ?, ?, 'new')`,
    )
      .bind(
        id,
        cleaned.name,
        cleaned.email,
        cleaned.phone,
        cleaned.company,
        cleaned.industry,
        chatSessionId,
        cleaned.pain_summary,
        cleaned.urgency,
        cleaned.additional_notes,
      )
      .run();

    await writeAudit(env, {
      actorType: 'system',
      actorId: null,
      action: 'lead.create.from_chat',
      entityType: 'lead',
      entityId: id,
      changes: { ...cleaned, source: 'chat', origin_chat_session_id: chatSessionId },
    });

    return {
      lead_id: id,
      created: true,
      should_notify: hasContact(cleaned.email, cleaned.phone),
    };
  }

  // Merge: only overwrite null fields.
  const merged: Record<string, unknown> = {};
  for (const k of ['name', 'email', 'phone', 'company', 'industry', 'pain_summary', 'urgency'] as const) {
    if (existing[k] == null && cleaned[k] != null) merged[k] = cleaned[k];
  }
  // Notes from chat appends rather than overwriting if both present.
  if (cleaned.additional_notes) {
    merged['notes'] = existing.notes ? `${existing.notes}\n\n${cleaned.additional_notes}` : cleaned.additional_notes;
  }

  if (Object.keys(merged).length > 0) {
    const setClause = Object.keys(merged).map((k) => `${k} = ?`).join(', ');
    await env.DB.prepare(`UPDATE lead SET ${setClause} WHERE id = ?`)
      .bind(...Object.values(merged), existing.id)
      .run();

    await writeAudit(env, {
      actorType: 'system',
      actorId: null,
      action: 'lead.update.from_chat',
      entityType: 'lead',
      entityId: existing.id,
      changes: merged,
    });
  }

  const updatedRow = (await env.DB.prepare(`SELECT email, phone, notification_sent_at FROM lead WHERE id = ?`)
    .bind(existing.id)
    .first<{ email: string | null; phone: string | null; notification_sent_at: string | null }>()) ?? existing;

  const shouldNotify = hasContact(updatedRow.email, updatedRow.phone) && updatedRow.notification_sent_at == null;

  return { lead_id: existing.id, created: false, should_notify: shouldNotify };
}

/** Stamp `notification_sent_at` so we never re-fire the new-lead email. */
export async function markLeadNotified(env: Env, leadId: string): Promise<void> {
  await env.DB.prepare(`UPDATE lead SET notification_sent_at = ? WHERE id = ? AND notification_sent_at IS NULL`)
    .bind(new Date().toISOString(), leadId)
    .run();
}

function cleanInput(input: SaveLeadInput): {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  pain_summary: string | null;
  urgency: string | null;
  additional_notes: string | null;
} {
  return {
    name: trimmedOrNull(input.name),
    email: trimmedOrNull(input.email)?.toLowerCase() ?? null,
    phone: trimmedOrNull(input.phone),
    company: trimmedOrNull(input.company),
    industry: trimmedOrNull(input.industry),
    pain_summary: trimmedOrNull(input.pain_summary),
    urgency: input.urgency && VALID_URGENCY.has(input.urgency) ? input.urgency : null,
    additional_notes: trimmedOrNull(input.additional_notes),
  };
}

function trimmedOrNull(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function hasContact(email: string | null, phone: string | null): boolean {
  return Boolean(email || phone);
}

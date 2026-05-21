import type { Env } from '../types/env';

/**
 * Email service — Resend integration.
 *
 * Every send is recorded in `notification` regardless of outcome. If the
 * API key is the dev placeholder or sending fails, we still write a
 * notification row with `status='failed'` and an `error` payload so the
 * admin can see what didn't go out.
 */

export type EmailPayload = {
  kind:
    | 'new_lead'
    | 'walkthrough_complete'
    | 'change_order_proposed'
    | 'change_order_approved'
    | 'payment_succeeded'
    | 'payment_failed'
    | 'activation_credentials'
    | 'project_status_update'
    | 'other';
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  relatedEntity?: { type: string; id: string };
};

const RESEND_API = 'https://api.resend.com/emails';
const FROM_DEFAULT = 'Bussey and Bussey <noreply@busseyandbussey.com>';

export async function sendEmail(env: Env, payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
  const recipients = Array.isArray(payload.to) ? payload.to : payload.to.split(',').map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) {
    await recordNotification(env, payload, 'failed', 'no_recipients', null);
    return { ok: false, error: 'no_recipients' };
  }

  const isDevPlaceholder = !env.RESEND_API_KEY || env.RESEND_API_KEY === 're_replace_me';

  if (isDevPlaceholder) {
    // Don't try to hit Resend with a bogus key — record as queued so it's
    // visible in /api/admin/notifications and the admin can see what would
    // have shipped.
    await recordNotification(env, payload, 'queued', 'dev_placeholder_key_not_sent', recipients);
    console.log('[email:dev-placeholder]', payload.kind, 'to', recipients, 'subject:', payload.subject);
    return { ok: true };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_DEFAULT,
        to: recipients,
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      await recordNotification(env, payload, 'failed', `resend_${res.status}:${body.slice(0, 200)}`, recipients);
      return { ok: false, error: `resend_${res.status}` };
    }

    await recordNotification(env, payload, 'sent', null, recipients);
    return { ok: true };
  } catch (e) {
    await recordNotification(env, payload, 'failed', e instanceof Error ? e.message : String(e), recipients);
    return { ok: false, error: 'fetch_failed' };
  }
}

async function recordNotification(
  env: Env,
  payload: EmailPayload,
  status: 'queued' | 'sent' | 'failed',
  error: string | null,
  recipients: string[] | null,
): Promise<void> {
  const id = crypto.randomUUID();
  const recipient = recipients ? recipients.join(',') : Array.isArray(payload.to) ? payload.to.join(',') : payload.to;
  const sentAt = status === 'sent' ? new Date().toISOString() : null;
  await env.DB.prepare(
    `INSERT INTO notification (id, kind, recipient, channel, payload, status, error, sent_at)
     VALUES (?, ?, ?, 'email', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      payload.kind,
      recipient,
      JSON.stringify({
        subject: payload.subject,
        text: payload.text,
        relatedEntity: payload.relatedEntity ?? null,
      }),
      status,
      error,
      sentAt,
    )
    .run();
}

export function adminNotifyRecipients(env: Env): string[] {
  return env.ADMIN_NOTIFY_EMAILS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

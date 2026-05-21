import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { sendEmail } from '../../services/email';
import { writeAudit } from '../../lib/audit';
import { hashPassword } from '../../lib/password';
import {
  generateTempPassword,
  CREDENTIALS_TTL_SECONDS,
  CREDENTIALS_WINDOW_MS,
} from '../../lib/temp-password';

/**
 * Credentials handoff endpoints — paired with the activation flow (spec 07).
 *
 *   GET  /api/admin/opportunities/:id/credentials
 *     Returns the current re-display state. Within the 24-hour window the
 *     plaintext temp password is returned (admin can re-show the handoff
 *     modal). After the window, returns `{ available: false, reason: 'expired' }`.
 *
 *   POST /api/admin/opportunities/:id/reset-credentials
 *     Generates a fresh temp password, updates portal_account, bumps the
 *     credential timestamp, writes the new plaintext to KV with a fresh 24h
 *     TTL, and returns the new credentials. Available any time after
 *     activation — typical use is when the re-display window has expired.
 *
 *   POST /api/admin/opportunities/:id/send-credentials-email
 *     Sends the welcome email containing the portal URL, email, and the
 *     still-cached plaintext temp password. Returns 410 if the 24h re-display
 *     window has expired (admin needs to reset to share new credentials).
 *
 * Server-side enforcement of the 24h window: the UI relies on this; the
 * timestamp on `portal_account.credentials_issued_at` and the KV TTL are
 * the source of truth.
 *
 * Placeholder welcome copy is intentional — final copy comes from the user
 * separately (out of step I scope).
 */

type ContextRow = {
  opportunity_id: string;
  opportunity_name: string;
  client_company_name: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  portal_account_id: string;
  portal_email: string;
  credentials_issued_at: string | null;
};

export async function sendCredentialsEmailHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const oppId = ctx.params['id'];
  if (!oppId) return json({ error: 'invalid_id' }, { status: 400 });

  const row = await ctx.env.DB.prepare(
    `SELECT o.id AS opportunity_id,
            o.name AS opportunity_name,
            c.company_name AS client_company_name,
            c.primary_contact_name,
            c.primary_contact_email,
            pa.id AS portal_account_id,
            pa.email AS portal_email,
            pa.credentials_issued_at
       FROM opportunity o
       JOIN client c ON c.id = o.client_id
       JOIN portal_account pa ON pa.client_id = c.id
      WHERE o.id = ?`,
  )
    .bind(oppId)
    .first<ContextRow>();
  if (!row) return json({ error: 'not_found_or_not_activated' }, { status: 404 });

  const plaintext = await ctx.env.SESSIONS.get(`temp_password:${row.portal_account_id}`);
  if (!plaintext) {
    return json(
      {
        error: 'credentials_expired',
        message:
          'The 24-hour re-display window has expired. Reset the password to share new credentials.',
      },
      { status: 410 },
    );
  }

  const recipientName = row.primary_contact_name?.trim() || 'there';
  const portalUrl = ctx.env.PORTAL_URL_BASE;
  const subject = `Your ${row.client_company_name} portal — sign in to get started`;
  const text = welcomeEmailText({
    recipientName,
    portalUrl,
    email: row.portal_email,
    tempPassword: plaintext,
    opportunityName: row.opportunity_name,
  });

  const result = await sendEmail(ctx.env, {
    kind: 'activation_credentials',
    to: row.portal_email,
    subject,
    text,
    relatedEntity: { type: 'opportunity', id: oppId },
  });

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'opportunity.credentials_email_sent',
    entityType: 'opportunity',
    entityId: oppId,
    changes: {
      recipient: row.portal_email,
      ok: result.ok,
      // Plaintext intentionally absent.
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error ?? 'send_failed' }, { status: 502 });
  }
  return json({ ok: true });
}

/**
 * GET /api/admin/opportunities/:id/credentials
 *
 * Reports the current re-display state. Within the 24h window, returns the
 * cached plaintext alongside the portal URL/email so the admin can re-open
 * the handoff modal. After expiry, returns `available: false` with a reason
 * and the issued-at timestamp so the UI can show "Reset and share new
 * credentials" instead.
 */
export async function getCredentialsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const oppId = ctx.params['id'];
  if (!oppId) return json({ error: 'invalid_id' }, { status: 400 });

  const row = await ctx.env.DB.prepare(
    `SELECT pa.id AS portal_account_id,
            pa.email AS portal_email,
            pa.credentials_issued_at
       FROM opportunity o
       JOIN client c ON c.id = o.client_id
       JOIN portal_account pa ON pa.client_id = c.id
      WHERE o.id = ?`,
  )
    .bind(oppId)
    .first<{ portal_account_id: string; portal_email: string; credentials_issued_at: string | null }>();
  if (!row) return json({ available: false, reason: 'not_activated' }, { status: 404 });

  const issuedAt = row.credentials_issued_at ? new Date(row.credentials_issued_at).getTime() : null;
  const withinWindow = issuedAt !== null && Date.now() - issuedAt < CREDENTIALS_WINDOW_MS;

  if (!withinWindow) {
    return json({
      available: false,
      reason: 'expired',
      credentials_issued_at: row.credentials_issued_at,
    });
  }

  const plaintext = await ctx.env.SESSIONS.get(`temp_password:${row.portal_account_id}`);
  if (!plaintext) {
    // Window says we should be inside, but KV doesn't have it (eval'd or
    // never written). Surface as expired so the UI routes to reset.
    return json({
      available: false,
      reason: 'cache_miss',
      credentials_issued_at: row.credentials_issued_at,
    });
  }

  return json({
    available: true,
    credentials_issued_at: row.credentials_issued_at,
    credentials: {
      portal_url: ctx.env.PORTAL_URL_BASE,
      email: row.portal_email,
      temp_password: plaintext,
    },
  });
}

/**
 * POST /api/admin/opportunities/:id/reset-credentials
 *
 * Generates a fresh temp password for the portal_account, bumps
 * `credentials_issued_at`, writes the new plaintext to KV with a fresh 24h
 * TTL (overwriting any previous entry), and returns the new credentials.
 *
 * The previous plaintext (if any) is now unrecoverable: the bcrypt hash on
 * portal_account is replaced, the KV key is overwritten, and the audit_log
 * row records the rotation without the plaintext.
 *
 * Available any time after activation — even within the 24h window, in case
 * the admin wants to rotate proactively (lost paper, compromised channel, etc.).
 */
export async function resetCredentialsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const oppId = ctx.params['id'];
  if (!oppId) return json({ error: 'invalid_id' }, { status: 400 });

  const row = await ctx.env.DB.prepare(
    `SELECT pa.id AS portal_account_id,
            pa.email AS portal_email
       FROM opportunity o
       JOIN client c ON c.id = o.client_id
       JOIN portal_account pa ON pa.client_id = c.id
      WHERE o.id = ?`,
  )
    .bind(oppId)
    .first<{ portal_account_id: string; portal_email: string }>();
  if (!row) return json({ error: 'not_activated' }, { status: 404 });

  const now = new Date().toISOString();
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE portal_account
         SET password_hash = ?, must_change_password = 1, credentials_issued_at = ?
       WHERE id = ?`,
    ).bind(passwordHash, now, row.portal_account_id),
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'admin_user', ?, 'portal_account.credentials_reset', 'portal_account', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      ctx.session.subjectId,
      row.portal_account_id,
      JSON.stringify({
        opportunity_id: oppId,
        reissued_at: now,
        // Plaintext intentionally absent.
      }),
      ctx.session.ipAddress,
      ctx.session.userAgent,
    ),
  ]);

  // Overwrite (or create) the KV entry with the new plaintext and a fresh TTL.
  try {
    await ctx.env.SESSIONS.put(`temp_password:${row.portal_account_id}`, tempPassword, {
      expirationTtl: CREDENTIALS_TTL_SECONDS,
    });
  } catch (e) {
    console.warn('[credentials] reset succeeded but KV cache write failed', e);
  }

  return json({
    ok: true,
    credentials_issued_at: now,
    credentials: {
      portal_url: ctx.env.PORTAL_URL_BASE,
      email: row.portal_email,
      temp_password: tempPassword,
    },
  });
}

function welcomeEmailText(args: {
  recipientName: string;
  portalUrl: string;
  email: string;
  tempPassword: string;
  opportunityName: string;
}): string {
  return [
    `Hi ${args.recipientName},`,
    '',
    `Welcome to Bussey and Bussey. Your client portal is ready for ${args.opportunityName}.`,
    '',
    'Sign in here to complete the short walkthrough — set your password, review and sign your contract, and add payment:',
    '',
    `  Portal:    ${args.portalUrl}`,
    `  Email:     ${args.email}`,
    `  Password:  ${args.tempPassword}`,
    '',
    'You will be asked to change the temporary password on first login.',
    '',
    'If you have any questions, reply to this email and the team will pick it up.',
    '',
    '— Bussey and Bussey',
  ].join('\n');
}

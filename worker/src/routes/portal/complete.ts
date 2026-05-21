import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { sendEmail, adminNotifyRecipients } from '../../services/email';

/**
 * POST /api/portal/walkthrough/complete
 *
 * Final step. Marks the walkthrough as complete, fires the admin
 * notification + client confirmation email, returns the redirect target.
 *
 * Placeholder copy for both emails lives in this file's *EmailText helpers
 * so the final user-supplied copy can be swapped in a single-file edit.
 */

type Ctx = {
  portal_account_id: string;
  client_id: string;
  walkthrough_state: string;
  walkthrough_completed: number;
  client_company_name: string;
  client_primary_contact_name: string | null;
  client_primary_contact_email: string;
  opportunity_id: string;
  opportunity_name: string;
};

export async function walkthroughCompleteHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const context = await ctx.env.DB.prepare(
    `SELECT pa.id AS portal_account_id,
            pa.client_id,
            pa.walkthrough_state,
            pa.walkthrough_completed,
            c.company_name AS client_company_name,
            c.primary_contact_name AS client_primary_contact_name,
            c.primary_contact_email AS client_primary_contact_email,
            o.id AS opportunity_id,
            o.name AS opportunity_name
       FROM portal_account pa
       JOIN client c ON c.id = pa.client_id
       JOIN opportunity o ON o.client_id = pa.client_id AND o.status = 'accepted'
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC
      LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<Ctx>();
  if (!context) return json({ error: 'walkthrough_context_missing' }, { status: 409 });
  if (context.walkthrough_state !== 'payment_set') {
    return json(
      {
        error: 'state_machine_violation',
        current_state: context.walkthrough_state,
        message: 'Completion is only available after payment setup.',
      },
      { status: 409 },
    );
  }
  if (context.walkthrough_completed === 1) {
    return json({ ok: true, walkthrough_state: 'complete', redirect: '/portal/' });
  }

  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE portal_account
         SET walkthrough_state = 'complete', walkthrough_completed = 1
       WHERE id = ?`,
    ).bind(context.portal_account_id),
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, 'walkthrough.completed', 'portal_account', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      context.portal_account_id,
      context.portal_account_id,
      JSON.stringify({
        opportunity_id: context.opportunity_id,
        walkthrough_state: { from: 'payment_set', to: 'complete' },
        walkthrough_completed: { from: false, to: true },
      }),
      ctx.session.ipAddress,
      ctx.session.userAgent,
    ),
  ]);

  // Fire-and-forget notifications. Failures are recorded in `notification`
  // by sendEmail() but don't fail the request.
  ctx.ctx.waitUntil(
    Promise.allSettled([
      sendClientWelcomeEmail(ctx.env, context),
      sendAdminWalkthroughDoneEmail(ctx.env, context),
    ]),
  );

  return json({ ok: true, walkthrough_state: 'complete', redirect: '/portal/' });
}

async function sendClientWelcomeEmail(env: HandlerContext['env'], c: Ctx) {
  return sendEmail(env, {
    kind: 'walkthrough_complete',
    to: c.client_primary_contact_email,
    subject: `Welcome to Bussey and Bussey — ${c.opportunity_name} is active`,
    text: clientWelcomeEmailText(c),
    relatedEntity: { type: 'opportunity', id: c.opportunity_id },
  });
}

async function sendAdminWalkthroughDoneEmail(env: HandlerContext['env'], c: Ctx) {
  const to = adminNotifyRecipients(env);
  if (to.length === 0) return { ok: true };
  return sendEmail(env, {
    kind: 'walkthrough_complete',
    to,
    subject: `[Activation] ${c.client_company_name} completed walkthrough`,
    text: adminWalkthroughDoneEmailText(c),
    relatedEntity: { type: 'opportunity', id: c.opportunity_id },
  });
}

// ─── Placeholder email copy — swap in a single edit when finalized. ──

function clientWelcomeEmailText(c: Ctx): string {
  const greeting = c.client_primary_contact_name?.trim() || 'there';
  return [
    `Hi ${greeting},`,
    '',
    `You're all set. ${c.opportunity_name} is officially activated, and your`,
    `Bussey and Bussey portal is unlocked.`,
    '',
    `What's next:`,
    `  • Your project officially kicks off shortly — we'll be in touch within 24 hours with concrete next steps.`,
    `  • Your portal is now available for documents, project status, and billing — sign in any time at the same URL you used to start the walkthrough.`,
    `  • A receipt for your setup fee was issued by our payment processor; your first monthly invoice will land on the billing date we agreed to.`,
    '',
    `If you have any questions, just reply to this email — we'll pick it up.`,
    '',
    '— Bussey and Bussey',
  ].join('\n');
}

function adminWalkthroughDoneEmailText(c: Ctx): string {
  return [
    `${c.client_company_name} has finished the activation walkthrough.`,
    '',
    `Opportunity: ${c.opportunity_name}`,
    `Client contact: ${c.client_primary_contact_name ?? '(unknown)'} <${c.client_primary_contact_email}>`,
    `Portal account: ${c.portal_account_id}`,
    `Opportunity ID: ${c.opportunity_id}`,
    '',
    `Walkthrough state: complete. Project status is "kickoff" — schedule the kickoff touchpoint per usual.`,
  ].join('\n');
}

import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { activateOpportunity, ActivationError } from '../../services/activation';

/**
 * POST /api/admin/opportunities/:id/activate
 *
 * Completes the Acceptance & Activation workflow (spec 07). The disposition
 * modal's "Accepted" path posts here; other dispositions (followup, changes,
 * declined) continue to use /disposition.
 *
 * Returns 200 with a one-time credentials payload:
 *   { ok: true,
 *     opportunity_id, proposal_id, project_id, contract_id, portal_account_id,
 *     credentials: { portal_url, email, temp_password } }
 *
 * The plaintext `temp_password` is returned to the admin exactly once in this
 * response. It is also cached in KV for 24h to support the re-display window
 * (subtask 6); after that window the admin must reset to share new credentials.
 * The audit_log row records the activation without the plaintext.
 */
export async function activateOpportunityHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  try {
    const result = await activateOpportunity(ctx.env, id, {
      adminUserId: ctx.session.subjectId,
      ipAddress: ctx.session.ipAddress,
      userAgent: ctx.session.userAgent,
    });
    return json({
      ok: true,
      opportunity_id: result.opportunityId,
      proposal_id: result.proposalId,
      project_id: result.projectId,
      contract_id: result.contractId,
      portal_account_id: result.portalAccountId,
      credentials: {
        portal_url: result.credentials.portalUrl,
        email: result.credentials.email,
        temp_password: result.credentials.tempPassword,
      },
    });
  } catch (e) {
    if (e instanceof ActivationError) {
      return json({ error: e.code, message: e.message }, { status: e.httpStatus });
    }
    console.error('[activate] unexpected error', e);
    return json({ error: 'activation_failed' }, { status: 500 });
  }
}

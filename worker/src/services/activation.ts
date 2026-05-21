import templateBody from '../../../templates/contract/master.md';
import type { Env } from '../types/env';
import { hashPassword } from '../lib/password';
import { generateTempPassword, CREDENTIALS_TTL_SECONDS } from '../lib/temp-password';
import { renderContract } from './contract-render';

/**
 * Opportunity activation — the transactional handoff from sales to active client.
 *
 * Triggered by the admin clicking "Accepted" in the disposition modal. In a single
 * D1 batch (implicit transaction) this service:
 *   - flips opportunity.status to 'accepted' + sets accepted_at
 *   - flips proposal.status to 'accepted' + sets accepted_at + bumps updated_at
 *   - flips client.status to 'active' (see deferred-cleanup: chose 'active' over a
 *     separate 'activating' state since walkthrough_completed already gates UX)
 *   - creates project with snapshot copy of presentation_notes
 *   - creates contract with rendered template body
 *   - creates portal_account with bcrypt(temp password) and walkthrough_state='new'
 *   - writes audit_log row (without plaintext password)
 *
 * After the batch commits, the plaintext temp password is cached in KV with a
 * 24-hour TTL so the admin can re-display the credentials handoff modal on the
 * opportunity page within that window (subtask 6 — re-display window). KV write
 * failure is non-fatal: the activation is already durable and the admin still
 * has the plaintext in the response payload from this call.
 *
 * Idempotency: pre-checks refuse re-activation of already-accepted opportunities
 * and accounts. For true concurrent races, the UNIQUE constraints on
 * project.opportunity_id / contract.opportunity_id / portal_account.client_id
 * make the second batch fail and roll back atomically — that's surfaced here as
 * a 409 'concurrent_activation_conflict'.
 */

// v0.1 starter template (see templates/contract/README.md). Bumped only when
// the canonical contract terms change in a way that affects past renders.
const TEMPLATE_VERSION = 'v0.1-starter';

export class ActivationError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ActivationError';
  }
}

export type ActivationActor = {
  adminUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type ActivationResult = {
  opportunityId: string;
  proposalId: string;
  projectId: string;
  contractId: string;
  portalAccountId: string;
  credentials: {
    portalUrl: string;
    email: string;
    /** Plaintext — returned to the admin ONCE. Never stored in D1 or audit_log. */
    tempPassword: string;
  };
};

type OpportunityRow = {
  id: string;
  client_id: string;
  name: string;
  status: string;
};

type ClientRow = {
  id: string;
  company_name: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  billing_address: string | null;
  status: string;
};

type ProposalRow = {
  id: string;
  status: string;
  setup_total: number;
  monthly_total: number;
  narrative_solution: string | null;
  key_capabilities: string | null;
  presentation_notes: string | null;
};

export async function activateOpportunity(
  env: Env,
  opportunityId: string,
  actor: ActivationActor,
): Promise<ActivationResult> {
  const opp = await env.DB.prepare(
    `SELECT id, client_id, name, status FROM opportunity WHERE id = ?`,
  )
    .bind(opportunityId)
    .first<OpportunityRow>();
  if (!opp) throw new ActivationError(404, 'opportunity_not_found');
  if (opp.status === 'accepted') {
    throw new ActivationError(409, 'opportunity_already_activated');
  }
  if (opp.status !== 'open' && opp.status !== 'proposed') {
    throw new ActivationError(
      409,
      'opportunity_not_activatable',
      `Opportunity status '${opp.status}' cannot be activated.`,
    );
  }

  const client = await env.DB.prepare(
    `SELECT id, company_name, primary_contact_name, primary_contact_email,
            billing_address, status
       FROM client WHERE id = ?`,
  )
    .bind(opp.client_id)
    .first<ClientRow>();
  if (!client) throw new ActivationError(409, 'client_not_found');
  if (!client.primary_contact_email) {
    throw new ActivationError(409, 'client_missing_contact_email');
  }
  if (!client.company_name) {
    throw new ActivationError(409, 'client_missing_company_name');
  }
  const contactEmail = client.primary_contact_email;

  const existingAccount = await env.DB.prepare(
    `SELECT id FROM portal_account WHERE client_id = ?`,
  )
    .bind(client.id)
    .first<{ id: string }>();
  if (existingAccount) {
    throw new ActivationError(409, 'portal_account_exists');
  }

  // Prefer the currently-presented proposal (sent), fall back to draft if admin
  // skipped a formal send. Accepted/superseded/declined are not candidates.
  const proposal = await env.DB.prepare(
    `SELECT id, status, setup_total, monthly_total, narrative_solution, key_capabilities,
            presentation_notes
       FROM proposal
      WHERE opportunity_id = ? AND status IN ('draft', 'sent')
      ORDER BY CASE status WHEN 'sent' THEN 1 WHEN 'draft' THEN 2 END,
               created_at DESC
      LIMIT 1`,
  )
    .bind(opportunityId)
    .first<ProposalRow>();
  if (!proposal) throw new ActivationError(409, 'no_activatable_proposal');

  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const portalAccountId = crypto.randomUUID();

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const variables = buildContractVariables(opp, client, contactEmail, proposal, now);
  // Renderer is content-agnostic: substitutes {{var}} and strips HTML comments;
  // leaves {{sig:..}}/{{print:..}}/{{initial:..}}/{{date:..}} markers in place
  // for the walkthrough renderer to convert at signing time (step J).
  const renderedBody = renderContract(templateBody, variables);
  const bodySource = JSON.stringify({
    template_path: 'templates/contract/master.md',
    template_version: TEMPLATE_VERSION,
    variables,
  });

  // body_html column receives the rendered markdown for now; step J converts to
  // actual HTML for portal display. Column name preserved from spec 02 / 0001.
  const stmts = [
    env.DB.prepare(
      `UPDATE opportunity SET status = 'accepted', accepted_at = ?
         WHERE id = ? AND status IN ('open', 'proposed')`,
    ).bind(now, opportunityId),

    env.DB.prepare(
      `UPDATE proposal SET status = 'accepted', accepted_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('draft', 'sent')`,
    ).bind(now, now, proposal.id),

    env.DB.prepare(
      `UPDATE client SET status = 'active' WHERE id = ? AND status != 'active'`,
    ).bind(client.id),

    env.DB.prepare(
      `INSERT INTO project (id, opportunity_id, name, status, presentation_notes, created_at)
       VALUES (?, ?, ?, 'kickoff', ?, ?)`,
    ).bind(projectId, opportunityId, opp.name, proposal.presentation_notes, now),

    env.DB.prepare(
      `INSERT INTO contract (id, opportunity_id, template_version, body_source, body_html, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(contractId, opportunityId, TEMPLATE_VERSION, bodySource, renderedBody, now),

    env.DB.prepare(
      `INSERT INTO portal_account
         (id, client_id, email, password_hash, must_change_password, walkthrough_completed,
          walkthrough_state, created_at, credentials_issued_at)
       VALUES (?, ?, ?, ?, 1, 0, 'new', ?, ?)`,
    ).bind(portalAccountId, client.id, contactEmail, passwordHash, now, now),

    // Umbrella audit row for the activation transaction as a whole.
    auditInsert(env, actor, 'opportunity.activated', 'opportunity', opportunityId, {
      opportunity_id: opportunityId,
      proposal_id: proposal.id,
      project_id: projectId,
      contract_id: contractId,
      portal_account_id: portalAccountId,
      template_version: TEMPLATE_VERSION,
      // Plaintext password intentionally absent.
    }),

    // Per-entity audit rows so each created/transitioned entity has history
    // queryable by its own entity_id. Smoke-test step 10 of step I expects this.
    auditInsert(env, actor, 'proposal.status_change', 'proposal', proposal.id, {
      status: { from: proposal.status, to: 'accepted' },
      opportunity_id: opportunityId,
    }),
    auditInsert(env, actor, 'project.create', 'project', projectId, {
      opportunity_id: opportunityId,
      name: opp.name,
      status: 'kickoff',
      presentation_notes_snapshot_source: `proposal:${proposal.id}`,
    }),
    auditInsert(env, actor, 'contract.create', 'contract', contractId, {
      opportunity_id: opportunityId,
      template_version: TEMPLATE_VERSION,
    }),
    auditInsert(env, actor, 'portal_account.create', 'portal_account', portalAccountId, {
      client_id: client.id,
      email: contactEmail,
      must_change_password: true,
      walkthrough_state: 'new',
      // Plaintext password intentionally absent; only the bcrypt hash exists in portal_account.
    }),
  ];

  let batchResult;
  try {
    batchResult = await env.DB.batch(stmts);
  } catch (e) {
    // Most likely: UNIQUE constraint violation on a concurrent activation.
    const msg = e instanceof Error ? e.message : String(e);
    throw new ActivationError(
      409,
      'concurrent_activation_conflict',
      `Activation rolled back: ${msg}`,
    );
  }

  // Defend against the read-then-write race that the pre-checks can't fully
  // close — if the UPDATE matched zero rows, another caller activated this
  // opportunity between our SELECT and our batch. The UNIQUE constraints on
  // the INSERT rows would normally catch this, but check explicitly so the
  // failure mode is the same regardless of which constraint fires first.
  const oppUpdate = batchResult[0];
  const proposalUpdate = batchResult[1];
  if (!oppUpdate?.meta || oppUpdate.meta.changes !== 1) {
    throw new ActivationError(409, 'opportunity_race_lost');
  }
  if (!proposalUpdate?.meta || proposalUpdate.meta.changes !== 1) {
    throw new ActivationError(409, 'proposal_race_lost');
  }

  // Cache plaintext for the 24h re-display window. Non-fatal on failure:
  // activation has committed, the admin holds the plaintext in this response,
  // and re-display will just route to the reset path until the next issuance.
  try {
    await env.SESSIONS.put(`temp_password:${portalAccountId}`, tempPassword, {
      expirationTtl: CREDENTIALS_TTL_SECONDS,
    });
  } catch (e) {
    console.warn(
      '[activation] failed to cache temp password in KV; re-display will require reset',
      e,
    );
  }

  return {
    opportunityId,
    proposalId: proposal.id,
    projectId,
    contractId,
    portalAccountId,
    credentials: {
      portalUrl: env.PORTAL_URL_BASE,
      email: contactEmail,
      tempPassword,
    },
  };
}

function auditInsert(
  env: Env,
  actor: ActivationActor,
  action: string,
  entityType: string,
  entityId: string,
  changes: Record<string, unknown>,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log
       (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
     VALUES (?, 'admin_user', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actor.adminUserId,
    action,
    entityType,
    entityId,
    JSON.stringify(changes),
    actor.ipAddress,
    actor.userAgent,
  );
}

function buildContractVariables(
  opp: OpportunityRow,
  client: ClientRow,
  contactEmail: string,
  proposal: ProposalRow,
  effectiveIso: string,
): Record<string, string> {
  const primaryContact = client.primary_contact_name
    ? `${client.primary_contact_name} <${contactEmail}>`
    : contactEmail;
  return {
    effective_date: formatDate(effectiveIso),
    client_legal_name: client.company_name,
    client_address: client.billing_address ?? '(address on file)',
    client_primary_contact: primaryContact,
    opportunity_name: opp.name,
    proposal_id: proposal.id,
    proposal_accepted_at: formatDate(effectiveIso),
    proposal_narrative_solution: proposal.narrative_solution ?? '_(no narrative provided)_',
    proposal_key_capabilities: formatKeyCapabilities(proposal.key_capabilities),
    setup_fee_total: formatCurrency(proposal.setup_total),
    monthly_fee_total: formatCurrency(proposal.monthly_total),
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatKeyCapabilities(jsonArr: string | null): string {
  if (!jsonArr) return '_(no capabilities listed)_';
  try {
    const parsed = JSON.parse(jsonArr);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return '_(no capabilities listed)_';
    }
    return parsed
      .filter((s): s is string => typeof s === 'string')
      .map((s) => `- ${s}`)
      .join('\n');
  } catch {
    return '_(no capabilities listed)_';
  }
}

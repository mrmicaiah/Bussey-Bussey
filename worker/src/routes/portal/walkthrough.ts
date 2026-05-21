import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { hashPassword } from '../../lib/password';
import { writeAudit } from '../../lib/audit';

/**
 * Portal walkthrough endpoints.
 *
 *   GET  /api/portal/walkthrough/state         — current state + per-step data
 *   POST /api/portal/auth/change-password      — advances state new → password_set
 *   POST /api/portal/walkthrough/sign-contract — advances state password_set → contract_signed
 *
 * The walkthrough is a server-enforced state machine. The UI restricts to
 * in-order steps; the server is the source of truth. Out-of-order POSTs
 * return 409 `state_machine_violation` with the current state. See the
 * route inventory in worker/src/routes/portal/index.ts for the full set
 * (setup-payment and complete are stubbed until J2).
 */

type AccountRow = {
  id: string;
  client_id: string;
  email: string;
  must_change_password: number;
  walkthrough_completed: number;
  walkthrough_state: WalkthroughState;
};

type WalkthroughState =
  | 'new'
  | 'password_set'
  | 'contract_signed'
  | 'payment_set'
  | 'complete';

const MIN_PASSWORD_LENGTH = 10;

// ─── State ────────────────────────────────────────────────────────────

type StateRow = {
  walkthrough_state: WalkthroughState;
  walkthrough_completed: number;
  must_change_password: number;
  client_id: string;
  opportunity_id: string | null;
  setup_total: number | null;
  monthly_total: number | null;
  accepted_at: string | null;
  contract_id: string | null;
  contract_body: string | null;
  contract_signed_at: string | null;
};

export async function walkthroughStateHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const row = await ctx.env.DB.prepare(
    `SELECT pa.walkthrough_state,
            pa.walkthrough_completed,
            pa.must_change_password,
            pa.client_id,
            o.id AS opportunity_id,
            p.setup_total,
            p.monthly_total,
            o.accepted_at,
            con.id AS contract_id,
            con.body_html AS contract_body,
            con.signed_at AS contract_signed_at
       FROM portal_account pa
       LEFT JOIN opportunity o
              ON o.client_id = pa.client_id
             AND o.status = 'accepted'
       LEFT JOIN proposal p
              ON p.opportunity_id = o.id
             AND p.status = 'accepted'
       LEFT JOIN contract con
              ON con.opportunity_id = o.id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC NULLS LAST
      LIMIT 1`,
  )
    .bind(ctx.session.subjectId)
    .first<StateRow>();
  if (!row) return json({ error: 'not_found' }, { status: 404 });

  const payload: Record<string, unknown> = {
    walkthrough_state: row.walkthrough_state,
    walkthrough_completed: row.walkthrough_completed === 1,
    must_change_password: row.must_change_password === 1,
  };

  // Contract body is delivered for any state at or beyond password_set so the
  // UI can render the signing step (and the read-only view afterwards).
  if (
    row.contract_id &&
    row.contract_body &&
    row.walkthrough_state !== 'new'
  ) {
    payload['contract'] = {
      id: row.contract_id,
      body: row.contract_body,
      signed_at: row.contract_signed_at,
    };
  }

  // Payment summary always included once we know what was accepted.
  if (row.setup_total !== null && row.monthly_total !== null && row.accepted_at) {
    payload['payment_summary'] = {
      setup_total: row.setup_total,
      monthly_total: row.monthly_total,
      monthly_starts_on: computeMonthlyStartDate(row.accepted_at),
    };
  }

  return json(payload);
}

// ─── Change password (step 2) ────────────────────────────────────────

export async function portalChangePasswordHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });
  const newPassword = typeof body['new_password'] === 'string' ? body['new_password'] : '';
  const confirm = typeof body['confirm'] === 'string' ? body['confirm'] : '';
  if (!newPassword || !confirm) {
    return json({ error: 'invalid_request' }, { status: 400 });
  }
  if (newPassword !== confirm) {
    return json({ error: 'passwords_do_not_match' }, { status: 400 });
  }
  const requirementError = validatePasswordRequirements(newPassword);
  if (requirementError) return json({ error: requirementError }, { status: 400 });

  const account = await ctx.env.DB.prepare(
    `SELECT id, client_id, email, must_change_password, walkthrough_completed, walkthrough_state
       FROM portal_account WHERE id = ?`,
  )
    .bind(ctx.session.subjectId)
    .first<AccountRow>();
  if (!account) return json({ error: 'not_found' }, { status: 404 });

  // State machine: change-password is valid in `new` (first time) or
  // `password_set` (retry / change). Beyond that, route via account settings
  // (out of step J scope).
  if (account.walkthrough_state !== 'new' && account.walkthrough_state !== 'password_set') {
    return json(
      {
        error: 'state_machine_violation',
        current_state: account.walkthrough_state,
        message: 'Password change is not available at this walkthrough step.',
      },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const nextState: WalkthroughState =
    account.walkthrough_state === 'new' ? 'password_set' : account.walkthrough_state;

  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `UPDATE portal_account
         SET password_hash = ?,
             must_change_password = 0,
             walkthrough_state = ?
       WHERE id = ?`,
    ).bind(passwordHash, nextState, account.id),
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, 'portal_account.password_changed', 'portal_account', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      account.id,
      account.id,
      JSON.stringify({
        must_change_password: { from: account.must_change_password === 1, to: false },
        walkthrough_state: { from: account.walkthrough_state, to: nextState },
        // Plaintext password intentionally absent.
      }),
      ctx.session.ipAddress,
      ctx.session.userAgent,
    ),
  ]);

  return json({ ok: true, walkthrough_state: nextState });
}

// ─── Sign contract (step 3) ──────────────────────────────────────────

type SignaturePayload = {
  marker: string; // e.g. "sig:client_name" or "initial:section_3"
  kind: 'sig' | 'print' | 'initial' | 'date';
  label: string; // the part after the colon
  typed_value: string;
};

type SignContractBody = {
  signatures: SignaturePayload[];
  agreement_typed_name: string;
};

export async function portalSignContractHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const account = await ctx.env.DB.prepare(
    `SELECT id, client_id, email, must_change_password, walkthrough_completed, walkthrough_state
       FROM portal_account WHERE id = ?`,
  )
    .bind(ctx.session.subjectId)
    .first<AccountRow>();
  if (!account) return json({ error: 'not_found' }, { status: 404 });
  if (account.walkthrough_state !== 'password_set') {
    return json(
      {
        error: 'state_machine_violation',
        current_state: account.walkthrough_state,
        message: 'Contract signing is only available after the password step.',
      },
      { status: 409 },
    );
  }

  const body = (await readJsonObject(ctx.request)) as SignContractBody | null;
  if (!body || !Array.isArray(body.signatures) || typeof body.agreement_typed_name !== 'string') {
    return json({ error: 'invalid_request' }, { status: 400 });
  }
  const agreementName = body.agreement_typed_name.trim();
  if (!agreementName) return json({ error: 'agreement_signature_required' }, { status: 400 });

  // Locate the contract for this client's most-recently-accepted opportunity.
  const contractRow = await ctx.env.DB.prepare(
    `SELECT con.id AS contract_id,
            con.body_html AS contract_body,
            o.id AS opportunity_id,
            con.signed_at
       FROM portal_account pa
       JOIN opportunity o
            ON o.client_id = pa.client_id
           AND o.status = 'accepted'
       JOIN contract con ON con.opportunity_id = o.id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC
      LIMIT 1`,
  )
    .bind(account.id)
    .first<{
      contract_id: string;
      contract_body: string;
      opportunity_id: string;
      signed_at: string | null;
    }>();
  if (!contractRow) return json({ error: 'no_contract_to_sign' }, { status: 409 });
  if (contractRow.signed_at) {
    return json({ error: 'contract_already_signed' }, { status: 409 });
  }

  // Extract every marker the template requires and confirm the payload covers it.
  const expected = extractMarkers(contractRow.contract_body);
  const provided = new Map<string, SignaturePayload>();
  for (const sig of body.signatures) {
    if (
      !sig ||
      typeof sig.marker !== 'string' ||
      typeof sig.kind !== 'string' ||
      typeof sig.label !== 'string' ||
      typeof sig.typed_value !== 'string'
    ) {
      return json({ error: 'invalid_signature_payload' }, { status: 400 });
    }
    if (sig.typed_value.trim() === '') {
      return json(
        { error: 'marker_value_required', marker: sig.marker },
        { status: 400 },
      );
    }
    provided.set(sig.marker, sig);
  }
  const missing = expected.filter((m) => !provided.has(m));
  if (missing.length > 0) {
    return json({ error: 'markers_missing', markers: missing }, { status: 400 });
  }
  const unexpected = [...provided.keys()].filter((m) => !expected.includes(m));
  if (unexpected.length > 0) {
    return json({ error: 'markers_unexpected', markers: unexpected }, { status: 400 });
  }

  const now = new Date().toISOString();
  const ip = ctx.session.ipAddress;
  const ua = ctx.session.userAgent;

  const stmts = [];

  // document_signature rows are written only for the legally-significant
  // events: sig (signature) and initial (initial). Print and date markers
  // are auxiliary form fields — they get recorded in the audit_log changes
  // payload below but do not warrant a per-marker document_signature row,
  // and the schema's signature_type enum has no fitting category for them.
  const typedFields: Record<string, string> = {};
  for (const sig of body.signatures) {
    if (sig.kind === 'sig') {
      stmts.push(
        ctx.env.DB.prepare(
          `INSERT INTO document_signature
             (id, portal_account_id, document_type, document_id, signature_type,
              typed_name, typed_initials, ip_address, user_agent, opportunity_id, signed_at)
           VALUES (?, ?, 'contract', ?, 'signature', ?, NULL, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          account.id,
          contractRow.contract_id,
          sig.typed_value,
          ip,
          ua,
          contractRow.opportunity_id,
          now,
        ),
      );
    } else if (sig.kind === 'initial') {
      stmts.push(
        ctx.env.DB.prepare(
          `INSERT INTO document_signature
             (id, portal_account_id, document_type, document_id, signature_type,
              typed_name, typed_initials, ip_address, user_agent, opportunity_id, signed_at)
           VALUES (?, ?, 'contract', ?, 'initial', NULL, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          account.id,
          contractRow.contract_id,
          sig.typed_value,
          ip,
          ua,
          contractRow.opportunity_id,
          now,
        ),
      );
    } else {
      // print | date — store the typed value in the audit_log payload only.
      typedFields[sig.marker] = sig.typed_value;
    }
  }

  // Final agreement_acceptance row.
  const agreementId = crypto.randomUUID();
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO document_signature
         (id, portal_account_id, document_type, document_id, signature_type,
          typed_name, typed_initials, ip_address, user_agent, opportunity_id, signed_at)
       VALUES (?, ?, 'contract', ?, 'agreement_acceptance', ?, NULL, ?, ?, ?, ?)`,
    ).bind(
      agreementId,
      account.id,
      contractRow.contract_id,
      agreementName,
      ip,
      ua,
      contractRow.opportunity_id,
      now,
    ),
  );

  // Update contract + portal_account in the same batch.
  stmts.push(
    ctx.env.DB.prepare(
      `UPDATE contract SET signed_at = ?, signed_by_portal_account_id = ? WHERE id = ?`,
    ).bind(now, account.id, contractRow.contract_id),
  );
  stmts.push(
    ctx.env.DB.prepare(
      `UPDATE portal_account SET walkthrough_state = 'contract_signed' WHERE id = ?`,
    ).bind(account.id),
  );

  // Audit rows — umbrella + per-entity per the established cascade pattern.
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, 'contract.signed', 'contract', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      account.id,
      contractRow.contract_id,
      JSON.stringify({
        opportunity_id: contractRow.opportunity_id,
        signed_by_portal_account_id: account.id,
        marker_count: body.signatures.length,
        agreement_acceptance_id: agreementId,
        typed_fields: typedFields,
      }),
      ip,
      ua,
    ),
  );
  stmts.push(
    ctx.env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES (?, 'portal_account', ?, 'portal_account.walkthrough_advance', 'portal_account', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      account.id,
      account.id,
      JSON.stringify({
        walkthrough_state: { from: 'password_set', to: 'contract_signed' },
        contract_id: contractRow.contract_id,
      }),
      ip,
      ua,
    ),
  );

  await ctx.env.DB.batch(stmts);

  return json({
    ok: true,
    walkthrough_state: 'contract_signed',
    contract_id: contractRow.contract_id,
    signed_at: now,
  });
}

// ─── helpers ─────────────────────────────────────────────────────────

const MARKER_REGEX = /\{\{(sig|print|initial|date):([A-Za-z0-9_]+)\}\}/g;

function extractMarkers(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MARKER_REGEX)) {
    out.add(`${m[1]}:${m[2]}`);
  }
  return [...out];
}

function validatePasswordRequirements(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return 'password_too_short';
  if (!/[a-z]/.test(pw)) return 'password_needs_lowercase';
  if (!/[A-Z]/.test(pw)) return 'password_needs_uppercase';
  if (!/[0-9]/.test(pw) && !/[^A-Za-z0-9]/.test(pw)) return 'password_needs_number_or_symbol';
  return null;
}

function computeMonthlyStartDate(acceptedAtIso: string): string {
  // 30 days from acceptance — the J1 placeholder; J2 will revisit this when
  // payment-setup actually creates the Stripe subscription with a billing
  // anchor. ISO date string (YYYY-MM-DD).
  const accepted = new Date(acceptedAtIso);
  const start = new Date(accepted.getTime() + 30 * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
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

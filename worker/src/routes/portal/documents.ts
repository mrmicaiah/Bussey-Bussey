import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * Portal documents:
 *
 *   GET /api/portal/documents       — list (contract + proposal + change orders)
 *   GET /api/portal/documents/:doc_type/:doc_id — fetch one document body + signatures
 *
 * Document types and id schemes:
 *   - contract:       contract.id
 *   - proposal:       proposal.id    (the accepted one)
 *   - change_order:   change_order.id (only visible if status != 'draft')
 */

type ListContext = {
  client_id: string;
  opportunity_id: string;
  proposal_id: string | null;
  contract_id: string | null;
};

async function loadContext(env: HandlerContext['env'], portalAccountId: string): Promise<ListContext | null> {
  return env.DB.prepare(
    `SELECT pa.client_id,
            o.id AS opportunity_id,
            p.id AS proposal_id,
            con.id AS contract_id
       FROM portal_account pa
       JOIN opportunity o ON o.client_id = pa.client_id AND o.status = 'accepted'
       LEFT JOIN proposal p ON p.opportunity_id = o.id AND p.status = 'accepted'
       LEFT JOIN contract con ON con.opportunity_id = o.id
      WHERE pa.id = ?
      ORDER BY o.accepted_at DESC LIMIT 1`,
  )
    .bind(portalAccountId)
    .first<ListContext>();
}

export async function portalListDocumentsHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const c = await loadContext(ctx.env, ctx.session.subjectId);
  if (!c) return json({ documents: [] });

  const documents: Array<{
    doc_type: 'contract' | 'proposal' | 'change_order';
    doc_id: string;
    title: string;
    status: string;
    signed_at: string | null;
    created_at: string;
    setup_delta?: number;
    monthly_delta?: number;
  }> = [];

  if (c.contract_id) {
    const con = await ctx.env.DB.prepare(
      `SELECT id, generated_at, signed_at, template_version FROM contract WHERE id = ?`,
    )
      .bind(c.contract_id)
      .first<{ id: string; generated_at: string; signed_at: string | null; template_version: string }>();
    if (con) {
      documents.push({
        doc_type: 'contract',
        doc_id: con.id,
        title: 'Master Service Agreement',
        status: con.signed_at ? 'signed' : 'pending',
        signed_at: con.signed_at,
        created_at: con.generated_at,
      });
    }
  }
  if (c.proposal_id) {
    const p = await ctx.env.DB.prepare(
      `SELECT id, name, accepted_at, created_at FROM proposal WHERE id = ?`,
    )
      .bind(c.proposal_id)
      .first<{ id: string; name: string; accepted_at: string | null; created_at: string }>();
    if (p) {
      documents.push({
        doc_type: 'proposal',
        doc_id: p.id,
        title: p.name,
        status: 'accepted',
        signed_at: p.accepted_at,
        created_at: p.created_at,
      });
    }
  }
  if (c.proposal_id) {
    const cosRes = await ctx.env.DB.prepare(
      `SELECT id, name, status, setup_delta, monthly_delta, proposed_at, approved_at, created_at
         FROM change_order
        WHERE proposal_id = ? AND status != 'draft'
        ORDER BY created_at DESC`,
    )
      .bind(c.proposal_id)
      .all<{
        id: string;
        name: string;
        status: string;
        setup_delta: number;
        monthly_delta: number;
        proposed_at: string | null;
        approved_at: string | null;
        created_at: string;
      }>();
    for (const co of cosRes.results ?? []) {
      documents.push({
        doc_type: 'change_order',
        doc_id: co.id,
        title: co.name,
        status: co.status,
        signed_at: co.approved_at,
        created_at: co.created_at,
        setup_delta: co.setup_delta,
        monthly_delta: co.monthly_delta,
      });
    }
  }

  return json({ documents });
}

export async function portalFetchDocumentHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const docType = ctx.params['doc_type'];
  const docId = ctx.params['doc_id'];
  if (!docType || !docId) return json({ error: 'invalid_id' }, { status: 400 });

  const c = await loadContext(ctx.env, ctx.session.subjectId);
  if (!c) return json({ error: 'not_found' }, { status: 404 });

  if (docType === 'contract' && docId === c.contract_id) {
    const con = await ctx.env.DB.prepare(
      `SELECT id, body_html, signed_at, template_version, generated_at FROM contract WHERE id = ?`,
    )
      .bind(docId)
      .first<{ id: string; body_html: string; signed_at: string | null; template_version: string; generated_at: string }>();
    if (!con) return json({ error: 'not_found' }, { status: 404 });
    const sigs = await listSignatures(ctx.env, 'contract', docId);
    return json({
      doc_type: 'contract',
      doc_id: con.id,
      title: 'Master Service Agreement',
      body: con.body_html,
      signed_at: con.signed_at,
      generated_at: con.generated_at,
      signatures: sigs,
    });
  }

  if (docType === 'proposal' && docId === c.proposal_id) {
    const p = await ctx.env.DB.prepare(
      `SELECT id, name, narrative_solution, key_capabilities, setup_total, monthly_total,
              presentation_notes, accepted_at, created_at
         FROM proposal WHERE id = ?`,
    )
      .bind(docId)
      .first<{
        id: string;
        name: string;
        narrative_solution: string | null;
        key_capabilities: string | null;
        setup_total: number;
        monthly_total: number;
        presentation_notes: string | null;
        accepted_at: string | null;
        created_at: string;
      }>();
    if (!p) return json({ error: 'not_found' }, { status: 404 });
    return json({
      doc_type: 'proposal',
      doc_id: p.id,
      title: p.name,
      body: renderProposalAsDocument(p),
      signed_at: p.accepted_at,
      generated_at: p.created_at,
      signatures: [],
    });
  }

  if (docType === 'change_order') {
    // Confirm it belongs to this client's proposal AND isn't a draft.
    const co = await ctx.env.DB.prepare(
      `SELECT co.id, co.name, co.status, co.reason, co.setup_delta, co.monthly_delta,
              co.proposed_at, co.approved_at, co.created_at
         FROM change_order co
        WHERE co.id = ? AND co.proposal_id = ? AND co.status != 'draft'`,
    )
      .bind(docId, c.proposal_id ?? '')
      .first<{
        id: string;
        name: string;
        status: string;
        reason: string | null;
        setup_delta: number;
        monthly_delta: number;
        proposed_at: string | null;
        approved_at: string | null;
        created_at: string;
      }>();
    if (!co) return json({ error: 'not_found' }, { status: 404 });
    const lineRes = await ctx.env.DB.prepare(
      `SELECT action, component_code, quantity, unit_price_from_snapshot, line_total_delta
         FROM change_order_line_item WHERE change_order_id = ? ORDER BY created_at`,
    )
      .bind(docId)
      .all<{
        action: string;
        component_code: string;
        quantity: number;
        unit_price_from_snapshot: number;
        line_total_delta: number;
      }>();
    const sigs = await listSignatures(ctx.env, 'change_order', co.id);
    return json({
      doc_type: 'change_order',
      doc_id: co.id,
      title: co.name,
      body: renderChangeOrderAsDocument(co, lineRes.results ?? []),
      signed_at: co.approved_at,
      generated_at: co.proposed_at ?? co.created_at,
      signatures: sigs,
    });
  }

  return json({ error: 'not_found' }, { status: 404 });
}

async function listSignatures(env: HandlerContext['env'], docType: string, docId: string) {
  const res = await env.DB.prepare(
    `SELECT id, signature_type, typed_name, typed_initials, ip_address, signed_at
       FROM document_signature
      WHERE document_type = ? AND document_id = ?
      ORDER BY signed_at`,
  )
    .bind(docType, docId)
    .all();
  return res.results ?? [];
}

function renderProposalAsDocument(p: {
  name: string;
  narrative_solution: string | null;
  key_capabilities: string | null;
  setup_total: number;
  monthly_total: number;
  presentation_notes: string | null;
  accepted_at: string | null;
}): string {
  const capabilities = (() => {
    if (!p.key_capabilities) return '';
    try {
      const arr = JSON.parse(p.key_capabilities);
      if (!Array.isArray(arr)) return '';
      return arr.filter((s) => typeof s === 'string').map((s: string) => `- ${s}`).join('\n');
    } catch {
      return '';
    }
  })();
  return [
    `# ${p.name}`,
    '',
    p.accepted_at ? `Accepted on ${new Date(p.accepted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.` : '',
    '',
    p.narrative_solution ? '## Solution' : '',
    p.narrative_solution ?? '',
    '',
    capabilities ? '## Key capabilities' : '',
    capabilities,
    '',
    '## Fees',
    `- Setup: $${p.setup_total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `- Monthly: $${p.monthly_total.toLocaleString('en-US', { minimumFractionDigits: 2 })} / month`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function renderChangeOrderAsDocument(
  co: {
    name: string;
    status: string;
    reason: string | null;
    setup_delta: number;
    monthly_delta: number;
    proposed_at: string | null;
    approved_at: string | null;
  },
  lines: Array<{
    action: string;
    component_code: string;
    quantity: number;
    unit_price_from_snapshot: number;
    line_total_delta: number;
  }>,
): string {
  const fmt = (n: number) => {
    const sign = n < 0 ? '-' : n > 0 ? '+' : '';
    return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  };
  const lineLines = lines.map(
    (l) => `- ${l.action} ${l.component_code} ×${l.quantity} (${fmt(l.line_total_delta)})`,
  );
  return [
    `# Change order: ${co.name}`,
    '',
    `Status: ${co.status}`,
    co.proposed_at ? `Proposed: ${new Date(co.proposed_at).toLocaleString()}` : '',
    co.approved_at ? `Approved: ${new Date(co.approved_at).toLocaleString()}` : '',
    '',
    co.reason ? '## Reason' : '',
    co.reason ?? '',
    '',
    '## Line items',
    ...lineLines,
    '',
    '## Net impact',
    `- Setup adjustment: ${fmt(co.setup_delta)}`,
    `- Monthly adjustment: ${fmt(co.monthly_delta)} / month`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

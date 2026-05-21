import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import {
  ProposalError,
  createProposal,
  updateProposal,
  deleteProposal,
  cloneProposal,
  getProposalRow,
  getSnapshotForProposal,
  getLineItemsForProposal,
  addLineItem,
  updateLineItem,
  deleteLineItem,
  parseSnapshot,
  parseModifiers,
  staleAfterIso,
  isStale,
  type ProposalRow,
} from '../../services/proposals';

function shapeProposal(row: ProposalRow) {
  return {
    ...row,
    demo_enabled: row.demo_enabled === 1,
    modifiers: parseModifiers(row),
    key_capabilities: row.key_capabilities ? JSON.parse(row.key_capabilities) : null,
    stale_after: staleAfterIso(row.created_at),
    is_stale: isStale(row.created_at, row.status),
  };
}

async function bodyAsObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = (await req.json()) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function handleError(err: unknown): Response {
  if (err instanceof ProposalError) {
    return json({ error: err.errorCode, message: err.message }, { status: err.status });
  }
  console.error('proposals:unhandled', err);
  return json({ error: 'internal_error' }, { status: 500 });
}

export async function listProposals(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.request.url);
  const opportunityId = url.searchParams.get('opportunity_id');
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

  let sql = `SELECT * FROM proposal`;
  const binds: unknown[] = [];
  if (opportunityId) {
    sql += ` WHERE opportunity_id = ?`;
    binds.push(opportunityId);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await ctx.env.DB.prepare(sql).bind(...binds).all<ProposalRow>();
  return json({ proposals: (result.results ?? []).map(shapeProposal), limit, offset });
}

export async function getProposal(ctx: HandlerContext): Promise<Response> {
  try {
    const id = ctx.params['id'];
    if (!id) return json({ error: 'invalid_id' }, { status: 400 });
    const proposal = await getProposalRow(ctx.env, id);
    if (!proposal) return json({ error: 'not_found' }, { status: 404 });
    const snapshot = await getSnapshotForProposal(ctx.env, id);
    const lineItems = await getLineItemsForProposal(ctx.env, id);
    return json({
      proposal: shapeProposal(proposal),
      snapshot: { snapshot_at: snapshot.snapshot_at, ...parseSnapshot(snapshot) },
      line_items: lineItems,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function createProposalHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const body = await bodyAsObject(ctx.request);
    if (!body) return json({ error: 'invalid_request' }, { status: 400 });
    const opportunity_id = typeof body['opportunity_id'] === 'string' ? body['opportunity_id'] : '';
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (!opportunity_id) return json({ error: 'opportunity_id_required' }, { status: 400 });
    if (!name) return json({ error: 'name_required' }, { status: 400 });

    const createInput: Parameters<typeof createProposal>[1] = {
      opportunity_id,
      name,
      pricing_display_mode: (body['pricing_display_mode'] as 'summary' | 'categorical' | 'full' | undefined) ?? 'summary',
      demo_enabled: Boolean(body['demo_enabled']),
    };
    const nc = stringField(body, 'narrative_challenge');
    if (nc !== undefined) createInput.narrative_challenge = nc;
    const ns = stringField(body, 'narrative_solution');
    if (ns !== undefined) createInput.narrative_solution = ns;
    if (Array.isArray(body['key_capabilities'])) createInput.key_capabilities = body['key_capabilities'] as string[];
    if (body['modifiers'] && typeof body['modifiers'] === 'object') {
      createInput.modifiers = body['modifiers'] as Partial<NonNullable<Parameters<typeof createProposal>[1]['modifiers']>>;
    }
    const n = stringField(body, 'notes');
    if (n !== undefined) createInput.notes = n;
    const pn = stringField(body, 'presentation_notes');
    if (pn !== undefined) createInput.presentation_notes = pn;

    const { proposal, snapshot, line_items } = await createProposal(
      ctx.env,
      createInput,
      ctx.session.subjectId,
      ctx.session.ipAddress,
      ctx.session.userAgent,
    );

    return json(
      {
        proposal: shapeProposal(proposal),
        snapshot: { snapshot_at: snapshot.snapshot_at, ...parseSnapshot(snapshot) },
        line_items,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}

export async function updateProposalHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const id = ctx.params['id'];
    if (!id) return json({ error: 'invalid_id' }, { status: 400 });
    const body = await bodyAsObject(ctx.request);
    if (!body) return json({ error: 'invalid_request' }, { status: 400 });
    const updated = await updateProposal(ctx.env, id, body, ctx.session.subjectId, ctx.session.ipAddress, ctx.session.userAgent);
    return json({ proposal: shapeProposal(updated) });
  } catch (e) {
    return handleError(e);
  }
}

export async function deleteProposalHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const id = ctx.params['id'];
    if (!id) return json({ error: 'invalid_id' }, { status: 400 });
    await deleteProposal(ctx.env, id, ctx.session.subjectId, ctx.session.ipAddress, ctx.session.userAgent);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function cloneProposalHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const id = ctx.params['id'];
    if (!id) return json({ error: 'invalid_id' }, { status: 400 });
    const { proposal, snapshot, line_items } = await cloneProposal(ctx.env, id, ctx.session.subjectId, ctx.session.ipAddress, ctx.session.userAgent);
    return json(
      {
        proposal: shapeProposal(proposal),
        snapshot: { snapshot_at: snapshot.snapshot_at, ...parseSnapshot(snapshot) },
        line_items,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}

// Line item nested routes

export async function addLineItemHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const proposalId = ctx.params['id'];
    if (!proposalId) return json({ error: 'invalid_id' }, { status: 400 });
    const body = await bodyAsObject(ctx.request);
    if (!body) return json({ error: 'invalid_request' }, { status: 400 });
    const code = typeof body['component_code'] === 'string' ? body['component_code'] : '';
    if (!code) return json({ error: 'component_code_required' }, { status: 400 });
    const addInput: Parameters<typeof addLineItem>[2] = { component_code: code };
    if (typeof body['quantity'] === 'number') addInput.quantity = body['quantity'];
    if (typeof body['unit_price'] === 'number') addInput.unit_price = body['unit_price'];
    const desc = stringField(body, 'description_override');
    if (desc !== undefined) addInput.description_override = desc;
    const result = await addLineItem(
      ctx.env,
      proposalId,
      addInput,
      ctx.session.subjectId,
      ctx.session.ipAddress,
      ctx.session.userAgent,
    );
    return json({ line_item: result.line_item, proposal: shapeProposal(result.proposal) }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

export async function updateLineItemHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const proposalId = ctx.params['id'];
    const lineId = ctx.params['line_id'];
    if (!proposalId || !lineId) return json({ error: 'invalid_id' }, { status: 400 });
    const body = await bodyAsObject(ctx.request);
    if (!body) return json({ error: 'invalid_request' }, { status: 400 });
    const updInput: Parameters<typeof updateLineItem>[3] = {};
    if (typeof body['quantity'] === 'number') updInput.quantity = body['quantity'];
    if (typeof body['unit_price'] === 'number') updInput.unit_price = body['unit_price'];
    if (body['description_override'] !== undefined) updInput.description_override = body['description_override'] as string | null;
    const result = await updateLineItem(
      ctx.env,
      proposalId,
      lineId,
      updInput,
      ctx.session.subjectId,
      ctx.session.ipAddress,
      ctx.session.userAgent,
    );
    return json({ line_item: result.line_item, proposal: shapeProposal(result.proposal) });
  } catch (e) {
    return handleError(e);
  }
}

export async function deleteLineItemHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const proposalId = ctx.params['id'];
    const lineId = ctx.params['line_id'];
    if (!proposalId || !lineId) return json({ error: 'invalid_id' }, { status: 400 });
    const result = await deleteLineItem(ctx.env, proposalId, lineId, ctx.session.subjectId, ctx.session.ipAddress, ctx.session.userAgent);
    return json({ ok: true, proposal: shapeProposal(result.proposal) });
  } catch (e) {
    return handleError(e);
  }
}

// helpers

function stringField(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  return v;
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

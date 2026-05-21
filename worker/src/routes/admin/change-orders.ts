import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { writeAudit } from '../../lib/audit';
import { sendEmail } from '../../services/email';
import {
  ChangeOrderError,
  getChangeOrder,
  listChangeOrderLineItems,
  resolveSnapshotComponent,
  computeLineItemDelta,
  recomputeChangeOrderDeltas,
} from '../../services/change-orders';

/**
 * Admin change-order endpoints — full CRUD + propose transition.
 *
 * Routes:
 *   GET    /api/admin/change-orders                       — list (filter by proposal_id or opportunity_id)
 *   POST   /api/admin/change-orders                       — create (status='draft')
 *   GET    /api/admin/change-orders/:id                   — detail + line items
 *   PUT    /api/admin/change-orders/:id                   — update (draft only)
 *   DELETE /api/admin/change-orders/:id                   — delete (draft only)
 *   POST   /api/admin/change-orders/:id/line-items        — add line item
 *   DELETE /api/admin/change-orders/:id/line-items/:lid   — remove line item
 *   POST   /api/admin/change-orders/:id/propose           — draft → proposed + notify client
 *   POST   /api/admin/change-orders/:id/withdraw          — proposed → withdrawn
 *
 * State machine: draft → proposed → approved | rejected. Withdraw moves
 * proposed back to withdrawn (separate terminal). Approval happens on the
 * portal side and triggers Stripe ops (see portal/change-orders.ts).
 */

const CHANGE_ORDER_EDITABLE_FIELDS = ['name', 'reason'] as const;

// ─── List ────────────────────────────────────────────────────────────

export async function listChangeOrdersHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(ctx.request.url);
  const proposalId = url.searchParams.get('proposal_id');
  const opportunityId = url.searchParams.get('opportunity_id');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (proposalId) {
    where.push('co.proposal_id = ?');
    binds.push(proposalId);
  }
  if (opportunityId) {
    where.push('p.opportunity_id = ?');
    binds.push(opportunityId);
  }
  let sql = `SELECT co.* FROM change_order co JOIN proposal p ON p.id = co.proposal_id`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY co.created_at DESC`;

  const res = await ctx.env.DB.prepare(sql).bind(...binds).all();
  return json({ change_orders: res.results ?? [] });
}

// ─── Create ──────────────────────────────────────────────────────────

export async function createChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });
  const proposalId = typeof body['proposal_id'] === 'string' ? body['proposal_id'] : '';
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (!proposalId) return json({ error: 'proposal_id_required' }, { status: 400 });
  if (!name) return json({ error: 'name_required' }, { status: 400 });

  // Proposal must be accepted to spawn a change order.
  const proposal = await ctx.env.DB.prepare(
    `SELECT id, status, opportunity_id FROM proposal WHERE id = ?`,
  )
    .bind(proposalId)
    .first<{ id: string; status: string; opportunity_id: string }>();
  if (!proposal) return json({ error: 'proposal_not_found' }, { status: 404 });
  if (proposal.status !== 'accepted') {
    return json({ error: 'proposal_not_accepted' }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const reason = typeof body['reason'] === 'string' ? body['reason'] : null;
  await ctx.env.DB.prepare(
    `INSERT INTO change_order (id, proposal_id, name, status, reason, setup_delta, monthly_delta)
     VALUES (?, ?, ?, 'draft', ?, 0, 0)`,
  )
    .bind(id, proposalId, name, reason)
    .run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.create',
    entityType: 'change_order',
    entityId: id,
    changes: { proposal_id: proposalId, name, reason, status: 'draft' },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const row = await getChangeOrder(ctx.env, id);
  return json({ change_order: row, line_items: [] }, { status: 201 });
}

// ─── Fetch ───────────────────────────────────────────────────────────

export async function fetchChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const co = await getChangeOrder(ctx.env, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  const line_items = await listChangeOrderLineItems(ctx.env, id);
  return json({ change_order: co, line_items });
}

// ─── Update ──────────────────────────────────────────────────────────

export async function updateChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const before = await getChangeOrder(ctx.env, id);
  if (!before) return json({ error: 'not_found' }, { status: 404 });
  if (before.status !== 'draft') {
    return json(
      { error: 'change_order_not_editable', status: before.status, message: 'Only draft change orders can be edited.' },
      { status: 409 },
    );
  }

  const updates: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const k of Object.keys(body)) {
    if ((CHANGE_ORDER_EDITABLE_FIELDS as readonly string[]).includes(k)) updates[k] = body[k];
    else rejected.push(k);
  }
  if (rejected.length) {
    return json(
      {
        error: 'fields_not_editable',
        fields: rejected,
        message: 'Only name, reason are editable here. Use the line-items endpoints to change scope.',
      },
      { status: 400 },
    );
  }
  if (!Object.keys(updates).length) return json({ change_order: before });
  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  await ctx.env.DB.prepare(`UPDATE change_order SET ${setClause} WHERE id = ?`)
    .bind(...Object.values(updates), id)
    .run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.update',
    entityType: 'change_order',
    entityId: id,
    changes: { updates },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const after = await getChangeOrder(ctx.env, id);
  return json({ change_order: after });
}

// ─── Delete ──────────────────────────────────────────────────────────

export async function deleteChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const co = await getChangeOrder(ctx.env, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'draft') {
    return json(
      { error: 'change_order_not_deletable', status: co.status, message: 'Only draft change orders can be deleted.' },
      { status: 409 },
    );
  }
  await ctx.env.DB.prepare(`DELETE FROM change_order WHERE id = ?`).bind(id).run();
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.delete',
    entityType: 'change_order',
    entityId: id,
    changes: { previous_status: 'draft' },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  return json({ ok: true });
}

// ─── Line items ──────────────────────────────────────────────────────

export async function addChangeOrderLineItemHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const coId = ctx.params['id'];
  if (!coId) return json({ error: 'invalid_id' }, { status: 400 });
  const body = await readJsonObject(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });

  const co = await getChangeOrder(ctx.env, coId);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'draft') {
    return json({ error: 'change_order_not_editable', status: co.status }, { status: 409 });
  }

  const action = body['action'] === 'add' || body['action'] === 'remove' ? body['action'] : null;
  const componentCode = typeof body['component_code'] === 'string' ? body['component_code'] : '';
  const quantityRaw = body['quantity'];
  const quantity = typeof quantityRaw === 'number' && quantityRaw > 0 ? quantityRaw : 1;
  if (!action) return json({ error: 'invalid_action' }, { status: 400 });
  if (!componentCode) return json({ error: 'component_code_required' }, { status: 400 });

  let comp;
  try {
    comp = await resolveSnapshotComponent(ctx.env, co.proposal_id, componentCode);
  } catch (e) {
    if (e instanceof ChangeOrderError) {
      return json({ error: e.code, message: e.message }, { status: e.httpStatus });
    }
    throw e;
  }
  const unitPrice = comp.unit_price;
  const lineTotalDelta = computeLineItemDelta(action, quantity, unitPrice);

  const id = crypto.randomUUID();
  await ctx.env.DB.prepare(
    `INSERT INTO change_order_line_item
       (id, change_order_id, action, component_code, quantity, unit_price_from_snapshot, line_total_delta, description_override)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, coId, action, componentCode, quantity, unitPrice, lineTotalDelta, typeof body['description_override'] === 'string' ? body['description_override'] : null)
    .run();

  const deltas = await recomputeChangeOrderDeltas(ctx.env, coId);

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.line_item.add',
    entityType: 'change_order',
    entityId: coId,
    changes: {
      line_item_id: id,
      action,
      component_code: componentCode,
      quantity,
      line_total_delta: lineTotalDelta,
      new_setup_delta: deltas.setup_delta,
      new_monthly_delta: deltas.monthly_delta,
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  const co_after = await getChangeOrder(ctx.env, coId);
  const lines = await listChangeOrderLineItems(ctx.env, coId);
  return json({ change_order: co_after, line_items: lines }, { status: 201 });
}

export async function deleteChangeOrderLineItemHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const coId = ctx.params['id'];
  const lineId = ctx.params['line_id'];
  if (!coId || !lineId) return json({ error: 'invalid_id' }, { status: 400 });

  const co = await getChangeOrder(ctx.env, coId);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'draft') {
    return json({ error: 'change_order_not_editable', status: co.status }, { status: 409 });
  }
  const del = await ctx.env.DB.prepare(
    `DELETE FROM change_order_line_item WHERE id = ? AND change_order_id = ?`,
  )
    .bind(lineId, coId)
    .run();
  const deletedRows = (del.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (deletedRows === 0) return json({ error: 'line_item_not_found' }, { status: 404 });

  const deltas = await recomputeChangeOrderDeltas(ctx.env, coId);
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.line_item.delete',
    entityType: 'change_order',
    entityId: coId,
    changes: {
      line_item_id: lineId,
      new_setup_delta: deltas.setup_delta,
      new_monthly_delta: deltas.monthly_delta,
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  const co_after = await getChangeOrder(ctx.env, coId);
  const lines = await listChangeOrderLineItems(ctx.env, coId);
  return json({ change_order: co_after, line_items: lines });
}

// ─── Propose / Withdraw ──────────────────────────────────────────────

export async function proposeChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const co = await getChangeOrder(ctx.env, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'draft') {
    return json({ error: 'change_order_not_proposable', status: co.status }, { status: 409 });
  }
  const lines = await listChangeOrderLineItems(ctx.env, id);
  if (lines.length === 0) {
    return json({ error: 'change_order_empty', message: 'Add at least one line item before proposing.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  await ctx.env.DB.prepare(
    `UPDATE change_order SET status = 'proposed', proposed_at = ? WHERE id = ?`,
  )
    .bind(now, id)
    .run();

  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.proposed',
    entityType: 'change_order',
    entityId: id,
    changes: {
      status: { from: 'draft', to: 'proposed' },
      proposed_at: now,
      setup_delta: co.setup_delta,
      monthly_delta: co.monthly_delta,
      line_item_count: lines.length,
    },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });

  // Notify the client. Pull contact + portal URL from the joined chain.
  const recipient = await ctx.env.DB.prepare(
    `SELECT c.primary_contact_name AS name, c.primary_contact_email AS email,
            c.company_name AS company, p.opportunity_id AS opp_id
       FROM change_order co
       JOIN proposal p ON p.id = co.proposal_id
       JOIN opportunity o ON o.id = p.opportunity_id
       JOIN client c ON c.id = o.client_id
      WHERE co.id = ?`,
  )
    .bind(id)
    .first<{ name: string | null; email: string | null; company: string; opp_id: string }>();
  if (recipient && recipient.email) {
    ctx.ctx.waitUntil(
      sendEmail(ctx.env, {
        kind: 'change_order_proposed',
        to: recipient.email,
        subject: `Change order to review — ${co.name}`,
        text: changeOrderProposedEmailText({
          name: recipient.name,
          coName: co.name,
          coId: id,
          setupDelta: co.setup_delta,
          monthlyDelta: co.monthly_delta,
        }),
        relatedEntity: { type: 'change_order', id },
      }),
    );
  }

  const after = await getChangeOrder(ctx.env, id);
  return json({ change_order: after });
}

export async function withdrawChangeOrderHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });

  const co = await getChangeOrder(ctx.env, id);
  if (!co) return json({ error: 'not_found' }, { status: 404 });
  if (co.status !== 'proposed') {
    return json({ error: 'change_order_not_withdrawable', status: co.status }, { status: 409 });
  }
  await ctx.env.DB.prepare(`UPDATE change_order SET status = 'withdrawn' WHERE id = ?`)
    .bind(id)
    .run();
  await writeAudit(ctx.env, {
    actorType: 'admin_user',
    actorId: ctx.session.subjectId,
    action: 'change_order.withdrawn',
    entityType: 'change_order',
    entityId: id,
    changes: { status: { from: 'proposed', to: 'withdrawn' } },
    ipAddress: ctx.session.ipAddress,
    userAgent: ctx.session.userAgent,
  });
  const after = await getChangeOrder(ctx.env, id);
  return json({ change_order: after });
}

// ─── Email copy (single-file swap point) ─────────────────────────────

function changeOrderProposedEmailText(args: {
  name: string | null;
  coName: string;
  coId: string;
  setupDelta: number;
  monthlyDelta: number;
}): string {
  const greeting = args.name?.trim() || 'there';
  return [
    `Hi ${greeting},`,
    '',
    `We've put together a change to your project: ${args.coName}.`,
    '',
    `  Setup adjustment:    ${formatCurrency(args.setupDelta)}`,
    `  Monthly adjustment:  ${formatCurrency(args.monthlyDelta)} / mo`,
    '',
    `Review and approve (or reject) in your portal:`,
    `  http://localhost:5173/portal/change-orders/${args.coId}`,
    '',
    `Approving signs the amendment, charges the setup adjustment now, and`,
    `the monthly adjustment takes effect at your next billing cycle.`,
    '',
    '— Bussey and Bussey',
  ].join('\n');
}

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? '-' : amount > 0 ? '+' : '';
  return `${sign}${Math.abs(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })}`;
}

// ─── helpers ─────────────────────────────────────────────────────────

async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = (await req.json()) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

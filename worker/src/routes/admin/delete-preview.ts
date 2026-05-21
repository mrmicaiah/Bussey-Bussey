import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * Delete-preview endpoints. The admin UI calls these before showing a confirm
 * dialog so the user sees what will be removed (CASCADE) or orphaned (SET NULL).
 *
 * No mutations. Each handler returns counts + a short label list of the most
 * impactful affected rows. Empty counts (zero) are still returned so the
 * dialog can flatly say "nothing else changes" rather than guessing.
 */

async function count(env: HandlerContext['env'], sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function previewLeadDelete(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const exists = await ctx.env.DB.prepare(`SELECT id FROM lead WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!exists) return json({ error: 'not_found' }, { status: 404 });

  const orphanedClients = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM client WHERE origin_lead_id = ?`,
    id,
  );

  return json({
    cascades: {},
    orphans: { clients: orphanedClients },
    note:
      orphanedClients > 0
        ? `The lead's converted client will lose its origin link (but is not deleted).`
        : `Lead has no dependents.`,
  });
}

export async function previewClientDelete(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const exists = await ctx.env.DB.prepare(`SELECT id FROM client WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!exists) return json({ error: 'not_found' }, { status: 404 });

  const opportunities = await count(ctx.env, `SELECT COUNT(*) AS n FROM opportunity WHERE client_id = ?`, id);
  const proposals = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM proposal WHERE opportunity_id IN (SELECT id FROM opportunity WHERE client_id = ?)`,
    id,
  );
  const change_orders = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM change_order WHERE proposal_id IN
       (SELECT id FROM proposal WHERE opportunity_id IN (SELECT id FROM opportunity WHERE client_id = ?))`,
    id,
  );
  const projects = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM project WHERE opportunity_id IN (SELECT id FROM opportunity WHERE client_id = ?)`,
    id,
  );
  const contracts = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM contract WHERE opportunity_id IN (SELECT id FROM opportunity WHERE client_id = ?)`,
    id,
  );
  const portal_accounts = await count(ctx.env, `SELECT COUNT(*) AS n FROM portal_account WHERE client_id = ?`, id);
  const stripe_subscriptions = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM stripe_subscription WHERE client_id = ?`,
    id,
  );
  const stripe_invoices = await count(ctx.env, `SELECT COUNT(*) AS n FROM stripe_invoice WHERE client_id = ?`, id);

  return json({
    cascades: {
      opportunities,
      proposals,
      change_orders,
      projects,
      contracts,
      portal_accounts,
      stripe_subscriptions,
      stripe_invoices,
    },
    orphans: {},
  });
}

export async function previewOpportunityDelete(ctx: HandlerContext): Promise<Response> {
  const id = ctx.params['id'];
  if (!id) return json({ error: 'invalid_id' }, { status: 400 });
  const exists = await ctx.env.DB.prepare(`SELECT id, status FROM opportunity WHERE id = ?`)
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!exists) return json({ error: 'not_found' }, { status: 404 });

  const proposals = await count(ctx.env, `SELECT COUNT(*) AS n FROM proposal WHERE opportunity_id = ?`, id);
  const change_orders = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM change_order WHERE proposal_id IN (SELECT id FROM proposal WHERE opportunity_id = ?)`,
    id,
  );
  const projects = await count(ctx.env, `SELECT COUNT(*) AS n FROM project WHERE opportunity_id = ?`, id);
  const contracts = await count(ctx.env, `SELECT COUNT(*) AS n FROM contract WHERE opportunity_id = ?`, id);
  const stripe_subscriptions = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM stripe_subscription WHERE opportunity_id = ?`,
    id,
  );
  const stripe_invoices = await count(
    ctx.env,
    `SELECT COUNT(*) AS n FROM stripe_invoice WHERE opportunity_id = ?`,
    id,
  );

  return json({
    cascades: { proposals, change_orders, projects, contracts, stripe_subscriptions, stripe_invoices },
    orphans: {},
    refuses_delete: exists.status === 'accepted',
  });
}

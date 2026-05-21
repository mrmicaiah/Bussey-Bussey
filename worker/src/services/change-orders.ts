import type { Env } from '../types/env';
import { writeAudit } from '../lib/audit';

/**
 * Change-order business logic.
 *
 * Mirrors proposals.ts's invariants:
 *   - A change order is scoped to a single proposal (typically the accepted one).
 *   - setup_delta + monthly_delta are cached on the row and recomputed on every
 *     line-item write. Any path that mutates line items MUST call
 *     `recomputeChangeOrderDeltas` in the same operation.
 *   - Line items snapshot unit_price from the proposal's pricing_snapshot at
 *     write time (`unit_price_from_snapshot`). This locks the math even if
 *     pricing_components evolves.
 *   - State machine: draft → proposed → approved | rejected | withdrawn.
 *     Mutations refused outside `draft`. Approval is a portal-side action
 *     (see worker/src/routes/portal/change-orders.ts).
 */

export class ChangeOrderError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'ChangeOrderError';
  }
}

export type ChangeOrderRow = {
  id: string;
  proposal_id: string;
  name: string;
  status: 'draft' | 'proposed' | 'approved' | 'rejected' | 'withdrawn';
  reason: string | null;
  setup_delta: number;
  monthly_delta: number;
  proposed_at: string | null;
  approved_at: string | null;
  approved_by_portal_account_id: string | null;
  created_at: string;
};

export type ChangeOrderLineItemRow = {
  id: string;
  change_order_id: string;
  action: 'add' | 'remove';
  component_code: string;
  quantity: number;
  unit_price_from_snapshot: number;
  line_total_delta: number;
  description_override: string | null;
  created_at: string;
};

type SnapshotComponent = {
  code: string;
  name: string;
  description?: string;
  category: string;
  unit_type: string;
  unit_price: number;
};

type SnapshotData = {
  components: Record<string, SnapshotComponent>;
};

export async function getChangeOrder(env: Env, id: string): Promise<ChangeOrderRow | null> {
  return env.DB.prepare(`SELECT * FROM change_order WHERE id = ?`).bind(id).first<ChangeOrderRow>();
}

export async function listChangeOrderLineItems(
  env: Env,
  changeOrderId: string,
): Promise<ChangeOrderLineItemRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM change_order_line_item WHERE change_order_id = ? ORDER BY created_at`,
  )
    .bind(changeOrderId)
    .all<ChangeOrderLineItemRow>();
  return res.results ?? [];
}

/**
 * Look up the pricing_snapshot for a proposal and resolve a component code
 * to its locked unit_price + unit_type. Throws if the component isn't in the
 * snapshot (caller probably referenced a code that didn't exist at acceptance).
 */
export async function resolveSnapshotComponent(
  env: Env,
  proposalId: string,
  componentCode: string,
): Promise<SnapshotComponent> {
  const row = await env.DB.prepare(
    `SELECT snapshot_data FROM pricing_snapshot WHERE proposal_id = ?`,
  )
    .bind(proposalId)
    .first<{ snapshot_data: string }>();
  if (!row) throw new ChangeOrderError(409, 'snapshot_missing', `No pricing_snapshot for proposal ${proposalId}.`);
  let parsed: SnapshotData;
  try {
    parsed = JSON.parse(row.snapshot_data) as SnapshotData;
  } catch {
    throw new ChangeOrderError(500, 'snapshot_corrupt');
  }
  const c = parsed.components?.[componentCode];
  if (!c) {
    throw new ChangeOrderError(
      400,
      'component_not_in_snapshot',
      `Component ${componentCode} is not in this proposal's locked snapshot.`,
    );
  }
  return c;
}

export function computeLineItemDelta(
  action: 'add' | 'remove',
  quantity: number,
  unitPrice: number,
): number {
  // Positive for adds, negative for removes. Negative quantities are rejected
  // upstream — the action enum carries the sign, not the quantity.
  const sign = action === 'add' ? 1 : -1;
  return sign * quantity * unitPrice;
}

/**
 * Recompute setup_delta and monthly_delta from all line items, then UPDATE
 * the change_order row. Mirrors `recomputeProposalTotals` for proposals.
 *
 * setup_and_monthly is a placeholder unit_type (see notes/deferred-cleanup);
 * we treat it the same way the proposal recompute does — split into both
 * buckets. For change orders this is also non-load-bearing today.
 */
export async function recomputeChangeOrderDeltas(env: Env, changeOrderId: string): Promise<{ setup_delta: number; monthly_delta: number }> {
  // Join line items to their component (via snapshot lookup) to know which
  // bucket each line contributes to. We only need the unit_type, which we
  // can look up via the proposal's snapshot. Read once.
  const co = await env.DB.prepare(`SELECT proposal_id FROM change_order WHERE id = ?`)
    .bind(changeOrderId)
    .first<{ proposal_id: string }>();
  if (!co) throw new ChangeOrderError(404, 'not_found');
  const snap = await env.DB.prepare(`SELECT snapshot_data FROM pricing_snapshot WHERE proposal_id = ?`)
    .bind(co.proposal_id)
    .first<{ snapshot_data: string }>();
  if (!snap) throw new ChangeOrderError(409, 'snapshot_missing');
  const snapData = JSON.parse(snap.snapshot_data) as SnapshotData;

  const lines = await listChangeOrderLineItems(env, changeOrderId);
  let setup = 0;
  let monthly = 0;
  for (const line of lines) {
    const comp = snapData.components[line.component_code];
    if (!comp) continue; // best-effort; should not happen if writes go through resolveSnapshotComponent
    const ut = comp.unit_type;
    if (ut === 'flat_setup' || ut === 'per_item_setup') {
      setup += line.line_total_delta;
    } else if (ut === 'flat_monthly' || ut === 'per_item_monthly') {
      monthly += line.line_total_delta;
    } else if (ut === 'setup_and_monthly') {
      setup += line.line_total_delta;
      monthly += line.line_total_delta;
    }
  }

  await env.DB.prepare(
    `UPDATE change_order SET setup_delta = ?, monthly_delta = ? WHERE id = ?`,
  )
    .bind(setup, monthly, changeOrderId)
    .run();

  return { setup_delta: setup, monthly_delta: monthly };
}

export async function writeChangeOrderAudit(
  env: Env,
  args: {
    actorType: 'admin_user' | 'portal_account' | 'system';
    actorId: string | null;
    action: string;
    entityId: string;
    changes: Record<string, unknown>;
    ipAddress: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await writeAudit(env, {
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    entityType: 'change_order',
    entityId: args.entityId,
    changes: args.changes,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
  });
}

import type { Env } from '../types/env';
import { writeAudit, shallowDiff } from '../lib/audit';
import { randomBase64Url } from '../lib/random';

/**
 * Proposal + pricing_snapshot business logic.
 *
 * Invariants (from specs/02-data-model.md and spec 05):
 *  - A proposal owns exactly one pricing_snapshot (1:1, immutable from creation).
 *  - Snapshot rates win: line items always use the snapshot rate, not the current
 *    pricing_components rate, even on subsequent draft edits.
 *  - To get fresh rates, clone. Cloning a draft/sent proposal supersedes the source
 *    and stays under the same opportunity. Cloning an accepted proposal creates a
 *    NEW opportunity under the same client and leaves the source untouched.
 *  - setup_total / monthly_total are cached on the proposal row and recomputed on
 *    every line-item or modifier write.
 *  - platform_base_* components are mutually exclusive per proposal.
 *  - Accepted proposals refuse scope/pricing edits, refuse delete, refuse line-item
 *    mutations (three-tier editability).
 */

export type ProposalRow = {
  id: string;
  opportunity_id: string;
  name: string;
  status: 'draft' | 'sent' | 'accepted' | 'superseded' | 'declined';
  setup_total: number;
  monthly_total: number;
  narrative_challenge: string | null;
  narrative_solution: string | null;
  key_capabilities: string | null;
  pricing_display_mode: 'summary' | 'categorical' | 'full';
  demo_enabled: number;
  modifiers: string | null;
  notes: string | null;
  presentation_notes: string | null;
  cloned_from_proposal_id: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  accepted_at: string | null;
};

export type SnapshotRow = {
  id: string;
  proposal_id: string;
  snapshot_data: string;
  snapshot_at: string;
};

export type LineItemRow = {
  id: string;
  proposal_id: string;
  component_code: string;
  quantity: number;
  unit_price_at_snapshot: number;
  line_total: number;
  description_override: string | null;
  created_at: string;
};

export type ComponentSnapshot = {
  code: string;
  name: string;
  description: string | null;
  category: string;
  unit_type: 'flat_setup' | 'per_item_setup' | 'flat_monthly' | 'per_item_monthly' | 'setup_and_monthly';
  unit_price: number;
};

export type SnapshotData = {
  taken_at: string;
  components: Record<string, ComponentSnapshot>;
};

export type ProposalModifiers = {
  complexity_multiplier: number;
  urgency_multiplier: number;
  custom_discount_percent: number;
};

export const DEFAULT_MODIFIERS: ProposalModifiers = {
  complexity_multiplier: 1.0,
  urgency_multiplier: 1.0,
  custom_discount_percent: 0,
};

export class ProposalError extends Error {
  status: number;
  errorCode: string;
  constructor(status: number, errorCode: string, message?: string) {
    super(message ?? errorCode);
    this.status = status;
    this.errorCode = errorCode;
  }
}

const PROPOSAL_EDITABLE_FIELDS = [
  'name',
  'narrative_challenge',
  'narrative_solution',
  'key_capabilities',
  'pricing_display_mode',
  'demo_enabled',
  'modifiers',
  'notes',
  'presentation_notes',
  'status',
] as const;

const PROPOSAL_SENT_OR_DRAFT = new Set(['draft', 'sent']);

// ── Snapshot ──────────────────────────────────────────────────────────

export async function buildSnapshotFromLiveRateCard(env: Env): Promise<SnapshotData> {
  const result = await env.DB.prepare(
    `SELECT code, name, description, category, unit_type, unit_price FROM pricing_components WHERE active = 1`,
  ).all<ComponentSnapshot>();
  const components: Record<string, ComponentSnapshot> = {};
  for (const row of result.results ?? []) {
    components[row.code] = row;
  }
  return { taken_at: new Date().toISOString(), components };
}

export function parseSnapshot(row: SnapshotRow): SnapshotData {
  return JSON.parse(row.snapshot_data) as SnapshotData;
}

export function parseModifiers(row: ProposalRow): ProposalModifiers {
  if (!row.modifiers) return { ...DEFAULT_MODIFIERS };
  try {
    const m = JSON.parse(row.modifiers) as Partial<ProposalModifiers>;
    return {
      complexity_multiplier: Number.isFinite(m.complexity_multiplier) ? Number(m.complexity_multiplier) : 1.0,
      urgency_multiplier: Number.isFinite(m.urgency_multiplier) ? Number(m.urgency_multiplier) : 1.0,
      custom_discount_percent: Number.isFinite(m.custom_discount_percent) ? Number(m.custom_discount_percent) : 0,
    };
  } catch {
    return { ...DEFAULT_MODIFIERS };
  }
}

// ── Totals ────────────────────────────────────────────────────────────

/**
 * Recompute setup_total + monthly_total from line items + modifiers, persist
 * to the proposal row, and return the cached pair. Called on every line-item
 * or modifier change.
 */
export async function recomputeProposalTotals(env: Env, proposalId: string): Promise<{ setup_total: number; monthly_total: number }> {
  const proposal = await getProposalRow(env, proposalId);
  if (!proposal) throw new ProposalError(404, 'not_found');
  const snapshot = await getSnapshotForProposal(env, proposalId);
  const snapData = parseSnapshot(snapshot);
  const mods = parseModifiers(proposal);

  const items = await env.DB.prepare(`SELECT * FROM proposal_line_item WHERE proposal_id = ?`)
    .bind(proposalId)
    .all<LineItemRow>();

  let setup = 0;
  let monthly = 0;
  for (const li of items.results ?? []) {
    const comp = snapData.components[li.component_code];
    const unitType = comp?.unit_type ?? (li.component_code === 'custom_line_item' ? 'per_item_setup' : null);
    if (!unitType) continue; // Defensive: component missing from snapshot. Audit-logged in writeAudit at insert time.
    if (unitType === 'flat_setup' || unitType === 'per_item_setup') {
      setup += li.line_total;
    } else if (unitType === 'flat_monthly' || unitType === 'per_item_monthly') {
      monthly += li.line_total;
    } else if (unitType === 'setup_and_monthly') {
      setup += li.line_total;
      monthly += li.line_total;
    }
  }

  // Apply modifiers: multiplicative then discount.
  const multiplier = mods.complexity_multiplier * mods.urgency_multiplier;
  setup *= multiplier;
  monthly *= multiplier;
  const discount = Math.max(0, Math.min(100, mods.custom_discount_percent)) / 100;
  setup = round2(setup * (1 - discount));
  monthly = round2(monthly * (1 - discount));

  await env.DB.prepare(`UPDATE proposal SET setup_total = ?, monthly_total = ?, updated_at = ? WHERE id = ?`)
    .bind(setup, monthly, new Date().toISOString(), proposalId)
    .run();

  return { setup_total: setup, monthly_total: monthly };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Fetchers ──────────────────────────────────────────────────────────

export async function getProposalRow(env: Env, id: string): Promise<ProposalRow | null> {
  return env.DB.prepare(`SELECT * FROM proposal WHERE id = ?`).bind(id).first<ProposalRow>();
}

export async function getSnapshotForProposal(env: Env, proposalId: string): Promise<SnapshotRow> {
  const row = await env.DB.prepare(`SELECT * FROM pricing_snapshot WHERE proposal_id = ?`)
    .bind(proposalId)
    .first<SnapshotRow>();
  if (!row) throw new ProposalError(500, 'snapshot_missing', `Proposal ${proposalId} has no snapshot`);
  return row;
}

export async function getLineItemsForProposal(env: Env, proposalId: string): Promise<LineItemRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM proposal_line_item WHERE proposal_id = ? ORDER BY created_at ASC`)
    .bind(proposalId)
    .all<LineItemRow>();
  return result.results ?? [];
}

// ── Create ────────────────────────────────────────────────────────────

export type CreateProposalInput = {
  opportunity_id: string;
  name: string;
  narrative_challenge?: string | null;
  narrative_solution?: string | null;
  key_capabilities?: string[] | null;
  pricing_display_mode?: 'summary' | 'categorical' | 'full';
  demo_enabled?: boolean;
  modifiers?: Partial<ProposalModifiers>;
  notes?: string | null;
  presentation_notes?: string | null;
};

export async function createProposal(env: Env, input: CreateProposalInput, actorId: string, ip: string | null, ua: string | null): Promise<{ proposal: ProposalRow; snapshot: SnapshotRow; line_items: LineItemRow[] }> {
  // 1. Verify opportunity exists.
  const opp = await env.DB.prepare(`SELECT id FROM opportunity WHERE id = ?`)
    .bind(input.opportunity_id)
    .first<{ id: string }>();
  if (!opp) throw new ProposalError(404, 'opportunity_not_found');

  // 2. Build snapshot from current live rate card.
  const snapData = await buildSnapshotFromLiveRateCard(env);

  const proposalId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const mods: ProposalModifiers = { ...DEFAULT_MODIFIERS, ...(input.modifiers ?? {}) };
  const keyCapsJson = input.key_capabilities ? JSON.stringify(input.key_capabilities) : null;

  const nowIso = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO proposal (id, opportunity_id, name, status, setup_total, monthly_total, narrative_challenge, narrative_solution, key_capabilities, pricing_display_mode, demo_enabled, modifiers, notes, presentation_notes, updated_at)
       VALUES (?, ?, ?, 'draft', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      proposalId,
      input.opportunity_id,
      input.name,
      input.narrative_challenge ?? null,
      input.narrative_solution ?? null,
      keyCapsJson,
      input.pricing_display_mode ?? 'summary',
      input.demo_enabled ? 1 : 0,
      JSON.stringify(mods),
      input.notes ?? null,
      input.presentation_notes ?? null,
      nowIso,
    ),
    env.DB.prepare(
      `INSERT INTO pricing_snapshot (id, proposal_id, snapshot_data) VALUES (?, ?, ?)`,
    ).bind(snapshotId, proposalId, JSON.stringify(snapData)),
  ]);

  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal.create',
    entityType: 'proposal',
    entityId: proposalId,
    changes: { opportunity_id: input.opportunity_id, name: input.name, snapshot_components: Object.keys(snapData.components).length },
    ipAddress: ip,
    userAgent: ua,
  });

  const proposal = (await getProposalRow(env, proposalId))!;
  const snapshot = await getSnapshotForProposal(env, proposalId);
  return { proposal, snapshot, line_items: [] };
}

// ── Update ────────────────────────────────────────────────────────────

export async function updateProposal(env: Env, id: string, body: Record<string, unknown>, actorId: string, ip: string | null, ua: string | null): Promise<ProposalRow> {
  const before = await getProposalRow(env, id);
  if (!before) throw new ProposalError(404, 'not_found');
  if (before.status === 'accepted') throw new ProposalError(409, 'proposal_accepted_immutable_scope', 'Accepted proposals are locked. Use a change order.');
  if (before.status === 'superseded' || before.status === 'declined') {
    throw new ProposalError(409, 'proposal_terminal_status', `Cannot edit a ${before.status} proposal.`);
  }

  const updates: Record<string, unknown> = {};
  for (const field of PROPOSAL_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    let value: unknown = body[field];
    if (field === 'modifiers' && value && typeof value === 'object') {
      const merged: ProposalModifiers = { ...parseModifiers(before), ...(value as Partial<ProposalModifiers>) };
      value = JSON.stringify(merged);
    } else if (field === 'key_capabilities') {
      value = Array.isArray(value) ? JSON.stringify(value) : value === null ? null : value;
    } else if (field === 'demo_enabled') {
      value = value ? 1 : 0;
    } else if (field === 'status') {
      // Status transitions allowed: draft ↔ sent, draft/sent → declined.
      // draft → sent is allowed here; sent → draft is allowed (revising).
      // Acceptance is handled by a separate disposition flow (not yet built).
      const allowed = new Set(['draft', 'sent', 'declined', 'superseded']);
      if (typeof value !== 'string' || !allowed.has(value)) {
        throw new ProposalError(400, 'invalid_status_transition', `Cannot transition to ${value}`);
      }
    }
    updates[field] = value;
  }

  if (Object.keys(updates).length === 0) return before;

  // Track first sent_at when status flips to sent for the first time.
  if (updates['status'] === 'sent' && before.status === 'draft' && !before.sent_at) {
    updates['sent_at'] = new Date().toISOString();
  }
  // Touch updated_at on every write so the public presentation polling can detect it.
  updates['updated_at'] = new Date().toISOString();

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE proposal SET ${setClause} WHERE id = ?`)
    .bind(...Object.values(updates), id)
    .run();

  // Recompute totals if modifiers changed.
  if (updates['modifiers'] !== undefined) {
    await recomputeProposalTotals(env, id);
  }

  // First-time draft → sent also flips the parent opportunity to 'proposed'
  // (Critical Relationship #5 in spec 02).
  if (updates['status'] === 'sent' && before.status === 'draft') {
    await env.DB.prepare(`UPDATE opportunity SET status = 'proposed' WHERE id = ? AND status = 'open'`)
      .bind(before.opportunity_id)
      .run();
  }

  const after = (await getProposalRow(env, id))!;

  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal.update',
    entityType: 'proposal',
    entityId: id,
    changes: shallowDiff(before as unknown as Record<string, unknown>, updates),
    ipAddress: ip,
    userAgent: ua,
  });

  return after;
}

// ── Delete ────────────────────────────────────────────────────────────

export async function deleteProposal(env: Env, id: string, actorId: string, ip: string | null, ua: string | null): Promise<void> {
  const before = await getProposalRow(env, id);
  if (!before) throw new ProposalError(404, 'not_found');
  if (before.status !== 'draft') {
    throw new ProposalError(409, 'proposal_not_draft', `Can only delete draft proposals (was ${before.status}).`);
  }
  // ON DELETE CASCADE on pricing_snapshot and proposal_line_item handles cleanup.
  await env.DB.prepare(`DELETE FROM proposal WHERE id = ?`).bind(id).run();
  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal.delete',
    entityType: 'proposal',
    entityId: id,
    changes: { deleted: before },
    ipAddress: ip,
    userAgent: ua,
  });
}

// ── Clone ─────────────────────────────────────────────────────────────

export async function cloneProposal(env: Env, sourceId: string, actorId: string, ip: string | null, ua: string | null): Promise<{ proposal: ProposalRow; snapshot: SnapshotRow; line_items: LineItemRow[] }> {
  const source = await getProposalRow(env, sourceId);
  if (!source) throw new ProposalError(404, 'not_found');

  // Determine target opportunity.
  let targetOpportunityId = source.opportunity_id;
  if (source.status === 'accepted') {
    // Create a new opportunity under the same client.
    const opp = await env.DB.prepare(`SELECT client_id, name FROM opportunity WHERE id = ?`)
      .bind(source.opportunity_id)
      .first<{ client_id: string; name: string }>();
    if (!opp) throw new ProposalError(500, 'source_opportunity_missing');
    const newOppId = crypto.randomUUID();
    const presentation_token = randomBase64Url(24);
    await env.DB.prepare(
      `INSERT INTO opportunity (id, client_id, name, presentation_token, owner_user_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(newOppId, opp.client_id, opp.name, presentation_token, actorId).run();
    await writeAudit(env, {
      actorType: 'admin_user',
      actorId,
      action: 'opportunity.create.from_clone',
      entityType: 'opportunity',
      entityId: newOppId,
      changes: { client_id: opp.client_id, name: opp.name, source_opportunity_id: source.opportunity_id, source_proposal_id: sourceId },
      ipAddress: ip,
      userAgent: ua,
    });
    targetOpportunityId = newOppId;
  }

  // Build fresh snapshot from current live rate card.
  const newSnapData = await buildSnapshotFromLiveRateCard(env);

  const newProposalId = crypto.randomUUID();
  const newSnapshotId = crypto.randomUUID();

  const cloneNowIso = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO proposal (id, opportunity_id, name, status, setup_total, monthly_total, narrative_challenge, narrative_solution, key_capabilities, pricing_display_mode, demo_enabled, modifiers, notes, presentation_notes, cloned_from_proposal_id, updated_at)
       VALUES (?, ?, ?, 'draft', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newProposalId,
      targetOpportunityId,
      source.name,
      source.narrative_challenge,
      source.narrative_solution,
      source.key_capabilities,
      source.pricing_display_mode,
      source.demo_enabled,
      source.modifiers,
      source.notes,
      source.presentation_notes,
      sourceId,
      cloneNowIso,
    ),
    env.DB.prepare(
      `INSERT INTO pricing_snapshot (id, proposal_id, snapshot_data) VALUES (?, ?, ?)`,
    ).bind(newSnapshotId, newProposalId, JSON.stringify(newSnapData)),
  ]);

  // Copy line items, refreshing rates against the new snapshot.
  const sourceItems = await getLineItemsForProposal(env, sourceId);
  for (const li of sourceItems) {
    let unitPrice: number;
    if (li.component_code === 'custom_line_item') {
      // Custom prices aren't "stale" — preserve them as-is.
      unitPrice = li.unit_price_at_snapshot;
    } else {
      const comp = newSnapData.components[li.component_code];
      // If the component was deactivated since the source snapshot, fall back to its source rate.
      unitPrice = comp ? comp.unit_price : li.unit_price_at_snapshot;
    }
    const lineTotal = round2(unitPrice * li.quantity);
    await env.DB.prepare(
      `INSERT INTO proposal_line_item (id, proposal_id, component_code, quantity, unit_price_at_snapshot, line_total, description_override)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), newProposalId, li.component_code, li.quantity, unitPrice, lineTotal, li.description_override)
      .run();
  }

  await recomputeProposalTotals(env, newProposalId);

  // Mark source superseded if it was a non-terminal status; accepted/declined/superseded stay put.
  if (PROPOSAL_SENT_OR_DRAFT.has(source.status)) {
    await env.DB.prepare(`UPDATE proposal SET status = 'superseded', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), sourceId)
      .run();
    await writeAudit(env, {
      actorType: 'admin_user',
      actorId,
      action: 'proposal.supersede',
      entityType: 'proposal',
      entityId: sourceId,
      changes: { status: { from: source.status, to: 'superseded' }, replaced_by: newProposalId },
      ipAddress: ip,
      userAgent: ua,
    });
  }

  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal.clone',
    entityType: 'proposal',
    entityId: newProposalId,
    changes: {
      cloned_from_proposal_id: sourceId,
      target_opportunity_id: targetOpportunityId,
      created_new_opportunity: targetOpportunityId !== source.opportunity_id,
      line_items_copied: sourceItems.length,
    },
    ipAddress: ip,
    userAgent: ua,
  });

  const proposal = (await getProposalRow(env, newProposalId))!;
  const snapshot = await getSnapshotForProposal(env, newProposalId);
  const line_items = await getLineItemsForProposal(env, newProposalId);
  return { proposal, snapshot, line_items };
}

// ── Line items ────────────────────────────────────────────────────────

export type AddLineItemInput = {
  component_code: string;
  quantity?: number;
  unit_price?: number; // only honored for custom_line_item
  description_override?: string | null;
};

export async function addLineItem(env: Env, proposalId: string, input: AddLineItemInput, actorId: string, ip: string | null, ua: string | null): Promise<{ line_item: LineItemRow; proposal: ProposalRow }> {
  const proposal = await getProposalRow(env, proposalId);
  if (!proposal) throw new ProposalError(404, 'not_found');
  if (proposal.status !== 'draft' && proposal.status !== 'sent') {
    throw new ProposalError(409, 'proposal_not_editable', `Can't add line items to a ${proposal.status} proposal.`);
  }

  const code = input.component_code.trim();
  if (!code) throw new ProposalError(400, 'component_code_required');

  // Mutual-exclusion check for platform_base_*.
  if (code.startsWith('platform_base_')) {
    const conflict = await env.DB.prepare(
      `SELECT id, component_code FROM proposal_line_item WHERE proposal_id = ? AND component_code LIKE 'platform_base_%' LIMIT 1`,
    )
      .bind(proposalId)
      .first<{ id: string; component_code: string }>();
    if (conflict) {
      throw new ProposalError(409, 'platform_base_already_present', `Proposal already has ${conflict.component_code}. Remove it before adding ${code}.`);
    }
  }

  const snapshot = await getSnapshotForProposal(env, proposalId);
  const snapData = parseSnapshot(snapshot);

  let unitPrice: number;
  if (code === 'custom_line_item') {
    if (typeof input.unit_price !== 'number' || !Number.isFinite(input.unit_price) || input.unit_price < 0) {
      throw new ProposalError(400, 'unit_price_required_for_custom');
    }
    unitPrice = round2(input.unit_price);
  } else {
    const comp = snapData.components[code];
    if (!comp) {
      throw new ProposalError(400, 'component_not_in_snapshot', `Component ${code} isn't in this proposal's snapshot.`);
    }
    unitPrice = comp.unit_price;
  }

  const quantity = input.quantity && Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 1;
  const lineTotal = round2(unitPrice * quantity);
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO proposal_line_item (id, proposal_id, component_code, quantity, unit_price_at_snapshot, line_total, description_override)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, proposalId, code, quantity, unitPrice, lineTotal, input.description_override ?? null)
    .run();

  await recomputeProposalTotals(env, proposalId);

  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal_line_item.create',
    entityType: 'proposal_line_item',
    entityId: id,
    changes: { proposal_id: proposalId, component_code: code, quantity, unit_price_at_snapshot: unitPrice, line_total: lineTotal },
    ipAddress: ip,
    userAgent: ua,
  });

  const line_item = (await env.DB.prepare(`SELECT * FROM proposal_line_item WHERE id = ?`).bind(id).first<LineItemRow>())!;
  const updatedProposal = (await getProposalRow(env, proposalId))!;
  return { line_item, proposal: updatedProposal };
}

export type UpdateLineItemInput = {
  quantity?: number;
  description_override?: string | null;
  unit_price?: number; // honored only for custom_line_item
};

export async function updateLineItem(env: Env, proposalId: string, lineId: string, input: UpdateLineItemInput, actorId: string, ip: string | null, ua: string | null): Promise<{ line_item: LineItemRow; proposal: ProposalRow }> {
  const proposal = await getProposalRow(env, proposalId);
  if (!proposal) throw new ProposalError(404, 'proposal_not_found');
  if (proposal.status !== 'draft' && proposal.status !== 'sent') {
    throw new ProposalError(409, 'proposal_not_editable');
  }
  const before = await env.DB.prepare(`SELECT * FROM proposal_line_item WHERE id = ? AND proposal_id = ?`)
    .bind(lineId, proposalId)
    .first<LineItemRow>();
  if (!before) throw new ProposalError(404, 'line_item_not_found');

  const updates: Record<string, unknown> = {};
  let unitPrice = before.unit_price_at_snapshot;
  let quantity = before.quantity;
  if (input.quantity !== undefined) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new ProposalError(400, 'invalid_quantity');
    quantity = input.quantity;
    updates['quantity'] = quantity;
  }
  if (input.unit_price !== undefined && before.component_code === 'custom_line_item') {
    if (!Number.isFinite(input.unit_price) || input.unit_price < 0) throw new ProposalError(400, 'invalid_unit_price');
    unitPrice = round2(input.unit_price);
    updates['unit_price_at_snapshot'] = unitPrice;
  }
  if (input.description_override !== undefined) {
    updates['description_override'] = input.description_override;
  }

  if (Object.keys(updates).length === 0) return { line_item: before, proposal };

  const newLineTotal = round2(unitPrice * quantity);
  updates['line_total'] = newLineTotal;

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE proposal_line_item SET ${setClause} WHERE id = ?`)
    .bind(...Object.values(updates), lineId)
    .run();

  await recomputeProposalTotals(env, proposalId);

  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal_line_item.update',
    entityType: 'proposal_line_item',
    entityId: lineId,
    changes: shallowDiff(before as unknown as Record<string, unknown>, updates),
    ipAddress: ip,
    userAgent: ua,
  });

  const after = (await env.DB.prepare(`SELECT * FROM proposal_line_item WHERE id = ?`).bind(lineId).first<LineItemRow>())!;
  const updatedProposal = (await getProposalRow(env, proposalId))!;
  return { line_item: after, proposal: updatedProposal };
}

export async function deleteLineItem(env: Env, proposalId: string, lineId: string, actorId: string, ip: string | null, ua: string | null): Promise<{ proposal: ProposalRow }> {
  const proposal = await getProposalRow(env, proposalId);
  if (!proposal) throw new ProposalError(404, 'proposal_not_found');
  if (proposal.status !== 'draft' && proposal.status !== 'sent') {
    throw new ProposalError(409, 'proposal_not_editable');
  }
  const before = await env.DB.prepare(`SELECT * FROM proposal_line_item WHERE id = ? AND proposal_id = ?`)
    .bind(lineId, proposalId)
    .first<LineItemRow>();
  if (!before) throw new ProposalError(404, 'line_item_not_found');

  await env.DB.prepare(`DELETE FROM proposal_line_item WHERE id = ?`).bind(lineId).run();
  await recomputeProposalTotals(env, proposalId);

  await writeAudit(env, {
    actorType: 'admin_user',
    actorId,
    action: 'proposal_line_item.delete',
    entityType: 'proposal_line_item',
    entityId: lineId,
    changes: { deleted: before },
    ipAddress: ip,
    userAgent: ua,
  });

  const updatedProposal = (await getProposalRow(env, proposalId))!;
  return { proposal: updatedProposal };
}

// ── Staleness ─────────────────────────────────────────────────────────

/** stale_after = created_at + 90 days. Stored as a derived value on the API response. */
export function staleAfterIso(createdAtIso: string): string {
  const ms = new Date(createdAtIso).getTime() + 90 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export function isStale(createdAtIso: string, status: string): boolean {
  if (status === 'accepted') return false;
  return Date.now() > new Date(createdAtIso).getTime() + 90 * 24 * 60 * 60 * 1000;
}

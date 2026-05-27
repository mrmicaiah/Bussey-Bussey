import type { Env } from '../types/env';

/**
 * audit_log writer.
 *
 * Called on every state-changing admin or portal action (create/update/delete,
 * status transitions, post-acceptance edits, login-related events). The
 * resulting rows are the defensible history for the three-tier editability
 * model — see specs/02-data-model.md Critical Relationship #13 and the
 * "Editability Rules" section.
 *
 * Polymorphic refs (`entity_id`) have no FK constraint by design; the caller
 * is responsible for writing valid (entity_type, entity_id) pairs.
 */

export type AuditEntry = {
  actorType: 'admin_user' | 'portal_account' | 'system';
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Build the audit_log INSERT as a prepared statement WITHOUT running it, so it
 * can be composed into a larger atomic DB.batch (e.g. the booking transaction).
 * `writeAudit` is the run-it-now wrapper over this — both share this one INSERT
 * definition so the row shape can never drift between callers.
 */
export function auditStatement(env: Env, entry: AuditEntry): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    entry.actorType,
    entry.actorId,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.changes !== undefined ? JSON.stringify(entry.changes) : null,
    entry.ipAddress ?? null,
    entry.userAgent ?? null,
  );
}

export async function writeAudit(env: Env, entry: AuditEntry): Promise<void> {
  await auditStatement(env, entry).run();
}

/**
 * Compute a shallow diff of `before` vs `after` for the keys present in
 * `after`. Returns null if no fields changed.
 */
export function shallowDiff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  let any = false;
  for (const key of Object.keys(after)) {
    const fromV = before[key];
    const toV = after[key as keyof T];
    if (fromV !== toV) {
      diff[key] = { from: fromV, to: toV };
      any = true;
    }
  }
  return any ? diff : null;
}

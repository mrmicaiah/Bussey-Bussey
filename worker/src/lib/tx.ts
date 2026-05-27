import type { AuditEntry } from './audit';

/**
 * The composable result of an entity-create "core".
 *
 * `id`         — the app-generated UUID for the new row (known up-front, so callers
 *                can reference it as an FK in the SAME batch without a read-back).
 * `statements` — the D1 statements that create the entity (+ any tightly-coupled
 *                writes, e.g. flipping a converted lead's status).
 * `audits`     — the audit entries describing those writes.
 *
 * This lets one create be composed into a larger atomic DB.batch (the booking
 * transaction inlines statements + audits) while the standalone HTTP handler runs
 * the same statements then `writeAudit`s the same entries — identical rows, no
 * duplicated business logic.
 */
export type CreateBuild = {
  id: string;
  statements: D1PreparedStatement[];
  audits: AuditEntry[];
};

/** Actor context threaded into the audit entries a core produces. */
export type AuditActor = { id: string; ip: string | null; ua: string | null };

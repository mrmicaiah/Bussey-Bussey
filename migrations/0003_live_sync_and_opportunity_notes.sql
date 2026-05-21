-- Migration 0003 — live-sync support + opportunity.notes
--
-- Two related additions surfaced during step H build:
--
-- 1. `proposal.updated_at` — until now we tried to derive a "last touched"
--    timestamp from MAX(proposal_line_item.created_at) for the polling
--    short-circuit. That misses line-item UPDATEs (qty/desc edits) and
--    proposal-only mutations (modifiers, narrative, display mode). With this
--    column, every proposal write touches `updated_at = now` and the
--    presentation polling endpoint compares against it directly.
--
-- 2. `opportunity.notes` — the disposition handler appends a note line for
--    each follow-up / changes-requested / declined event. The schema didn't
--    have a column for that; the `description` field is meant for the
--    initial scoping description, not a running log of touchpoints.
--
-- SQLite's `ALTER TABLE ADD COLUMN` doesn't accept non-constant defaults
-- like `strftime(...)`, so we add `proposal.updated_at` as NULL-able and
-- backfill existing rows with their `created_at`. New rows are written
-- with an explicit `updated_at` from the service layer (proposals.ts).

ALTER TABLE proposal ADD COLUMN updated_at TEXT;
UPDATE proposal SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_proposal_updated_at ON proposal(updated_at);

ALTER TABLE opportunity ADD COLUMN notes TEXT;

-- Migration 0007 — K2 schema additions
--
-- Three things, all required by step K2 (ongoing portal sections):
--
-- 1. project.updated_at — for the Project Status section's "last updated"
--    timestamp. Mirrors the proposal.updated_at pattern from migration
--    0003: nullable column, backfilled to created_at for existing rows,
--    explicit writes from the service layer on every project mutation
--    (the project PUT handler is updated alongside this migration to
--    write `updated_at = now` on every successful update).
--
-- 2. change_request — pre-change-order intake from the portal's
--    "Request a Change" form. A change_request is NOT a change_order;
--    it's a free-text description the client submits, which admin
--    reviews, scopes, and optionally converts into a change_order
--    via /api/admin/change-requests/:id/convert-to-change-order.
--    Status workflow: submitted → reviewed → declined | converted.
--    Soft FK to change_order via converted_to_change_order_id so the
--    audit trail is queryable both directions.
--
-- 3. portal_account.notify_change_orders + notify_payments —
--    notification preferences toggled in the Account section. UI ships
--    with defaults on; the actual send-side filtering is deferred (see
--    notes/deferred-cleanup.md). Stored as INT 0/1 to match the rest
--    of the schema's boolean convention.

ALTER TABLE project ADD COLUMN updated_at TEXT;
UPDATE project SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_updated_at ON project(updated_at);

CREATE TABLE IF NOT EXISTS change_request (
  id                                 TEXT PRIMARY KEY,
  client_id                          TEXT NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  opportunity_id                     TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  description                        TEXT NOT NULL,
  urgency                            TEXT NOT NULL DEFAULT 'routine'
                                       CHECK (urgency IN ('routine', 'soon', 'urgent')),
  status                             TEXT NOT NULL DEFAULT 'submitted'
                                       CHECK (status IN ('submitted', 'reviewed', 'declined', 'converted_to_change_order')),
  submitted_at                       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at                        TEXT,
  notes                              TEXT,
  -- Soft FK; the column is informational. Cascade behavior intentionally not
  -- enforced — if the converted change_order is deleted (only possible while
  -- still draft), the change_request stays pointing at the now-missing id.
  converted_to_change_order_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_change_request_client       ON change_request(client_id);
CREATE INDEX IF NOT EXISTS idx_change_request_opportunity  ON change_request(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_change_request_status       ON change_request(status);
CREATE INDEX IF NOT EXISTS idx_change_request_submitted_at ON change_request(submitted_at);

ALTER TABLE portal_account ADD COLUMN notify_change_orders INTEGER NOT NULL DEFAULT 1
  CHECK (notify_change_orders IN (0, 1));
ALTER TABLE portal_account ADD COLUMN notify_payments INTEGER NOT NULL DEFAULT 1
  CHECK (notify_payments IN (0, 1));

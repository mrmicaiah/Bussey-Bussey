-- Migration 0017 — demo_spec: dashboard lifecycle extension (§3.1)
--
-- Extends the Layer 2 demo_spec (0016) for the dashboard's Research-&-prep station:
--   * status enum widened with 'built' → full lifecycle draft → ready → handed_off → built.
--   * handed_off_at TEXT NULL — server-stamped when status moves to handed_off (written by
--     the §4.3 endpoint in a later step; the column must exist now).
--   * built_at TEXT NULL — server-stamped when status moves to built.
-- All existing columns (body, author_kind, the three FKs, created_at, updated_at) are KEPT.
--
-- Done via the 0008/0013/0015 PRAGMA foreign_keys=OFF / rebuild / re-index / ON pattern
-- (SQLite can't widen a CHECK in place). demo_spec has NO inbound FK (verified — it is a
-- leaf), so the rebuild is complication-free; only its own outbound FKs (opportunity,
-- assessment, admin_user) matter and are reattached in the new definition.
--
-- Existing rows are preserved by an explicit-column-list INSERT…SELECT of the 9 original
-- columns; the 2 new columns (handed_off_at, built_at) take NULL. Old status values
-- (draft/ready/handed_off) are all still valid under the widened CHECK.

PRAGMA foreign_keys = OFF;

CREATE TABLE demo_spec_new (
  id                  TEXT PRIMARY KEY,
  opportunity_id      TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  assessment_id       TEXT REFERENCES assessment(id) ON DELETE SET NULL,
  body                TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'handed_off', 'built')),
  author_kind         TEXT NOT NULL DEFAULT 'operator'
                        CHECK (author_kind IN ('operator', 'alice')),
  created_by_user_id  TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT,
  -- new in 0017 --
  handed_off_at       TEXT,
  built_at            TEXT
);

-- Copy the 9 existing columns; handed_off_at / built_at take NULL.
INSERT INTO demo_spec_new
  (id, opportunity_id, assessment_id, body, status, author_kind, created_by_user_id, created_at, updated_at)
SELECT
   id, opportunity_id, assessment_id, body, status, author_kind, created_by_user_id, created_at, updated_at
FROM demo_spec;

DROP TABLE demo_spec;
ALTER TABLE demo_spec_new RENAME TO demo_spec;

-- Recreate the existing indexes.
CREATE INDEX IF NOT EXISTS idx_demo_spec_opportunity ON demo_spec(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_demo_spec_status      ON demo_spec(status);
CREATE INDEX IF NOT EXISTS idx_demo_spec_assessment  ON demo_spec(assessment_id);

PRAGMA foreign_keys = ON;

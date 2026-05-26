-- Migration 0010 — script_variant (Studio44 Layer 1, §4.4)
--
-- Tracked script objects: the call-framework lines (opener / hook / discovery /
-- close) are DATA, authored by an operator OR Alice (author_kind), not static
-- copy. This is the Alice-ready hook — Alice authoring her own variant is just
-- another author_kind value, no schema change.
--
-- Created before lead_activity (0011) because lead_activity's four *_variant_id
-- columns reference this table.
--
-- Indexes: the spec (§4.4) does not enumerate indexes for this table; the card
-- fetches "active variants by stage", so (stage) and (is_active) are added as the
-- obvious query keys.

CREATE TABLE IF NOT EXISTS script_variant (
  id              TEXT PRIMARY KEY,
  stage           TEXT NOT NULL CHECK (stage IN ('opener', 'hook', 'discovery', 'close')),
  body            TEXT NOT NULL,
  author_kind     TEXT NOT NULL CHECK (author_kind IN ('operator', 'alice', 'seed')),
  author_user_id  TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  label           TEXT,
  industry        TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_script_variant_stage  ON script_variant(stage);
CREATE INDEX IF NOT EXISTS idx_script_variant_active ON script_variant(is_active);

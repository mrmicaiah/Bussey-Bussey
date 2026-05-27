-- Migration 0015 — assessment: Layer 2 prospect-workspace extension (§4.2)
--
-- Extends the Layer 1 assessment entity (0013) for the dig / build-pitch workspace:
--   * mode (dig | build_pitch) + mode_flipped_at — the forward-only mode flip, recorded.
--   * discrete per-mode note columns (operator-confirmed over a JSON blob — queryable,
--     Alice reads named fields directly): dig = notes_heard_learned / notes_research_needed
--     / notes_loose; build-pitch = build_what / build_emphasize / build_ignore /
--     build_to_price / build_notes.
--   * status widened with 'in_progress' (booked → in_progress → completed lifecycle).
--   * outcome_notes and all Layer 1 columns are KEPT — nothing is dropped.
--
-- Done via the 0008/0013 PRAGMA foreign_keys=OFF / rebuild / re-index / ON pattern,
-- because SQLite can't widen an existing CHECK in place. Existing rows — including the
-- Layer 1 booking-created assessment #1 rows — are preserved by an explicit-column-list
-- INSERT…SELECT (old statuses booked/completed/no_show/canceled/rescheduled are all
-- still valid under the widened CHECK; the 11 new columns take their defaults:
-- mode='dig', the rest NULL).
--
-- SEQUENCING: this rebuild runs BEFORE 0016 creates demo_spec, so at this point NOTHING
-- references assessment(id) (it is still a leaf — verified). That keeps the rebuild free
-- of any inbound-FK complication; demo_spec's assessment_id FK then resolves against the
-- finalized table in 0016.

PRAGMA foreign_keys = OFF;

CREATE TABLE assessment_new (
  id                       TEXT PRIMARY KEY,
  opportunity_id           TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  scheduled_at             TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'booked'
                             CHECK (status IN ('booked', 'in_progress', 'completed', 'no_show', 'canceled', 'rescheduled')),
  outcome_notes            TEXT,
  sequence_number          INTEGER NOT NULL DEFAULT 1,
  booked_from_activity_id  TEXT REFERENCES lead_activity(id) ON DELETE SET NULL,
  created_by_user_id       TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- new in 0015 (Layer 2) --
  mode                     TEXT NOT NULL DEFAULT 'dig' CHECK (mode IN ('dig', 'build_pitch')),
  mode_flipped_at          TEXT,
  -- dig-mode notes --
  notes_heard_learned      TEXT,
  notes_research_needed    TEXT,
  notes_loose              TEXT,
  -- build-pitch-mode notes --
  build_what               TEXT,
  build_emphasize          TEXT,
  build_ignore             TEXT,
  build_to_price           TEXT,
  build_notes              TEXT
);

-- Copy the 9 existing columns; the 11 new columns take their defaults.
INSERT INTO assessment_new
  (id, opportunity_id, scheduled_at, status, outcome_notes, sequence_number,
   booked_from_activity_id, created_by_user_id, created_at)
SELECT
   id, opportunity_id, scheduled_at, status, outcome_notes, sequence_number,
   booked_from_activity_id, created_by_user_id, created_at
FROM assessment;

DROP TABLE assessment;
ALTER TABLE assessment_new RENAME TO assessment;

-- Recreate the existing indexes …
CREATE INDEX IF NOT EXISTS idx_assessment_opportunity ON assessment(opportunity_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_assessment_status      ON assessment(status);
CREATE INDEX IF NOT EXISTS idx_assessment_scheduled   ON assessment(scheduled_at);
-- … plus a new one for mode-filtered queries.
CREATE INDEX IF NOT EXISTS idx_assessment_mode        ON assessment(mode);

PRAGMA foreign_keys = ON;

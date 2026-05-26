-- Migration 0013 — assessment (Studio44 Layer 1, §4.3 — LOCKED shape)
--
-- First-class assessment entity (resolves master §10 open decision #1 in favor of
-- YES). The Leads wizard's booking action creates assessment #1; working/editing
-- assessments is Layer 2 (this layer only ever CREATEs).
--
-- booked_from_activity_id back-links to the lead_activity row (kind='booked') that
-- produced this assessment — closing the attribution loop (which call / which
-- opener produced this booking). Created after lead_activity (0011) for that FK.
--
-- FK ON DELETE: opportunity_id CASCADE per the §4.3 contract. booked_from_activity_id
-- and created_by_user_id are SET NULL so the assessment survives the linked activity
-- or operator being removed.

CREATE TABLE IF NOT EXISTS assessment (
  id                       TEXT PRIMARY KEY,
  opportunity_id           TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  scheduled_at             TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'booked'
                             CHECK (status IN ('booked', 'completed', 'no_show', 'canceled', 'rescheduled')),
  outcome_notes            TEXT,
  sequence_number          INTEGER NOT NULL DEFAULT 1,
  booked_from_activity_id  TEXT REFERENCES lead_activity(id) ON DELETE SET NULL,
  created_by_user_id       TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_opportunity ON assessment(opportunity_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_assessment_status      ON assessment(status);
CREATE INDEX IF NOT EXISTS idx_assessment_scheduled   ON assessment(scheduled_at);

-- Migration 0011 — lead_activity (Studio44 Layer 1, §4.1)
--
-- The lead-level timeline, built for attribution. One row per logged interaction
-- with a lead. Every row ties an OUTCOME to the exact script VARIANTS used, the
-- INDUSTRY at the time, the ATTEMPT number, and the card DWELL time — the formula
-- substrate and the A/B dataset Alice reads in Layer 4 (the operator's "over-track"
-- mandate, encoded).
--
-- Closes Layer 1 backend gap #1: leads previously had no activity log of their own
-- (calling_log attaches only to calling_list_item).
--
-- FK ON DELETE choices: the four *_variant_id columns and created_by_user_id use
-- SET NULL so an activity (and its attribution) survives a variant being deleted or
-- an operator being removed — matching lead.owner_user_id's SET NULL convention.
-- session_id is plain TEXT with no FK: Layer 1 has no session ENTITY (the session/
-- queue endpoints in §5.2 are runtime constructs; §4 defines no session table), and
-- the §4.1 contract lists no FK for it.

CREATE TABLE IF NOT EXISTS lead_activity (
  id                    TEXT PRIMARY KEY,
  lead_id               TEXT NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL
                          CHECK (kind IN ('call', 'callback', 'voicemail', 'no_answer',
                                          'dead_number', 'do_not_call', 'skipped',
                                          'booked', 'note')),
  outcome               TEXT,
  attempt_number        INTEGER,
  industry_at_time      TEXT,
  opener_variant_id     TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  hook_variant_id       TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  discovery_variant_id  TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  close_variant_id      TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  card_dwell_ms         INTEGER,
  phone_duration_s      INTEGER,
  session_id            TEXT,
  notes                 TEXT,
  created_by_user_id    TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_activity_lead    ON lead_activity(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_activity_kind    ON lead_activity(kind);
CREATE INDEX IF NOT EXISTS idx_lead_activity_opener  ON lead_activity(opener_variant_id);
CREATE INDEX IF NOT EXISTS idx_lead_activity_hook    ON lead_activity(hook_variant_id);
CREATE INDEX IF NOT EXISTS idx_lead_activity_session ON lead_activity(session_id);

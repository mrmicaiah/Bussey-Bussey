-- Migration 0009 — lead: additive calling-wizard columns (Studio44 Layer 1, §4.2)
--
-- Adds four columns the Leads wizard needs:
--   * next_followup_at  — drives the Follow-ups station.
--   * attempt_count     — denormalized running touch count (source of truth is
--                         lead_activity; cached here to keep the card fast).
--   * do_not_call       — suppress the lead from all calling sessions.
--   * is_dead_number    — suppress the lead from all calling sessions.
-- (The existing last_contacted_at column — present since 0001, unused in UI —
--  is reused by Layer 1, no schema change needed.)
--
-- Done via the same PRAGMA foreign_keys=OFF / rebuild / re-index / ON pattern as
-- migration 0008, per the Layer 1 spec (§4.2: "rebuild per 0008 pattern; do NOT
-- drop data"). This runs BEFORE the new Layer 1 tables (0011+) so `lead` reaches
-- its final 20-column shape before anything references it — at this point the
-- only inbound FK is client.origin_lead_id, exactly as in 0008. The FK is encoded
-- by name in the client table; recreating `lead` under the same name reattaches it
-- once enforcement is re-enabled.

PRAGMA foreign_keys = OFF;

CREATE TABLE lead_new (
  id                        TEXT PRIMARY KEY,
  name                      TEXT,
  email                     TEXT,
  phone                     TEXT,
  company                   TEXT,
  industry                  TEXT,
  source                    TEXT CHECK (source IS NULL OR source IN ('chat', 'manual', 'referral', 'event', 'calling_list')),
  origin_chat_session_id    TEXT REFERENCES chat_session(id) ON DELETE SET NULL,
  pain_summary              TEXT,
  urgency                   TEXT CHECK (urgency IS NULL OR urgency IN ('immediate', 'weeks', 'months', 'exploring')),
  status                    TEXT NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'reviewed', 'contacted', 'qualified', 'disqualified', 'converted')),
  notes                     TEXT,
  notification_sent_at      TEXT,
  owner_user_id             TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  last_contacted_at         TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- new in 0009 --
  next_followup_at          TEXT,
  attempt_count             INTEGER NOT NULL DEFAULT 0,
  do_not_call               INTEGER NOT NULL DEFAULT 0 CHECK (do_not_call IN (0, 1)),
  is_dead_number            INTEGER NOT NULL DEFAULT 0 CHECK (is_dead_number IN (0, 1))
);

-- Copy the existing 16 columns; the 4 new columns take their defaults.
INSERT INTO lead_new
  (id, name, email, phone, company, industry, source, origin_chat_session_id,
   pain_summary, urgency, status, notes, notification_sent_at, owner_user_id,
   last_contacted_at, created_at)
SELECT
   id, name, email, phone, company, industry, source, origin_chat_session_id,
   pain_summary, urgency, status, notes, notification_sent_at, owner_user_id,
   last_contacted_at, created_at
FROM lead;

DROP TABLE lead;
ALTER TABLE lead_new RENAME TO lead;

-- Recreate the original indexes …
CREATE INDEX IF NOT EXISTS idx_lead_status        ON lead(status);
CREATE INDEX IF NOT EXISTS idx_lead_email         ON lead(email);
CREATE INDEX IF NOT EXISTS idx_lead_origin_chat   ON lead(origin_chat_session_id);
CREATE INDEX IF NOT EXISTS idx_lead_owner         ON lead(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_created       ON lead(created_at);
-- … plus the queue-building indexes new in 0009.
CREATE INDEX IF NOT EXISTS idx_lead_followup      ON lead(next_followup_at);
CREATE INDEX IF NOT EXISTS idx_lead_queue         ON lead(status, do_not_call, is_dead_number);

PRAGMA foreign_keys = ON;

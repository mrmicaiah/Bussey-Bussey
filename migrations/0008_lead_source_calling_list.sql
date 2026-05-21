-- Migration 0008 — lead.source += 'calling_list'
--
-- Step L (calling list) introduces a path where a calling_list_item can
-- be converted into a `lead` row. Per spec 11 the resulting lead's
-- source is `'calling_list'`. The existing lead.source CHECK enum
-- (chat | manual | referral | event) doesn't include that value, and
-- SQLite has no `ALTER TABLE ... ALTER CHECK` — so we rebuild.
--
-- Rebuild approach:
--   1. PRAGMA foreign_keys = OFF for the duration of the rewrite, so
--      the inbound FK from `client.origin_lead_id` doesn't fire
--      mid-migration. The FK is encoded by name in the client table's
--      schema; recreating `lead` under the same name reattaches it
--      after we re-enable enforcement.
--   2. Create `lead_new` with the expanded CHECK.
--   3. Copy all rows.
--   4. Drop the old `lead` table (CASCADE? No — SQLite RESTRICTs but
--      with FKs disabled the drop just succeeds).
--   5. Rename `lead_new` → `lead`.
--   6. Recreate every index that pointed at `lead`.
--   7. PRAGMA foreign_keys = ON.

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
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO lead_new SELECT * FROM lead;

DROP TABLE lead;
ALTER TABLE lead_new RENAME TO lead;

CREATE INDEX IF NOT EXISTS idx_lead_status        ON lead(status);
CREATE INDEX IF NOT EXISTS idx_lead_email         ON lead(email);
CREATE INDEX IF NOT EXISTS idx_lead_origin_chat   ON lead(origin_chat_session_id);
CREATE INDEX IF NOT EXISTS idx_lead_owner         ON lead(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_created       ON lead(created_at);

PRAGMA foreign_keys = ON;

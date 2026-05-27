-- Migration 0018 — cold_calling_target (Studio44 Dashboard, §3.2) — NEW table
--
-- The operator's per-week cold-calling target OVERRIDE. The *suggested* target
-- (25/30/40 based on funnel state) is computed on read, not stored; this table only
-- holds an operator's explicit override for a given ISO week, which supersedes the
-- suggestion. One row per operator per week (UNIQUE constraint).
--
-- `target` has NO DB-level range check by design — range validation (5..100) lives in
-- the §4.2 write endpoint (a later step), per the spec.

CREATE TABLE IF NOT EXISTS cold_calling_target (
  id             TEXT PRIMARY KEY,
  admin_user_id  TEXT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  iso_week       TEXT NOT NULL,                          -- ISO-8601 week, e.g. '2026-W22'
  target         INTEGER NOT NULL,                       -- range-validated in the API, not here
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  UNIQUE (admin_user_id, iso_week)
);
CREATE INDEX IF NOT EXISTS idx_cold_calling_target_user_week ON cold_calling_target(admin_user_id, iso_week);

-- Migration 0022 — card_activity table (Studio44 Calls layer step 1, spec §3.2)
--
-- REVISED from the earlier dual-key draft. An earlier version of the spec added
-- calling_list_item_id to lead_activity with a "exactly one of (lead_id,
-- calling_list_item_id) non-null" invariant. That is unsatisfiable: lead_activity.
-- lead_id is NOT NULL (migration 0011), so a card-only row (lead_id null) cannot
-- be inserted, and relaxing it requires a full SQLite table rebuild of a table
-- the Layer 1 wizard already reads — large blast radius for an API-only invariant.
--
-- Per spec §3, the revised approach is a SEPARATE card_activity table mirroring
-- lead_activity's shape but keyed to calling_list_item. A card_activity row stays
-- on the card forever; at promote-time the handler ALSO writes a copy into
-- lead_activity (so Layer 1's prior-attempts join keeps working unmodified).
-- Bounded duplication (one copy per promoting call) bought for large operational
-- simplicity. The 0023 view UNIONs the two tables for unified reads.
--
-- Column names / FK shapes mirror lead_activity (0011) so Alice's query writing
-- stays uniform. The four script_variant FKs carry ON DELETE SET NULL to match
-- lead_activity (0011) — an activity row (and its attribution) survives a variant
-- being deleted. created_at uses datetime('now') per spec §3.2.

CREATE TABLE card_activity (
  id TEXT PRIMARY KEY,
  calling_list_item_id TEXT NOT NULL REFERENCES calling_list_item(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'call',
  outcome TEXT,                      -- voicemail | no_answer | gatekeeper | spoke_qualified | spoke_not_interested | ...
  attempt_number INTEGER NOT NULL,
  industry_at_time TEXT,
  opener_variant_id TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  hook_variant_id TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  discovery_variant_id TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  close_variant_id TEXT REFERENCES script_variant(id) ON DELETE SET NULL,
  card_dwell_ms INTEGER,
  phone_duration_s INTEGER,
  session_id TEXT,
  notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_card_activity_card_id ON card_activity(calling_list_item_id);
CREATE INDEX IF NOT EXISTS idx_card_activity_created_at ON card_activity(created_at);

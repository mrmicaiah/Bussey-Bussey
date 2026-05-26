-- Migration 0012 — script_variant_usage (Studio44 Layer 1, §4.4)
--
-- Append-only usage log: the operator's "dates / times / number of times used"
-- requirement plus outcome attribution. The card's inline "used N×, booked M,
-- book-rate%" stats are rollups over this table (computed on read in Layer 1; a
-- cached counter on script_variant is optional and deferred). Alice reads exactly
-- this in Layer 4 to coach and A/B test.
--
-- Created after lead_activity (0011) because activity_id references it.
--
-- FK ON DELETE: variant_id CASCADE per the §4.4 contract (usage is meaningless
-- without its variant). lead_id and activity_id are SET NULL so a usage row — and
-- the rollup it feeds — survives the lead or activity being deleted.

CREATE TABLE IF NOT EXISTS script_variant_usage (
  id           TEXT PRIMARY KEY,
  variant_id   TEXT NOT NULL REFERENCES script_variant(id) ON DELETE CASCADE,
  lead_id      TEXT REFERENCES lead(id) ON DELETE SET NULL,
  activity_id  TEXT REFERENCES lead_activity(id) ON DELETE SET NULL,
  outcome      TEXT,
  used_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_svu_variant_used    ON script_variant_usage(variant_id, used_at);
CREATE INDEX IF NOT EXISTS idx_svu_variant_outcome ON script_variant_usage(variant_id, outcome);

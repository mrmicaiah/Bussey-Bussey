-- Migration 0016 — demo_spec (Studio44 Layer 2, §4.1) — NEW entity
--
-- The prose brief a Studio87 manager builds a demo from: what to build / emphasize /
-- ignore / the value to land. Free-form prose `body` (operator was explicit — a
-- prompt/brief, NOT a structured requirements form), with its own lifecycle.
--
-- One of the two handoff outputs (the other is the existing `proposal` entity — not
-- touched here). assessment_id back-links to the build-pitch assessment that produced
-- it (attribution). author_kind includes 'alice' so her L4 authoring is a no-schema-
-- change extension (mirrors script_variant.author_kind).
--
-- Created AFTER 0015 so the assessment_id FK resolves against the finalized assessment
-- table. FK ON DELETE: opportunity_id CASCADE (the deal owns the spec); assessment_id
-- and created_by_user_id SET NULL (spec survives the source assessment or operator
-- being removed).

CREATE TABLE IF NOT EXISTS demo_spec (
  id                  TEXT PRIMARY KEY,
  opportunity_id      TEXT NOT NULL REFERENCES opportunity(id) ON DELETE CASCADE,
  assessment_id       TEXT REFERENCES assessment(id) ON DELETE SET NULL,
  body                TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'handed_off')),
  author_kind         TEXT NOT NULL DEFAULT 'operator'
                        CHECK (author_kind IN ('operator', 'alice')),
  created_by_user_id  TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_demo_spec_opportunity ON demo_spec(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_demo_spec_status      ON demo_spec(status);
CREATE INDEX IF NOT EXISTS idx_demo_spec_assessment  ON demo_spec(assessment_id);

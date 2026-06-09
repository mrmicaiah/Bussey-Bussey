-- Migration 0019 — demo_spec: add demo_url (Studio44 Presentation room step 1)
--
-- The URL the operator iframes during the live presentation (Tab 1, the
-- client-safe screen-share surface). The operator pastes it at handoff time —
-- when the Studio87 chat returns a built demo — or fills it in later via the
-- demo-spec PUT endpoint (PUT /api/admin/demo-specs/:id accepts {demo_url}).
-- Nullable: a demo_spec exists from handoff onward, but its URL arrives only
-- once the demo is actually built, so the column is empty until then.
--
-- Additive nullable column → a plain ALTER ADD COLUMN suffices (no table
-- rebuild needed; demo_spec has no CHECK/enum change here). All existing rows
-- keep demo_url = NULL.

ALTER TABLE demo_spec ADD COLUMN demo_url TEXT;

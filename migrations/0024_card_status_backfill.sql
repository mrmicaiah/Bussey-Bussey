-- Migration 0024 — card_status backfill for already-converted cards
--                   (Studio44 Calls layer step 1)
--
-- Cards that were converted to a lead under the legacy 0001 path carry
-- converted_lead_id but predate the 0021 card_status / promoted_lead_id fields.
-- This brings them onto the new card lifecycle: mark them 'promoted' and copy
-- converted_lead_id into promoted_lead_id so the 0023 history view's promoted
-- branch resolves for them too.
--
-- Touches ONLY columns added by 0021 (card_status, promoted_lead_id), so it is
-- safe on a fresh DB (zero matching rows) and on an existing one alike.
--
-- IDEMPOTENT: the `AND card_status != 'promoted'` predicate (spec §3.4) makes the
-- no-op-on-rerun explicit in the SQL itself — already-promoted rows are skipped, so
-- re-running touches zero rows. Stable across runs and safe on a fresh DB.

UPDATE calling_list_item
   SET card_status      = 'promoted',
       promoted_lead_id = converted_lead_id
 WHERE converted_lead_id IS NOT NULL
   AND card_status != 'promoted';  -- idempotent: skip already-promoted

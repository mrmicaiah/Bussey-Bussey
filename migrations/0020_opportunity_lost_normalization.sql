-- Migration 0020 — opportunity: lost_notes / lost_at + lost_reason enum normalization
--                   (Studio44 Presentation room step 1)
--
-- The "No deal" disposition path needs to capture WHY and WHEN a deal was lost,
-- and to converge the historically free-text lost_reason onto a closed enum.
--
--   * lost_notes TEXT NULL — free-form notes from the No-deal sub-flow (the
--     composed "Other: <text> — <thread notes>" string).
--   * lost_at    TEXT NULL — ISO-8601 timestamp, server-stamped when the
--     opportunity moves to 'lost' via the disposition endpoint.
--
-- lost_reason already exists (migration 0001) as a free-text column carrying
-- historical values. We are converging on a closed 6-value enum:
--     price | timing | not_a_fit | went_with_competitor | silent | other
-- The UPDATE below maps existing free-text onto that enum.
--
-- NO DB-level CHECK constraint is added on lost_reason — validation is enforced
-- API-side only (disposition.ts), because historical data may carry edge cases
-- we deliberately want to preserve as 'other' rather than reject.
--
-- IDEMPOTENCY: the CASE is keyed on lower(lost_reason) and every one of the six
-- enum outputs re-maps to itself (e.g. 'price' matches '%price%' → 'price'),
-- so re-running this migration is a no-op on already-normalized data. Branch
-- order encodes precedence when a value matches more than one bucket
-- (price > timing > not_a_fit > went_with_competitor > silent > other), matching
-- the canonical enum order.

ALTER TABLE opportunity ADD COLUMN lost_notes TEXT;
ALTER TABLE opportunity ADD COLUMN lost_at TEXT;

UPDATE opportunity
SET lost_reason = CASE
  WHEN lost_reason IS NULL OR trim(lost_reason) = '' THEN 'other'
  WHEN lower(lost_reason) LIKE '%price%'
    OR lower(lost_reason) LIKE '%cost%'
    OR lower(lost_reason) LIKE '%expensive%' THEN 'price'
  WHEN lower(lost_reason) LIKE '%timing%'
    OR lower(lost_reason) LIKE '%time%'
    OR lower(lost_reason) LIKE '%later%'
    OR lower(lost_reason) LIKE '%not now%' THEN 'timing'
  WHEN lower(lost_reason) LIKE '%fit%' THEN 'not_a_fit'
  WHEN lower(lost_reason) LIKE '%competitor%'
    OR lower(lost_reason) LIKE '%other vendor%'
    OR lower(lost_reason) LIKE '%went with%' THEN 'went_with_competitor'
  WHEN lower(lost_reason) LIKE '%silent%'
    OR lower(lost_reason) LIKE '%ghosted%'
    OR lower(lost_reason) LIKE '%no response%' THEN 'silent'
  ELSE 'other'
END;

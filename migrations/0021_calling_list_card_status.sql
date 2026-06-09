-- Migration 0021 — calling_list_item: card_status lifecycle fields
--                   (Studio44 Calls layer step 1)
--
-- The calling list becomes a card-based pipeline. Each calling_list_item is a
-- "card" that moves through a lifecycle independent of the legacy `status`
-- column (which 0001 still owns for the CSV-import / convert-to-lead path).
--
-- New columns:
--   * card_status      — the card lifecycle enum (see below). DEFAULT 'pending'.
--   * attempt_count    — number of call attempts made against the card.
--   * next_action_date — YYYY-MM-DD the card is next due (drives the queue).
--   * promoted_lead_id — the lead this card was promoted into (SET NULL on
--                        lead delete, mirroring converted_lead_id's convention).
--   * last_outcome     — free-text snapshot of the most recent call outcome,
--                        for fast card rendering without a lead_activity join.
--
-- card_status enum values (enforced API-side, NOT by a DB CHECK constraint):
--     pending        — never actioned; sitting in the list
--     in_progress    — actively being worked (mid call session / sequence)
--     done           — worked to a terminal non-conversion (e.g. completed,
--                      not interested) but not disqualified
--     dead           — unreachable / bad number; no further attempts
--     disqualified   — screened out (not a fit)
--     promoted       — converted into a lead (see promoted_lead_id)
--
-- NO DB-level CHECK constraint is added on the enum columns. This is deliberate:
-- backfill (0024) and future card-status additions need the flexibility to write
-- values without a migration to widen a CHECK, matching the 0020 convention.

ALTER TABLE calling_list_item ADD COLUMN card_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE calling_list_item ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calling_list_item ADD COLUMN next_action_date TEXT;
ALTER TABLE calling_list_item ADD COLUMN promoted_lead_id TEXT REFERENCES lead(id) ON DELETE SET NULL;
ALTER TABLE calling_list_item ADD COLUMN last_outcome TEXT;

-- Indexes (per spec §3.1 — the queue filters by card_status, resurfaces by
-- next_action_date, and the history view resolves promoted_lead_id).
CREATE INDEX IF NOT EXISTS idx_calling_list_item_card_status ON calling_list_item(card_status);
CREATE INDEX IF NOT EXISTS idx_calling_list_item_next_action_date ON calling_list_item(next_action_date);
CREATE INDEX IF NOT EXISTS idx_calling_list_item_promoted_lead_id ON calling_list_item(promoted_lead_id);

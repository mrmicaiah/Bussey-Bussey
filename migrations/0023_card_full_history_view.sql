-- Migration 0023 — v_card_full_history view (Studio44 Calls layer step 1, spec §3.3)
--
-- The canonical "everything ever logged about this card" query. A card's timeline
-- spans two tables now:
--   Branch 1 — card_activity: the card's own pre-promotion (cold) activity.
--   Branch 2 — lead_activity: the lead's post-promotion (warm) activity, reachable
--              via the card's promotion FK (promoted_lead_id, or the legacy
--              converted_lead_id from the 0008 convert path).
--
-- Both branches project the IDENTICAL 19-column shape so the UNION ALL aligns with
-- no reshaping. A `source_table` discriminator ('card' | 'lead') lets readers tell
-- cold activity from warm. Queryable by card via `source_card_id`. Alice reads this
-- at L4. Copied verbatim from spec §3.3.

CREATE VIEW IF NOT EXISTS v_card_full_history AS
-- Branch 1: card's own pre-promotion activity
SELECT
  ca.id AS activity_id,
  cli.id AS source_card_id,
  cli.promoted_lead_id,
  cli.converted_lead_id,
  ca.kind, ca.outcome, ca.attempt_number, ca.industry_at_time,
  ca.opener_variant_id, ca.hook_variant_id, ca.discovery_variant_id, ca.close_variant_id,
  ca.card_dwell_ms, ca.phone_duration_s, ca.session_id, ca.notes,
  ca.created_by_user_id, ca.created_at,
  'card' AS source_table
FROM card_activity ca
JOIN calling_list_item cli ON ca.calling_list_item_id = cli.id
UNION ALL
-- Branch 2: post-promotion lead activity (via the card's promotion FK)
SELECT
  la.id AS activity_id,
  cli.id AS source_card_id,
  cli.promoted_lead_id,
  cli.converted_lead_id,
  la.kind, la.outcome, la.attempt_number, la.industry_at_time,
  la.opener_variant_id, la.hook_variant_id, la.discovery_variant_id, la.close_variant_id,
  la.card_dwell_ms, la.phone_duration_s, la.session_id, la.notes,
  la.created_by_user_id, la.created_at,
  'lead' AS source_table
FROM lead_activity la
JOIN calling_list_item cli ON la.lead_id = cli.promoted_lead_id OR la.lead_id = cli.converted_lead_id;

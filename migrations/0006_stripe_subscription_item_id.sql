-- Migration 0006 — stripe_subscription.stripe_item_id
--
-- Added during step K1 to support change-order monthly_delta updates.
--
-- When the activation flow creates a Stripe Subscription (step J2's
-- setup-payment endpoint), Stripe returns the new subscription with an
-- `items.data[0].id` — a stable handle for that pricing line. To update
-- the monthly amount later (when a client approves a change order with
-- monthly_delta ≠ 0), the Stripe API needs that item ID in the PUT
-- /v1/subscriptions/:id body to avoid creating a duplicate item.
--
-- This column stores the ID so we don't need a Stripe GET round-trip on
-- every change-order approval. Existing rows (from J2 smoke testing) are
-- left NULL; change orders against those will fall back to refusing the
-- monthly_delta update with a clean error pointing at the missing field
-- — acceptable for the smoke-test fixtures since they were created with
-- dev-placeholder Stripe IDs anyway.

ALTER TABLE stripe_subscription ADD COLUMN stripe_item_id TEXT;

# Step K1 — Smoke Test Results (2026-05-20)

The K1 cut of step K (admin change-order builder + portal review/approve
with Stripe operations) verified end-to-end against the running wrangler
dev + local D1. Same harness as previous smoke tests — curl + wrangler
d1 execute. Dev-placeholder Stripe mode throughout.

## What's verified

### Schema + plumbing

- Migration 0006 applied (`stripe_subscription.stripe_item_id`,
  nullable). `setup-payment` now stores the item id (or a `dev_si_*`
  synthetic in dev). Stripe service gained
  `updateSubscriptionItemPrice` for real-mode CO approvals.

### Admin backend (`worker/src/routes/admin/change-orders.ts`)

- `GET /api/admin/change-orders?opportunity_id=` → list (empty pre-create).
- `POST /api/admin/change-orders` → creates draft (refuses proposal not
  in `accepted` state).
- `POST /:id/line-items` → resolves component price from the proposal's
  pricing_snapshot, computes `line_total_delta` (signed by action),
  recomputes setup/monthly deltas. Verified across multiple line items:
  one `standard_table` (per_item_setup, $350) + one `premium_support`
  (flat_monthly, $500) → setup_delta=350, monthly_delta=500.
- `POST /:id/propose` → refuses if empty (400 `change_order_empty`);
  refuses if not draft; on success advances to `proposed`, writes
  `proposed_at`, sends `change_order_proposed` email.
- `PUT /:id` on proposed → 409 `change_order_not_editable`.
- `POST /:id/withdraw` → proposed → withdrawn. Subsequent portal-side
  approve attempt → 409.

### Portal backend (`worker/src/routes/portal/change-orders.ts`)

- `GET /api/portal/change-orders` → lists non-draft COs joined via
  `portal_account → client → opportunity → proposal → change_order`.
  Drafts are intentionally hidden.
- `GET /:id` → detail + line items. Drafts return 404 to clients.
- `POST /:id/approve` happy path (dev placeholder):
  - Captures signature (`document_signature` with
    `signature_type='agreement_acceptance'`, `document_type='change_order'`,
    `document_id` = CO id, `typed_name` = client's typed legal name).
  - Synthetic Stripe IDs for the setup-delta invoice
    (`dev_in_*`, kind=`change_order_setup`, amount=setup_delta, status=paid).
  - `stripe_subscription.current_amount_monthly` updated from $1000 → $1500.
  - Audit cascade in a single batch: umbrella `change_order.approved`
    (on the change_order entity) + per-entity `stripe_invoice.create`
    + `stripe_subscription.update`.
  - Returns the full result payload to the client.
- `POST /:id/approve` rejection paths:
  - Missing `typed_name` → 400 `signature_required`.
  - State ≠ proposed → 409 `change_order_not_approvable`.
  - Second approve after success → 409 (state advanced).
- `POST /:id/reject` → status=rejected, audit row with reason captured,
  no Stripe activity (stripe_invoice count stays at the pre-reject
  value), no document_signature written.

### Frontend

- Admin opportunity detail page: Change Orders section appears when
  status=accepted. Lists existing COs with status badge, deltas, and
  Open → link. "New change order" creates a draft and navigates to the
  builder.
- Admin change-order builder
  (`/admin/clients/[id]/opportunities/[opp_id]/change-orders/[co_id]/`):
  edit name + reason (draft only), add/remove line items from a
  snapshot-driven component picker, see live net impact, Propose
  (draft → proposed) or Delete (draft only) or Withdraw (proposed →
  withdrawn). Terminal states locked.
- Portal change-orders list
  (`/portal/change-orders`): split into "Pending your review" +
  "Past." Cards link to detail.
- Portal change-order detail
  (`/portal/change-orders/[co_id]`): renders line items + deltas,
  prompts for typed legal name + agreement checkbox, Approve / Reject
  CTAs. Reject opens a modal asking for an optional reason. Approve
  shows error inline on Stripe decline, retries supported.
- All three packages pass typecheck: worker `tsc` clean, admin
  `svelte-check` 0 errors / 0 warnings (304 files), portal
  `svelte-check` 0 errors / 0 warnings (346 files).

## Audit cascade observed for one approval

```
change_order.create              entity_type=change_order
change_order.line_item.add       entity_type=change_order  (×2)
change_order.proposed            entity_type=change_order
change_order.approved            entity_type=change_order  ← umbrella
stripe_invoice.create            entity_type=stripe_invoice ← per-entity
stripe_subscription.update       entity_type=stripe_subscription ← per-entity
```

Matches the project's cascade pattern (umbrella on the primary entity +
per-entity rows for every side effect).

## Plaintext leak check

Two `audit_log.changes` rows contain the string "Pat Tester," both
intentional:

- `client.create` — `primary_contact_name` field is legitimately recorded
  in the create event.
- `contract.signed` (from J1) — the `typed_fields` payload captures
  print/date marker values as documented in the J1 smoke-test runbook.

The change-order approval's typed-name signature is NOT in `audit_log`;
it lives only in `document_signature`. Confirmed.

## State left in local D1

- Pat's opportunity has three change orders:
  - `Q3 ramp expansion` — approved (setup_delta=350, monthly_delta=500).
    Subscription's `current_amount_monthly` is now $1500.
  - `Extra dashboard` — rejected by Pat (reason captured).
  - `To be withdrawn` — withdrawn by admin after proposing.
- One additional `stripe_invoice` row for the change-order setup
  delta (kind=change_order_setup, $350, paid). Pat's subscription's
  next monthly charge will be $1500 instead of $1000.

## Out of scope (lands in K2)

- Portal home / Overview page (the consolidated dashboard).
- Documents section (contract list with view/download/audit).
- Payment & Billing section (invoice history, payment method update).
- Project Status section (current_phase / build_status_note display).
- Request a Change form (client-side intake form → change_request entity).
- Account section (signature audit history, change password, notification
  prefs).
- Real Stripe test-mode verification (still gated on user installing a
  real `sk_test_…` key).

## Cleanup

- The wrangler dev process is still running.
- Smoke-test rows are useful fixtures for K2 (Pat has approved + rejected
  + withdrawn COs visible from the portal lists). Safe to wipe with
  `wrangler d1 execute` if a clean slate is wanted.

# Step J2 — Smoke Test Results (2026-05-20)

The J2 cut of step J (Stripe payment + walkthrough completion + Stripe
webhooks) verified end-to-end against the running wrangler dev + local D1.
Same approach as J1: drive every endpoint the UI calls via curl, then verify
D1 + audit_log state with `wrangler d1 execute`. No browser drove the UI.

**Dev-placeholder mode** was the harness — `.dev.vars` still has the
default `STRIPE_SECRET_KEY=sk_test_replace_me` and
`STRIPE_PUBLISHABLE_KEY=pk_test_replace_me`. The setup-payment endpoint
fabricated `dev_*` Stripe IDs; the webhook handler ran the same
signature-verification path the real Stripe CLI would feed (HMAC-SHA256
against the dev `STRIPE_WEBHOOK_SECRET`).

## What's verified

### Backend

- `GET /api/portal/walkthrough/payment-config` →
  `{dev_placeholder: true, publishable_key: null}` in placeholder mode.
- `POST /api/portal/walkthrough/setup-payment`:
  - 401 when unauthenticated.
  - 400 `payment_method_id_required` when body omits the field.
  - 409 `state_machine_violation` when state ≠ `contract_signed`
    (verified both at `new`-class states from earlier and at `complete`
    after the full walkthrough).
  - Happy path (dev placeholder): `stripe_dev_placeholder: true`,
    `walkthrough_state: 'payment_set'`, synthetic `dev_cus_*`,
    `dev_sub_*`, `dev_in_*` IDs returned and persisted. Resolved
    `monthly_starts_on: 2026-06-19` for an `accepted_at` of 2026-05-20
    (= +30 days; no override set). `current_period_end: 2026-07-19`.
  - D1 state after success:
    - `stripe_customer` (1 row, `dev_cus_…`)
    - `stripe_subscription` (status `active`, current_amount_monthly
      from proposal, current_period_end set)
    - `stripe_invoice` (kind `setup`, amount = proposal.setup_total,
      status `paid`, paid_at non-null)
    - `portal_account.walkthrough_state = 'payment_set'`
- Audit cascade for setup-payment (5 rows in the same D1 batch as the
  state mutations):
  - umbrella `payment.setup_completed` (entity_type=opportunity)
  - `stripe_customer.create`
  - `stripe_subscription.create`
  - `stripe_invoice.create`
  - `portal_account.walkthrough_advance` (from contract_signed → payment_set)
  - 0 plaintext `payment_method_id` leaks across audit_log.
- `POST /api/portal/walkthrough/complete`:
  - 409 `state_machine_violation` when called before `/setup-payment`.
  - Happy path: `walkthrough_state: 'complete'`, returns
    `redirect: '/portal/'`. Sets `portal_account.walkthrough_completed=1`.
  - Notifications queued via existing email service (placeholder Resend
    key → status='queued', error='dev_placeholder_key_not_sent'): one to
    `ADMIN_NOTIFY_EMAILS` recipients (admin notification), one to
    `client.primary_contact_email` (client confirmation). Placeholder
    copy in `worker/src/routes/portal/complete.ts` —
    `clientWelcomeEmailText` / `adminWalkthroughDoneEmailText` are the
    single-file edits to swap when the real copy arrives.
  - audit row `walkthrough.completed` with from/to diffs.
  - Subsequent `/complete` calls return 409 (state is no longer
    `payment_set`).

### Stripe webhook (`POST /api/webhooks/stripe`)

Signature verification is hand-rolled HMAC-SHA256 via `crypto.subtle`
against the `STRIPE_WEBHOOK_SECRET` from `.dev.vars`. **Mandatory in
dev** per the J2 directive — no bypass flag. Verified outcomes:

- No `stripe-signature` header → 400 `missing_signature_header`.
- Bad signature → 400 `signature_mismatch`.
- Stale timestamp (> 5 min) → 400 `timestamp_out_of_tolerance`.
- Unknown event type → 200 `{received:true, handled:false}`.
- Valid signature + `invoice.payment_succeeded` → 200, `stripe_invoice`
  status set to `paid`, `paid_at` synced from
  `status_transitions.paid_at`, audit row `stripe.webhook.invoice_payment_succeeded`.
- Valid signature + `customer.subscription.updated` → 200, status →
  `past_due` (normalized into the project's 3-status enum),
  `current_period_end` synced, audit row written.
- Valid signature + `customer.subscription.deleted` → 200, status →
  `canceled`, audit row.

Test harness for valid signatures: a small Node script using `crypto`
HMAC against the dev secret, then `fetch()` to the worker. Same pattern
the Stripe CLI would use with `stripe listen --forward-to
localhost:8787/api/webhooks/stripe`.

### Frontend

- Portal `pnpm build` succeeds (342 files, 0 svelte-check errors).
- `PaymentStep.svelte` boots `payment-config` on mount and:
  - In `dev_placeholder` mode: shows a "Use placeholder payment method"
    button that POSTs a fabricated `payment_method_id` to
    `/setup-payment` so the walkthrough advances end-to-end without a
    real Stripe account. The placeholder callout explains the mode
    and how to flip to real Stripe.
  - In real mode: lazy-loads `@stripe/stripe-js`, mounts a Stripe
    `PaymentElement` (layout=tabs), tracks `complete` state from the
    element's change events, on submit runs `elements.submit()` →
    `stripe.createPaymentMethod()` → POST `/setup-payment`.
  - Errors stay inline (Stripe declines, network errors, state-machine
    violations) — UI stays mounted, user can retry.
- `DoneStep.svelte` renders the welcome message, next-steps list,
  setup-fee + subscription summary, and two CTAs. "Enter portal"
  POSTs `/complete` then navigates to `/portal/`. "Download signed
  contract" emits the contract markdown body as `<client>-contract.md`.
  PDF generation deferred (see `notes/deferred-cleanup.md`).
- Orchestrator (`portal/src/routes/(authed)/walkthrough/+page.svelte`)
  routes:
  - `state=contract_signed` → `PaymentStep`
  - `state=payment_set` → `DoneStep`
  - `state=complete` → fallback "you're all set" copy (the
    (authed)/+layout.ts gate would normally bounce here back to home).

### Locked-in design decisions (per J2 scope)

- Subscription start date defaults to `opportunity.accepted_at + 30 days`.
  Override via `opportunity.monthly_start_date` (new in migration 0005,
  nullable). When NULL, +30 is computed at `/setup-payment` time. When
  set, that exact date is the Stripe `billing_cycle_anchor`. Admin can
  override via the existing PUT `/api/admin/opportunities/:id`
  (`monthly_start_date` added to `OPP_EDITABLE_FIELDS`).
- Stripe Elements (not Checkout) for the inline payment UX.
- Webhook signature verification mandatory in dev too — uses the same
  `STRIPE_WEBHOOK_SECRET` env var; dev's value comes from `stripe listen`
  output.

## Test-mode Stripe verification (not yet run)

Real-Stripe-test-mode smoke testing requires:

1. A real Stripe account in test mode (free).
2. `STRIPE_SECRET_KEY=sk_test_…` and `STRIPE_PUBLISHABLE_KEY=pk_test_…`
   in `.dev.vars`.
3. `stripe listen --forward-to localhost:8787/api/webhooks/stripe` in
   another terminal; paste the printed `whsec_…` into `.dev.vars` as
   `STRIPE_WEBHOOK_SECRET`.
4. Drive the portal walkthrough to the payment step, enter Stripe test
   card `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP).
5. Verify the same D1 rows as above but with real `cus_…`, `sub_…`,
   `in_…` IDs. Then `stripe trigger invoice.payment_succeeded` to
   exercise the real webhook delivery.
6. Failure path: `4000 0000 0000 0002` → declined → payment_set state
   does not advance, error surfaces inline, retry works.

Documented in `context/step-J2-scope.md` § "Local dev setup for Stripe."
The dev-placeholder mode above covers every code path except the actual
fetch to Stripe and the actual signature being from Stripe; the webhook
signature path is exercised verbatim regardless.

## State left in local D1

- Pat's portal_account (`ba917f3b-…`) is now at `walkthrough_state =
  complete`, `walkthrough_completed = 1`. Pat is fully activated:
  `stripe_customer`, `stripe_subscription` (currently `canceled` after
  the `customer.subscription.deleted` webhook test), and
  `stripe_invoice` rows all present with `dev_` IDs.
- Sam's portal_account (`a3a13392-…`) is still at `walkthrough_state =
  contract_signed`, ready as a clean fixture for any further dev
  testing.
- Two queued `notification` rows for the walkthrough_complete emails
  (status=queued, error=dev_placeholder_key_not_sent). Real send will
  fire automatically when a real Resend key is installed.

## Cleanup notes

Both J1 + J2 left smoke-test fixtures in local D1. Safe to leave
(useful for hand-poking the flow visually) or wipe with `wrangler d1
execute` if you want a clean slate before the next step.

The wrangler dev process started during the J1 smoke test is still
running; kill at your leisure.

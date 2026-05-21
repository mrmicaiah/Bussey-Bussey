# Step J2 — Portal walkthrough: payment + completion + Stripe webhooks

Carries the J2 portion of `context/step-J-scope.md` plus the decisions
locked in at the J2 kickoff. J1 left the portal account at
`walkthrough_state='contract_signed'` with the payment step rendered as a
disabled placeholder. J2 wires up the real Stripe flow, the
congratulations screen, and the webhook handler.

## Subtasks (renumbered from step-J-scope.md)

### 1. Schema — `opportunity.monthly_start_date`

Migration 0005. New nullable column on `opportunity`. When NULL,
`setup-payment` computes activation date (= `opportunity.accepted_at`)
+ 30 days. When set, that exact date is used as the Stripe
subscription's `billing_cycle_anchor`. Admin can edit via the existing
PUT `/api/admin/opportunities/:id` (added to `OPP_EDITABLE_FIELDS`).

Document the override semantic in the migration's leading comment so
future readers don't have to reverse-engineer it.

### 2. POST `/api/portal/walkthrough/setup-payment`

- Pre-checks: walkthrough_state must be `contract_signed`; otherwise
  409 `state_machine_violation`. Reads opportunity, accepted proposal,
  and resolves the monthly start date.
- Accepts `{ payment_method_id }` from Stripe Elements on the frontend.
- Creates / reuses a Stripe customer for this client (metadata
  `client_id`, `opportunity_id`); attaches the payment method; sets
  it as `invoice_settings.default_payment_method`.
- Charges the setup fee immediately as a one-off Invoice + InvoiceItem
  paid via the saved payment method (or PaymentIntent, depending on
  what fits the Stripe API cleanly).
- Creates the monthly Subscription with `billing_cycle_anchor` set to
  the resolved monthly_start_date (Unix seconds).
- Persists `stripe_customer`, `stripe_subscription`, `stripe_invoice`
  rows. Advances `walkthrough_state='payment_set'`. Umbrella +
  per-entity audit rows (`subscription.created`, `customer.created`,
  `invoice.paid`, `portal_account.walkthrough_advance`).
- On Stripe failure: stay in `contract_signed`, return a clean error
  payload, no DB rows written.
- **Dev placeholder mode.** When `STRIPE_SECRET_KEY` is the
  `.dev.vars.example` placeholder (`sk_test_replace_me`), the endpoint
  creates synthetic `stripe_*` rows with `stripe_*_id` values prefixed
  `dev_` and advances state normally — same pattern as the chat /
  email dev-stub. Logs a clear `[stripe:dev-placeholder]` line. Real
  Stripe activates when a real `sk_test_…` key is installed.

### 3. POST `/api/portal/walkthrough/complete`

- Pre-check: walkthrough_state must be `payment_set`; otherwise 409.
- Sets `walkthrough_completed=1`, `walkthrough_state='complete'`.
- Writes audit row `walkthrough.completed`.
- Fires notifications:
  - Admin: "[Client] completed activation" via existing `sendEmail`
    flow. Recipients from `env.ADMIN_NOTIFY_EMAILS`.
  - Client: confirmation email with placeholder copy (real copy lands
    when the user supplies it — keep the text isolated in a single
    `welcomeCompleteEmailText()` helper for one-file swap).
- Returns the redirect target (`/portal/`) so the frontend can route
  to the home view after the done screen's CTA.

### 4. POST `/api/webhooks/stripe`

Currently a 501 stub. Wires up signature verification + event
handling. Per the user's J2 directive: **signature verification is
non-negotiable, including in dev** — verified against the dev webhook
secret (`STRIPE_WEBHOOK_SECRET` from `.dev.vars`).

Verification uses Stripe's `t=...,v1=...` `stripe-signature` header
format. Implemented hand-rolled with `crypto.subtle` HMAC-SHA256 so the
worker stays lean (no Stripe SDK in the bundle). Reject with 400 on
any signature mismatch or stale timestamp (> 5 minutes).

Event handlers (write idempotently — `stripe_invoice.stripe_invoice_id`
already has UNIQUE):
- `invoice.payment_succeeded` → update `stripe_invoice.status`, set
  `paid_at`; if the invoice's `kind='setup'` and the subscription it
  belongs to is in `incomplete`, advance accordingly. Notify admin if
  the amount is unusual / failed before.
- `invoice.payment_failed` → update status, notify client + admin.
- `customer.subscription.updated` → sync `stripe_subscription` row
  (status, `current_period_end`, `current_amount_monthly`).
- `customer.subscription.deleted` → mark `status='canceled'`.
- `payment_method.attached` → no-op for now (we'd update a future
  card-on-file display); log and 200.

Unknown event types: 200 OK with `{ received: true, handled: false }`
so Stripe doesn't retry.

### 5. Frontend — replace `PaymentPlaceholder` with `PaymentStep`

- Use **Stripe Elements**, not Stripe Checkout (locked in by the user
  for the inline walkthrough feel — no redirect away from the page).
- Library: `@stripe/stripe-js` for `loadStripe()`. Use a minimal
  inline `PaymentElement` mounted into a div.
- Frontend fetches the publishable key from a tiny new endpoint
  (`GET /api/portal/walkthrough/payment-config`) on entering the step.
- Summary box at top: setup fee, monthly amount, first monthly charge
  date (from `payment_summary.monthly_starts_on`).
- Card collection panel: Stripe `PaymentElement`.
- "Pay $X and set up subscription" submit button — disabled until
  Stripe Elements reports a complete payment method.
- On submit: `stripe.confirmSetup({ elements, ... })`, get the
  `payment_method.id`, POST to `/setup-payment`. On 2xx, advance via
  the orchestrator's `onAdvance` refresh.
- On Stripe error (declined etc.): show the message inline, leave the
  form mounted, allow retry.

### 6. Frontend — `DoneStep`

- "You're all set, [Client Name]. Welcome to Bussey and Bussey."
- Next-steps placeholder copy (real copy comes later; isolated in
  this component for a single-file swap).
- Setup fee receipt summary (amount + date) and subscription summary
  (monthly amount + first billing date).
- Two CTAs: `[Enter Portal]` (primary) → POST `/complete` then route
  to `/portal/`; `[Download signed contract]` (secondary) — for J2
  ships as a Markdown/HTML download since PDF generation isn't built
  yet. Add `notes/deferred-cleanup.md` entry for PDF generation.
- Updates the `StepDots` to mark step 5 done after `/complete`.

### 7. State-machine guard wiring

- `/setup-payment` requires state=`contract_signed`.
- `/complete` requires state=`payment_set`.
- Both return 409 `state_machine_violation` with `current_state` on
  out-of-order calls.

### 8. Smoke test

End-to-end with Stripe in dev-placeholder mode + with real Stripe
test mode (if the user has dropped a real `sk_test_…` key in by then).

- Reset a portal_account back to `contract_signed` (or use the Sam/Pat
  fixtures already at `contract_signed` from the J1 run).
- Hit the J1 walkthrough endpoints to confirm we're still at
  `contract_signed`.
- GET `/payment-config` → returns publishable key (or a dev sentinel
  when placeholder).
- Successful payment (real Stripe test card `4242 4242 4242 4242` or
  dev-placeholder mode): verify `stripe_customer`, `stripe_subscription`,
  `stripe_invoice` rows; verify `walkthrough_state='payment_set'`;
  verify audit cascade (umbrella + per-entity rows).
- Out-of-order: try `/complete` before `/setup-payment` → 409.
- Failure path with real Stripe test (`4000 0000 0000 0002`): payment
  fails, state stays `contract_signed`, error surfaced, retry works.
- Complete the walkthrough via `/complete`: `walkthrough_completed=1`,
  client + admin notifications recorded, audit `walkthrough.completed`.
- Webhook delivery: with `stripe listen --forward-to
  localhost:8787/api/webhooks/stripe` running, trigger
  `invoice.payment_succeeded` (Stripe CLI: `stripe trigger
  invoice.payment_succeeded`) and verify `stripe_invoice.status`
  updated. Bad signature → 400. Stale timestamp → 400.
- Walkthrough gate: after `walkthrough_completed=1`, GETs to
  `/portal/walkthrough` redirect to `/portal/`.

## Locked-in decisions for J2

- **Subscription start date.** 30 days after `opportunity.accepted_at`
  by default. Overridable via `opportunity.monthly_start_date` (nullable
  column added in migration 0005). Setup fee always charges
  immediately on payment method confirmation. `billing_cycle_anchor`
  on the Stripe subscription pins the monthly to the resolved date.
- **Stripe Elements** (not Checkout) for the payment step — keeps the
  client inside the walkthrough page; no redirect/back complication.
- **Webhook signature verification mandatory in dev too.** Verify
  against `STRIPE_WEBHOOK_SECRET` from `.dev.vars`. No
  bypass-in-dev flag.
- **Dev placeholder mode for the secret key.** When
  `STRIPE_SECRET_KEY` is `sk_test_replace_me`, write synthetic
  `stripe_*` rows with `dev_` prefixed IDs and skip the real API
  call — mirrors the chat/email dev-placeholder pattern. Real
  Stripe activates when a real `sk_test_…` key is installed via
  `wrangler secret put` (or in `.dev.vars` locally).

## Local dev setup for Stripe

When testing the real Stripe path (post-key-installation), run the
Stripe CLI forwarding alongside `wrangler dev`:

```
stripe listen --forward-to localhost:8787/api/webhooks/stripe
```

The CLI prints a `whsec_…` webhook secret on startup — paste that into
`.dev.vars` as `STRIPE_WEBHOOK_SECRET` so signature verification
matches the events being forwarded.

Trigger specific events for verification:

```
stripe trigger invoice.payment_succeeded
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.updated
```

## Out of scope for J2

- Multi-user clients
- ACH / non-card payment methods
- Walkthrough analytics
- Real (production) Stripe keys — explicit user gate
- Stripe Customer Portal session creation (subscription management) —
  already a separate stub at `/api/portal/payment/portal-session`
- Real welcome-email copy from the user (placeholder copy ships; swap
  is one-file edit)

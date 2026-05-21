# Step J1 — Smoke Test Results (2026-05-20)

The J1 cut of step J (portal scaffold + walkthrough through contract signing,
no Stripe) verified end-to-end against the running wrangler dev + local D1.
Same approach as the step I smoke test: drive every endpoint the UI calls
via curl, then verify D1 + audit_log + KV state with `wrangler d1 execute`.
No browser drove the UI — but every backend code path is exercised, and the
portal builds cleanly (`pnpm build` succeeds; `svelte-check` reports 0 errors).

## What's verified

### Portal scaffold

- `portal/` SvelteKit app builds and typechecks.
- Vite dev server configured for `:5174` with `/api/*` proxied to `:8787`.
- `base: '/portal'` so dev URL is `http://localhost:5174/portal/login`.
- Shared theme mirrored from admin (`portal/src/app.css`).
- `marked@^12` added as a dependency for the contract markdown rendering.

### Backend endpoints

- `GET /api/portal/me` — 401 when unauthenticated, 200 with full payload
  (portal_account / client / opportunity / contract) when authenticated.
- `GET /api/portal/walkthrough/state` — returns current state + per-step
  data. In state `new`: no contract body (gate). In state `password_set` and
  beyond: contract body + payment_summary included.
- `POST /api/portal/auth/change-password` — validation matrix all working:
  - `password_too_short` for `< 10` chars
  - `password_needs_number_or_symbol` for alpha-only
  - `password_needs_lowercase` / `password_needs_uppercase` for missing case
  - `passwords_do_not_match` for confirm mismatch
  - Happy path: 200 with `walkthrough_state: 'password_set'`,
    `must_change_password = 0`, bcrypt hash refreshed, audit row
    `portal_account.password_changed` with full from/to diff. **No plaintext
    in audit_log.**
- `POST /api/portal/walkthrough/sign-contract`:
  - `state_machine_violation` when state ≠ `password_set` (rejected from
    `new` *and* from `contract_signed` retry).
  - `markers_missing` lists exactly which markers weren't provided.
  - `markers_unexpected` lists extras the template doesn't have.
  - `agreement_signature_required` for whitespace-only agreement name.
  - `invalid_signature_payload` for malformed signature objects.
  - Happy path: 200 with `walkthrough_state: 'contract_signed'`,
    `contract_id`, `signed_at`. Verified in D1:
    - `contract.signed_at` set, `contract.signed_by_portal_account_id` set.
    - `portal_account.walkthrough_state = 'contract_signed'`.
    - `document_signature` rows: 1 per sig marker (type `signature`), 1 per
      initial marker (type `initial`), 1 for the final agreement (type
      `agreement_acceptance`) — total 6 for the v0.1 template (1 sig + 4
      initials + 1 agreement). Each row carries `typed_name` or
      `typed_initials` plus `ip_address`, `user_agent`, `opportunity_id`,
      `signed_at`.
    - `audit_log` rows per the established cascade pattern: umbrella
      `contract.signed` + per-entity `portal_account.walkthrough_advance`.
      The umbrella's `changes` JSON includes `typed_fields` (a map of
      `print:label → value` and `date:label → value` for the auxiliary
      markers that don't warrant their own `document_signature` row — see
      "Finding" below).
- Existing endpoints from step I still working: `POST /reset-credentials`
  produces a fresh temp password and refreshes the KV window; `POST
  /portal/auth/login` accepts the new temp password and sets the
  `bb_portal_session` cookie.

### Frontend

- Portal builds (`pnpm build`) produces a clean static SPA in
  `portal/build/`.
- `svelte-check` reports 0 errors. The three a11y warnings on the contract
  step (click-on-article, autofocus) are suppressed with `svelte-ignore`
  comments explaining why each is intentional (delegated keyboard activation
  via child buttons, deliberate UX choice for modal autofocus).
- Walkthrough orchestrator at `portal/src/routes/(authed)/walkthrough/`
  picks the right sub-component based on server state:
  - state=`new` + welcomeAcknowledged=false → Welcome
  - state=`new` + welcomeAcknowledged=true → PasswordStep
  - state=`password_set` → ContractStep (with marker-clickable buttons,
    typed-name/initial modal, agreement checkbox + final typed name)
  - state=`contract_signed` → PaymentPlaceholder (the J1 stub — disabled
    "Set up payment" button with a callout pointing at J2)
- Walkthrough gate in `(authed)/+layout.ts`: redirect non-walkthrough
  routes to `/portal/walkthrough` until `walkthrough_completed=true`;
  bounces `/portal/walkthrough` to `/portal/` after completion.
- StepDots progress indicator shows 5 steps (Welcome, Secure account,
  Sign contract, Set up payment, Done) with done/current/upcoming states.

## Finding (fixed during the run)

**`document_signature` had wrong rows for `print` and `date` markers.**
Initial implementation classified every non-sig non-initial marker as
`agreement_acceptance`, which produced 3 extra rows per signing (two prints
+ one date). The `document_signature.signature_type` enum has no fitting
value for typed text fields — they're auxiliary, not legally-significant
signing events. **Fixed** in `worker/src/routes/portal/walkthrough.ts`:
`print` and `date` markers no longer write `document_signature` rows; their
typed values are captured in the `audit_log.changes.typed_fields` payload
on the umbrella `contract.signed` row. Re-verified on a second activation
(Pat / Smoke Test Co.): 1 signature + 4 initials + 1 agreement_acceptance.
Audit row includes `typed_fields: { "print:client_name": "Pat Tester",
"print:client_title": "VP Talent", "date:signed_at": "May 20, 2026" }`.

## Out of scope for J1 (lands in J2)

- Stripe integration (subtask 6, 10): payment-setup endpoint stays a 501
  stub; J1 UI shows the totals + disabled button.
- Walkthrough completion (subtask 7): `walkthrough_state='complete'`,
  walkthrough_completed=true, admin notification, client confirmation email.
- Webhook handling (subtask 10): `/api/webhooks/stripe` stub remains.
- Smoke test items 7, 8, 11, 12, 13 from the J scope (Stripe-dependent).

## State left in local D1

- Two test portal_accounts (Sam, Pat) — both now at
  `walkthrough_state='contract_signed'`, walkthrough not completed.
- Two signed contracts. Sam's contract has the pre-fix `document_signature`
  shape (4 agreement_acceptance rows from the print/date misclassification);
  Pat's is the post-fix shape (clean). Sam's rows are smoke-test noise and
  safe to wipe; the fix is in place for any future signing.

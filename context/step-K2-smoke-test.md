# Step K2 — Smoke Test Results (2026-05-20)

K2 (the ongoing portal sections + admin change-requests + project
status notifications) verified end-to-end against the running wrangler
dev + local D1. Same harness as previous smoke tests; dev-placeholder
Stripe throughout. All three packages typecheck clean: worker `tsc`
OK, admin `svelte-check` 0 errors (304 files), portal `svelte-check` 0
errors (358 files).

## Pre-K2 verifications (per the review notes)

- **HMAC signature comparison** confirmed constant-time on inspection
  (`worker/src/services/stripe.ts:289-294`) — non-short-circuit XOR/OR
  accumulator over equal-length inputs, plus a non-short-circuit
  dispatch loop. No code change.
- **`stripe_subscription.stripe_item_id` backfill.** Pat's J2-fixture
  row was NULL. Backfilled to a synthetic `dev_si_LWX7HTLFSUTTULV` via
  direct D1 UPDATE so K1 change-order monthly-delta updates and any K2
  Stripe interactions don't hit the "stripe_item_id_missing" guard.
- **Route inventory descriptions** for `/api/admin/change-orders/*` and
  `/api/portal/change-orders/*` all reflect implemented status (no
  "stub" or "notImplemented" language remains on those routes).

## What's verified

### Schema (migration 0007)

- `project.updated_at` (nullable, backfilled to `created_at`, indexed).
- `change_request` table with full status enum + soft FK
  `converted_to_change_order_id`.
- `portal_account.notify_change_orders` + `notify_payments`, INT 0/1,
  default 1.

### Backend endpoints

- `GET /api/portal/me` (still returns the J2 shape — payment summary
  added as a separate endpoint).
- `GET /api/portal/activity?limit=N` — filtered audit feed scoped to
  this client's opportunity/contract/project/change orders/invoices,
  restricted to a curated allowlist of client-visible actions.
- `GET /api/portal/project-status` — read-only project fields the
  client sees.
- `GET /api/portal/documents` — list of contract + proposal +
  non-draft change orders.
- `GET /api/portal/documents/:doc_type/:doc_id` — body (markdown) +
  signature audit.
- `GET /api/portal/payment/summary` — subscription card + payment
  method placeholder.
- `GET /api/portal/payment/invoices` — invoice history.
- `POST /api/portal/payment/portal-session` — Stripe Billing Portal
  session URL (dev placeholder returns a same-page sentinel URL).
- `POST /api/portal/change-requests` — submit free-text intake;
  validates urgency enum (routine/soon/urgent) and non-empty
  description.
- `GET /api/portal/change-requests` — list this client's requests.
- `PUT /api/portal/account/notification-prefs` — toggle prefs;
  rejects unknown fields and non-boolean values.
- `GET /api/portal/account/signatures` — full signature audit history.
- `GET /api/admin/change-requests` — admin list, filterable by
  opportunity_id.
- `POST /api/admin/change-requests/:id/mark-reviewed` — submitted →
  reviewed.
- `POST /api/admin/change-requests/:id/decline` — submitted|reviewed →
  declined with optional note.
- `POST /api/admin/change-requests/:id/convert-to-change-order` —
  creates a draft `change_order` with the request's description copied
  as `reason`, sets `change_request.converted_to_change_order_id`,
  writes both umbrella + per-entity audit rows.
- `PUT /api/admin/projects/:id` — extended with optional
  `notify_client` flag. When true AND a client-facing field actually
  changed, fires a `project_status_update` email. The audit row now
  also writes `updated_at` and records `notify_client` in `changes`.
- Stripe webhook handlers extended:
  - `invoice.payment_succeeded` → client receipt email (in addition to
    the existing D1 update + audit row).
  - `invoice.payment_failed` → both admin AND client notification
    emails.

### Frontend

- Authenticated layout now includes a nav strip (Home / Documents /
  Project / Payment / Change orders / Account) that only renders for
  walkthrough-complete accounts.
- New pages:
  - `/portal/` overview (engagement card + project status card +
    recent activity feed + quick actions).
  - `/portal/documents` list + `/portal/documents/:doc_type/:doc_id`
    detail with marked-rendered body, download as .md, and signature
    audit table.
  - `/portal/project-status` read-only project view.
  - `/portal/payment` subscription card + payment-method placeholder
    + Update Payment Method button (redirects to billing portal
    session URL) + invoice history table with status badges.
  - `/portal/change-requests/new` form (description + urgency +
    submit) with success state.
  - `/portal/account` profile + change password + notification prefs
    + signature history + sign out.
- Admin opportunity detail page extended with a Change Requests panel
  listing this opportunity's intake submissions; per-row Mark reviewed
  / Convert / Decline actions, plus an "Open CO" link once converted.

### Per-step smoke verification

1. Pat lands at `/portal/` (post-walkthrough) — overview returns
   engagement card, project status (current_phase='discovery' from K1
   admin smoke), activity feed (last 5 events).
2. `/portal/documents` lists contract + proposal + 3 change orders.
3. `/portal/project-status` shows the current values.
4. Admin updates project: current_phase='build',
   build_status_note='Initial schema in place…', next_milestone='Demo
   to leadership 2026-06-05', `notify_client=true`.
   - Portal `project-status` reflects the new values immediately.
   - `project.updated_at` bumped to the write timestamp.
   - Notification row queued: `kind='project_status_update'`,
     recipient `pat@smoketest.example`, status=queued
     (dev_placeholder_key_not_sent).
   - Audit row `project.update` with full from/to diff and
     `notify_client: true` in changes.
5. `/portal/payment` returns subscription summary (status `canceled`
   from the J2 webhook test, $1500/mo, period_end 2026-06-19), 2
   invoices (setup + change_order_setup, both paid).
6. `POST /portal/payment/portal-session` returns
   `{ url: 'http://localhost:5174/portal/payment?dev_portal_session=true',
     dev_placeholder: true }`. Real-Stripe path is implemented but
   not exercised (would require a real `sk_test_…` key).
7. Portal submits a change request:
   `"Can we add a candidate-source breakdown…"`, urgency `soon`.
   - `change_request` row created with status='submitted'.
   - Admin notification queued (kind='other', recipient
     team@example.com — see deferred-cleanup for the missing kind
     enum value).
   - Audit row `change_request.submitted` (actor: portal_account, no
     description content in changes — only `description_length`).
   - Validation errors confirmed: `invalid_urgency` for unknown values,
     `description_required` for whitespace-only.
8. Admin marks reviewed → status=reviewed, reviewed_at set, audit row
   `change_request.reviewed`.
9. Admin converts to change order → returns new `change_order_id`,
   `change_request.status='converted_to_change_order'`,
   `converted_to_change_order_id` set, new draft
   `change_order.reason` matches the request's description verbatim.
   Audit rows: `change_request.converted` + `change_order.create`.
   Retry convert on already-converted → 409
   `invalid_state_transition`.
10. Pat updates notification prefs (notify_payments=false). D1
    confirms `notify_change_orders=1, notify_payments=0`. Audit row
    `portal_account.notification_prefs_updated` written.
11. Signature audit: 7 rows visible to Pat — 4 contract initials, 1
    contract signature, 1 final agreement_acceptance, 1 change-order
    agreement_acceptance.
12. Webhook `invoice.payment_failed` (valid HMAC signature against
    dev secret):
    - 200 response, `stripe_invoice.status='open'`.
    - Notifications queued: `payment_failed` to both
      `pat@smoketest.example` AND `team@example.com`.
13. Webhook `invoice.payment_succeeded` (valid signature) on the same
    invoice:
    - 200 response, `stripe_invoice.status='paid'`, `paid_at` set.
    - Notification queued: `payment_succeeded` to
      `pat@smoketest.example` (client receipt).
14. Plaintext-password leak audit: 0 hits across audit_log for
    Pat's J1 password (`PatPilot42!`) and the earlier test password.

### Notes / known limitations

- **Webhook-originated activity feed.** The activity endpoint filters
  by entity_id IN (opportunity/contract/project/change_order/invoice
  row ids), which catches the local `stripe_invoice.create` audit
  rows from approve flow + project.update + change_order.* rows. The
  webhook handler's own audit rows reference
  `entity_type='stripe_event'` and `entity_id=event.id` — they don't
  surface in the feed. Acceptable for K2: the local audit rows give
  the client a complete enough picture. Could be revisited later by
  having the webhook handler write a second audit row keyed to the
  invoice row id.
- **Payment method last_4/brand.** Currently always reported as null
  with `status='on_file'`. Wiring this requires a `payment_method`
  table (or extending stripe_customer) populated from
  `payment_method.attached` webhook events. K2 ships the UI bone but
  leaves the data wire for a follow-up.
- **Notification preferences not yet enforced** — UI persists choices;
  send logic ignores. Tracked in `notes/deferred-cleanup.md` under
  "Notification preferences UI shipped but not yet enforced in send
  logic."
- **Real Stripe Billing Portal session** path implemented but not
  exercised — requires a real `sk_test_…` key. Dev placeholder return
  exercises the same client-side code path.

### Cleanup

- The wrangler dev process is still running.
- Pat's fixtures: 3 change orders (approved/rejected/withdrawn) + 1
  new draft from the change-request conversion + 2 invoices (1 setup
  + 1 change_order_setup, both paid) + notification prefs
  `{change_orders: true, payments: false}` + project at phase='build'
  with the K2 admin update. Useful K3+ fixtures or safe to wipe.

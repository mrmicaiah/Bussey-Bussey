# Step J — Client Portal: First-Login Walkthrough

Goal: The activated client logs into the portal for the first time and 
completes the 4-step walkthrough: secure account → sign contract → set 
up payment → done. Until walkthrough_completed=true, this is the ONLY 
view they can access.

Payment setup uses Stripe and is the most complex single subtask in 
this step. The activation flow built in step I produces a portal_account 
in the right state to consume.

## J1 / J2 split

Step J is being built in two passes to keep reviews tight:

- **J1 — Portal scaffold + walkthrough through contract signing.** No 
  Stripe. Subtasks 1, 2, 3, 4, 5; state-machine guards for `/change-password` 
  and `/sign-contract`. Subtask 6 (payment) renders a summary box + a 
  disabled "Set up payment (step J2)" button so the gate is visible 
  without being functional; the `/setup-payment` endpoint stays a 501 
  stub. Smoke-test items from subtask 11 that don't depend on payment: 
  steps 1–6 of the test (portal login, walkthrough redirect, password 
  change, contract signing, document_signature rows, state advances), 
  plus the route-guard test (item 9) and the state-machine-skip test 
  (item 10) for the first two transitions.
- **J2 — Stripe integration + done + webhooks.** Subtasks 6 (payment), 
  7 (congratulations screen / completion), 10 (Stripe webhooks). 
  State-machine guards for `/setup-payment` and `/complete`. Remaining 
  smoke-test items (7, 8, 11, 12, 13) and the failure-path test for 
  declined cards.

Confirmation email content (subtask 7) is placeholder for the J2 build 
— structured so swapping in the real copy is a single-file edit. Stripe 
is **test mode throughout J2**; real keys only get installed when 
explicitly approved by the user.

## Subtasks

### 1. Portal SPA shell

If the portal frontend doesn't exist yet, scaffold it now under portal/ 
following the same framework choice as admin (SvelteKit per the prior 
decision). Same shared component library where reusable, but the portal 
is its own deployment with its own auth context — strict separation 
from admin.

- portal/ scaffold with routing
- Login page at /portal/login (uses POST /api/portal/auth/login from 
  step D)
- Authenticated layout shell with header (client company name, logout)
- Session-required wrapper around all portal pages
- Friendly handling of expired sessions

### 2. Walkthrough gate

Until portal_account.walkthrough_completed = true, every authenticated 
route in the portal redirects to /portal/walkthrough. The client cannot 
access any other portal view (documents, payment, project status, 
account) until the walkthrough is complete.

Walkthrough state machine drives which step is active:
- new → step 1 (welcome) then step 2 (secure account / change password)
- password_set → step 3 (sign contract)
- contract_signed → step 4 (payment setup)
- payment_set → step 5 (congratulations / done)
- complete → walkthrough_completed=true, redirect to portal home

State persists server-side. Closing the browser and returning resumes 
at the same step.

### 3. Step 1 — Welcome screen

- "Welcome, [Client Name]. Let's get [Opportunity Name] activated. This 
  takes about 5 minutes."
- High-level preview of 4 steps with progress indicator
- Continue button → step 2

No data change on continue. State stays at 'new' until step 2 completes.

### 4. Step 2 — Secure your account

- Force password change UI
- Fields: new password, confirm password
- Password requirements: 10+ chars, mixed case, number or symbol 
  (enforced client and server side)
- Old password not required (they just used the temp to log in)
- POST to /api/portal/auth/change-password
- On success: portal_account.must_change_password = false, 
  walkthrough_state = 'password_set'
- audit_log entry
- Continue button → step 3

### 5. Step 3 — Review and sign the contract

This is the most visually involved step. Render the contract with inline 
signature/initial fields.

- Fetch contract.body for this client's opportunity
- Parse the marker syntax ({{sig:...}}, {{print:...}}, {{initial:...}}, 
  {{date:...}}) and replace each marker with an interactive field
- {{sig:xxx}} → click opens modal asking for full legal name. On 
  submit, the field displays the name and the field is locked.
- {{initial:xxx}} → click opens modal asking for initials. Same lock.
- {{print:xxx}} → editable typed field that fills with last entered 
  name where appropriate
- {{date:xxx}} → auto-populated with today's date, read-only
- All variable substitutions ({{client_name}}, {{setup_fee}}, etc.) 
  already rendered server-side in the contract body
- Required: every marker must be filled before submission
- Required: final checkbox "I have read and agree to the above 
  contract"
- Required: typed full legal name at bottom (final signature)
- On submit:
  - POST to /api/portal/walkthrough/sign-contract
  - One document_signature row per marker filled (signature_type, 
    typed value, ip_address, user_agent, signed_at, opportunity_id)
  - One additional document_signature for the final agreement_acceptance
  - contract.signed_at = now
  - portal_account.walkthrough_state = 'contract_signed'
  - audit_log entries
- Continue button → step 4

### 6. Step 4 — Payment setup

Stripe integration. This is where the system creates the actual Stripe 
customer and subscription.

- Display summary box:
  - Setup fee: $X (charged today)
  - Monthly subscription: $Y (billed monthly starting [date])
  - Next billing date logic: define this clearly. Default suggestion: 
    monthly subscription starts 30 days after activation date, or on 
    a configurable go-live date. Setup fee charges immediately on 
    submission.
- Embedded Stripe Elements (or Stripe Checkout — your call, but 
  Elements gives a tighter inline UX which is better for the 
  walkthrough flow)
- On Stripe payment method confirmation:
  - POST to /api/portal/walkthrough/setup-payment with the payment 
    method id from Stripe
  - Backend creates Stripe customer (if not already), attaches payment 
    method
  - Backend creates one-time setup fee invoice and immediately charges 
    it via the saved payment method
  - Backend creates monthly subscription with the configured start date
  - On all Stripe operations succeeding: stripe_customer, 
    stripe_subscription, stripe_invoice rows written; 
    walkthrough_state = 'payment_set'; audit_log entries
- On Stripe failure (card declined, etc.):
  - Stay on step 4
  - Display clean error from Stripe
  - Allow retry
  - walkthrough_state does not advance
- Continue button (only enabled after successful payment) → step 5

### 7. Step 5 — Congratulations / done

- "You're all set, [Client Name]. Welcome to Bussey and Bussey."
- Brief next-steps text:
  - "Your project officially kicks off [date]."
  - "You'll hear from us within 24 hours with next steps."
  - "Return to your portal anytime to view documents, payment history, 
    or request changes."
- Two CTAs:
  - [Enter Portal] (primary)
  - [Download signed contract] (secondary — downloads the rendered 
    signed contract as PDF, or HTML if PDF rendering isn't built yet — 
    if HTML, add deferred-cleanup for PDF generation)
- On reaching this screen:
  - walkthrough_completed = true
  - walkthrough_state = 'complete'
  - audit_log entry: walkthrough.completed
  - Admin notification fires: "[Client] completed activation"
  - Client receives confirmation email: receipt for setup fee, summary 
    of subscription, link to signed contract

### 8. Walkthrough state machine enforcement

Server-side guards on all walkthrough endpoints:
- /change-password requires state='new' or 'password_set' (allow retry)
- /sign-contract requires state='password_set'
- /setup-payment requires state='contract_signed'
- /complete requires state='payment_set'

Any out-of-order call returns 409 with helpful error message. UI 
restricts to in-order, server enforces.

### 9. Behavior rules

- Cannot skip steps
- Cannot bypass walkthrough (force-redirect from any other portal route)
- Cannot retry signed steps (contract signed = step 3 shows read-only 
  view of signed contract going forward)
- Payment retry allowed until success

### 10. Stripe webhooks

Wire up POST /api/webhooks/stripe (currently a 501 stub). Handle:
- invoice.payment_succeeded → update stripe_invoice.status, notify 
  client + admin if relevant
- invoice.payment_failed → update status, notify client + admin
- customer.subscription.updated → sync stripe_subscription record
- customer.subscription.deleted → mark subscription canceled
- payment_method.attached → update card-on-file display

Signature verification on every webhook (reject anything that doesn't 
verify).

### 11. Smoke test

End-to-end:
1. Use the activated test client from step I's smoke run (or activate 
   a fresh one)
2. Log in to portal with temp credentials
3. Verify forced redirect to /portal/walkthrough
4. Complete step 1 (welcome → continue)
5. Complete step 2 (set new password, verify portal_account updated)
6. Complete step 3 (click all signature/initial markers, fill them, 
   add final signature, submit — verify document_signature rows, 
   contract.signed_at set, state advanced)
7. Complete step 4 (use Stripe test card 4242 4242 4242 4242 — verify 
   stripe_customer, stripe_subscription, stripe_invoice rows; verify 
   setup fee charged immediately, subscription created with correct 
   start date)
8. Complete step 5 (verify walkthrough_completed=true, admin 
   notification, client confirmation email)
9. Try to access /portal/documents before any step — verify redirect 
   to walkthrough
10. Try to skip a step via direct API call — verify 409 from state 
    machine guard
11. Test Stripe failure path: use test card 4000 0000 0000 0002 
    (declined) — verify walkthrough doesn't advance, error displays, 
    retry works
12. Test webhook: simulate invoice.payment_succeeded — verify 
    stripe_invoice updated
13. audit_log clean throughout, document_signature rows complete with 
    IP/UA/typed values

## Out of Scope for Step J
- Multi-user clients (one portal_account per client in v1)
- PDF generation if HTML download is shipped instead (defer)
- Alternate payment methods beyond Stripe card (ACH, etc.)
- Walkthrough analytics
- File uploads from client during walkthrough

## Constraints
- Stripe integration must handle the production webhook signature 
  verification correctly — no shortcuts here
- All signature events captured with full audit trail (ip, ua, typed 
  name, timestamp)
- Setup fee + subscription are separate Stripe objects (one-time 
  invoice + subscription) — don't conflate them
- Walkthrough state must persist across browser closes; resuming the 
  portal lands on the correct step

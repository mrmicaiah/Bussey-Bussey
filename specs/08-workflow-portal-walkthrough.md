# 08 — Workflow: First-Login Portal Walkthrough

The client's first impression of the Bussey platform. A clean, guided 4-step sequence: secure account → sign contract → set up payment → done. Once complete, they have ongoing portal access.

## Actors
- Client (newly activated, first login)
- System (gates progression, captures audit data)

## Entry

Client receives credentials (from admin handoff). Goes to portal URL. Logs in with email + temporary password.

System checks `portal_account.walkthrough_completed`. If false, locks the client into the walkthrough — they cannot access normal portal until walkthrough is done.

## Walkthrough Steps

### Step 1: Welcome

- Greeting: "Welcome, [Name]. Let's get [Opportunity Name] activated. This takes about 5 minutes."
- High-level overview of the 4 steps with progress indicator
- [Continue] button

### Step 2: Secure Your Account (Force Password Change)

- Header: "First, let's secure your account."
- Fields: new password, confirm password
- Password requirements: 10+ chars, mixed case, number or symbol (enforced client + server side)
- Old password not required (they just logged in with the temp)
- On submit: password updated, `must_change_password = false`, `walkthrough_state = password_set`
- [Continue] button

### Step 3: Review and Sign the Contract

- Header: "Review your agreement"
- Contract document displayed inline (rendered from template + opportunity data)
- Scrollable, readable, paginated if long
- **Inline signature/initial points** embedded in the document:
  - Where "Initial here" appears: clickable field. On click, opens micro-modal asking for initials. Once entered, the initials display in the field. Captures: typed_initials, ip, timestamp.
  - Where "Sign here" appears: clickable field. On click, opens modal for full legal name. Once entered, name displays in the field. Captures: typed_name, ip, timestamp.
- Required at bottom: checkbox "I have read and agree to the above contract"
- Required at bottom: typed full legal name (final signature)
- All initial/sign fields must be completed before final submission
- On submit:
  - One `document_signature` record per signature/initial field, all timestamped now
  - One additional document_signature record for the final agreement ("agreement_acceptance")
  - Contract record marked as signed with `signed_at` timestamp
  - `walkthrough_state = contract_signed`
- [Continue] button

### Step 4: Payment Setup

- Header: "Set up your payment method"
- Summary box showing:
  - Setup fee: $X (charged today)
  - Monthly subscription: $Y (billed monthly starting [date])
  - Next billing date: typically 30 days from today, or aligned to project go-live
- Embedded Stripe Elements / Stripe Checkout for entering payment details
- On Stripe confirmation:
  - Stripe customer created (if not already)
  - Setup fee invoice created and immediately charged
  - Monthly subscription created with `current_period_start = today` (or configured delay)
  - `stripe_subscription` and `stripe_invoice` records written
  - `walkthrough_state = payment_set`
- If payment fails: stay on this step, show clean error, allow retry. Walkthrough state does not advance.
- [Continue] button (only enabled after successful payment)

### Step 5: Congratulations

- Header: "You're all set, [Name]. Welcome to Bussey and Bussey."
- Brief explanation of what happens next:
  - "Your project officially kicks off [date]."
  - "You'll hear from us within 24 hours with next steps."
  - "You can return to this portal anytime to view your documents, payment history, or request changes."
- Two CTAs:
  - [Enter Portal] (primary)
  - [Download signed contract] (secondary)
- On reaching this screen: `walkthrough_completed = true`, `walkthrough_state = complete`, audit_log entry written, admin gets a notification

## Behavior Rules

**Cannot skip steps.** Each step gates the next. If a client logs out mid-walkthrough, they resume exactly where they left off (from `walkthrough_state`).

**Cannot bypass walkthrough.** Until `walkthrough_completed = true`, all portal navigation other than the walkthrough is blocked.

**Cannot retry signed steps.** Once contract is signed, that step is done; revisiting shows a read-only view of the signed contract.

**Payment retry allowed.** Until payment succeeds, client can re-enter card info as many times as needed.

## Signature Capture Detail

For each signature/initial event:
- `document_signature.document_type` = contract
- `document_signature.document_id` = contract.id
- `document_signature.signature_type` = signature or initial
- `document_signature.typed_name` (for signatures) or `typed_initials` (for initials)
- `document_signature.ip_address` (from request)
- `document_signature.user_agent`
- `document_signature.signed_at` = now
- `document_signature.portal_account_id`
- `document_signature.opportunity_id` (for fast lookup)

This array of signature events constitutes the audit trail for the contract. Should be retrievable as a signature audit report (admin and client can both view).

## Email Notifications

- **Admin:** notification when walkthrough is completed ("[Client] just activated [Opportunity]")
- **Client:** a single confirmation email at completion containing receipt for setup fee, summary of subscription, link to signed contract PDF

## Edge Cases

**Client never logs in.** Pending Activation state. After configurable threshold (default 3 days), admin alerted. Admin can re-share credentials or reset password.

**Client logs in, abandons mid-walkthrough.** State persisted. Re-entering portal resumes at last completed step. Admin can see what step they're stuck at.

**Client refuses to sign as-displayed.** They contact admin, admin handles via change order or new clone. Walkthrough doesn't advance; can be re-issued with updated contract.

**Payment card declined repeatedly.** After N failures (configurable, default 3), admin alerted. Admin can work with client outside the system.

## Out of Scope (v1)

- Multiple required signers from client side
- Customizable walkthrough steps per client
- Alternate payment methods (ACH, wire, check) — Stripe card only in v1
- Walkthrough analytics (how long each step took, drop-off points)
- Client uploading additional documents during walkthrough

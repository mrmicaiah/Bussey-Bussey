# 07 — Workflow: Acceptance & Activation

The handoff from sales to active client. Admin clicks Accepted on the disposition (in the admin window). System creates the client portal account, generates credentials, creates the project record (with snapshot-copied presentation notes), and prepares everything the client needs for their first login.

## Actors
- Admin user (clicks Accepted, hands off credentials)
- System (orchestrates account creation, project creation, document generation, snapshot lock)

## Trigger

Admin clicks 🟢 Accepted button on the opportunity detail page in admin (not in the presentation window — dispositions live in admin).

## Flow

```
Admin clicks Accepted on opportunity page
        │
        ▼
Confirmation modal: "Activate [Client Name] for [Opportunity Name]?"
Shows: setup total, monthly total, what happens next
        │
        ▼
Admin confirms
        │
        ▼
System performs activation (transactional — all or nothing):
  • opportunity.status → accepted
  • opportunity.accepted_at → now
  • proposal.status → accepted
  • pricing_snapshot now fully immutable
  • line items now fully immutable
  • Generate the contract document from template + proposal data
  • Create project record:
      - linked to opportunity and client
      - presentation_notes snapshot-copied from proposal.presentation_notes
      - status = kickoff
      - delivery_notes initialized (empty)
  • Create portal_account for client.primary_contact_email
  • Generate cryptographically secure temporary password
  • Mark portal_account.must_change_password = true
  • Mark portal_account.walkthrough_completed = false
  • Mark portal_account.walkthrough_state = new
  • Set client.status → active (or 'activating' until walkthrough complete)
  • Write audit_log entry
        │
        ▼
Credentials screen shown to admin:
  • Client portal URL
  • Email (client's primary contact email)
  • Temporary password (visible, with copy button)
  • Buttons: [Copy All] [Email to Client] [Done — I'll share manually]
        │
        ▼
Admin hands off credentials (in person, text, email — admin's choice)
        │
        ▼
Opportunity now shows status "Pending Activation" in admin dashboard
until client completes walkthrough
```

## Confirmation Modal

Shows the admin a summary before committing:
- Client name and contact email
- Opportunity name
- Setup total
- Monthly subscription amount
- Warning text: "This will lock the proposal scope and pricing, create the project record, and create the portal account. The client will need their login to complete activation. After this, scope and pricing changes require a signed change order."
- [Cancel] [Confirm — Activate]

## What Becomes Immutable at Acceptance

- Proposal scope (line items)
- Proposal pricing (totals, line item amounts, snapshot rates)
- Contract terms as rendered into the contract document

From this point, only change orders can modify these.

## What Stays Editable After Acceptance

- Client administrative data (contact info, billing address, internal notes on client)
- Proposal's presentation_notes and internal_notes (audit-logged; doesn't affect project since project has its own snapshot)
- Project's delivery_notes and project status fields
- Calling list, leads, all unrelated entities

## Contract Generation

On acceptance, the system generates the contract document:
- Pulled from a master contract template (Markdown or HTML template)
- Populated with:
  - Client info (legal company name, address, primary contact)
  - Opportunity details (name, scope summary)
  - Setup fee and monthly subscription amounts
  - Term language, change order clause, governing law, etc.
  - Signature points: "Sign here" (legal name), "Initial here" (multiple locations on the contract)
- Stored as a contract record linked to the opportunity
- Rendered for the client during the portal walkthrough

The template itself is stored in the repo (under `/templates/contract/master.md` or similar) and should be lawyer-reviewed before first use.

## Project Creation

A `project` record is created at acceptance, linked to the opportunity:
- `presentation_notes`: snapshot copy of proposal.presentation_notes at this moment. Independent from this point forward.
- `delivery_notes`: empty, grows during build
- `status`: kickoff
- `name`: inherited from opportunity

The project becomes the working surface for delivery (separate from the proposal which is locked and historical-with-respect-to-scope).

## Credentials Handoff

**Why manual handoff:** keeps the admin in control of when and how the client gets the login. Prevents the credentials email getting lost or filtered as spam. Lets the admin verbally walk through it on the closing call.

**Credentials screen options:**
- **Copy All:** copies a pre-formatted block (URL + email + password) to clipboard
- **Email to Client:** sends a polished email with the credentials and a "what to do next" intro
- **Done — I'll share manually:** dismisses the screen without sending anything

The credentials screen is accessible later from the opportunity page in case admin needs to re-display them (within a limited window — see security note below).

## Security Notes

- **Temporary password:** cryptographically random, 12+ chars, must be changed on first login
- **Re-display window:** credentials shown on opportunity page for 24 hours after creation; after that, admin must trigger a password reset to share again
- **No password in audit log:** audit log records that a portal account was created, but never logs the password itself
- **Email sending (if used):** uses a transactional email provider; subject line and content kept innocuous to reduce spam filtering

## Pending Activation State

Until the client completes their walkthrough, the opportunity sits in a visible "Pending Activation" state in admin.

Sub-states (from portal_account.walkthrough_state):
- `new` — credentials issued, client has not logged in yet
- `password_set` — client logged in, set new password, hasn't signed contract
- `contract_signed` — contract signed, hasn't completed payment setup
- `complete` — walkthrough done, fully active

Admin dashboard surfaces pending-activation accounts with time-since-acceptance counters. Alerts after 3 days, escalating after 7 days.

## Reversibility

If a client never completes activation and admin needs to roll back:
- Admin can manually mark opportunity as `lost` with reason
- Portal account is disabled
- Project record marked as canceled/never_started
- Pricing snapshot stays (historical record)
- This is an unusual case — most deals that get to "Accepted" complete activation within days

## What's NOT Generated Yet at Activation

- **Stripe customer / subscription:** not created until client enters payment info during walkthrough
- **Setup invoice:** not created until walkthrough payment step
- **First monthly invoice:** scheduled by Stripe after subscription is created

The rationale: don't create payment objects in Stripe until the client has actually entered payment info. Keeps Stripe clean and avoids dangling/incomplete customer records.

## Out of Scope (v1)

- Co-signers / multiple required signatories on the client side
- Counter-signature by Bussey (handled by the platform existing — your acceptance is implicit)
- Custom contract amendments at acceptance time (use change orders post-acceptance)
- Multi-step internal approval before activation

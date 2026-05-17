# 07 — Workflow: Acceptance & Activation

The handoff from sales to active client. Admin clicks Accepted in the opportunity detail page. System locks the proposal, creates the project, creates the portal account, and prepares everything the client needs for their first login.

## Actors
- Admin user (clicks Accepted, hands off credentials)
- System (orchestrates project creation, account creation, document generation, snapshot lock)

## Trigger

Admin clicks 🟢 Accepted button in the disposition section of the admin opportunity detail page.

## Flow

```
Admin clicks Accepted in admin window
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
  • pricing_snapshot.is_locked → true (snapshot now permanently immutable)
  • Create project record:
      - opportunity_id
      - name (copied from opportunity)
      - status = kickoff
      - presentation_notes = COPY of proposal.presentation_notes (snapshot)
      - created_at = now
  • Generate the contract document from template + proposal data
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
- Warning text: "This will lock the pricing snapshot, create the project, and create the portal account. The client will need their login to complete activation."
- [Cancel] [Confirm — Activate]

## Project Creation

A `project` record is created automatically as part of activation:

- Linked 1:1 to the opportunity
- `name` copied from opportunity
- `status` = `kickoff` (will become `active` when admin marks it ready, or when first delivery work begins)
- `presentation_notes` = **snapshot copy** of `proposal.presentation_notes` at this exact moment
- After this copy, the project's notes are independent from the proposal's. Edits to one do not affect the other.
- Linked back to the proposal for historical reference

The project is the post-acceptance delivery container. It's where build status lives, where delivery notes accumulate, and where the team focuses after sales hands off.

## Snapshot Lock

At this point, `pricing_snapshot.is_locked` becomes true. From here forward:
- Proposal scope is immutable
- Pricing is immutable
- All future scope/pricing changes must go through change orders (workflow 09)
- Administrative fields (contact info, billing address, project status notes) remain freely editable with audit logging

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
- Project record stays for historical purposes (status set to canceled)
- Pricing snapshot stays locked (historical record)
- This is an unusual case — most deals that get to "Accepted" complete activation within days

## What's NOT Generated Yet at Activation

- **Stripe customer / subscription:** not created until client enters payment info during walkthrough
- **Setup invoice:** not created until walkthrough payment step
- **First monthly invoice:** scheduled by Stripe after subscription is created

The rationale: don't create payment objects in Stripe until the client has actually entered payment info. Keeps Stripe clean and avoids dangling/incomplete customer records.

## Out of Scope (v1)

- Co-signers / multiple required signatories on the client side
- Counter-signature by Bussey (handled by the platform existing — your acceptance is implicit)
- Custom contract amendments at acceptance time (use change orders instead)
- Multi-step internal approval before activation
- Detailed project kickoff briefing UI (the project record exists with presentation_notes carried forward; richer kickoff features come in a later iteration)

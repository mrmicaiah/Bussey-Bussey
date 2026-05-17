# 10 — Workflow: Active Client Portal

Once walkthrough is complete, the client has ongoing portal access. This is their window into the engagement: documents, payment status, project status, change order capability.

## Actors
- Active client (any user with a completed portal_account)
- Admin (updates project status visible to client)

## Portal Structure (After Walkthrough)

```
┌─────────────────────────────────────────────────────────┐
│  Bussey and Bussey Portal — [Client Name]               │
│                                                  [logout]│
├─────────────────────────────────────────────────────────┤
│  ▸ Overview                                              │
│  ▸ Documents                                             │
│  ▸ Project Status                                        │
│  ▸ Change Orders                                         │
│  ▸ Payment & Billing                                     │
│  ▸ Account                                               │
└─────────────────────────────────────────────────────────┘
```

## Section: Overview

Dashboard summary, the default landing page:
- Current engagement: opportunity name, started date
- Current monthly: $X (next bill: [date])
- Project status: [current phase] — short description
- Recent activity: last 3-5 events (change order approved, payment received, status updated, etc.)
- Quick actions: Request Change | View Latest Documents

## Section: Documents

Full document library:
- Master Service Agreement (signed contract)
- Original proposal (the accepted version)
- All approved change orders (each with signed amendment doc)
- Pending change orders (with Review & Approve buttons)
- Each document: view inline, download PDF, view signature audit

Section layout:
```
📄 Master Service Agreement — signed 11/15/2025
   View | Download PDF | Signature Audit

📋 Change Order #1 — approved 02/03/2026
   Added: Scheduling module
   Net: +$3,500 setup, +$200/month
   View | Download PDF | Signature Audit

[Pending] 📋 Change Order #2 — proposed 03/15/2026
   Adding: QuickBooks integration
   Net: +$1,200 setup, +$0/month
   Review and Approve ▶
```

## Section: Project Status

A simple, admin-controlled status view. No fancy project management — just clear communication.

Fields visible to client (all admin-controlled):
- **Current Phase:** e.g., Discovery, Build, Testing, Handoff, Live, Ongoing Support
- **Status note:** free-text description of where things are ("Completing audit-readiness module, expected demo this Friday")
- **Next milestone:** what's coming next and when
- **Last updated:** timestamp

Updated manually by admin from the opportunity record. Client sees what admin writes. No automated tracking in v1.

Optional: a phase progress indicator (5 phases, current one highlighted) for visual clarity.

## Section: Change Orders

List of all change orders for this client's engagement(s):
- Pending (needing client approval)
- Approved (with date and impact)
- Rejected (with date)
- Withdrawn

**Request a Change** button at top — opens a simple form:
- Description of what they want changed
- Optional: priority / urgency
- Submit → creates a notification to admin (not a change order yet — admin reviews and decides how to scope/price it)

This is the formal channel for client-initiated change requests. Reduces "hey can you also..." emails.

## Section: Payment & Billing

Financial transparency:
- Current subscription: $X/month, next billing date
- Payment method on file (last 4 of card, brand) — with Update button
- Invoice history: list of all past invoices (setup, monthly, change orders) with paid/failed status
- Each invoice: view receipt, download PDF
- Failed payments: clearly flagged with action to update card and retry

Stripe Customer Portal embed (or custom UI calling Stripe APIs) for updating payment method.

## Section: Account

Client account management:
- Change password
- View account email (read-only — to change, contact admin)
- View company info (read-only — to change, contact admin)
- Notification preferences (email cadence for various events)
- View signature audit history (all signatures this user has provided)
- Logout button

## Admin View of Active Clients

In admin, each active client's record shows:
- All the same data the client sees in their portal (admin can view as them)
- Project status fields editable by admin
- Billing status, Stripe subscription health
- Recent client portal activity (logins, change order interactions)
- Notes (admin-only) about the engagement
- Quick action: create change order, update project status, send notification

## Notifications to Client

Automated emails to client (configurable):
- Change order proposed → "You have a change order to review"
- Payment receipt → "Your monthly payment of $X processed successfully"
- Payment failed → "Action needed: payment failed"
- Project status update (optional, when admin updates with notify flag)
- Major milestone reached (optional)

Keep notifications minimal and meaningful. Spam fatigue erodes trust.

## Multi-Opportunity Clients

A client may have multiple active opportunities over time (e.g., bought "Hiring" in year 1, added "Scheduling" in year 2 as a separate engagement instead of a change order).

When this happens:
- Portal shows a project switcher at the top
- Each project has its own documents, status, change orders, and (potentially separate) Stripe subscription
- Billing section consolidates: shows all subscriptions and combined monthly

In v1, assume one active opportunity per client is the common case. Multi-opportunity is supported in the data model but not heavily designed in the UI.

## Security Notes

- Portal sessions: HTTP-only secure cookies, configurable timeout (default 30 days idle)
- Sensitive actions (change password, update payment) may require re-auth (recent login check)
- All portal actions write to audit_log
- Rate limiting on login attempts to prevent brute force

## Out of Scope (v1)

- Multiple users per client (only one portal account per client; multi-user comes later)
- Real-time chat with Bussey team via portal
- File uploads from client (could add for change request attachments)
- Custom branding per client
- Mobile app (portal is responsive web only)
- Single sign-on / SAML

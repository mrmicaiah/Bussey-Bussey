# Step K2 — Remaining Portal Sections

Goal: With change orders fully working from K1, build the supporting 
portal experience that surrounds them. Documents library, payment & 
billing, project status, account, change request form, overview 
dashboard.

## Subtasks

### 1. Documents section (/portal/documents)

Document library timeline:
- Master Service Agreement (signed contract from step I)
- Original proposal (the accepted version — render the proposal as 
  a clean document, not a presentation)
- All approved change orders with their signed amendment docs
- All pending change orders (link to /portal/change-orders/[id])

Each row:
- Title, signed date (or proposed date for pending)
- Inline view (rendered markdown)
- Download as markdown blob
- View signature audit (list of document_signature rows: typed name, 
  date, IP, signature_type)

Reuse the rendering machinery from the walkthrough contract step. 
Documents are read-only views.

### 2. Project Status section (/portal/project-status)

Read-only client view of:
- Current phase (project.current_phase)
- Status note (project.build_status_note)
- Next milestone (project.next_milestone)
- Last updated timestamp (project.updated_at)
- Started on (project.created_at)

Add project.updated_at column if not already present (migration 
0007 if needed). Admin PUT endpoint already updates this implicitly 
via updated_at trigger, or explicitly — confirm and document.

### 3. Payment & Billing section (/portal/payment)

Financial transparency:
- Current subscription card: $X/month, next billing date (from 
  stripe_subscription.current_period_end), payment method on file 
  (last 4 + brand from latest payment_method.attached webhook), 
  Update payment method button
- Invoice history table: all stripe_invoice rows for this client 
  ordered desc by created_at
  - Setup fee invoice (kind=setup)
  - Monthly invoices (kind=other or whatever Stripe webhooks 
    populate)
  - Change order setup deltas (kind=change_order_setup)
  - Each row: date, kind label, amount, status (paid/failed/
    pending), [view receipt link if available]

Update payment method flow:
- Use Stripe Customer Portal embed (recommendation from spec, fastest 
  to ship)
- New endpoint POST /api/portal/payment/portal-session creates a 
  Stripe Billing Portal session and returns the URL
- Portal redirects client to Stripe-hosted UI for card update
- On return, Stripe webhook payment_method.attached fires and 
  updates display

### 4. Change Request form (/portal/change-requests/new)

Pre-change-order request form (not the same as a change order):
- Free-text description (required)
- Urgency dropdown: routine / soon / urgent (or similar — keep 
  simple)
- Submit → POST /api/portal/change-requests

Backend creates change_request row. Admin gets notified (new 
notification.kind: change_request_submitted — add to enum in 
migration 0007 if you're already adding project.updated_at, otherwise 
defer with the others).

Schema: new change_request table per the step K scope:
- id, client_id, opportunity_id, description, urgency, status 
  (submitted/reviewed/declined/converted_to_change_order), 
  submitted_at, reviewed_at, notes

Admin view: list of change_requests in admin opportunity detail or 
a dedicated /admin/change-requests page. Each row has actions: 
mark reviewed, convert to change order (jumps to change order 
builder with description pre-filled), decline with reason.

### 5. Account section (/portal/account)

- Change password (POST /api/portal/auth/change-password — already 
  exists)
- View account email (read-only — note "Contact us to change" or 
  similar)
- View company info (read-only)
- Notification preferences: ship UI with two toggle defaults — 
  "Email me when change orders are proposed" (default on), 
  "Email me when payments succeed/fail" (default on). Don't 
  implement the actual filtering yet; store the preferences on 
  portal_account (new columns notify_change_orders, 
  notify_payments) but use them only in K3+ if at all. Add 
  deferred-cleanup entry: "Notification preferences UI shipped 
  but not yet enforced in send logic."
- Signature audit history: list all document_signature rows for 
  this portal_account, showing document_type, signed_at, 
  signature_type, typed value
- Logout button

### 6. Portal home / Overview (/portal/)

Default landing page post-walkthrough. Assembles data from the 
other sections:
- Current engagement: opportunity.name, project.created_at
- Current monthly: from stripe_subscription, next bill date
- Project status: current_phase + build_status_note from project
- Recent activity feed: last 5 events from audit_log filtered to 
  client-visible events:
  - change_order.proposed (you have something to review)
  - change_order.approved (change order approved)
  - change_order.rejected
  - stripe_invoice.paid (payment received)
  - stripe_invoice.failed (payment failed — action needed)
  - project.updated when build_status_note or current_phase changed
- Quick actions: Request a Change (link to /portal/change-requests/
  new), View Documents (link to /portal/documents)

The activity feed needs a backend endpoint:
- GET /api/portal/activity — returns last N audit_log rows scoped 
  to this client, filtered to client-visible actions
- Client-visible actions list documented in a constant at the top 
  of the route handler (audit log has admin-only entries that 
  shouldn't surface here)

### 7. Notification emails

Per spec 10, the events that fire emails:
- change_order.proposed → email client ("you have a change order 
  to review", link to portal)
- stripe_invoice.payment_succeeded → email client (receipt)
- stripe_invoice.payment_failed → email client + admin (action 
  needed)
- project.updated with notify_client=true flag → email client 
  (status update from your project)

Project notify_client flag: add to admin PUT endpoint as an 
optional boolean. When true, fires the notification. Default false.

Same placeholder content pattern as previous emails — isolated text 
constants for one-file swap.

### 8. Smoke test

End-to-end with Pat (existing K1 fixture with approved/rejected/
withdrawn change orders, plus the setup invoice and updated 
subscription from K1):
1. Pat lands at /portal/ — verify overview shows engagement, monthly, 
   project status, recent activity feed with K1 events
2. Visit Documents — verify contract + proposal + the approved 
   change order from K1 all listed with view/download/audit
3. Visit Project Status — verify current_phase = 'kickoff' (default), 
   build_status_note empty, next_milestone empty
4. As admin, update Pat's project: current_phase='discovery', 
   build_status_note='Initial scoping calls scheduled for week of 
   Jun 1', notify_client=true → verify Pat's portal reflects within 
   reasonable refresh, notification email queued
5. Visit Payment & Billing — verify subscription card, payment 
   method, invoice history (setup fee + change order setup delta 
   from K1)
6. Click Update Payment Method — verify Stripe Billing Portal 
   session URL returned (or dev placeholder behavior)
7. Submit a change request via /portal/change-requests/new — verify 
   change_request row created, admin notified
8. As admin, convert the change request to a change order — verify 
   change order builder opens pre-filled with description, 
   change_request.status → converted_to_change_order, 
   change_request.notes references the new change_order_id
9. Visit Account — change password, verify must_change_password 
   stays false, toggle a notification preference, verify it 
   persists
10. Trigger Stripe webhook for invoice.payment_failed (via stripe 
    listen or hand-rolled HMAC test harness) — verify Pat's portal 
    shows the failed invoice flagged, notification email queued to 
    Pat + admin
11. audit_log clean across all operations

### Schema additions

- project.updated_at (if not present) — migration 0007
- change_request table — migration 0007
- portal_account.notify_change_orders, portal_account.notify_payments
  — migration 0007 (UI-only for now, not enforced in send logic)
- Document all in migration comment

## Out of Scope for K2
- Notification preference enforcement (UI ships, behavior deferred)
- Real-time updates (polling acceptable)
- PDF generation (still deferred)
- Bulk operations on documents or invoices
- Mobile app

## Constraints
- All Stripe ops continue to honor dev-placeholder mode for local dev
- Document signature audit views are read-only
- Activity feed surfaces only client-visible events (admin-only audit 
  entries hidden)
- Email content stays in isolated constants for one-file swap

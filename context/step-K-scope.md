# Step K — Active Client Portal: Ongoing Experience

Goal: Once walkthrough_completed=true, the client has a real portal — 
documents, payment & billing, project status, account, and a Request a 
Change form. This is what they see for the lifetime of the engagement.

## K1 / K2 split

Step K is being built in two passes to keep reviews tight, matching the
hint in the original scope note:

- **K1 — Change-order lifecycle.** Subtask 7 (admin change-order builder)
  + subtask 5 partial (portal change-order review/approve/reject with
  Stripe operations and signature capture). Schema additions needed for
  this slice land in K1's migration. Smoke-test items from subtask 9
  that involve change orders (steps 4, 5, 6, 7, 8, 9) run in K1.
- **K2 — Ongoing portal sections.** Subtasks 1 (Overview / home), 2
  (Documents), 3 (Project Status), 4 (Payment & Billing), 5 remaining
  (Request a Change form + change order list views from the client
  side), 6 (Account), 8 (Notifications), plus the remaining smoke-test
  items (1, 2, 3, 10, 11).

K1 first because K2's portal Overview / Documents / Change Orders list
all want real change-order data to render against; building K1 first
gives K2 something to display.

## Subtasks

### 1. Portal home / Overview page

Default landing page post-walkthrough. Shows:
- Current engagement: opportunity name, started date
- Current monthly: $X (next bill: [date from Stripe subscription])
- Project status: current_phase + build_status_note from project record
- Recent activity feed (last 3-5 events from audit_log filtered to 
  client-visible events: change orders approved, payments processed, 
  status updates)
- Quick actions: "Request a Change" and "View Documents"

Wire to existing /api/portal/me plus new endpoints for project status 
and activity feed.

### 2. Documents section

Document library showing the timeline:
- Master Service Agreement (signed contract from step I)
- Original proposal (the accepted version, snapshot of what was 
  agreed)
- Approved change orders (each with signed amendment doc) — wire this 
  in step K even though no change orders exist yet, so the structure 
  is ready
- Pending change orders (with Review and Approve buttons) — same, 
  structure ready

Each document:
- Inline view (rendered markdown)
- Download (markdown blob for now; PDF deferred per existing cleanup 
  entry)
- View signature audit (list of document_signature rows with typed 
  name, date, IP)

### 3. Project Status section

Admin-controlled visibility into delivery progress:
- Current Phase (from project.current_phase)
- Status note (from project.build_status_note)
- Next milestone (from project.next_milestone)
- Last updated timestamp (from project.updated_at — add this column 
  if not present)

Read-only for client. Admin edits via PUT /api/admin/projects/:id 
(already implemented in pre-step before J).

### 4. Payment & Billing section

Financial transparency:
- Current subscription: $X/month, next billing date (from 
  stripe_subscription)
- Payment method on file (last 4, brand) with Update button
- Invoice history: all stripe_invoice rows for this client (setup + 
  monthly + change order setups when those exist) with paid/failed 
  status
- Each invoice: view receipt details, download receipt
- Failed payments clearly flagged with retry action

Payment method update flow:
- Use Stripe Customer Portal embed OR custom UI calling Stripe 
  setup_intents API
- Recommendation: Stripe Customer Portal for v1 — fastest to ship, 
  Stripe handles UX and edge cases. Note in deferred-cleanup if 
  preferred custom build is wanted later.

### 5. Change Orders section

List of all change orders for this client's opportunity:
- Pending (needing client approval) with Review and Approve buttons
- Approved (with date and net impact)
- Rejected (with date)
- Withdrawn

"Request a Change" button at top opens a form:
- Description of what they want changed (free text, required)
- Optional: priority / urgency
- Submit → POST /api/portal/change-requests
- Creates a notification to admin (not a change order yet — admin 
  reviews and decides how to scope/price it)
- Records as a change_request entity (new table: change_request with 
  id, client_id, opportunity_id, description, urgency, status 
  (submitted/reviewed/declined/converted_to_change_order), submitted_at, 
  reviewed_at, notes)

Change order approve/reject flow (the full lifecycle from spec 09 — 
this is the BIG subtask of step K):
- Client reviews a proposed change order in portal
- Inline signature point at bottom (single sig marker for change 
  orders)
- Approve button captures signature, fires Stripe operations:
  - setup_delta > 0: one-time Stripe invoice charged to saved payment 
    method, stripe_invoice row written
  - setup_delta < 0: Stripe credit balance applied
  - monthly_delta ≠ 0: Stripe subscription updated (next-cycle 
    timing by default per spec 09)
- Reject button captures reason, no Stripe action
- All with audit cascade pattern

### 6. Account section

- Change password (POST /api/portal/auth/change-password)
- View account email (read-only — changes via admin)
- View company info (read-only — changes via admin)
- Notification preferences (email cadence — defer the implementation, 
  ship UI with sensible defaults)
- Signature audit history (all document_signature rows for this 
  portal_account)
- Logout

### 7. Admin-side change order builder

Step K is also the moment to build the admin-side change order 
creation UI, since portal needs something to approve. In admin:
- On opportunity detail (post-acceptance), "New Change Order" button
- Change order builder UI similar to calculator but scoped to the 
  proposal's locked snapshot
- Add line items (positive cost) or remove line items (negative 
  cost / credit)
- Net impact: setup_delta and monthly_delta calculated
- Reason / description field
- Status workflow: draft → proposed (notify client) → 
  approved/rejected (by client)

This wires the existing /api/admin/change-orders endpoints (currently 
stubs from step E).

### 8. Notifications

Email notifications to client (per spec 10):
- Change order proposed: "You have a change order to review"
- Payment receipt: "Your monthly payment of $X processed successfully"
- Payment failed: "Action needed: payment failed"
- Project status update (when admin updates with notify flag — add 
  a notify_client boolean to project update endpoint)

Keep notifications minimal and meaningful. Same placeholder-text 
pattern as walkthrough emails for swap-friendly content.

### 9. Smoke test

Full end-to-end:
1. Take Pat (completed walkthrough fixture from J2) — verify portal 
   home renders correctly with subscription info, project status, 
   recent activity
2. Visit Documents — verify contract appears with view/download/audit
3. Submit a change request via portal — verify change_request row 
   created, admin notified
4. As admin, create a change order against Pat's proposal:
   - Add 1 standard_table line item
   - Add 1 premium_support subscription item
   - Reason: "Expanding scope for Q3 ramp"
   - Mark as proposed
5. As Pat, see the pending change order in portal — review, sign, 
   approve
6. Verify Stripe ops fired (in dev placeholder mode: synthetic IDs):
   - One-time invoice for setup_delta
   - Subscription updated for monthly_delta
7. Verify stripe_subscription.current_amount_monthly updated
8. Try to edit an approved change order — verify refused (immutable 
   after approval per spec 09)
9. Reject a different change order — verify status=rejected, no 
   Stripe action
10. Update project.current_phase and build_status_note via admin PUT 
    — verify portal Project Status reflects within reasonable refresh
11. audit_log clean across all operations with the cascade pattern

### Schema additions

- project.updated_at (if not already added) — for the timestamp on 
  Project Status
- change_request table — for client-initiated change requests (these 
  are pre-change-orders, not the same entity)
- Document any other schema needs in migration 0006

## Out of Scope for Step K
- PDF generation (deferred)
- Notification preference implementation (UI only, defaults assumed)
- Multi-user clients (still one portal_account per client)
- Real-time updates via WebSocket (polling is fine; Project Status 
  refreshes on page load)
- Email digest / batched notifications (one event = one email for 
  v1)

## Constraints
- All change order approvals capture full signature audit trail 
  (same pattern as initial contract signing)
- Stripe operations on change order approval must handle failures 
  cleanly — failed Stripe operation reverts change_order.status to 
  proposed, client and admin notified, no orphaned data
- Three-tier editability still holds: approved change orders 
  immutable, draft/proposed editable, status workflow strict

## Notes
- This is another large step. Acceptable to split into K1 (admin 
  change order builder + portal change order review/approval) and 
  K2 (remaining portal sections: documents, payment, project status, 
  account, change request form). Use judgment on cohesion.
- The portal home / Overview page can ship in K2 since it pulls 
  data from everywhere; build the underlying sections first, then 
  assemble the dashboard.

Hold for review at the end of K (or K1 if you split).

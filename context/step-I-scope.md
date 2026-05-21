# Step I — Acceptance & Activation Flow

Goal: Make the Accepted disposition fully transactional. Currently 
returns 202 pending; this step builds the real activation.

## Subtasks

### 1. Wire up POST /api/admin/opportunities/:id/activate
Currently a 501 stub. This is the endpoint called when Accepted is 
confirmed in the disposition modal.

### 2. Transactional activation — all or nothing
In a single D1 transaction (or compensating logic if D1 batch can't 
fully transact a multi-table change — document the approach either way):

- opportunity.status → 'accepted', opportunity.accepted_at → now
- proposal.status → 'accepted', proposal.accepted_at → now
- Create project record:
  - opportunity_id (1:1)
  - name copied from opportunity
  - status = 'kickoff'
  - presentation_notes = snapshot copy from proposal.presentation_notes
  - created_at = now
- Generate contract record from /templates/contract/master.md:
  - Variable substitution: client info, opportunity details, setup fee, 
    monthly subscription, term language
  - Marker preservation: {{sig:...}}, {{initial:...}}, {{print:...}}, 
    {{date:...}} stay in place for the walkthrough renderer in step J
  - Strip HTML comment block on render
  - Renderer must be content-agnostic (markers and variables only, no 
    awareness of section structure)
  - Store rendered body in new contract table
- Create portal_account:
  - email = client.primary_contact_email
  - password_hash = bcrypt of generated temp password
  - must_change_password = true
  - walkthrough_completed = false
  - walkthrough_state = 'new'
- Generate cryptographically secure temporary password (12+ chars)
- Set client.status → 'active' (or 'activating' until walkthrough 
  completes — choose one, document in deferred-cleanup)
- audit_log entry: opportunity.activated with snapshot of what was 
  created (never the plaintext password)

### 3. Schema additions (migration 0004 if needed)
- contract table: id, opportunity_id (1:1), body (rendered HTML or 
  markdown), template_version, generated_at, signed_at (nullable)
- Verify portal_account fields against spec 02 — walkthrough_state, 
  must_change_password, etc. should already be there
- Document any schema changes clearly in the migration comment

### 4. Activation API response
- Returns: portal URL, client email, plaintext temp password
- Plaintext password in response ONE TIME ONLY
- audit_log records credentials generated, never the plaintext
- 200 OK with credentials payload

### 5. Admin UI — credentials handoff screen
- DispositionModal for Accepted no longer says "pending step I"
- On confirm, calls /activate, receives credentials response
- Credentials handoff screen displays:
  - Client portal URL
  - Email
  - Temp password (visible, with Copy button)
  - Three action buttons: [Copy All] [Email to Client] [Done — I'll 
    share manually]
- Copy All: formatted block (URL + email + password)
- Email to Client: backend endpoint sends polished welcome email via 
  Resend (or queues if Resend key is still placeholder)
- Done — manually: dismisses screen

### 6. Re-display window logic
- Credential creation timestamp on portal_account
- Within 24h: "Show credentials" link on opportunity detail re-displays 
  the modal
- After 24h: link becomes "Reset password and share new credentials" 
  — triggers fresh temp password, expires old one, shows new modal

### 7. Pending Activation tracking
- Admin surfaces "Pending Activation" for opportunities where 
  status='accepted' but portal_account.walkthrough_completed=false
- Sub-state visible per spec 07: new / password_set / contract_signed 
  / payment_set / complete
- Time-since-acceptance counter
- Alert visual styling after 3 days, escalated after 7 days

### 8. Smoke test
- Build proposal, present, click Accepted disposition
- Verify activation runs transactionally:
  - opportunity.status = accepted
  - proposal.status = accepted
  - project record created with presentation_notes copy
  - contract record created with rendered template
  - portal_account created with temp password hash
  - client.status updated
  - audit_log entries clean
- Verify credentials screen displays correctly with all three action 
  options
- Test "Email to Client" sends real email via Resend (or queues if 
  placeholder key)
- Verify re-display works within 24h
- Verify "Pending Activation" surfaces in admin
- Try PUT on now-accepted proposal's scope/pricing — verify three-tier 
  editability locks it (should work from G1, confirm via real-flow path)
- Verify project.presentation_notes is true snapshot (edit proposal's 
  presentation_notes after acceptance, confirm project's notes 
  unchanged)
- Try clone on now-accepted proposal — verify creates new opportunity 
  under same client (per G1 clone-from-accepted rules)

## Out of Scope for Step I
- The client portal walkthrough itself (step J)
- Stripe integration / payment setup (step K)
- The actual welcome email content polish (placeholder content is fine; 
  real copy comes from the user separately)
- Contract template legal review (deferred-cleanup, lawyer review 
  before real client signing)

## Constraints
- Activation must be atomic — partial state on failure is unacceptable
- Renderer must be content-agnostic (markers and variables only)
- Plaintext password never logged, never stored, only returned once
- 24-hour re-display window enforced server-side, not just UI

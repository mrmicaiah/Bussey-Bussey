# 06 — Workflow: Presentation & Disposition

The presentation is a template-driven multi-page experience tied to an opportunity. The demo (manually built) is embedded. Dispositions are captured in the admin window — not in the presentation itself.

## Two-Window Model

During a sales call, the admin runs two windows:

**Window 1: Presentation** (shared in Zoom / shown to client)
- URL: `busseyandbussey.com/p/[opportunity-token]/`
- Read-only, client-facing view
- Shows: cover, demo, solution, investment, next steps
- Token-protected (no auth required to view)
- No disposition controls visible — this window is purely for the client to see

**Window 2: Admin / Editor** (private to admin, not shared)
- URL: `busseyandbussey.com/admin/clients/:id/opportunities/:opp_id/`
- Contains: calculator/proposal editor, presentation notes drawer, disposition controls
- Edits here propagate to the presentation window via live sync

**Why two windows:** the admin needs to control, edit, capture notes, and disposition during the call without the client seeing any of that. Sharing only the presentation window keeps the experience clean for the prospect.

## Live Sync Mechanism

When admin saves a change in Window 2 (line item edit, narrative tweak, pricing display toggle, etc.), Window 1 picks up the change automatically.

**Implementation: polling.**
- Presentation window polls the Worker every 3-5 seconds for the opportunity's `updated_at` timestamp
- If timestamp has changed since last fetch, fetch fresh data and re-render affected sections
- Visual indicator: subtle "Updated" badge appears top-right of presentation window for 2 seconds when content refreshes
- No full page reload — in-place reactive update

**Latency:** typical update appears in the presentation within 3-5 seconds. Acceptable for sales conversations.

**Future:** server-sent events for sub-second sync. Not needed for v1.

**Mid-page-navigation safety:**
- If client is viewing a page that didn't change, no visible reaction
- If client is viewing a page that did change, content updates in place; the page does not scroll; the section just re-renders
- Demo iframes do NOT auto-reload (demos are static files; their content didn't change in the database)

## Presentation URL

Each opportunity has a presentation accessible at:
`busseyandbussey.com/p/[opportunity-token]/`

- Token is unguessable (cryptographically random, ~24 chars)
- No authentication required to view
- The presentation reads from the opportunity's accepted/current proposal
- Same URL works for in-person presenting, screen-share, or sending the link

## Page Structure (Template)

All presentations have the same shell. Content swaps based on opportunity data.

1. **Cover Page**
   - Bussey and Bussey branding
   - Client name, opportunity name
   - Prepared for: [primary contact]
   - Date
   - Presenter info
   - "Begin" button

2. **The Challenge** (proposal narrative — intro section)
   - Template intro
   - Per-opportunity content: their pain in their language
   - Pulled from a freeform field on the proposal: `narrative_challenge`

3. **The Demo**
   - Embedded iframe to the demo folder for this opportunity
   - Demo URL: `busseyandbussey.com/p/[opportunity-token]/demo/`
   - Demo is hand-built static HTML/CSS/JS by admin in the repo
   - Includes "return to presentation" controls
   - Admin can choose to skip this page if no demo built (presentation works without)

4. **The Solution** (proposal narrative — solution section)
   - Template structure
   - Per-opportunity content from proposal: `narrative_solution`, `key_capabilities` list
   - Bulleted capabilities — outcome-anchored, not feature-anchored

5. **Timeline & Process**
   - Template content (high-level: discovery → build → handoff → ongoing)
   - Per-opportunity timeline if specified

6. **Investment** (pricing page)
   - Setup fee (large, prominent)
   - Monthly subscription (large, prominent)
   - "What's included" — plain language list
   - Optional categorical breakdown (toggle)
   - Stripe-style clean presentation

7. **Next Steps**
   - Standard template content
   - What happens after acceptance ("You'll get an email with portal credentials...")

**Note:** there is no "disposition page" in the presentation. Dispositions live in the admin window (see below).

## Disposition Capture (Admin Window)

After the presentation, the admin captures the outcome in the admin opportunity detail page. Four options:

### 🟢 Accepted
Triggers immediate activation. See `07-workflow-acceptance-and-activation.md` for full flow.
- Confirmation modal: "Activate [Client Name] for [Opportunity Name]?"
- On confirm: opportunity.status = accepted, opportunity.accepted_at = now, proposal.status = accepted, proposal.accepted_at = now, pricing_snapshot.is_locked = true
- Creates project record (carries forward presentation_notes from proposal)
- Creates portal_account with temporary password
- Shows credentials screen to admin

### 🟡 Follow-Up Needed
- Modal: Date picker for next follow-up, notes field
- On confirm: opportunity stays in `open` status with `next_followup_date` and notes recorded
- Adds to admin follow-up queue
- Optional reminder fires on the chosen date

### 🟠 Changes Requested
- Modal: short note field for what changes are requested
- On confirm: opportunity status stays open, notes recorded
- **Admin returns to the proposal editor and makes the requested changes directly.** No formal change order — the proposal is still in draft and freely editable.
- After edits, admin re-presents (same URL, updated content via live sync)
- If presentation is over 90 days old, system prompts to clone before further editing

### 🔴 Declined
- Modal: Reason dropdown (too_expensive / bad_timing / went_with_competitor / not_a_fit / other) + notes
- On confirm: opportunity.status = lost, opportunity.lost_reason = reason, notes recorded
- Proposal status = declined
- Client status reviewed (if no other open opportunities, client becomes prospect or former)

## Pre-Acceptance Revisions

There are no "pre-acceptance change orders." Revisions before acceptance are just edits to the draft proposal:

- Prospect requests changes → admin clicks Changes Requested disposition (captures the note)
- Admin edits the proposal directly (line items, narrative, anything)
- Snapshot rates stay locked to original creation rates (no refresh)
- Presentation window updates automatically via live sync (or after re-share)
- Re-present to prospect when ready
- When prospect eventually accepts, whatever's in the proposal at that moment is what gets locked

This is much simpler than a change order ledger of pre-acceptance modifications, and matches how draft documents actually work.

## Presentation Editing

Admin can edit presentation content from the proposal record:
- `narrative_challenge` (text)
- `narrative_solution` (text)
- `key_capabilities` (list)
- `pricing_display_mode` (summary / categorical / full)
- `demo_enabled` (boolean — show or skip demo page)
- `custom_pages` (optional — for adding extra slides, not in v1)
- Pricing line items (via calculator)
- Presentation notes (internal, never displayed)

All edits propagate to the presentation window via live sync.

## Demo Folder Convention

For each opportunity that needs a demo:
- Folder created at: `/demos/[opportunity-token]/` in the Eleventy repo
- Admin builds the demo by hand using Claude in IDE
- Standard demo template/scaffold available to copy from
- Demo is included in the Eleventy build, served as static files at `/p/[opportunity-token]/demo/`
- Each demo can have multiple pages and its own navigation
- Demos are not authenticated — the unguessable token is the only protection (good enough for sales demos)

## Mobile / Responsive

- Presentation is responsive but designed primarily for desktop/laptop screens
- Mobile presentation works for review but admin shouldn't present from mobile
- Demo embedding gracefully degrades on small screens

## Out of Scope (v1)

- Live collaborative viewing (Zoom-style synchronization beyond simple polling)
- Analytics on which pages prospect viewed (could be added later)
- Video embedding within presentation
- Multiple presenters with role switching
- Localization / multi-language
- WebSocket / SSE live sync (polling is sufficient for v1)

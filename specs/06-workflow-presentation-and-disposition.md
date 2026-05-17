# 06 — Workflow: Presentation & Disposition

The presentation is a template-driven multi-page experience tied to an opportunity. The demo (manually built) is embedded. At the end, the admin captures the disposition.

## Actors
- Admin user (drives the presentation, captures disposition)
- Prospect (views the presentation alongside admin, or via shared link)

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

8. **Disposition** (admin-only on this page)
   - This page is visible at the end of the deck
   - Client-facing content: "Ready to move forward? Let's talk." + standard text
   - Admin-only controls: four action buttons (see below)
   - Controls visible only when admin is authenticated (or on admin-side of a split view)

## Disposition Actions

Four outcomes. Each is captured when admin clicks the button.

### 🟢 Accepted
Triggers immediate activation. See `07-workflow-acceptance-and-activation.md` for full flow.
- Confirmation modal: "Activate [Client Name] for [Opportunity Name]?"
- On confirm: opportunity.status = accepted, opportunity.accepted_at = now, proposal.status = accepted, proposal.accepted_at = now
- Creates portal_account with temporary password
- Locks the pricing snapshot permanently
- Shows credentials screen to admin

### 🟡 Follow-Up Needed
- Modal: Date picker for next follow-up, notes field
- On confirm: opportunity stays in `open` status with `next_followup_date` and notes recorded
- Adds to admin follow-up queue
- Optional reminder fires on the chosen date

### 🟠 Changes Requested
- Modal: Notes field for what changes are requested
- On confirm: opportunity status = open, notes appended
- System prompts admin: "Create a change order for these revisions?" → opens change order draft
- After change order(s) drafted, admin can re-present (same URL, updated content)
- When prospect finally accepts, the base proposal + pre-acceptance change orders together form the agreement

### 🔴 Declined
- Modal: Reason dropdown (too_expensive / bad_timing / went_with_competitor / not_a_fit / other) + notes
- On confirm: opportunity.status = lost, opportunity.lost_reason = reason, notes recorded
- Proposal status = declined
- Client status reviewed (if no other open opportunities, client becomes prospect or former)

## Pre-Acceptance Change Orders

When Changes Requested is chosen:
- Admin creates change orders against the current proposal
- These change orders are visible in the presentation (separate section or inline updates to pricing page)
- The Investment page recalculates: base proposal + all pre-acceptance change orders = current total
- When eventually Accepted, all pre-acceptance change orders are included in the locked agreement
- They appear in the signed contract as part of the original scope (not as separate amendments)

## Presentation Editing

Admin can edit presentation content from the proposal record:
- `narrative_challenge` (text)
- `narrative_solution` (text)
- `key_capabilities` (list)
- `pricing_display_mode` (summary / categorical / full)
- `demo_enabled` (boolean — show or skip demo page)
- `custom_pages` (optional — for adding extra slides, not in v1)

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

- Live collaborative viewing (Zoom-style synchronization)
- Analytics on which pages prospect viewed (could be added later)
- Video embedding within presentation
- Multiple presenters with role switching
- Localization / multi-language

# 06 — Workflow: Presentation & Disposition

The presentation is a template-driven, read-only, client-facing view of the opportunity. It's designed to be shared on Zoom (or presented in person) while the admin keeps a separate editing window for live updates. The disposition (outcome) is captured in the admin window after the presentation, not on the presentation page itself.

## Actors
- Admin user (drives the presentation from the admin window, captures disposition)
- Prospect (views the presentation, either over screen-share or via shared link)

## Two-Window Mode

This is the key workflow shape:

```
┌──────────────────────┐   ┌───────────────────────────┐
│  ADMIN WINDOW       │   │  PRESENTATION WINDOW       │
│  (admin's screen)   │   │  (shared on Zoom)          │
│                     │   │                            │
│  Calculator         │◄──►│  /p/[opportunity-token]/   │
│  Edit fields        │   │                            │
│  Save               │   │  Cover                     │
│                     │   │  Challenge                 │
│  Disposition btns   │   │  Demo                      │
│  [Accepted]         │   │  Solution                  │
│  [Follow-Up]        │   │  Timeline                  │
│  [Changes Req.]     │   │  Investment                │
│  [Declined]         │   │  Next Steps                │
│                     │   │                            │
│  Notes strip        │   │  (read-only, public-token) │
└──────────────────────┘   └───────────────────────────┘

         When admin saves → presentation updates within seconds (polling sync)
```

- **Admin window:** authenticated, full control. Calculator, editing, presentation notes, disposition controls.
- **Presentation window:** anonymous (token-protected), read-only, pure client-facing display.
- The presentation window polls for updates every few seconds. When admin saves changes, the presentation auto-refreshes the relevant content in place — no manual page reload required, no scroll loss, no demo iframe reload (unless demo content actually changed).
- Visual indicator (subtle "Updated" badge) flashes when content syncs, so admin knows their edit took effect.

This pattern lets admin edit live during a call without ever touching the screen the client is looking at.

## Presentation URL

Each opportunity has a presentation accessible at:
`busseyandbussey.com/p/[opportunity-token]/`

- Token is unguessable (cryptographically random, ~24 chars)
- No authentication required to view
- The presentation reads from the opportunity's current proposal
- Same URL works for in-person presenting, screen-share, or sending the link to the prospect to view solo
- **Contains no admin controls of any kind.** The disposition is captured in the admin window.

## Page Structure (Template)

All presentations have the same shell. Content swaps based on opportunity data.

1. **Cover Page**
   - Bussey and Bussey branding
   - Client name, opportunity name
   - Prepared for: [primary contact]
   - Date
   - Presenter info

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
   - Clean, professional presentation

7. **Next Steps**
   - Standard template content
   - What happens after acceptance ("You'll get an email with portal credentials...")
   - **No disposition buttons here.** The presentation ends as a clean client-facing close.

## Live Sync Mechanism

**Implementation: polling.**

- Presentation window polls `GET /p/:token/data` every 3-5 seconds
- Response includes a `last_updated_at` timestamp on the opportunity
- If timestamp changed since last poll, fetch full data, re-render affected sections
- Re-rendering is reactive (framework handles in-place DOM updates); no full page reload
- Demo iframe is NOT reloaded unless the demo content itself was rebuilt (rare during a call)
- Subtle visual indicator: "Updated" badge top-right of the presentation window, fades after 2 seconds

Why polling and not WebSockets: simpler, no Durable Objects needed, 3-5 second latency is fine for sales presentations. Can upgrade to push-based later if needed.

## Disposition Capture (in Admin Window)

Disposition controls live on the admin opportunity detail page — not on the presentation. After (or during) the presentation, admin captures the outcome in their admin window.

Four outcomes:

### 🟢 Accepted
Triggers immediate activation. See `07-workflow-acceptance-and-activation.md` for full flow.
- Confirmation modal: "Activate [Client Name] for [Opportunity Name]?"
- On confirm: opportunity.status = accepted, opportunity.accepted_at = now, proposal.status = accepted, proposal.accepted_at = now
- Creates portal_account with temporary password
- Locks the pricing snapshot permanently
- Creates the project record, snapshot-copies presentation notes to it
- Shows credentials screen to admin

### 🟡 Follow-Up Needed
- Modal: Date picker for next follow-up, notes field
- On confirm: opportunity stays in `open` status with `next_followup_date` and notes recorded
- Adds to admin follow-up queue
- Optional reminder fires on the chosen date

### 🟠 Changes Requested
- Modal: notes field for what the prospect wants changed
- On confirm: notes saved to the proposal's presentation notes or internal notes (admin's choice), opportunity stays in `open` status
- **Admin returns to the calculator and edits the draft proposal directly.** No change order is created — nothing is locked yet, so direct editing is the right move.
- Once edited, admin re-presents. Same URL, updated content via live sync.
- When prospect eventually accepts, normal Accepted flow runs against the edited proposal.

### 🔴 Declined
- Modal: Reason dropdown (too_expensive / bad_timing / went_with_competitor / not_a_fit / other) + notes
- On confirm: opportunity.status = lost, opportunity.lost_reason = reason, notes recorded
- Proposal status = declined
- Client status reviewed (if no other open opportunities, client becomes prospect or former)

## Note on Pre-Acceptance Changes

**There are no pre-acceptance change orders.** Before Accepted is clicked, nothing is locked. If the prospect asks for revisions, the admin edits the draft proposal directly. Change orders only exist post-acceptance, when the proposal has become a binding agreement.

## Presentation Editing

Admin can edit presentation content from the proposal record:
- `narrative_challenge` (text)
- `narrative_solution` (text)
- `key_capabilities` (list)
- `pricing_display_mode` (summary / categorical / full)
- `demo_enabled` (boolean — show or skip demo page)
- Cover page customization (date, presenter, custom intro line)
- Any scope/line item changes flow through the calculator

All edits flow through to the presentation window via live sync.

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

- Push-based sync (WebSockets/SSE) — polling is sufficient
- Live collaborative viewing (Zoom-style synchronization beyond shared screen)
- Analytics on which pages prospect viewed (could be added later)
- Video embedding within presentation
- Multiple presenters with role switching
- Localization / multi-language

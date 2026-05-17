# 05 — Workflow: Opportunity Creation, Calculator, Proposal

The heart of the sales operation. An opportunity is created under a client. The calculator builds a proposal. The proposal owns a pricing snapshot. From here, presentations are generated.

## Actors
- Admin user (driving the calculator)

## Flow

```
From client page, admin clicks "New Opportunity"
        │
        ▼
Opportunity creation form:
  • Name (e.g., "Audit-Ready Hiring System")
  • Description (free text)
  • Owner (admin user dropdown)
        │
        ▼
Opportunity created in status "open"
        │
        ▼
Admin lands on opportunity page. Prompt: "Build Proposal"
        │
        ▼
Proposal builder opens (calculator interface)
        │
        ▼
Admin works through the calculator. On first save:
  • Proposal record created (status = draft)
  • Pricing snapshot taken from current pricing_components
  • Proposal line items written with snapshot rates
  • 90-day staleness clock starts
        │
        ▼
Admin can freely edit the proposal:
  • Add / remove / change line items
  • Edit narrative, capabilities, pricing display mode
  • Capture presentation notes
  • Edits use snapshot rates (no refresh from live pricing_components)
        │
        ▼
Admin proceeds to presentation (see workflow 06)
```

## Calculator UI (Admin-Facing)

**Layout: Three panes plus a notes drawer.**

**Left pane — component palette.** Grouped categories:
- Tables (standard, complex)
- Roles & permissions
- Workflows & automations
- Integrations (per-system)
- AI / intelligence modules
- Dashboards & reports
- Setup & migration
- Custom (free-form line item with name + price)

Each component shows its current rate from `pricing_components` table (live), with the note that adding it to the proposal will use the proposal's snapshot rate (which equals the live rate at the moment of proposal creation).

**Middle pane — the proposal build.** Selected components show as line items:
- Component name
- Quantity (editable)
- Unit price (from snapshot — stays at original rate even when proposal is edited)
- Line total
- Description override (optional)
- Remove button

Also editable here:
- Proposal name
- Modifiers section (complexity multiplier, urgency, custom discount %)
- Notes for internal use

**Right pane — live totals.**
- Subtotal (setup)
- Modifiers applied
- Setup total
- Monthly total (sum of monthly-recurring items)
- Margin indicator (internal: what % above cost)
- Buffer indicator (internal)
- Package match: "Closest match: Professional ($X — $Y range)" — informational only

**Presentation Notes drawer (collapsible, persistent).** A free-text area for notes captured during sales conversations. Visible alongside the calculator so the admin can jot things down without losing context. Auto-saves. Internal-only.

**Action bar at bottom:**
- Save Draft
- Cancel
- Preview Presentation (opens presentation in a new window — see workflow 06)
- Clone Proposal

## Pricing Snapshot Logic

### At proposal creation (first save)
1. Read all `pricing_components` rows that are referenced in the line items, plus relevant modifiers and configuration
2. Copy the rate card state into `pricing_snapshot.snapshot_data` (JSON)
3. Each `proposal_line_item.unit_price_at_snapshot` is set from the snapshot
4. `proposal.created_at` timestamps the snapshot moment
5. `proposal.stale_after` = created_at + 90 days
6. `pricing_snapshot.is_locked` = false (mutable during draft)

### During draft editing
- Adding a line item: uses the snapshot's recorded rate for that component (NOT the current `pricing_components` rate)
- Changing quantity: recalculates line total from snapshot rate
- Removing a line item: simple deletion
- Live `pricing_components` rate changes do NOT affect this proposal's calculations
- The snapshot's `snapshot_data` is updated to reflect current line items, but the rates within it stay locked to the original creation moment

### Why this works
The original quote you showed the prospect at $X stays at $X. If a prospect says "drop the AI module," you remove it — the remaining line items keep their original rates. No surprises, no inconsistencies.

### To get fresh rates
Click "Clone Proposal." A new proposal is created with a fresh snapshot from current `pricing_components`. The old proposal is preserved (status = superseded if it was draft).

### At opportunity acceptance
- `pricing_snapshot.is_locked` = true
- Snapshot becomes fully immutable
- All future change orders use this snapshot

## Cloning a Proposal

**Trigger:** Admin clicks "Clone Proposal" on any proposal.

**Behavior:**
1. New proposal record created
2. Line items copied from source
3. **Pricing refreshed:** each line item's unit price is updated from current `pricing_components`
4. New pricing snapshot taken with current rates
5. Totals recalculated
6. `cloned_from_proposal_id` set on new proposal
7. Source proposal status set to `superseded` if it was draft (if accepted, it stays accepted — clones don't undo acceptance)
8. Presentation notes copied from source (you can edit them on the clone independently)

Clones are typically used:
- When a proposal goes stale (>90 days) and pricing has moved
- When major scope changes warrant a fresh agreement instead of a change order
- When the same opportunity needs to be re-presented with updated economics

## 90-Day Staleness Behavior

A proposal is considered stale when `now > proposal.stale_after` and `proposal.status = draft`.

Stale draft proposals:
- Are visibly flagged in UI (warning badge, banner)
- Can still be viewed
- Can still be presented (but with a warning)
- System prompts: "This proposal is over 90 days old. Clone with current pricing?"

Accepted proposals are never "stale" — they're locked into the engagement.

## Proposal Statuses

- `draft` — being built, freely editable
- `sent` — presented to client (link shared / presentation given)
- `accepted` — client accepted via disposition action; snapshot locked, scope frozen
- `superseded` — replaced by a clone
- `declined` — client declined via disposition

**State transitions:** `draft ↔ sent` is freely back-and-forth as you re-present. `draft/sent → accepted` is one-way and locks the proposal. `draft/sent → superseded` happens on clone. `draft/sent → declined` happens via disposition.

## Setup vs Monthly Components

Each `pricing_component` has a `unit_type` that determines whether it contributes to setup_total or monthly_total:
- `flat_setup` — one-time setup cost
- `per_item_setup` — quantity × unit_price, contributes to setup
- `flat_monthly` — recurring monthly
- `per_item_monthly` — quantity × unit_price, contributes to monthly
- `setup_and_monthly` — has both components (rare; better to model as two separate components)

The calculator should make it obvious which bucket each line item falls into.

## Internal vs External View

During building, the admin sees:
- All line items with rates
- Modifiers and margins
- Internal cost math
- Presentation notes drawer

When rendered into a presentation (workflow 06), the client sees:
- Outcome-grouped descriptions
- Package label (if applicable)
- Setup total
- Monthly total
- Plain-language "what's included"
- No per-component pricing breakdowns visible by default
- **Never sees presentation notes** (those are internal)

The pricing page of the presentation has a configurable display setting:
- Summary only (default)
- Categorical breakdown (group line items by category, show subtotals)
- Full line items (rarely used, only for clients who specifically want detail)

## Presentation Notes

**What they are:** free-text notes captured on a proposal during the sales conversation. Things the prospect said, context that matters for delivery, requirements implied but not in the scope, relationship details.

**Where they live:** `proposal.presentation_notes` field, free text.

**Where they appear:**
- In the calculator's notes drawer (write/edit during call)
- On the opportunity detail page in admin
- **Not in the presentation window** — client never sees them
- **Not in the portal** — client never sees them

**Snapshot to project on acceptance.** When the opportunity is accepted and a project is created (workflow 07), the proposal's presentation_notes are copied to the project as a snapshot. After that copy, the two fields are independent. The project's notes can grow during delivery without affecting the proposal record.

**Carry forward on clone.** When a proposal is cloned, presentation notes carry forward to the clone (typical case: you cloned because pricing went stale, but the conversation context is still valuable).

## Out of Scope (v1)

- Claude-driven calculator conversation (designed for, not built yet)
- Templated starting points ("start from Audit-Ready Hiring template") — could add later
- Multi-currency
- Tax handling beyond a flat tax_rate field on the proposal
- Versioned history of presentation notes (just one field; edits replace previous content; audit_log captures changes)

# 05 — Workflow: Opportunity Creation, Calculator, Proposal

The heart of the sales operation. An opportunity is created under a client. The calculator builds a proposal. The proposal locks a pricing snapshot at creation. While in draft, the proposal is freely editable using those snapshot rates. Acceptance is what locks everything.

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
Admin works through the calculator (see Calculator UI below)
        │
        ▼
On first save: system creates proposal record (status = draft),
snapshots pricing_components into pricing_snapshot,
writes proposal_line_items, calculates setup_total and monthly_total.
Snapshot rates are now locked-for-this-proposal (stay through edits).
        │
        ▼
Proposal in draft. 90-day staleness clock starts.
        │
        ▼
Admin can freely edit: add/remove line items, change quantities, edit notes.
Edits use snapshot rates (no rate refresh). Totals recalc.
No audit logging required for draft edits beyond ordinary admin activity.
        │
        ▼
Admin can: continue editing, clone (creates new proposal with fresh snapshot),
or proceed to presentation.
        │
        ▼
Proposal is locked into binding state only at Accepted disposition
(see 07-workflow-acceptance-and-activation.md).
```

## Calculator UI (Admin-Facing)

**Layout: Three panes plus a notes strip.**

**Left pane — component palette.** Grouped categories:
- Tables (standard, complex)
- Roles & permissions
- Workflows & automations
- Integrations (per-system)
- AI / intelligence modules
- Dashboards & reports
- Setup & migration
- Custom (free-form line item with name + price)

Each component shows its current rate from `pricing_components` table. Note: this is for *new* proposals. Once a proposal has its snapshot, edits use snapshot rates not these live rates.

**Middle pane — the proposal build.** Selected components show as line items:
- Component name
- Quantity (editable)
- Unit price (from snapshot — set at proposal creation, stable through draft edits)
- Line total
- Description override (optional)
- Remove button

Also editable here:
- Proposal name
- Modifiers section (complexity multiplier, urgency, custom discount %)
- Internal notes (admin-only, not visible to client)

**Right pane — live totals.**
- Subtotal (setup)
- Modifiers applied
- Setup total
- Monthly total (sum of monthly-recurring items)
- Margin indicator (internal: what % above cost)
- Buffer indicator (internal)
- Package match: "Closest match: Professional ($X — $Y range)" — informational only

**Notes strip — presentation notes.**
- Persistent, always-visible text area along the bottom or as a docked sidebar
- Free-text notes captured during the sales conversation
- Always editable, auto-saving
- Examples: "They want audit module live by March 1", "Owner is resistant to AI language", "87 caregivers, growing to 120"
- **Not visible** in the presentation window or to the client
- Snapshot-copied to the project record on acceptance

**Action bar at bottom:**
- Save Draft
- Cancel
- Open Presentation (opens presentation window in new tab; only enabled after first save)
- Clone Proposal

## Two-Window Workflow

The calculator/admin window and the presentation window are designed to work together:

- **Calculator window** (this view) — stays on the admin's screen, where they edit
- **Presentation window** (`/p/[opportunity-token]/`) — opens in a new tab, gets shared on Zoom
- When admin saves edits in the calculator, the presentation window auto-syncs within seconds (polling-based)
- See `06-workflow-presentation-and-disposition.md` for full details

## Pricing Snapshot Logic

When proposal is first saved (going from no record to draft):
1. Read all `pricing_components` rows currently active
2. Copy the rate card state into `pricing_snapshot.snapshot_data` (JSON)
3. Each `proposal_line_item.unit_price_at_snapshot` is set from the snapshot
4. `proposal.created_at` timestamps the snapshot moment
5. `proposal.stale_after` = created_at + 90 days

From this point forward:
- All edits to this proposal use snapshot rates, not live rates
- Adding a new line item later in the draft? Snapshot rate applies (snapshot includes the full rate card at creation time, even for components not initially selected).
- All change orders against this proposal (post-acceptance) use snapshot rates
- Live `pricing_components` can change freely with no impact on this proposal
- To get fresh rates: clone the proposal

## Cloning a Proposal

**Trigger:** Admin clicks "Clone Proposal" on any proposal.

**Behavior:**
1. New proposal record created in `draft` status
2. Line items copied from source
3. **Pricing refreshed:** each line item's unit price is updated from current `pricing_components`
4. New pricing snapshot taken with current rates
5. Totals recalculated
6. `cloned_from_proposal_id` set on new proposal
7. Source proposal: if draft, status set to `superseded`. If accepted, source stays accepted (clones don't undo acceptance — they create a parallel proposal).
8. Presentation notes carried over (admin can edit/extend; they're copied, not shared).

Clones are typically used:
- When a draft proposal goes stale (>90 days) and pricing has moved
- When major scope changes warrant a fresh agreement instead of a change order (rare — usually you'd use a change order)
- When the same opportunity needs to be re-presented with updated economics

## 90-Day Staleness Behavior

A proposal is considered stale when `now > proposal.stale_after` and `proposal.status = draft`.

Stale draft proposals:
- Are visibly flagged in UI (warning badge, banner)
- Can still be viewed
- Can still be presented (but with a warning)
- System prompts: "This proposal is over 90 days old. Clone with current pricing?"

Accepted proposals are never "stale" — they're locked into the engagement permanently.

## Proposal Statuses

- `draft` — being built, freely editable, can still be presented and edited
- `sent` — presented to client (link shared / presentation given); still in draft underneath — informational status
- `accepted` — client accepted via disposition action. **Scope and pricing now immutable.** Changes happen only via signed change orders.
- `superseded` — replaced by a clone (draft only)
- `declined` — client declined via disposition

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
- Presentation notes (admin-only)
- Internal notes (admin-only)

When rendered into a presentation (see 06), the client sees:
- Outcome-grouped descriptions
- Package label (if applicable)
- Setup total
- Monthly total
- Plain-language "what's included"
- No per-component pricing breakdowns visible by default
- No internal notes, no presentation notes

The pricing page of the presentation has a configurable display setting:
- Summary only (default)
- Categorical breakdown (group line items by category, show subtotals)
- Full line items (rarely used, only for clients who specifically want detail)

## Presentation Notes (captured during sales)

**Purpose:** Capture context that emerges during sales conversations — client requirements, expectations, constraints, soft factors that matter for delivery.

**Where it lives:** A `presentation_notes` text field on the proposal record. Free-text, freely editable.

**Where admin sees it:**
- Persistent notes strip in the calculator UI (always visible while editing)
- Section on the opportunity detail view
- Editable anytime while proposal is draft
- Still editable post-acceptance (administrative metadata; audit-logged) but the project's snapshot was already taken

**Where it does NOT appear:**
- In the presentation window (client-facing) — never
- In any document sent to the client

**Lifecycle on acceptance:**
- At the moment Accepted is clicked, a snapshot copy is written to `project.presentation_notes`
- From that point on, the proposal's notes and the project's notes are independent
- Edits to the proposal's notes after acceptance don't propagate to the project (audit-logged on proposal)
- The project record can have its own ongoing notes in a separate `delivery_notes` field

## What Happens at Acceptance (Forward Reference)

When admin clicks Accepted on the disposition (see 06 and 07):
- Proposal status → `accepted`
- Pricing snapshot becomes fully immutable
- Line items become immutable
- Project record is created from the opportunity, with `presentation_notes` snapshot-copied from the proposal
- Change orders become available (post-acceptance only)
- Direct edits to scope/pricing on the proposal are blocked from this point

## Out of Scope (v1)

- Claude-driven calculator conversation (designed for, not built yet)
- Templated starting points ("start from Audit-Ready Hiring template") — could add later
- Multi-currency
- Tax handling beyond a flat tax_rate field on the proposal
- Multi-author / commenting on presentation notes

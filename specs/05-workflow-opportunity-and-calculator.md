# 05 — Workflow: Opportunity Creation, Calculator, Proposal

The heart of the sales operation. An opportunity is created under a client. The calculator builds a proposal. The proposal locks a pricing snapshot. From here, presentations are generated.

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
On save: system creates proposal record, snapshots pricing_components into pricing_snapshot,
writes proposal_line_items, calculates setup_total and monthly_total
        │
        ▼
Proposal status = "draft". 90-day staleness clock starts.
        │
        ▼
Admin can: edit (recalculates from same snapshot, doesn't refresh rates),
clone (creates new proposal with fresh snapshot), or proceed to presentation
```

## Calculator UI (Admin-Facing)

**Layout: Three panes.**

**Left pane — component palette.** Grouped categories:
- Tables (standard, complex)
- Roles & permissions
- Workflows & automations
- Integrations (per-system)
- AI / intelligence modules
- Dashboards & reports
- Setup & migration
- Custom (free-form line item with name + price)

Each component shows its current rate from `pricing_components` table.

**Middle pane — the proposal build.** Selected components show as line items:
- Component name
- Quantity (editable)
- Unit price (from snapshot — locked once proposal is saved)
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

**Action bar at bottom:**
- Save Draft
- Cancel
- Preview Presentation (only enabled after first save)

## Pricing Snapshot Logic

When proposal is first saved (going from no record to draft):
1. Read all `pricing_components` rows that are referenced in the line items
2. Copy the rate card state into `pricing_snapshot.snapshot_data` (JSON)
3. Each `proposal_line_item.unit_price_at_snapshot` is set from the snapshot
4. `proposal.created_at` timestamps the snapshot moment
5. `proposal.stale_after` = created_at + 90 days

From this point forward:
- All edits to this proposal use snapshot rates, not live rates
- All change orders against this proposal use snapshot rates
- Live `pricing_components` can change freely with no impact on this proposal

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
- Cannot have new line items added without acknowledging the stale state
- System prompts: "This proposal is over 90 days old. Clone with current pricing?"

Accepted proposals are never "stale" — they're locked into the engagement.

## Proposal Statuses

- `draft` — being built, not yet shown
- `sent` — presented to client (link shared / presentation given)
- `accepted` — client accepted via disposition action
- `superseded` — replaced by a clone
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

When rendered into a presentation (next workflow), the client sees:
- Outcome-grouped descriptions
- Package label (if applicable)
- Setup total
- Monthly total
- Plain-language "what's included"
- No per-component pricing breakdowns visible by default

The pricing page of the presentation has a configurable display setting:
- Summary only (default)
- Categorical breakdown (group line items by category, show subtotals)
- Full line items (rarely used, only for clients who specifically want detail)

## Out of Scope (v1)

- Claude-driven calculator conversation (designed for, not built yet)
- Templated starting points ("start from Audit-Ready Hiring template") — could add later
- Multi-currency
- Tax handling beyond a flat tax_rate field on the proposal

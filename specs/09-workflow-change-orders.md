# 09 — Workflow: Change Orders

Change orders are how scope and pricing evolve over the life of an opportunity. They are additive/subtractive deltas, not new proposals. They always use the pricing from the parent proposal's locked snapshot.

Same data model and structure used for pre-acceptance revisions AND post-acceptance scope changes.

## Actors
- Admin user (drafts and proposes change orders)
- Client (reviews and approves change orders in portal)
- System (calculates deltas, updates Stripe subscription on approval, generates documents)

## Core Concepts

**A change order belongs to a proposal.** All pricing within a change order uses that proposal's pricing snapshot — not the current live rate card.

**A change order has line items** that can be `add` (positive cost) or `remove` (negative cost / credit).

**Net impact** is calculated as sum of all line item deltas, separated into setup_delta and monthly_delta.

**Lifecycle states:**
- `draft` — admin is building it, not visible to client
- `proposed` — sent to client for approval (post-acceptance) OR ready for re-presentation (pre-acceptance)
- `approved` — client/admin approved it; applied to engagement
- `rejected` — client rejected
- `withdrawn` — admin pulled it before approval

## Pre-Acceptance Change Orders

Used when: prospect requests revisions during the sales process.

### Flow

```
Admin clicks Changes Requested on disposition
        │
        ▼
Notes captured (what they want changed)
        │
        ▼
System prompts: "Create change order for these revisions?"
Admin clicks Yes
        │
        ▼
Change order builder opens (similar to calculator, but scoped to the proposal's snapshot)
        │
        ▼
Admin adds line items (add or remove) using snapshot rates
        │
        ▼
Admin saves change order (status = draft)
        │
        ▼
Multiple change orders can stack — admin builds as many as needed
        │
        ▼
Admin marks change order(s) as 'proposed' (ready to show)
        │
        ▼
Presentation now reflects: base proposal + all proposed change orders
Investment page recalculates: setup total + sum of setup_deltas, monthly + sum of monthly_deltas
        │
        ▼
Admin re-presents to prospect (same URL, updated content)
        │
        ▼
At end: either Accepted, more Changes Requested, Follow-Up, or Declined
        │
        ▼
On Accepted: all 'proposed' change orders are marked 'approved' as part of the activation
              and are folded into the contract as part of the original scope.
              They appear in the signed contract as included, not as separate amendments.
```

**Key difference from post-acceptance:** pre-acceptance change orders don't need a separate client signature. The client signs the combined agreement during the standard walkthrough.

## Post-Acceptance Change Orders

Used when: an active client wants to add/remove scope after their engagement is live.

### Flow

```
Client request comes in (via portal change order form, email, or call)
        │
        ▼
Admin creates change order in admin (status = draft) against the relevant proposal
        │
        ▼
Admin builds line items using the proposal's locked snapshot rates
        │
        ▼
Admin reviews net impact (setup delta, monthly delta)
        │
        ▼
Admin marks change order as 'proposed' → triggers client notification
        │
        ▼
Client receives email: "Change order ready for review" + portal link
        │
        ▼
Client logs into portal, navigates to Documents → Pending Change Orders
        │
        ▼
Client reviews change order document:
  • What's being added/removed
  • Setup fee impact
  • Monthly subscription impact (and when it takes effect)
  • Inline signature point at bottom
        │
        ▼
Client signs and approves (or rejects)
        │
        ▼
On approval:
  • change_order.status = approved
  • approved_at, approved_by_portal_account_id stamped
  • document_signature record written (typed name, IP, timestamp)
  • If setup_delta > 0: Stripe one-time invoice created and charged (using client's payment method on file)
  • If setup_delta < 0: credit memo created (or applied to next monthly invoice — configurable)
  • If monthly_delta ≠ 0: Stripe subscription updated; takes effect next billing cycle (or immediately, configurable)
  • Admin notified
  • Client receives confirmation + receipt
        │
        ▼
On rejection:
  • change_order.status = rejected
  • Reason captured (optional)
  • Admin notified
  • No Stripe changes
```

## Change Order Document

When rendered for client review, the change order shows:
- Header: "Change Order #N for [Opportunity Name]"
- Reason / context (from admin's notes)
- Clear sections: "Adding" and "Removing"
- Each line item: description, quantity, line total impact
- Bottom summary:
  - Setup fee change: +$X / -$Y / no change
  - Monthly subscription change: +$X / -$Y / no change
  - Effective date for monthly changes
- Signature line: typed legal name
- Approve / Reject buttons

## Stripe Integration on Approval

### Setup Delta Handling

- **Positive setup_delta:** create a one-time Stripe invoice for the delta amount. Charge immediately to client's saved payment method. Record `stripe_invoice` with `kind = change_order_setup`.
- **Negative setup_delta:** create a credit. Options (configurable per client or default):
  - Apply as Stripe credit balance (next invoice automatically reduced)
  - Issue refund to original payment method
  - Default: Stripe credit balance
- **Zero setup_delta:** no Stripe action.

### Monthly Delta Handling

- **Any monthly change:** update the Stripe subscription's item price
- **Timing options (configurable):**
  - Effective next billing cycle (default, cleanest)
  - Effective immediately (prorate via Stripe's proration logic)
- Stripe's webhook confirms the update; system updates `stripe_subscription.current_amount_monthly`

### Failure Handling

- If Stripe charge fails (insufficient funds, expired card): change order status reverts to `proposed`, client notified, admin notified
- Client must update payment method and re-approve, OR admin re-issues the change order
- Change order is not considered final until Stripe successfully processes the financial side

## Visibility in Documents Tab

In the client portal, the Documents tab shows a timeline:

```
Master Agreement — signed [date]
Change Order #1 — approved [date] — +$X setup, +$Y/month — [view]
Change Order #2 — approved [date] — -$X monthly — [view]
[Pending] Change Order #3 — proposed [date] — Review and Approve [link]
```

Each signed change order has a downloadable PDF with the document and the signature audit trail.

## Multiple Pending Change Orders

A client can have multiple change orders in different states simultaneously. They are independent — approval/rejection of one doesn't affect others. Order of approval determines order of application to the subscription (each one updates the current state).

## Edits and Withdrawals

- **Draft change orders** can be freely edited by admin
- **Proposed change orders** can be edited only by withdrawing and re-proposing (audit-clean)
- **Approved change orders** are immutable. To undo, create a new change order with opposite line items.

## Out of Scope (v1)

- Change orders that span multiple proposals (always scoped to one)
- Bulk change order operations
- Templated change orders ("add scheduling module" as a saved bundle) — could add later
- Change order analytics / reporting

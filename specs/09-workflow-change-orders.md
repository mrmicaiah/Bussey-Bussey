# 09 — Workflow: Change Orders

Change orders are how scope and pricing evolve on an **accepted** opportunity. They are additive/subtractive deltas, not new proposals. They always use the pricing from the parent proposal's locked snapshot.

**Change orders only exist post-acceptance.** Before acceptance, the proposal is freely editable and revisions happen by editing the draft directly. Once the opportunity is Accepted, the proposal becomes a binding agreement and any further changes flow through this change order process.

## Actors
- Admin user (drafts and proposes change orders)
- Client (reviews and approves change orders in portal)
- System (calculates deltas, updates Stripe subscription on approval, generates documents)

## Core Concepts

**A change order belongs to a proposal.** All pricing within a change order uses that proposal's locked pricing snapshot — not the current live rate card.

**A change order has line items** that can be `add` (positive cost) or `remove` (negative cost / credit).

**Net impact** is calculated as sum of all line item deltas, separated into setup_delta and monthly_delta.

**Lifecycle states:**
- `draft` — admin is building it, not visible to client
- `proposed` — sent to client for approval
- `approved` — client approved it; applied to engagement
- `rejected` — client rejected
- `withdrawn` — admin pulled it before approval

**Always requires client signature.** Approval is captured via inline signature in the portal, similar to the original contract.

## Flow

```
Client request comes in (via portal change request form, email, or call)
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

## Use Cases for Change Orders

- **Scope additions:** client wants a new module (scheduling, integration, etc.)
- **Scope removals:** client wants to drop something originally included
- **Term corrections:** typo in legal name, wrong billing address on contract — use a zero-impact change order with the corrected text as a signed amendment. Setup_delta and monthly_delta both 0; the value is in the audit trail and signed document.
- **Pricing adjustments:** rare, but admin-initiated discount or rate adjustment formalized via change order

## Change Order Document

When rendered for client review, the change order shows:
- Header: "Change Order #N for [Opportunity Name]"
- Reason / context (from admin's notes)
- Clear sections: "Adding" and "Removing" (skipped if zero-impact correction)
- Each line item: description, quantity, line total impact
- Bottom summary:
  - Setup fee change: +$X / -$Y / no change
  - Monthly subscription change: +$X / -$Y / no change
  - Effective date for monthly changes
- For term corrections: the corrected language displayed clearly with before/after
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
- Change order is not considered final until Stripe successfully processes the financial side (for non-zero deltas)

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
- Client-side draft change orders (clients can request changes via the request form; only admin creates formal change orders)

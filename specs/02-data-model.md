# 02 — Data Model

Level 2 schema sketch. Field types and indexes filled in at implementation time. This document defines entities, their key fields, and their relationships.

## Entity Map

```
chat_session ──┐
               ├──> lead ──> client ──┬──> opportunity ──> proposal ──> pricing_snapshot
chat_message ──┘                       │                       │
                                       │                       └──> change_order (0..n)
                                       │
                                       └──> portal_account ──> portal_session
                                                  │
                                                  └──> document_signature
                                                  └──> stripe_customer
                                                           │
                                                           └──> stripe_subscription
                                                           └──> stripe_invoice

calling_list_item ──> calling_log
pricing_components (live rate card, separate from snapshots)
audit_log (cross-entity)
notification (cross-entity)
```

## Entities

### chat_session
- Anonymous session for a website visitor talking to the chat
- Key fields: session_token, started_at, last_active_at, source_page, visitor_fingerprint, status (active, abandoned, captured_as_lead)
- Linked to: chat_message (1..n), lead (0..1)

### chat_message
- Single message in a chat session
- Key fields: session_id, role (user/assistant), content, created_at, tool_calls (JSON of any function calls Claude made)

### lead
- Captured prospect, not yet a client
- Key fields: name, email, phone, company, industry, source (chat / manual / referral / event), origin_chat_session_id (nullable), pain_summary, status (new / reviewed / contacted / qualified / disqualified / converted), notes, created_at, last_contacted_at, owner_user_id
- Status transitions: new → reviewed → contacted → qualified → (converted to client) OR (disqualified)

### client
- A business entity Bussey works with
- Key fields: company_name, primary_contact_name, primary_contact_email, primary_contact_phone, industry, billing_address, status (prospect / active / paused / former), origin_lead_id (nullable), created_at, notes
- Linked to: opportunity (1..n), portal_account (0..1 — only created on activation)

### opportunity
- A specific deal for a client
- Key fields: client_id, name (e.g., "Audit-Ready Hiring System"), status (open / proposed / accepted / lost / paused), value_setup, value_monthly, created_at, accepted_at, lost_reason, owner_user_id
- Linked to: proposal (1..n — usually 1 base, but clones supported), change_order (0..n)

### pricing_components (live rate card)
- The current rate card. Editable by admin at any time.
- Key fields: code (e.g., "standard_table"), name, description, category (table / role / workflow / integration / ai / dashboard / setup), unit_price, unit_type (per item / per hour / flat), active (bool)
- Edited freely. New proposals pull from here at creation time.

### proposal
- A priced scope document tied to an opportunity
- Key fields: opportunity_id, name, status (draft / sent / accepted / superseded / declined), setup_total, monthly_total, created_at, sent_at, accepted_at, stale_after (created_at + 90 days), cloned_from_proposal_id (nullable), notes
- A proposal locks its pricing snapshot at creation. After creation, the snapshot does not change.
- Linked to: pricing_snapshot (1, exclusive), proposal_line_item (1..n), change_order (0..n)

### pricing_snapshot
- Frozen copy of rates and modifiers used for a specific proposal
- Key fields: proposal_id, snapshot_data (JSON: all components + rates + modifiers as they existed at snapshot time), snapshot_at
- Created once, never modified.

### proposal_line_item
- A single scope item on a proposal
- Key fields: proposal_id, component_code (references pricing_components.code), quantity, unit_price_at_snapshot, line_total, description_override (nullable)

### change_order
- An additive/subtractive amendment to a proposal
- Key fields: proposal_id, name, status (draft / proposed / approved / rejected / withdrawn), reason, setup_delta, monthly_delta, created_at, proposed_at, approved_at, approved_by_portal_account_id (nullable for pre-acceptance)
- Pre-acceptance change orders: created and approved by admin before opportunity acceptance
- Post-acceptance change orders: created by admin, approved by client in portal
- Linked to: change_order_line_item (1..n, each can be add or remove)
- Uses pricing from parent proposal's snapshot (no fresh pricing unless proposal is cloned)

### change_order_line_item
- A single change within a change order
- Key fields: change_order_id, action (add / remove), component_code, quantity, unit_price_from_snapshot, line_total_delta, description_override (nullable)

### portal_account
- A client's login
- Key fields: client_id, email, password_hash, temp_password_set (bool), must_change_password (bool), walkthrough_completed (bool), walkthrough_state (new / password_set / contract_signed / payment_set / complete), created_at, last_login_at
- Created automatically when an opportunity is Accepted

### portal_session
- An active login session
- Key fields: portal_account_id, session_token, created_at, expires_at, ip_address, user_agent

### document_signature
- Captured signature event
- Key fields: portal_account_id, document_type (contract / change_order / other), document_id (polymorphic ref), signature_type (signature / initial), typed_name, typed_initials, ip_address, user_agent, signed_at, opportunity_id (for fast lookup)
- One document can have many signature records (multiple sign-here and initial-here fields)

### stripe_customer
- Mapping from client to Stripe
- Key fields: client_id, stripe_customer_id, created_at

### stripe_subscription
- Active monthly subscription
- Key fields: client_id, opportunity_id, stripe_subscription_id, status (active / past_due / canceled), current_amount_monthly, created_at, current_period_end
- Updated when change orders affect monthly amount

### stripe_invoice
- Setup fees and change order one-time charges
- Key fields: client_id, opportunity_id, stripe_invoice_id, kind (setup / change_order_setup / other), amount, status, created_at, paid_at

### calling_list_item
- A row from an uploaded CSV, scheduled for a call date
- Key fields: company_name, contact_name, contact_email, contact_phone, industry, source, call_date, status (pending / called / no_answer / followup / disqualified / converted_to_lead), notes, imported_at

### calling_log
- A logged call attempt for a calling_list_item
- Key fields: calling_list_item_id, called_at, outcome (no_answer / left_message / spoke / disqualified / interested), notes, next_action_date

### audit_log
- System-wide event log
- Key fields: actor_type (admin_user / portal_account / system), actor_id, action, entity_type, entity_id, changes (JSON diff), ip_address, created_at
- Used for: contract signatures, change order approvals, status transitions, anything that needs defensible history

### notification
- Outbound notification record (email/SMS to internal team or clients)
- Key fields: kind (new_lead / change_order_requested / payment_failed / etc.), recipient, channel (email / sms / in_app), payload (JSON), sent_at, status

### admin_user
- Internal team member
- Key fields: name, email, password_hash, role (owner / admin / sales / delivery), created_at, active

## Critical Relationships

1. **Lead → Client conversion** copies relevant fields and sets `client.origin_lead_id`. Lead status becomes `converted`. Lead is not deleted.
2. **Client → Opportunity** is one-to-many. A client can have multiple opportunities over time.
3. **Opportunity → Proposal** is one-to-many, but typically one active base + clones for major refreshes. Status `superseded` marks an old proposal replaced by a clone.
4. **Proposal → Pricing Snapshot** is one-to-one and immutable.
5. **Proposal → Change Order** is one-to-many. Change orders are scoped to a proposal.
6. **Client → Portal Account** is created only on Accepted disposition.
7. **Portal Account → Walkthrough State** drives the first-login experience.
8. **Stripe Subscription** belongs to the opportunity. Change orders modify it.

## Pricing Lifecycle Summary

```
pricing_components (live, editable) ──► [proposal created] ──► pricing_snapshot (frozen)
                                                                       │
                                                                       ▼
                                                       All change_orders for this proposal
                                                       use this snapshot's rates.
                                                       
                                                       To get fresh pricing: clone proposal.
```

## 90-Day Staleness

- `proposal.stale_after` = `created_at` + 90 days
- After stale_after: UI flags proposal as stale, requires clone before new change orders
- Accepted proposals are not subject to staleness (they're locked into the engagement)

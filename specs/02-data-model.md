# 02 — Data Model

Level 2 schema sketch. Field types and indexes filled in at implementation time. This document defines entities, their key fields, and their relationships.

## Entity Map

```
chat_session ──┐
               ├──> lead ──> client ──┬──> opportunity ──> proposal ──> pricing_snapshot
chat_message ──┘                       │                       │
                                       │                       ├──> proposal_line_item (1..n)
                                       │                       └──> change_order (0..n, post-acceptance only)
                                       │                                   │
                                       │                                   └──> change_order_line_item (1..n)
                                       │
                                       │         (on acceptance)
                                       ├──> project (1..1 per accepted opportunity)
                                       ├──> contract (1..1 per accepted opportunity)
                                       │
                                       └──> portal_account ──> portal_session
                                                  │
                                                  └──> document_signature
                                                  └──> stripe_customer
                                                           │
                                                           ├──> stripe_subscription (1 per opportunity)
                                                           └──> stripe_invoice

admin_user ──> admin_session

calling_list_item ──> calling_log
pricing_components (live rate card, separate from snapshots)
audit_log (cross-entity, polymorphic)
notification (cross-entity)
```

## Entities

### chat_session
- Anonymous session for a website visitor talking to the chat
- Key fields: session_token, started_at, last_active_at, source_page, visitor_fingerprint, status (active / abandoned / captured_as_lead)
- Linked to: chat_message (1..n), lead (0..1)

### chat_message
- Single message in a chat session
- Key fields: session_id, role (user / assistant), content, created_at, tool_calls (JSON of any function calls Claude made)

### lead
- Captured prospect, not yet a client
- Key fields: name, email, phone, company, industry, source (chat / manual / referral / event), origin_chat_session_id (nullable), pain_summary, urgency (immediate / weeks / months / exploring, nullable), status (new / reviewed / contacted / qualified / disqualified / converted), notes, notification_sent_at (nullable — set when the first qualifying notification is fired so we never re-notify), created_at, last_contacted_at, owner_user_id
- Status transitions: new → reviewed → contacted → qualified → (converted to client) OR (disqualified)
- `save_lead` merge rule: subsequent calls merge into the existing lead and never overwrite non-null fields. Admin corrects manually in the inbox if extraction is wrong.

### client
- A business entity Bussey works with
- Key fields: company_name, primary_contact_name, primary_contact_email, primary_contact_phone, industry, billing_address, status (prospect / active / paused / former), origin_lead_id (nullable), created_at, notes
- Linked to: opportunity (1..n), portal_account (0..1 — created on first opportunity acceptance)
- **No `activating` status.** Client moves to `active` on opportunity acceptance. Walkthrough progress lives on `portal_account.walkthrough_state`, not on `client.status`.

### opportunity
- A specific deal for a client
- Key fields: client_id, name (e.g., "Audit-Ready Hiring System"), description, status (open / proposed / accepted / lost / paused), value_setup, value_monthly, next_followup_date (nullable datetime — set when admin captures Follow-Up disposition), presentation_token (unguessable cryptographically-random token, ~24 chars, unique — the path component used at `/p/:presentation_token/`), created_at, accepted_at (nullable), lost_reason (nullable), owner_user_id
- The `presentation_token` is generated at opportunity creation and is the only protection on the public presentation URL. Treat it as a secret — admins share the link only with intended viewers.
- Linked to: proposal (1..n — usually one base, additional from clones), change_order (0..n, post-acceptance only), project (0..1, created on acceptance), contract (0..1, created on acceptance)
- **Status `proposed` transition:** when the opportunity's current proposal moves from `draft` to `sent` for the first time, the opportunity simultaneously moves from `open` to `proposed`. After that, the opportunity stays `proposed` until disposition resolves it (accepted / lost / paused). Reverting a proposal from `sent` to `draft` does not move the opportunity back to `open`.

### pricing_components (live rate card)
- The current rate card. Editable by admin at any time.
- Key fields: code (e.g., `standard_table`), name, description, category (table / role / workflow / integration / ai / dashboard / setup / subscription / custom), unit_type (flat_setup / per_item_setup / flat_monthly / per_item_monthly / setup_and_monthly), unit_price, active (bool)
- Edited freely. New proposals snapshot these rates at creation time.
- Canonical seed list lives in `/data/pricing-components.csv`.

### proposal
- A priced scope document tied to an opportunity
- Key fields:
  - opportunity_id, name
  - status (draft / sent / accepted / superseded / declined)
  - setup_total, monthly_total
  - **Presentation content fields:**
    - narrative_challenge (text — intro section content shown on the Challenge page of the presentation)
    - narrative_solution (text — solution section content shown on the Solution page)
    - key_capabilities (JSON array of strings — bulleted outcomes shown on the Solution page)
    - pricing_display_mode (enum: summary / categorical / full — controls how the Investment page renders line items)
    - demo_enabled (bool — whether the Demo page is included in the presentation)
  - **Modifiers (mutable during draft & sent, immutable on acceptance):**
    - modifiers (JSON blob containing complexity_multiplier, urgency_multiplier, custom_discount_percent, and any future multipliers — kept as JSON so new multiplier types can be added without migrations)
  - created_at, sent_at (nullable), accepted_at (nullable)
  - stale_after (computed: created_at + 90 days)
  - cloned_from_proposal_id (nullable — set when this proposal was created by cloning another)
  - notes (admin internal — distinct from presentation_notes)
  - presentation_notes (text — see below)
- **Presentation notes:** free-text field captured during the sales conversation. Editable in admin during draft and edit phases. Copied as a snapshot to the project record at activation. After that copy, the proposal's notes are frozen as a historical sales record. Never visible to client.
- **Cloning rules:**
  - Cloning a `draft` or `sent` proposal: new proposal lives under the **same** opportunity; original is marked `superseded`.
  - Cloning an `accepted` proposal: clone creates a **new opportunity under the same client**. The accepted proposal stays accepted and locked into its existing engagement. `cloned_from_proposal_id` preserves traceability across opportunities.
- Linked to: pricing_snapshot (1, exclusive, immutable), proposal_line_item (1..n), change_order (0..n, only after acceptance)

### pricing_snapshot
- Frozen copy of the rate card used for a specific proposal
- Key fields: proposal_id, snapshot_data (JSON: full component rate freeze at the moment of proposal creation), snapshot_at (set once = proposal.created_at)
- **Immutable from creation.** snapshot_data is never updated; snapshot_at is never updated. There is no `is_locked` flag — the snapshot is always locked from the moment it's written.
- Line items and modifiers (mutable during draft, immutable after acceptance) live on `proposal` and `proposal_line_item`, not in the snapshot.
- All `proposal_line_item.unit_price_at_snapshot` values are sourced from this snapshot. All change orders for the parent proposal use this snapshot's rates.

### proposal_line_item
- A single scope item on a proposal
- Key fields: proposal_id, component_code (references pricing_components.code, or `custom_line_item` for free-form), quantity, unit_price_at_snapshot (rate from the proposal's pricing_snapshot), line_total, description_override (nullable)
- Editable while proposal is in draft or sent. Immutable once the parent opportunity is accepted.

### change_order (post-acceptance only)
- An additive/subtractive amendment to an accepted proposal
- Key fields: proposal_id, name, status (draft / proposed / approved / rejected / withdrawn), reason, setup_delta, monthly_delta, created_at, proposed_at (nullable), approved_at (nullable), approved_by_portal_account_id (nullable)
- Change orders only exist after the parent opportunity is accepted
- All pricing within a change order uses the parent proposal's pricing_snapshot
- Linked to: change_order_line_item (1..n, each can be add or remove)
- Terms-only amendments are modeled as a change order with zero line items and zero deltas; the document body carries the amended terms text.

### change_order_line_item
- A single change within a change order
- Key fields: change_order_id, action (add / remove), component_code, quantity, unit_price_from_snapshot, line_total_delta, description_override (nullable)

### project
- Created automatically when an opportunity is accepted
- Represents the post-activation delivery container
- Key fields: opportunity_id, name (copied from opportunity), status (kickoff / active / paused / complete / canceled), presentation_notes (text — see mutability rule below), build_status_note (admin-controlled, visible in portal), current_phase (admin-controlled — e.g., Discovery / Build / Testing / Handoff / Live / Ongoing Support), next_milestone (admin-controlled), created_at, kicked_off_at (nullable), completed_at (nullable)
- **Presentation notes mutability:**
  - At project creation, `project.presentation_notes` is initialized as a **snapshot copy** of `proposal.presentation_notes`.
  - After that initial copy, the two fields diverge:
    - `proposal.presentation_notes` is **frozen** — historical record of what sales captured during the conversation.
    - `project.presentation_notes` is a **living document** — freely editable by admin and delivery throughout the project's life, used to accumulate delivery context (requirements implied during sales, evolving constraints, relationship notes).
  - Editing one does not affect the other.
  - Neither is ever visible to the client.
- Linked to: opportunity (1, exclusive)

### contract
- The master agreement document for an accepted opportunity
- Key fields:
  - opportunity_id (1:1 with opportunity)
  - template_version (string — which version of `/templates/contract/master.md` was used; lets us trace which contract template a client signed)
  - body_source (JSON: { template_path, variables }) — the raw inputs to the render, so a contract can be re-rendered or audited later
  - body_html (text — the rendered HTML with `{{sign_here:label}}` / `{{initial_here:label}}` tokens replaced by interactive signature components in the portal)
  - generated_at
  - signed_at (nullable — set when the client completes the contract step in the walkthrough)
  - signed_by_portal_account_id (nullable)
  - pdf_r2_key (nullable — R2 object key for the rendered signed PDF, generated via Cloudflare Browser Rendering after signature is captured)
- **No direct FK to client or portal_account.** The signer is reached implicitly through the opportunity:
  - `contract.opportunity_id → opportunity.client_id → client.portal_account` resolves "who is the signer for this contract".
  - `signed_by_portal_account_id` captures *who actually signed* once the signature happens, which should match (and should be validated to match) the portal_account belonging to the contract's client.
- Linked to: opportunity (1, exclusive), document_signature (1..n, all signature/initial events for this contract)
- `document_signature.document_id` polymorphic ref points at this entity for contract signatures (`document_type = contract`).

### portal_account
- A client's login
- Key fields: client_id, email, password_hash (bcrypt, 12 rounds), must_change_password (bool), walkthrough_completed (bool), walkthrough_state (new / password_set / contract_signed / payment_set / complete), created_at, last_login_at (nullable)
- Created automatically when an opportunity is accepted

### portal_session
- An active client portal login session (persisted record; fast-lookup token mirror lives in KV)
- Key fields: portal_account_id, session_token (signed), created_at, last_active_at, expires_at (absolute = created_at + 90 days), idle_expires_at (rolling = last_active_at + 30 days), ip_address, user_agent, revoked_at (nullable)
- Separate from `admin_session` — different TTLs, different security posture, different lifecycle. Do not merge.

### admin_session
- An active admin app login session (persisted record; fast-lookup token mirror lives in KV)
- Key fields: admin_user_id, session_token (signed), created_at, last_active_at, expires_at (absolute = created_at + 24 hours), idle_expires_at (rolling = last_active_at + 12 hours), ip_address, user_agent, revoked_at (nullable)
- Separate from `portal_session` by design.

### document_signature
- Captured signature event (one per "sign here" or "initial here" field)
- Key fields: portal_account_id, document_type (contract / change_order / amendment / other), document_id (polymorphic ref — see note), signature_type (signature / initial / agreement_acceptance), typed_name (nullable — for signature / agreement_acceptance), typed_initials (nullable — for initial), ip_address, user_agent, signed_at, opportunity_id (denormalized for fast lookup)
- **Polymorphism note:** `document_id` is a polymorphic reference — `document_type` tells you which table to read from (`contract`, `change_order`, etc.). There is **no DB-level FK constraint** on `document_id` because it can target multiple tables. Referential integrity is enforced in application code at write time.
- One document can have many signature records (multiple sign-here and initial-here fields, plus the final agreement_acceptance record).

### stripe_customer
- Mapping from client to Stripe
- Key fields: client_id, stripe_customer_id, created_at

### stripe_subscription
- Active monthly subscription
- Key fields: client_id, **opportunity_id** (operational key — the subscription belongs to a specific deal, not the client at large), stripe_subscription_id, status (active / past_due / canceled), current_amount_monthly, created_at, current_period_end
- A client with N accepted opportunities has N stripe_subscriptions. `client_id` is denormalized for filtering/listing; `opportunity_id` is the join key for all subscription operations and change-order math.
- Updated when change orders affect monthly amount.

### stripe_invoice
- Setup fees and change order one-time charges
- Key fields: client_id, **opportunity_id** (operational key — invoices are scoped to a specific deal), stripe_invoice_id, kind (setup / change_order_setup / other), amount, status, created_at, paid_at (nullable)
- Same rationale as stripe_subscription: `opportunity_id` is the operational key; `client_id` is denormalized.

### calling_list_item
- A row from an uploaded CSV, scheduled for a call date
- Key fields: company_name, contact_name, contact_email, contact_phone, industry, source, call_date, status (pending / called / completed / no_answer / followup / disqualified / converted_to_lead), notes, extra_data (JSON — holds any CSV columns beyond the known set, preserved verbatim from import), imported_at, converted_lead_id (nullable — set when item is converted to a lead)

### calling_log
- A logged call attempt for a calling_list_item
- Key fields: calling_list_item_id, called_at, outcome (no_answer / left_voicemail / spoke_not_interested / spoke_followup_needed / disqualified / spoke_qualified), notes, next_action_date (nullable)

### audit_log
- System-wide event log
- Key fields: actor_type (admin_user / portal_account / system), actor_id, action, entity_type, entity_id, changes (JSON diff), ip_address, user_agent, created_at
- **Polymorphism note:** `entity_id` is a polymorphic reference — `entity_type` tells you which table to read from. Same pattern as `document_signature.document_id`. There is **no DB-level FK constraint** on `entity_id`. Application code is responsible for writing valid (entity_type, entity_id) pairs.
- Used for: contract signatures, change order approvals, status transitions, admin edits to post-acceptance fields, login events, pricing component edits, anything that needs defensible history.
- Never logs passwords or other secrets.

### notification
- Outbound notification record (email/SMS to internal team or clients)
- Key fields: kind (new_lead / walkthrough_complete / change_order_proposed / change_order_approved / payment_succeeded / payment_failed / activation_credentials / project_status_update / other), recipient, channel (email / sms / in_app), payload (JSON), sent_at (nullable), status (queued / sent / failed), error (nullable)

### admin_user
- Internal team member
- Key fields: name, email, password_hash (bcrypt, 12 rounds), role (owner / admin / sales / delivery), created_at, active (bool), last_login_at (nullable)

## Critical Relationships

1. **Lead → Client conversion** copies relevant fields and sets `client.origin_lead_id`. Lead status becomes `converted`. Lead is not deleted.
2. **Client → Opportunity** is one-to-many. A client can have multiple opportunities over time.
3. **Opportunity → Proposal** is one-to-many. Status `superseded` marks an old proposal replaced by a clone of a draft or sent proposal within the same opportunity. Clones of accepted proposals create new opportunities (see proposal cloning rules) and do not supersede the original.
4. **Proposal → Pricing Snapshot** is one-to-one, immutable from creation. The snapshot is the frozen rate card; mutable scope lives on proposal/proposal_line_item.
5. **Proposal status → Opportunity status:** when proposal.status flips from `draft` to `sent` for the first time, opportunity.status flips from `open` to `proposed` in the same transaction. Subsequent `sent ↔ draft` toggles do not move the opportunity.
6. **Proposal → Change Order** is one-to-many. Change orders exist only post-acceptance.
7. **Opportunity → Project** is one-to-one, created at acceptance. Project carries forward presentation_notes as a snapshot, then diverges into a living delivery document.
8. **Opportunity → Contract** is one-to-one, created at acceptance. Signed during the portal walkthrough. Signer is resolved via opportunity → client → portal_account (no direct FK on contract).
9. **Client → Portal Account** is created on first opportunity acceptance.
10. **Portal Account → Walkthrough State** drives the first-login experience. `client.status` does not encode walkthrough progress.
11. **Stripe entities → Opportunity:** both `stripe_subscription` and `stripe_invoice` are scoped to an `opportunity_id`. A client with N accepted opportunities has N subscriptions and a separate stream of invoices per opportunity. `client_id` on these tables is denormalized for filtering/listing only; all operational joins go through `opportunity_id`.
12. **Sessions are split:** `admin_session` and `portal_session` are independent tables with independent TTLs and lifecycles. They do not share schema or storage.
13. **Polymorphic references** (`audit_log.entity_id`, `document_signature.document_id`) have no DB-level FK constraints. Integrity is enforced in application code at write time.

## Editability Rules (Three-Tier Post-Acceptance)

After opportunity acceptance:

| Field Group | Editable? | How |
|---|---|---|
| Scope & pricing (proposal line items, totals, modifiers, snapshot) | Sacred | Change order only |
| Contract terms (terms text, governing law, payment schedule) | Sacred but amendable | Signed amendment (change order with zero line items and zero deltas) |
| Administrative data (contact info, billing address, project status, internal notes, **project.presentation_notes**) | Freely editable | Admin edit; each edit writes audit_log entry |

Before opportunity acceptance:
- Everything on the proposal is freely editable in admin (line items, modifiers, narrative content, presentation toggles, presentation notes)
- Snapshot rates stay locked to proposal-creation rates (clone for fresh rates)
- Edits are not formal change orders — just admin edits
- Standard internal activity logging only (not the full audit-trail required for accepted opportunities)

## Pricing Lifecycle Summary

```
pricing_components (live, editable) ──► [proposal created] ──► pricing_snapshot (immutable from creation)
                                                                       │
                                              proposal/proposal_line_item/modifiers
                                              are mutable during draft & sent;
                                              line items read rates from the snapshot
                                                                       │
                                                                       ▼
                                              [opportunity accepted] ► proposal & line items & modifiers
                                                                       become immutable
                                                                       │
                                                                       ▼
                                              All change_orders for this proposal
                                              use this snapshot's rates.

                                              To get fresh pricing:
                                                - clone draft/sent ► same opportunity, new draft, original superseded
                                                - clone accepted ► new opportunity under same client
```

## 90-Day Staleness

- `proposal.stale_after` = `created_at` + 90 days (computed; not stored as a separate writable field)
- After stale_after: UI flags proposal as stale, requires clone or explicit acknowledgment before further sending
- Accepted proposals are not subject to staleness (they're locked into the engagement)

## Auth & Session Parameters (referenced by spec 12)

For convenient reference alongside the entities above:

- Password hashing: bcrypt, 12 rounds (admin_user.password_hash, portal_account.password_hash)
- Admin session (`admin_session`): 12-hour idle TTL, 24-hour absolute TTL
- Portal session (`portal_session`): 30-day idle TTL, 90-day absolute TTL
- Login rate limit: 5 attempts per 15 minutes per IP, exponential backoff
- No TOTP in v1; schema leaves room to add a `totp_secret` column to admin_user later without migration disruption.

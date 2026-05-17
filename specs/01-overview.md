# 01 — System Overview

## What This Is

Bussey and Bussey is a B2B operations and AI services firm. The platform described in these specs is its internal operating system plus its public web presence. The platform serves three audiences:

1. **Public visitors** — see the website, talk to the chat, become leads
2. **Internal team** — run sales, build proposals, manage clients, deliver projects
3. **Active clients** — log into a portal, sign documents, manage payment, request change orders

## Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────┐
│                     busseyandbussey.com                       │
│                  (Eleventy → Cloudflare Pages)                │
│   Home | Services | Industries | Case Studies | Articles |   │
│             Blog | About | Contact | Chat Widget             │
└───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (API + Routing)                │
│  • Public chat endpoint (Claude-powered)                      │
│  • Admin API (auth required)                                  │
│  • Portal API (auth required)                                 │
│  • Presentation data endpoint (public, token-protected)       │
│  • Stripe webhooks                                            │
│  • Email/notification dispatch                                │
└──────┬────────────────────────────┬──────────────────────────┘
       │                            │
       ▼                            ▼
┌──────────────────┐         ┌──────────────────┐
│  D1 (SQL)        │         │  R2 (Files)      │
│  All entities    │         │  Generated PDFs  │
│                  │         │  Uploaded docs   │
└──────────────────┘         └──────────────────┘
       │
       ▼
┌──────────────────┐
│  KV (Sessions)   │
│  Chat sessions   │
│  Portal tokens   │
└──────────────────┘
```

## Three Frontends, One Backend

### 1. Public Site (`busseyandbussey.com`)
Eleventy static site. Content-driven. Anonymous. Includes the embedded Claude chat widget.

### 2. Admin App (`busseyandbussey.com/admin` or `admin.busseyandbussey.com`)
Authenticated internal app for the Bussey team. CRUD for everything: leads, clients, opportunities, proposals, change orders, calling list, etc. Where the calculator lives. Where dispositions are captured.

### 3. Client Portal (`busseyandbussey.com/portal` or `portal.busseyandbussey.com`)
Authenticated app for active clients. First-login walkthrough, signed documents, payment management, change order requests, build status.

All three are served from the same Cloudflare infrastructure and talk to the same Worker API.

## Claude Integration (v1 Scope)

Only one piece in v1: the **public website chat**. It does:
- Conversational lead capture
- Structured info extraction (name, company, industry, pain, urgency)
- Tool-call writes to the leads table
- Triggers email notification on lead capture

Everything else is designed for future Claude integration but operates manually in v1.

## Key Design Principles

### Editability

**Acceptance is what locks.** Until an opportunity is marked Accepted, its proposal is freely editable — line items, narrative, pricing scope, anything. There is no formal "change order" before acceptance; revisions are just edits.

Once Accepted is clicked, three tiers govern what can change and how:

- **Scope and pricing (sacred):** immutable except via signed change order
- **Contract terms (sacred but amendable):** changes require a signed amendment (functionally a change order with terms-only impact)
- **Administrative data (freely editable):** contact info, billing address, project status, internal notes — admin edits anytime, with audit_log entries

### Pricing & Snapshots

**Proposals own their pricing.** When a proposal is created, a pricing snapshot is taken from the live `pricing_components` rate card. While the proposal is in draft, edits use that same snapshot — rates do not refresh from live rates as you edit. The snapshot only becomes truly immutable on acceptance.

**To get fresh pricing, clone.** Cloning a proposal creates a new proposal with a fresh snapshot from current rates. The old proposal remains untouched.

**90-day staleness applies to drafts.** After 90 days, drafts are flagged stale and prompt for cloning. Accepted proposals are locked into the engagement and don't go stale.

### Presentation & Sales Flow

**Template-driven presentations.** Cover, demo, proposal, pricing, disposition — all templated. Content swaps per opportunity.

**Demos are manual.** Built by hand in the repo under a per-opportunity folder convention. Embedded into the presentation.

**Two-window presentation mode.** Admin has two browser windows during a sales call: one with the presentation (shared on Zoom), one with the admin/editor (private). Edits in admin push to the presentation window via live sync (polling).

**Presentation notes captured during sales.** Each proposal has a presentation notes field. Notes are written during the sales conversation and copied to the project when activation completes. Internal-only — never visible to client.

### Acceptance & Documents

**Click-to-accept is sufficient.** No DocuSign. Inline signature capture inside the portal with typed name, timestamp, IP, full audit trail.

**Stripe is the payment processor.** Setup fee (one-time) + monthly subscription. PayPal not in v1.

### Change Orders (Post-Acceptance Only)

**Change orders are additive/subtractive deltas applied to an accepted proposal.** They use the parent proposal's locked pricing snapshot. They require client signature in the portal.

There are no pre-acceptance change orders. Pre-acceptance revisions are just edits to the draft proposal.

## Glossary

| Term | Meaning |
|---|---|
| **Lead** | Top-of-funnel record. Possibly incomplete. From chat or manual entry. |
| **Client** | A confirmed business entity. Created by converting a lead or manually. |
| **Opportunity** | A specific deal under a client. Has one base proposal + 0..n change orders post-acceptance. |
| **Proposal** | A priced scope document. Locks a pricing snapshot at creation; the snapshot becomes immutable on opportunity acceptance. |
| **Pricing Snapshot** | Frozen copy of rate card + components used for a specific proposal. Mutable during draft, locked on acceptance. |
| **Presentation** | Template-driven multi-page experience: cover, demo, proposal, pricing. Token-protected URL. |
| **Presentation Notes** | Free-text notes captured on a proposal during the sales conversation. Copied to the project at activation. |
| **Demo** | Manually built static front-end mockup, embedded into a presentation. |
| **Disposition** | The outcome captured for an opportunity after presenting (Accepted / Follow-Up / Changes Requested / Declined). Captured in admin, not in the presentation. |
| **Activation** | The flow triggered by Accepted disposition: project creation → account creation → credentials → walkthrough. |
| **Project** | The post-acceptance delivery container. Created when an opportunity is accepted. Carries forward presentation notes and links back to the proposal. |
| **Portal Walkthrough** | First-login sequence: password change → contract sign → payment setup → done. |
| **Change Order** | Additive/subtractive amendment to an accepted opportunity. Uses the proposal's locked snapshot. Signed by client in portal. |
| **Active Client** | A client who has completed activation. Has portal access, ongoing billing, change-order capability. |

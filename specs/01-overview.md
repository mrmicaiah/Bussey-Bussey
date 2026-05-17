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
│  • Presentation data endpoint (token-protected, read-only)    │
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
Eleventy static site. Content-driven. Anonymous. Includes the embedded Claude chat widget. Also serves presentation views at `/p/[token]/`.

### 2. Admin App (`busseyandbussey.com/admin` or `admin.busseyandbussey.com`)
Authenticated internal app for the Bussey team. CRUD for everything: leads, clients, opportunities, proposals, change orders, calling list, etc. Where the calculator lives. Where dispositions are captured. The control plane.

### 3. Client Portal (`busseyandbussey.com/portal` or `portal.busseyandbussey.com`)
Authenticated app for active clients. First-login walkthrough, signed documents, payment management, change order requests, project status.

All three are served from the same Cloudflare infrastructure and talk to the same Worker API.

## Claude Integration (v1 Scope)

Only one piece in v1: the **public website chat**. It does:
- Conversational lead capture
- Structured info extraction (name, company, industry, pain, urgency)
- Tool-call writes to the leads table
- Triggers email notification on lead capture

Everything else is designed for future Claude integration but operates manually in v1.

## Key Design Principles

**Acceptance is what locks everything.** Before Accepted is clicked, the proposal is freely editable — it's a draft, not an agreement. Once Accepted is clicked, the proposal becomes the binding agreement: scope and pricing are sacred, contract terms are sacred, and from this point forward changes happen only through signed change orders.

**Three-tier editability post-acceptance:**
- **Scope and pricing** — immutable, change-order-only
- **Contract terms** — immutable, amendable via signed change order (zero-impact change orders allowed for corrections)
- **Administrative fields** (contact info, billing address, internal notes, project status) — always editable, audit-logged, no client signature needed

**Pricing snapshot rates stay at proposal-creation rates** through edits while in draft. To get fresh rates, clone the proposal.

**Proposals go stale after 90 days.** System flags them and prompts cloning before further work.

**Template-driven presentations.** Cover, demo, proposal, pricing — all templated. Content swaps per opportunity.

**Demos are manual.** Built by hand in the repo under a per-opportunity folder convention. Embedded into the presentation.

**Click-to-accept is sufficient.** No DocuSign. Inline signature capture inside the portal with typed name, timestamp, IP, full audit trail.

**Stripe is the payment processor.** Setup fee (one-time) + monthly subscription. PayPal not in v1.

**Change orders are additive/subtractive deltas, post-acceptance only.** They modify the active engagement and stack on top of the base proposal.

**Two-window presentation mode.** The presentation window is read-only, public-tokened, and shared on Zoom. The admin window has all controls and editing. Live polling sync pushes edits from admin to presentation within seconds.

## Glossary

| Term | Meaning |
|---|---|
| **Lead** | Top-of-funnel record. Possibly incomplete. From chat or manual entry. |
| **Client** | A confirmed business entity. Created by converting a lead or manually. |
| **Opportunity** | A specific deal under a client. Has one base proposal + 0..n change orders (post-acceptance only). |
| **Proposal** | A priced scope document. Freely editable while in draft. Locks at acceptance. |
| **Presentation Notes** | Free-text notes captured during the sales conversation, attached to the proposal. Copied to the project on acceptance. |
| **Pricing Snapshot** | Frozen copy of rate card + components used for a specific proposal. Rates set at proposal creation, stay through edits. Refresh by cloning. |
| **Presentation** | Template-driven multi-page experience: cover, demo, proposal, pricing. Read-only client-facing view. |
| **Demo** | Manually built static front-end mockup, embedded into a presentation. |
| **Disposition** | The outcome captured by admin at the end of a presentation (Accepted / Follow-Up / Changes Requested / Declined). Captured in admin, not in the presentation window. |
| **Activation** | The flow triggered by Accepted disposition: account creation → credentials → walkthrough → project. |
| **Project** | The post-activation engagement. Inherits notes from the proposal. Where delivery work tracks. |
| **Portal Walkthrough** | First-login sequence: password change → contract sign → payment setup → done. |
| **Change Order** | Additive/subtractive amendment to an accepted opportunity. Uses the proposal's locked snapshot. Post-acceptance only. |
| **Active Client** | A client who has completed activation. Has portal access, ongoing billing, change-order capability. |

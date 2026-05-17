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
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (API + Routing)                │
│  • Public chat endpoint (Claude-powered)                      │
│  • Admin API (auth required)                                  │
│  • Portal API (auth required)                                 │
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

**Pricing is locked to proposals.** A proposal's pricing snapshot is permanent. Change orders against a proposal use the same locked snapshot. The only way to get fresh pricing is to clone the proposal.

**Proposals go stale after 90 days.** System flags them. New change orders require a clone or explicit override.

**Template-driven presentations.** Cover, demo, proposal, pricing, disposition — all templated. Content swaps per opportunity.

**Demos are manual.** Built by hand in the repo under a per-opportunity folder convention. Embedded into the presentation.

**Click-to-accept is sufficient.** No DocuSign. Inline signature capture inside the portal with typed name, timestamp, IP, full audit trail.

**Stripe is the payment processor.** Setup fee (one-time) + monthly subscription. PayPal not in v1.

**Change orders are additive/subtractive deltas, not new proposals.** They modify the active engagement and stack on top of the base.

## Glossary

| Term | Meaning |
|---|---|
| **Lead** | Top-of-funnel record. Possibly incomplete. From chat or manual entry. |
| **Client** | A confirmed business entity. Created by converting a lead or manually. |
| **Opportunity** | A specific deal under a client. Has one base proposal + 0..n change orders. |
| **Proposal** | A priced scope document. Locks a pricing snapshot at creation time. |
| **Pricing Snapshot** | Frozen copy of rate card + components used for a specific proposal. |
| **Presentation** | Template-driven multi-page experience: cover, demo, proposal, pricing, disposition. |
| **Demo** | Manually built static front-end mockup, embedded into a presentation. |
| **Disposition** | The outcome chosen at the end of a presentation (Accepted / Follow-Up / Changes / Declined). |
| **Activation** | The flow triggered by Accepted disposition: account creation → credentials → walkthrough. |
| **Portal Walkthrough** | First-login sequence: password change → contract sign → payment setup → done. |
| **Change Order** | Additive/subtractive amendment to an accepted opportunity. Uses the proposal's locked snapshot. |
| **Active Client** | A client who has completed activation. Has portal access, ongoing billing, change-order capability. |

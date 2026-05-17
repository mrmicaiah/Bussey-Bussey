# Bussey and Bussey — Specs

Level 2 architectural specs for the Bussey and Bussey operations platform. These specs define the system structure, data model, and key workflows. Field-level detail is intentionally left to fill in during implementation.

## Spec Files

| File | Purpose |
|---|---|
| `01-overview.md` | System overview, architecture, principles, glossary |
| `02-data-model.md` | All database entities, relationships, key fields |
| `03-workflow-lead-capture.md` | Website chat → lead → notification → admin inbox |
| `04-workflow-lead-to-client.md` | Lead qualification → client conversion |
| `05-workflow-opportunity-and-calculator.md` | Opportunity creation, calculator, pricing snapshots, proposals, presentation notes |
| `06-workflow-presentation-and-disposition.md` | Template presentation, demo embed, two-window mode, end-of-deck outcomes |
| `07-workflow-acceptance-and-activation.md` | Accepted disposition → account creation → credentials handoff → project created |
| `08-workflow-portal-walkthrough.md` | First login → password → contract sign → payment → done |
| `09-workflow-change-orders.md` | Post-acceptance change order lifecycle |
| `10-workflow-active-client-portal.md` | Ongoing portal experience for active clients |
| `11-workflow-calling-list.md` | CSV import, daily call cards |
| `12-architecture-backend.md` | Cloudflare Workers, D1, R2, KV, Claude integration |
| `13-architecture-frontend.md` | Eleventy site, admin app, portal app, presentation framework, live sync |

## Build Order (Recommended)

1. Data model + backend scaffolding (Worker, D1, auth)
2. Public website (Eleventy) + embedded chat → lead capture
3. Admin app: leads → clients → opportunities CRUD
4. Calculator + proposal generation (manual, no Claude)
5. Presentation framework + demo folder convention + live sync
6. Disposition → acceptance → activation flow
7. Client portal + first-login walkthrough
8. Stripe integration (setup + subscription)
9. Change order engine
10. Calling list
11. Supporting admin tools (reporting, audit log views)

## Principles

- **One Claude-powered feature in v1: the website chat.** Everything else is manual but lives in the right data structure so Claude can be wired in later.
- **The client journey is the spine.** Every feature serves the path from Lead → Active Client.
- **Acceptance is what locks everything.** Before Accepted is clicked, proposals are freely editable. After Accepted, scope and pricing are sacred and only change via signed change orders.
- **Three-tier editability post-acceptance:** scope/pricing (immutable, change-order-only), contract terms (immutable, amendable via signed change order), administrative fields like contact info (always editable, audit-logged).
- **Pricing snapshot rates stay at proposal-creation rates** through draft edits. Clone the proposal to get fresh rates.
- **Template-driven everywhere.** Presentations, proposals, contracts, change orders — all templated with content swapped in.
- **Two-window presentation mode.** The presentation window is read-only and client-facing (shared on Zoom). The admin/editor window has all controls. Edits in admin push to the presentation automatically via polling.
- **Build for the future salesperson.** Every workflow should be usable by someone who joined last week.
- **Documents capture an audit trail.** Every signature, every acceptance, every change order: who, when, IP, typed name.

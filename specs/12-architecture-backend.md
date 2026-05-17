# 12 — Backend Architecture

Cloudflare Workers + D1 + R2 + KV. Single Worker handling all API routes, with internal route segmentation by domain.

## Stack

| Component | Service | Purpose |
|---|---|---|
| Compute | Cloudflare Workers | All API endpoints, Claude orchestration, Stripe webhooks |
| Database | Cloudflare D1 (SQLite) | All relational data |
| File storage | Cloudflare R2 | Generated PDFs (contracts, proposals, change orders, invoices) |
| Session / cache | Cloudflare KV | Chat sessions, portal sessions, ephemeral tokens |
| Email | TBD (Resend / Postmark / SendGrid) | Transactional emails |
| AI | Anthropic API | Chat (v1's one Claude feature) |
| Payments | Stripe | Setup fees, subscriptions, change order charges |

## Worker Route Structure

Single Worker. Routes organized by audience and authentication.

### Public routes (no auth)
- `POST /api/chat/session` — start or resume a chat session
- `POST /api/chat/message` — send a message, get Claude's response
- `GET /api/chat/session/:token` — fetch session state (for resume)
- `GET /p/:opportunity_token/data` — fetch presentation data for an opportunity (read-only)
- `GET /p/:opportunity_token/demo/*` — serve demo static files (or routed via Pages)

### Admin routes (auth: admin_user)
- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET|POST|PUT|DELETE /api/admin/leads/*`
- `GET|POST|PUT|DELETE /api/admin/clients/*`
- `GET|POST|PUT|DELETE /api/admin/opportunities/*`
- `GET|POST|PUT|DELETE /api/admin/proposals/*`
- `POST /api/admin/proposals/:id/clone`
- `GET|POST|PUT|DELETE /api/admin/pricing-components/*`
- `GET|POST|PUT|DELETE /api/admin/change-orders/*`
- `POST /api/admin/opportunities/:id/disposition` — accepted / followup / changes / declined
- `POST /api/admin/opportunities/:id/activate` — internal call after Accepted confirmed
- `POST /api/admin/calling-list/import`
- `GET /api/admin/calling-list/today`
- `POST /api/admin/calling-list/:id/log`
- `GET /api/admin/notifications/*`
- `GET /api/admin/audit-log/*`

### Portal routes (auth: portal_account)
- `POST /api/portal/auth/login`
- `POST /api/portal/auth/logout`
- `POST /api/portal/auth/change-password`
- `GET /api/portal/me`
- `GET /api/portal/walkthrough/state`
- `POST /api/portal/walkthrough/sign-contract`
- `POST /api/portal/walkthrough/setup-payment` — creates Stripe customer + subscription + setup invoice
- `POST /api/portal/walkthrough/complete`
- `GET /api/portal/documents`
- `GET /api/portal/documents/:id`
- `GET /api/portal/change-orders`
- `GET /api/portal/change-orders/:id`
- `POST /api/portal/change-orders/:id/approve`
- `POST /api/portal/change-orders/:id/reject`
- `POST /api/portal/change-requests` — informal request, generates admin notification
- `GET /api/portal/payment/*`
- `GET /api/portal/project-status`

### Webhook routes (auth: signature verification)
- `POST /api/webhooks/stripe`

## Authentication

Three auth contexts, all session-based with HTTP-only cookies.

**Admin auth:**
- Email + password
- Argon2 or bcrypt hashing
- Session token in KV with TTL
- Optional: TOTP 2FA (recommended for production)

**Portal auth:**
- Email + password (temp on first login, then user-set)
- Same hashing
- Session token in KV with TTL (default 30 days idle)
- Forced password change flag on temp passwords

**Public chat:**
- No auth; anonymous session token in KV identifying the chat conversation
- Token includes minimal entropy; no sensitive data tied to it

## D1 Schema Organization

Migrations stored in `/migrations/` folder in repo. Each migration is numbered, idempotent where possible, applied via Wrangler CLI.

Naming conventions:
- Tables: snake_case, plural (e.g., `leads`, `opportunities`)
- Foreign keys: `<entity>_id` (e.g., `client_id`)
- Timestamps: `created_at`, `updated_at`, plus domain-specific (e.g., `accepted_at`)
- Booleans: prefixed with `is_` or `has_` or descriptive (e.g., `must_change_password`)
- Status fields: enum-like text columns with CHECK constraints

Full schema defined in 02-data-model.md.

## Claude Integration (Chat Only)

**Anthropic API direct call from Worker.**

- Model: Claude Sonnet (latest available)
- System prompt loaded from configuration (versioned in repo)
- Conversation context: last N messages from chat_session (configurable, default 20)
- Tools defined: `save_lead` as specified in 03-workflow-lead-capture.md
- Token budget per response: configurable (default 1024 max_tokens)
- Streaming: optional in v1; non-streaming is simpler
- API key: stored as Worker secret

Future Claude integrations (calculator, proposal generation, demo building) follow the same pattern when wired in, with separate system prompts and tool sets per use case.

## Stripe Integration

**Stripe Customer creation:** at payment setup during walkthrough, not at activation.

**Stripe Subscription:** created at walkthrough payment step. One subscription per opportunity (typically — multiple opportunities per client = multiple subscriptions).

**Stripe Invoices:**
- Setup fee: one-time invoice, charged immediately on subscription creation
- Monthly: auto-generated by Stripe subscription
- Change order setup deltas: one-time invoices, charged on change order approval

**Stripe Webhooks (received and handled):**
- `invoice.payment_succeeded` → update `stripe_invoice` status, notify client
- `invoice.payment_failed` → update status, notify client + admin
- `customer.subscription.updated` → sync `stripe_subscription` record
- `customer.subscription.deleted` → mark subscription canceled
- `payment_method.attached` → update card on file display

**Webhook security:** Stripe signature verification on every webhook. Reject anything that doesn't verify.

**Stripe Customer Portal:** used for client-side payment method management (or custom UI calling Stripe APIs — choice at impl time). Customer Portal is faster to ship; custom UI is more controllable.

## Email

Transactional only in v1. Provider TBD; recommend Resend for simplicity.

Email templates stored as Markdown/MJML in repo, rendered at send time with variable substitution.

Key templates needed:
- New lead notification (to admin)
- Walkthrough completion (to client + admin)
- Change order proposed (to client)
- Change order approved confirmation (to client + admin)
- Payment receipt (to client)
- Payment failed (to client + admin)
- Activation credentials (to client, when admin chooses Email option)
- Project status update (to client, optional)

All outbound emails recorded in `notification` table.

## File Storage (R2)

Generated PDFs stored in R2 with structured paths:
- `/contracts/[opportunity_id]/master-agreement.pdf`
- `/contracts/[opportunity_id]/change-orders/[change_order_id].pdf`
- `/proposals/[proposal_id].pdf` (optional — proposals primarily live as data)
- `/invoices/[stripe_invoice_id].pdf` (cached from Stripe)

Access: pre-signed URLs with short TTL for downloads. No public R2 access.

## Audit Logging

Every state-changing action writes an `audit_log` entry:
- Status transitions (lead status, opportunity status, proposal status, etc.)
- Document signatures (separate `document_signature` table, but also logged)
- Change order approvals/rejections
- Payment events
- User logins (admin and portal)
- Configuration changes (pricing component edits, etc.)

Queryable in admin via audit log view, filterable by entity type and date range.

## Environment Configuration

Worker secrets / environment vars:
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY` (or chosen email provider)
- `SESSION_SECRET` (for token signing)
- `ADMIN_NOTIFY_EMAILS` (comma-separated)
- `ENV` (production / staging / development)

## Deployment

- Worker deployed via Wrangler
- D1 migrations applied via Wrangler
- R2 buckets created via Wrangler config
- Pages deployment for Eleventy site
- Single repo, monorepo-style or separated workspaces (TBD at impl time)

## Out of Scope (v1)

- Multi-region active-active (single Worker is global by default but D1 has primary region)
- Backup automation beyond Cloudflare's built-in
- Custom email sending domain warming (use a provider's reputation)
- Observability beyond Worker tail logs and basic Stripe/email logs

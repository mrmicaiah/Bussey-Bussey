# Step M — Production Readiness

Goal: Bridge from "code that works in dev" to "company that runs on 
real money with real clients." Most of M is external coordination 
(legal, accounts, content). Claude Code's role is the technical 
infrastructure pieces; the rest is operational work the human handles 
in parallel.

## Track Split

**M-tech (Claude Code owns):** Production Cloudflare infrastructure, 
deployment pipelines, environment configuration, monitoring scaffolding, 
production smoke test harness.

**M-human (Micaiah owns):** Lawyer-reviewed contract, real Stripe 
activation, real Anthropic key, Resend account + domain verification, 
website content, case study, welcome email content.

Both tracks must converge before first real client sign.

## M-tech Subtasks

### M.1 Production Cloudflare resources

- Create production D1 database (separate from local dev)
- Create production R2 bucket
- Create production KV namespace
- Configure wrangler.toml environments (dev / staging / production) 
  with appropriate bindings per environment
- Document the wrangler commands for each environment in 
  context/deployment-runbook.md

### M.2 Migrations against production D1

- Apply migrations 0001 through 0008 in sequence against **both 
  staging and production** D1 via `wrangler d1 migrations apply 
  <db-name> --remote` (staging first; verify; then production).
- The pricing-components seed runs automatically as part of migration 
  0002 — it's an `INSERT OR IGNORE` SQL migration generated from 
  `data/pricing-components.csv`. No separate CSV apply step.
- **Do NOT seed any admin user yet.** The production bootstrap admin 
  is created via a deliberate, separate step (planned for M.3 after 
  secrets are in place, or as part of the M.10 smoke-test prep). 
  Document this carve-out in the runbook so future-team doesn't 
  accidentally seed a bootstrap admin during the migration step.
- Verify schema state via a SELECT against `sqlite_master` to confirm 
  all expected application tables exist with the right structure. 
  **Expected count: 26 application tables** (excluding sqlite_*, 
  d1_*, and _cf_* internals). Local D1 has the same 26 after all 8 
  migrations — production should match exactly. Tables list as of 
  migration 0008: admin_session, admin_user, audit_log, 
  calling_list_item, calling_log, change_order, change_order_line_item, 
  change_request, chat_message, chat_session, client, contract, 
  document_signature, lead, notification, opportunity, portal_account, 
  portal_session, pricing_components, pricing_snapshot, project, 
  proposal, proposal_line_item, stripe_customer, stripe_invoice, 
  stripe_subscription.
- Also verify the `pricing_components` row count post-migration (25 
  rows per the comment in migration 0002).
- Document the migration apply procedure + verification queries in 
  `context/deployment-runbook.md` section 2.

### M.3 Production environment variables and secrets

- Document the full env var inventory in context/env-vars.md including 
  source, sensitivity (public vs secret), and which environments use 
  which values
- Variables: ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, 
  STRIPE_PUBLISHABLE_KEY, RESEND_API_KEY, SESSION_SECRET, 
  ADMIN_NOTIFY_EMAILS, ADMIN_URL_BASE, PORTAL_URL_BASE, DEMO_URL_BASE, 
  ENV
- Provide a wrangler secret put script (or runbook section) for setting 
  each production secret
- Identify any remaining hardcoded URLs in code that should pull from 
  env vars instead — fix as part of this subtask

### M.4 Domain and DNS

- Document the DNS configuration needed for busseyandbussey.com pointing 
  at Cloudflare Pages (site) and the worker (api subdomain or path)
- Identify any subdomain decisions: admin.busseyandbussey.com vs 
  busseyandbussey.com/admin, portal.busseyandbussey.com vs 
  busseyandbussey.com/portal — propose recommendation with rationale
- The actual DNS configuration is M-human (the user owns the domain), 
  but document what's needed so the user can configure it

### M.5 Stripe production webhook endpoint configuration

- Document the Stripe dashboard webhook configuration:
  - Production webhook URL: https://api.busseyandbussey.com/api/webhooks/
    stripe (or wherever the worker production endpoint lands)
  - Events to subscribe: invoice.payment_succeeded, invoice.payment_failed, 
    customer.subscription.updated, customer.subscription.deleted, 
    payment_method.attached
  - Get the production webhook secret from Stripe dashboard → install 
    via wrangler secret put STRIPE_WEBHOOK_SECRET

### M.6 Deployment pipeline

- Document the production deployment procedure:
  - Worker: wrangler deploy --env production
  - Admin: pnpm build && wrangler pages deploy (or equivalent)
  - Portal: same pattern
  - Site: same pattern
- Identify any pre-deployment checks (lint, typecheck, build) that 
  should be required before deploy
- Document rollback procedure for each surface

### M.7 Production smoke test harness

- A version of the end-to-end smoke test runnable against the 
  production environment using a designated production-test client 
  (probably Micaiah's own account)
- Verifies the full chain from chat capture to active client without 
  charging real money (Stripe test card OR with real card and 
  immediate refund — your call which is cleaner)
- Documents the cleanup procedure for production-test data so it 
  doesn't pollute real client records

### M.8 Monitoring and alerting baseline

- Document the minimal monitoring posture:
  - Cloudflare Worker logs (tail) for runtime errors
  - Stripe dashboard for payment failures
  - Resend dashboard for email delivery
  - Manual check pattern for D1 health (no auto-alert in v1, document 
    what to look for)
- Identify what an actionable alert would look like for each surface 
  (defer the implementation; this is documentation only for v1)
- Add a deferred-cleanup entry for proper alerting infrastructure

### M.9 Backup posture documentation

- Document Cloudflare's built-in D1 backup behavior
- Identify manual backup procedures if needed (wrangler d1 export 
  for periodic local snapshots)
- Document data retention expectations
- Defer automated backup infrastructure; document what we have and 
  what's missing

### M.10 M-tech smoke test

After all M-tech subtasks complete, run the full production smoke test 
end-to-end and verify:
- Site loads at busseyandbussey.com
- Admin loads and admin user can log in
- Chat captures a lead and triggers admin notification
- Admin can convert lead → client → opportunity → proposal
- Presentation renders correctly at /p/:token/
- Disposition Accepted flows through activation
- Portal walkthrough completes with Stripe test card
- Active portal shows all sections correctly
- Webhook delivery works (use stripe trigger for events)
- audit_log clean throughout

## M-human Tasks (Out of Scope for Claude Code)

These are user-owned. Claude Code can help draft content if asked but 
doesn't drive these:

- Lawyer review of /templates/contract/master.md
- Stripe business identity verification (account → activation)
- Real Anthropic API key (sign up if not already, generate production 
  key)
- Resend account creation + domain verification for sending email 
  from busseyandbussey.com
- DNS configuration for the domain
- Home page copy (currently placeholder)
- Services and Industries page copy
- Priscilla case study (with her permission)
- Welcome email content (real version of the placeholder)
- Notification email content (real versions of placeholders)

## Convergence Criterion

v1 is "ready to sell to first real client" when:
- All M-tech subtasks complete
- All M-human tasks complete
- Production smoke test passes
- User explicitly approves first-real-client readiness

## Out of Scope for M
- Marketing infrastructure (analytics, SEO, paid acquisition) — these 
  are post-launch concerns
- Advanced monitoring / observability (defer; document what we have)
- Automated backup beyond Cloudflare's built-in
- CI/CD pipeline (defer; manual deploy is fine for v1)
- Performance optimization (defer; ship and measure)
- Multi-region setup (defer; single region is fine)

## Constraints
- No real client signs through the production system until both tracks 
  converge AND the production smoke test passes
- All sensitive secrets go through wrangler secret put — never committed 
  to repo
- Production-test client data must be cleaned up after smoke test to 
  prevent polluting real records

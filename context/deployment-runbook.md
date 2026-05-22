# Deployment runbook

The procedural counterpart to `context/step-M-scope.md`. Each section
below is filled in as the corresponding step-M subtask completes. This
is the doc Micaiah (or future-team) runs through when standing up
staging/production for the first time, and when re-deploying after a
change.

Sections are organized by the workflow's natural order:

1. **One-time setup** — Cloudflare resource creation (M.1)
2. **Schema migrations** — applying migrations to a fresh DB (M.2)
3. **Secrets and env vars** — `wrangler secret put` invocations (M.3)
4. **Domain and DNS** — what to configure where (M.4)
5. **Stripe webhook configuration** — dashboard side (M.5)
6. **Deploying** — the actual `wrangler deploy` per surface (M.6)
7. **Production smoke test** — verifying real-mode end-to-end (M.7/M.10)
8. **Monitoring** — what to watch (M.8)
9. **Backup** — what we have, what's missing (M.9)
10. **Rollback** — how to revert each surface

> **Status:** M.1, M.2, and most of M.3 complete (M.3.1, M.3.2, M.3.4,
> M.3.5, M.3.7). M.3.3 (staging secrets installation) and M.3.6
> (verification) pending user-provided secret values. Sections 4 onward
> are skeleton headings for later subtasks (M.4 → M.10).

---

## 1. One-time Cloudflare resource setup (M.1)

These commands create the production-tier Cloudflare resources the
worker needs. Each `wrangler ... create` command returns a resource
ID — paste each one into `worker/wrangler.toml` at the placeholder
marker. After all three are pasted in, `wrangler deploy --env
production` will bind to the real resources instead of the
`REPLACE_WITH_*` sentinels.

### Pre-requisites

- A Cloudflare account (workers + pages enabled). The free tier is
  enough to start; D1 + R2 + KV all have generous free tiers.
- `wrangler login` completed in the local shell. Verify with
  `wrangler whoami` — should print your account email + account ID.
- Git checkout up to date (so wrangler.toml has the `[env.staging]`
  and `[env.production]` blocks added in M.1).

### Create production resources

Run from `worker/` directory:

```bash
# D1 — production
wrangler d1 create bussey-bussey-production
# → returns database_id; paste into [[env.production.d1_databases]] database_id

# R2 — production
wrangler r2 bucket create bussey-bussey-files-production
# (no ID returned; the bucket name is the binding)

# KV — production
wrangler kv namespace create SESSIONS --env production
# → returns id; paste into [[env.production.kv_namespaces]] id
```

### Create staging resources (optional but recommended)

Run the same three commands with `-staging` suffixes. The
`[env.staging]` block in wrangler.toml already references them by
name; only the IDs need filling in.

```bash
wrangler d1 create bussey-bussey-staging
wrangler r2 bucket create bussey-bussey-files-staging
wrangler kv namespace create SESSIONS --env staging
```

### Verify

After pasting IDs in, run:

```bash
wrangler deploy --dry-run --env staging
wrangler deploy --dry-run --env production
```

Each should print the binding table with the real resource names (no
more `REPLACE_WITH_*` placeholders visible).

### Dev environment unchanged

Local development continues to use `wrangler dev` (no `--env` flag);
that binds to `.wrangler/state/` and never touches Cloudflare.

---

## 2. Schema migrations (M.2)

Apply all eight migrations against staging first, verify, then
production. The pricing-components seed is migration 0002 (`INSERT OR
IGNORE`, 25 rows) — it runs automatically as part of the apply, no
separate step. **No admin user is seeded here**; production bootstrap
admin is created in a separate deliberate step (M.3 or M.10 prep) so
nobody accidentally provisions an admin with the wrong email/password
mid-migration.

> **Re-running 0002 is safe.** The seed uses `INSERT OR IGNORE` keyed
> on `pricing_components.code` (the natural PK), so re-running the
> migration against an already-seeded database is a no-op for existing
> rows. If the rate card needs a price *update*, do NOT edit migration
> 0002 — write a targeted forward migration (or use the admin UI).
> Migration 0002 is for the initial seed only; editing it after it's
> been applied to staging or production won't re-execute (wrangler
> tracks applied migrations by filename in the `d1_migrations` table).

### Apply

Run from `worker/`:

```bash
# Staging first.
pnpm exec wrangler d1 migrations apply bussey-bussey-staging --env staging --remote

# Verify (see queries below). When green, do the same for production.
pnpm exec wrangler d1 migrations apply bussey-bussey-production --env production --remote
```

In non-interactive contexts (CI, scripts) wrangler auto-confirms the
"may not be available to serve requests" prompt with "yes". For
manual runs it'll wait for keyboard input.

### Verify

Same query set against each database. Substitute the database name
(`bussey-bussey-staging` / `bussey-bussey-production`) and matching
`--env` flag.

```bash
# Table count — expect 26 application tables (excluding sqlite_*, d1_*, _cf_*).
pnpm exec wrangler d1 execute <db-name> --env <env> --remote \
  --command="SELECT COUNT(*) AS n FROM sqlite_master
             WHERE type='table'
               AND name NOT LIKE 'sqlite_%'
               AND name NOT LIKE 'd1_%'
               AND name NOT LIKE '_cf_%';"

# Full table list — should match local exactly.
pnpm exec wrangler d1 execute <db-name> --env <env> --remote \
  --command="SELECT name FROM sqlite_master
             WHERE type='table'
               AND name NOT LIKE 'sqlite_%'
               AND name NOT LIKE 'd1_%'
               AND name NOT LIKE '_cf_%'
             ORDER BY name;"

# Pricing components row count — expect 25.
pnpm exec wrangler d1 execute <db-name> --env <env> --remote \
  --command="SELECT COUNT(*) AS pricing_rows FROM pricing_components;"

# Spot-check three component rates haven't been corrupted.
pnpm exec wrangler d1 execute <db-name> --env <env> --remote \
  --command="SELECT code, name, unit_price FROM pricing_components
             WHERE code IN ('standard_table', 'platform_base_medium', 'complex_integration')
             ORDER BY code;"
# Expected: standard_table 350, platform_base_medium 1000, complex_integration 3500.

# lead.source CHECK enum readback — verifies migration 0008's
# table-rebuild preserved the inbound FK from client.origin_lead_id
# and added 'calling_list' to the allowed values.
pnpm exec wrangler d1 execute <db-name> --env <env> --remote \
  --command="SELECT sql FROM sqlite_master WHERE name='lead';"
# Expected: source IN ('chat', 'manual', 'referral', 'event', 'calling_list')

# admin_user empty — no admin should exist yet on a freshly-migrated
# production. If any rows are present, an unintended seed ran.
pnpm exec wrangler d1 execute <db-name> --env <env> --remote \
  --command="SELECT COUNT(*) AS n FROM admin_user;"
# Expected: 0
```

### Expected post-migration tables (26)

```
admin_session                document_signature   proposal
admin_user                   lead                 proposal_line_item
audit_log                    notification         stripe_customer
calling_list_item            opportunity          stripe_invoice
calling_log                  portal_account       stripe_subscription
change_order                 portal_session
change_order_line_item       pricing_components
change_request               pricing_snapshot
chat_message                 project
chat_session
client
contract
```

### Re-apply / partial-failure handling

`wrangler d1 migrations apply` is idempotent — each migration is
recorded in a `d1_migrations` tracking table after success, so
re-running the command picks up only the migrations not yet applied.
If a single migration fails mid-stream:

1. Stop. Do NOT try to work around the error by writing a fix-up
   migration against production directly.
2. Capture the exact error from the wrangler output.
3. Inspect the failed migration locally (`wrangler d1 migrations
   apply <db> --local`) to confirm reproducibility.
4. Repair the migration file (or write a counter-migration) in dev.
5. Re-run the apply — only the unfinished + new migrations will run.

The 0001–0008 set has been verified on both staging
(`f6c991cc-5e8e-4f4c-ab24-79c1623e66dc`) and production
(`aac8980f-4e93-4bef-a778-dbb3d02d474b`); 26 tables, 25
pricing_components rows, lead.source enum carrying all five values
including `calling_list`, admin_user empty, on each.

---

## 3. Secrets and environment variables (M.3)

Full inventory lives in `context/env-vars.md` — read that first.
This section is the operational counterpart: the exact commands to
install each secret, with the deferred items explicitly called out.

### Public config (already in wrangler.toml)

Non-secret config (`ENV`, `ADMIN_URL_BASE`, `PORTAL_URL_BASE`,
`DEMO_URL_BASE`, `ADMIN_NOTIFY_EMAILS`, `STRIPE_PUBLISHABLE_KEY`)
lives in `worker/wrangler.toml` under `[env.<env>.vars]` blocks.
Editing those is a normal code change (commit + push + deploy).
Two values currently sit as placeholders pending user input:

- `ADMIN_NOTIFY_EMAILS` (both staging and production) — user's
  preferred notification recipient(s).
- `STRIPE_PUBLISHABLE_KEY` (staging) — real `pk_test_…` from Stripe
  dashboard.
- `STRIPE_PUBLISHABLE_KEY` (production) — `pk_live_…`, deferred
  until Stripe business activation completes.

Verify with `wrangler deploy --dry-run --env <env>` — every var is
listed in the bindings table.

### Hardcoded URL audit (M.3.2 — completed)

Five worker code paths used hardcoded localhost URLs that needed to
flow through env vars instead. All fixed; three had the side effect
of resolving a latent bug (constants pointed at admin's port `5173`
where they should have pointed at portal's port `5174`).

| File                                                | Replaced with         |
|-----------------------------------------------------|------------------------|
| `worker/src/services/activation.ts`                 | `env.PORTAL_URL_BASE`  |
| `worker/src/routes/admin/credentials.ts`            | `ctx.env.PORTAL_URL_BASE` |
| `worker/src/routes/admin/change-orders.ts`          | `ctx.env.PORTAL_URL_BASE` (via fn arg) |
| `worker/src/routes/portal/payment.ts`               | `ctx.env.PORTAL_URL_BASE` |
| `worker/src/routes/public/chat.ts`                  | `ctx.env.ADMIN_URL_BASE`  |
| `admin/src/routes/(authed)/.../proposal/+page.svelte` | `import.meta.env['VITE_API_URL_BASE']` (with `?? 'http://localhost:8787'` fallback) |

`worker/.dev.vars` + `.dev.vars.example` gained `ADMIN_URL_BASE` +
`PORTAL_URL_BASE` entries so dev has the new names. `admin/.env.example`
documents `VITE_API_URL_BASE` for the build-time path.

### Secret installation — staging

User installs these themselves (decided during M.3 review). Run from
`worker/`. Each command prompts for the value interactively; paste
from password manager / Stripe dashboard / etc.

```bash
# Anthropic — same key as dev is fine; staging usage is tiny.
pnpm exec wrangler secret put ANTHROPIC_API_KEY --env staging

# Stripe TEST secret key (sk_test_…).
pnpm exec wrangler secret put STRIPE_SECRET_KEY --env staging

# Resend — real key with a verified sending domain (or shared with dev).
pnpm exec wrangler secret put RESEND_API_KEY --env staging

# Session signing secret — fresh random 32+ bytes. Must NOT match
# dev or production. Generate first:
#   openssl rand -hex 32
# then paste the output.
pnpm exec wrangler secret put SESSION_SECRET --env staging

# Admin notification recipient — transitionally a SECRET because the
# value is a personal email until business email is set up at
# busseyandbussey.com. See notes/deferred-cleanup.md for the move-back
# plan. Comma-separated for multiple recipients.
pnpm exec wrangler secret put ADMIN_NOTIFY_EMAILS --env staging
```

`STRIPE_WEBHOOK_SECRET` for staging is **deferred until M.5** —
created at the same time as the staging webhook endpoint in the
Stripe dashboard.

Verify the installed set:

```bash
pnpm exec wrangler secret list --env staging
```

Expected after the five commands above:
`ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`,
`SESSION_SECRET`, `ADMIN_NOTIFY_EMAILS` (5 entries;
`STRIPE_WEBHOOK_SECRET` arrives later in M.5).

### Secret installation — production (DEFERRED)

Production secrets are intentionally NOT installed yet. They land
one-by-one as the corresponding external dependency completes:

| Secret                  | Blocker                                                  |
|-------------------------|----------------------------------------------------------|
| `ANTHROPIC_API_KEY`     | User generates a production-tier Anthropic key.          |
| `STRIPE_SECRET_KEY`     | Stripe business identity verification → live mode enabled. |
| `STRIPE_WEBHOOK_SECRET` | M.5 — production webhook endpoint configured in Stripe.  |
| `RESEND_API_KEY`        | Resend domain verification for `busseyandbussey.com`.    |
| `SESSION_SECRET`        | None — generate when ready to install.                   |
| `ADMIN_NOTIFY_EMAILS`   | None — install with personal email for now; move back to `[env.production.vars]` once business email exists at `busseyandbussey.com` (see deferred-cleanup). |

When each becomes available, install with:

```bash
pnpm exec wrangler secret put <NAME> --env production
```

`STRIPE_PUBLISHABLE_KEY` (the pk_live_… value) also lands at the
same time as `STRIPE_SECRET_KEY`, but it goes into `wrangler.toml`
`[env.production.vars]` (public config), not via `secret put`.

> **Production deployment is BLOCKED until the first five production
> secrets above are installed AND the `STRIPE_PUBLISHABLE_KEY` in
> `wrangler.toml [env.production.vars]` is replaced with the real
> `pk_live_…` value.** (`ADMIN_NOTIFY_EMAILS` can be installed at any
> time and is not a blocker for the deployment gate.) Section 6
> (Deployment commands) re-states this.

---

## 4. Domain and DNS (M.4)

_To be filled in by M.4._

Outline:

- Recommended host topology (subdomains vs paths) with rationale
- DNS records to create in Cloudflare's DNS panel
- Custom Domain attachment to Pages + Worker routes
- TLS verification

---

## 5. Stripe webhook configuration (M.5)

_To be filled in by M.5._

Outline:

- Add endpoint in Stripe Dashboard → Developers → Webhooks
- Endpoint URL based on the M.4 host decision
- Events to subscribe (see the list in
  `worker/src/routes/webhooks/stripe.ts`)
- Capture the signing secret → `wrangler secret put
  STRIPE_WEBHOOK_SECRET --env production`

---

## 6. Deployment commands (M.6)

_To be filled in by M.6._

Outline:

- Worker: `wrangler deploy --env production`
- Admin (SvelteKit static): `pnpm --filter @bussey/admin build` →
  `wrangler pages deploy` (or equivalent)
- Portal: same pattern
- Site (Eleventy): build + Pages deploy
- Pre-deploy checks (typecheck, build) per surface
- Rollback procedure per surface

---

## 7. Production smoke test (M.7 / M.10)

_To be filled in by M.7 (harness) and M.10 (the run)._

Outline:

- Designated production-test client (Micaiah's own account)
- Full chain walkthrough against production URLs
- Cleanup procedure to remove the test client's rows

---

## 8. Monitoring (M.8)

_To be filled in by M.8._

Outline:

- Cloudflare Worker logs (`wrangler tail --env production`)
- Stripe dashboard tabs to watch
- Resend dashboard tabs to watch
- Manual D1 health checks
- Deferred: actionable alerting (entry in
  `notes/deferred-cleanup.md`)

---

## 9. Backup (M.9)

_To be filled in by M.9._

Outline:

- Cloudflare's built-in D1 backup posture
- Manual `wrangler d1 export` cadence (if we adopt one)
- R2 bucket replication posture
- KV: ephemeral by design; no backup needed
- Data retention expectations

---

## 10. Rollback procedures

_To be filled in by M.6._

Outline per surface:

- Worker: `wrangler rollback` or redeploy previous git SHA
- Admin / Portal: redeploy previous build via Pages
- D1: forward-only; reverting a migration requires a counter-migration

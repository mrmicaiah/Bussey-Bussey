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

> **Status:** M.1, M.2, M.3 complete. M.4 complete — topology decided
> (path-based); the `busseyandbussey.com` zone is Active (2026-05-23) and
> the worker `routes` blocks in `wrangler.toml` are now uncommented +
> dry-run-validated for both envs. M.5 (Stripe webhooks) documented below
> — the dashboard config + secret install are user-side (needs the Stripe
> account); staging delivery testing is gated behind the M.6 staging
> deploy. **M.6 §6 + §10 are now written as a PLAN (staging-first, with
> production gated and per-surface rollback) — nothing has been deployed;
> awaiting user review + a discrete go-ahead for the staging deploy.** The
> §6.6 bootstrap-admin gap is RESOLVED: `seed-bootstrap-admin.mjs` now
> takes `--env staging|production` + `--remote` (inspect-verified, not yet
> run for real). Sections 7–9 remain skeletons (M.7 → M.9).

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

This section is what you (Micaiah) follow in the Cloudflare dashboard to
route `busseyandbussey.com` at the infrastructure. The actual clicks are
yours; everything below is the record-by-record map. **Review §4.0 before
making any DNS change** — it locks the topology that the rest of the
section (and the wrangler.toml edits already committed) depends on.

### 4.0 Topology decision — PATH-BASED (recommended)

Everything lives on **one origin**, split by path:

| Path                  | Served by                          |
|-----------------------|------------------------------------|
| `busseyandbussey.com/`            | Site (Eleventy) — Pages            |
| `busseyandbussey.com/admin/*`     | Admin SPA (SvelteKit) — Pages      |
| `busseyandbussey.com/portal/*`    | Portal SPA (SvelteKit) — Pages     |
| `busseyandbussey.com/api/*`       | Worker (chat, admin, portal, Stripe webhooks) |
| `busseyandbussey.com/p/:token`    | Worker (client presentation pages) |
| `busseyandbussey.com/demos/:token/` | Demo iframe assets — Pages (site build) |

**Why path-based, not subdomains.** The decision is forced by how the
code is already built — verified by reading the auth, CORS, and SPA
fetch layers:

1. **Both SPAs call the API with relative paths and credentials.**
   `admin/src/lib/api.ts` and `portal/src/lib/api.ts` do
   `fetch('/api/...', { credentials: 'include' })` — no host prefix. They
   assume the API is same-origin. Dev confirms it: both Vite configs proxy
   `/api` → `127.0.0.1:8787`, and the apps mount at `localhost:5173/admin`
   and `localhost:5174/portal`. The SvelteKit builds use
   `adapter-static` with base paths `/admin` and `/portal` — i.e. the
   front end was architected path-based from the start.

2. **Session cookies are host-only and `SameSite=Strict`.** The cookie
   helpers (`worker/src/lib/cookies.ts`, `routes/admin/auth.ts`,
   `routes/portal/auth.ts`) set `HttpOnly; Secure; SameSite=Strict;
   Path=/` with **no `Domain=` attribute** → the cookie is bound to the
   exact host that set it.

3. **There is no CORS-with-credentials anywhere.** Only the anonymous
   chat endpoints (`/api/chat/*`) send CORS headers, and they use
   `Access-Control-Allow-Origin: *` with **no** `Allow-Credentials`
   (`worker/src/routes/public/chat.ts`). Authenticated `/api/admin/*` and
   `/api/portal/*` routes send no CORS headers at all.

Put together: the app only works when the SPA and the API share an
origin. **Path-based gives that for free** — one host, host-only cookies
are correct, `SameSite=Strict` is correct and maximally protective, and
CORS is a non-issue (no cross-origin authenticated request ever happens).
Production then mirrors dev exactly.

**A subdomain split (`admin.`, `portal.`, `api.`) would require one of
two changes, both undesirable right before taking real money:**

- **Option α — refactor the auth/CORS layer:** switch the SPAs to an
  absolute `https://api.busseyandbussey.com` base, add CORS with a
  reflected-Origin allowlist + `Access-Control-Allow-Credentials: true` +
  preflight handling on every authenticated call, **and** widen the
  session cookies to `Domain=.busseyandbussey.com` (and relax
  `SameSite`). That is exactly the security-sensitive code you least want
  to be changing late in v1.
- **Option β — keep relative `/api` and mount the worker on every
  subdomain** via routes (`admin.busseyandbussey.com/api/*`,
  `portal.busseyandbussey.com/api/*`, plus `api.` for presentations).
  This avoids the auth refactor but spreads the worker across 3–4
  hostnames and still needs a base-path code change for clean URLs — more
  routing surface to get right by hand for no functional gain over
  path-based.

**The one tradeoff of path-based** is on the deployment side, not the
code side: Cloudflare Pages binds a *whole hostname* to *one* project, so
three separate Pages projects can't share `busseyandbussey.com` by path
natively. The site, admin, and portal builds are therefore assembled into
**one Pages deploy** (site at `/`, the admin `build/` copied under
`/admin/`, the portal `build/` under `/portal/` — the base paths line up
exactly). This couples the three front-end deploys into one publish/rollback
unit. For a single-operator v1 that is arguably *simpler* to operate (one
deploy command, one rollback). The mechanics live in §6; revisiting
independent per-surface deploys post-v1 is logged in
`notes/deferred-cleanup.md`.

> Worker routes take precedence over a Pages custom domain on the same
> hostname (most-specific pattern wins), so `…/api/*` and `…/p/*` are
> handled by the worker while every other path falls through to the
> merged Pages project. This is the documented Cloudflare behavior the
> topology relies on.

### 4.1 Prerequisite — domain on Cloudflare

`busseyandbussey.com` must be an **active zone on the Cloudflare account**
before any of the below works (Pages custom domains and worker routes are
zone-level features).

1. Cloudflare dashboard → **Add a site** → `busseyandbussey.com`.
2. Cloudflare assigns two nameservers. At your registrar, replace the
   domain's nameservers with those two.
3. Wait for the zone status to flip to **Active** (minutes to a few hours).
4. Set SSL/TLS mode to **Full (strict)** (dashboard → SSL/TLS → Overview).
   Universal SSL auto-provisions the edge certificate.

Until the zone is Active, leave the wrangler.toml `routes` blocks
commented (they already are — see §4.4).

### 4.2 DNS records

With path-based topology the DNS surface is tiny — and most records are
**created for you** when you attach the custom domains in §4.3 rather than
hand-entered. The end state:

| Type  | Name      | Target / Value                    | Proxy   | Who creates it                         |
|-------|-----------|-----------------------------------|---------|----------------------------------------|
| CNAME | `@` (apex)| `<prod-pages-project>.pages.dev`  | Proxied | Auto — added when you attach the apex as a Pages custom domain (§4.3). Shows as a flattened CNAME / synthetic A+AAAA. |
| CNAME | `www`     | `busseyandbussey.com`             | Proxied | You — then a redirect rule `www → apex` (§4.3), or attach `www` as a second Pages custom domain. |
| CNAME | `staging` | `<staging-pages-project>.pages.dev` | Proxied | Auto — added when you attach `staging.busseyandbussey.com` as a custom domain to the staging Pages project. |

Notes:
- **Everything must be Proxied (orange cloud).** Worker routes and Pages
  only intercept proxied traffic; a grey-cloud (DNS-only) record bypasses
  both.
- There is **no `api`, `admin`, `portal`, or `demo` record** — that is the
  whole point of path-based. If you see leftover `admin-staging` /
  `portal-staging` / `demo-staging` ideas from earlier drafts, ignore
  them; they are not part of this topology.
- Email/sending records (SPF/DKIM/DMARC for Resend on
  `busseyandbussey.com`) are a separate M-human task (Resend domain
  verification) and are independent of this routing.

### 4.3 Pages custom-domain attachment

**Production (merged site+admin+portal Pages project):**
1. Pages → the production project → **Custom domains** → **Set up a
   domain** → `busseyandbussey.com`. Cloudflare creates the proxied apex
   DNS record automatically and provisions TLS.
2. Add `www.busseyandbussey.com` too, then create a **redirect rule**
   (Rules → Redirect Rules) `www.busseyandbussey.com/*` →
   `https://busseyandbussey.com/$1` (301) so the apex is canonical.

**Staging (merged staging Pages project):**
3. Pages → the staging project → **Custom domains** → add
   `staging.busseyandbussey.com`.

> Staging uses a real subdomain rather than the project's free
> `*.pages.dev` URL **on purpose**: the worker routes that keep the SPAs'
> relative `/api` calls same-origin can only attach to a zone hostname.
> `*.pages.dev` (Pages) and `*.workers.dev` (Worker) are different hosts,
> so the relative-`/api` model can't be exercised there. If you'd rather
> not spend a staging subdomain, staging behavior is already faithfully
> reproduced locally by the Vite dev proxy (same-origin `/api`); the
> staging subdomain exists for a true pre-prod dress rehearsal.

### 4.4 Worker routes

The worker is mounted on the API and presentation paths via routes
declared in `worker/wrangler.toml`. They are **currently commented out**
and must be uncommented once the zone is Active (§4.1) — activating them
before the zone exists makes `wrangler deploy --env <env>` fail trying to
bind a route on a non-existent zone.

Production (`[env.production]`):
```toml
[[env.production.routes]]
pattern = "busseyandbussey.com/api/*"
zone_name = "busseyandbussey.com"

[[env.production.routes]]
pattern = "busseyandbussey.com/p/*"
zone_name = "busseyandbussey.com"
```

Staging (`[env.staging]`):
```toml
[[env.staging.routes]]
pattern = "staging.busseyandbussey.com/api/*"
zone_name = "busseyandbussey.com"

[[env.staging.routes]]
pattern = "staging.busseyandbussey.com/p/*"
zone_name = "busseyandbussey.com"
```

The single `/api/*` route covers **all** API traffic — public chat,
authenticated admin, authenticated portal, and the Stripe webhook
(`/api/webhooks/stripe`). The `/p/*` route serves client presentation
pages. No separate route is needed for `/demos/*` (those are static
assets served by the Pages project, not the worker).

Order of operations: uncomment → `wrangler deploy --env <env>` creates
the routes as part of the deploy (covered in §6). You can also add routes
by hand in the dashboard (Workers → the worker → Triggers → Routes), but
keeping them in wrangler.toml makes the deploy reproducible.

### 4.5 How `/p/:token` (presentations) resolves

The presentation page is **worker-served HTML**, not a Pages asset
(`worker/src/routes/public/presentation.ts`):

- A client opens `https://busseyandbussey.com/p/<token>`. The
  `busseyandbussey.com/p/*` worker route catches it (takes precedence over
  Pages), and the worker returns a self-contained HTML shell (inline CSS +
  JS, no external bundle).
- The page polls `GET /p/<token>/data` (same path prefix, same worker
  route) for live sync, with `credentials: 'omit'` — the token in the URL
  is the only authorization, no cookies.
- It embeds a demo iframe at `${DEMO_URL_BASE}/demos/<token>/`, which with
  the path-based values resolves to
  `https://busseyandbussey.com/demos/<token>/` — **same-origin**, served
  by the Pages site build. (The presentation response sets
  `X-Frame-Options: SAMEORIGIN`; the demo being same-origin keeps framing
  clean.)
- Admin's "Preview presentation" button opens
  `${VITE_API_URL_BASE}/p/<token>` =
  `https://busseyandbussey.com/p/<token>` — same route, same worker.

### 4.6 TLS

- Universal SSL covers the apex and proxied subdomains automatically once
  each custom domain is attached. No manual cert work.
- Confirm SSL/TLS mode = **Full (strict)** (§4.1 step 4).
- After attaching, the Pages **Custom domains** panel shows each domain's
  certificate status — wait for **Active** before smoke-testing.

### 4.7 Downstream effects of this decision

- **Stripe webhook URL (M.5):** with path-based, the production endpoint
  is **`https://busseyandbussey.com/api/webhooks/stripe`** (staging:
  `https://staging.busseyandbussey.com/api/webhooks/stripe`). This
  supersedes the `api.busseyandbussey.com/...` guess in the M.5 scope
  outline — use the path-based URL when configuring the Stripe dashboard.
- **wrangler.toml URL bases (committed in this subtask):**
  `ADMIN_URL_BASE`, `PORTAL_URL_BASE`, `DEMO_URL_BASE` now carry
  path-based, same-origin values in both `[env.staging.vars]` and
  `[env.production.vars]`. Verified via `wrangler deploy --dry-run --env
  staging` and `--env production` (both list the new bases cleanly).
- **Front-end build-time vars (set during M.6, documented in
  `context/env-vars.md`):** `VITE_API_URL_BASE` (admin) and
  `BUSSEY_API_BASE` (site) become same-origin —
  `https://busseyandbussey.com` (prod) / `https://staging.busseyandbussey.com`
  (staging). The SPAs' general data-fetching stays relative-path; no API
  base prefix is involved there.

### 4.8 Verification (after DNS is live + deploys done)

```bash
# Apex serves the site (Pages).
curl -sI https://busseyandbussey.com/            | grep -i 'HTTP/\|server\|cf-'

# Admin + portal SPAs served under their paths (expect 200 + HTML).
curl -sI https://busseyandbussey.com/admin/      | head -1
curl -sI https://busseyandbussey.com/portal/     | head -1

# API reaches the worker (the service banner is JSON at /, but any
# /api/* path should be worker-handled — an unauthenticated admin call
# should return 401 JSON, not a Pages 404 HTML page).
curl -s  https://busseyandbussey.com/api/admin/me        # -> {"error":...} 401, proves worker route wins
curl -sI https://busseyandbussey.com/p/nonexistent-token # -> worker response, not Pages 404

# Confirm there is NO admin/api/portal subdomain (should not resolve to a
# distinct service).
curl -sI https://api.busseyandbussey.com/ 2>&1 | head -1   # expected: does not resolve / no such host
```

A green run = apex shows the site, `/admin` + `/portal` load the SPAs,
`/api/*` and `/p/*` are answered by the worker (not Pages), and no
stray subdomain exists.

---

## 5. Stripe webhook configuration (M.5)

The worker side is already built: `POST /api/webhooks/stripe`
(`worker/src/routes/webhooks/index.ts`), public (not auth-gated — Stripe
calls it unauthenticated), signature-verified against
`STRIPE_WEBHOOK_SECRET` on every delivery. **Signature verification is
mandatory in every environment — there is no dev/staging bypass**
(`worker/src/routes/webhooks/stripe.ts`): a missing secret → HTTP 500
`webhook_secret_missing`; a bad/absent signature → HTTP 400. So the
`STRIPE_WEBHOOK_SECRET` for an environment must be installed before that
environment can process *any* webhook.

**This whole section is yours to execute (M-human)** — it needs your
Stripe account. Claude's part (the endpoint URLs, the event list, the
install commands, the sequencing) is documented here; the dashboard
clicks and the `wrangler secret put` are yours.

One webhook endpoint **per environment**, each created in its matching
Stripe **mode**: staging in **Test mode** (pairs with the `sk_test_…` /
`pk_test_…` keys), production in **Live mode** (pairs with `sk_live_…` —
which requires Stripe business activation, so the production endpoint is
gated on that, consistent with §3). Test-mode and Live-mode webhook
endpoints are entirely separate lists in the Stripe dashboard and each
issues its own `whsec_…` signing secret.

### 5.0 Endpoint URLs (from the path-based topology, §4)

| Environment | Mode | Endpoint URL |
|-------------|------|--------------|
| Staging     | Test | `https://staging.busseyandbussey.com/api/webhooks/stripe` |
| Production  | Live | `https://busseyandbussey.com/api/webhooks/stripe` |

Both are served by the `…/api/*` worker route added in §4. (These
supersede the `api.busseyandbussey.com/...` placeholder in the M scope
outline — that was written before the topology was decided.)

### 5.1 Sequencing — read this before you start

There are two distinct milestones, and they have different
prerequisites:

1. **Creating the endpoint + installing the signing secret** — can be
   done **now**. Stripe registers the URL and issues the `whsec_…` secret
   immediately; it does not require the URL to be reachable yet. Likewise
   `wrangler secret put STRIPE_WEBHOOK_SECRET --env <env>` only writes a
   secret to the worker — no live hostname needed.

2. **Testing actual delivery** (Stripe "Send test event" returning `200`,
   real events being processed) — is **GATED behind M.6** for each
   environment. Stripe must be able to reach the URL, which requires:
   - `staging.busseyandbussey.com` (or the apex, for prod) to **resolve
     as a proxied hostname**. For staging this hostname comes into
     existence when the **staging Pages custom domain is attached**
     (§4.3 — that auto-creates the proxied `staging` DNS record), or via
     a manually-added proxied `staging` record. **It does not exist
     yet.**
   - the worker to be **deployed** to that environment with the route
     bound (`wrangler deploy --env <env>`, §6) — only then does the
     `…/api/*` route actually serve.
   - `STRIPE_WEBHOOK_SECRET` installed for that environment (step 5.4 /
     5.5) — otherwise the worker answers `500 webhook_secret_missing`.

   **→ Flagged answer to the sequencing question:** yes — for staging,
   **attach the staging Pages custom domain (M.6) and deploy the staging
   worker before you try to test the webhook endpoint.** You can create
   the Stripe endpoint and install its secret beforehand, but a delivery
   test will fail (host won't resolve / route won't serve) until the
   staging hostname is live and the worker is deployed. The verification
   step (§5.6) is therefore ordered *after* the M.6 staging deploy.

### 5.2 Create the staging endpoint (Stripe **Test mode**)

In the Stripe dashboard, confirm the mode toggle shows **Test mode**,
then:

1. **Developers → Webhooks → Add endpoint** (newer dashboards:
   **Developers → Event destinations → Add destination → Webhook
   endpoint**).
2. **Endpoint URL:** `https://staging.busseyandbussey.com/api/webhooks/stripe`
3. **Select events to send** → choose the five in §5.3 → **Add events**.
4. **Add endpoint** to save.

### 5.3 Events to subscribe (exactly five)

These are the five the handler branches on
(`worker/src/routes/webhooks/stripe.ts`); subscribing to extras is
harmless (the handler returns `{ received: true, handled: false }` for
anything else) but unnecessary, and missing one means that lifecycle
event never reaches us:

| Event | What the worker does with it |
|-------|------------------------------|
| `invoice.payment_succeeded` | Marks the invoice paid; advances billing state. |
| `invoice.payment_failed` | Flags the failed payment; triggers the admin alert path. |
| `customer.subscription.updated` | Syncs the local subscription status projection. |
| `customer.subscription.deleted` | Marks the subscription ended. |
| `payment_method.attached` | Records the attached payment method on the customer. |

### 5.4 Capture + install the staging signing secret

1. On the saved endpoint's page, reveal the **Signing secret**
   (`whsec_…`).
2. Install it on the staging worker (run from `worker/`):
   ```bash
   pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
   # paste the whsec_… value when prompted
   ```
3. Confirm it is present:
   ```bash
   pnpm exec wrangler secret list --env staging
   # expect STRIPE_WEBHOOK_SECRET now alongside the five from §3
   ```

This is the secret that §3 deferred to M.5. After this, staging has all
six worker secrets.

### 5.5 Create the production endpoint (Stripe **Live mode**) — GATED

Identical steps to 5.2–5.4 but with the dashboard in **Live mode** and
the URL `https://busseyandbussey.com/api/webhooks/stripe`. **Gated on
Stripe business activation** (Live mode is unavailable until then — same
blocker as the `sk_live_…` / `pk_live_…` keys in §3). When live mode is
active:

```bash
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET --env production
pnpm exec wrangler secret list --env production
```

Each environment's secret is distinct — the Test-mode `whsec_…` and the
Live-mode `whsec_…` are different values; never cross them.

### 5.6 Verify delivery (AFTER the M.6 staging deploy + staging domain)

Once staging is deployed and `staging.busseyandbussey.com` resolves:

1. Stripe dashboard → the staging endpoint → **Send test event** →
   pick e.g. `invoice.payment_succeeded` → **Send**.
2. Expect an HTTP **200** in the endpoint's delivery log. A **400** means
   the signature didn't verify (wrong or stale secret installed); a
   **500 `webhook_secret_missing`** means the secret isn't installed on
   that environment; a connection error / Cloudflare error page means the
   hostname isn't resolving or the worker route isn't serving yet (go
   back to M.6).
3. Optionally tail the worker while testing:
   `pnpm exec wrangler tail --env staging` (see §8).

Production delivery is verified as part of the M.10 production smoke test
(`stripe trigger …` against the live endpoint), not here.

---

## 6. Deployment commands (M.6) — PLAN (not yet executed)

> **Status: PLAN for review. Nothing here has been run.** No live
> `wrangler deploy` / `wrangler pages deploy` has happened. The order is
> **staging first** (prove the pipeline end-to-end), then production
> (mirror, but gated — §6.7). Build commands below *have* been run
> locally to confirm output structure (a build is not a deploy); the
> deploy commands have not.

### 6.0 Surfaces and naming

| Surface | What | Deploy unit | Name |
|---------|------|-------------|------|
| Worker (API) | chat + admin + portal + Stripe webhook + `/p/:token` | `wrangler deploy --env <env>` | `bussey-bussey-api-staging` / `-production` (already set in `wrangler.toml`) |
| Front end | **one merged Pages project** = site (`/`) + admin (`/admin/`) + portal (`/portal/`) | `wrangler pages deploy <dir>` | proposed: `bussey-bussey-web-staging` / `bussey-bussey-web-production` |

The merged Pages project is the M.4 consequence (Pages binds a whole
hostname to one project — see §4.0 and the deferred-cleanup entry). The
three front-end builds assemble into one directory and deploy together.

### 6.1 Pre-deploy checks (from repo root)

```bash
pnpm -r typecheck      # worker: tsc --noEmit; admin/portal: svelte-check; site: no-op
pnpm -r build          # all three front ends + worker dry-run bundle must succeed
```

Both must be clean before deploying. (`pnpm -r lint` is currently a
stub on every package — not a gate yet.) The worker's own `build`
script is `wrangler deploy --dry-run --outdir=dist`, so `pnpm -r build`
also re-validates the worker bundle.

### 6.2 Build the front ends + assemble the merged deploy directory

**Build-time env vars** (path-based ⇒ same-origin; §4.7, `env-vars.md`):

| Var | Surface | Staging value | Production value |
|-----|---------|---------------|------------------|
| `VITE_API_URL_BASE` | admin | `https://staging.busseyandbussey.com` | `https://busseyandbussey.com` |
| `BUSSEY_API_BASE` | site | `https://staging.busseyandbussey.com` | `https://busseyandbussey.com` |
| (none) | portal | — | — |

> The SPAs' general data-fetching is **relative-path** and needs no base
> var; `VITE_API_URL_BASE` only feeds admin's "Preview presentation"
> button (`/p/:token`), and `BUSSEY_API_BASE` only the site chat widget.

**Build (staging values shown):**

```bash
# from repo root
BUSSEY_API_BASE="https://staging.busseyandbussey.com" pnpm --filter @bussey/site  build   # -> site/_site/
VITE_API_URL_BASE="https://staging.busseyandbussey.com" pnpm --filter @bussey/admin build  # -> admin/build/
pnpm --filter @bussey/portal build                                                          # -> portal/build/
```

**Confirmed output structure** (verified by building 2026-05-23):

```
site/_site/     index.html, about/, services/, industries/, blog/,
                articles/, case-studies/, assets/, demos/, feed.xml, sitemap.xml
admin/build/    index.html + _app/        (assets referenced as /admin/_app/…)
portal/build/   index.html + _app/        (assets referenced as /portal/_app/…)
```

`adapter-static` does **not** nest output under the base path — the files
sit at `build/` root and the in-HTML asset URLs are prefixed `/admin`
(resp. `/portal`). So serving `admin/build/*` **at** `/admin/` makes the
URLs line up. The site's `demos/` is the repo-root `demos/` dir passed
through by Eleventy (`site/.eleventy.js`), which is how `/demos/:token/`
is served same-origin (§4.5).

**Assemble into one deploy dir** (`dist/` is gitignored):

```bash
# from repo root
rm -rf dist && cp -R site/_site dist
mkdir -p dist/admin dist/portal
cp -R admin/build/.  dist/admin/
cp -R portal/build/. dist/portal/
# SPA deep-link fallback for the two sub-path apps (see note below):
printf '/admin/*  /admin/index.html  200\n/portal/* /portal/index.html 200\n' > dist/_redirects
```

Result:

```
dist/
├── index.html, about/, …, assets/, demos/   (site, served at /)
├── _redirects                                (SPA fallback rules)
├── admin/   index.html + _app/               (served at /admin/*)
└── portal/  index.html + _app/               (served at /portal/*)
```

> **Why `_redirects` — and the one thing to VERIFY on the staging deploy.**
> Both SPAs build in fallback (`index.html`) SPA mode, so a deep link like
> `/admin/clients/123` has no prerendered file. Cloudflare Pages serves an
> existing static asset first; a path with **no** matching file falls
> back. But because the merged project has a top-level `index.html` (the
> site) and no top-level `404.html`, Pages' default would fall *all*
> misses back to the **site** root — wrong for the SPAs. The two scoped
> `_redirects` rules send `/admin/*` and `/portal/*` misses to the correct
> shell instead. Existing asset files (`/admin/_app/…`) are served as
> themselves (assets take precedence in normal routing). **Verify on the
> staging deploy (§6.4): (a) `/admin/_app/*.js` returns JavaScript, not
> HTML, and (b) hard-reloading a deep link like `/admin/leads` serves the
> admin shell, not the site homepage or a 404.** If assets are clobbered,
> the fallback fix is to drop a top-level `dist/404.html` and/or narrow
> the rules — but the scoped rules above are the expected-correct form.

### 6.3 STAGING deploy — execution order

1. **Pre-deploy checks** (§6.1) — green.
2. **Build + assemble** with staging env values (§6.2) → `dist/`.
3. **Deploy the merged Pages project.** `wrangler` is installed **only in
   `worker/`** (no root binary), and `wrangler pages deploy` must run from a
   directory with **no Workers `wrangler.toml`** (repo root qualifies; do
   NOT run it from `worker/`, whose toml is a Workers config). Run from repo
   root via the worker's binary, pre-creating the project so the run is
   non-interactive:
   ```bash
   # one-time: create the project, production branch = main (non-interactive)
   ./worker/node_modules/.bin/wrangler pages project create bussey-bussey-web-staging --production-branch main
   # deploy dist as the production deployment of that project
   ./worker/node_modules/.bin/wrangler pages deploy dist --project-name bussey-bussey-web-staging --branch main
   ```
   (Skipping the pre-create makes `pages deploy` prompt to create the
   project + for a production-branch name — answer create=yes, branch=`main`.
   This prints a `*.pages.dev` URL — fine for a first smoke, but the
   same-origin `/api` model only works on the real hostname, so attach the
   custom domain next.)
4. **Attach the staging custom domain** (dashboard, per §4.3): Pages → the
   project → Custom domains → add `staging.busseyandbussey.com`. This
   auto-creates the proxied `staging` DNS record and provisions TLS. Wait
   for the cert to go **Active**.
5. **Deploy the worker to staging** — this is what binds the routes for
   real (the step `--dry-run` could not verify):
   ```bash
   cd worker && pnpm exec wrangler deploy --env staging
   ```
   Confirm the output lists the two routes
   (`staging.busseyandbussey.com/api/*`, `…/p/*`) as published.
6. **Seed the staging bootstrap admin** — required for the `/admin` login
   check. Use the now-`--env`-aware seed script (§6.6):
   ```bash
   cd worker
   node scripts/seed-bootstrap-admin.mjs --env staging --dry-run   # inspect
   node scripts/seed-bootstrap-admin.mjs --env staging             # seed; capture the password
   ```

### 6.4 Post-staging-deploy verification checklist

Run after steps 6.3.1–6.3.5 (and 6.3.6 for the login item):

- [ ] `https://staging.busseyandbussey.com/` loads the **site**.
- [ ] `https://staging.busseyandbussey.com/admin/` loads the **admin SPA**;
      `/admin/_app/*.js` returns JavaScript (not HTML — the `_redirects`
      asset check); a hard-reloaded deep link (e.g. `/admin/leads`) serves
      the admin shell.
- [ ] Admin **login works** against the staging worker (needs the §6.6
      bootstrap admin) — a successful login sets the `bb_admin_session`
      cookie host-only on `staging.busseyandbussey.com` and authenticated
      `/api/admin/*` calls succeed (proves the same-origin relative-`/api`
      model end-to-end).
- [ ] `https://staging.busseyandbussey.com/portal/` loads the **portal SPA**.
- [ ] `/api/*` **reaches the worker** — test an unauthenticated endpoint,
      e.g. create a chat session:
      ```bash
      curl -s -X POST https://staging.busseyandbussey.com/api/chat/session
      # expect a JSON session payload from the worker, not a Pages 404
      ```
- [ ] `/p/:token` serves a presentation. **Seed data required:** there is
      no staging opportunity yet. After admin login (above), create a test
      client → opportunity → proposal through the admin UI to mint a
      `presentation_token`, then open
      `https://staging.busseyandbussey.com/p/<token>` and confirm the
      worker-rendered page + the same-origin `/demos/<token>/` iframe.
      (This overlaps the M.7 smoke-test harness; a throwaway opportunity is
      enough here.)
- [ ] **TLS** is clean (Full (strict)) on the apex/staging host — no cert
      warnings; `curl -sI https://staging.busseyandbussey.com/ | grep -i ^HTTP`
      is `200`.

### 6.5 Staging webhook delivery test

This is the §5.6 gated item, now unblocked by 6.3. Create the Stripe
**Test-mode** endpoint (`§5.2`), install `STRIPE_WEBHOOK_SECRET --env
staging` (`§5.4`), then Stripe dashboard → endpoint → **Send test event**
→ expect **200**. Tail with `pnpm exec wrangler tail --env staging` while
testing.

### 6.6 Bootstrap admin on staging/production — RESOLVED (option b)

`worker/scripts/seed-bootstrap-admin.mjs` was extended (decision: option
b) to seed a **remote** admin, env-aware. It resolves the target D1's
`database_name` from `wrangler.toml` per `--env`, generates a 24-char
random password, bcrypt-hashes at 12 rounds (matches
`worker/src/lib/password.ts`), inserts with a fresh UUID, prints the
plaintext **exactly once** (never to a file/log), and is idempotent per
environment (no-op + message if the email already exists; never rotates).
With no `--env` it keeps the original local-dev behavior unchanged.

Run **from `worker/`**. Inspect first (no wrangler call, no password, no
write), then seed for real:

```bash
# Inspect the exact target + SQL it will run (safe, no side effects):
node scripts/seed-bootstrap-admin.mjs --env staging --dry-run

# Seed the staging admin for real — prints the password ONCE. Capture it.
node scripts/seed-bootstrap-admin.mjs --env staging
#   (equivalently: pnpm --filter @bussey/worker seed:bootstrap-admin -- --env staging)
```

Owner identity defaults to `Micaiah Bussey` / `mrmicaiah@gmail.com`, role
`owner` (override with `--name` / `--email` if ever needed). The remote
`wrangler d1 execute` runs against the database resolved from
`wrangler.toml` (`bussey-bussey-staging` here). This is the M.2-deferred
"production bootstrap admin" path; production uses the same command with
`--env production` (§6.7), which will mint a **separate, fresh** password.

> Inspect mode was verified for `--env staging`, `--env production`, and
> local on 2026-05-23 — it resolves the correct DB name and prints the
> `INSERT … (id, name, email, password_hash, role, active)` shape
> (`created_at` is filled by the column DEFAULT; `last_login_at` NULL).
> The real remote seed has **not** been run — it is step 6.3.6, which you
> run during the staging deploy so you capture the password.

### 6.7 PRODUCTION deploy — mirror of staging, GATED

Same five steps as 6.3 with production values (`busseyandbussey.com`,
`bussey-bussey-web-production`, `wrangler deploy --env production`,
attach the **apex** + `www` custom domains per §4.3). **Do not run until
ALL of these hold:**

> **REBUILD BEFORE ASSEMBLE — non-negotiable (learned the hard way in the
> M.6 staging deploy, 2026-05-24).** The §6.2 assemble step (`cp` of the
> three front-end build outputs into `dist/`) must ALWAYS be preceded by a
> **fresh build of all three front ends with THIS environment's values**.
> Build-time env vars (`BUSSEY_API_BASE` for site, `VITE_API_URL_BASE` for
> admin) are baked into the bundle at build time — a leftover build dir
> from `pnpm -r build` or from a *different* environment will copy the
> WRONG (or `localhost:8787`-fallback) values into `dist/` silently, and
> the structure-only verification will still pass. For production, rebuild
> with the production values **immediately before** assembling:
> ```bash
> BUSSEY_API_BASE="https://busseyandbussey.com"  pnpm --filter @bussey/site  build
> VITE_API_URL_BASE="https://busseyandbussey.com" pnpm --filter @bussey/admin build
> pnpm --filter @bussey/portal build
> # then the §6.2 rm -rf dist && cp ... assemble
> ```
> Then VERIFY the bake before deploying: `grep -rl "busseyandbussey.com"
> dist/admin/_app/` must hit (admin "Preview presentation" URL), and the
> `dist/index.html` chat config must read `apiBase: "https://busseyandbussey.com"`
> — NOT `localhost:8787`. (Staging caught this: a var-less admin build was
> copied into `dist/admin`, leaving the preview button pointed at
> localhost; it passed structure checks and was only caught by an explicit
> value-grep.)

- [ ] **All production worker secrets installed** (`§3`) — currently
      deferred: `ANTHROPIC_API_KEY` (prod key), `STRIPE_SECRET_KEY`
      (`sk_live_…`), `RESEND_API_KEY` (verified `busseyandbussey.com`
      sending domain), `SESSION_SECRET` (fresh), `ADMIN_NOTIFY_EMAILS`,
      and `STRIPE_WEBHOOK_SECRET` (from the prod webhook, §5.5).
- [ ] **Stripe business activation complete** (enables live mode + the
      `sk_live_…` / `pk_live_…` keys + the Live-mode webhook endpoint).
- [ ] **Real `pk_live_…`** pasted into `wrangler.toml`
      `[env.production.vars] STRIPE_PUBLISHABLE_KEY` (replacing the
      `pk_live_REPLACE_…` placeholder).
- [ ] **Production bootstrap admin** seeded (§6.6, with a fresh distinct
      password).
- [ ] **Staging fully verified** (§6.4 + §6.5 all green).
- [ ] **Your explicit go-ahead.**

Production delivery + full chain are verified by the M.10 smoke test
(§7), not by the deploy itself.

### 6.8 Rollback — see §10

Rollback procedure for each surface is in **§10** (filled in as part of
this subtask).

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

## 10. Rollback procedures (M.6)

Each surface rolls back independently. **Code/asset rollbacks are fast
and safe; data (D1) is forward-only.** Always practice a rollback on
staging before you need one on production.

### Worker

Cloudflare retains prior Worker deployments. To revert the code:

```bash
cd worker
pnpm exec wrangler deployments list --env <env>      # find the prior good deployment ID
pnpm exec wrangler rollback [<deployment-id>] --env <env>
```

`rollback` re-points the live Worker at a previous **uploaded version**
(code + the bindings/vars/routes that shipped with it). It does **not**
undo a D1 migration and does **not** restore a deleted secret. If the bad
change was a secret/var (not code), fix that directly (`wrangler secret
put` / edit `wrangler.toml` + redeploy) rather than rolling back.
Alternative (git-based): `git checkout <good-sha> -- worker && cd worker
&& pnpm exec wrangler deploy --env <env>`.

### Front end (merged Pages project — site + admin + portal)

Because the three front ends share one Pages project (§6.0), they roll
back **together** as one unit:

- **Dashboard (fastest):** Pages → the project → **Deployments** → pick
  the previous successful deployment → **Rollback to this deployment**.
  Instant, no rebuild.
- **Re-deploy a known-good build:** rebuild from a good git SHA and
  `pnpm exec wrangler pages deploy dist --project-name <name>` again.

There is no per-surface (admin-only / site-only) front-end rollback under
this layout — that tradeoff is the deferred-cleanup "one Pages deploy"
entry. Custom-domain attachment is independent of deployments, so a
rollback does not detach `staging.busseyandbussey.com` / the apex.

### D1 (database) — forward-only

Migrations are **not** reversible by rollback. To undo a schema change,
write a **counter-migration** forward (the §2 discipline). For bad *data*
(e.g. a botched bulk write), use D1 **Time Travel** point-in-time restore
(see §9 once filled in):

```bash
pnpm exec wrangler d1 time-travel restore <db-name> --env <env> --timestamp <ISO8601>
```

within the retention window. Treat this as a break-glass action — it
restores the whole database to that instant, losing writes since.

### R2 / KV

- **R2** (`FILES`): objects are addressed by key; a bad regenerated PDF is
  fixed by re-`put`-ting the correct object (or restoring from a copy).
  No deploy-level rollback concept.
- **KV** (`SESSIONS`): ephemeral by design (session/token mirror). Nothing
  to roll back; at worst, clearing it forces re-login.

### Order when rolling back a coupled change

If a bad release spanned worker + front end, roll back the **front end
first** (instant, removes the broken UI), then the worker. If a D1
migration is implicated, do **not** deploy further — assess whether a
counter-migration or Time Travel restore is needed before re-deploying
anything.

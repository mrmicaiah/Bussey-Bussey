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

> **Status:** M.1, M.2, M.3 complete (all secrets installed + verified).
> M.4 (domain + DNS) documented below — topology decided (path-based),
> wrangler.toml URL bases + commented routes updated; the DNS changes
> themselves are the user's to make in the Cloudflare dashboard.
> Sections 5 onward are skeleton headings for later subtasks (M.5 → M.10).

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

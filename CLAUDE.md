# Bussey-Bussey

Bound to Studio87 on 2026-05-19.

## Project intent

_Describe what this project is for. The manager will update this section as understanding develops._

## Current focus

**Step M in progress — production readiness.** Scope in
`context/step-M-scope.md`. Tracked as 10 subtasks (M.1 → M.10) with
review after each. Sister doc `context/deployment-runbook.md` is being
built up section by section as each subtask completes. M.1–M.4 done
(topology approved, zone Active, routes live); M.5 documented (user-side
dashboard + secret install pending); M.6 staging deploy DONE + verified
on `staging.busseyandbussey.com` and now git-connected (push-to-`main`
auto-deploys the staging front end); the production mirror stays gated.

**M.1 done and reviewed.** `[env.staging]` and `[env.production]`
blocks added to `worker/wrangler.toml` with `REPLACE_WITH_*` ID
placeholders. Both `wrangler deploy --dry-run --env staging` and
`--env production` validate cleanly. `context/deployment-runbook.md`
created with section 1 filled in (sections 2-10 are skeletons for
later subtasks).

**M.2 done.** Migrations 0001–0008 applied to both remote D1s
(staging `f6c991cc-…`, production `aac8980f-…`). Both verified
post-apply: 26 application tables, 25 pricing_components rows,
`lead.source` enum carries `calling_list`, `admin_user` empty, all
new K2/L columns present. Pricing-components seed = migration 0002
(`INSERT OR IGNORE`); no separate 0009 needed. Production bootstrap
admin intentionally not seeded — deferred to M.3 or M.10 prep.

**M.3 done (Claude side).** Five worker URL hardcodes + 1 admin-frontend
URL migrated to `env.ADMIN_URL_BASE` / `env.PORTAL_URL_BASE` /
`import.meta.env.VITE_API_URL_BASE` with sensible local-dev fallbacks.
Fixed a latent port-5173-vs-5174 bug as a side effect (three of the
constants pointed at admin's port where they should have pointed at
portal's). `worker/wrangler.toml` gained `[env.staging.vars]` +
`[env.production.vars]` blocks. `context/env-vars.md` is the new
inventory doc; deployment-runbook section 3 is filled in with the
`wrangler secret put` commands for staging (user-installs) and the
deferred-list for production. Three resolved deferred-cleanup entries
pruned (Portal URL, new-lead admin URL, Preview Presentation URL).

**M.3.5 amendment.** `ADMIN_NOTIFY_EMAILS` reclassified as a
*transitional* SECRET because business email isn't set up at
`busseyandbussey.com` yet — the value is a personal address.
`wrangler.toml` carries placeholder `REPLACE_WITH_ADMIN_EMAIL` in both
env blocks (shadowed by the secret at runtime). New deferred-cleanup
entry tracks the move back to PUBLIC `[vars]` once business email
exists.

**M.3 fully closed.** All 5 staging secrets installed + verified,
staging publishable key set, commits pushed, tree clean (user-confirmed).

**M.4 done (Claude side — topology review pending).** Host topology
decided: **PATH-BASED** (single origin). Everything serves under
`busseyandbussey.com` — site at `/`, admin at `/admin/`, portal at
`/portal/`, worker on `/api/*` and `/p/*`. The decision is forced by
the as-built code: both SPAs fetch the API with relative `/api` paths +
`credentials:'include'`, session cookies are host-only `SameSite=Strict`
(no `Domain=`), and authed routes have no CORS-with-credentials — i.e.
the stack only works same-origin. Path-based keeps that with ZERO
auth/CORS/cookie code change and mirrors dev; a subdomain split would
force a CORS + cross-subdomain-cookie refactor (or worker-routes on every
subdomain). The one cost — Pages binds a whole hostname to one project,
so the three front-end builds merge into one Pages deploy — is logged in
`notes/deferred-cleanup.md` (revisit independent deploys post-v1).
`worker/wrangler.toml`: `[env.*.vars]` URL bases rewritten to path-based
same-origin values (dry-run clean both envs); commented `routes` blocks
added for `/api/*` + `/p/*` per env (uncomment once the zone is Active —
they'd fail a deploy otherwise). `context/deployment-runbook.md` §4
filled in record-by-record; `context/env-vars.md` URL-base entries
updated. Downstream: Stripe webhook URL for M.5 is
`https://busseyandbussey.com/api/webhooks/stripe` (supersedes the
`api.` guess in scope). DNS changes themselves are user-side (M-human).

**Zone Active + routes live (2026-05-23).** User confirmed
`busseyandbussey.com` is an Active Cloudflare zone. The four worker
`routes` blocks in `wrangler.toml` (prod `…/api/*` + `/p/*`, staging
`staging.…/api/*` + `/p/*`) are uncommented; both envs dry-run clean.
Production routes are config-active but the prod *deploy* stays gated
(secrets + pk_live_ + M.6 review).

**M.5 done (doc; user-side execution pending).** Worker side was already
built — `POST /api/webhooks/stripe`, public, signature-verified against
`STRIPE_WEBHOOK_SECRET`, **no dev bypass** (500 if secret missing, 400 on
bad signature); handler branches on exactly the five scope events (verified
against `worker/src/routes/webhooks/stripe.ts`). Runbook §5 documents: one
endpoint per env (staging Test-mode → `https://staging.busseyandbussey.com/
api/webhooks/stripe`, production Live-mode → `https://busseyandbussey.com/
api/webhooks/stripe`), the five events, and `wrangler secret put
STRIPE_WEBHOOK_SECRET --env <env>` (this is the secret §3 deferred).
**Sequencing flagged:** the Stripe endpoint can be created + its secret
installed now, but staging *delivery testing* is gated behind the M.6
staging deploy + the staging Pages custom-domain attach (the
`staging.busseyandbussey.com` hostname doesn't exist until then).
Dashboard config + secret install are M-human (needs the Stripe account).

**M.6 deploy PLAN written (not executed).** Runbook §6 is a staging-first
plan; §10 is per-surface rollback. Verified locally (build ≠ deploy):
all three front ends build clean, and `adapter-static` output assembles
into one merged Pages dir — `site/_site/*` → root, `admin/build/*` →
`/admin/`, `portal/build/*` → `/portal/` (SPA asset URLs are prefixed
`/admin`,`/portal`, so they line up when served at those paths). Plan
covers: pre-deploy checks, build-time env vars (same-origin), the merge +
a `dist/_redirects` for sub-path SPA deep-link fallback (flagged as the
one Pages-serving behavior to verify on the staging deploy), the staging
deploy order (Pages deploy → attach `staging.busseyandbussey.com` → worker
`deploy --env staging` binds the routes for real → seed admin → verify →
webhook test), and the gated production mirror. **§6.6 bootstrap-admin gap RESOLVED (option
b):** `seed-bootstrap-admin.mjs` extended to take `--env
staging|production` (resolves the remote D1 name from `wrangler.toml`,
runs `--remote`), `--name`/`--email` overrides, idempotent per env,
bcrypt-12 (matches `worker/src/lib/password.ts`), prints the password
once, plus a `--dry-run` inspect mode. Inspect-verified for staging /
production / local on 2026-05-23; the real remote seed is step 6.3.6 of
the staging sequence (user runs it to capture the password). Deferred-
cleanup entry slimmed to residual polish (no audit_log row; not an
interactive CLI). Nothing deployed; holding for review + go-ahead.

**M.6 staging deploy DONE + git-connected (2026-05-24).** The staging
front end is live and verified on the real hostname
`staging.busseyandbussey.com`: `/admin/leads` → `Bussey · Admin`,
`/portal/billing/<id>` → `Bussey · Client Portal`, `/zzz` → site 404,
`/api/chat/session` → 201. (The worker's zone-level routes survived the
Pages-project swap, as expected — routes are independent of which Pages
project owns the hostname.) Staging is now served by a **NEW git-connected
Pages project `bussey-bussey-staging`** — Cloudflare can't convert a
Direct-Upload project to Git, so a fresh project was required; build
command `pnpm run build:pages` (`scripts/build-pages.sh`), output `dist/`.
`staging.busseyandbussey.com` was cut over from the old Direct-Upload
project `bussey-bussey-web-staging` to the new one, so **a push to `main`
now auto-deploys the staging front end.** The old `bussey-bussey-web-staging`
project is now **vestigial** (no domain, not deployed to; keep-or-delete
logged in `notes/deferred-cleanup.md` — recommend deleting once the
git-connected path has proven out). **The worker (`bussey-bussey-api-staging`)
still deploys MANUALLY** via `wrangler deploy --env staging` — git-connect
builds the front end ONLY, so a worker-code change still needs the manual
deploy. The manual `wrangler pages deploy` fallback now retargets
`--project-name bussey-bussey-staging`. Production remains fully gated
(runbook §6.7). **New reality: a push to `main` is now a live staging
deploy — flag what a push will ship before pushing.**

**v1 build structurally complete.** Step L (calling list) built and
smoke-tested green; scope in `context/step-L-scope.md`, results in
`context/step-L-smoke-test.md`.

Full chain verified end-to-end with a real round-trip query through
migration 0008: a calling_list_item created via L's smoke test →
converted to a `lead` (`source='calling_list'`) via the
convert-to-lead path → converted to a `client` via
`POST /api/admin/clients` with `origin_lead_id`. The verification
JOIN

```
SELECT client.company_name, lead.name, lead.source
  FROM client JOIN lead ON client.origin_lead_id = lead.id
 WHERE lead.source = 'calling_list';
```

returns `First Choice Care | Lin Tran | calling_list` with all fields
populated. The full pipeline (calling_list_item → lead → client →
opportunity → proposal → presentation → disposition → activation →
portal → change orders → billing) is intact end-to-end.

**Step L highlights.** Migration 0008 expanded `lead.source` to
include `'calling_list'` (table-rebuild around the inbound FK from
`client.origin_lead_id`; verified above that the rebuild preserved
the FK behavior). Backend: `worker/src/services/csv.ts` (hand-rolled
parser) + 8 admin endpoints in `worker/src/routes/admin/calling-list.ts`.
Duplicate detection runs against BOTH `calling_list_item` and `lead`
rows. Import audit row records summary stats only — uploaded content
never reaches `audit_log.changes`. Frontend: admin "Calling list" nav
item + three new pages (`/today`, `/`, `/import`) + shared
`LogCallModal`. All three packages typecheck clean.

`notes/deferred-cleanup.md` (33 entries, ~380 lines) now has a
top-of-file TOC indexed two ways: by urgency-to-revisit (before-first-
real-client, before-first-production-traffic, second-admin,
feature-need, future-data-shape) and by step-decided-in (B → L).
Maintenance hygiene as the file continues to grow.

Step M (real-world readiness — lawyer review, real Stripe/Resend
keys, real email copy, deploy topology, production hosting) is the
remaining work and is mostly external. Awaiting your scope.

## Conventions

- **Step scope persistence.** Every step's scope is persisted to `context/step-X-scope.md` as soon as it is approved. The chat is for conversation; the repo is for durable instructions. When a new step is scoped in a session, the first action of that session (or the next session, if scoping happened mid-session) is to write the scope to `context/`.
- **Deferred-cleanup tracking.** Items intentionally deferred during a build go into `notes/deferred-cleanup.md` with what / why / when-to-revisit / which-step-decided. New entries are added at the top.

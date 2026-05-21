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

> **Status:** M.1 complete. Sections 2 onward are skeleton headings;
> later subtasks (M.2 → M.10) fill in their respective sections.

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

_To be filled in by M.2._

Outline of what goes here:

- `wrangler d1 migrations apply bussey-bussey-production --remote`
- Schema state verification queries (`PRAGMA table_info`, row counts,
  enum CHECK constraint readback for `lead.source`)
- How to reapply if a migration fails mid-stream

---

## 3. Secrets and environment variables (M.3)

_To be filled in by M.3._

Outline:

- Inventory of every env var the worker reads (see
  `context/env-vars.md`)
- Per-secret `wrangler secret put` invocations for staging + production
- Public env vars set via `[vars]` in `wrangler.toml` (e.g. `ENV`,
  `DEMO_URL_BASE`, `PORTAL_URL_BASE`, `ADMIN_URL_BASE`)
- Verification: `wrangler secret list --env production`

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

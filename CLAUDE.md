# Bussey-Bussey

Bound to Studio87 on 2026-05-19.

## Project intent

_Describe what this project is for. The manager will update this section as understanding develops._

## Current focus

**Step M in progress — production readiness.** Scope in
`context/step-M-scope.md`. Tracked as 10 subtasks (M.1 → M.10) with
review after each. Sister doc `context/deployment-runbook.md` is being
built up section by section as each subtask completes.

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
Remaining M.3 work is user-side: paste staging Stripe `pk_test_…` into
`wrangler.toml`, install 4 staging secrets via `wrangler secret put`,
verify via `wrangler secret list --env staging`.

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

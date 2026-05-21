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

**M.2 queued, blocked on resource creation.** User is running the six
`wrangler ... create` commands themselves and will paste the returned
IDs into `wrangler.toml`. Once that lands, M.2 applies migrations
0001-0008 to both staging and production D1.

Two scope refinements captured in `context/step-M-scope.md` after
sanity-checking against the current local D1:
- The "25 tables" target was off — the actual post-migration-0008
  table count is **26** (K2's `change_request` brought it from 25
  to 26). Full list captured in the scope.
- The pricing-components seed is migration 0002 (`INSERT OR IGNORE`),
  not a separate CSV-apply step — runs automatically as part of the
  0001-0008 sequence. The 25-row seed count is verifiable as a
  separate check.

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

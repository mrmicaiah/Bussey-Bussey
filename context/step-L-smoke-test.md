# Step L — Smoke Test Results (2026-05-21)

Calling list verified end-to-end against the running wrangler dev +
local D1. Same harness as previous smoke tests; full plaintext-leak
audit applied to the CSV-import path as called out in the L scope.
All three packages typecheck clean: worker `tsc` OK, admin
`svelte-check` 0 errors / 0 warnings (311 files), portal
`svelte-check` 0 errors / 0 warnings (358 files).

## Pre-L

- Updated the notification-prefs deferred-cleanup entry with the
  complete `sendEmail` callsite map (8 files, gated/not-gated noted
  per file) plus a pointer at where to add a future
  `respectClientPref` helper in `worker/src/services/email.ts`.
- Migration 0008 expands `lead.source` CHECK enum to include
  `'calling_list'` via table-rebuild (`PRAGMA foreign_keys = OFF`,
  CREATE new, INSERT … SELECT, DROP, RENAME, recreate indexes,
  `PRAGMA foreign_keys = ON`). The inbound FK from
  `client.origin_lead_id` reattaches automatically because the new
  table is named `lead`. Existing lead rows preserved unchanged.

## What's verified

### Backend

- `POST /api/admin/calling-list/import?mode=skip|update|create_anyway`
  — raw CSV body, 5 MB / 5000 row guards. Required columns enforced
  (company_name + call_date + (contact_email OR contact_phone)).
  Per-row validation; errors collected without aborting the rest.
  Duplicate detection runs against **both** `calling_list_item` and
  `lead` (matched by company + email-or-phone). Extra columns →
  `extra_data` JSON.
- `GET /today` — returns today's pending cards + progress
  (`remaining`, `completed`, `total`).
- `GET /` — filterable history (status, from, to, industry, q).
- `GET /stats` — today/this-week/all-time counts + leads-converted +
  clients-from-calling-list (via JOIN `client → lead`).
- `POST /:id/log` — writes `calling_log`, advances status per
  outcome+next_action, optionally creates a `lead` with
  `source='calling_list'` and prefilled notes + sets
  `calling_list_item.converted_lead_id`. Audit cascade: umbrella
  `calling_list_item.call_logged` + per-entity
  `lead.create.from_calling_list` + `calling_list_item.converted` on
  conversions.
- `POST /:id/reschedule` — updates call_date, resets status to
  pending.
- `POST /:id/disqualify` — soft-delete via `status='disqualified'`.
- `POST /bulk-reschedule` — bulk update with `ids_requested` /
  `ids_updated` reported back.

### Frontend

- Admin header now includes a "Calling list" nav item pointing at
  `/admin/calling-list/today`.
- `/admin/calling-list/today` — progress card + per-card surface
  with tel:/mailto: links, Log call / Reschedule / Disqualify
  buttons, shared `LogCallModal`.
- `/admin/calling-list` — filterable history table, multi-select +
  bulk reschedule, inline Log call from any row.
- `/admin/calling-list/import` — file picker + paste-area + mode
  dropdown + post-import summary with per-row errors and skipped
  reasons. The post-import grid surfaces created/updated/skipped/
  errors counts and links onward to today's cards.
- `LogCallModal` — shared component used by both today's and history
  views. Outcome enum, notes, next-action (done / reschedule /
  convert_to_lead) with conditional date input.

### Smoke test run (per the L scope's checklist)

1. **CSV upload (10 rows, 2 duplicates, 1 invalid).** Crafted CSV
   includes 2 rows whose `(company, email)` matches existing leads
   from earlier smoke tests (Jane Doe @ Acme Home Care and Test
   Prospect @ Acme Home Care). One row has an empty `company_name`.
   Import result: `{ total_rows: 10, created: 7, updated: 0,
   skipped: 2, errors: 1 }`. Skip messages identify both as
   "duplicate of existing lead (skip mode)" with the matching lead's
   id. Error row reported with reason "company_name is empty".
2. **Today view.** Returns 5 cards (the rows with call_date =
   2026-05-21), progress `{remaining:5, completed:0, total:5}`,
   sorted by company_name COLLATE NOCASE.
3. **Log call (no_answer).** Bayview Hospice → outcome `no_answer`,
   next_action `done`. Response status `no_answer`. `calling_log`
   row written with the typed notes. `calling_list_item.status` =
   `no_answer`. Audit umbrella `calling_list_item.call_logged`.
4. **Log call + convert_to_lead.** First Choice Care → outcome
   `spoke_qualified`, next_action `convert_to_lead`. Response
   includes a new `converted_lead_id`. Lead row created:
   `source='calling_list'`, `status='contacted'`, name/email/phone/
   company/industry copied, `notes` prefilled with "Converted from
   calling list on 2026-05-21.\nOutcome: spoke_qualified.\nCall
   notes: …". `calling_list_item.status='converted_to_lead'` with
   `converted_lead_id` set. Audit cascade observed:
   `calling_list_item.call_logged` + `lead.create.from_calling_list`
   + `calling_list_item.converted`.
5. **Reschedule.** HomeStrong → call_date 2026-05-28. Today view
   re-rendered with 4 cards (one less). Filterable history under
   `status=pending` lists it at the new date.
6. **Filters.** `?status=pending` → 5 cards across two dates;
   `?industry=Hospice` → 3 cards (DignityFirst, RestEasy, Bayview);
   `?q=Sunrise` → 1 (Sunrise Senior Care).
7. **Bulk reschedule.** 3 cards moved to 2026-05-29 (`{updated: 3}`
   in response). D1 confirms the new call_date.
8. **Stats dashboard.** today `{remaining:2, completed:2, total:4}`;
   this_week `{worked:2, converted_to_leads:1}`; all_time
   `{total_cards:7, converted_to_leads:1, converted_to_clients:0}`.
9. **Plaintext password leak check.** CSV included a row with notes
   containing `"Note: their old password was Abc123!XYZ DO NOT
   STORE"`. The string IS present in `calling_list_item.notes`
   (legitimate — uploaded notes are stored), but absent from
   `audit_log.changes` (count 0). The import audit row records
   summary stats only (mode, totals, created/updated/skipped/error
   counts) — never row content. Confirmed by direct SQL
   comparison.
10. **audit_log clean.** 7 rows across the L run:
    `calling_list.imported`, `calling_list_item.call_logged` ×2,
    `lead.create.from_calling_list`,
    `calling_list_item.converted`, `calling_list_item.rescheduled`,
    `calling_list.bulk_rescheduled`. All actor_type='admin_user'
    with the smoke admin's id.

## State left in local D1

- 7 calling_list_item rows created in this run plus 2 lead-source
  duplicates correctly skipped. 1 row converted to lead → new lead
  row sourced `'calling_list'`.
- Subsequent state: 2 cards at status `pending` for today, 1 at
  `no_answer` for today, 1 at `converted_to_lead`, 3 rescheduled to
  2026-05-29, 1 rescheduled to 2026-05-28. Safe to leave or wipe.

## Out of scope (documented in L scope)

- Auto-dialer, call recording, SMS, team assignment, AI scoring,
  email blasts — all noted out of scope.

## Cleanup

- The wrangler dev process is still running.
- `/tmp/bb-l-test.csv` written for the smoke test; safe to delete.

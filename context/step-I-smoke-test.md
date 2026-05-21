# Step I — Smoke Test Runbook

The verification pass for step I (activation flow). Runs end-to-end through
the admin UI since that's how the flow actually fires.

**Status:** Executed 2026-05-20 against local D1 / wrangler dev via the
admin API (curl instead of browser, but exercising the same endpoints
the UI calls). Two test activations performed end-to-end. One finding
surfaced during the run (per-entity audit rows missing) and was fixed
in `worker/src/services/activation.ts` — each activation now emits five
audit rows (`opportunity.activated`, `proposal.status_change`,
`project.create`, `contract.create`, `portal_account.create`). The
presentation-notes editability ambiguity was resolved by implementing
PUT `/api/admin/projects/:id` for the four administrative fields
(`presentation_notes`, `build_status_note`, `current_phase`,
`next_milestone`); `proposal.presentation_notes` stays frozen at
acceptance, project record carries the living edits. See "Results —
2026-05-20" at the bottom of this file.

## What's already verified

The following were checked during the build and don't need re-running:

- TypeScript: both `worker` and `admin` packages typecheck cleanly.
- Wrangler dry-run build: worker bundles successfully (204 KB) with the
  `/templates/contract/master.md` text import wired up via `[[rules]]`.
- Renderer regex sanity-check: against the actual template, all 11
  `{{variable_name}}` placeholders substitute, all 8 marker placeholders
  (`{{sig:...}}` / `{{print:...}}` / `{{initial:...}}` / `{{date:...}}`)
  pass through untouched, and the leading HTML comment block is stripped.
- Migration 0004 applied to local D1; `portal_account.credentials_issued_at`
  column present.

## Setup

1. `cd worker && pnpm dev` (Wrangler dev, serves on `:8787`).
2. `cd admin && pnpm dev` (SvelteKit, serves on `:5173`).
3. Apply latest migrations to local D1 if not done: 
   `cd worker && npx wrangler d1 migrations apply bussey-bussey --local`.
4. If you don't have an admin user yet:
   `cd worker && node scripts/seed-bootstrap-admin.mjs` — copy the printed
   password into your password manager.

## Acceptance path (happy case)

1. Log into admin at `http://localhost:5173/admin`.
2. Create or pick a client with `billing_address` and `primary_contact_email`
   set (activation will refuse without these).
3. Create an opportunity under that client.
4. Build a proposal (calculator at the opportunity's `/proposal` page).
   Make sure `presentation_notes` has some content so you can verify the
   snapshot copy later.
5. (Optional) Present the proposal at `/p/:token/` — this flips proposal
   status to `sent`. The activation flow also accepts `draft` proposals.
6. From the opportunity detail page, click **🟢 Accepted** in the
   disposition section.
7. In the modal, click **Confirm**. You should see the credentials handoff
   modal appear with portal URL, email, and a 16-char temp password.

### Verify in D1

```sql
-- Replace :opp_id with the opportunity's id.
SELECT id, status, accepted_at FROM opportunity WHERE id = ':opp_id';
-- Expect: status='accepted', accepted_at non-null.

SELECT id, status, accepted_at, updated_at FROM proposal WHERE opportunity_id = ':opp_id';
-- Expect: status='accepted', accepted_at non-null, updated_at non-null.

SELECT c.status FROM client c
  JOIN opportunity o ON o.client_id = c.id
  WHERE o.id = ':opp_id';
-- Expect: status='active'.

SELECT id, name, status, presentation_notes, created_at FROM project
  WHERE opportunity_id = ':opp_id';
-- Expect: status='kickoff', presentation_notes matches the proposal's at
-- the moment of acceptance, created_at non-null.

SELECT id, opportunity_id, template_version, generated_at, signed_at,
       length(body_source) AS src_len, length(body_html) AS body_len
  FROM contract WHERE opportunity_id = ':opp_id';
-- Expect: template_version='v0.1-starter', signed_at NULL, body_html is
-- the rendered markdown (HTML comments stripped, variables substituted,
-- markers still present).

SELECT id, client_id, email, must_change_password, walkthrough_state,
       walkthrough_completed, credentials_issued_at
  FROM portal_account
  WHERE client_id = (SELECT client_id FROM opportunity WHERE id = ':opp_id');
-- Expect: must_change_password=1, walkthrough_state='new',
-- walkthrough_completed=0, credentials_issued_at non-null.

SELECT action, changes, ip_address FROM audit_log
  WHERE entity_id = ':opp_id' AND action = 'opportunity.activated';
-- Expect: one row. `changes` JSON includes project_id, contract_id,
-- portal_account_id, proposal_id, template_version. NO plaintext password.
```

### Verify the rendered contract

```sql
SELECT body_html FROM contract WHERE opportunity_id = ':opp_id';
```

Open the result. Confirm:

- No `<!--` blocks remain.
- `{{sig:client_name}}` and the other markers are still present
  (verbatim — the walkthrough renderer will replace them in step J).
- Variables are substituted: effective date shows the activation date,
  setup/monthly amounts are formatted as USD, client name + address are
  filled in, narrative_solution and key_capabilities (bulleted) appear.

## Credentials handoff actions

After the credentials modal appears:

- **Copy All** — clipboard should contain three lines: Portal / Email /
  Password block.
- Click **Copy** next to any individual row — clipboard contains just that
  value with a confirmation flash.
- **Email to Client** — if `RESEND_API_KEY` is the dev placeholder
  (`re_replace_me`), the `notification` table should show a `queued` row
  with the activation email payload. If a real key is set, the email
  actually sends.
- **Done — I'll share manually** — dismisses the modal.

```sql
SELECT id, kind, recipient, status, error, sent_at
  FROM notification ORDER BY id DESC LIMIT 5;
-- Expect: latest row is kind='activation_credentials' with the right recipient.
```

## Re-display within 24h

1. Reload the opportunity detail page. The **Activation** panel should
   show "Show credentials" with the issued-at timestamp.
2. Click **Show credentials**. The handoff modal re-opens with the same
   temp password (read from KV).
3. Verify in the worker: GET to `/api/admin/opportunities/:id/credentials`
   returns `available: true` with the credentials block.

## After 24h (forced expiry test)

To simulate expiry without waiting 24h:

```bash
cd worker
# Wipe the KV cache:
npx wrangler kv key delete --binding=SESSIONS --local "temp_password:<portal_account_id>"
# Backdate the timestamp:
npx wrangler d1 execute bussey-bussey --local --command \
  "UPDATE portal_account SET credentials_issued_at = '2026-01-01T00:00:00.000Z' WHERE id = '<portal_account_id>';"
```

Reload the opportunity detail page:

- Activation panel shows "Reset and share new credentials" (no "Show"
  button).
- Click reset. New credentials modal appears with a fresh temp password.
- `portal_account.credentials_issued_at` bumped to now, KV holds the new
  plaintext, `audit_log` has a `portal_account.credentials_reset` row.

## Pending Activation surfacing

1. Navigate to the admin dashboard (`/admin`).
2. The accepted-but-not-walked-through opportunity should appear under
   **Pending activation** with state pill "Credentials issued."
3. To force the time-warp alert states, backdate `accepted_at`:
   ```bash
   npx wrangler d1 execute bussey-bussey --local --command \
     "UPDATE opportunity SET accepted_at = '2026-05-12T00:00:00.000Z' WHERE id = '<opp_id>';"
   ```
   Reload dashboard — "7+ days" escalate badge with red border-left.
4. Try 4 days ago for the warn state (orange border, "3+ days" badge).

## Three-tier editability (regression from G1)

On the now-accepted proposal:

- `PUT /api/admin/proposals/:id` with a scope/pricing field should return
  409 `proposal_accepted_immutable_scope`.
- Line-item add/update/delete should return 409.
- Opportunity DELETE should return refused (already the case from G1).
- Administrative fields (e.g., proposal `notes`, `presentation_notes`)
  remain editable per the three-tier model. If editing
  `proposal.presentation_notes` now and comparing against
  `project.presentation_notes`, they should diverge — confirming the
  snapshot copy.

## Clone of accepted proposal

From the proposal page (accepted state), trigger clone. Per G1's
clone-from-accepted rules:

- A NEW opportunity is created under the SAME client (not a new client).
- The source opportunity stays at status `accepted`.
- The new proposal is `draft` and links via `cloned_from_proposal_id`.

## Failure modes worth poking

- Activate an opportunity whose client has no `primary_contact_email`:
  expect 409 `client_missing_contact_email`.
- Activate twice (POST `/activate` while the first is in flight or after):
  expect 409 `opportunity_already_activated` on the second call.
- POST `/api/admin/opportunities/:id/disposition` with `kind=accepted`:
  expect 400 `use_activate_endpoint`.
- Activate without auth: expect 401.

---

## Results — 2026-05-20

### Setup

- Wrangler dev on `localhost:8787`, local D1 + KV.
- Test admin user `smoke+test@bussey.local` (kept separate from the
  bootstrap admin to avoid disturbing the user's stored password).
- Two activations executed against fresh client/opportunity/proposal sets.

### Per-step results

1. **Activation cascade.** All atomic. Verified via SQL on the local D1:
   - `opportunity.status='accepted'`, `accepted_at` set.
   - `proposal.status='accepted'`, `accepted_at` set, `updated_at` bumped.
   - `client.status='active'`.
   - `project` row created with `status='kickoff'`,
     `presentation_notes` matching the proposal's at activation time.
   - `contract` row: `template_version='v0.1-starter'`, `signed_at` null,
     `body_html` 7073 chars. Render checks: 0 HTML comments remaining,
     4 `{{initial:...}}` + 1 `{{sig:...}}` + 1 `{{print:...}}` + 1
     `{{date:...}}` markers preserved, 0 unsubstituted `{{var}}`
     placeholders, `$2,500` / `$1,000` formatted correctly, client name
     and address rendered, narrative + bulleted key capabilities present.
   - `portal_account`: `password_hash` bcrypt (`$2b$`, 60 chars),
     `must_change_password=1`, `walkthrough_state='new'`,
     `walkthrough_completed=0`, `credentials_issued_at` set.

2. **Audit log.** After fix (see "Findings"), one activation emits 5 rows:
   `opportunity.activated`, `proposal.status_change` (from→to),
   `project.create`, `contract.create`, `portal_account.create`.
   Plaintext-password leak check on `audit_log.changes`: **0 hits**.

3. **Credentials handoff.** Activation response contains
   `portal_url + email + temp_password`. Temp password format: 16 chars
   from the unambiguous alphabet (no 0/1/O/I/l).

4. **Re-display window.**
   - GET `/credentials` within window → `available:true` with the cached
     plaintext (matches the activation response).
   - After backdating `credentials_issued_at` and wiping KV → GET returns
     `available:false, reason:'expired'`.

5. **Reset.** POST `/reset-credentials` issues a fresh 16-char password,
   bumps `credentials_issued_at`, replaces `password_hash`, overwrites the
   KV entry, writes a `portal_account.credentials_reset` audit row
   (without plaintext). Subsequent GET `/credentials` returns the new
   password. Old plaintext is irrecoverable.

6. **Send-credentials-email.** With placeholder `RESEND_API_KEY`, POST
   `/send-credentials-email` returns `{ok:true}`, writes a `notification`
   row (`kind='activation_credentials'`, `status='queued'`,
   `error='dev_placeholder_key_not_sent'`), and an
   `opportunity.credentials_email_sent` audit row. The notification body
   *does* contain the plaintext (it's the email content); the audit row
   does not.

7. **Pending Activation list.** GET `/api/admin/pending-activations`
   returns the accepted opportunity with `walkthrough_state='new'` and
   non-null `accepted_at`. Dashboard rendering of alert levels untested
   here (UI-side computation against `accepted_at`).

8. **Three-tier editability.**
   - PUT proposal with modifiers → 409 `proposal_accepted_immutable_scope`.
   - POST line-item → 409 `proposal_not_editable`.
   - PUT proposal with `presentation_notes` only → 409 (intentional:
     `proposal.presentation_notes` is frozen at acceptance and is the
     immutable snapshot record; the project record is the living
     document).
   - PUT `/api/admin/projects/:id` with `presentation_notes`,
     `build_status_note`, `current_phase`, `next_milestone` → 200, row
     updated, `project.update` audit row written with full from/to diff.
     Disallowed fields (`status`, `name`, etc.) → 400
     `fields_not_editable` with the offending keys listed.
   - Snapshot integrity verified end-to-end: edits to
     `project.presentation_notes` (via PUT and via direct D1) leave
     `proposal.presentation_notes` untouched at its acceptance-time
     snapshot value.

9. **Clone of accepted proposal.** POST `/proposals/:id/clone` creates a
   new opportunity under the *same* client (status `open`), and a new
   proposal in `draft` with `cloned_from_proposal_id` pointing back to
   the source. Source proposal stays `accepted`.

10. **Audit breakdown.** Confirmed five distinct rows per activation (see
    item 2). No plaintext anywhere in `audit_log`.

### Findings

1. **FIXED — Per-entity audit rows.** Initial run emitted only the
   `opportunity.activated` umbrella row; smoke-test step 10 expects
   per-entity rows so each created entity has history queryable by its
   own `entity_id`. Added an `auditInsert` helper in
   `worker/src/services/activation.ts` and four additional rows
   (`proposal.status_change`, `project.create`, `contract.create`,
   `portal_account.create`) to the batch. Verified on second activation:
   all five rows present, no plaintext.

### Cleanup

- The smoke test client / opportunities / proposals are left in local D1
  with `status='accepted'` for the test rows and one fresh cloned-from
  opportunity at `status='open'`. Safe to leave; safe to wipe with
  `wrangler d1 execute bussey-bussey --local --command "..."`.
- The test admin row (`smoke-admin-uuid`) is still in `admin_user`. The
  bootstrap admin (`mrmicaiah@gmail.com`) was not touched.
- Wrangler dev was left running; kill with the usual interrupt.

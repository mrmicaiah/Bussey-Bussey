# Studio44 — Layer 1 build spec: the Leads wizard (book assessments)

**Status:** Design approved on paper (prototypes signed off). NOT yet built. This document is
the authoritative build spec for Layer 1. The build chat will dispatch the Claude Code worker
against THIS document.

**Read first:** `prompts/studio44-master-spec.md` (the master). This spec implements Layer 1
from §7 of the master and honors all five core principles (§2). Where this spec and the master
disagree, the master wins — flag the conflict, don't silently resolve it.

**Open decisions (§10) — resolved by the operator for this layer:**
1. Assessment IS a first-class entity. Table locked below (§4.3). Layer 1's booking action
   creates the first assessment row.
2. Lead/Prospect/Client → DB mapping CONFIRMED: Lead = `lead` row pre-`converted`; Prospect =
   `client`(status `prospect`) + `opportunity`(status `open`); Client = that same opportunity
   at `accepted`/build. The operator never sees the entity transition.
3. Wizard priority: ship strict `overdue → due-today → new`; reserve a sort key for later
   value-weighting (not built now). (Layer 1 is leads-only, so this mostly governs the
   Follow-ups queue ordering.)
4. Alice admin tools: NONE built in Layer 1. Build the hooks only (structured data + a reserved
   coach-panel slot). Alice's tool contracts are designed at the top of Layer 4.

**Operator mandate that governs this layer — TRACK EVERYTHING:** the operator wants maximal,
attributable tracking of the lead→build path so a formula can later be derived (and so Alice
can A/B test in L4). Over-track rather than under-track. Every call records, as STRUCTURED
data (not free text): which opener/hook/discovery/close variant was used, lead industry,
attempt number, outcome, timestamps, call duration on the phone if known, and **card dwell
time** (time from card render to outcome logged). This is a first-class requirement, not a
nice-to-have. The schema below is built around attribution.

---

## 1. What Layer 1 is

The highest-value, self-contained slice: turn the Leads stations into a guided calling wizard
whose single purpose is **booking assessments**. Press Work → pick Cold or Follow-ups → set a
session target → get handed one lead at a time as a card with the call framework on screen and
one-tap outcomes. Booking an assessment is the money moment: it silently converts the lead and
creates the first assessment, collapsing today's 4-step dance into one motion.

This extends the existing `calling-list/today` card/workflow pattern (the app's north star)
over the Leads stations, in the new Studio44 dark look.

**Scope boundary:** Layer 1 is LEADS ONLY. It ends the moment an assessment is booked (prospect
created). The Prospect workspace, the dashboard pulse, the task entity, and the assessment
workspace UI are Layer 2 — NOT this layer. Layer 1 creates the assessment row but does not build
the screen to work it. Do not build Layer 2 surfaces.

---

## 2. Approved UX (prototyped & signed off)

Two prototypes were approved by the operator. Build to match their structure and the Studio44
dark look (sharp black `#0a0a0b` surfaces, crimson `#d40b1e`, white/zinc text). These are the
canonical screens:

### 2.1 Session setup (spec only, not prototyped — build with these defaults)
- Entry from the dashboard Work button (and optionally a "Work Leads" entry).
- Choose **Cold calling** (never-contacted leads) or **Follow-ups** (leads with a follow-up due).
- Set a session target: either "book N assessments" or "make N calls" (operator picks the metric).
- Start → enters the card loop. The session carries a visible goal and a progress counter.

### 2.2 The call card (PROTOTYPED — canonical)
Header: Studio44 brand, "Cold calling session", progress (`7 / 20 calls`), scoreboard
(`1 / 3 booked`), thin crimson progress bar.

Left column (the work):
- Identity block: company, contact name + role, industry + rough size, source.
- **Attempt count** badge (amber), prominent — 6+ touches is the conversion zone; show a
  one-line nudge when attempt ≥ 6.
- **Prior notes / timeline**: prior call outcomes with dates, crimson left-rule.
- **Call framework, ALWAYS-ON** (all four stages visible at once, operator scans top→bottom):
  - Opener (15–20s) — selected variant highlighted crimson.
  - Hook (30–45s).
  - Discovery.
  - Close (book it; "book, don't pitch" reminder).
  - Each stage shows the **selected script variant's text** plus its **usage stats inline**
    (used N×, booked M, book-rate%) and an affordance to pick another variant ("+ K variants").
    Script variants are TRACKED OBJECTS (§4.4), not static copy.

Right column (the actions + Alice):
- **One-tap outcomes:** primary crimson "Booked assessment"; then "Call back", "No answer",
  "Voicemail", "Dead number"; and a bordered-danger "Do not call". Plus a "skip / snooze" escape
  (never trap the operator).
- **Alice coach panel** — RESERVED, visibly dormant, labeled "wires in L4". Dashed slot. Do not
  wire any Alice capability; just build the slot and ensure the data behind it exists.
- **"This call will capture"** strip — visible list of what gets recorded: opener id, hook id,
  industry, attempt #, outcome, timestamp, duration, **card time**. (This is the operator's
  tracking mandate made visible; keep it in the UI.)

Card-dwell timer: starts on card render, stops when an outcome is logged. Shown in the header
on the booking step (`card time 2:14`). Captured on every outcome.

### 2.3 The booking step (PROTOTYPED — canonical)
- Reached by tapping "Booked assessment".
- Operator sets **date + time only** (the two suggested close-times appear as quick-picks; allow
  picking another). 
- **Value is NOT an operator input.** It is Alice's job (L4), derived from the rate card. Show it
  as a labeled, dormant "Alice · L4" panel. Do NOT add a value input the operator fills. (Master
  says "optionally a value"; the operator has explicitly assigned value to Alice — so the field
  is Alice-owned, not operator-entered. The opportunity's value columns still exist in the DB and
  are simply left null at booking for Alice to fill later.)
- **"Happening behind the scenes"** panel — reassurance, not steps: Lead→Prospect, client+
  opportunity created, assessment #1 placed. The operator booked a meeting; the plumbing is
  invisible. Never show the words "create opportunity/client" as an action.
- Primary button: **Confirm booking & next lead** → fires the one-motion booking transaction
  (§5.1), ticks the scoreboard, drops straight back into the next card with a quick toast. The
  operator stays in the churn — no interstitial confirmation screen.
- Back-to-the-call escape.

### 2.4 Non-booking outcomes (spec only — mechanical)
- **Call back later:** operator picks a follow-up date/time → sets the lead's new
  `next_followup_at` (§4.2) and logs a `callback` activity → advance to next card. This is what
  feeds the Follow-ups station.
- **No answer / Voicemail:** log the activity (with attempt increment + card time) → advance.
- **Dead number:** log + mark lead so it leaves the calling pool → advance.
- **Do not call:** log + flag lead do-not-call (suppress from all sessions) → advance.
- **Skip / snooze:** advance without logging an outcome (but DO record a `skipped` activity with
  card time, so even skips are data) → next card.

---

## 3. Backend gaps Layer 1 must close (this is real work)

From the master + Appendix A verification:
1. Leads have **no activity/timeline of their own** (today `calling_log` attaches only to
   `calling_list_item`). Build a **lead-level activity model** (§4.1) designed for attribution.
2. Leads have **no follow-up / next-step field** (`next_followup_date` lives only on opportunity).
   Add `next_followup_at` + do-not-call/dead flags to the lead (§4.2).
3. **No assessment entity** anywhere. Create it (§4.3).
4. **Script variants** don't exist. Create the variant + usage tracking tables (§4.4) — the
   Alice-ready hook and the operator's tracking substrate.
5. The **4-step calling-list→prospect dance** must collapse into ONE booking motion (§5.1).

No task entity is built in Layer 1 (that's Layer 2). No Alice tools (Layer 4).

---

## 4. Data model (migrations 0009+; review before building)

Conventions to match existing migrations (verified against 0001 + 0008): TEXT primary keys
(same id-generation approach as existing tables), ISO-8601 UTC timestamps via
`strftime('%Y-%m-%dT%H:%M:%fZ','now')`, CHECK constraints for enums, named `idx_*` indexes,
the SQLite table-rebuild pattern (PRAGMA foreign_keys=OFF / rebuild / re-index / ON) for any
enum widening on existing tables. Each concern gets its own numbered migration file starting at
0009. The worker proposes the exact file split; the shapes below are the contract.

### 4.1 `lead_activity` — the lead-level timeline, built for attribution
The core tracking table. One row per logged interaction with a lead.

Columns (contract):
- `id` TEXT PK
- `lead_id` TEXT NOT NULL → `lead(id)` ON DELETE CASCADE
- `kind` TEXT NOT NULL CHECK in: `call`, `callback`, `voicemail`, `no_answer`, `dead_number`,
  `do_not_call`, `skipped`, `booked`, `note`
- `outcome` TEXT NULL — the one-tap outcome chosen (mirrors kind for call dispositions; null for
  pure notes)
- `attempt_number` INTEGER NULL — the lead's attempt # at the moment of this activity
- `industry_at_time` TEXT NULL — denormalized snapshot of lead industry (so attribution survives
  later edits)
- `opener_variant_id` TEXT NULL → `script_variant(id)`
- `hook_variant_id` TEXT NULL → `script_variant(id)`
- `discovery_variant_id` TEXT NULL → `script_variant(id)`
- `close_variant_id` TEXT NULL → `script_variant(id)`
- `card_dwell_ms` INTEGER NULL — time from card render to outcome logged (the operator's
  requested signal)
- `phone_duration_s` INTEGER NULL — talk time if ever known (nullable; not required in L1)
- `session_id` TEXT NULL — the calling session this happened in (so per-session analysis works)
- `notes` TEXT NULL — free-text the operator adds
- `created_by_user_id` TEXT NULL → `admin_user(id)`
- `created_at` TEXT NOT NULL DEFAULT now

Indexes: `(lead_id, created_at)`, `(kind)`, `(opener_variant_id)`, `(hook_variant_id)`,
`(session_id)`.

Rationale: every row ties an OUTCOME to the exact VARIANTS used, the INDUSTRY, the ATTEMPT, and
the DWELL TIME. That is the formula substrate and the A/B dataset Alice reads in L4. This is the
"over-track" mandate encoded.

### 4.2 `lead` — additive columns (rebuild per 0008 pattern; do NOT drop data)
Add to the existing 16-column lead table:
- `next_followup_at` TEXT NULL — drives the Follow-ups station.
- `attempt_count` INTEGER NOT NULL DEFAULT 0 — denormalized running count (source of truth is
  `lead_activity`, but a cached count keeps the card fast).
- `do_not_call` INTEGER NOT NULL DEFAULT 0 — suppress from sessions.
- `is_dead_number` INTEGER NOT NULL DEFAULT 0 — suppress from sessions.
- (Reuse the existing `last_contacted_at`, currently unused in UI — Layer 1 finally writes it.)
Index `(next_followup_at)` and `(status, do_not_call, is_dead_number)` for queue building.

### 4.3 `assessment` — first-class entity (LOCKED)
- `id` TEXT PK
- `opportunity_id` TEXT NOT NULL → `opportunity(id)` ON DELETE CASCADE
- `scheduled_at` TEXT NOT NULL — assessment date/time
- `status` TEXT NOT NULL DEFAULT `booked` CHECK in: `booked`, `completed`, `no_show`,
  `canceled`, `rescheduled`
- `outcome_notes` TEXT NULL — filled in Layer 2's workspace; null at booking
- `sequence_number` INTEGER NOT NULL DEFAULT 1 — 1st, 2nd, … assessment for this prospect
- `booked_from_activity_id` TEXT NULL → `lead_activity(id)` — back-link to the call that booked it
  (closes the attribution loop: which call/opener produced this assessment)
- `created_by_user_id` TEXT NULL → `admin_user(id)`
- `created_at` TEXT NOT NULL DEFAULT now
Index `(opportunity_id, scheduled_at)`, `(status)`, `(scheduled_at)`.

Layer 1 only ever CREATES assessment #1 at booking. Working/editing assessments is Layer 2.

### 4.4 `script_variant` + `script_variant_usage` — tracked script objects (Alice-ready hook)
The framework lines are data, authored by operator OR Alice, with usage tracked.

`script_variant`:
- `id` TEXT PK
- `stage` TEXT NOT NULL CHECK in: `opener`, `hook`, `discovery`, `close`
- `body` TEXT NOT NULL — the script language
- `author_kind` TEXT NOT NULL CHECK in: `operator`, `alice`, `seed` — who wrote it (Alice
  authoring is just another value here; no special-casing — the L4 hook)
- `author_user_id` TEXT NULL → `admin_user(id)`
- `label` TEXT NULL — short human handle ("27 seconds opener")
- `industry` TEXT NULL — optional targeting (a variant can be industry-specific)
- `is_active` INTEGER NOT NULL DEFAULT 1
- `created_at` TEXT NOT NULL DEFAULT now
Seed a small starter set (`author_kind = 'seed'`) — the placeholder lines from the prototype
(the "27 seconds" opener, the hours-lost hook, the open-qualify discovery, the two-times close).

`script_variant_usage` — append-only usage log (the operator's "dates/times/number of times
used" requirement, plus outcome attribution):
- `id` TEXT PK
- `variant_id` TEXT NOT NULL → `script_variant(id)` ON DELETE CASCADE
- `lead_id` TEXT NULL → `lead(id)`
- `activity_id` TEXT NULL → `lead_activity(id)` — the call it was used on
- `outcome` TEXT NULL — the outcome that followed (denormalized for cheap rollups)
- `used_at` TEXT NOT NULL DEFAULT now
Index `(variant_id, used_at)`, `(variant_id, outcome)`.

The card's inline "used N×, booked M, book-rate%" stats are rollups over this table. Alice reads
exactly this in L4 to coach and A/B test. (Rollups can be computed on read in L1; a cached
counter on `script_variant` is optional and may be deferred.)

---

## 5. API / worker work

### 5.1 The one-motion booking endpoint (collapses the 4-step dance)
A single transactional endpoint: "book assessment for lead X at datetime T". In ONE transaction
it must:
1. Ensure/create the `client` (status `prospect`) with `origin_lead_id` = the lead (reuse the
   existing createClient path/logic; do not duplicate it — call the same service).
2. Create the `opportunity` (status `open`) on that client (reuse createOpportunity; it already
   generates `presentation_token`). Leave value columns NULL (Alice fills later).
3. Set `lead.status = 'converted'`, write `last_contacted_at`, bump `attempt_count`.
4. Create `assessment` #1 (`scheduled_at = T`, `sequence_number = 1`).
5. Write a `lead_activity` row (`kind = 'booked'`, with the variant ids used, attempt #,
   industry snapshot, card dwell, session id) and link `assessment.booked_from_activity_id` to it.
6. Append `script_variant_usage` rows for each variant used, with `outcome = 'booked'`.
All-or-nothing. If the lead came from a `calling_list_item`, also advance that item's status
(mirror today's `converted_to_lead`→ now effectively converted-to-prospect) so the two systems
don't drift. Return enough for the UI to tick the scoreboard and load the next card.

Reuse existing services (`clients.ts` createClient, `opportunities.ts` createOpportunity) rather
than re-implementing — wrap them in the transaction. Flag if their current shape resists being
called transactionally; do not fork business logic silently.

### 5.2 Other endpoints
- Build the calling **session** + **queue** endpoints: given Cold or Follow-ups + target, return
  the prioritized lead list (Cold = never-contacted, no do-not-call/dead; Follow-ups =
  `next_followup_at` due, ordered `overdue → due-today → new` per Decision 3). One-at-a-time
  delivery.
- Log-activity endpoint for the non-booking outcomes (§2.4), each writing `lead_activity`
  (+ attempt bump, `last_contacted_at`, card dwell) and, for callback, `next_followup_at`.
- Read endpoints for: a lead's activity timeline; script variants by stage with usage rollups.
- All scoped to the authenticated operator's session/roles (existing auth). No new auth work.

### 5.3 Types & plumbing
Update `admin/src/lib/types.ts` hand-maintained mirrors for every new table/shape. Use the
existing `api.ts` fetch wrapper. No new framework.

---

## 6. Frontend work
- New routes under the authed group for the Work session + card loop + booking step. Reuse and
  extend the `calling-list/today` card pattern; do not reinvent it.
- Build in the Studio44 dark look as prototyped, but DO NOT do the global reskin (that's the
  final phase). Scope new dark styling to the new Layer 1 screens; leave the rest of the admin's
  navy styling untouched for now to avoid thrash. (The full rebrand of "Bussey · Admin" →
  Studio44 and the token swap happen last, per master §7.)
- Shared components to reuse where sensible: Button, Field, ConfirmDialog. New components:
  the lead card, the always-on framework, the script-variant picker, the booking step, the
  scoreboard, the (dormant) Alice coach-panel slot, the capture strip.

## 7. Alice-readiness checklist for Layer 1 (build the room, not the occupant)
- ✅ Call framework + outcomes + notes stored as STRUCTURED data Alice can read (`lead_activity`,
  `script_variant*`).
- ✅ A designated coach-panel slot beside the call (dormant, labeled L4).
- ✅ Variants are author-attributed (`author_kind` includes `alice`) so Alice authoring her own is
  a no-schema-change extension.
- ✅ Assessment links back to the booking activity (attribution loop closed).
- ❌ No Alice tools, no model calls, no context wiring in Layer 1. None.

## 8. Build / deploy reality (the working model — tell the operator before any push)
- Worker COMMITS but NEVER pushes. The operator pushes manually.
- Pushing to `main` auto-deploys the FRONTEND to staging.
- Worker (API) changes need a separate manual `wrangler deploy --env staging` — a frontend push
  does NOT deploy the worker.
- Migrations 0009+ must be applied to the staging D1 database (the worker reports the exact
  apply command; the operator runs it).
- Build/typecheck must pass before commit. Commit, do not push. Report unpushed commit count.

## 9. Suggested build order within Layer 1 (smallest-valuable-first)
1. Migrations 0009+ (the data model) + types mirror. Build/typecheck.
2. Read endpoints + session/queue endpoint (no writes yet) → prove the card can be populated.
3. The card loop + always-on framework + scoreboard (frontend) against real reads, seeded
   script variants.
4. Non-booking outcome logging (writes to `lead_activity`, callback sets follow-up).
5. The one-motion booking endpoint (§5.1) + the booking step UI — the money moment, last because
   it's the riskiest transaction.
Each step: commit, do not push; report what a push/deploy would do.

---

## Appendix — what is explicitly OUT of Layer 1
Prospect workspace UI, assessment working/editing screen, the task entity, the dashboard pulse,
any Alice tool or model call, value entry/derivation, the presentation/close cleanup, and the
global Studio44 reskin. Those are Layers 2–4 and the final reskin. Build Layer 1 only.

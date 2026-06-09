# Studio44 — Calls layer (cold-call convergence)

**Status:** Draft, awaiting operator sign-off on §1, §3, §4.
**Author:** Manager chat.
**Created:** 2026-06-09.
**Revised:** 2026-06-09 — §3 schema reworked. Original spec proposed extending `lead_activity` with a dual-key column, but `lead_activity.lead_id` is `NOT NULL` from migration 0011, so the dual-key invariant ("exactly one of lead_id, calling_list_item_id non-null per row") was unsatisfiable without a full table rebuild. Revised approach uses a separate `card_activity` table with the same shape, and the unified-history view UNIONs across both tables. See §3 for details.
**Supersedes:** the implicit dual-system of `calling_list_item` (worked at `/calling-list/today`) and `lead`-wizard (worked at `/leads/work`) that ships today. After this layer lands, cold calling has ONE front door and one canonical wizard.

---

## §1. The model — read this first

Studio44 has, until now, shipped two parallel cold-calling implementations: the original
`calling_list_item` station (a plain list view at `/calling-list/today` with a per-card
log-call modal) and the Layer 1 `lead`-wizard (a card-loop session at `/leads/work` with
script-variant tracking, attribution, and Studio44 framework). They overlap conceptually
but use different tables, different UI, and different data shapes. The dashboard's
"Cold calling → Work" button points to the wizard, but freshly-imported CSV rows land in
the `calling_list_item` table — so an operator who imports a list and clicks "Work" gets
"no leads to work" because the wizard reads `lead` only. This is the architectural seam
the Calls layer closes.

### The five-stage funnel

The operator's mental model of the sales funnel after this layer:

```
Calls → Leads → Prospects → Presentations → Clients
```

Five distinct stages, four explicit transitions. Each stage is its own workstation with
its own queue, its own framework, and its own surface.

- **Calls** (this layer's new station, `calling_list_item` table). Bland, transactional
  cold dials. Each call adds data to the card. Most cards never leave this station.
- **Leads** (Layer 1's wizard, retargeted, `lead` table). Warm, qualified people the
  salesperson believes in. The card-to-lead transition is the moment the cold becomes warm.
- **Prospects** (Layer 2's workspace, unchanged, `opportunity`/`assessment`/`demo_spec` tables).
  Booked an assessment.
- **Presentations** (Presentation room layer, just-built, unchanged). Live demo on a real call.
- **Clients** (post-acceptance, served by existing activation flow). Won the deal.

### How a card actually moves

The Calls station's wizard offers the operator four outcomes at the close of any call:

1. **Pass** — disqualify the card. Card dies (`card_status='dead'` or `'disqualified'`),
   not callable again.
2. **Retry later** — keep callable. Cadence research (§4) drives the default
   `next_action_date`; operator can override.
3. **Promote to lead** — there's interest but not ready to book. Card spawns a `lead` row,
   stays alive itself with `card_status='promoted'` for audit, no longer surfaces in the
   Calls queue. The lead enters the Leads station's queue.
4. **Book the assessment** — they said yes to a meeting RIGHT NOW. The card short-circuits
   the funnel: book transaction fires from the card directly (creates `lead` + `client` +
   `opportunity` + `assessment` in one atomic motion, same Layer 1 booking shape but
   sourced from card data instead of from a pre-existing lead). The new lead row is
   instantly converted to a client; the card is marked `card_status='promoted'` with the
   FK link for full audit.

The fourth outcome is the most important architectural insight of this layer: **a card
can skip the lead stage entirely.** The funnel has five named stages but the system never
*enforces* that a card pass through all of them. A first-call booking is the cleanest path
and the system should make it easy.

The third outcome (promote to lead, NOT book) is the middle case: there's heat but the
person isn't ready to commit time. The lead lives in the warm-list station and gets
worked on a longer cadence with the existing Layer 1 wizard.

### The promote-to-lead motion in detail

When the operator picks "Promote to lead" at the close of a call:

- A new row is INSERT'd into `lead` with: `name` from `contact_name`, `email` from
  `contact_email`, `phone` from `contact_phone`, `company` from `company_name`, `industry`
  from `industry`, `source='calling_list'` (matches today's conversion path), `status='contacted'`,
  `owner_user_id` = the promoting admin, `notes` = a preamble auto-composed from the card's
  data + the promoting call's note (see §5 for exact preamble format).
- The card row's `card_status` is updated to `'promoted'`, `promoted_lead_id` is set to
  the new lead's ID.
- All historical `card_activity` rows for this card remain attached to the card. They are
  joinable to the new lead via the card's `promoted_lead_id` FK through the unified-history
  view (see §3). Alice and any analytics query reads the full call history via either
  endpoint.

The card row is NOT deleted. It stays as a permanent audit record of "this lead came from
a cold call, and here was the call sequence that produced it."

### Naming

| Surface | Operator-facing label | Internal/URL |
|---|---|---|
| The cold-call station | "Calls" | `/calls` (list view, simple status filter) |
| The cold-call wizard | "Work Calls" or "Start a calling session" | `/calls/work` (the session wizard) |
| The leads station | "Leads" | `/leads` (existing) |
| The leads wizard | "Work Leads" | `/leads/work` (existing — repointed) |
| The card object (in copy) | "Call card" or "card" | `calling_list_item` (table) |
| The lead object (in copy) | "Lead" | `lead` (table) |

Decision (operator confirmed 2026-06-09): top-level term is **"Calls"** for the cold-card
station; **"Leads"** stays for warm leads. Five funnel-vitals on the dashboard:
**Calls / Leads / Prospects / Presentations / Clients**.

### Alice integration (hooks designed here, not wired until L4)

Every Calls-layer surface is designed with Alice's eventual ownership in mind. The
over-tracking discipline from Layer 1 carries forward — *every* call adds attribution-quality
data to the card's activity history, and every state transition writes a timestamp the
analytics substrate can read. Specifically Alice will, at L4, learn from:

- Which industries / sub-categories book best (industry on card → outcome).
- Which time-of-day windows connect with decision-makers.
- Which script-variant openers perform on which industry.
- Patterns in pass-vs-promote vs book-outright.
- Source-batch attribution (`source` column on card → outcome; tells us which list-sourcing
  workflows produce the best leads).
- Cadence patterns (attempt N → outcome distribution).

All of this is queryable from `calling_list_item` + `card_activity` + the joined-through
booking/promotion FKs. The Calls layer's job is to make that data exist; Layer 4's job is
to make Alice read it.

---

## §2. Out of scope for this layer

To keep scope honest, the following are NOT part of the Calls layer:

- **The Leads wizard itself.** Layer 1's wizard is good and stays. We rename copy
  ("Work Leads"), confirm it reads `lead` only, and stop there.
- **Alice wiring.** Hooks and structured data only.
- **A bulk-import endpoint for the API.** The CSV import path is unchanged; today's manual
  workflow continues. (The lead-sourcing skill in `prompts/skill-lead-sourcing.md` still
  produces CSVs the operator uploads at `/admin/calling-list/import`.)
- **The Layer 1 "always-on framework" UI for cold calls.** Calls get a *different*,
  shorter framework (opener → qualifier → book-or-promote-or-pass — three stages, see §4).
  The four-stage Layer 1 framework stays on the leads wizard.
- **Calls-cadence research that goes beyond what's in §4.** The cadence defaults below are
  drawn from the standard sales-ops research (Velocify, Hubspot, InsideSales). If the
  operator wants industry-specific cadence later, that's a future enhancement.
- **Carrying the old `/calling-list/today` plain-list view.** That route is retired —
  redirected to `/calls` after this layer ships.

---

## §3. Schema changes

This section is operator-reviewable. Everything below is what touches the database. Sign
off here before §4/§5 implementation begins.

**Note on the table-separation decision (vs. dual-keying lead_activity):**
An earlier draft of this spec proposed adding `calling_list_item_id` to `lead_activity` with
a dual-key invariant ("exactly one of lead_id, calling_list_item_id non-null"). That fails
because `lead_activity.lead_id` is `NOT NULL` (migration 0011). Relaxing it would require a
full SQLite table rebuild, touching a table the Layer 1 wizard already reads — large blast
radius for a constraint we'd then enforce only at the API layer. The revised approach uses
a separate `card_activity` table with the same shape. A `card_activity` row stays on the
card forever; a copy is *also* written to `lead_activity` at promote-time (so the
Layer 1 wizard's prior-attempts join keeps working without modification). This is mildly
denormalized but the duplication is bounded (one copy per promoting call) and the
operational simplicity is large.

### 3.1 Migration 0021 — calling_list_item card-status fields

Add the workflow columns:

```sql
ALTER TABLE calling_list_item ADD COLUMN card_status TEXT NOT NULL DEFAULT 'pending';
-- enum (API-enforced, no DB CHECK constraint): pending | in_progress | done | dead | disqualified | promoted
-- 'pending'      — never touched OR retry scheduled in the future
-- 'in_progress'  — being worked right now (session checkout, see §4)
-- 'done'         — booked the assessment; promoted_lead_id and converted_lead_id both set
-- 'dead'         — disconnected, bad number, do-not-call, or auto-parked at attempt cap
-- 'disqualified' — manual "Pass" outcome — operator marked as not-a-fit
-- 'promoted'     — became a lead without booking yet (promoted_lead_id set, no client)

ALTER TABLE calling_list_item ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
-- count of distinct call activities logged against this card.

ALTER TABLE calling_list_item ADD COLUMN next_action_date TEXT;
-- nullable ISO date 'YYYY-MM-DD'. When NULL: callable now (true cold).
-- When set: do not surface in the Calls queue until current_date >= next_action_date.

ALTER TABLE calling_list_item ADD COLUMN promoted_lead_id TEXT REFERENCES lead(id) ON DELETE SET NULL;
-- when the card is promoted to a lead, this points at the new lead.
-- when the card is also booked (the new lead → client transaction), this STILL points at
-- the intermediate lead. converted_lead_id (existing column from migration 0008) points
-- at the same lead in the booking case.

ALTER TABLE calling_list_item ADD COLUMN last_outcome TEXT;
-- last activity_outcome string cached for cheap reads.

-- Indexes (added at the worker's recommendation from step 1 review):
CREATE INDEX IF NOT EXISTS idx_calling_list_item_card_status ON calling_list_item(card_status);
CREATE INDEX IF NOT EXISTS idx_calling_list_item_next_action_date ON calling_list_item(next_action_date);
CREATE INDEX IF NOT EXISTS idx_calling_list_item_promoted_lead_id ON calling_list_item(promoted_lead_id);
```

### 3.2 Migration 0022 — card_activity table (REVISED — was lead_activity dual-key)

Create a parallel `card_activity` table mirroring `lead_activity`'s shape, but keyed to
`calling_list_item` instead of `lead`:

```sql
CREATE TABLE card_activity (
  id TEXT PRIMARY KEY,
  calling_list_item_id TEXT NOT NULL REFERENCES calling_list_item(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'call',
  outcome TEXT,                      -- voicemail | no_answer | gatekeeper | spoke_qualified | spoke_not_interested | ...
  attempt_number INTEGER NOT NULL,
  industry_at_time TEXT,
  opener_variant_id TEXT REFERENCES script_variant(id),
  hook_variant_id TEXT REFERENCES script_variant(id),
  discovery_variant_id TEXT REFERENCES script_variant(id),
  close_variant_id TEXT REFERENCES script_variant(id),
  card_dwell_ms INTEGER,
  phone_duration_s INTEGER,
  session_id TEXT,
  notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_card_activity_card_id ON card_activity(calling_list_item_id);
CREATE INDEX IF NOT EXISTS idx_card_activity_created_at ON card_activity(created_at);
```

Schema parallel to `lead_activity` (migration 0011) — same column names, same FK shapes,
same indices. The only difference is the FK target. This keeps Alice's query writing
uniform: same predicates, same joins, just two tables to UNION.

### 3.3 Migration 0023 — view for unified activity reads

Create `v_card_full_history` — returns all activity rows related to a card, whether
they live in `card_activity` (the card's own pre-promotion activity) or in `lead_activity`
(the lead's post-promotion activity, after promote-to-lead or book-from-card).

```sql
CREATE VIEW IF NOT EXISTS v_card_full_history AS
-- Branch 1: card's own pre-promotion activity
SELECT
  ca.id AS activity_id,
  cli.id AS source_card_id,
  cli.promoted_lead_id,
  cli.converted_lead_id,
  ca.kind, ca.outcome, ca.attempt_number, ca.industry_at_time,
  ca.opener_variant_id, ca.hook_variant_id, ca.discovery_variant_id, ca.close_variant_id,
  ca.card_dwell_ms, ca.phone_duration_s, ca.session_id, ca.notes,
  ca.created_by_user_id, ca.created_at,
  'card' AS source_table
FROM card_activity ca
JOIN calling_list_item cli ON ca.calling_list_item_id = cli.id
UNION ALL
-- Branch 2: post-promotion lead activity (via the card's promotion FK)
SELECT
  la.id AS activity_id,
  cli.id AS source_card_id,
  cli.promoted_lead_id,
  cli.converted_lead_id,
  la.kind, la.outcome, la.attempt_number, la.industry_at_time,
  la.opener_variant_id, la.hook_variant_id, la.discovery_variant_id, la.close_variant_id,
  la.card_dwell_ms, la.phone_duration_s, la.session_id, la.notes,
  la.created_by_user_id, la.created_at,
  'lead' AS source_table
FROM lead_activity la
JOIN calling_list_item cli ON la.lead_id = cli.promoted_lead_id OR la.lead_id = cli.converted_lead_id;
```

This view is the canonical "everything ever logged about this card" query. The
`source_table` discriminator column lets readers distinguish pre-promotion (cold) activity
from post-promotion (warm-lead) activity. Alice reads this at L4.

If view performance becomes an issue at scale (it won't for staging's 10 cards), we
materialize to a read-side cache. Punt.

### 3.4 Migration 0024 — backfill historical conversion data

The existing `lead.source='calling_list'` convention (set when a card converts to a lead
via the old `/calling-list/today` log-call path) gives us a way to identify
already-converted cards. For any existing card that has a `converted_lead_id` set
(historical column from migration 0008), set `card_status='promoted'` and
`promoted_lead_id = converted_lead_id`.

```sql
UPDATE calling_list_item
SET card_status = 'promoted',
    promoted_lead_id = converted_lead_id
WHERE converted_lead_id IS NOT NULL
  AND card_status != 'promoted';  -- idempotent: skip already-promoted
```

Cards with no conversion stay `pending`. Cards with conversion get the audit history they
should have had.

### 3.5 Schema summary table

| Column | Table | Type | Nullable | Purpose |
|---|---|---|---|---|
| `card_status` | `calling_list_item` | TEXT enum | NO (default 'pending') | workflow state |
| `attempt_count` | `calling_list_item` | INTEGER | NO (default 0) | cached count of activities |
| `next_action_date` | `calling_list_item` | TEXT 'YYYY-MM-DD' | YES | when to resurface |
| `promoted_lead_id` | `calling_list_item` | TEXT FK→lead.id | YES | audit link to lead |
| `last_outcome` | `calling_list_item` | TEXT enum | YES | cached last outcome |
| `card_activity` | (new table) | — | — | per-card activity log; mirrors lead_activity shape |
| `v_card_full_history` | (view) | — | — | unified activity reads (card + lead branches) |

### 3.6 What's NOT changing in the schema

- The `lead` table itself. Layer 1's columns stay. Lead-side workflow is unchanged.
- The `lead_activity` table. Stays exactly as Layer 1 designed it. No new columns, no
  changes to NOT NULL constraints.
- `assessment`, `opportunity`, `demo_spec`, `client` — none touched. Booking transaction
  shape unchanged.
- The CSV import endpoint at `/admin/calling-list/import`. Unchanged.
- The promotion-to-lead handler at `worker/src/routes/admin/calling-list.ts`
  (`callingListLogHandler`). Its core INSERT stays; we extend it to ALSO update the card's
  `card_status='promoted'` and `promoted_lead_id` per §1, and to *also* INSERT a copy of
  the promoting call's activity into `lead_activity` (so Layer 1's prior-attempts join
  keeps working).

---

## §4. The Calls wizard

This is the new surface. Sign off on this section before any implementation.

### 4.1 Entry point

From the dashboard, the "Cold calling & outreach" station has its Work button repointed
from `/leads/work` (the leads wizard) to `/calls/work` (the new calls wizard). The header's
"Start a calling session" link gets a context-aware behavior: if Calls funnel-vital > 0,
it goes to `/calls/work`; else `/leads/work`. (Defensive default: if both are 0, go to
`/calls/work` and let the empty state explain.)

A new "Work Leads" entry point is added separately — see §4.6.

### 4.2 Session start screen

The operator lands at `/calls/work` and sees a session-start screen with three filters:

1. **Mode picker:** "Fresh cold" (only never-touched cards), "Callbacks due" (only cards
   with `next_action_date <= today`), "Mixed" (both, ordered fresh-first). Default: Mixed.
2. **Industry filter** (optional): pick one of the canonical industry strings in the queue
   to narrow.
3. **Push target** (optional, prefilled from `cold_calling_target` table from Layer 1 / dashboard step):
   "I want to make N calls in this session."

The session-start screen also surfaces the funnel-vitals row at the top so the operator
can see, before starting, "I have 8 fresh cold calls and 2 callbacks due today, plus 4
already-touched cards I could re-work."

A "Start Session" button moves to the wizard's card-loop.

### 4.3 Card-loop UI (the wizard itself)

This is where calls actually happen. The screen is a single-card surface — one card at a
time, the operator works that card to completion (one outcome), and the wizard moves to
the next.

Layout (matches Layer 1's pattern, dark Studio44 palette):

```
┌────────────────────────────────────────────────────────────────────┐
│  ← End session       Card 3 of 12       Calls station             │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  COMPANY NAME — title-large                                       │
│  Industry · Source · Imported date                                │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Contact: Sarah Williams                                     │ │
│  │  Phone: (512) 555-1234         ← clickable to tel://         │ │
│  │  Email: contact@firm.com                                     │ │
│  │  Notes (from import): estate planning solo, downtown Austin  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ATTEMPT 3 OF 8                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Last call — 2026-06-07, 10:14am                             │ │
│  │  Outcome: voicemail                                          │ │
│  │  Note: Left message about EP doc automation                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  [Show all 2 prior attempts ↓]                                    │
│                                                                    │
│  ─── Framework prompt area ────────────────────────────────────── │
│  Stage 1 of 3 — Opener                                            │
│  Script variant: "30-second hello — value bridge"                 │
│  [Show script ↓] [Try a different variant ↓]                     │
│                                                                    │
│  ─── Outcome selector ─────────────────────────────────────────── │
│  What happened?                                                    │
│  [Voicemail] [No answer] [Gatekeeper] [Spoke — qualified]        │
│  [Spoke — not interested] [Spoke — callback later] [Wrong number] │
│  [Disconnected]                                                    │
│                                                                    │
│  ─── Next move ─────────────────────────────────────────────────── │
│  [ Pass / Disqualify ]  [ Retry later ]  [ Promote to lead ]      │
│  [ Book assessment NOW → ]                                         │
│  Notes:  ┌──────────────────────────────────────────────────────┐ │
│          │ (single line — what happened that matters)           │ │
│          └──────────────────────────────────────────────────────┘ │
│                                                                    │
│  [Skip card]                              [Log & next →]          │
└────────────────────────────────────────────────────────────────────┘
```

Key UI principles:

- **Prior history is inline**, not hidden. Most-recent call's outcome + note shown by
  default. Expand for all attempts. If the card has a captured gatekeeper/decision-maker
  name from a prior call, that surfaces in the contact block prominently
  ("Last time: Sarah said call back Tuesday for Marcus").
- **Framework is shorter** than the lead wizard: three stages (opener → qualifier → book-
  or-promote-or-pass), not four. The "Stage X of 3" indicator is for operator orientation,
  not enforcement.
- **Outcome and next-move are separate.** Outcome is *what happened on the call.*
  Next-move is *what should happen to the card.* They're related but not the same. A
  "voicemail" outcome typically pairs with "retry later" next-move; a "spoke — qualified"
  pairs with "promote to lead" or "book assessment." The wizard pre-fills sensible defaults
  per outcome (§4.4) but operator can pick any combo.
- **Notes are required for `spoke — *` outcomes.** Voicemails and no-answers don't need
  notes by default (the outcome tells the story). But anything where a human conversation
  happened should have a one-liner of context — for the operator's own re-call later and
  for Alice eventually.

### 4.4 Outcome-to-next-move defaults

The cadence research (Velocify, Hubspot, InsideSales studies) drives these defaults. The
wizard pre-fills the "Next move" and `next_action_date` based on the outcome the operator
picked, but the operator can always override.

| Outcome | Default next-move | Default `next_action_date` |
|---|---|---|
| Voicemail | Retry later | today + 2 business days |
| No answer | Retry later | today + 1 business day |
| Gatekeeper (DM out) | Retry later | today + 3 business days (or as specified in notes) |
| Spoke — callback later | Retry later | as specified in notes (operator picks date) |
| Spoke — qualified | Book assessment NOW | (n/a — booking transaction) |
| Spoke — interested but not ready | Promote to lead | (n/a — moves out of card queue) |
| Spoke — not interested | Pass / Disqualify | (n/a — card dies) |
| Wrong number | Pass / Disqualify (mark `card_status='dead'`) | (n/a) |
| Disconnected | Pass / Disqualify (mark `card_status='dead'`) | (n/a) |

Two soft-pass cases worth calling out:
- **Polite-but-firm no (vs. hard "remove me from your list"):** the operator gets to pick
  between "Pass" (dies forever) and "Retry later" with a long cooldown (e.g. 30+ days).
  Operator judgment, no enforcement.
- **Hard no / "remove me":** Pass → `card_status='disqualified'`. The card is permanently
  off-queue.

### 4.5 Attempt cap and auto-park

After **attempt 8** without a `spoke — *` outcome, the wizard auto-suggests "Park this
card — 8 attempts no contact" at the next-move step. Operator can override and keep trying,
but the suggestion is there. Parking sets `card_status='dead'` with a special
`last_outcome='parked_at_cap'` for Alice to learn from.

### 4.6 Leads wizard — repointing and rename

The existing Layer 1 wizard at `/leads/work` is excellent and stays structurally unchanged.
Adjustments:

- **Confirm queue reads `lead` only** (no calling_list_item) — should already be true per
  Layer 1's design.
- **Copy update:** the dashboard's old "Work" button (which used to point at this wizard
  by default) is replaced by two buttons: "Work Calls →" (`/calls/work`) and "Work Leads →"
  (`/leads/work`). The leads wizard's own copy stays, but its title is clarified to "Work
  warm leads" instead of just "Work Leads."
- **No new functionality on the leads wizard.** This layer doesn't touch it.

### 4.7 Empty states

- **Empty Calls queue, all modes:** "No calls to make. Import a list at
  `/admin/calling-list/import` or run the lead-sourcing skill (see
  `prompts/skill-lead-sourcing.md`)."
- **Empty Fresh-cold, but Callbacks-due > 0:** "No fresh cold calls. You have N callbacks
  due — switch to Callbacks mode? [Switch]"
- **All cards parked or done:** "Your Calls queue is clean — every card has been worked.
  Time to source a new list."

---

## §5. Backend details

This section is for the worker building this. Operator can skim or skip.

### 5.1 Queue endpoint — `GET /api/admin/calls/queue`

Query params:
- `mode`: `cold` | `callbacks` | `mixed` (default `mixed`)
- `industry`: optional filter
- `limit`: default 50

Returns cards eligible for the chosen mode, ordered by:
1. Fresh cold first (if mode includes them) — ordered by `imported_at` ASC (oldest imports
   first — they've been waiting longest).
2. Then callbacks due — ordered by `next_action_date` ASC then `attempt_count` ASC.

A card is "eligible" if:
- `card_status IN ('pending', 'in_progress')`
- AND `do_not_call IS NULL OR do_not_call=0` (matches Layer 1's protective filter)
- AND (mode-specific):
  - `cold`: `attempt_count = 0`
  - `callbacks`: `attempt_count > 0` AND `next_action_date <= date('now')`
  - `mixed`: union of both

Returns full card payload plus a `prior_attempts` array — last 5 `card_activity` rows
where `calling_list_item_id = card.id`, ordered by `created_at` DESC.

### 5.2 Call log endpoint — `POST /api/admin/calls/:id/log`

Request shape:
```json
{
  "outcome": "voicemail | no_answer | gatekeeper | spoke_qualified | spoke_not_interested | ...",
  "next_move": "pass | disqualify | retry | promote | book",
  "next_action_date": "2026-06-12 | null",
  "notes": "...",
  "script_variant_id": "...optional, the one used"
}
```

Server-side transaction (one atomic `DB.batch`):

1. INSERT `card_activity` row — calling_list_item_id set, outcome, notes, attempt_number,
   timestamp, script_variant_id.
2. UPDATE `calling_list_item` SET `attempt_count = attempt_count + 1`, `last_outcome = outcome`,
   `next_action_date = ?`.
3. Per `next_move`:
   - `pass`: SET `card_status='disqualified'`.
   - `disqualify`: SET `card_status='disqualified'`.
   - `retry`: keep `card_status` as 'pending' (or 'in_progress' if mid-session).
   - `promote`: INSERT new `lead` (see preamble below), SET `card_status='promoted'`,
     `promoted_lead_id = new_lead.id`. ALSO INSERT a mirror row into `lead_activity` for
     the promoting call (lead_id = new_lead.id, same outcome/notes) so Layer 1's
     prior-attempts join works.
   - `book`: INSERT new `lead`, then run the full Layer 1 booking transaction (creates
     client + opportunity + assessment), SET `card_status='promoted'` AND
     `converted_lead_id = new_lead.id`, `promoted_lead_id = new_lead.id`. Same lead_activity
     mirror as promote.
4. If `card_status` became `'dead'` via the attempt cap auto-park, set
   `last_outcome='parked_at_cap'` explicitly.
5. Audit row (existing `audit_log` pattern).

### 5.3 The promote-to-lead notes preamble

When a card promotes to a lead, the new lead's `notes` field gets an auto-composed
preamble:

```
Promoted from calling card (imported 2026-06-09 via places_austin_law_pilot_2026_06).
Company: Robbins Estate Law
Phone: (512) 851-1248
Industry: Legal Services
Card notes: estate planning + trust focus, 3 Austin-area offices, document-heavy practice
Promoting call (2026-06-11, attempt 4): Spoke with Kyle. Interested in EP doc automation.
Asked for a follow-up next week.

---
(operator's running thread starts below this line)
```

### 5.4 The book-from-card path

Same as Layer 1's lead → client+opportunity+assessment booking, but with one extra step at
the top of the transaction: INSERT a new lead row first (using the card's data + a synthetic
"booked direct from card" notes preamble), then run the existing booking transaction with
that lead as the source. Card gets both `promoted_lead_id` and `converted_lead_id` set to
the new lead's ID — the same lead.

This means a card-booked deal has `card → lead → client + opportunity + assessment` in the
audit chain, even though the lead row existed for only milliseconds. That's a feature:
all downstream reporting that joins through `lead` still works.

### 5.5 Endpoints touched

| Endpoint | Change |
|---|---|
| `GET /api/admin/calls/queue` | NEW — replaces no-equivalent (was `/api/admin/calling-list/today` returning today's pending list) |
| `POST /api/admin/calls/:id/log` | NEW — supersedes `/api/admin/calling-list/:id/log` (which stays as a deprecated alias for one release, then dies) |
| `GET /api/admin/calls/:id` | NEW — single-card detail with full activity history (via the v_card_full_history view) |
| `GET /api/admin/calls/funnel-vital` | NEW — count of pending/in_progress cards, plus sub-line counts |
| `GET /api/admin/leads/queue` | UNCHANGED — Layer 1 already reads `lead` only |

The old `/admin/calling-list/today` page route is retired (admin redirects to `/calls`).
The old `/api/admin/calling-list/today` endpoint stays for one release as a deprecated
read; then we remove it.

---

## §6. Dashboard changes

The dashboard at `(authed)/+page.svelte` gets:

### 6.1 Funnel-vitals row — adds Calls

Today: Leads / Prospects / Presentations (three vitals).
After: **Calls / Leads / Prospects / Presentations / Clients** (five vitals).

Counts:
- **Calls**: cards with `card_status IN ('pending', 'in_progress')`. Sub-line:
  "X never called · Y callbacks due today."
- **Leads**: existing — leads with status NOT IN ('converted', 'disqualified').
- **Prospects**: existing.
- **Presentations**: existing.
- **Clients**: new — clients with `status='active'` (or however clients are counted in
  existing Layer 2 data; need to confirm column name in the build step).

### 6.2 Cold calling station — repointed

The "Cold calling & outreach" station gets a clarity refresh:
- Heading: "Calls" (was "Cold calling & outreach").
- Push-target +/- control: unchanged.
- Today's progress line: "Made X calls today" — counts `card_activity` rows created today.
- Primary button: **"Work Calls →"** (points to `/calls/work`).
- Secondary button: **"Work Leads →"** (points to `/leads/work`).

### 6.3 Header — context-aware Start link

"Start a calling session" link in the global header (`admin/src/lib/components/Header.svelte`)
becomes context-aware:
- If `calls.count > 0`: goes to `/calls/work`.
- Else if `leads.count > 0`: goes to `/leads/work`.
- Else: goes to `/calls/work` (empty-state lands on the import suggestion).

---

## §7. Migration of existing data

This layer ships against staging which currently has 10 cards in the `calling_list_item`
table (imported from the Austin law pilot).

After running 0021–0024:
- All 10 cards get `card_status='pending'`, `attempt_count=0`, `next_action_date=NULL`.
- The new `card_activity` table is empty (no calls logged yet).
- Zero risk to existing prospect/opportunity/assessment/demo_spec data — not touched.
- `lead_activity` is untouched — Layer 1 wizard's behavior is unchanged.

Smoke check after deploy: SELECT COUNT(*) FROM calling_list_item WHERE card_status='pending'.
Should be 10.

---

## §8. Build steps

Smallest-first, with a schema-review checkpoint after step 1.

### Step 1 — Schema (migrations 0021-0024)
Build and run the four migrations locally + staging. Smoke-check the table shapes after.
**STOP and report.** Operator reviews the actual columns and constraints before continuing.

### Step 2 — Queue endpoint + funnel-vital endpoint
Build `GET /api/admin/calls/queue` and `GET /api/admin/calls/funnel-vital`. No UI yet —
endpoints only, with tsc-clean tests of the SQL.

### Step 3 — Cold-call wizard (frontend)
Build `/calls/work` — the session-start screen + card-loop UI. Wire to the step 2 endpoint.
No log-action yet — the wizard renders cards but doesn't write activity.

### Step 4 — Log endpoint + wire actions
Build `POST /api/admin/calls/:id/log` with the full outcome-to-next-move logic (including
promote, book, pass). Wire the wizard's outcome+next-move buttons to it. End-to-end test:
log a voicemail, log a qualified-and-promote, log a book-from-card. Verify state changes.

### Step 5 — Dashboard updates
Add the Calls funnel-vital. Repoint the "Cold calling" station. Add the context-aware
header link. Verify the dashboard reads the new funnel-vital endpoint.

### Step 6 — Retire old surfaces
Redirect `/calling-list/today` to `/calls`. Deprecate `/admin/calling-list/today` endpoint
(stays as alias for one release). Update Header.svelte and any other entry points.

### Step 7 — Smoke + sign-off
Operator works 3-5 real cards through the new wizard (using the 10 imported cards as the
test set), tests all four outcome paths (pass, retry, promote, book), verifies the dashboard
funnel-vital updates correctly. Sign-off.

---

## §9. Open questions / decisions deferred

- **Industry-specific cadence.** Today the cadence defaults (§4.4) are generic. If
  estate-planning firms respond to a different voicemail cadence than immigration firms,
  Alice would learn that at L4. Punt for now.
- **Multi-attempt-per-day.** Today a card can be called multiple times in a single day
  (the wizard doesn't prevent re-dialing). If we want a "don't call again until tomorrow"
  guardrail, that's a future hardening.
- **Bulk operations.** The wizard works one card at a time. Bulk disqualify (e.g. "mark
  all of batch X as disqualified") isn't in scope.
- **Source-batch reporting.** Alice will eventually query "which source batches book best."
  No reporting UI in this layer — data flows in, reports come later.

---

*End of Calls layer spec. Sign off on §1 (model), §3 (schema), §4 (wizard) before step 1
dispatch.*

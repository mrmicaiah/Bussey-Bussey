# Studio44 — Dashboard build spec (the funnel-health + work-stations home screen)

**Status:** Design approved on paper (dashboard prototype signed off; thresholds, readiness pills,
demo lifecycle and timestamps all locked with the operator). NOT yet built. This is the authoritative
build spec. The build chat dispatches the worker against THIS document.

**Read first:** `prompts/studio44-master-spec.md` (the "dashboard pulse" mentioned in §7 and the core
principles) and the Layer 1 + Layer 2 specs (this dashboard reads everything they built). The reskin
foundation pass (just landed) means the dashboard inherits the Studio44 dark palette automatically;
do NOT redeclare local tokens. Where this spec conflicts with the master, the master wins — FLAG,
don't silently resolve.

**Goal:** the dashboard is the operator's home base — a *steering wheel*, not a tasklist. Two halves:
(1) the funnel's vital numbers (Leads → Prospects → Presentations) with health signals, and (2) four
work stations the operator goes into to keep the funnel flowing. The system *suggests* where to work
based on funnel health; the operator decides. Self-regulating: when presentations is thin, the
cold-calling station pushes its target up.

**Carry-over principles (unchanged):**
- Operator language only — Prospects, assessments, Presentations. No client/opportunity/proposal
  surfaced.
- Alice designed in, wired later — dashboard has dormant Alice affordances (the open assessment slots
  she fills, scheduling intelligence, etc.); NO Alice tools or model calls in this layer.
- Over-track. The dashboard adds `built_at` / `handed_off_at` timestamps to demo_spec specifically so
  the build-cycle length is queryable (Alice reads it later).
- Dark Studio44 styling — inherits the global tokens from the just-landed reskin foundation. No new
  local palette. The existing `app.css` tokens (`--bg`, `--surface`, `--accent`, etc.) and the badge
  system already provide what the dashboard needs.
- Worker commits, never pushes. Frontend push auto-deploys staging frontend; worker needs manual
  deploy; migrations applied manually to staging D1.

---

## 1. What this layer does (3 concerns)

### 1.1 Top half — the funnel as vital numbers
Three count panels side by side, in funnel order, with health signals:

**Leads.** Count of `lead` rows with status NOT IN ('converted', 'disqualified') AND `do_not_call`=0
AND `is_dead_number`=0 — i.e. callable leads. Show the big number, plus:
- `+N this week`: new leads added in the last 7 days (compare to created_at). Green delta.
- `callable now: N`: same callable count broken out smaller (for now identical to the big number; later
  it can split into "callable today" vs "all callable" if useful).

**Prospects in funnel.** Count of clients with status='prospect' that have an open opportunity (the
Layer 1 booking pattern). Show the big number, plus a breakdown:
- `N digging`: prospects whose *latest active* assessment is mode='dig'.
- `N building pitch`: prospects whose latest active assessment is mode='build_pitch'. Color this
  segment amber/`--warning` — these are closer to close.
- `avg in funnel: N days`: average days since the opportunity's created_at across active prospects.

**Presentations upcoming.** Count of upcoming presentations — defined as: opportunities under
prospect-clients where the most recent *completed* assessment was mode='build_pitch' AND a `demo_spec`
exists AND the proposal status is NOT in {accepted, lost} (i.e. the deal is still in flight toward
a close). Show the big number, plus:
- Health label tied to the threshold (see §1.2).
- `next: <prospect company>, <day & time>`: the soonest upcoming presentation's prospect + scheduled
  date — derived from the most recent *booked* assessment under that opportunity.

**Funnel-health thresholds (locked):**
- Presentations: ≤ 2 → **crimson** ("running thin"); = 3 → **amber** ("watch this"); ≥ 4 → calm.
- Prospects: ≤ 5 → **crimson**; ≤ 8 → **amber**; ≥ 9 → calm.
- Leads: no threshold this version (always calm).

When Presentations is crimson, render a one-line system note under the trio: *"Presentations is thin —
cold-calling target raised to keep the front fed."* This is the visible link between funnel health
and the cold-calling station's behavior (§1.2).

### 1.2 Bottom half — four work stations
Each station is a card that opens to its destination. Stations:

**A. Cold calling & outreach (primary station — sized larger / crimson-shadowed when it's the priority).**
- This week's count: `M of N calls` where N is the *suggested target* (see below) and M is the count
  of `lead_activity` rows with kind IN ('call', 'callback', 'voicemail', 'no_answer') for the
  authenticated operator in the current ISO week.
- A "feed the pipe" amber chip appears when the system is suggesting cold-calling is the priority
  (i.e. Presentations is amber or crimson per §1.1).
- A horizontal progress bar (M/N) tinted crimson when the station is the priority.
- A **"Work"** primary-crimson button → routes to `${base}/leads/work`.
- A **push-target control** (the operator-confirmed feature): a card section labeled "Suggested
  target (push it if you're up for it)" with `–` and `+` buttons around the current target. The
  default suggested target is **25 calls/week**. When Presentations is **crimson**, the system raises
  the suggested target to **40 calls/week** automatically. When Presentations is **amber**, **30
  calls/week**. The operator can `+`/`–` from there in steps of 5 (range 5..100); their override
  persists for the current ISO week (one row per operator per week — see §3 schema). Below the
  control: *"default <D> • raised to <S> because presentations is <state>"* when the system has
  raised it, OR *"default 25 • your push"* when the operator has manually overridden, OR *"default
  25"* on a calm week.

**B. Today's appointments.**
- Header: "Today · appointments" with a small count line "N booked · M open" (4 slots total).
- Four two-hour slots Mon–Fri, ranging **10–12, 12–2, 2–4, 4–6**. (Weekends: render the card as
  "No appointments — weekend" or similar; do NOT render the slot rows.)
- For each slot, render either:
  - **Booked**: prospect company + assessment label (e.g. "Assessment 4 · pitch" with the mode tinted
    amber for pitch, default for dig). Whole row links to the prospect workspace
    (`${base}/prospects/<opportunity_id>`).
  - **Open**: italic muted *"open — Alice can book"* — this is Alice's dormant scheduling slot. NO
    Alice wiring this layer; just the slot. Operator can still manually book via the normal flows
    elsewhere.
- A slot is "booked" if an `assessment` row has `scheduled_at` falling inside that slot's window
  AND status IN ('booked', 'in_progress'). Resolve overlap by taking the soonest scheduled row.

**C. Research & prep.**
- Header: "Research & prep" with an amber `N waiting` chip.
- Per-*assessment* entries (operator-confirmed: per-assessment, not per-prospect). The list is:
  upcoming `booked` assessments where the *previous* assessment in the same opportunity (by
  sequence_number) has non-empty `notes_research_needed` (dig mode) OR non-empty `build_to_price`
  (build-pitch mode — the prep before a presentation IS reviewing what to price). Plus the *current*
  in-progress assessment if it has research notes that haven't been "addressed" — but addressing is
  Alice's L4 thing; in this layer just show every upcoming assessment that has unmet prep on its
  predecessor.
- Each row: `<prospect company> — <prep type>` + `by <day & time>` (the upcoming assessment's
  scheduled_at). Limit to the next 5; show "+ N more" if longer.
- A "Work the prep →" secondary button routes to a prep working surface (see §2.2 — minimum: route
  to the prospect workspace of the *upcoming* assessment so the operator can review the prior
  meeting's research and add their own notes).

**D. Presentations.**
- Header: "Presentations" with a status chip: `1 not ready` (crimson) when any upcoming presentation
  has any pill not green; calm otherwise.
- Per-upcoming-presentation entries: prospect company, "<day> · in N days" (relative to today), and
  the three **readiness pills** (right-aligned):
  - **spec** — green if `demo_spec.body` is non-empty; crimson otherwise.
  - **demo** — three states (operator-confirmed lifecycle): **crimson** if `demo_spec.status` ∈
    {draft, ready}; **amber** if status = 'handed_off' (with the Studio87 manager, waiting); **green**
    if status = 'built'.
  - **price** — green if any `proposal_line_item` under the prospect's draft proposal has
    `unit_price_at_snapshot > 0`; amber if line items exist but all are 0; crimson if no line items.
- Each row links into the prospect workspace's handoff section.
- A "Work the pitches →" secondary button — routes to a presentations index (see §2.3).
- Inline action on the demo pill **when it's amber** (`handed_off`, waiting on the build): a small
  "Mark built" link/button right on the dashboard — operator-confirmed surfacing. Tapping it
  transitions the demo_spec to `built` and records `built_at` server-side. Confirmation dialog
  before firing (it's a state transition the operator owns).

---

## 2. Routes & destinations

The dashboard already exists as `(authed)/+page.svelte` (the pre-existing pending-activation
content). Layer 1's pass-1 reskin left its layout untouched but globally retoken'd; this layer
**replaces** the dashboard's content entirely with the funnel+stations layout. The Header's
"Dashboard" link continues to point here.

### 2.1 The Cold-calling station target — server side, not client
The push target is *per-operator, per-ISO-week*, persisted (see §3). Without persistence, the
override resets on refresh, which would surprise the operator. Server-stamped.

### 2.2 Research & prep destination
The "Work the prep →" button routes — for V1 — to the *first* upcoming assessment's prospect
workspace (so the operator reviews the prior research and preps). A dedicated prep-station route
(`${base}/prep` or similar) is a future enhancement; do NOT build it now. The dashboard rows are
each individually clickable to their prospect workspace — that's enough access.

### 2.3 Presentations destination
The "Work the pitches →" button routes — for V1 — to the soonest upcoming presentation's prospect
workspace handoff section (`${base}/prospects/<opportunity_id>#handoff` or equivalent — pick the
simplest in-page anchor). A dedicated presentations-station route is a future enhancement; do NOT
build it now. Individual rows link to their prospect workspace.

---

## 3. Data model (migrations 0017+; review before building)

Same conventions as Layer 1/2 — TEXT PKs, ISO-8601 UTC via `strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
CHECK enums, named `idx_*`, IF NOT EXISTS, the 0008/0013/0015 rebuild pattern for any enum/column
change to an existing table. Match the file split style.

### 3.1 `demo_spec` — extend (rebuild per pattern; preserve all rows)
Add to the existing enum: `built`. Final status enum: `draft`, `ready`, `handed_off`, `built`.
- Add `handed_off_at` TEXT NULL — server-stamped when status moves to `handed_off`.
- Add `built_at` TEXT NULL — server-stamped when status moves to `built`.
- Status transition rules (enforced server-side in §4):
  - draft → ready: any time the operator marks the body ready.
  - ready → handed_off: when the operator hands it to a Studio87 manager. Stamps `handed_off_at`.
  - handed_off → built: when the operator confirms the demo is built/uploaded. Stamps `built_at`.
  - Allow backwards transitions ONLY to the immediately-prior state (built → handed_off, etc.) for
    correction — reject skips with a 4xx. Clearing timestamps on a backwards transition: leave them
    set (audit-trail integrity); add a small comment in code explaining why.

### 3.2 `cold_calling_target` — NEW (the operator's per-week target override)
- `id` TEXT PK
- `admin_user_id` TEXT NOT NULL → `admin_user(id)` ON DELETE CASCADE
- `iso_week` TEXT NOT NULL — ISO-8601 week string `YYYY-Www` (e.g. `2026-W22`).
- `target` INTEGER NOT NULL — the operator's set value (5..100, validated).
- `created_at`, `updated_at` TEXT.
UNIQUE (`admin_user_id`, `iso_week`) — one row per operator per week.
Index `(admin_user_id, iso_week)`.

The *suggested* target (25 / 30 / 40 based on funnel state) is computed on read, not stored. The
operator's override, if any, supersedes the suggestion for that week.

### 3.3 No proposal/opportunity/assessment schema changes
Everything else is reads + computations off existing tables.

---

## 4. API / worker work

All endpoints scoped to authenticated operator (ctx.session, 401 if absent). Match Layer-1/2 admin
routing conventions.

### 4.1 Dashboard read endpoint — `GET /api/admin/dashboard`
Single endpoint that returns the entire dashboard payload (saves N round-trips on the most-visited
page). Response shape:

```
{
  funnel: {
    leads: { total, this_week_delta, callable_now },
    prospects: { total, digging, building_pitch, avg_days_in_funnel, health: 'calm'|'amber'|'crimson' },
    presentations: {
      total, health: 'calm'|'amber'|'crimson',
      next: { company, scheduled_at } | null
    }
  },
  stations: {
    cold_calling: {
      calls_this_week: M,
      suggested_target: N,        // 25 / 30 / 40 based on funnel state
      effective_target: N or override, // operator's override if set this week, else suggested
      override_active: boolean,
      iso_week: 'YYYY-Www',
      reason: string              // "raised to 40 because presentations is thin" | "your push" | "default"
    },
    today_appointments: {
      is_weekday: boolean,
      slots: [
        { window: '10-12', booked: { opportunity_id, company, assessment_label, mode } | null },
        ...four slots if weekday
      ]
    },
    research_and_prep: {
      waiting: [
        { assessment_id, opportunity_id, company, prep_type: 'pitch prep'|'<topic> research'|'price prep',
          due_at: scheduled_at of the upcoming assessment }
      ],   // limit 5
      total: N
    },
    presentations: {
      upcoming: [
        { opportunity_id, company, scheduled_at,
          spec: 'green'|'crimson',
          demo: 'green'|'amber'|'crimson',
          price: 'green'|'amber'|'crimson',
          demo_spec_id, demo_spec_status }
      ],   // limit 5
      total: N,
      not_ready: N
    }
  }
}
```

Health labels are server-computed using the thresholds in §1.1. `prep_type` is derived: if the prior
assessment was build_pitch → 'pitch prep'; if dig with research_needed → '<industry> research' or
just 'research'; pre-presentation prep specifically when the upcoming assessment is the presentation
itself → 'pitch prep'.

### 4.2 Cold-calling-target write — `PUT /api/admin/cold-calling-target`
- Request: `{ target: number }` (validated 5..100).
- Computes the current ISO week server-side, UPSERTs `cold_calling_target` for (operator, week).
- Returns the updated `{ effective_target, override_active }`.
- Atomic, audit-logged.

### 4.3 Demo-spec status transition — `PUT /api/admin/demo-specs/:id/status`
Specialized endpoint for the lifecycle transitions (clearer than overloading the existing
`PUT /api/admin/demo-specs/:id`). The existing endpoint continues to handle `body` updates.
- Request: `{ status: 'draft'|'ready'|'handed_off'|'built' }`.
- Server validates the transition is one step forward (or one step back). Reject skips/invalid with
  409 `invalid_transition`. Server-stamps `handed_off_at` / `built_at` on the corresponding moves.
- Atomic single DB.batch (UPDATE + audit). Returns the updated demo_spec.

The existing `PUT /api/admin/demo-specs/:id` from Layer 2 step 6 stays — it accepts `{ body?, status? }`
today; either (a) keep it accepting status for now and add the new specialized endpoint alongside, OR
(b) drop status from it and route all transitions through the new endpoint. PICK (b) — single
canonical path for transitions; the broader endpoint becomes body-only. FLAG if you keep (a) for any
backward-compat reason.

### 4.4 The "Mark built" dashboard action
Uses §4.3 directly: dashboard's Mark-built control POSTs `{ status: 'built' }` to the demo-spec
status endpoint, then re-fetches the dashboard read. Confirmation dialog before firing.

### 4.5 Types
Update `admin/src/lib/types.ts` for the full dashboard response shape, the cold-calling-target
request/response, and the demo-spec status request/response.

---

## 5. Frontend work

`admin/src/routes/(authed)/+page.svelte` — REPLACE the existing dashboard content entirely. Inherits
the global Studio44 tokens (no local palette). Structure exactly as prototyped:

- Top: funnel row (3 cards), conditional one-line system note when Presentations is crimson.
- Bottom: 4-station grid (cold-calling sized prominent + crimson-shadowed when priority; the other 3
  equal). Each station as described in §1.2.
- The cold-calling card's +/- target control is functional, debounced (e.g. 300ms after the last
  click → PUT /api/admin/cold-calling-target). Optimistic UI: update the displayed number
  immediately, surface an inline error and revert on failure.
- The Mark-built control on amber demo pills: small inline button, opens a confirm dialog ("Mark
  demo built for <company>?"), POSTs the status transition, refetches the dashboard.
- Loading state: skeleton or muted "Loading…" — the full payload is one round-trip so this should be
  brief.
- Empty states: a calm message per station when there's nothing (no calls yet, no appointments, no
  prep waiting, no presentations) — no scary empty UI.

No new routes needed. The existing Dashboard route is replaced; nav already points here.

**What NOT to touch this layer:**
- The reskin foundation pass already landed; do NOT re-skin or modify shared components.
- Do NOT build Layer 2 passes 2/3/4 (list/detail/proposal screens) — leave them as the reskin
  foundation left them.
- Do NOT wire Alice anywhere. The "open — Alice can book" slot text is a static label.
- Do NOT add new nav items or change the header.

---

## 6. Alice-readiness checklist (build the room)

- ✅ `today_appointments.slots` returns open slots first-class — Alice's L4 scheduling writes into
  this shape directly (create an assessment row inside the slot's window).
- ✅ `demo_spec` lifecycle includes `handed_off` and `built` with server-stamped timestamps — the
  build-cycle length is queryable for Alice to learn how long demos typically take.
- ✅ Cold-calling suggested target is a server-side function of funnel state — Alice can later
  refine the suggestion algorithm (e.g. include conversion-rate dynamics) without changing the
  client.
- ❌ No Alice tools, model calls, scheduling logic, or interrogation in this layer.

---

## 7. Deploy reality
- Worker COMMITS, never pushes. Operator pushes manually.
- Push auto-deploys frontend. Worker (API) changes need manual `wrangler deploy --env staging`.
- New migrations (0017 demo_spec lifecycle extension; 0018 cold_calling_target) applied manually to
  staging D1 via `pnpm exec wrangler d1 migrations apply bussey-bussey-staging --env staging --remote`.
- Build/typecheck must pass before commit. Commit, do not push. Report unpushed commit count.

## 8. Suggested build order (smallest-valuable-first)
1. Migrations 0017+0018 (demo_spec lifecycle extension + cold_calling_target) + types. Build/
   typecheck. STOP for operator schema review.
2. Read endpoint: `GET /api/admin/dashboard` (no writes). Verify the payload shape against the
   prototype before any UI.
3. Frontend: replace `(authed)/+page.svelte` with the funnel + stations layout, consuming the read.
   Cold-calling +/- inert this step (display-only — show effective_target from server, no PUT yet).
   Mark-built inert this step.
4. Cold-calling target write (`PUT /api/admin/cold-calling-target`) + wire the +/- buttons (optimistic
   UI, debounced, error-revert).
5. Demo-spec status transition (`PUT /api/admin/demo-specs/:id/status`) + the dashboard's Mark-built
   action + the workspace's status control. Also: refactor the existing demo-specs PUT to be body-only.

Each step: commit, do not push; report what a push/deploy would do.

---

## Appendix — explicitly OUT of this layer

A dedicated `/prep` station route, a dedicated `/presentations` station route, Alice tools or model
calls, scheduling automation, new nav items, list/detail/proposal reskin work (those are reskin
passes 2/3/4), Layer 3 (Clients workspace), the task entity (deferred from Layer 2's master scope).
Build the dashboard only.

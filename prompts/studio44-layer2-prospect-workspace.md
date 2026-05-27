# Studio44 — Layer 2 build spec: the Prospect workspace (the assessment loop + Alice handoff)

**Status:** Design approved on paper (three prototypes signed off: dig-mode workspace, build-pitch
mode, completion handoff). NOT yet built. This is the authoritative build spec for Layer 2's FIRST
slice. The build chat dispatches the worker against THIS document.

**Read first:** `prompts/studio44-master-spec.md` (master) and `prompts/studio44-layer1-leads-wizard.md`
(Layer 1, now built & deployed). This implements the Prospect-workspace portion of master §7 Layer 2.
Where this spec and the master disagree, the master wins — FLAG, don't silently resolve.

**Scope of THIS slice (operator-confirmed):** the Prospect workspace (the assessment loop, dig mode +
build-pitch mode + the mode flip) and the Alice handoff (the dormant interrogation slot + the two
output containers: a linked proposal and a new demo-spec-prompt entity). EXPLICITLY OUT of this slice,
to be designed separately later: the **task entity** and the **dashboard pulse**. Do NOT build tasks or
the dashboard pulse. They were filed under Layer 2 in the master but are a later designed slice.

**Carry-over principles (unchanged from Layer 1):**
- Operator language only — Prospect, assessment, "the dig," "build the pitch." Never expose
  opportunity/client/proposal mechanics as operator actions. The conversion already happened invisibly
  at booking (Layer 1).
- Alice designed in, wired later. NO Alice tools / model calls / interrogation logic in this layer.
  Build the dormant slots + the structured data + the output containers she fills at L4.
- Over-track. Per-assessment notes are structured (per-mode fields), the mode flip is a recorded event,
  and the demo-spec + proposal link are first-class so Alice's L4 outputs have real homes.
- Dark Studio44 styling scoped to the new Layer 2 screens ONLY. Do NOT do the global reskin, do NOT
  touch app.css tokens, do NOT restyle existing screens. (Reskin is the final phase.)
- Worker commits, never pushes. Frontend push auto-deploys staging frontend; worker needs manual
  `wrangler deploy --env staging`; migrations applied manually to staging D1. Tell the operator what a
  push/deploy does before it happens.

---

## 1. The funnel model this layer implements (corrected from operator interviews)

The funnel is a LOOP WITH AN EXIT, not three sequential stages:

```
[Assessment (dig): Heard/Learned + Research needed + Notes → book the next] × N
        │  (in a meeting, the client signals buying intent: "what would that cost?")
        ▼  operator FLIPS the toggle  +  books the next appointment (the presentation) before hanging up
[Assessment (build-pitch): What gets built / Emphasize / Doesn't matter / To price + free notes]
        │  operator completes the meeting
        ▼  HAND TO ALICE
Alice (L4) interrogates the operator on scope → produces:
        (a) a priced PROPOSAL (existing entity, draft, line items vs rate card)
        (b) a DEMO-SPEC PROMPT (new entity — a prose brief a Studio87 manager builds a demo from)
        ▼
[The presentation — already booked] → present demo + proposal → close → build
```

Key facts that shape the build:
- **"Assessment" = the client-facing word; structurally every meeting is an appointment in a sequence.**
  The `assessment` entity (Layer 1) already has `sequence_number` — that sequence IS the funnel thread.
- **The mode flip is forward-only and recorded.** Flipping does NOT convert already-written dig notes
  into build notes. Dig assessments keep their dig notes; from the flip forward the operator writes
  build-capture notes. Each assessment records the mode it was completed in.
- **The presentation is always already booked before the handoff.** The operator books the next
  appointment in the call (both modes — the loop never lets you leave without the next set). So
  completing a build-pitch meeting is PURELY the handoff to Alice; it is NOT also a booking action.
  Alice preps against an already-set presentation date (a deadline, not an afterthought).
- **The proposal is the EXISTING proposal entity** (see specs/02-data-model.md), not a new one. The
  handoff links/creates a real `proposal` (status `draft`) under the prospect's opportunity, with line
  items against the rate card. `proposal.demo_enabled` already exists.
- **The demo-spec prompt is genuinely new** — prose, not structured requirements; a brief to a builder.

---

## 2. Approved UX (3 prototypes, signed off) — canonical screens

Build in the Studio44 dark look (sharp black #0a0a0b family, crimson #d40b1e, white/zinc, amber for
attention). Scope styling to the new files.

### 2.1 Prospect workspace — dig mode (PROTOTYPED)
- Reached from a prospect (a client+opportunity created at Layer 1 booking; operator sees "Prospect",
  never client/opportunity). Layer 2 builds the route to GET there — see §5 (the prospect needs an
  entry point; a Prospects list/route is in scope as the minimal way to open a workspace).
- Header: Studio44 brand / "Prospect" / prospect name; assessment count; days-in-funnel.
- Identity row: company, contact, industry. The **mode toggle top-right**: "Digging" | "Build the pitch",
  with the hint "flip when the client signals 'what would that cost?'".
- Left rail: **the meeting thread** — the ordered assessment sequence (completed = green, in-progress =
  crimson "you are here", next = dashed/unbooked). One-line summary per past assessment.
- Center: **current assessment's notes**, THREE fields in dig mode, in this order:
  1. **Heard / Learned**
  2. **Research needed** (tagged "Alice acts on this")
  3. **Notes** (loose)
  Each field is an EXPAND/CONTRACT auto-growing textarea (see §2.4 — this behavior is required).
- Center action: **"Complete & book the next"** — completing a dig assessment requires setting the next
  appointment's date/time (the loop discipline). Plus a Save (save-without-completing).
- Right: **Alice prep slot** (dormant, "wires in L4") — framed as the researcher reading "Research
  needed" between meetings. Plus a "captured per assessment" strip (heard/learned, research, notes,
  sequence #, outcome, mode at completion).

### 2.2 Prospect workspace — build-pitch mode (PROTOTYPED)
- Same screen, after the operator flips the toggle. Toggle now shows "Build the pitch" active.
- The thread records WHERE it turned (a "turned to pitch here" marker on the assessment where the flip
  happened; the next slot is labeled "The presentation").
- The note fields CHANGE (forward-only; dig notes on prior assessments are untouched) to FOUR build-capture
  fields + a free-form notes field, in this order:
  1. **What gets built**
  2. **What to emphasize** ("what the client cares about")
  3. **What doesn't matter** ("where not to spend effort") — its own field; the operator called this out
     as half the value. Do NOT merge it into another field.
  4. **To price out** ("line-item fodder for Alice")
  5. **Notes** (free-form, loose — operator explicitly wants this; the four fields are a grey area, the
     free-form catches everything else)
  Same expand/contract behavior on all five.
- Center action in build-pitch mode: **"Complete → hand to Alice"** — NOT a booking action (the
  presentation is already booked). Completing hands the notes to the handoff (§2.3). Plus Save.
- Right: Alice slot changes character to "standing by" — on completion she interrogates, prices, specs.

### 2.3 Completion handoff (PROTOTYPED) — Screen 2
- Shown after a build-pitch assessment is completed. Header shows the **already-booked presentation**
  date (top-right) — reinforces that booking happened in the call, prep happens after.
- A completion banner: "Assessment N complete — pitch-mode meeting handed to Alice."
- Left: **Alice's interrogation panel** — DORMANT ("wires in L4"). Show an explicitly-labeled
  *illustrative* preview of the grilling Q&A so intent is clear, marked "illustrative; Alice is not
  wired in this layer." Plus the fallback note: until Alice is wired, the operator can fill the proposal
  & demo spec BY HAND — the containers work either way. (This manual-fallback usability is required —
  the layer must be useful before Alice exists.)
- Right: **Alice's two outputs, as containers ready now:**
  - **Priced proposal** — the EXISTING proposal entity. The handoff creates (or links, if one exists) a
    `proposal` in `draft` under the prospect's opportunity. Show line items (seeded from the "to price"
    notes as draft/empty-priced rows the operator or Alice fills) against the rate card. "Open proposal"
    routes into the existing proposal editing flow. DO NOT reinvent proposals — link to what exists.
  - **Demo-spec prompt** — the NEW entity (§4.1). Prose brief to a Studio87 manager: what to build, what
    to emphasize, what doesn't matter, the value to land. "Edit demo spec" opens an editor on it. In this
    layer it's operator-editable prose; Alice authors it at L4.

### 2.4 Expand/contract note fields (PROTOTYPED — required behavior)
Every assessment-notes field (3 dig + 5 build-pitch) is:
- An **auto-growing** textarea: height follows content, NO inner scrollbar, grows as you type. Short
  notes stay compact; long dumps open right up.
- **Collapsible**: a section header toggles the field open/closed. Collapsed = single header line (with a
  quick filled/empty or char-count indicator). Lets the operator give one field the screen while writing
  and collapse the rest for scanning.
Build this as a reusable component used by both modes.

---

## 3. Backend gaps Layer 2 must close

1. The `assessment` entity (Layer 1) has only a single `outcome_notes` TEXT + status. It needs:
   structured per-mode notes, a **mode** (dig | build_pitch), the mode-flip recorded, and richer status
   (the working lifecycle: booked → in_progress → completed, plus the existing no_show/canceled/
   rescheduled). See §4.2.
2. No **demo-spec-prompt** entity exists. Create it (§4.1).
3. The proposal entity EXISTS and is rich — Layer 2 does NOT modify proposal schema. It links to it
   (create a draft proposal at handoff, seed line items from "to price" notes). Reuse the existing
   proposal creation/line-item services (the Layer 1 §5.1 refactor extracted composable cores for
   client/opportunity — check whether proposal creation has a similar reusable path or needs the same
   extraction; FLAG if it needs extraction, treat as part of this build).
4. Routes to reach a prospect workspace (a Prospects list + the workspace route). The funnel created
   prospects in Layer 1 (client+opportunity) but there's no operator-language way to open one and work
   it. Minimal Prospects list in scope.

---

## 4. Data model (migrations 0015+; review before building)

Conventions: match 0001/0008/0013 exactly — TEXT PKs (worker crypto.randomUUID()), ISO-8601 UTC via
strftime, CHECK enums, named idx_*, SQLite rebuild pattern for any enum/column change to an existing
table, IF NOT EXISTS. One concern per migration file from 0015. Worker proposes the split; shapes below
are the contract.

### 4.1 `demo_spec` — NEW entity (the brief to a Studio87 manager)
- `id` TEXT PK
- `opportunity_id` TEXT NOT NULL → `opportunity(id)` ON DELETE CASCADE (the prospect's deal)
- `assessment_id` TEXT NULL → `assessment(id)` ON DELETE SET NULL (the build-pitch assessment that
  produced it — attribution back to the meeting)
- `body` TEXT NULL — the prose prompt (what to build / emphasize / ignore / the value). Free-form prose,
  NOT structured columns (operator was explicit: it's a prompt/brief, not a requirements form).
- `status` TEXT NOT NULL DEFAULT `draft` CHECK in: `draft`, `ready`, `handed_off` — its own lifecycle so
  it can move from draft → ready-to-build → handed-off-to-Studio87.
- `author_kind` TEXT NOT NULL DEFAULT `operator` CHECK in: `operator`, `alice` — who wrote it (Alice
  authoring at L4 is just this value; no special-casing — the L4 hook, mirrors script_variant.author_kind).
- `created_by_user_id` TEXT NULL → `admin_user(id)` ON DELETE SET NULL
- `created_at` TEXT NOT NULL DEFAULT now
- `updated_at` TEXT NULL
Index `(opportunity_id)`, `(status)`, `(assessment_id)`.

### 4.2 `assessment` — extend the Layer 1 entity (rebuild per 0008/0013 pattern; preserve data)
Add:
- `mode` TEXT NOT NULL DEFAULT `dig` CHECK in: `dig`, `build_pitch` — the mode the assessment is being
  worked in. New assessments start `dig`.
- Structured notes. TWO options — worker picks the cleaner, FLAG the choice:
  - (a) discrete columns: `notes_heard_learned`, `notes_research_needed`, `notes_loose` (dig) +
    `build_what`, `build_emphasize`, `build_ignore`, `build_to_price`, `build_notes` (pitch); OR
  - (b) a single `notes_json` TEXT holding a JSON object keyed by field, shape-validated in app code.
  LEAN: discrete columns — queryable, Alice reads named fields directly (matches the over-track,
  structured-not-blob principle). Use (a) unless there's a strong reason; flag if you deviate.
- `status` widen to include the working lifecycle: add `in_progress` to the existing enum
  (`booked`, `in_progress`, `completed`, `no_show`, `canceled`, `rescheduled`). booked → in_progress when
  the operator opens it to work; → completed on completion.
- `mode_flipped_at` TEXT NULL — timestamp the operator flipped dig → build_pitch on THIS assessment (null
  if it was never flipped / started as the mode it is). Records the flip event (operator wants it
  recorded; Alice reads it to know which notes are research-fodder vs build-spec-fodder).
- Keep `outcome_notes` (Layer 1) — may be repurposed as a completion summary or left; do not drop.
Reindex as before. Preserve all existing assessment rows (the Layer 1 booking-created #1 rows).

### 4.3 Proposal linkage — NO schema change
Do not alter `proposal`/`proposal_line_item`/`pricing_snapshot`. The handoff creates a `draft` proposal
under the opportunity and seeds line items. Reuse existing proposal services/creation logic. The
"to price" notes seed draft line items (component_code matched where obvious, else `custom_line_item`
with description_override = the note text — Alice refines at L4).

---

## 5. API / worker work
- **Prospects list read** — operator-language list of prospects (clients with status `prospect` + their
  open opportunity + assessment count + next appointment). Scoped to authed operator.
- **Prospect workspace read** — for a prospect: the assessment thread (ordered by sequence_number, with
  mode + status + a summary), the current assessment's structured notes, the booked next appointment,
  and any linked demo_spec + proposal (for the handoff state).
- **Assessment write** — save structured notes (per mode), set mode, record `mode_flipped_at` on flip,
  set status (in_progress/completed). Atomic (single DB.batch), audit per existing patterns.
- **Complete-dig** — completing a dig assessment requires the next appointment datetime → creates the
  next `assessment` row (sequence_number + 1, status booked, mode carries: a dig completion books the
  next as `dig`; if flipped, see complete-pitch). Reuse the booking/assessment-creation logic.
- **Complete-pitch (the handoff)** — completing a build_pitch assessment: mark it completed, then ensure
  the handoff artifacts exist — create a `draft` proposal (if none) under the opportunity with line items
  seeded from "to price", and create a `demo_spec` (status draft) linked to this assessment + opportunity.
  Does NOT book anything (presentation already booked). Atomic; reuse extracted proposal-creation core
  (extract if needed, like Layer 1 §5.1 — FLAG). Return the created/linked proposal_id + demo_spec_id.
- **Demo-spec write** — edit `body`, set `status` (draft/ready/handed_off). Operator-editable now.
- All scoped to authed operator (existing auth, ctx.session, 401 if absent). No new auth.
- Update types.ts mirrors for every new shape.

## 6. Frontend work
- New routes under the authed group: a **Prospects list** and the **Prospect workspace** (the dig/pitch
  modes on one screen) + the **handoff** view. Studio44 dark look, scoped styling (the .s44 wrapper
  pattern from Layer 1 — palette confined to new files; app.css untouched; no existing screen restyled).
- The reusable **expand/contract auto-grow notes field** component (§2.4), used by both modes.
- The **mode toggle** with the recorded flip; switching to build_pitch changes the visible fields
  forward-only and stamps mode_flipped_at on save/flip.
- The Alice slots: dormant prep slot (workspace) + dormant interrogation panel (handoff), both labeled
  "wires in L4", with the illustrative (clearly-labeled) preview on the handoff.
- The two output containers: proposal (links into existing proposal flow) + demo-spec editor.
- Reuse shared components where they fit WITHOUT forcing dark styling onto shared components used
  elsewhere (local variants if needed, per Layer 1).

## 7. Alice-readiness checklist for Layer 2 (build the room)
- ✅ Per-assessment notes stored as structured, named fields Alice can read (research-fodder vs
  build-spec-fodder distinguished by `mode` + `mode_flipped_at`).
- ✅ `demo_spec.author_kind` includes `alice` → her authoring is a no-schema-change extension.
- ✅ Demo-spec linked to the producing assessment + opportunity (attribution).
- ✅ Proposal is the real entity → Alice's L4 pricing writes into presentation-driving machinery.
- ✅ Dormant interrogation panel + manual fallback (usable before Alice).
- ❌ No Alice tools, model calls, or interrogation logic in this layer. None.

## 8. Build / deploy reality (tell the operator before any push)
- Worker COMMITS, never pushes. Operator pushes manually.
- Push to main auto-deploys the FRONTEND to staging. Worker (API) changes need manual
  `wrangler deploy --env staging`. A frontend push alone does NOT deploy the worker — the new
  workspace's reads/writes would 404 until the worker deploy.
- Migrations 0015+ applied manually to staging D1 (worker reports the exact command).
- Build/typecheck must pass before commit. Commit, do not push. Report unpushed commit count.

## 9. Suggested build order (smallest-valuable-first)
1. Migrations 0015+ (demo_spec; assessment extension) + types mirror. Build/typecheck. STOP for operator
   schema review (the expensive-to-change part — same checkpoint as Layer 1 step 1).
2. Read endpoints: Prospects list + Prospect workspace read (no writes) → prove the thread populates.
3. The workspace frontend (dig mode): thread + the reusable expand/contract notes + Alice prep slot,
   against real reads. The Prospects list to reach it.
4. Assessment writes: save notes, complete-dig (books next), status transitions.
5. The mode toggle + build-pitch fields + recorded flip (mode_flipped_at).
6. Complete-pitch (the handoff): create draft proposal + demo_spec; the handoff screen; demo-spec editor;
   proposal linkage. Last — it touches the most (proposal-core reuse, two entities).
Each step: commit, do not push; report what a push/deploy would do.

---

## Appendix — explicitly OUT of this slice
The **task entity** and the **dashboard pulse** (designed as a separate later slice), any Alice tool /
model call / interrogation logic, the close/contract/activation machinery (that's the existing
post-acceptance flow, not this layer), and the global Studio44 reskin. Build the Prospect workspace +
the Alice handoff only.

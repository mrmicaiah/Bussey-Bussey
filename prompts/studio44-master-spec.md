# Studio44 — Master Build Spec

**What this is:** the authoritative design document for Studio44, the operations tool that
Bussey & Bussey uses to run its business. This document is the handoff for a dedicated build
chat — it should contain everything needed to orchestrate the build without re-deriving
decisions. Read it fully before building anything.

**Status:** Design complete, build not started. The marketing site is built and live; the
public-facing Alice chat agent is built (see "Alice — current state"). Studio44 (the admin)
is the next major project.

---

## 1. The big picture

**Studio44** is the product: an AI-copiloted operations tool for working a sales/delivery
funnel. **Bussey & Bussey** is the company using it. (This separation matters for branding:
the app is "Studio44," not "Bussey Admin." Today the admin hardcodes "Bussey · Admin"
everywhere — that gets rebranded to Studio44.)

The admin app already exists and is fully built as a *database* — every entity, stage, and
CRUD screen is there. What it lacks is **workflow**: it makes you edit records by hand
instead of guiding you through the work. Studio44 is the transformation of that database
into a guided, AI-copiloted operations tool.

The current admin is a SvelteKit SPA (Svelte 5 runes, adapter-static, ssr=false) at `/admin`,
talking to the Cloudflare Worker API. Hand-rolled CSS with design tokens in
`admin/src/app.css`. See "Appendix A — current admin map" for the full inventory.

---

## 2. Core principles (these govern every decision)

1. **Studio44 speaks the operator's language, not the database's.** The operator thinks in
   **Lead → Prospect → Client**:
   - **Lead** = someone we want to win who hasn't taken our services yet (the cold-calling pool).
   - **Prospect** = someone in the assessment process (actively being worked).
   - **Client** = someone who has accepted a build (actual / paying).
   The database underneath uses lead / client / opportunity / proposal / project entities. The
   operator must NEVER have to think in those terms. The system does the entity plumbing
   invisibly. (Example: the operator never "creates an opportunity" — they book an assessment,
   and the system silently does the lead→client→opportunity conversion.)

2. **The system is the engine; the operator does the work it surfaces.** The operator should
   not have to hunt through lists and decide what to touch. They press **Work** and Studio44
   hands them the next thing to do, one at a time, like a wizard / coach. Next-best-action is
   the product, delivered as an experience, not a feature.

3. **Alice's hands on everything.** Alice (the company's AI agent — the same persona as the
   public site agent, see §4) is designed INTO every layer from the start, never bolted on.
   Even where she's not wired in yet, the data and structure are built so she can plug in
   cleanly. We design the room for her even before she stands in it. The vision: Alice is not
   an assistant *helping* with the work — she is **operator intelligence** that makes the whole
   operation smarter over time (she A/B tests what works, she values deals, she researches, she
   coaches). Spare no expense on her capability.

4. **Capability is unlimited; cost is engineered.** Alice should be deeply capable and
   everywhere — AND cheap to run. These are reconciled by architecture, not by limiting her.
   See §8 (Cost architecture): prompt caching of her large stable system prompt, model tiering
   (cheap model for trivial tasks, strong model only for real reasoning), and disciplined
   context per task. Design for this from day one.

5. **Problem-first, harsh-but-professional brand voice** carries into Studio44's copy and into
   Alice's coaching tone (see the marketing/Alice specs for the established voice).

---

## 3. The funnel & stations (the operator's mental model)

Work happens at **stations**. People move between them. The funnel:

**LEADS** (two stations)
- **Cold calling** — fresh, never-contacted leads (uploaded via calling list, from Alice's web
  chat, or manual). Goal: book an assessment.
- **Follow-ups** — previously contacted leads due for another touch. (Critical: ~93% of
  bookings happen after 6+ attempts — follow-ups matter as much as cold calls.)
  The SINGLE purpose of the Leads stations: **book assessments.** The scoreboard metric is
  "how many assessments booked." Book, don't pitch.

**PROSPECTS** (the assessment workspace)
- Booking an assessment converts a lead to a prospect (silently creating the client+opportunity
  records underneath) and asks only for **what matters** (assessment date/time, and optionally
  a value — which Alice can derive, see below).
- A prospect's workspace holds: **assessments** (one or more — see open decision on whether
  Assessment is first-class), **notes**, **logged calls**, and **tasks** (prep work between
  meetings: research what was discussed, prep the next meeting, draft a follow-up email).
- Everything here is motivated toward producing a **presentation**.

**CLIENTS** (presentations & closing)
- Book and build presentations (full software proposals — the existing proposal/calculator/
  presentation builder), present, and close.
- On accept → activate → build (project). This part largely exists but the flow needs cleanup
  (see Layer 3).

---

## 4. Alice — who she is and her current state

**Persona (already built & deployed for the public site):** Alice is an engaging AI
salesperson, the front door of Bussey & Bussey. She's openly an AI and uses that as proof
("I'm an example of what Bussey builds — I'm doing a real job right now"). Voice: engaging,
confident, a little provocative, direct, no hype, hard on the problem not the person. Greeting:
"I'm Alice, and I'm an AI — the same kind of thing Bussey builds for businesses like yours.
Think of this as a test drive. What's the problem you can't seem to fix?" Full persona in
`prompts/alice-agent-rewrite.md`.

**Current technical reality (important — don't overstate):** Today Alice is ONLY a public web
chat. She runs on `claude-sonnet-4-6` via the Worker (`worker/src/services/claude.ts`,
`runChatTurn`, 4-iteration tool loop), with ONE tool: `save_lead` (capture-and-handoff). She
has no admin-side capabilities at all. She cannot read leads, write notes, create tasks, read
the rate card, value deals, or coach. **Everything in this spec about "Alice in the admin" is
NET-NEW backend work** — new tools, new context access, new surfaces. The spec marks per layer
what is "build now" vs. "Alice-ready hook (structure it now, wire Alice later)."

**Alice as operator intelligence (the target vision, across layers):**
- **Leads/coaching:** suggests real opener/hook/discovery/close script language per lead;
  monitors outcomes and A/B tests what works ("your '27 seconds' opener booked 4 of 12 this
  week; the soft opener 1 of 9 — lean on the first"). She turns every call into data and makes
  the operation smarter over time.
- **Valuation:** operator types what the client is looking for; Alice knows the pricing system
  (the seeded rate card / `pricing_components`), logs the need, and drops a valuation
  automatically. Operator never prices by hand.
- **Assessment scribe & researcher:** operator can message Alice WHILE talking to a client; she
  takes notes, assembles research on what this client needs, and creates tasks from the
  conversation.
- **Presentation/close support:** Alice answers questions from the full history of conversations
  with that customer, and on pricing. She's on call during prep and the close.

For Alice to do admin work she needs **admin-side tools**, e.g.: readLead/readProspect,
writeNote, createTask, scheduleFollowup, scheduleAssessment, readRateCard, valueDeal,
logCallOutcome, searchHistory. These are designed per layer. (She must be scoped so she only
acts within the authenticated operator's context.)

---

## 5. The Dashboard (mission control)

Two distinct jobs, visually separated:

**The Pulse** — funnel health at a glance: counts of who's in Leads / Prospects / Clients
(this shows the health of the company). The operator LOOKS at this. Possibly also: what's
overdue, assessments-booked-this-week scoreboard.

**The Work button** — one prominent action that drops the operator into the wizard (§6). The
operator ACTS through this. Possibly station-specific entry too ("Work Leads", "Work
Prospects").

The dashboard does NOT make the operator prioritize. The wizard does that.

---

## 6. The Work wizard (next-best-action engine)

Press Work → Studio44 hands you the next task, one at a time, with exactly the right screen
and actions for it — a wizard / coach that walks you through your day.

**Priority order (default):** overdue → due today → new. (Open to value-weighting later so
high-value prospects surface first.) Mostly-strict: it marches you through, but every item has
an easy **skip / snooze** escape so you're never trapped.

**The wizard pulls from across all stations:** calls due (cold + follow-up), assessments
scheduled, tasks due, presentations to send/follow-up, follow-ups owed. One unified prioritized
queue, fed one at a time.

This is the calling-list "today" experience (which already exists and is the app's north star
— card-based, one clear action set, progress counter) **extended across the entire funnel.**

---

## 7. The layers (build sequence — build in this order)

Build smallest-valuable-piece first. Do NOT try to build all layers at once.

### LAYER 1 — The Leads wizard (book assessments)
The highest-value slice; self-contained; ship first.

- **Work → calling session.** Choose Cold or Follow-ups. Batched session with a target
  ("book 3 assessments" / "make 20 calls"). One lead at a time, card/wizard style.
- **Each lead card:** who they are, company/industry, source, known info, **attempt count**
  (since 6+ touches matters), prior call notes, and the **call framework on screen**:
  Opener (15–20s, pattern interrupt + permission) → Hook (30–45s, specific outcome tied to
  their pain, not features) → Discovery (open questions, qualify) → Close (book the assessment,
  offer two specific times; do NOT pitch the deal). Show **real suggested script language**
  (not just structure) the operator can read or adapt.
- **One-tap outcomes:** Booked assessment · Call back later (schedule) · No answer · Left
  voicemail · Dead number · Do not call. Each advances the lead and serves the next card.
- **Booking an assessment** = the money moment. Asks for what matters: date/time, optionally a
  value. Silently does lead→prospect conversion (creates client+opportunity behind the scenes).
  Operator never sees "create opportunity."
- **Scoreboard:** assessments booked this session / week. The one metric that matters.
- **Backend gaps to fill (this is real work, not just UI):** leads currently have NO activity/
  call log of their own (calling_log only attaches to calling_list_item). Need a lead-level
  activity/timeline and the working actions. The clean calling-list→prospect handoff must
  collapse today's 4-step dance (log call → convert to lead → convert to client → create
  opportunity) into ONE motion.
- **Alice-ready hooks (structure now, wire Alice in Layer 4):** the call framework, lead
  context, and notes are stored as structured data Alice can read; there's a designated
  "coach panel" slot beside the call; outcomes/notes are captured as data she can analyze for
  A/B testing. Build the room; Alice arrives in Layer 4.
- **Alice-when-wired (Layer 4):** generates per-lead opener/hook suggestions; A/B tests
  outcomes; coaches live; can derive the value at booking from the rate card.

### LAYER 2 — The Prospect workspace + the Dashboard pulse
- **Prospect workspace** on the opportunity: multiple **assessments** (records with date/notes/
  outcome), **notes**, logged **calls**, and **tasks** (new concept — no task entity exists
  today). Everything oriented toward producing a presentation.
- **Dashboard pulse:** the Lead/Prospect/Client health view + scoreboard.
- **Backend gaps:** task entity (net-new); assessment as a record (see open decision); calls/
  notes on the opportunity.
- **Alice-ready hooks / Alice-when-wired:** Alice as scribe (operator messages her mid-meeting,
  she writes notes + creates tasks), researcher (assembles what this client needs), and
  valuer (logs the need, drops a valuation from the rate card).

### LAYER 3 — Presentation / close flow cleanup
- The proposal/calculator/presentation builder exists but is the messiest part (custom line
  items via `window.prompt()`, no clean "send/mark-sent" step, presentation is "previewed"
  never formally "launched"). Clean this into a proper book → present → close flow with a hard
  "sent" step and tracking.
- **Alice-when-wired:** answers pricing questions and questions from the full customer
  conversation history during prep and the close.

### LAYER 4 — Alice embedded as co-pilot (across all layers)
- Wire Alice into the hooks built in Layers 1–3: live coaching on calls + A/B testing,
  scribe/researcher/valuer in the prospect workspace, pricing/history Q&A at presentation/close.
- Requires the admin-side Alice tools (§4) and the cost architecture (§8).

### THEN — Studio44 reskin (do last, after the rebuilds)
- Rebrand "Bussey · Admin" → **Studio44** everywhere (Header, login card, all `<title>` tags).
- Apply the brand system: **sharp black background, crimson (#d40b1e family), white** — as a
  PRODUCT UI (dense, functional operator console), not a marketing-site look. The marketing
  site uses white-bg/crimson/Space-Grotesk; Studio44 is the DARK, dense counterpart.
- Re-derive the large status-badge palette (currently navy-based, hardcoded per status) and
  swap the `--accent: #1f3a5f` navy → crimson. Note: per-component `<style>` blocks are
  scattered across many files, so the reskin touches many files, not just `app.css`.
- Do the reskin LAST so we're not restyling components we're about to rebuild.

---

## 8. Cost architecture for Alice (design from day one)

Capability is unlimited; cost is engineered. Techniques to bake in:
- **Prompt caching:** Alice's large STABLE context (persona, pricing rules, playbook, company
  knowledge) is cached and reused across calls at a fraction of cost. Keep the stable prefix
  big and constant; keep the dynamic per-task suffix (this lead, this conversation) small.
- **Model tiering:** use a cheap/fast model for trivial tasks (classifying a call outcome,
  formatting a note, simple logging) and the strong model only for real reasoning (coaching,
  valuation, research, history Q&A).
- **Disciplined context:** hand Alice only the context a task needs, not everything. Structure
  data so relevant slices are cheap to fetch and pass.
- **Async where possible:** A/B analysis, research assembly, etc. can run in the background
  rather than blocking the operator.

---

## 9. Cold-calling best practices (grounding for Layer 1, from research)

- **Book, don't pitch.** The appointment-setter's only job is the next small step (the
  assessment), not closing or feature-dumping. The #1 mistake is confusing pitching with booking.
- **Structure:** Opener (15–20s: pattern interrupt + permission, e.g. "this is a cold call —
  got 27 seconds?") → Hook (30–45s: specific outcome tied to their pain) → Discovery (2–3 min:
  open-ended qualifying questions) → Close (offer two specific times; make yes easy).
- **Persistence:** ~93% of conversions happen after 6+ attempts → follow-ups are as important
  as cold calls; track attempt count.
- **Batching:** top performers batch calls into focused sessions with a target → the Work
  session has a visible goal.
- **Track dials → connects → appointments** → the scoreboard is assessments booked.
- **Scripts are flexible guides, not rote reads.** Delivery varies results wildly (same script,
  same list: one books 3%, another 12%). → suggested language Alice provides, adapted live, is
  exactly the edge.

---

## 10. Open decisions (the build chat should confirm before/early in build)

1. **Is "Assessment" a first-class entity?** Leaning YES — a record type (date/notes/outcome),
   several per prospect. The operator's model ("multiple assessments, notes, calls, tasks")
   supports this. Confirm and add the table/migration if so.
2. **Keep or hide the client layer?** The operator doesn't think in "client" as a station
   (everyone's a client, just potential→actual). DB requires lead→client→opportunity. Decision:
   keep the entities for plumbing, hide them in the UI language (Lead/Prospect/Client = the
   three human stages). Confirm the mapping: Lead = unconverted lead; Prospect = converted
   (client+open opportunity, in assessment); Client = opportunity accepted / build underway.
3. **Wizard priority weighting** — start with overdue→due-today→new; add value-weighting later?
4. **Alice tool scope & permissions** — exact admin-side tool list and how Alice is scoped to
   the authenticated operator's context.

---

## Appendix A — current admin map (as built today)

(Full read-only map produced by the worker; summarized here. The current admin is a working
database-style app.)

- **Stack:** SvelteKit SPA, Svelte 5 runes, adapter-static, ssr=false; Worker API over fetch
  (credentials:'include'); cookie session auth (admin_user roles owner/admin/sales/delivery,
  admin_session 24h/12h-idle); brand "Bussey · Admin" hardcoded.
- **Routes:** /login; / (dashboard: two nav cards + pending-activation aging panel);
  /leads, /leads/new, /leads/[id] (the form-style pain point); /clients, /clients/new
  (also lead-conversion target via ?from_lead=), /clients/[id] (tabs: Overview/Opportunities/
  Documents-placeholder); /clients/[id]/opportunities/new, /[opp_id] (richest page: edit +
  disposition + activation + change orders + proposal), /[opp_id]/proposal (the calculator/
  presentation builder), /change-orders/[co_id]; /calling-list/today (card/workflow-style —
  the north star), /calling-list, /calling-list/import (CSV).
- **Pipeline stage values (exact):** lead.status: new→reviewed→contacted→qualified→
  disqualified→converted. lead.source: chat|manual|referral|event|calling_list. lead.urgency:
  immediate|weeks|months|exploring. client.status: prospect→active→paused→former.
  opportunity.status: open→proposed→accepted/lost/paused. proposal.status: draft→sent→accepted
  (+superseded/declined). change_order, change_request, project (kickoff→active→paused/complete/
  canceled), portal_account.walkthrough_state, calling_list_item.status (pending→called/
  no_answer/followup/completed/disqualified/converted_to_lead).
- **Entity flow:** chat → save_lead → lead; calling_list_item + calling_log → convert → lead;
  lead → client (origin_lead_id); client → opportunity (1:many; holds presentation_token,
  value_setup/value_monthly, next_followup_date); opportunity → proposal (1:many; pricing_snapshot,
  line items ref pricing_components, modifiers, narratives); presentation = public render of the
  proposal at /p/:token (not a table); disposition = action on opportunity (accepted→activate→
  project+contract+portal_account; followup→next_followup_date; changes; declined→lost);
  change_order/change_request; billing via Stripe (webhook+portal, no admin UI).
- **What a lead carries:** status, owner_user_id (unused in UI), last_contacted_at (unused in
  UI), pain_summary, notes, urgency, contact/company/industry. NO per-lead next-step or
  follow-up-date field; NO lead activity/contact log.
- **Actions that exist:** edit/save fields; status dropdown; convert to client (contacted/
  qualified only); delete; view chat transcript; log call (calling-list ONLY); schedule
  follow-up (opportunities + calling-list ONLY); record disposition; preview presentation.
- **Actions that DON'T exist:** log call/text/email on a lead; lead activity timeline; schedule
  follow-up on a lead; assign/reassign owner in UI; tasks (no task entity anywhere); "next best
  action" / prioritization (except dashboard activation aging); formally "send" a presentation;
  assessment (no entity — pure business concept today).
- **Styling:** hand-rolled CSS, no framework; tokens in app.css :root (--accent #1f3a5f navy →
  swap to crimson; --bg #f7f7f5; large hardcoded status-badge palette); per-component <style>
  blocks scattered widely. Shared components: Header, Button, Field, ConfirmDialog,
  DispositionModal, LogCallModal, CredentialsHandoffModal, proposal/calculator set; api.ts
  (fetch wrapper), types.ts (hand-maintained mirrors).
- **Notable:** 501-stub endpoints (projects list/fetch, pricing-component CRUD except list,
  notifications, audit-log); audit_log written everywhere but no read UI; Documents tab is a
  placeholder; lead owner_user_id/last_contacted_at have data but no UI; no assessment entity;
  fuzzy "sent" step; calling-list/today is workflow-style (north star) while everything else is
  form-style — the redesign is largely extending the calling-list pattern over the rest;
  custom line items use window.prompt(); branding hardcoded in many places.

---

## Appendix B — related specs already in the repo
- `prompts/alice-agent-rewrite.md` — Alice's public persona, system prompt, greeting (built).
- `prompts/seo-content-plan.md` — marketing SEO plan (separate track).
- `prompts/article-handoff.md` — article production handoff (separate track).
- Marketing site specs (homepage, services, about/contact, etc.) — the established brand voice
  and the marketing-side design system (white-bg counterpart to Studio44's dark UI).

---

## Build-chat kickoff checklist
1. Confirm the open decisions (§10).
2. Re-read the current admin map (Appendix A) against the live code (`git pull` first; code may
   have moved).
3. Build Layer 1 (Leads wizard) first — design the prototype, get it approved, then build.
4. Remember the working model: worker commits but NEVER pushes; frontend auto-deploys on push
   to main (staging); worker changes need manual `wrangler deploy --env staging`. Design/approve
   on paper before building (the homepage thrash is the cautionary tale).
5. Carry Alice-readiness into every layer; build Alice herself in Layer 4 with the cost
   architecture (§8).

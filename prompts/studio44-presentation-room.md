# Studio44 — Presentation room build spec

**Status:** Design approved on paper (two prototypes signed off: the client-safe screen-share
surface, and the off-screen-share disposition tab with three outcomes). NOT yet built. This is
the authoritative build spec. The build chat dispatches the worker against THIS document.

**Read first:** `prompts/studio44-master-spec.md` (the core principles — operator language,
"clean" surfaces, no admin chrome in the room), the Layer 2 spec for the existing `demo_spec`
entity, and `specs/02-data-model.md` for the proposal/opportunity/activation flow (the
back-end mechanics this layer integrates with rather than reinvents). Where this spec
conflicts with the master, the master wins — FLAG, don't silently resolve.

**Carry-over principles (unchanged):**
- Operator language only — Prospect, Presentation, Close / Follow-up / No deal.
- Alice designed in, wired later — the room has no Alice slot (client-safe), but the seam
  where she fills the demo URL and curates the body is preserved via `author_kind`.
- Over-track. The disposition outcome, the reason for a No deal, and the demo URL fill-in are
  all structured/queryable.
- Studio44 dark global tokens — no local palette declarations; inherit from app.css.
- Worker commits, never pushes. Operator pushes manually.

---

## 1. What this layer does

The salesperson hosts a presentation meeting with the client. The room is the cockpit; the
client sees it on screen-share. When the meeting wraps, the salesperson clicks **Next** which
opens a *new browser tab* (the disposition screen) — off-screen-share — where they pick one
of three outcomes:

- **Close** → runs the existing `/activate` transaction (opportunity accepted, proposal
  accepted, client active, project created, contract rendered, portal account issued).
  CredentialsHandoffModal renders in that tab so the salesperson can email the portal link.
  All existing infrastructure; no reinvention.
- **Follow-up** → routes to the prospect workspace. The deal stays open. No state change.
- **No deal** → captures a lost reason (quick-pick + optional notes), marks the opportunity
  `lost`, atomic write.

The room itself is **always client-safe** — no Present mode toggle, no admin chrome to hide.
Tab 1 is *designed* to be screen-shared. Tab 2 is off-share by convention.

The brief (demo_spec.body) is an upstream artifact — instructions to the demo-building chat
that produces the embedded URL. It does **not** appear on Tab 1.

---

## 2. Approved UX (two prototypes, signed off) — canonical screens

Studio44 dark, inherits global tokens. No local palettes.

### 2.1 Tab 1 — the Presentation room (client-safe screen-share surface)

**Header:** "Studio44" brand only. No breadcrumbs, no admin chrome.

**Layout:** two-column grid. Left = demo (large, full-bleed). Right = 320px rail.

**Left — demo embed:**
- iframe of `demo_spec.demo_url`, full-bleed.
- A thin top bar over the demo with the URL displayed (so the salesperson can see what's
  loaded) and two controls: Reload, Pop-out (the fallback if the iframe gets blocked).
- If `demo_url` is null/empty: a calm "no demo URL set — open the prospect to set one"
  empty state with a deep link back to the prospect workspace.
- The iframe top-bar elements can be hidden on screen-share (they look fine but if the
  salesperson wants the demo edge-to-edge, allow a click to toggle them). Default: visible —
  the URL chrome reads as "this is the demo we built for you," not internal.

**Right — the rail (320px fixed):**
- **Meeting block (top, 18px padding):** company avatar circle (initials, crimson tint) +
  company name. That's it — no contact name, no "in the meeting" header (drop the back-officey
  label). One line, the prospect's identity.
- **The investment block:** a `--surface` card. Setup ($N) on top, divider, Monthly ($N/mo)
  below. Big numbers, calm chrome. **No `draft` badge, no "show line items" button** —
  totals only. (The line-item detail lives in the proposal editor; the room is the summary.)
- **Spacer (flex:1)** pushes the Next button to the bottom.
- **Next button (bottom, primary crimson, full-width):** "Next →" with arrow-right icon. On
  click: opens Tab 2 at `/prospects/[id]/disposition` (or the agreed route — see §5) in a new
  browser tab via `window.open(url, '_blank')`. The room itself stays open and live; the
  salesperson can flip back if needed (rare but possible).

**Nothing else on the rail.** No Alice slot. No brief. No status indicators. No "card dwell
time" or capture strip. The room is the show, not the cockpit.

### 2.2 Tab 2 — the disposition screen (off-screen-share)

**Header:** breadcrumb "Studio44 / <Company> / How did it go?" The breadcrumb is fine here —
client never sees this tab.

**Layout:** centered, narrow content column (~720px max-width).

**Top:** title "The meeting wrapped — what happened?" + subtitle "Pick the outcome. You can
come back to this prospect any time." (Soft framing — the screen isn't forcing a hot decision.)

**Three cards in a row (1fr 1fr 1fr grid, gap ~14px):**

1. **Close** — pre-emphasized visually (crimson border + soft crimson shadow). Card body:
   - Crimson circle icon (ti-check, white check on crimson).
   - Title "Close".
   - Description: "They said yes. Activate the deal — rolls out the client account, contract,
     and portal link to send."
2. **Follow-up** — amber/warning palette. Card body:
   - Amber circle (ti-rotate-clockwise icon, warning color).
   - Title "Follow-up".
   - Description: "Not yet, but alive. Back to the prospect — book the next move."
3. **No deal** — crimson-bordered danger card.
   - Danger-red circle (ti-x icon, danger color).
   - Title "No deal".
   - Description: "Mark the opportunity lost. Capture why — useful for Alice later."

**Footer strip below the cards:** small info note with i-icon — "Close runs the existing
activation — opens credentials handoff right here. Nothing fires until you pick." This is
reassurance: no premature firing.

Each card is fully clickable (whole card is the button surface). Clicking opens the
corresponding sub-flow below.

### 2.3 The three sub-flows on Tab 2

After picking a card, the disposition tab transitions to the chosen outcome's sub-flow.

**Close sub-flow:**
- Confirm dialog: "Close the deal for <Company>? This activates the account, creates the
  project, issues portal credentials."
- On confirm: POST `/api/admin/opportunities/:id/activate` (the existing endpoint — DO NOT
  reinvent). On success: the existing `CredentialsHandoffModal` renders in the tab —
  portal URL + email + temp password + "Copy" affordances + "Email to client" button (Resend
  through the existing endpoint). The salesperson clicks "Email to client" or copies/shares
  the credentials manually. Modal dismissible; after dismiss, the tab shows a calm
  "All set — <Company> is now active. The portal link has been sent." with a route back to
  the dashboard or the new client's surface.
- On failure: inline error in the confirm dialog, do NOT advance, allow retry.

**Follow-up sub-flow:**
- No state change. No write. Just routes the salesperson to the prospect workspace:
  `window.location.href = '/prospects/<opportunity_id>'`. The workspace knows what to do —
  the assessment loop, book the next meeting, whatever.
- (Open question for a later polish: a "book the next meeting" pre-pop affordance on the
  workspace when arriving from a Follow-up disposition. Not in scope for this layer.)

**No deal sub-flow:**
- A small lost-reason form on the tab:
  - **Reason quick-picks (radio or pill-select):** Price · Timing · Not a fit · Silent · Other
    ("Silent" = they ghosted; "Other" reveals a small text field).
  - **Notes field** (optional, free-form, expand/contract — reuse the NotesField component
    from Layer 2).
- A confirm: "Mark <Company> as no deal?"
- On confirm: POST `/api/admin/opportunities/:id/lost` (a new endpoint, see §4.3) with
  `{ reason, notes }`. Atomic: opportunity status → `lost`, captures `lost_reason` and
  `lost_notes`, writes an audit, sets `lost_at` timestamp.
- On success: a calm acknowledgement "Noted. <Company> moved to no-deal." with a route back
  to dashboard / prospects list.
- On failure: inline error, do NOT advance.

---

## 3. Backend gaps

1. `demo_spec` needs a `demo_url` column (new, nullable TEXT). The demo URL the salesperson
   pastes when the Studio87 chat returns one.
2. `opportunity` needs `lost_reason` + `lost_notes` + `lost_at` columns. The "lost" status
   exists already (verified in pass-4 worker investigation: the opportunity enum has `lost`);
   the columns to capture *why* and *when* don't yet exist. Add them.
3. New endpoint `POST /api/admin/opportunities/:id/lost` — atomic write of the No deal path.
4. The existing `/api/admin/opportunities/:id/activate` endpoint stays as-is. The room's Close
   path calls it unchanged.
5. The demo_spec PUT (body-only after dashboard step 5) needs to accept `demo_url` as a new
   optional field, OR a small new endpoint specifically for the URL — pick the cleaner path
   in the build. My lean: extend the body PUT to accept `{ body?, demo_url? }` since both are
   small text fields the salesperson edits in the workspace.

---

## 4. Data model (migrations 0019+; review before building)

Same conventions as Layer 1/2 and dashboard — TEXT PKs, ISO-8601 UTC via strftime, CHECK
enums, named idx_*, IF NOT EXISTS, rebuild pattern (0008/0013/0015) for table extensions on
existing schemas.

### 4.1 `demo_spec` — extend (rebuild pattern; preserve all rows)
- Add `demo_url` TEXT NULL — the URL of the built demo, set by the salesperson when the
  Studio87 chat returns one. Future: Alice writes this at L4 (author_kind hook already in
  place, no schema change needed for that).
- KEEP all existing columns (body, status, author_kind, opportunity_id, assessment_id,
  created_by_user_id, handed_off_at, built_at, etc.). Drop nothing.
- Re-create all existing indexes.

### 4.2 `opportunity` — extend (rebuild pattern; preserve all rows)
- Add `lost_reason` TEXT NULL CHECK in ('price', 'timing', 'not_a_fit', 'silent', 'other').
- Add `lost_notes` TEXT NULL (free-form notes from the No deal sub-flow).
- Add `lost_at` TEXT NULL — server-stamped when opportunity moves to `lost` via the new
  endpoint.
- KEEP all existing columns and indexes (verify the existing status enum already includes
  `lost`, which is what the No deal path sets it to).

### 4.3 No new tables.

---

## 5. API / worker work

### 5.1 New endpoint: `POST /api/admin/opportunities/:id/lost`
- Request: `{ reason: 'price' | 'timing' | 'not_a_fit' | 'silent' | 'other', notes?: string }`.
  Validate `reason` is one of the allowed values (400 invalid_reason otherwise).
- Atomic single DB.batch:
  - UPDATE opportunity SET status='lost', lost_reason=?, lost_notes=?, lost_at=now WHERE id=?
  - auditStatement('opportunity.marked_lost', changes: { reason, notes? })
- Reject (409 already_settled) if the opportunity status is already in a terminal state
  (`accepted` or `lost`). The room shouldn't be able to mark an already-closed deal lost.
- Return `{ ok, opportunity_id, status: 'lost', lost_at }`.
- Scoped to ctx.session, 401 if absent.

### 5.2 Extend `PUT /api/admin/demo-specs/:id` (the body-only PUT from dashboard step 5)
- Accept `{ body?, demo_url? }`. Update only fields present.
- Keep existing 400 status_not_allowed_here for any status in the payload (transitions go
  through `/status`).
- Audit kind: `demo_spec.update` with `fields:[<each field updated>]`.
- Update types.ts (`UpdateDemoSpecRequest`) to reflect the new optional field.

### 5.3 New route for the Presentation room load
The room needs a single payload for fast first-paint. Either:
- (a) Reuse `GET /api/admin/prospects/:id` (the existing prospect workspace read from Layer 2
  step 2) — it already returns prospect identity, current/draft proposal, demo_spec. Pull
  `demo_url` from the demo_spec naturally as the workspace read already returns the full
  demo_spec when present. PICK (a) if the existing read serves this without modification.
- (b) New `GET /api/admin/presentation/:opportunity_id` if the existing read is too heavy
  or shaped differently from what the room needs.

LEAN: (a). The prospect workspace read is already shaped close to this. If you find it's
oversized (returns too much for the room's needs), make a minimal adapter call that filters,
but don't duplicate the query. FLAG which you chose and why.

---

## 6. Frontend work

### 6.1 New routes (admin/src/routes/(authed)/)
- `/prospects/[id]/present` — Tab 1, the Presentation room.
- `/prospects/[id]/disposition` — Tab 2, the disposition screen (opens in a new tab from Tab 1).

### 6.2 Tab 1 — Presentation room (the `/present` route)
- Inherit global Studio44 tokens.
- Two-column grid: demo iframe (`flex:1`), rail (320px).
- iframe `<iframe src={demo_url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />`
  — the sandbox attribute is conservative; loosen specifically if a known demo type needs
  more. The thin top bar over the iframe shows URL + reload + pop-out.
- Reload: `iframe.src = iframe.src` (re-fetch).
- Pop-out: `window.open(demo_url, '_blank')`.
- Empty state when `demo_url === null`: calm card centered in the iframe area, "No demo URL
  set yet" + a deep link to the prospect workspace's demo_spec editor.
- Rail: meeting block (company name) + investment card (setup + monthly) + spacer + Next
  button. The Next button is full-width crimson, `onclick` opens `/prospects/[id]/disposition`
  in a new tab via `window.open`.
- The room's reads come from §5.3's load endpoint.

### 6.3 Tab 2 — disposition screen (the `/disposition` route)
- Header: "Studio44 / <Company> / How did it go?" breadcrumb.
- Centered narrow column. Title + subtitle.
- Three big cards: Close (crimson, pre-emphasized), Follow-up (amber), No deal (danger). Each
  card is a button; clicking transitions the page to the sub-flow.
- Footer info strip: "Close runs the existing activation — opens credentials handoff right
  here. Nothing fires until you pick."
- **Close sub-flow:**
  - Confirm dialog. On confirm → POST `/api/admin/opportunities/:id/activate` (existing).
  - On success → render `CredentialsHandoffModal` (existing component, reuse — verify it can
    be invoked outside the opportunity-detail page; if it's coupled to that page, extract it
    or pass the credentials directly into a local rendering).
  - On modal dismiss → calm "All set" screen, route back to dashboard.
- **Follow-up sub-flow:**
  - No state change. `window.location.href = '/prospects/<opportunity_id>'`.
- **No deal sub-flow:**
  - Reason quick-picks (pill-select or radio): Price · Timing · Not a fit · Silent · Other.
  - "Other" reveals a small text field for the reason name.
  - Notes field (optional, expand/contract NotesField — reuse from Layer 2).
  - Confirm dialog: "Mark <Company> as no deal?"
  - On confirm → POST `/api/admin/opportunities/:id/lost` with `{ reason, notes }`.
  - On success → calm "Noted." screen, route back to dashboard or prospects list.
- All sub-flows: failure → inline error, do NOT advance, allow retry. No-silent-loss
  discipline (mirror Layer 1/2 patterns).

### 6.4 Workspace edit for the demo URL
- The prospect workspace's existing demo_spec editor (in `prospects/[id]/+page.svelte` per
  dashboard step-5 worker note) currently shows the body editor. Add a small `demo_url` text
  field above or below the body editor — labeled "Demo URL" with a placeholder hint ("paste
  the URL the builder returned"). Saves via the extended body PUT (§5.2).

### 6.5 Reaching the Presentation room
- From the **dashboard's Presentations station**: each row's "<company>" link, currently
  routing to `/prospects/<opportunity_id>#handoff`, gains a sibling small "Open the room →"
  link routing to `/prospects/<opportunity_id>/present`. The workspace handoff link stays for
  prep; the room link is for the day-of meeting.
- From the **prospect workspace's handoff section** (Layer 2 step 6's existing surface): add
  a primary "Open the Presentation room →" button when both:
  - A `demo_spec` exists, AND
  - A draft proposal exists with line items priced (the `price` readiness pill from dashboard
    would be green or amber — verify with the existing payload).
  When `demo_url` is null, the button is still enabled but warns "no demo URL set yet" with
  a deep link to set it (or just disables the button with that hint — pick the gentler UX).
- No new nav item in the header. The room is reached from where it makes sense (dashboard,
  workspace), not as a top-level mode.

---

## 7. Alice-readiness checklist (build the room, not the occupant)

- ✅ `demo_url` written via the existing demo_spec PUT pattern — Alice's L4 author of demos
  writes this field with `author_kind='alice'` semantics already in place (no schema change
  for that).
- ✅ Lost reasons stored as a closed enum + notes — Alice reads this at L4 to learn patterns
  (which industries lose on price, which on timing, etc.).
- ✅ No Alice surface in the room itself (intentional — client-safe).
- ❌ No Alice tools, model calls, or live coaching this layer.

---

## 8. Deploy reality
- Worker COMMITS, never pushes. Operator pushes manually.
- Push auto-deploys frontend (the two new routes + the workspace demo_url field).
- Worker (API) changes need manual `wrangler deploy --env staging` (the new
  `/opportunities/:id/lost` endpoint, the extended demo-spec PUT).
- Migrations 0019+ (demo_spec.demo_url + opportunity lost fields) applied manually to staging
  D1.
- Build/typecheck must pass before commit.

## 9. Suggested build order (smallest-valuable-first)
1. Migrations 0019+ (demo_spec.demo_url, opportunity.lost_reason/notes/at) + types. Build/
   typecheck. STOP for operator schema review.
2. Backend: extend demo-spec PUT to accept demo_url; new `/opportunities/:id/lost` endpoint.
   Plus the demo_url field in the workspace's demo_spec editor (frontend half of #2).
3. Tab 1 — `/prospects/[id]/present` route. Demo iframe + minimal rail + Next button.
   No-write surface; just loads the prospect workspace read shape and renders.
4. Tab 2 — `/prospects/[id]/disposition` route. The three-card decision screen + the
   sub-flows (Close, Follow-up, No deal). Reuses CredentialsHandoffModal for Close.
5. Entry-point wiring: add "Open the Presentation room →" buttons on the dashboard
   Presentations station rows and the prospect workspace's handoff section.

Each step: commit, do not push; report what a push/deploy would do.

---

## Appendix — explicitly OUT of this layer

- Pre-meeting "send the client a preview link" automation (deferred — pre-close link
  automation was the one net-new piece the pass-4 investigation flagged; out of scope here).
- Layer 3 (Clients workspace, the post-acceptance side).
- Layer 4 (Alice wiring, including her authoring demo_url or curating client-facing copy).
- Any change to the existing `/activate` flow, the CredentialsHandoffModal's logic, or the
  contract-rendering / portal-walkthrough machinery.
- A "Present mode" toggle (decided against — the room IS the present mode).
- An Alice slot in the room (decided against — client-safe surface).

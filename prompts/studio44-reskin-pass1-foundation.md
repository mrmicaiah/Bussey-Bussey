# Studio44 — Reskin Pass 1 (Foundation): tokens, header + nav, shared components

**Status:** Design approved on paper (foundation prototype signed off). NOT yet built. This is the
authoritative spec for the FIRST of four reskin passes. The build chat dispatches the worker against
THIS document.

**Read first:** `prompts/studio44-master-spec.md` (especially §7's final "rename + reskin + reorganize"
phase, which this implements in passes) and the Layer 1/2 build specs for the dark Studio44 styling
already in use under `.s44` wrappers — the foundation pass PROMOTES that styling to global tokens, so
the Layer 1/2 screens can eventually drop their local palettes and inherit from app.css. Where this
spec and the master disagree, the master wins — FLAG, don't silently resolve.

**Goal of this pass:** make the ENTIRE admin app feel like Studio44 at the foundation level — tokens,
brand, header, shared components — so subsequent passes (lists, details, proposal editor, dashboard)
inherit the look automatically. NOTHING in this pass changes a screen's layout or behavior; it changes
how everything is colored, badged, and framed. This is the riskiest single pass because it touches the
files every other file depends on; we mitigate by keeping the token CONTRACT (variable names) identical
and only swapping VALUES.

**Carry-over principles (unchanged):**
- Operator language stays; we're not renaming nav items in this pass (nav is already operator-language;
  the cleanup is brand + active-state + an added Work launcher, not removal).
- Alice not touched in this pass.
- Worker commits, never pushes. Push auto-deploys frontend; worker needs manual deploy (no worker
  changes in this pass — frontend-only — so no `wrangler deploy` is needed for this pass alone).
- The reskin is the FIRST of FOUR passes. EXPLICITLY OUT of THIS pass:
    - Reskinning individual list/detail/calling-list screens (passes 2–3).
    - The proposal editor (pass 4).
    - The dashboard (separate work after this pass).
    - Layer 3 (Clients workspace).
  Build the foundation only. Do NOT touch the list/detail screens' own structure or content even where
  they will obviously inherit the new tokens — that's by design (token inheritance does the work).

---

## 1. What this pass does (3 concerns)

### 1.1 Tokens (the contract that drives everything)
Edit `admin/src/app.css`. KEEP every existing variable NAME — only swap values. Add a small number of
new tokens that we've been using ad-hoc in Layer 1/2 inline styles (codify them so later passes don't
duplicate). After this change, every existing component that consumes a token automatically reskins —
that's the design.

Values to set (from the signed-off prototype):

Surfaces:
- `--bg: #0a0a0b`            (app background — was `#f7f7f5`)
- `--surface: #101012`       (card / panel — was `#ffffff`)
- `--surface-2: #0d0d0f`     (NEW — header/footers, subtler surface)
- `--border: #27272a`        (default divider — was `#e3e3df`)
- `--border-soft: #1c1c1f`   (NEW — section seams, weaker than --border)

Text:
- `--text: #f4f4f5`          (primary — was `#1a1a1a`)
- `--muted: #a1a1aa`         (secondary — was `#6b6b66`)
- `--muted-2: #71717a`       (NEW — labels)
- `--muted-3: #52525b`       (NEW — hints)
- `--muted-4: #3f3f46`       (NEW — separators / disabled text)

Intent:
- `--accent: #d40b1e`        (crimson — was navy `#1f3a5f`)
- `--accent-text: #ffffff`   (unchanged)
- `--success: #5dcaa5`       (was `#146c43`)
- `--warning: #fac775`       (was `#b15c00`)
- `--danger: #f09595`        (was `#b3261e`)
- `--info: #d40b1e`          (was navy — now matches --accent; review uses)

Other:
- `--radius`, `--space-*` unchanged.
- Update body styles: body.background = `--bg`; the bg-as-light-gray assumption breaks elsewhere — fix
  any hardcoded light colors you find while doing this (e.g. `tr:hover td { background: #fafaf8 }` →
  `var(--surface-2)`; `.logout:hover { background: #ececea }` → `var(--surface-2)`; the `.role` pill in
  the header → `var(--border-soft)` background + `var(--muted)` text).
- Link color (`a { color: var(--accent) }`): KEEP; review whether crimson links inside body prose are
  too loud — if so, route body-text links through a different token (`--link: var(--accent)` aliased)
  and pick a softer link color for non-accent contexts. Make a judgment call; flag what you chose.
- The h1/h2/h3 + table th + .error rules already use tokens — they'll reskin automatically. Update only
  the hardcoded color values inside the file (the .badge-* values and the tr:hover / logout:hover
  greys).

### 1.2 The badge palette (`.badge-*`) — full reskin
Every status badge class in app.css gets new values. Mapping is semantic (signed off):
- **Green/good** (contacted, qualified, active, accepted, approved): bg `#0f1410`, text `#5dcaa5`,
  border `#1d3a1f`.
- **Amber/in-progress** (paused, proposed, proposed, sent, ?): bg `#2a1a0a`, text `#fac775`, border
  `#854f0b66`.
- **Crimson/bad** (disqualified, lost, declined, rejected, new): bg `#15090b`, text `#f09595`, border
  `#501313`. Note: `new` was navy in the old palette but goes CRIMSON in Studio44 — flag if you
  disagree (a new lead is "fresh attention required," not neutral; crimson reads as "needs you").
- **Zinc/neutral** (prospect, former, draft, superseded, withdrawn, reviewed): bg `#161618`, text
  `#a1a1aa`, border `#27272a`. Keep `superseded` strikethrough.

For each badge, set: padding 3px 9px, font-size 0.78rem (existing), radius 999px (existing), 1px
border (NEW — softens against the dark surface). Apply the mapping above to all 20 existing classes
exhaustively (the .badge-new through .badge-withdrawn list in app.css). Add a `.badge-` (default,
unrecognized status) using zinc.

### 1.3 The Header (`admin/src/lib/components/Header.svelte`)
Per the signed-off prototype:
- **Brand** "Bussey · Admin" → **"Studio44"** with crimson "44" — i.e. `Studio<span class="b-accent">44</span>`
  (or equivalent). Letter-spacing 0.5px, weight 500.
- **Work launcher** (NEW) — sits LEFT, immediately after the brand, BEFORE the nav. A primary crimson
  button labeled "Work" (or "Work →"), routing to `${base}/leads/work`. Tooltip / aria: "Start a
  calling session." This is the operator's one-click way into the wizard from any screen.
- **Nav items** — UNCHANGED order/labels: Dashboard / Leads / Prospects / Clients / Calling list. Active
  treatment: crimson underline (`border-bottom: 2px solid var(--accent)`) + `--text` color (white).
- **User block** (right): name, role pill (now `--border-soft` bg + `--muted` text), Log out (secondary
  outlined button).
- The header bg is `--surface-2`; bottom border `--border`.

Do NOT add new nav items. Do NOT remove any. Do NOT change the routes.

### 1.4 Brand-string sweep (the 18 places)
Replace every hardcoded "Bussey · Admin" and "Bussey Admin" (titles, h1s) with **"Studio44"**. Per the
Layer-1 verification this lives in: `admin/src/app.html` (doc title), `Header.svelte`,
`login/+page.svelte`, and the `<title>… · Bussey Admin</title>` in every one of the 15 page files.
Sweep them all in one pass. Confirm by grep that NO occurrence of "Bussey · Admin" / "Bussey Admin"
remains in the admin source.

### 1.5 Shared components reconciliation
The codebase has shared components (Button, Field, ConfirmDialog, others — check what exists). Two
goals:
(a) They must look correct in the new dark world by inheriting from the tokens. Verify each renders
correctly with the new tokens; fix any hardcoded color that doesn't inherit (e.g. a button using a
literal grey somewhere).
(b) Match the prototype's button system: primary (crimson), secondary (outlined), ghost (text only),
danger (outlined danger), disabled (muted). If the existing Button component supports variants, use
them; if not, extend it minimally — do not rewrite. Flag any place a shared component is used in a way
that will look wrong post-reskin and propose a fix WITHOUT making it (we'll address in pass 2/3 where
that component is used).

### 1.6 What about Layer 1 / Layer 2's local `.s44` palettes?
DO NOT delete them in this pass. The Layer 1 wizard files and Layer 2 workspace files declare a local
`.s44` palette so they could render dark while the rest of the app stayed light. With this pass, those
palettes become REDUNDANT (the global tokens are now dark) — but removing them is RISKY (could shift
their look subtly). For this pass: leave the local palettes in place; they'll cascade-win for those
files and continue rendering exactly as they do now. A FUTURE cleanup pass can remove them once we've
visually confirmed the global tokens produce identical results. FLAG this as a known follow-up.

---

## 2. Verification (this pass especially)

Because this pass touches the file every other file depends on, verification matters more than usual:

- **Build/typecheck must pass.** `pnpm --filter @bussey/admin typecheck` clean.
- **Visual scan via grep** — there should be no `Bussey · Admin` / `Bussey Admin` left in admin source
  after the brand sweep; report grep result.
- **No hardcoded light colors should remain in app.css.** Specifically the old `#fafaf8` (tr:hover),
  `#ececea` (.role / .logout:hover), the navy `#1f3a5f`, light greens / blues / etc. that were
  badge colors — all of those are explicit values to remove. Report the grep.
- **Layer 1 + Layer 2 screens** keep their look (local .s44 wins). The dark workspace must look
  exactly as it does today on staging.
- **Existing list/detail screens** (leads list, clients, opportunities, calling list, login,
  proposal editor) reskin AUTOMATICALLY via token inheritance — confirm by loading them in a dev build
  and visually checking. Some local hardcoded colors inside individual screens may still show through
  (light cells, hardcoded button colors). DO NOT fix those in this pass — they're passes 2–4's job.
  Just NOTE which screens have lingering light artifacts (a brief grep / file list) so passes 2–4 know
  what they're walking into.

## 3. Deploy reality
Frontend-only pass — no worker code changes, no migrations. So:
- Worker commits, doesn't push. You push manually.
- Pushing auto-deploys the frontend; no `wrangler deploy` needed for this pass.
- No staging D1 migration step.

Smallest possible deploy footprint. Good first pass to ship.

## 4. Suggested build order
1. Update `admin/src/app.css` — tokens + badge classes. Build/typecheck. (Visual: the whole app will
   now render dark, with the existing screens carrying the new tokens but still showing their own
   layout quirks.)
2. Update `admin/src/lib/components/Header.svelte` — brand + Work launcher + active-state styling.
3. Brand-sweep the 15 page files' `<title>` tags + login + app.html.
4. Reconcile shared components (Button variants, Field, ConfirmDialog) per the prototype.
5. Visual-scan the existing screens (light artifacts list).
6. Final build/typecheck; report.

Each step commits. Single commit at the end is also fine if it's one coherent foundation reskin. Use
your judgment on commit granularity.

---

## Appendix — what's NEXT, after this pass lands
- **Dashboard** (the pulse home screen) — designed and built into the now-unified app.
- **Pass 2:** list screens (leads, clients, opportunities, calling list) — Studio44 dense info design.
- **Pass 3:** detail screens (lead detail, client detail, opportunity detail).
- **Pass 4:** the proposal editor (workflow + content, the biggest single surface).
- Then **Layer 3:** Clients workspace.

DO NOT build any of those in this pass.

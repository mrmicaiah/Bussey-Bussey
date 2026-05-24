# Homepage v3 fix — contain desktop chat + new minimal mobile layout

Two fixes to the v3 homepage. Reference remains prompts/homepage-prototype.html for the
approved DESKTOP look (that doesn't change). This spec fixes (1) the chat overflowing its
frame on desktop, and (2) replaces the mobile stacking with a purpose-built minimal layout.

**Commit but DO NOT push.** Pull latest first (`git pull`).

## Fix 1 — Desktop: contain the chat inside the right (.talk) column
Problem: the live inline chat panel is overflowing — it's huge instead of sitting neatly
inside the right half of the split screen. Cause: leftover inline-panel sizing
(the old `height:460px / max-height:70vh` rule) fighting the split-screen.

Required behavior on desktop (≥861px):
- `.stage` is the two-column grid; the `.talk` (right) column has a bounded height equal to
  the stage height (same as the left pitch column — the split is full-height, ~`100vh` minus
  header; see Fix 3 below for the exact min-height).
- The chat fills the `.talk` column and NO MORE: `.talk` is `display:flex; flex-direction:column;
  height:100%` (or min-height matching the stage). Inside it: `.talk-top` (fixed height),
  the rotating `.ask` line (fixed height), then the `#bb-chat-inline` mount which is
  `flex:1; min-height:0` so it takes remaining space, then the `.lock` line (fixed).
- The widget's inline panel (`.bb-chat-panel--inline`) must NOT impose its own fixed height
  anymore. Set it to `height:100%; max-height:none; display:flex; flex-direction:column;
  flex:1; min-height:0`. The `.thread`/messages area is the only thing that scrolls
  (`flex:1; min-height:0; overflow-y:auto`). The `.begin` cue + composer are fixed at the
  bottom of the panel and pinned (do not scroll).
- Net result: thread scrolls internally; composer pinned to bottom; the whole chat is
  contained within the right column and never overflows the stage.

## Fix 2 — Mobile (≤860px): new minimal combined layout (NOT the desktop stacked)
Do NOT just stack pitch-then-chat in rows. Build a purpose-made minimal mobile composition:

Order on mobile, top to bottom:
1. Header lockup (compact — current mobile header is fine).
2. `.headline` (the h1).
3. The rotating `.ask` question line.
4. The chat (`#bb-chat-inline`) — fills the rest of the first screen so it's immediate,
   not pushed below a tall pitch. The chat region should be tall enough to read as the
   primary thing (e.g. the headline+question sit at top, chat takes the bulk of the viewport).
5. THEN (below the chat, as the user scrolls): the 45 min / $0 meta stats.
6. Then the normal content bands (problem, assessment, climax) as usual.

Mobile-specific rules:
- HIDE the `.sub` line ("No forms. No brochures…") entirely on mobile — it's redundant once
  the chat is right there. (`display:none` at ≤860px.)
- MOVE the `.meta` stats block to render AFTER the chat on mobile. Implement however is
  cleanest — e.g. duplicate the meta block in the markup (one inside `.pitch` for desktop,
  one after the `.talk`/stage for mobile) with each shown only at its breakpoint, OR use
  CSS order within a flex container. Keep it DRY if you can, but a small duplicated block
  gated by breakpoint is acceptable. The stats must appear below the chat on mobile and in
  the pitch column on desktop.
- The first mobile screen should be: header → headline → question → chat. The visitor should
  NOT have to scroll to reach the chat. The pitch's supporting details (stats) live below it.
- The chat on mobile must be fully usable: thread scrolls, composer + begin-cue pinned,
  input reachable above the keyboard.

## Fix 3 — the 100vh / header-height discrepancy (do this too)
The prototype used `min-height: calc(100vh - 70px)` on `.stage` but the real lockup header
is taller (~85px), causing slight overflow. Fix: make `.stage` min-height account for the
real header. Cleanest: `.stage { min-height: calc(100svh - var(--header-h)); }` where you
set `--header-h` to the actual header height (measure it; ~85px), OR use a flex/grid approach
where header + stage fill the viewport exactly. Use `svh` (small viewport height) not `vh`
so mobile browser chrome doesn't cause overflow. On mobile, `.stage` min-height can be `auto`
(content-driven) since the layout is now vertical and the chat has its own min-height.

## Constraints
- Desktop look stays exactly as approved (the prototype) — only the chat containment changes.
- Do NOT change chat session/message API logic, the rotation lines, copy, or Cloudinary URLs.
- Keep the corner-bubble fallback on all other pages unchanged.
- Test both: desktop (chat contained in right frame, no overflow) and a narrow viewport
  (header → headline → question → chat on first screen, stats below, sub-line hidden).
- Build locally, confirm it passes. Report files changed + what a push deploys.
  **Commit, do not push.**

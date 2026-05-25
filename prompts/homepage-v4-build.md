# Homepage v4 build spec — conventional landing page + tight chat card

The approved design is `prompts/landing-prototype.html` (just pushed — open it to see the
exact target). This REPLACES the v3 split-screen homepage with a conventional landing page:
sticky header → hero (pitch left, a TIGHT bounded chat card right) → dark tools image band
(the problem) → Assessment text section → washed "who we are" section → provocative image
climax with CTA → footer. The chat card replaces a contact form.

**Commit but DO NOT push.** Pull latest first (`git pull`).

## What stays / what changes from current state
- KEEP: the Google Fonts (Space Grotesk + Instrument Sans) in base.njk, the global crimson/
  ink tokens, the chat widget's session/message API logic, the corner-bubble fallback on
  other pages, both Cloudinary image URLs.
- REPLACE: the entire homepage layout + its CSS with the prototype's conventional layout.
  The v3 split-screen `.stage`/`.talk`/`.pitch` full-viewport stuff is GONE.

## Files to change
- `site/src/assets/style.css` — remove the v3 homepage block (`.stage`, `.pitch`, `.talk`,
  the full-viewport `100svh` rules, the v3 mobile layout). Add the prototype's CSS:
  `.wrap` (max-width 1140px centered), sticky `.hdr`, `.hero` grid (1fr / 400px),
  `.chat` card, `.section`/`.section.wash`, `.band`, `.climax`, `.foot`, and the prototype's
  840px mobile media query. Match the prototype's values exactly.
- `site/src/index.njk` — rebuild to the prototype's structure & copy (verbatim). Sections in
  order: hero (pitch + chat card), band (problem), section (Assessment), section.wash
  (who we are), climax, footer-via-partial. The hero h1 is the only `<h1>`.
- `site/src/_includes/partials/header.njk` — the prototype's sticky lockup header (brand
  lockup left, six nav links right). Note: prototype header is sticky with backdrop-blur.
- `site/src/assets/chat-widget.js` — restyle inline mode to match the prototype's `.chat`
  card EXACTLY and make it a BOUNDED card (see below). No API logic changes.

## The chat card (the key element — keep it TIGHT and bounded)
This is the big lesson from v3: the chat must be a small, bounded card, NOT a giant panel.

- In `index.njk`, the hero right column contains the `#bb-chat-inline` mount.
- The card is a FIXED-SIZE bordered card: `width:400px` (the hero grid's second column),
  `height:440px` (≤840px mobile: full-width, height 400px). 1.5px ink border, radius 16px,
  the prototype's drop shadow.
- Inside, top to bottom: `.chat-top` status bar (pulsing dot + "Bussey & Bussey" + "online"),
  the `.thread` (the live messages — `flex:1; min-height:0; overflow-y:auto`), the `.begin`
  cue ("↓ Begin here. Speak with our Automated Intelligence."), the `.composer`
  (input + 42px crimson square ↑ send button), and the `.lock` line.
- The widget's inline panel must fill this card and NOT exceed it: the thread is the only
  scroll area; begin-cue + composer pinned at the bottom. Set the inline panel to
  `height:100%; display:flex; flex-direction:column` inside the fixed-height card.
  (Do NOT reintroduce any 460px/70vh/100svh sizing — the CARD's 440px height bounds it.)
- The rotating tagline is NOT on this page's chat card (the v3 `.ask` rotating line is
  dropped here — the prototype's chat opens straight into the greeting + thread). Leave the
  rotation JS/data alone if it's harmless, but the homepage no longer renders a rotating line.
  (If removing it is clean, fine; if it's wired into shared code, just don't render it.)
- Greeting still comes from the worker (INITIAL_GREETING) and renders as the first thread
  message. That's expected.

## Image bands
- Problem band (`.band`): real tools image via CSS background (prototype uses
  `c_fill,w_2000,q_auto,f_auto/...tools_ixpkkk.jpg`) + `rgba(12,12,12,.72)` scrim, white text,
  `#f0626c` eyebrow. (Prototype uses ::before/::after; if you prefer a real `<img loading="lazy">`
  with alt text for SEO/perf, that's an acceptable improvement as long as it looks identical.)
- Climax band (`.climax`): real provocative image (`...provocative_moasyf.jpg`) +
  `rgba(8,8,8,.66)` scrim, centered white text, bordered "Start the conversation →" CTA that
  scrolls to top and focuses the chat input.

## Constraints
- Match the prototype's layout, spacing, type scale, colors. It's approved — don't reinterpret.
- The page content is centered in a 1140px max-width column — it must NOT stretch full-bleed
  across large monitors (that was the v3 problem). Only the image bands go full-bleed
  (background), with their inner `.wrap` still capped at 1140px.
- Mobile (≤840px): hero collapses to one column (pitch on top, chat card below, full-width),
  header stacks, nav wraps. Chat card stays usable (thread scrolls, composer pinned).
- Do NOT change: chat session/message API logic, copy, or Cloudinary asset IDs.
- One h1 (hero headline). Send button keeps aria-label "Send". Images/alt text where used.
- Build locally, confirm it passes with one h1 + fonts link present. Report files changed
  and what a push deploys. **Commit, do not push.**

# Homepage visual redesign — "white but sharp", v2

The homepage was built correctly to its spec but the AESTHETIC was wrong: system fonts +
soft borders + soft centered everything = dated and flat. This spec replaces ONLY the
visual system (fonts, type scale, color usage, borders, header, section treatment). The
PAGE STRUCTURE, COPY, CHAT MOUNT, ROTATING TAGLINE, and IMAGES stay exactly as they are
in the current index.njk — do not rewrite the copy, do not change the chat-widget JS
logic, do not touch the Cloudinary URLs. This is a restyle + a few markup additions
(header lockup, hero headline, section eyebrows), not a rebuild.

**Commit but DO NOT push.**

## The aesthetic in one line
White background, but SHARP — contrast comes from crisp near-black ink, decisive crimson,
hard hairline borders, a distinctive modern font, and tight letter-spacing. NOT bright-and-soft.
The failure we're fixing: soft = dated. Sharp = modern.

## Fonts (THE most important change — this fixes 60% of "dated")
Load from Google Fonts via `<link>` in base.njk `<head>` (preconnect + stylesheet).

- **Display / headings + brand + eyebrows:** "Space Grotesk" (weights 500, 700).
  A tight geometric grotesque — reads precise and current.
- **Body:** "Inter" is BANNED (too default). Use **"Instrument Sans"** (weights 400, 500)
  for body and nav. Clean, slightly characterful, modern.
- Set `--font-display: 'Space Grotesk', sans-serif;` and `--font-body: 'Instrument Sans', sans-serif;`
  in `:root`. Replace the current system-font stack on `body` with `--font-body`.
- All h1/h2/h3, the brand mark, and eyebrows use `--font-display`.

If a listed font fails to load from Google Fonts for any reason, fall back to the other
listed font, then sans-serif — never to the old system stack feel.

## Color tokens (update style.css :root)
- `--bg: #ffffff`
- `--surface: #ffffff`
- `--ink: #0a0a0a`  (near-black — primary text & hard borders)
- `--ink-soft: #222222` (body paragraph text)
- `--muted: #666666`
- `--accent: #d40b1e`  (sharp crimson — slightly deeper/brighter than the old #c1121f; THIS is the brand red now. Replace #c1121f everywhere, including in chat-widget.js inline CSS.)
- `--accent-text: #ffffff`
- `--hair: #e3e3df` (light hairline for subtle internal rules)
- Keep using `--ink` (#0a0a0a) for the HARD structural borders (header rule, chat box frame). Use `--hair` only for soft internal dividers.

## Header — REPLACE header.njk with a "lockup" header (Option A)
Left side: brand lockup, stacked:
- Line 1: `Bussey <span class="amp">&</span> Bussey` — `--font-display`, weight 700, ~20px, letter-spacing -0.02em, color `--ink`. The `.amp` is crimson (`--accent`).
- Line 2: `Operations & AI for service businesses` — `--font-display` or body, weight 500, ~11.5px, UPPERCASE, letter-spacing 0.06em, color `--muted`, margin-top 4px.
Right side: nav — Services · Industries · Articles · Blog · About · Contact (keep all six;
use middot separators or simple spaced links), body font, ~13px, color `--ink-soft`,
hover crimson.
Header has a **1px solid `--ink`** bottom border (hard rule, not soft). Padding ~18px 0
inside the existing `.container`. On mobile (<700px): stack the nav below the lockup, or
collapse to a simple wrap — keep it clean, brand lockup stays on top.

## Hero — update index.njk hero markup + style
Structure, in order, centered:
1. **Fixed headline** (NEW — add this element): "We find what's breaking in your business — and build the fix." — `--font-display`, weight 600–700, clamp(2rem, 5vw, 2.6rem), letter-spacing -0.035em, line-height 1.04, color `--ink`, max-width ~13em.
2. **Rotating question** (the existing #bb-tagline — demote it visually): now SMALLER and crimson. ~1.05–1.15rem, weight 500, color `--accent`, letter-spacing -0.01em. Keep the existing rotation JS and the 6 lines exactly. (It's no longer the h1 — see SEO note.)
3. **The chat** (#bb-chat-inline, unchanged mount) — max-width 540px, centered.
4. **Lock line** (.encrypted, exists) — keep, but use a Tabler-style lock or the existing svg; muted, ~12.5px.

SEO note: the fixed headline should be the `<h1>`. Change the rotating #bb-tagline element
from `<h1>` to a `<p>` (or `<div>`) so we don't have two h1s — the headline is the h1 now.
Update the rotation JS selector if needed (it targets `#bb-tagline` by id, so changing the
tag is fine as long as the id stays).

Hero vertical rhythm: generous but not the full empty void — headline → ~16px → question
→ ~30px → chat → ~18px → lock. The hero no longer needs `min-height: 100vh`; let it size to
content with comfortable top/bottom padding (~56px top, ~52px bottom) so the first content
section peeks / flows naturally.

## Chat box (inline mode) — sharpen it
In chat-widget.js inline CSS (`.bb-chat-panel--inline`) and shared bits:
- Inline panel: white bg, **1.5px solid `--ink`** border (hard frame — currently soft), border-radius 14px.
- Assistant bubble: bg `#f4f4f2`, ink text, border-radius 13px 13px 13px 3px (asymmetric).
- User bubble: bg `--accent`, white text, border-radius 13px 13px 3px 13px.
- Send button: make it a crimson SQUARE (~42px) with an up-arrow glyph (↑) instead of the word "Send" — modern. Keep it accessible (aria-label "Send"). Crimson bg, white arrow, border-radius 9px.
- Input: white, 1px solid #cfcfca, border-radius 9px, focus outline crimson. Blank placeholder stays blank on inline.
- Keep all JS logic / API calls identical. Only styling + the send-button glyph change.

## Content sections — add eyebrows + sharpen, alternate photo/text
Each major section gets a small UPPERCASE crimson **eyebrow** label above its heading:
- Eyebrow style: `--font-display`, weight 600/700, ~12px, letter-spacing 0.12em, text-transform uppercase, color `--accent`, margin-bottom 16px.
- Assign eyebrows:
  - Section 1 (tools band): eyebrow "THE PROBLEM", heading "You're consumed by the work"
  - Section 2 (text): eyebrow "THE ASSESSMENT", heading "We don't do free" (the h3 sub-headings inside Section 2 stay as-is, no eyebrows on those)
  - Section 3 (text): eyebrow "WHO WE ARE", heading "Who we are"
  - Section 3 provocative band: eyebrow "THE MOMENT", heading "The market just opened. Are you ready?"

Text sections (`.section-text`):
- max-width 640–680px, centered, padding ~52px 1.5rem (more generous than now).
- h2: `--font-display`, weight 600, clamp(1.7rem, 3.5vw, 2rem), letter-spacing -0.03em, line-height 1.05, color `--ink`.
- Under each h2: a 46px × 3px crimson rule (keep the existing ::after rule idea but make it crimson and tight). h3 sub-headings: `--font-display`, weight 500, ~1.25rem, color `--ink`, NO crimson rule, margin-top 2.5rem.
- p: `--font-body`, 16px, line-height 1.7, color `--ink-soft`.

Image bands (`.image-band`, both): keep the full-bleed image + dark scrim. Refine:
- Scrim: `rgba(10,10,10,0.5)` for tools, `rgba(10,10,10,0.58)` for provocative.
- Band inner: max-width ~640px, padding ~56px 30px (tools), ~72px 30px (provocative climax).
- Eyebrow on bands uses a LIGHTER crimson (`#f0626c`) so it reads on the dark photo; heading + body white. Body p: 15.5px, line-height 1.65, rgba(255,255,255,0.9).
- The provocative band is the climax — heading larger: clamp(1.9rem, 4.5vw, 2.6rem).

## Close section — sharpen
The "Start the conversation →" close: make it a real button-link — crimson text or a
bordered pill (1px solid --ink, hover fills crimson/white), `--font-display`, weight 600.
Keep the scroll-to-chat JS behavior.

## Inner pages (services, about, industries, contact, articles, blog)
They inherit style.css, so the new tokens + fonts apply automatically. Verify each still
reads well: headings should now be Space Grotesk, body Instrument Sans, links crimson,
hard rules where the old navy borders were. Spot-check that nothing depended on the old
soft look. No per-page redesign needed — just confirm the global restyle didn't break layout.

## Constraints
- Do NOT change page copy, the chat API logic, the rotation lines, or Cloudinary URLs.
- Two weights max per font; sentence case for body, the eyebrows are the only uppercase.
- Mobile: everything legible; image-band text readable; header stacks cleanly; chat full-width.
- Accessibility: one h1 (the headline); rotating question respects prefers-reduced-motion (existing); send button has aria-label; lock icon decorative.
- After building, run the site build to confirm it passes. Report what changed and what a push deploys. **Commit, do not push.**

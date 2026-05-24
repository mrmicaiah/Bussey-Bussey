# Homepage rebuild — chat-first front door + below-the-fold content

This spec rebuilds the marketing homepage as a Google-style, chat-first page with
real content below the fold, and replaces the site color system. It touches several
files. Read this whole file before starting. **Commit but DO NOT push.**

## Aesthetic direction

- **Palette:** white background, sharp crimson-red accent, black. Replaces the old navy (`#1f3a5f`) everywhere it appears.
  - `--bg: #ffffff`
  - `--surface: #ffffff`
  - `--text: #0a0a0a` (near-black)
  - `--muted: #6b6b66` (keep)
  - `--border: #e5e5e2`
  - `--accent: #c1121f` (sharp crimson — this is THE brand red; use it sparingly: send button, key hairlines, active states, links)
  - `--accent-text: #ffffff`
- **Hero = restraint.** Google.com model. Brand mark + minimal nav at top, then a centered rotating tagline over a clean chat, then one small "Encrypted and confidential" line with a padlock. Nothing else above the fold. The emptiness is the design. NO hero image.
- **Voice:** harsh but professional. Direct, unsentimental, confident. Already written into the copy below — do not soften it.

## Files to change

1. `site/src/assets/style.css` — swap color tokens (navy → crimson/black/white), add hero + content-section styles.
2. `site/src/assets/chat-widget.js` — change hardcoded navy `#1f3a5f` to crimson `#c1121f`; add support for an inline mount (see "Inline chat mount").
3. `site/src/_includes/partials/chat-widget.njk` — update `cannedGreeting` (see below).
4. `site/src/index.njk` — full rebuild (hero + 3 content sections). Content is below.
5. `site/src/_includes/partials/header.njk` — trim nav (remove the case-studies link; see "Nav").
6. **Remove case studies** — see "Case studies removal".

## Nav

Header keeps the brand mark and a MINIMAL nav. Remove the `Case studies` link entirely.
Final nav links: Services, Industries, About, Contact. (Keep it quiet — these are
secondary to the chat.) Brand mark stays linking to `/`.

## Case studies removal

Remove the case-studies feature cleanly so the build still passes:
- Delete `site/src/case-studies.njk`
- Delete `site/src/case-studies/` (the `example.md` inside it)
- Remove the `case-studies` collection definition from `site/.eleventy.js` (the addCollection block and any filter referencing it)
- Remove the `Case studies` link from the header nav (above)
- Grep the repo for `case-studies` / `case_studies` / `caseStudies` and remove any remaining references so `pnpm build` (or the eleventy build) does not error.

## Inline chat mount (the important architectural piece)

Today the widget is a corner bubble on every page. The homepage needs the chat
EMBEDDED in the hero, centered, Google-style — while every OTHER page keeps the
corner bubble unchanged.

Approach: keep the existing widget working as-is, but teach it to detect an inline
mount element and render INTO it instead of as a floating bubble when that element
is present.

- In `chat-widget.js`: on boot, check for `document.getElementById('bb-chat-inline')`.
  - If present (homepage): render the chat panel INTO that element (full width of its
    container, not `position: fixed`), open by default, no floating bubble. The
    messages area + input + send button live inline. Auto-boot the session on load
    (don't wait for a click) so the agent's greeting is visible immediately.
  - If absent (all other pages): behave exactly as today — floating bubble bottom-right.
- The inline panel should have NO placeholder text in the input (blank input — we don't
  prompt people). The textarea `placeholder` attribute must be empty on the inline mount.
- Keep the existing session/message API calls identical. Only the mounting/positioning differs.
- Crimson, not navy, for the send button and user message bubbles in BOTH modes.

If teaching the one script two modes is messy, an acceptable alternative is a small
separate inline-init path in the same file gated on the mount element — your call, but
keep all other pages' behavior byte-for-byte the same and keep one shared session API.

## Greeting (chat-widget.njk)

The page shows a ROTATING tagline as the visible headline (handled in index.njk, see
below). The chat's first assistant message should be short and not duplicate the
tagline. Replace the current `cannedGreeting` with:

    "Welcome to Bussey and Bussey. Tell us what you're working with — what's the part of your business that keeps breaking?"

(Note: the live greeting actually comes from the worker's INITIAL_GREETING, not this
canned string — but update this string too so they're consistent. Flag to the human that
the worker greeting is separate and may want updating later.)

## Rotating tagline (index.njk hero)

A single centered line above the chat input that rotates through the set below every
~4 seconds, with a gentle fade. First one shown on load is "What are you working with?"
Implement with a tiny inline script (no dependencies). Respect `prefers-reduced-motion`
(if reduced motion, just show the first line, no rotation). Lines:

1. What are you working with?
2. What keeps breaking?
3. What's costing you money you can't see?
4. What part of the job shouldn't still be manual?
5. Where's the bottleneck?
6. What would you fix first?

## Images (Cloudinary)

Serve via Cloudinary transformations, NOT the raw originals. Use these transform URLs
(resized, auto-format, auto-quality):

- Section 1 (tools / the problem):
  `https://res.cloudinary.com/dxzw1zwez/image/upload/c_fill,w_2000,q_auto,f_auto/v1779656080/tools_ixpkkk.jpg`
- Section 3 (provocative / market thesis):
  `https://res.cloudinary.com/dxzw1zwez/image/upload/c_fill,w_2000,q_auto,f_auto/v1779656075/provocative_moasyf.jpg`

Both are full-width section bands. `tools` is a light/whitewashed image → use a subtle
dark scrim (e.g. `rgba(0,0,0,0.35)`) behind text so near-black or white text stays
readable; lay the Section 1 copy over it (white text) OR place copy beside it — your
design judgment, but text must be legible. `provocative` has a dark sky + black panels →
white text over it works well; this is the most dramatic band on the page (the climax),
so let it be bold and full-bleed. Use `loading="lazy"` on both (they're below the fold)
and provide alt text.

## index.njk — full page content

Frontmatter:
- layout: layouts/base.njk
- title: "Operations and AI for service businesses" (or keep a tight title; this is the SEO title)
- description: "We find what's breaking in your business and build the fix. Every engagement starts with an Assessment — at no charge to you."
- permalink: /

### HERO (above the fold — clean, centered, no image)
- Centered vertically in the viewport.
- Rotating tagline (h1-level for SEO, but visually the single line; see set above).
- The inline chat mount: `<div id="bb-chat-inline"></div>` centered, max-width ~520px.
- Below the input, small, centered, muted: a padlock icon + "Encrypted and confidential".
- Nothing else. Let it breathe.

### SECTION 1 — the problem (image: tools)
Use this copy. Real heading for SEO.

Heading (h2): You're consumed by the work

> The job in front of you, the client who needs an answer now, the fire that started this morning. So you handle it — by hand, again, like last week and the week before.
>
> But some days the work isn't the fire. Some days you have to work on the firetruck, so it's ready when the fire comes. Some days you install the smoke alarm, so the fire doesn't start at all. That's the work that actually changes things — and it's the work that never gets done, because you're too busy surviving the week to build the thing that would end the fight.
>
> It's your job to see it before it happens — to stay ahead of your clients, your staff, your costs. But being ahead means doing more work, and you're already past full. That's the trap: the thinking that would get you out is the thing you have no time to do.

### SECTION 2 — the Assessment (no image)
Multiple sub-headings. Real h2/h3 for SEO.

h2: We don't do free

> Free means you have time to give away. Our time is valuable — and so is yours. If you're looking for something for nothing, we don't have anything for you.
>
> But if you're willing to invest the one resource you can't get back — your time — then we'll meet you there. That's the deal. You bring the time and the seriousness. We bring the work. And we do that part at no cost to you, long before anyone talks about money.

h3: How the Assessment works

> It starts with a conversation. A set time, forty-five minutes, on the calendar — not a sales call dressed up as a favor. The first session exists to expose the real problem, which is almost never the one you came in naming.
>
> Most engagements don't stop at one. We'll usually schedule another, and another — four to eight sessions is common — because digging into how a business actually runs takes more than one sitting. We're not in a hurry to sell you something. We're looking for the one thing that changes everything, and that takes real work.
>
> That's the bar, and it's a higher one than money. Four to eight working sessions is a serious investment of your most valuable resource. The owners who clear it are the ones we can actually help.

h3: Design and spec — a real solution, before you spend a dollar

> When we've found the problem, we move into design and spec. This is where the digging becomes an answer — a clear presentation of exactly what your business needs, backed by the research and strategic thinking we do on the back end to make sure it's the most effective solution, not the first one that came to mind.
>
> You see it before you buy it. The build phase — where we actually construct the tools — is the only place money enters. Everything up to it is ours to carry.

h3: Good tools pay for themselves

> Automated intelligence sounds like the new thing, and it is. But new isn't the point. Value is. A good employee brings more than they cost — they pay for themselves. A good tool does the same, and then some.
>
> We don't build tools. We build effective solutions. A home health agency we worked with was fighting to run a compliant hiring program — the state requires documents on file and proof that due diligence was done on every hire, and they were drowning in it. We built them automated intelligence backed by real tracking: an interface that kept them compliant and took the stress off the people running it.
>
> The result did more than satisfy the state. It gave their staff a clear path — a task list that told every person exactly what they needed to do, and turned compliance into a set of steps anyone could follow. The tool paid for itself in time, in stress, and in audits that stopped being a crisis.

h3: The right tools make your people better

> This is the part most software companies miss. The best tools don't just cut costs — they enrich the people who use them. They give your staff the guardrails to do their job right, the accountability that shows you take their work seriously, and a mission they can stand behind. People do better work when they know what's expected and believe it matters. The right system gives them both.

### SECTION 3 — who we are (image: provocative; the thesis is the climax)
Real h2/h3 for SEO.

h2: Who we are

> Before Bussey and Bussey, we built White Shovel — a landscape design firm — and the software behind it. We built the back-end systems and the real-world design tools ourselves, and they did something most software doesn't: they turned an ordinary salesperson into a capable designer. The efficiency was real enough that we could hand homeowners a finished design for free and still win the work. Then we sold it.
>
> We've spent the years since building software and tools for service companies across industries. Bussey and Bussey exists to do one thing — put the power of this new age of AI into the hands of the businesses that need it most.

h3: Research is the foundation

> In a world where ChatGPT hands everyone an answer and a plain website means a little less every day, the rare thing isn't information. It's knowing what's actually possible for your business — and having someone do the work to find out.
>
> That's R&D, and most small businesses can't spare the time for it. We can. Research is the foundation of good development, and ours is solid. We're often surprised by what people assume can't be done with AI or software — and rarely surprised by what turns out to be possible once someone digs. We find the solutions. We bring them to you.

h3 (over/under the provocative image — the climax): The market just opened. Are you ready?

> Here's what most owners haven't fully reckoned with yet. The large companies are using AI to cut their workforce — and in doing so, they're handing the open market back to small business. The talent is available. The tools that used to belong only to the big players are within reach for the first time.
>
> But reach isn't the same as ready. Do you have the systems to absorb that opportunity? The tools to compete with operations ten times your size? That's the question this moment is asking every small business owner. We exist to make the answer yes.

### CLOSE
After Section 3, a quiet final nudge back to the conversation — a single line and a way
to scroll back up / focus the chat. Keep it minimal. Something like a centered link
"Start the conversation →" that scrolls to / focuses the hero chat input. No new form.

## Constraints / reminders
- Mobile: hero chat stacks and fills the width; everything remains legible. Sections 1 & 3 image bands must keep text readable on small screens (scrim/overlay).
- Don't introduce a build step or new dependencies for the rotating tagline — vanilla JS inline.
- Keep all non-homepage pages visually consistent with the new palette (they inherit style.css, so the token swap covers them — just verify nothing hardcoded navy breaks).
- Accessibility: rotating tagline respects prefers-reduced-motion; images have alt text; the inline chat is keyboard-usable; padlock icon is decorative (aria-hidden) with the text doing the work.
- After building, run the site build locally to confirm it passes. Report what changed and what a push would deploy. **Commit, do not push.**

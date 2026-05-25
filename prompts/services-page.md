# Services page — build spec

Rebuild `site/src/services.md` (or convert to .njk if cleaner) as a problem-framed
services page using the LOCKED homepage design system (same fonts, crimson/ink tokens,
.wrap 1140px column, eyebrows, section styles, image-band option). It must look like it
belongs to the new homepage. Ends with an embedded chat contact section.

**Commit but DO NOT push.** Pull latest first.

## Voice & framing
Problem-first, harsh-but-professional — same voice as the homepage. We lead with what's
BROKEN, then name the fix. We do NOT present a feature list; capabilities appear as the
answer to a named pain. Copy below is final — use it verbatim.

## Structure (top to bottom)

### Hero (compact — not full viewport)
- Eyebrow (crimson, uppercase): WHAT WE FIX
- h1: "Your business runs on work that shouldn't be manual anymore."
- Lead paragraph: "Most of what eats your team's day — checking documents, chasing leads, answering the same questions, watching for the thing about to go wrong — is work software should be doing. We find it, and we build the systems that take it off your people's hands."
- Keep it tight: eyebrow + h1 + one paragraph, in the .wrap column, generous padding, no image.

### The problem→fix blocks
Render as a clean vertical sequence of blocks (or a 2-col grid on desktop that stacks on
mobile — your call, make it look good and scannable). Each block: a small crimson label,
a bold problem line (Space Grotesk), and a short fix paragraph. Use these five, in order.
The label is the PROBLEM; the heading states it sharply; the paragraph is the fix.

1. Label: DOCUMENTS
   Heading: "Someone is checking every file by hand."
   Fix: "Compliance documents, applications, contracts, credentials — somebody on your team reads each one looking for what's missing or wrong. Our automated intelligence reviews them the moment they arrive, flags what's incomplete or out of date, and surfaces only what needs a human. The pile stops being a person's job."

2. Label: LEADS
   Heading: "Half your leads never get a real follow-up."
   Fix: "You pay to bring leads in, then lose them because no one had time to call back fast enough. We build systems that capture every lead, qualify it, and make sure it gets worked — so the money you spend getting attention doesn't leak out the bottom."

3. Label: CLIENTS
   Heading: "Your team answers the same questions all day."
   Fix: "The same intake questions, the same status checks, the same 'where are we' calls. An agent built for your business can hold those conversations — answer accurately, collect what you need, and hand off to a person only when it matters. Your staff gets their day back for the work that needs them."

4. Label: WORKFLOW
   Heading: "Work falls through the gaps between steps."
   Fix: "Most operations leak in the handoffs — the step that didn't happen, the approval that stalled, the task no one owned. We map how the work actually moves, then build the guardrails that keep it moving: nothing dropped, nothing stuck waiting on someone who forgot."

5. Label: BOTTLENECKS
   Heading: "You find out about problems too late."
   Fix: "By the time a bottleneck reaches you, it's already cost you. We build monitoring that watches your operation and tells you what's slowing down, backing up, or about to break — while you can still do something about it. Being ahead means seeing it first."

### Mid-page band (image, optional but recommended — looks good)
A full-bleed band using the tools Cloudinary image (same as homepage problem band,
`...tools_ixpkkk.jpg`, scrim rgba(12,12,12,.72)), white text:
- Eyebrow (#f0626c): THE POINT
- h2: "We don't build tools. We build solutions."
- p: "A tool is a thing you have to learn and maintain. A solution is a problem that stops being yours. Everything we build starts the same way — an Assessment, where we find what's actually costing you, before anyone talks about what to build."

### Contact section (the chat — THIS IS THE CONTACT METHOD)
At the bottom, a clearly-presented contact section. This is how people reach Bussey —
no form. Reuse the homepage `.chat` card EXACTLY (the bounded 440px card with the live
#bb-chat-inline mount). Layout:
- Section heading (Space Grotesk, large): "Tell us what's broken."
- One line under it: "No forms. Talk to our Automated Intelligence — it'll get the details and put you in front of a person."
- Then the `.chat` card (same component as homepage; one #bb-chat-inline mount on the page).
- The card uses the SAME bounded styling as the homepage. Center it or place it beside the
  heading — make it look good and intentional, like a real contact section, not an afterthought.
- IMPORTANT: the chat session is continuous across pages already (sessionStorage token +
  resume) — do NOT change widget JS. Just place ONE #bb-chat-inline mount inside the .chat
  card on this page; the existing inline mode handles the rest.

## Constraints
- Use the locked design system (fonts, tokens, .wrap, eyebrow style, section styand .chat card). Match the homepage's look — this must feel like the same site.
- One h1 (the hero). Problem headings are h2 or h3 (consistent, your pick).
- Only ONE #bb-chat-inline element on the page (the widget grabs one by id).
- Mobile: blocks stack, chat card full-width, everything legible.
- Don't change chat widget JS, the worker, or Cloudinary IDs.
- Build locally, confirm it passes with one h1. Report files changed + what a push deploys.
  Commit, do not push.

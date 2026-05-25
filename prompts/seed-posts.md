# Seed posts — one article + one blog post

Make the Articles and Blog sections look ready by adding ONE real, helpful, published
post to each (replacing the draft placeholders). Both in the company voice
(harsh-but-professional, problem-first), genuinely useful — not thin filler. Match the
existing frontmatter schema (see site/src/articles/example.md and blog/example.md).

**Commit but DO NOT push.** Pull latest first.

## General
- Set `draft: false` (or remove the draft flag) so they publish and show in the collections.
- Keep the existing example.md placeholders OR delete them — your call, but the collection
  pages (articles.njk / blog.njk) should show the real post, not the placeholder. Cleanest:
  DELETE the two example.md placeholders and add the two real posts below.
- author: "Bussey and Bussey". Reasonable dates (article ~2026-04, blog ~2026-05).
- Use the existing post layout/markup (the `.container post` wrapper the examples use). These
  are text posts — they inherit the locked fonts/tokens. No chat card on posts.
- Real h1 = the post title (one per page). Use h2/h3 for sections within.

## ARTICLE — site/src/articles/the-work-that-shouldnt-be-manual.md
Frontmatter: title "The work in your business that shouldn't be manual anymore",
description "A practical look at the everyday work service businesses still do by hand —
and which of it software should be handling.", summary same as description, tags [article],
permalink /articles/the-work-that-shouldnt-be-manual/.

Body (verbatim, use markdown headings → rendered h2/h3):

# The work in your business that shouldn't be manual anymore

Every service business runs on a pile of small, repetitive work that nobody chose and nobody questions. It's just how it's always been done. But a lot of it — maybe most of it — is work that software should be doing now, freeing your people for the work that actually needs a human. Here's where to look.

## Reading documents to find what's missing

If someone on your team opens files to check whether they're complete — applications, compliance documents, contracts, credentials — that's pattern-matching, and pattern-matching is exactly what automated intelligence is good at. The goal isn't to remove the human; it's to have the software read everything the moment it arrives, flag what's incomplete or expired, and hand a person only the cases that actually need judgment.

## Chasing the same information twice

Watch how often your team re-asks for something a client already provided, or re-enters data that already exists in another system. Every one of those is a seam where work leaks. The fix is rarely a bigger team — it's connecting the systems that should have been talking to each other.

## Answering the same questions all day

Intake questions. Status checks. "Where are we on this?" If your staff answers the same handful of questions on repeat, that's a conversation a well-built agent can hold — accurately, around the clock — escalating to a person only when it matters.

## Noticing problems too late

Most owners find out about a bottleneck after it's already cost them. The work that should be automated here isn't a task — it's attention. Monitoring that watches your operation and tells you what's slowing down or backing up while you can still act on it.

## Where to start

Don't try to fix all of it at once. Pick the one that wastes the most of your best people's time, and start there. That's exactly what an Assessment is for: we find the work that's quietly costing you the most, and we start with the thing that changes the most. The rest follows.

## BLOG — site/src/blog/the-market-just-opened.md
Frontmatter: title "AI is opening the market for small business — if you're ready",
description "Big companies are using AI to cut headcount. That's handing the open market
back to small business — but only to the ones prepared to take it.", summary same,
tags [blog], permalink /blog/the-market-just-opened/.

Body (verbatim):

# AI is opening the market for small business — if you're ready

Here's a shift most owners haven't fully reckoned with yet.

The large companies are using AI to cut their workforce. You've seen the headlines. What the headlines miss is the other side of it: every person a big company sheds is talent that just became available, and every efficiency the big players gain is a tool that, for the first time, a small business can have too.

For most of business history, the good systems belonged to whoever could afford a team to build and run them. That's what kept small operators small — not a lack of skill, a lack of leverage. That barrier is falling. The tools that used to require an enterprise budget are now within reach of a business your size.

But reach isn't the same as ready. Having access to powerful tools and actually having the systems to use them are two different things. The question this moment is asking every small business owner isn't "can I get these tools" — it's "am I set up to absorb the opportunity when it's sitting in front of me?"

That's the gap we exist to close. If you're wondering whether your business is ready, that's a good conversation to have — and it costs you nothing to start it.

## Constraints
- Publish both (not draft). Collection pages must show them.
- One h1 per post (the title). Company voice, verbatim copy above.
- No chat card on posts. They inherit the locked design.
- Build locally, confirm it passes and both posts render at their permalinks and appear in
  the articles/blog collection lists. Report files changed + what a push deploys.
  Commit, do not push.

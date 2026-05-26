# Article Production Handoff — Bussey & Bussey

You're taking over article writing for the Bussey & Bussey marketing site. This document
gives you everything: the SEO plan (what to write), the voice and rules (how to write it),
and the repo mechanics (how to publish it). Read it once fully before starting.

---

## 1. The company (context you need)

Bussey & Bussey: operations and AI for service businesses. We find what's broken in a
business and build the fix — automation, AI agents, custom software. We're problem-first:
we sell solutions to problems, not features. Voice is harsh-but-professional — direct,
unsentimental, confident, no hype, no flattery. We write for service-business OWNERS
(the people who run the company), not job-seekers or end-consumers.

The full SEO content plan lives in the repo at `prompts/seo-content-plan.md`. Read it.

---

## 2. The five article targets (from real keyword data)

All five are EASY difficulty / winnable, focused on what we actually do. Volume = monthly
US searches; "words to win" = rough target to beat the current top-ranking page (a GUIDE,
not a hard rule — see writing rules).

| # | Target keyword (use as the core topic/title basis) | Volume | Words to win |
|---|---|---|---|
| 1 | automate customer service | 1,300 | ~590 (weak competition — easy first win) |
| 2 | business process automation | 1,600 | ~3,110 |
| 3 | business process automation software | 1,600 | ~3,110 |
| 4 | workflow automation tools | 4,400 | ~7,850 (biggest, hardest — save for later) |
| 5 | business process automation tools | 480 | wide open (~1,500–2,500) |

**Recommended order:** #1 first (fastest win), then #5, #2, #3 (the BPA cluster), then #4
(the big flagship) last. #2, #3, and #5 should interlink — they're a topical cluster around
"business process automation."

---

## 3. Writing rules (non-negotiable)

- **Substance comes from the founder (Micaiah), not from the AI.** The edge over competitors
  is real operator expertise. Get the founder's real knowledge/examples for each article;
  the writer's job is to shape and structure it, not invent it. Google penalizes pure-AI
  filler; it rewards genuine experience (E-E-A-T). This matters more than anything else here.
- **Word count is a guide, not a target.** Don't pad to hit a number. The win condition is
  being the most complete, genuinely useful result for that search. Length follows
  completeness. (Several of these terms have weak/no real competition — being genuinely
  useful is enough.)
- **One H1 per article** (the title). Use H2/H3 for sections. Structure for skimmability and
  featured snippets — clear headings, a direct answer near the top, lists where natural.
- **Target the keyword honestly** — use it in the title, the first paragraph, and naturally
  throughout. Don't keyword-stuff.
- **Match the brand voice** — direct, problem-first, no hype words ("amazing," "transform
  your business," "unlock"). Write like a sharp operator, not a marketer.
- **Anonymize client examples** — no client names, no hard numbers we can't back up. (The one
  real story we reference: an anonymous home health agency we built compliance tooling for.)

---

## 4. How to publish in the repo

The marketing site is an Eleventy site. Articles are markdown files in the repo. There are
TWO content sections:
- **Articles** → `site/src/articles/` (substantive, evergreen pieces — these SEO articles go here)
- **Blog** → `site/src/blog/` (shorter, more timely/opinionated posts)

These five SEO articles go in **`site/src/articles/`**.

### File format
Create one `.md` file per article in `site/src/articles/`. Use this frontmatter schema
(copy an existing published article like
`site/src/articles/the-work-that-shouldnt-be-manual.md` as your template):

```
---
layout: layouts/base.njk
title: "Your Article Title Here"
description: "One-sentence meta description with the target keyword. ~150 chars."
date: 2026-05-26
author: Bussey and Bussey
summary: "Short summary shown in the articles list — can match the description."
tags:
  - article
permalink: /articles/your-url-slug/
---

<div class="container post">

# {{ title }}

Article body in markdown. Use ## for H2 sections, ### for H3.

</div>
```

- `draft: false` or omit the draft flag entirely so it PUBLISHES (a `draft: true` post won't
  show in the live articles list).
- `permalink` = `/articles/<slug>/` — make the slug keyword-relevant and URL-clean
  (lowercase, hyphens, no spaces). e.g. `/articles/automate-customer-service/`.
- The article inherits the site's design automatically (fonts, styling) — no CSS needed.
- Do NOT put a chat card on articles (those are only on the main pages).

### The mechanics (IMPORTANT — how changes reach the live site)

This project uses a Claude Code worker dispatched through **Studio87**, plus a manual push.
The flow is specific:

1. **The worker writes/commits, but NEVER pushes.** You dispatch a coding task to the worker
   via a fenced PROMPT block in Studio87 (Studio87 auto-sends fenced PROMPT blocks to the
   worker). The worker creates the article file(s) in `site/src/articles/`, builds locally to
   confirm it passes, and commits — but does not push.
2. **Micaiah pushes manually.** Pushing to `main` auto-deploys the front end to staging
   (Cloudflare Pages). So before pushing, you should know what the push will deploy. The
   worker reports what changed and what a push will deploy; Micaiah reviews, then pushes.
3. **Staging first.** Everything lands on `staging.busseyandbussey.com` first (review there),
   not production. Production is separately gated.

So your loop is: finalize article content → dispatch a PROMPT to the worker to create the
file in `site/src/articles/` with the frontmatter above → worker commits → Micaiah pushes →
review on staging.

### A note on working with the worker
- The worker commits but does not push — always. Don't ask it to push.
- Give it the FULL article content verbatim in the dispatch (or push the content to the repo
  first and have the worker read it) so it doesn't rewrite your copy. Tell it "use this copy
  verbatim, do not paraphrase."
- For large content, it's cleaner to put the article in a `prompts/` reference file first,
  then dispatch the worker to read that file and create the article — avoids copy mangling.
- Always have the worker build locally and report what a push will deploy before Micaiah pushes.

---

## 5. Quick reference
- SEO plan + parked future opportunities: `prompts/seo-content-plan.md`
- Article template: `site/src/articles/the-work-that-shouldnt-be-manual.md`
- Articles go in: `site/src/articles/` | Blog posts go in: `site/src/blog/`
- Staging: staging.busseyandbussey.com | Production: gated, separate
- Voice: problem-first, harsh-but-professional, real expertise, no hype.

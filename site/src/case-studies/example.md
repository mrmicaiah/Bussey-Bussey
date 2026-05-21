---
layout: layouts/base.njk
title: Example case study (placeholder)
description: Schema-proving placeholder for the case studies collection.
date: 2026-01-01
draft: true
client: Acme Home Care
industry: home_health
outcome_headline: Cut credential-check time by 80%
summary: Placeholder summary that proves the frontmatter schema for case studies. Replace with the real Priscilla case study when ready.
quote: "Bussey rebuilt our credential workflow from the ground up. Survey week used to take three weeks of prep; this year it took two days."
quote_attribution: Placeholder Operations Director
tags:
  - case-study
permalink: /case-studies/example/
---

<div class="container post">

# {{ title }}

This is a placeholder case study. It exists to:

1. Prove the frontmatter schema (client, industry, outcome_headline, summary,
   quote, quote_attribution, tags).
2. Prove the rendering pipeline for the case-studies collection.
3. Get out of the way the moment a real case study lands.

It is marked `draft: true` in frontmatter, which means the
`case-studies` collection filter in `.eleventy.js` excludes it from the
indexed list — but the page still builds at its permalink for visual review.

</div>

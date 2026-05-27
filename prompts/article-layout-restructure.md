# Article Layout Restructure — Worker Task

This is a two-part Eleventy structural change. Do BOTH parts in the same commit. Build to confirm before committing. DO NOT push — Micaiah pushes manually after review.

## Context

- The site is Eleventy. Layouts live at `site/src/_includes/layouts/`.
- Currently only `base.njk` exists. All article markdown files use `layout: layouts/base.njk` and open their own `<div class="container post">` wrapper inside the markdown body.
- We're introducing a real article layout so article body styling stops living inside each article's markdown.

## Part 1 — Create new file: `site/src/_includes/layouts/article.njk`

Use exactly this content:

```njk
---
layout: layouts/base.njk
---
<article class="article-page">

  <header class="article-hero">
    <div class="wrap">
      <div class="ey">Article</div>
      <h1 class="h1">{{ title }}</h1>
      <div class="article-meta">
        <span class="article-date">{{ page.date | date }}</span>
        <span class="article-sep">·</span>
        <span class="article-author">{{ author or "Bussey and Bussey" }}</span>
      </div>
    </div>
  </header>

  <div class="article-body"><div class="wrap">
    {{ content | safe }}
  </div></div>

  {%- set related = collections.articles | reverse -%}
  {%- if related.length > 1 -%}
  <section class="article-related"><div class="wrap">
    <div class="se">Keep reading</div>
    <h2 class="h2">Other writing from the firm</h2>
    <div class="rule"></div>
    <div class="related-rows">
      {%- for post in related -%}
        {%- if post.url != page.url -%}
          {%- if loop.index0 < 3 -%}
          <a class="related-row" href="{{ post.url }}">
            <div class="related-row-tag">Article</div>
            <div class="related-row-body">
              <h3 class="related-row-h">{{ post.data.title }}</h3>
              {% if post.data.summary %}<p>{{ post.data.summary }}</p>{% endif %}
            </div>
          </a>
          {%- endif -%}
        {%- endif -%}
      {%- endfor -%}
    </div>
  </div></section>
  {%- endif -%}

</article>
```

## Part 2 — Update the six article markdown files

Files to edit (all under `site/src/articles/`):

1. `the-work-that-shouldnt-be-manual.md`
2. `automate-customer-service.md`
3. `business-process-automation-tools.md`
4. `business-process-automation.md`
5. `business-process-automation-software.md`
6. `workflow-automation-tools.md`

For EACH file, make exactly two changes:

**(a)** In the frontmatter, change the line `layout: layouts/base.njk` to `layout: layouts/article.njk`.

**(b)** Remove the `<div class="container post">` opening tag (just below the frontmatter) AND its matching `</div>` closing tag at the bottom of the file. Leave the article body markdown otherwise untouched — every heading, paragraph, link stays exactly as it is.

**DO NOT** edit any markdown body content. **DO NOT** touch the H1 in the body — the layout already renders the title, but the existing H1 in the body markdown should also remain (we'll handle de-duplication in a follow-up; do not assume).

## Part 3 — Append CSS to `site/src/assets/style.css`

Append this block to the very end of the file. Do not modify anything above it:

```css
/* ---------------------------------------------------------------------------
   Article body layout (layouts/article.njk) — header, reading column, related.
   .article-hero gives every article a proper styled header (eyebrow, display
   H1, meta line) matching the rest of the site. .article-body constrains the
   reading column to ~68ch for long-form readability. .article-related renders
   up to 3 other articles at the bottom as the cluster footer.
   --------------------------------------------------------------------------- */
.article-page { /* container element only */ }

.article-hero { padding: 72px 0 28px; }
.article-hero .h1 { max-width: 22ch; letter-spacing: -0.035em; }
.article-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  font-family: var(--font-display);
  font-size: 13px;
  color: var(--muted);
  letter-spacing: -0.01em;
}
.article-meta .article-date { color: var(--ink-soft); }
.article-meta .article-sep { color: var(--hair); }

.article-body { padding: 16px 0 88px; }
.article-body .wrap { max-width: 720px; }
.article-body h1 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2rem, 3.4vw, 2.8rem);
  letter-spacing: -0.035em;
  line-height: 1.05;
  margin: 0 0 28px;
}
.article-body h2 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(1.45rem, 2.2vw, 1.8rem);
  letter-spacing: -0.025em;
  line-height: 1.15;
  margin: 48px 0 18px;
}
.article-body h3 {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.2rem;
  letter-spacing: -0.02em;
  margin: 34px 0 12px;
}
.article-body p {
  font-size: 1.075rem;
  line-height: 1.7;
  color: var(--ink-soft);
  margin: 0 0 18px;
}
.article-body strong { color: var(--ink); }
.article-body em { font-style: italic; }

.article-related { padding: 72px 0; background: var(--wash); border-top: 1px solid var(--hair); }
.related-rows { display: flex; flex-direction: column; }
.related-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 36px;
  padding: 28px 0;
  border-top: 1px solid var(--hair);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s;
}
.related-row:last-child { border-bottom: 1px solid var(--hair); }
.related-row:hover { background: rgba(255,255,255,0.5); text-decoration: none; }
.related-row:hover .related-row-h { color: var(--accent); }
.related-row-tag {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--accent);
  padding-top: 4px;
}
.related-row-h {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 0 0 6px;
  color: var(--ink);
  transition: color 0.15s;
}
.related-row-body p {
  font-size: 0.98rem;
  color: var(--ink-soft);
  margin: 0;
  max-width: 60ch;
}

@media (max-width: 840px) {
  .article-hero { padding: 56px 0 20px; }
  .article-body { padding: 12px 0 64px; }
  .related-row { grid-template-columns: 1fr; gap: 8px; padding: 22px 0; }
}
```

## Part 4 — Build and verify

Run the site's build (e.g. `npm run build`) and confirm:

- No build errors.
- The article pages render with the new hero, the constrained reading column, and the related-articles footer.
- `/articles/` index page still renders correctly.
- Homepage, About, Services, Contact still render correctly (you only added a new layout and modified article markdown).

## Part 5 — Commit, do not push

Commit all changes in a single commit with message:

```
Restructure article rendering: extract layouts/article.njk, migrate six articles, add article-body styles
```

Report back: the commit hash, what files changed, any warnings from the build, and confirmation that the site renders.

**DO NOT push to main.** Micaiah pushes manually after reviewing what the deploy would change.

# Article Cleanup — Worker Task (H1 dedup + link scoping + related footer)

**PREREQUISITE.** This task assumes `prompts/article-layout-restructure.md` has already been executed and committed (currently sitting unpushed as commit `4a0713d`). Do not run this task before that one is in place.

This is a three-part cleanup commit that addresses everything left open by the restructure: the duplicate H1, the article body links that lost their styling, and the slightly uneven related-articles footer count. Do all three parts in the same commit. Build to verify. Commit only — do not push.

## Context

After the layout restructure, three known issues are sitting on `main`:

1. Every article renders its title twice — once in the styled `.article-hero`, once as the `# Title` H1 in the body markdown.
2. Article body links no longer have the ink-with-hairline-underline styling, because that rule was scoped to `.post` and the new layout wraps the body in `.article-body`.
3. The related-articles footer shows 2 articles on the most recent post and 3 on older ones, because the loop caps by index in the full list rather than by count of rendered rows.

All three are getting fixed in one commit.

## Part 1 — Remove the duplicate body H1 from each article

Files to edit (all under `site/src/articles/`):

1. `the-work-that-shouldnt-be-manual.md`
2. `automate-customer-service.md`
3. `business-process-automation-tools.md`
4. `business-process-automation.md`
5. `business-process-automation-software.md`
6. `workflow-automation-tools.md`

For EACH file, locate the first `# ` heading in the markdown body (NOT in the frontmatter — the frontmatter `title:` field stays). It will be the first line of body content immediately after the frontmatter closes, possibly with a blank line above it.

**Remove that single H1 line and any blank line immediately following it.**

Leave everything else in the body — every H2 (`##`), every paragraph, every link, every blockquote, every list — exactly as it is. Do not edit, reorder, reword, or "clean up" anything else.

Verification rules per file:

- The frontmatter still has `title: "..."` matching the original.
- The first line of body content is **no longer** a `# Heading` — it's the first paragraph of the article.
- Every `##` (H2) section heading is still present.
- The total word count is approximately the original minus the H1 text only (5–15 words removed).

Spot-check at least two files by eye before committing. If a file does not match this pattern (e.g. it doesn't have a body H1, or it has multiple H1s), STOP and report — do not guess.

## Part 2 — Re-scope article body link styling

In `site/src/assets/style.css`, find this block (near the bottom of the file, added in an earlier commit):

```css
/* ---------------------------------------------------------------------------
   Article body link styling — scoped to .post (article body containers).
   Inline prose links default to ink-colored with a subtle hairline underline;
   they light crimson on hover. This overrides the global `a { color: var(--accent) }`
   rule so that interlinks scattered through an article don't read as patches
   of red text. Other site links (nav, listings, buttons) live outside .post
   and are unaffected.
   --------------------------------------------------------------------------- */
.post a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--hair);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: color 0.15s, text-decoration-color 0.15s;
}
.post a:hover {
  color: var(--accent);
  text-decoration-color: var(--accent);
}
```

Replace it with this updated block that covers both the legacy `.post` container and the new `.article-body` container:

```css
/* ---------------------------------------------------------------------------
   Article body link styling — scoped to .post (legacy) AND .article-body (new
   layout). Inline prose links default to ink-colored with a subtle hairline
   underline; they light crimson on hover. This overrides the global
   `a { color: var(--accent) }` rule so that interlinks scattered through an
   article don't read as patches of red text. Other site links (nav, listings,
   buttons) live outside these containers and are unaffected.
   --------------------------------------------------------------------------- */
.post a,
.article-body a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--hair);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: color 0.15s, text-decoration-color 0.15s;
}
.post a:hover,
.article-body a:hover {
  color: var(--accent);
  text-decoration-color: var(--accent);
}
```

The only change is adding `.article-body a` and `.article-body a:hover` to the selectors. Don't modify anything else in the file.

## Part 3 — Fix the related-articles footer count

In `site/src/_includes/layouts/article.njk`, find this block:

```njk
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
```

Replace it with this version that filters out the current page **first** and then counts rendered rows, so the footer always shows up to 3 actual related articles regardless of where the current post sits in the list:

```njk
  {%- set related = collections.articles | reverse -%}
  {%- set otherCount = 0 -%}
  {%- for post in related -%}{%- if post.url != page.url -%}{%- set otherCount = otherCount + 1 -%}{%- endif -%}{%- endfor -%}
  {%- if otherCount > 0 -%}
  <section class="article-related"><div class="wrap">
    <div class="se">Keep reading</div>
    <h2 class="h2">Other writing from the firm</h2>
    <div class="rule"></div>
    <div class="related-rows">
      {%- set shown = 0 -%}
      {%- for post in related -%}
        {%- if post.url != page.url and shown < 3 -%}
          <a class="related-row" href="{{ post.url }}">
            <div class="related-row-tag">Article</div>
            <div class="related-row-body">
              <h3 class="related-row-h">{{ post.data.title }}</h3>
              {% if post.data.summary %}<p>{{ post.data.summary }}</p>{% endif %}
            </div>
          </a>
          {%- set shown = shown + 1 -%}
        {%- endif -%}
      {%- endfor -%}
    </div>
  </div></section>
  {%- endif -%}
```

The rest of `article.njk` (the article hero and the article body wrapper) stays exactly as it is.

Note on Nunjucks set-in-loop: if the build environment treats `{% set %}` inside a `{% for %}` as a no-op (scoped to loop iteration), the `shown` counter won't increment. If that turns out to be the case in this Eleventy setup, use this alternative loop body instead (replacing only the inner `{%- for post in related -%}` block):

```njk
      {%- for post in related | rejectattr("url", "equalto", page.url) | slice(3) | first -%}
        {%- for post in post -%}
          <a class="related-row" href="{{ post.url }}">
            <div class="related-row-tag">Article</div>
            <div class="related-row-body">
              <h3 class="related-row-h">{{ post.data.title }}</h3>
              {% if post.data.summary %}<p>{{ post.data.summary }}</p>{% endif %}
            </div>
          </a>
        {%- endfor -%}
      {%- endfor -%}
```

Use whichever variant builds correctly. Report which one was used.

## Part 4 — Build and verify

Run the site build. Confirm:

- No build errors.
- Loading any article page shows the title **once** (in the styled hero only).
- Inline interlinks inside the article body are ink-colored with a subtle underline, and turn crimson on hover.
- The related-articles footer on each article shows up to 3 other articles, never less than 3 unless there genuinely aren't 3 others published.
- The `/articles/` index page still lists all six articles correctly.
- Homepage, About, Services, Contact still render normally.

## Part 5 — Commit, do not push

Commit all changes in a single commit with message:

```
Article cleanup: remove duplicate H1, re-scope link styling to .article-body, fix related-footer count
```

Report back: the commit hash, list of files changed, which related-footer variant was used (the `set`-in-loop or the `rejectattr`/`slice` alternative), and confirmation that the rendered pages show one title, properly-styled body links, and up to 3 related articles in the footer.

**DO NOT push to main.** Micaiah pushes manually after reviewing what the deploy would change.

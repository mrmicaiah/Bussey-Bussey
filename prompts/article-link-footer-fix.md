# Article Link + Footer Fix — Worker Task

This is a small two-part follow-up to the restructure and H1 dedup. It re-scopes article body link styling to the new `.article-body` container, and fixes the related-articles footer so it consistently shows up to 3 related articles. Do both parts in the same commit. Build to verify. Commit only — do not push.

## Context

After the layout restructure (`4a0713d`) and the H1 dedup (`90fc03a`), two known issues remain on `main`:

1. Article body links no longer have the ink-with-hairline-underline styling, because that CSS rule was scoped to `.post` and the new layout wraps the body in `.article-body`.
2. The related-articles footer shows 2 articles on the most recent post and 3 on older ones, because the loop caps by index in the full list rather than by count of rendered rows.

Both get fixed in a single commit.

## Part 1 — Re-scope article body link styling

In `site/src/assets/style.css`, find this block (near the bottom of the file):

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

The only change is adding `.article-body a` and `.article-body a:hover` to the two selector lists. Don't modify anything else in the file.

## Part 2 — Fix the related-articles footer count

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

Replace it with this version that filters the current page out **first** and then takes only the first 3 of what remains, so the footer reliably shows up to 3 related articles regardless of where the current post sits in the full list:

```njk
  {%- set related = collections.articles | reverse -%}
  {%- set others = [] -%}
  {%- for post in related -%}
    {%- if post.url != page.url -%}
      {%- set others = (others.push(post), others) | last -%}
    {%- endif -%}
  {%- endfor -%}
  {%- if others.length > 0 -%}
  <section class="article-related"><div class="wrap">
    <div class="se">Keep reading</div>
    <h2 class="h2">Other writing from the firm</h2>
    <div class="rule"></div>
    <div class="related-rows">
      {%- for post in others.slice(0, 3) -%}
        <a class="related-row" href="{{ post.url }}">
          <div class="related-row-tag">Article</div>
          <div class="related-row-body">
            <h3 class="related-row-h">{{ post.data.title }}</h3>
            {% if post.data.summary %}<p>{{ post.data.summary }}</p>{% endif %}
          </div>
        </a>
      {%- endfor -%}
    </div>
  </div></section>
  {%- endif -%}
```

If `others.push(post)` or `.slice(0, 3)` doesn't work in this Nunjucks setup (Eleventy v3 uses Nunjucks, which supports these on plain arrays — but flag if it doesn't), fall back to this simpler index-counter variant which uses Nunjucks `loop.index0` against a pre-filtered list:

```njk
  {%- set others = collections.articles | reverse -%}
  {%- if others.length > 0 -%}
  <section class="article-related"><div class="wrap">
    <div class="se">Keep reading</div>
    <h2 class="h2">Other writing from the firm</h2>
    <div class="rule"></div>
    <div class="related-rows">
      {%- set ns = { shown: 0 } -%}
      {%- for post in others -%}
        {%- if post.url != page.url and ns.shown < 3 -%}
          <a class="related-row" href="{{ post.url }}">
            <div class="related-row-tag">Article</div>
            <div class="related-row-body">
              <h3 class="related-row-h">{{ post.data.title }}</h3>
              {% if post.data.summary %}<p>{{ post.data.summary }}</p>{% endif %}
            </div>
          </a>
          {%- set ns.shown = ns.shown + 1 -%}
        {%- endif -%}
      {%- endfor -%}
    </div>
  </div></section>
  {%- endif -%}
```

The fallback uses an object (`ns`) for the counter because Nunjucks `{% set %}` inside a `{% for %}` loop only modifies the loop scope unless the variable is a property on an object.

Use whichever variant builds correctly. Report which one was used.

The rest of `article.njk` (the article hero and the article body wrapper) stays exactly as it is.

## Part 3 — Build and verify

Run the site build. Confirm:

- No build errors.
- Loading any article page shows inline interlinks in the body as ink-colored with a subtle underline, turning crimson on hover.
- The related-articles footer on each article shows up to 3 other articles (always 3 in this case since there are 6 articles total and the current one is excluded — so each article should see 3 in its footer, not 2).
- The `/articles/` index page still lists all six articles correctly.
- Homepage, About, Services, Contact still render normally.

## Part 4 — Commit, do not push

Commit all changes in a single commit with message:

```
Article link + footer fix: scope link styling to .article-body, related-footer always shows up to 3
```

Report back: the commit hash, list of files changed, which related-footer variant was used (the array-push or the object-counter fallback), and confirmation that body links are styled and footers show 3 related articles.

**DO NOT push to main.** Micaiah pushes manually after reviewing what the deploy would change.

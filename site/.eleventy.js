import pluginRss from '@11ty/eleventy-plugin-rss';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);

  // Static asset passthrough — CSS, chat widget JS, images.
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });

  // Per-opportunity demos live at /demos/[token]/ in the repo root. Eleventy
  // serves them at the same path in dev. The presentation iframe points at
  // `${DEMO_URL_BASE}/demos/[token]/` (configured via the Worker's env).
  eleventyConfig.addPassthroughCopy({ '../demos': 'demos' });

  // Collections — articles, blog posts — ordered by date desc.
  for (const name of ['articles', 'blog']) {
    eleventyConfig.addCollection(name, (api) =>
      api
        .getFilteredByGlob(`src/${name}/*.md`)
        .filter((p) => !p.data.draft)
        .sort((a, b) => (b.date?.getTime?.() ?? 0) - (a.date?.getTime?.() ?? 0)),
    );
  }

  // Collection items minus the one whose `url` matches (the current page).
  // Used by layouts/article.njk for the "Keep reading" footer. A filter is
  // needed because this Nunjucks (3.2.4) build can't express exclude-then-limit
  // inline: array `.push`/`.concat` and `{% set obj.prop %}` fail to compile,
  // and selectattr/rejectattr with the `equalto` test ignore the comparison arg.
  eleventyConfig.addFilter('excludeUrl', (items, url) =>
    (items || []).filter((item) => item.url !== url),
  );

  // Simple date filter for human-friendly dates in templates.
  eleventyConfig.addFilter('date', (value, fmt = 'medium') => {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    if (fmt === 'iso') return d.toISOString();
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  });

  return {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
    templateFormats: ['njk', 'md', '11ty.js'],
  };
}

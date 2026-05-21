import pluginRss from '@11ty/eleventy-plugin-rss';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);

  // Static asset passthrough — CSS, chat widget JS, images.
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });

  // Per-opportunity demos live at /demos/[token]/ in the repo root. Eleventy
  // serves them at the same path in dev. The presentation iframe points at
  // `${DEMO_URL_BASE}/demos/[token]/` (configured via the Worker's env).
  eleventyConfig.addPassthroughCopy({ '../demos': 'demos' });

  // Collections — articles, blog posts, case studies — ordered by date desc.
  for (const name of ['articles', 'blog', 'case-studies']) {
    eleventyConfig.addCollection(name, (api) =>
      api
        .getFilteredByGlob(`src/${name}/*.md`)
        .filter((p) => !p.data.draft)
        .sort((a, b) => (b.date?.getTime?.() ?? 0) - (a.date?.getTime?.() ?? 0)),
    );
  }

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

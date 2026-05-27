/**
 * Global site config. Available in templates as `site.X`.
 *
 * `apiBase` controls where the chat widget POSTs. Empty string = same-origin
 * (production). For local dev with Eleventy on :8080 and the Worker on :8787,
 * override via `BUSSEY_API_BASE` env when running `pnpm dev:site`.
 */
export default {
  name: 'Bussey and Bussey',
  tagline: 'Operations and AI for B2B service businesses.',
  url: 'https://busseyandbussey.com',
  language: 'en',
  apiBase: process.env.BUSSEY_API_BASE ?? 'http://localhost:8787',
  currentYear: new Date().getFullYear(),
};

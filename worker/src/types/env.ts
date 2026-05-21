/**
 * Worker environment bindings + secrets.
 * Mirror of the bindings declared in worker/wrangler.toml plus secrets from .dev.vars.
 */
export type Env = {
  // Bindings (declared in wrangler.toml)
  DB: D1Database;
  FILES: R2Bucket;
  SESSIONS: KVNamespace;

  // Secrets (from .dev.vars locally, `wrangler secret put` in production)
  ANTHROPIC_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  /** Publishable key — sent to the portal frontend for Stripe Elements. Public by Stripe design. */
  STRIPE_PUBLISHABLE_KEY: string;
  RESEND_API_KEY: string;
  SESSION_SECRET: string;
  ADMIN_NOTIFY_EMAILS: string;
  ENV: 'development' | 'staging' | 'production';
  /** Base URL where the per-opportunity demo static files are served, e.g. `http://localhost:8080`
   *  in dev (Eleventy) and an empty string in production (same-origin). Iframe loads
   *  `${DEMO_URL_BASE}/demos/:token/`. */
  DEMO_URL_BASE: string;
  /** Root URL of the admin SPA, used to build links in admin-facing notification emails.
   *  Dev: `http://localhost:5173/admin`. Prod: whatever DNS resolves to the admin Pages
   *  deployment. Code constructs `${ADMIN_URL_BASE}/leads/:id` etc. — no trailing slash. */
  ADMIN_URL_BASE: string;
  /** Root URL of the client portal SPA, used to build links in client-facing emails
   *  (welcome, change order proposed, payment receipts). Dev: `http://localhost:5174/portal`.
   *  Prod: whatever DNS resolves to the portal Pages deployment. No trailing slash. */
  PORTAL_URL_BASE: string;
};

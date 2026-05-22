# Environment variable inventory

Full inventory of every variable the worker, admin, and portal read at
runtime or build time. Two categories:

- **SECRET** — installed via `wrangler secret put <NAME> --env <env>`,
  encrypted at rest by Cloudflare, never logged, never committed to
  the repo. Local dev reads these from `worker/.dev.vars` (gitignored).
- **PUBLIC** — declared in `worker/wrangler.toml` under
  `[env.<env>.vars]`, visible in `wrangler deploy --dry-run` output
  and in the dashboard. Never put a secret here.

Per-variable detail follows. Anything currently in `worker/.dev.vars`
or referenced in worker / admin / portal code paths is listed.

---

## Worker SECRETS

### `ANTHROPIC_API_KEY`

- **Purpose**: Authenticates the worker's outbound calls to the
  Anthropic Messages API (the public chat at `/api/chat/*`).
- **Sensitivity**: SECRET.
- **Source**: <https://console.anthropic.com> → API Keys → Create Key.
- **Environments**: dev, staging, production.
- **Dev value**: `.dev.vars` placeholder `sk-ant-replace-me`; chat
  endpoint detects the placeholder and returns a deterministic stub
  response instead of hitting the API (see
  `worker/src/routes/public/chat.ts`).
- **Staging value**: real Anthropic key. User's call whether it's
  the same key as dev or a separate one — same is fine for
  simplicity since usage is tiny.
- **Production value**: real Anthropic key, ideally a separate one
  from dev/staging so usage can be measured per environment.

### `STRIPE_SECRET_KEY`

- **Purpose**: Authenticates the worker's outbound calls to the
  Stripe REST API (customer/subscription/invoice creation, billing
  portal sessions).
- **Sensitivity**: SECRET.
- **Source**: <https://dashboard.stripe.com> → Developers → API keys.
  Test mode shows `sk_test_…`; live mode shows `sk_live_…` (and
  requires business identity verification).
- **Environments**: dev, staging, production.
- **Dev value**: `.dev.vars` placeholder `sk_test_replace_me`. The
  setup-payment service detects the placeholder (`isStripeDevPlaceholder`)
  and writes synthetic `dev_*` Stripe IDs instead of calling the
  REST API.
- **Staging value**: real Stripe **TEST** secret key (`sk_test_…`).
- **Production value**: real Stripe **LIVE** secret key (`sk_live_…`).
  Deferred until Stripe business activation completes — see M.3.4.

### `STRIPE_WEBHOOK_SECRET`

- **Purpose**: HMAC signing secret used to verify incoming Stripe
  webhook deliveries. The worker rejects any webhook whose
  `stripe-signature` header doesn't HMAC-match against this secret.
- **Sensitivity**: SECRET.
- **Source**: Stripe dashboard → Developers → Webhooks → (select
  endpoint) → "Signing secret" (whsec_…). In dev: comes from
  `stripe listen --forward-to localhost:8787/api/webhooks/stripe`
  output. Each environment has its own webhook endpoint with its
  own secret.
- **Environments**: dev, staging, production.
- **Dev value**: `.dev.vars` placeholder `whsec_replace_me` — gets
  replaced with the value `stripe listen` prints when testing the
  webhook path locally.
- **Staging value**: deferred until M.5 (Stripe webhook endpoint
  configuration); created at the same time as the staging endpoint
  in the Stripe dashboard.
- **Production value**: deferred until M.5; created with the
  production webhook endpoint, requires live-mode Stripe.

### `RESEND_API_KEY`

- **Purpose**: Authenticates the worker's outbound calls to Resend
  for transactional email (admin notifications, welcome emails,
  receipts, change-order proposals).
- **Sensitivity**: SECRET.
- **Source**: <https://resend.com> → API Keys.
- **Environments**: dev, staging, production.
- **Dev value**: `.dev.vars` placeholder `re_replace_me`. The
  `sendEmail` helper detects the placeholder and writes a
  `status='queued'` row to `notification` without hitting Resend.
- **Staging value**: real Resend key. User's call whether it's the
  same key as dev or a staging-specific one.
- **Production value**: real Resend key with a verified sending
  domain (`busseyandbussey.com`).

### `SESSION_SECRET`

- **Purpose**: HMAC signing secret used to sign + verify admin and
  portal session tokens.
- **Sensitivity**: SECRET.
- **Source**: locally-generated random 32+ bytes. Recommended:
  `openssl rand -hex 32` → 64-char hex string.
- **Environments**: dev, staging, production.
- **Dev value**: a real random hex string already in `.dev.vars` (NOT
  a placeholder) — fine since local sessions never reach production.
- **Staging value**: fresh `openssl rand -hex 32` — must NOT match
  dev or production.
- **Production value**: fresh `openssl rand -hex 32` — must NOT
  match dev or staging.
- **Note**: rotating this invalidates every active session for that
  environment. Plan accordingly.

### `ADMIN_NOTIFY_EMAILS`

- **Purpose**: Comma-separated list of admin email addresses that
  receive system notifications (new lead captured, change order
  events, payment failures, walkthrough completion).
- **Sensitivity**: SECRET (transitionally — see Note).
- **Source**: admin's personal email (until business email is set up
  at `busseyandbussey.com`).
- **Environments**: dev (`team@example.com` in `.dev.vars`), staging +
  production (set via `wrangler secret put ADMIN_NOTIFY_EMAILS --env
  <env>`).
- **Format**: comma-separated, no spaces strictly required (the parser
  in `worker/src/services/email.ts` trims each entry).
- **Note**: this variable lives in the SECRET tier *temporarily*
  because the value is a personal email address rather than a
  business mailbox; treating it as a secret keeps it out of the
  committed wrangler.toml. Once business email is set up at the
  `busseyandbussey.com` domain, move this back to
  `[env.<env>.vars]` as a PUBLIC config and delete the secret. The
  wrangler.toml entry currently sits as `ADMIN_NOTIFY_EMAILS =
  "REPLACE_WITH_ADMIN_EMAIL"` — that placeholder is shadowed by the
  installed secret at runtime. Tracked in
  `notes/deferred-cleanup.md`.

---

## Worker PUBLIC config (in `wrangler.toml [env.<env>.vars]`)

### `ENV`

- **Purpose**: Environment marker the worker reads to decide
  log/debug levels and `secure: true/false` on cookies.
- **Sensitivity**: PUBLIC.
- **Environments**: dev (`"development"`), staging (`"staging"`),
  production (`"production"`).
- **Source**: hardcoded in wrangler.toml per environment block.

### `ADMIN_URL_BASE`

- **Purpose**: Root URL of the admin SPA. Used in admin-facing email
  bodies (new-lead notifications, change-order failure alerts).
- **Sensitivity**: PUBLIC.
- **Environments**: dev (`http://localhost:5173/admin`), staging
  (`https://admin-staging.busseyandbussey.com`), production
  (`https://admin.busseyandbussey.com`).
- **Format**: no trailing slash; code constructs `${ADMIN_URL_BASE}/leads/:id` etc.

### `PORTAL_URL_BASE`

- **Purpose**: Root URL of the client portal SPA. Used in
  client-facing email bodies (activation welcome, change-order
  review prompts, payment receipts, walkthrough handoff).
- **Sensitivity**: PUBLIC.
- **Environments**: dev (`http://localhost:5174/portal`), staging
  (`https://portal-staging.busseyandbussey.com`), production
  (`https://portal.busseyandbussey.com`).
- **Format**: no trailing slash.

### `DEMO_URL_BASE`

- **Purpose**: Base URL the per-opportunity demo iframe loads from
  on the presentation page. Iframe src is
  `${DEMO_URL_BASE}/demos/:token/`.
- **Sensitivity**: PUBLIC.
- **Environments**: dev (`http://localhost:8080` — Eleventy),
  staging (`https://demo-staging.busseyandbussey.com`), production
  (`https://demo.busseyandbussey.com`). The production hostname
  may collapse to same-origin (`""`) after M.4 DNS decisions.
- **Format**: no trailing slash.

### `STRIPE_PUBLISHABLE_KEY`

- **Purpose**: Stripe publishable key sent to the portal frontend
  (via `/api/portal/walkthrough/payment-config`) to mount Stripe
  Elements during the payment step of the walkthrough.
- **Sensitivity**: PUBLIC (Stripe designs publishable keys for
  client-side embed; safe to commit).
- **Source**: Stripe dashboard → Developers → API keys. Test mode
  shows `pk_test_…`; live mode shows `pk_live_…`.
- **Environments**: dev (`.dev.vars` placeholder `pk_test_replace_me`,
  triggers the dev-placeholder mode in PaymentStep.svelte), staging
  (real `pk_test_…`), production (`pk_live_…`, deferred until M.3.4).

---

## Admin frontend (build-time, Vite)

### `VITE_API_URL_BASE`

- **Purpose**: Root URL of the Worker API, used by the admin SPA's
  "Preview presentation" button to open `${VITE_API_URL_BASE}/p/:token`
  in a new tab. Vite inlines this at build time via
  `import.meta.env['VITE_API_URL_BASE']`.
- **Sensitivity**: PUBLIC (build-time constant, ends up in the SPA
  bundle).
- **Source**: `admin/.env` (or `.env.local` / `.env.production`).
- **Environments**: dev defaults to `http://localhost:8787` if unset.
  Staging: `https://api-staging.busseyandbussey.com` (or wherever
  the staging worker lands). Production: `https://api.busseyandbussey.com`.
- **Note**: the admin Svelte code reads with a `?? 'http://localhost:8787'`
  fallback so local dev works without ever setting the var.

---

## Site (Eleventy)

### `BUSSEY_API_BASE`

- **Purpose**: API base URL the website chat widget posts to.
- **Sensitivity**: PUBLIC.
- **Source**: process env at Eleventy build time
  (`site/src/_data/site.js`).
- **Environments**: dev defaults to `http://localhost:8787`; staging
  + production set explicitly in Pages env config.

---

## Per-environment summary table

| Variable                | Dev source           | Staging source                            | Production source                              |
|-------------------------|----------------------|-------------------------------------------|------------------------------------------------|
| ANTHROPIC_API_KEY       | .dev.vars (placeholder) | wrangler secret put (real)              | wrangler secret put (real, prod key)           |
| STRIPE_SECRET_KEY       | .dev.vars (placeholder) | wrangler secret put (sk_test_…)         | wrangler secret put (sk_live_…) — DEFERRED     |
| STRIPE_WEBHOOK_SECRET   | .dev.vars (`stripe listen` value) | wrangler secret put (DEFERRED to M.5) | wrangler secret put (DEFERRED to M.5)          |
| RESEND_API_KEY          | .dev.vars (placeholder) | wrangler secret put (real)              | wrangler secret put (real, verified domain)    |
| SESSION_SECRET          | .dev.vars (real, dev-only) | wrangler secret put (fresh openssl rand) | wrangler secret put (fresh, distinct)        |
| ENV                     | .dev.vars             | wrangler.toml [env.staging.vars]          | wrangler.toml [env.production.vars]            |
| ADMIN_URL_BASE          | .dev.vars             | wrangler.toml                             | wrangler.toml                                  |
| PORTAL_URL_BASE         | .dev.vars             | wrangler.toml                             | wrangler.toml                                  |
| DEMO_URL_BASE           | .dev.vars             | wrangler.toml                             | wrangler.toml                                  |
| ADMIN_NOTIFY_EMAILS     | .dev.vars             | wrangler secret put (personal, transitional) | wrangler secret put (personal, transitional) |
| STRIPE_PUBLISHABLE_KEY  | .dev.vars             | wrangler.toml (real `pk_test_…` pending)  | wrangler.toml (real `pk_live_…`) — DEFERRED    |
| VITE_API_URL_BASE       | admin/.env (or fallback) | admin/.env.staging build env             | admin/.env.production build env                |
| BUSSEY_API_BASE         | site default          | Pages env config                          | Pages env config                               |

---

## DEFERRED items

These cannot be installed until external dependencies are met:

- **`STRIPE_SECRET_KEY` (production)** — requires Stripe business
  identity verification complete + live mode enabled.
- **`STRIPE_WEBHOOK_SECRET` (staging + production)** — requires the
  matching webhook endpoint configured in the Stripe dashboard
  (M.5). Each environment gets its own webhook signing secret.
- **`STRIPE_PUBLISHABLE_KEY` (production)** — paired with the live
  secret key; arrives when business activation completes.
- **`RESEND_API_KEY` (production)** — requires a verified sending
  domain for `busseyandbussey.com`. Domain verification is M-human.

Production deployment is blocked on all four landing.

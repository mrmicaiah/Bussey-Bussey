# Bussey and Bussey

Internal operations platform + public web presence for Bussey and Bussey. Cloudflare Workers + D1 + R2 + KV backend; Eleventy public site; SvelteKit admin + portal frontends.

See `/specs` for architectural specs and `/data/pricing-components.csv` for the canonical pricing rate card.

## Workspaces

This is a pnpm monorepo.

| Workspace | Purpose |
|---|---|
| `worker` | Cloudflare Worker — API, Claude orchestration, Stripe webhooks |
| `site` | Eleventy public site (busseyandbussey.com) — _placeholder_ |
| `admin` | SvelteKit admin SPA — _placeholder_ |
| `portal` | SvelteKit client portal SPA — _placeholder_ |
| `shared` | Design tokens, shared components, shared types & utils — _placeholder_ |

Plus a few non-workspace folders:

| Folder | Purpose |
|---|---|
| `specs/` | Level 2 architectural specs |
| `data/` | Canonical seed data (pricing components, etc.) |
| `demos/` | Hand-built static demos, keyed by opportunity token |
| `migrations/` | D1 schema migrations |
| `templates/` | Contract + email Markdown templates |

## Getting Started

### Prerequisites

- **Node 20+** (`node --version`)
- **pnpm 9+** (`corepack enable && corepack prepare pnpm@9.12.0 --activate`, or install via `npm i -g pnpm`)
- **Wrangler CLI** (installed automatically as a `worker` devDependency; the global install is optional)
- A Cloudflare account (for `wrangler login`) when you're ready to provision D1/R2/KV

### Install

From the repo root:

```sh
pnpm install
```

### Configure local secrets

```sh
cp worker/.dev.vars.example worker/.dev.vars
# Edit worker/.dev.vars and fill in real values for each key.
# Generate SESSION_SECRET with:  openssl rand -hex 32
```

`.dev.vars` is gitignored and must never be committed.

### Provision Cloudflare resources (one-time, before first deploy)

```sh
cd worker

# Create D1 database, copy the returned database_id into wrangler.toml
wrangler d1 create bussey-bussey

# Create R2 bucket (binding name is FILES)
wrangler r2 bucket create bussey-bussey-files

# Create KV namespace, copy the returned id into wrangler.toml
wrangler kv namespace create SESSIONS
```

For local development, Wrangler will spin up local D1/R2/KV automatically — no Cloudflare account needed for `wrangler dev`.

### Run the stack locally

Three pieces during dev: the Worker API, the admin SPA (SvelteKit), and the public site (Eleventy). The SvelteKit dev server proxies `/api/*` to the Worker so admin cookies stay same-origin; the public site reaches the Worker directly (CORS allowed on `/api/chat/*` for anonymous calls).

```sh
# From repo root — runs worker + admin in parallel:
pnpm dev

# Or in separate terminals:
pnpm dev:worker   # http://localhost:8787 — Worker API
pnpm dev:admin    # http://localhost:5173/admin — Admin SPA
pnpm --filter @bussey/site dev   # http://localhost:8080 — Public Eleventy site
```

`GET http://localhost:8787/` on the Worker returns a JSON listing of every scaffolded route.
The Admin SPA lives at `http://localhost:5173/admin/`.
The public site lives at `http://localhost:8080/`.

### Bootstrap admin user (first time only)

```sh
pnpm seed:bootstrap-admin
```

Prints credentials to the terminal exactly once. Save them; the script can be re-run safely (idempotent on email) but won't print the password a second time.

### Migrations

The first D1 migration will be generated from `specs/02-data-model.md` after the schema spec is finalized — it is **not** generated yet. When ready, apply with:

```sh
cd worker
wrangler d1 migrations apply bussey-bussey --local   # local dev DB
wrangler d1 migrations apply bussey-bussey --remote  # production
```

See `migrations/README.md` for conventions.

### Type-checking

```sh
pnpm typecheck                         # all workspaces
pnpm -F @bussey/worker typecheck       # worker only
```

## License

Proprietary. All rights reserved.

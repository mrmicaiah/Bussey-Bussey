# 13 — Frontend Architecture

Three distinct frontend experiences served from one Cloudflare Pages deployment, all talking to the same Worker API.

## Frontends

| Frontend | Path | Stack | Auth |
|---|---|---|---|
| Public site | `/` (root) | Eleventy (static) | None |
| Admin app | `/admin/*` or `admin.busseyandbussey.com` | TBD (SPA) | admin_user session |
| Client portal | `/portal/*` or `portal.busseyandbussey.com` | TBD (SPA) | portal_account session |
| Presentation | `/p/:token/*` | Eleventy or hybrid | None (token-protected) |
| Demos | `/p/:token/demo/*` | Static (hand-built) | None (token-protected) |

## Public Site (Eleventy)

### Why Eleventy
- Content-driven (markdown for blog/articles/case studies)
- Fast builds, lightweight output
- Plays cleanly with Cloudflare Pages
- No framework lock-in for content
- Easy to add structured data, sitemaps, RSS, etc.

### Site Structure

```
/                         → Home
/services/                → Services overview
/industries/              → Industries overview
/industries/home-health/  → Home health vertical page
/industries/landscape/    → Landscape vertical page
/case-studies/            → Case study index
/case-studies/:slug/      → Individual case study
/articles/                → Articles index (long-form authority)
/articles/:slug/          → Individual article
/blog/                    → Blog index (shorter cadence)
/blog/:slug/              → Individual blog post
/about/                   → About the company
/contact/                 → Contact page
```

### Content Collections

In Eleventy:
- `case-studies/` — markdown files, structured frontmatter (client, industry, outcome metrics, quote)
- `articles/` — markdown files, frontmatter (author, date, tags, hero image)
- `blog/` — markdown files, frontmatter (date, tags)
- `industries/` — markdown files per vertical

### Shared Components / Layout

- Base layout with header/footer/chat widget on every page
- Component partials for case study cards, article cards, CTA blocks, etc.
- Nunjucks or Liquid templating (Eleventy default)

### Chat Widget

- Single JavaScript bundle injected into base layout
- Connects to Worker API at `/api/chat/*`
- Visible bottom-right corner, click to expand
- Session token stored in browser (sessionStorage or cookie)
- Lightweight — should add minimal weight to site (target <30KB JS)

### SEO / Performance

- Static-rendered, no runtime JS required for content
- Built-in sitemap, RSS, OpenGraph tags
- Image optimization via Eleventy Image
- Target Lighthouse scores: 95+ all categories

## Admin App

### Stack Choice

Admin is a real application (lots of CRUD, calculator, dispositions, etc.) — best served by an SPA framework.

**Recommendation: a single-page app in a modern framework.**

Candidates (decide at impl time):
- **Astro with islands of React/Solid/Svelte** — fits the Cloudflare ecosystem, hybrid SSR/SPA
- **SvelteKit** — clean, fast, easy to build admin UIs
- **Next.js** — heavy but well-known
- **HTMX + Hyperscript + server-rendered partials** — minimal client JS, all the logic in Worker (interesting if we want to keep stack small)

My lean: SvelteKit or Astro with Svelte islands. Light, fast, good DX. Both deploy cleanly to Cloudflare Pages.

### Admin App Structure

```
/admin/                       → Dashboard (overview, pending actions)
/admin/leads/                 → Lead inbox
/admin/leads/:id/             → Lead detail
/admin/clients/               → Client list
/admin/clients/:id/           → Client detail (tabs)
/admin/clients/:id/opportunities/:opp_id/  → Opportunity detail
/admin/clients/:id/opportunities/:opp_id/proposal/    → Calculator / proposal builder
/admin/clients/:id/opportunities/:opp_id/presentation → Presentation preview / link
/admin/clients/:id/opportunities/:opp_id/change-orders/:co_id/ → Change order builder
/admin/pricing/               → Pricing components management
/admin/calling-list/          → Calling list dashboard
/admin/calling-list/today/    → Today's cards
/admin/calling-list/import/   → CSV import
/admin/notifications/         → Notification log
/admin/audit/                 → Audit log viewer
/admin/settings/              → Admin settings, users
```

### Admin UX Principles

- Density over decoration — show information, minimize chrome
- Keyboard shortcuts for common actions (slash command palette? optional, nice)
- Inline editing where reasonable
- Clear status indicators throughout (badges, colored states)
- Sticky action bars (don't make admins scroll to find Save)
- Confirmation modals for destructive or irreversible actions
- Search bar global (cmd/ctrl+K opens command palette to jump anywhere)

### Calculator UI

Three-pane layout (left palette, middle line items, right totals) as specified in 05-workflow-opportunity-and-calculator.md. Drag-to-add or click-to-add components. Live recalculation. Save Draft / Preview / Clone buttons in action bar.

## Client Portal

### Stack Choice

Same framework decision as admin. Could share a codebase with admin (same SPA, different routes, different auth context) or be a separate deployment. Sharing is easier to maintain; separating gives cleaner security boundaries.

**Recommendation: share codebase, separate routes, strict auth-context separation.**

### Portal Structure

```
/portal/                      → Overview (default landing after login)
/portal/login/                → Login
/portal/walkthrough/          → First-login walkthrough (forced if not complete)
/portal/documents/            → Document library
/portal/documents/:id/        → Document view
/portal/change-orders/        → Change order list
/portal/change-orders/:id/    → Change order review / sign
/portal/project-status/       → Project status
/portal/payment/              → Payment & billing
/portal/account/              → Account settings
```

### Walkthrough UI

Full-page sequential flow, progress indicator at top showing 4 steps. Each step is its own route or state; cannot navigate away mid-walkthrough. Clean, focused, professional aesthetic — this is the client's first impression of the platform.

### Portal UX Principles

- Calm, professional, friendly — opposite of dense admin
- Mobile-first responsive (clients may check from phones)
- Clear actions, less density than admin
- Trust signals prominent (signed contracts, payment status, security)
- No marketing/upsell pressure — this is a working relationship

## Presentation Framework

### Approach

Presentations are public-readable (token-protected) and template-driven. Built into the Eleventy site at `/p/:token/` routes.

**Implementation options:**
1. **Dynamic via Worker:** Worker handles `/p/:token/*` routes, fetches opportunity data from D1, renders into a presentation template, returns HTML. Easier to keep up-to-date, supports edits without rebuild.
2. **Static via Eleventy build:** Each opportunity triggers an Eleventy rebuild that generates `/p/:token/*` pages. Faster runtime, but rebuilds on every opportunity edit.
3. **Hybrid:** Eleventy template + client-side data fetch from Worker for dynamic content.

**Recommendation: Hybrid.** Eleventy generates the presentation shell at `/p/:token/`. Client-side JS fetches the latest opportunity data from `/p/:token/data`. Demos are pure static files at `/p/:token/demo/`. This avoids rebuilds for every proposal edit, keeps demos as simple static files, and makes presenting fast.

### Presentation Pages

Each presentation = a multi-page experience with navigation:
- Cover
- Challenge
- Demo (iframe or in-page link to demo subroute)
- Solution
- Timeline
- Investment
- Next Steps
- Disposition (admin-only UI on top)

Keyboard navigation: left/right arrows, esc to dashboard. Mouse-friendly nav controls. Mobile-responsive but designed primarily for presenting.

## Demos

### Folder Structure

In the repo:
```
/demos/[opportunity_token]/
  index.html
  /assets/
  /pages/
    dashboard.html
    settings.html
    [...etc]
```

### Build

Demos are static. They are picked up by Eleventy passthrough (or served directly from Pages) at `/p/[opportunity_token]/demo/`.

No build complexity. Admin builds them by hand using Claude in IDE, using a shared component/style library that lives in `/demos/_shared/` (CSS, common JS, reusable HTML partials).

## Shared Component / Style Library

Common design tokens, components, and patterns shared across admin, portal, presentation, and demos:
- Brand colors, typography, spacing scale
- Buttons, form controls, badges, modals
- Tables, cards, status indicators

Stored in a `/shared/` directory in the repo. Imported as CSS + reusable templates.

This is what makes future demos fast: admin grabs from the shared library and assembles the demo with Claude.

## State Management (Admin / Portal SPAs)

- Server-side is source of truth; client state is cache
- Standard fetch + state library appropriate to framework choice
- Optimistic updates where appropriate; full reconciliation on save
- Don't over-engineer state management for v1

## Performance Targets

- Public site: Lighthouse 95+ across the board
- Admin: TTI <2s on broadband, smooth interactions
- Portal: TTI <2s, especially walkthrough must feel snappy
- Presentation: opens fast (subsecond), smooth navigation, no jank
- Mobile-responsive everywhere; mobile-first on portal

## Out of Scope (v1)

- PWA / offline capability
- Native mobile apps
- Localization / i18n
- A/B testing infrastructure
- Detailed analytics on admin/portal usage
- Custom theming per client

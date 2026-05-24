#!/usr/bin/env bash
#
# build-pages.sh — the ONE build command for the merged front-end Pages
# project (site + admin + portal), for both local runs and Cloudflare's
# git-connected build. It builds all three front ends with the correct
# build-time env values, then assembles the merged deploy dir (dist/).
#
# It does NOT deploy (Cloudflare deploys dist/ itself for git-connected
# projects; for a manual deploy use `wrangler pages deploy dist`).
# It does NOT touch the Worker — that is a separate `wrangler deploy`.
#
# Output dir: dist/  (set this as the Pages "Build output directory").
# Run from anywhere — the script cd's to the repo root itself.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root regardless of the invocation directory

# ── Build-time env (path-based topology ⇒ same-origin). In Cloudflare git
# builds these come from the PROJECT's Environment Variables (Cloudflare
# populates process.env). In CI (CF_PAGES=1) they are REQUIRED — fail loudly
# rather than silently ship a wrong-origin bundle. Locally they default to
# staging values for convenience. The production Pages project sets its own
# values (https://busseyandbussey.com) in its dashboard env vars.
if [ "${CF_PAGES:-}" = "1" ]; then
  : "${VITE_API_URL_BASE:?set VITE_API_URL_BASE in the Pages project env vars}"
  : "${BUSSEY_API_BASE:?set BUSSEY_API_BASE in the Pages project env vars}"
else
  : "${VITE_API_URL_BASE:=https://staging.busseyandbussey.com}"
  : "${BUSSEY_API_BASE:=https://staging.busseyandbussey.com}"
fi
export VITE_API_URL_BASE BUSSEY_API_BASE

echo "==> site (Eleventy)    BUSSEY_API_BASE=$BUSSEY_API_BASE"
pnpm --filter @bussey/site  build      # -> site/_site/  (incl. 404.html from src/404.njk)
echo "==> admin (SvelteKit)  VITE_API_URL_BASE=$VITE_API_URL_BASE"
pnpm --filter @bussey/admin build      # -> admin/build/  (assets prefixed /admin)
echo "==> portal (SvelteKit) (no build-time API var)"
pnpm --filter @bussey/portal build     # -> portal/build/ (assets prefixed /portal)

echo "==> assemble dist/"
rm -rf dist
cp -R site/_site dist                  # site at /  (carries dist/404.html, the site 404)
mkdir -p dist/admin dist/portal
cp -R admin/build/.  dist/admin/
cp -R portal/build/. dist/portal/

# Sub-path SPA deep-link fallback. Cloudflare Pages does ROOT-ONLY unmatched-
# path handling; sub-path _redirects 200-rewrites are valid syntax but inert
# on Pages (documented subdirectory-SPA limitation). So we use Pages'
# "nearest 404.html" lookup: make each SPA shell its subtree's 404.html. A
# miss under /admin/* then serves the admin shell, under /portal/* the portal
# shell, everything else the site 404. Deep links render correctly at a 404
# HTTP status (the SPA hydrates and client-routes; /api is unaffected). See
# context/deployment-runbook.md §6.2 / §6.8 and notes/deferred-cleanup.md.
cp dist/admin/index.html  dist/admin/404.html
cp dist/portal/index.html dist/portal/404.html

# _redirects: kept for forward-compat. Inert for sub-paths on Pages today,
# but would auto-upgrade these deep links from 404-status to a clean 200 if
# Pages ever honors sub-path proxy (redirects out-rank 404 handling).
printf '/admin/*  /admin/index.html  200\n/portal/* /portal/index.html 200\n' > dist/_redirects

echo "==> dist/ assembled:"
ls -1 dist | sed 's/^/    /'

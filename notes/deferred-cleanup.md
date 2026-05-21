# Deferred cleanup

Tracking items intentionally deferred during the build so we don't lose them.
Each entry: what, why deferred, when to revisit. New entries go at the top
(reverse chronological by which step they were decided in).

## Index

**By urgency to revisit:**

- *Before first real client signs anything:* [Contract template requires lawyer review](#contract-template-requires-lawyer-review-before-real-client-signing) · [Stripe dev-placeholder mode for setup-payment](#stripe-dev-placeholder-mode-for-setup-payment)
- *Before first production traffic:* [CORS on `/api/chat/*` is wide-open](#cors-on-apichat-is-wide-open) · [Session row cleanup (D1)](#session-row-cleanup-d1) · [Production routing for `/p/:token/demo/`](#production-routing-for-ptokendemo) · [Calculator's "Preview presentation" URL hardcoded](#calculators-preview-presentation-url-is-hardcoded-to-localhost8787) · [New-lead notification email hardcoded admin URL](#new-lead-notification-email-has-a-hardcoded-admin-url) · [Portal URL hardcoded in activation service](#portal-url-is-hardcoded-in-the-activation-service)
- *Triggered by a second admin user:* [v1 bootstrap admin script — replace before second admin](#v1-bootstrap-admin-script--replace-before-second-admin) · [Owner-picker UX deferred until multi-admin](#owner-picker-ux-deferred-until-multi-admin) · [`/api/admin/auth/change-password` does not exist](#apiadminauthchange-password-does-not-exist)
- *Triggered by feature need:* [Notification preferences UI shipped but not yet enforced](#notification-preferences-ui-shipped-but-not-yet-enforced-in-send-logic) · [Signed-contract download is Markdown, not PDF](#signed-contract-download-is-markdown-not-pdf) · [`/api/portal/auth/change-password` is still stubbed](#apiportalauthchange-password-is-still-stubbed) · [Notes fields are single TEXT, spec asked for append-only](#notes-fields-are-single-text-spec-asked-for-append-only-with-timestamps) · [Margin/buffer indicators not implemented](#marginbuffer-indicators-not-implemented) · [Conversation context is the last 20 messages](#conversation-context-is-the-last-20-messages)
- *Triggered by a future data shape:* [`updated_at` only on `proposal`](#updated_at-only-on-proposal-other-entities-still-missing-it) · [`setup_and_monthly` unit_type contributes to BOTH buckets](#setup_and_monthly-unit_type-contributes-to-both-buckets) · [Clone of accepted proposal copies opportunity name verbatim](#clone-of-accepted-proposal-copies-opportunity-name-verbatim) · [Stripe subscription status enum is a 3-bucket lossy projection](#stripe-subscription-status-enum-is-a-3-bucket-lossy-projection) · [`notification.kind` enum missing change_order_rejected + change_order_failed](#notificationkind-enum-is-missing-change_order_rejected--change_order_failed) · [Temp password plaintext cached in KV with 24h TTL](#temp-password-plaintext-cached-in-kv-with-24h-ttl) · [client.status flips to 'active' on acceptance](#clientstatus-flips-to-active-on-acceptance-not-a-separate-activating-state) · [Status state-machines server-permissive client-restrictive](#status-state-machines-are-server-permissive-client-restrictive) · [Proposal totals cache-and-update on the proposal row](#proposal-totals-cache-and-update-on-the-proposal-row) · [Presentation HTML inlines its own JS bundle](#presentation-html-inlines-its-own-10-kb-js-bundle) · [Calculator's custom-line-item prompt is `window.prompt()`](#calculators-custom-line-item-prompt-is-windowprompt) · [Chat system prompt lives in a `.ts` file, not a `.md`](#chat-system-prompt-lives-in-a-ts-file-not-a-md) · [Chat dev-mode stub when ANTHROPIC_API_KEY is placeholder](#chat-dev-mode-stub-when-anthropic_api_key-is-placeholder) · [Admin SPA framework decision (locked)](#admin-spa-framework-decision-locked) · [`@cloudflare/workers-types` version bump](#cloudflareworkers-types-version-bump)

**By step in which the deferral was decided** (newest first):

- *K2 build:* [Notification preferences UI shipped but not yet enforced](#notification-preferences-ui-shipped-but-not-yet-enforced-in-send-logic)
- *K1 build:* [`notification.kind` enum missing change_order_rejected + change_order_failed](#notificationkind-enum-is-missing-change_order_rejected--change_order_failed)
- *J2 build:* [Signed-contract download is Markdown, not PDF](#signed-contract-download-is-markdown-not-pdf) · [Stripe dev-placeholder mode for setup-payment](#stripe-dev-placeholder-mode-for-setup-payment) · [Stripe subscription status enum is a 3-bucket lossy projection](#stripe-subscription-status-enum-is-a-3-bucket-lossy-projection)
- *I build:* [client.status flips to 'active' on acceptance](#clientstatus-flips-to-active-on-acceptance-not-a-separate-activating-state) · [Portal URL hardcoded in activation service](#portal-url-is-hardcoded-in-the-activation-service) · [Temp password plaintext cached in KV with 24h TTL](#temp-password-plaintext-cached-in-kv-with-24h-ttl) · [Contract template requires lawyer review](#contract-template-requires-lawyer-review-before-real-client-signing)
- *H build:* [Production routing for `/p/:token/demo/`](#production-routing-for-ptokendemo) · [Presentation HTML inlines its own JS bundle](#presentation-html-inlines-its-own-10-kb-js-bundle) · [`updated_at` only on `proposal`](#updated_at-only-on-proposal-other-entities-still-missing-it)
- *G2 build:* [Calculator's "Preview presentation" URL hardcoded](#calculators-preview-presentation-url-is-hardcoded-to-localhost8787) · [Calculator's custom-line-item prompt is `window.prompt()`](#calculators-custom-line-item-prompt-is-windowprompt) · [Margin/buffer indicators not implemented](#marginbuffer-indicators-not-implemented)
- *G1 build:* [Proposal totals cache-and-update on the proposal row](#proposal-totals-cache-and-update-on-the-proposal-row) · [`setup_and_monthly` unit_type contributes to BOTH buckets](#setup_and_monthly-unit_type-contributes-to-both-buckets) · [Clone of accepted proposal copies opportunity name verbatim](#clone-of-accepted-proposal-copies-opportunity-name-verbatim)
- *F build:* [CORS on `/api/chat/*` is wide-open](#cors-on-apichat-is-wide-open) · [Chat system prompt lives in a `.ts` file, not a `.md`](#chat-system-prompt-lives-in-a-ts-file-not-a-md) · [Chat dev-mode stub when ANTHROPIC_API_KEY is placeholder](#chat-dev-mode-stub-when-anthropic_api_key-is-placeholder) · [New-lead notification email hardcoded admin URL](#new-lead-notification-email-has-a-hardcoded-admin-url) · [Conversation context is the last 20 messages](#conversation-context-is-the-last-20-messages)
- *E build:* [Admin SPA framework decision (locked)](#admin-spa-framework-decision-locked) · [Notes fields are single TEXT, spec asked for append-only](#notes-fields-are-single-text-spec-asked-for-append-only-with-timestamps) · [Owner-picker UX deferred until multi-admin](#owner-picker-ux-deferred-until-multi-admin) · [Status state-machines server-permissive client-restrictive](#status-state-machines-are-server-permissive-client-restrictive)
- *D scoping/wrap-up:* [v1 bootstrap admin script](#v1-bootstrap-admin-script--replace-before-second-admin) · [Session row cleanup (D1)](#session-row-cleanup-d1) · [`/api/admin/auth/change-password` does not exist](#apiadminauthchange-password-does-not-exist) · [`/api/portal/auth/change-password` is still stubbed](#apiportalauthchange-password-is-still-stubbed)
- *B follow-up:* [`@cloudflare/workers-types` version bump](#cloudflareworkers-types-version-bump)

(Step L added no new entries — the L work surfaced only existing ones and
expanded the notification-prefs callsite map.)

---

## Notification preferences UI shipped but not yet enforced in send logic

- **What:** `portal_account.notify_change_orders` and
  `portal_account.notify_payments` (both INT 0/1, default 1) were added
  in migration 0007 alongside a portal Account UI that lets the client
  toggle them. The toggle persists and is reflected on reload. However,
  none of the email-send callsites currently consult these columns
  before firing — `change_order.proposed` notifications, the
  `walkthrough.completed` confirmation, the payment-succeeded/failed
  emails from the Stripe webhook, etc. all send unconditionally.
- **Why deferred:** the K2 scope explicitly punts the enforcement to a
  later iteration (per the K-scope's note about K3+). Shipping the UI
  first lets us collect preferences and surface them in the audit_log
  before any code change is needed to honor them.
- **When to revisit:** when we're ready to filter outgoing email by
  preference. Each callsite below should JOIN portal_account on the
  related client_id and short-circuit `sendEmail` when the relevant
  pref column is 0. Full `sendEmail` callsite map (from
  `grep -rln "sendEmail(" worker/src/`):

  **Client-facing — gate by prefs:**
  - `worker/src/routes/admin/change-orders.ts` — `change_order.proposed`
    email on admin propose; gate by `notify_change_orders`.
  - `worker/src/routes/portal/change-orders.ts` — admin-side rejection
    and Stripe-failure-on-approve notifications fire from portal
    handlers but go to admin only, so prefs don't apply. Approve-success
    admin email same. (No client-side email currently from this file.)
  - `worker/src/routes/webhooks/stripe.ts` — `payment_succeeded`
    (client receipt) and `payment_failed` (client + admin); gate the
    client side by `notify_payments`.
  - `worker/src/routes/admin/projects.ts` — `project_status_update`
    when admin passes `notify_client=true`; gate by a future
    `notify_project_status` pref (or fold into one of the existing two).
  - `worker/src/routes/portal/complete.ts` — walkthrough-complete
    welcome email. Essential transactional; do NOT gate (client needs
    confirmation that activation finished).

  **Admin-facing — prefs DO NOT apply:**
  - `worker/src/routes/admin/credentials.ts` — credentials handoff
    email to the client. Operational, not preference-gated (you can't
    not send credentials).
  - `worker/src/routes/portal/change-requests.ts` — notifies
    `ADMIN_NOTIFY_EMAILS` on client submission. Admin-only.
  - `worker/src/routes/public/chat.ts` — notifies admin on new lead.
    Admin-only.

  Note: the `sendEmail` helper itself in `worker/src/services/email.ts`
  is the place to add a future `respectClientPref(client_id, pref)`
  utility so each callsite only needs one JOIN check.
- **Decided:** during step K2 build; file list expanded at step L kickoff.

## notification.kind enum is missing change_order_rejected + change_order_failed

- **What:** The `notification.kind` CHECK constraint enumerates
  `new_lead, walkthrough_complete, change_order_proposed,
  change_order_approved, payment_succeeded, payment_failed,
  activation_credentials, project_status_update, other`. The K1
  change-order flow needs two more buckets that aren't in the enum:
  `change_order_rejected` (admin notified when client rejects) and
  `change_order_failed` (admin notified when Stripe declines on
  approve). Both currently route through `kind='other'` in
  `worker/src/routes/portal/change-orders.ts` (rejectChangeOrderHandler
  + the Stripe-failure path in approveChangeOrderHandler), which works
  but loses the type information needed for filtering / dashboards.
- **Why deferred:** schema migration on a CHECK constraint requires a
  table rebuild on SQLite. `kind='other'` carries the subject line and
  the entity reference (`relatedEntity`) so the messages are still
  attributable; the only downside is that anyone filtering
  `notification.kind = 'change_order_rejected'` finds nothing instead
  of the right rows. There's no UI consuming that filter today.
- **When to revisit:** when an admin dashboard or report wants to count
  rejections vs failures separately, or when a downstream system (CRM
  pipe, etc.) needs the kind discriminator. At that point: add both
  values to the enum via migration, replace the two `kind: 'other'`
  callsites in `change-orders.ts` with the proper values, and
  backfill historical 'other' rows that match the relatedEntity
  pattern.
- **Decided:** during step K1 build.

## Signed-contract download is Markdown, not PDF

- **What:** The "Download signed contract" CTA on the J2 done screen
  (`portal/src/lib/components/walkthrough/DoneStep.svelte`) ships the
  contract body as a Markdown blob (`<client>-contract.md`). The schema
  hints at PDF rendering — `contract.pdf_r2_key` exists for storing a
  PDF in R2, and spec 07 references rendering via Cloudflare Browser
  Rendering — but no PDF pipeline is built yet.
- **Why deferred:** PDF generation requires either Cloudflare Browser
  Rendering (paid, separate Worker binding, needs a render route that
  pretty-prints the HTML version of the contract) or a third-party PDF
  service. Either path is ~1 day of work — out of step J2's scope, which
  centered on Stripe.
- **When to revisit:** when an actual client needs a polished PDF
  download (vs. the markdown export which is fine for "look, my contract
  is here"). Likely first real client deploy. Implementation note:
  store the rendered PDF in R2 keyed by `contract.pdf_r2_key`, then have
  the download CTA hit a portal route that streams from R2.
- **Decided:** during step J2 build.

## Stripe dev-placeholder mode for setup-payment

- **What:** When `STRIPE_SECRET_KEY` is the `.dev.vars` placeholder
  (`sk_test_replace_me`), `POST /api/portal/walkthrough/setup-payment`
  fabricates synthetic Stripe IDs (`dev_cus_*`, `dev_sub_*`, `dev_in_*`)
  and skips the real Stripe REST calls. Same pattern as the chat
  (`worker/src/services/claude.ts`) and email (`worker/src/services/email.ts`)
  dev stubs. The portal frontend mirrors this: when `/payment-config`
  reports `dev_placeholder: true`, it shows a "Use placeholder payment
  method" button instead of Stripe Elements.
- **Why this is intentional:** lets devs exercise the entire walkthrough
  + portal + completion flow without a Stripe test account. The webhook
  signature verification path stays mandatory regardless — that's the
  user's explicit J2 directive ("non-negotiable per spec 12").
- **Watch out:** anyone deploying to staging/prod without setting a real
  `sk_test_…` (or `sk_live_…`) key will silently write synthetic Stripe
  rows. The first deploy must include `wrangler secret put
  STRIPE_SECRET_KEY` (and `STRIPE_PUBLISHABLE_KEY`).
- **Decided:** during step J2 build.

## Stripe subscription status enum is a 3-bucket lossy projection

- **What:** Stripe's subscription status enum has 8 values (active,
  past_due, canceled, incomplete, incomplete_expired, trialing, unpaid,
  paused). Our `stripe_subscription.status` CHECK is just (active,
  past_due, canceled). The setup-payment and webhook handlers funnel
  every Stripe status into one of those three (see
  `normalizeSubscriptionStatus` / `normalizeSubStatus`).
- **Why deferred:** the three buckets cover the operational distinctions
  the admin UI needs today (am I getting paid? is this dead?). The
  finer-grained states are useful for billing-admin tooling that we
  don't have yet.
- **When to revisit:** when the team needs to distinguish, say,
  `incomplete` (initial payment in-flight) from `active`, or `trialing`
  from `active` for a free-trial offer. Add the enum values via a
  CHECK constraint migration and remove the normalization functions.
- **Decided:** during step J2 build.

## client.status flips to 'active' on acceptance, not a separate 'activating' state

- **What:** On opportunity acceptance, the activation service sets `client.status = 'active'` (the existing enum value), not `'activating'`. The "Pending Activation" admin UX (spec 07) is driven by `portal_account.walkthrough_completed = 0`, not by a distinct client status.
- **Why:** the existing `client.status` enum is `prospect/active/paused/former`. Adding `'activating'` would have required a schema migration on the CHECK constraint for what is essentially a UX label — the business state (signed, locked pricing, billable) IS active at acceptance time, and the walkthrough-completion bit is the right place to express "credentials issued but not yet fully self-served."
- **When to revisit:** if we ever need to gate functionality on the distinction between "active but not yet onboarded" and "fully onboarded" at the client level (rather than at the portal_account level). At that point, either (a) add `'activating'` to the enum and migrate, or (b) keep `client.status = 'active'` and read the walkthrough flag wherever the distinction matters. Likely (b) is enough indefinitely.
- **Decided:** during step I build.

## Portal URL is hardcoded in the activation service

- **What:** The activation service hardcodes the portal URL (currently `http://localhost:5173/portal`) when constructing the credentials handoff payload. Same family as the deferred admin/presentation URL hardcodes.
- **Why deferred:** production hosting topology not yet decided. The "Email to Client" welcome email and the credentials handoff response both need the URL; centralizing it in one constant keeps the change to one line when we deploy.
- **When to revisit:** when we deploy. Replace the constant with `env.PORTAL_URL_BASE` (or whatever the deploy topology dictates). The constant lives at the top of `worker/src/services/activation.ts`.
- **Decided:** during step I build.

## Temp password plaintext cached in KV with 24h TTL

- **What:** The 24-hour credentials re-display window (spec 07 § "Re-display window") needs the plaintext temp password retrievable for 24 hours after issuance, since the admin may need to re-show it on the opportunity page. Implemented as `env.SESSIONS.put('temp_password:<portal_account_id>', plaintext, { expirationTtl: 86400 })`. After 24h the KV entry auto-expires and the "Show credentials" link in admin flips to "Reset password and share new credentials," which generates a fresh temp password and writes a new KV entry.
- **Why this approach:** Cloudflare KV's built-in TTL is the cleanest 24h expiry primitive — no cron, no expiry check on read, plaintext disappears automatically. Storing the plaintext in D1 (even encrypted at rest) would persist past the window. Memory in the Worker isolate isn't durable across requests.
- **Trade-off:** plaintext lives in KV for up to 24h, protected only by Cloudflare's at-rest encryption and our Workers binding. Anyone with the SESSIONS KV namespace credentials can read every active temp password. For sales-team-scale traffic this is acceptable; for higher-stakes deployments we'd want either (a) encrypt the plaintext with a per-namespace key from Workers Secrets before the PUT, or (b) drop the re-display window entirely and require a reset every time the admin needs to re-share.
- **When to revisit:** before broader rollout, or any time the KV blast-radius concern surfaces. Option (a) above is a ~10-line change in `worker/src/services/activation.ts`.
- **Decided:** during step I build.

## Contract template requires lawyer review before real client signing

- **What:** Contract template at `/templates/contract/master.md` is structurally complete starter language only — requires lawyer review before any real client signing. The template renders end-to-end through the activation flow (variable substitution + signature/initial/print/date markers) and is good enough to drive step J walkthrough testing.
- **Why deferred:** unblocks the activation flow and walkthrough testing without waiting on counsel. The template is clearly marked NOT FOR REAL SIGNING in an HTML comment block at the top, listing the specific items that need legal sign-off (governing law state, disputes jurisdiction, termination data-export language vs. actual capability, limitation of liability and warranty enforceability, confidentiality carve-outs).
- **When to revisit:** before the first real client is invited to sign a contract through the portal. When the lawyer-finalized template lands, replace `/templates/contract/master.md` in place — the activation flow generates contracts from this template exactly as it would from a finalized version (same variable substitution, same marker placement), so no code changes are required.
- **Decided:** during step I build.

## Production routing for `/p/:token/demo/`

- **What:** Per spec, demo iframes load from `/p/:opportunity_token/demo/`. For v1, the iframe URL is constructed as `${DEMO_URL_BASE}/demos/:token/` — `DEMO_URL_BASE` defaults to empty in prod (same-origin) and points at `http://localhost:8080` in dev (Eleventy). This means the prod URL becomes `/demos/:token/`, not the spec's `/p/:token/demo/`.
- **Why deferred:** the URL prefix mismatch is harmless if the prod host serves the same files at either prefix. Doing the actual path rewrite requires either Eleventy passthrough with a glob rename or a Cloudflare Pages routing rule — both depend on deploy topology we haven't finalized.
- **When to revisit:** when we decide where the public site is hosted. Likely a single Pages rewrite (`/p/:token/demo/* → /demos/:token/*`) or a worker route that proxies. Both are 30-line fixes.
- **Decided:** during step H build.

## Presentation HTML inlines its own ~10 KB JS bundle

- **What:** `worker/src/routes/public/presentation.ts` returns one HTML response with the entire navigation + polling JS inlined as a `<script>` block. Total response is ~17 KB.
- **Why this approach:** zero additional Worker routes, no asset deployment, no cache-busting story. For sales-call usage (dozens of concurrent presentations max), the per-request cost is negligible.
- **Trade-off:** the bundle re-ships on every page load even though it never changes between opportunities. At scale, splitting it into `/p/_/presentation.js` with a long cache lifetime would save bytes.
- **When to revisit:** if the team is doing high-volume presenting (every prospect opens the link from outreach), or if the JS bundle grows past ~30 KB.
- **Decided:** during step H build.

## `updated_at` only on `proposal`; other entities still missing it

- **What:** Migration 0003 added `proposal.updated_at` because the public-presentation polling needed a way to detect modifier-only and line-item-update changes. Other entities (`opportunity`, `client`, `lead`, `change_order`) still have no `updated_at` column. This supersedes the earlier "no updated_at by design" deferred note for proposals only.
- **Why deferred:** none of the other entities currently drive a polling client. Adding `updated_at` everywhere preemptively would be schema churn without a consumer.
- **When to revisit:** when a second live-sync client surfaces (likely the portal during change-order review, or the admin "recent activity" feed). Add `updated_at` to the relevant table at that point, with the same pattern as proposal.
- **Decided:** during step H build.

## Calculator's "Preview presentation" URL is hardcoded to localhost:8787

- **What:** `admin/src/routes/(authed)/clients/[id]/opportunities/[opp_id]/proposal/+page.svelte`'s `previewPresentation()` opens `http://localhost:8787/p/:token` in a new tab. Dev-only URL.
- **Why deferred:** production topology not yet decided. Same family as the new-lead notification email's hardcoded admin URL.
- **When to revisit:** when we deploy. Likely a `PRESENTATION_URL_BASE` field on `_data/site.js`-style admin config, or just same-origin once the Worker serves admin + presentation under one host.
- **Decided:** during step G2 build.

## Calculator's custom-line-item prompt is `window.prompt()`

- **What:** Adding a `custom_line_item` opens two browser prompts (description, then unit price). It works but is ugly and doesn't validate inline.
- **Why deferred:** ships the feature in ~10 lines. Replacing with a modal would be straight-forward but adds component overhead before the calculator's other UX warts have been observed in real use.
- **When to revisit:** first time someone (Micaiah or a sales hire) hits the calculator and the prompt feels jarring. Replace with a small `<CustomLineItemDialog>` component.
- **Decided:** during step G2 build.

## Margin/buffer indicators not implemented

- **What:** Spec 05 calls for a margin indicator and a buffer indicator on the totals panel ("internal: what % above cost"). The TotalsPanel currently shows a placeholder note instead.
- **Why deferred:** we don't model cost anywhere — `pricing_components.unit_price` is what we charge, not what something costs us. Margin can't be computed without cost data.
- **When to revisit:** when we decide how to track cost. Options: (a) `pricing_components.unit_cost` column, (b) a separate `cost_basis` table per component with effective dates, (c) attach cost to engagements after delivery. Worth a separate discussion.
- **Decided:** during step G2 build.

## Proposal totals: cache-and-update on the proposal row

- **What:** `proposal.setup_total` and `proposal.monthly_total` are cached on the row and recomputed by `recomputeProposalTotals()` on every line-item write, modifier change, and clone. List views read them directly without joining or summing.
- **Why this approach:** the user's instinct was right — list views will hit these constantly, and recomputing on every read scales poorly. The discipline is: any code path that mutates line items or modifiers must call `recomputeProposalTotals()` in the same operation.
- **What could go wrong:** a future writer forgets the recompute call, leading to stale totals. Mitigation: all mutations route through `worker/src/services/proposals.ts`. If/when more mutators land (e.g., post-acceptance change-order math), they go in the same module.
- **When to revisit:** if cache drift shows up in audit reconciliation. Easy fix: add a periodic job that recomputes totals for non-accepted proposals.
- **Decided:** during step G1 build.

## `setup_and_monthly` unit_type contributes to BOTH buckets

- **What:** Schema allows `unit_type = 'setup_and_monthly'` for a component. Today no seed component uses it. If one ever does, `recomputeProposalTotals()` adds the line total to both `setup_total` and `monthly_total`.
- **Why this is a placeholder:** spec 05 says "rare; better to model as two separate components." The semantics of a single component contributing identically to both totals is dubious — it usually means "this thing has a setup cost and a recurring cost, which are different amounts."
- **When to revisit:** the first time a real component uses `setup_and_monthly`. Either (a) split the line in two at write time, or (b) add a structured `setup_amount`/`monthly_amount` JSON to the line item.
- **Decided:** during step G1 build.

## Clone of accepted proposal copies opportunity name verbatim

- **What:** When cloning an accepted proposal, a new opportunity is created under the same client using the source opportunity's `name` verbatim. Admin can rename in the UI after.
- **Why deferred:** auto-renaming ("Audit-Ready Hiring System (re-engagement)") is opinionated and easy to get wrong. Leaving the name as-is lets the admin make the call.
- **When to revisit:** if it becomes clear admins almost always rename to a predictable pattern.
- **Decided:** during step G1 build.

## CORS on `/api/chat/*` is wide-open

- **What:** chat endpoints respond with `Access-Control-Allow-Origin: *` so the Eleventy dev server (`:8080`) can reach the Worker (`:8787`) without a proxy. Other API surfaces (admin, portal, webhooks) do not need CORS — same-origin during dev via Vite proxy / production assumption.
- **Why deferred:** anonymous chat sessions don't carry cookies, so CORS posture is low-risk for v1. Production needs to be tightened to the actual site origin(s).
- **When to revisit:** before first production traffic. Replace `*` with the specific allowed origins (`https://busseyandbussey.com`, staging URL, etc.) — single small edit in `worker/src/routes/public/chat.ts` (`corsHeaders()`).
- **Decided:** during step F build.

## Chat system prompt lives in a `.ts` file, not a `.md`

- **What:** `worker/src/config/chat-system-prompt.ts` exports `CHAT_SYSTEM_PROMPT` as a template string. The user's intent was a markdown config, easily edited.
- **Why deferred:** Wrangler can import `.md` as text with a build configuration tweak; doing it in `.ts` worked without touching the build. The string is still cleanly editable in a single file with no logic intermingled.
- **When to revisit:** if a non-engineer needs to edit the prompt and would benefit from markdown rendering on GitHub. Move to `worker/config/chat-system-prompt.md`, import with esbuild text loader configured in `wrangler.toml`.
- **Decided:** during step F build.

## Chat dev-mode stub when `ANTHROPIC_API_KEY` is placeholder

- **What:** `POST /api/chat/message` checks if the API key is `sk-ant-replace-me` (the .dev.vars.example value) and, if so, returns a deterministic stub response without calling Anthropic. Visible to the user: "(Bussey assistant isn't connected to Claude in this environment…)".
- **Why this is intentional:** lets developers run the full site + admin + worker stack locally without burning API tokens or fighting auth errors. The full chat loop (including `save_lead` tool calls and admin notification emails) requires a real key.
- **Watch out:** if anyone ships to staging/prod without a real key, every chat session will visibly say the bot isn't connected. Production deploy checklist must include `wrangler secret put ANTHROPIC_API_KEY`.
- **Decided:** during step F build.

## New-lead notification email has a hardcoded admin URL

- **What:** `worker/src/routes/public/chat.ts` constructs the "Open in admin" link as `http://localhost:5173/admin/leads/:id`. That's the dev URL.
- **Why deferred:** we don't yet have a production hosting topology decided (note above).
- **When to revisit:** when we deploy. Likely an `ADMIN_URL_BASE` env var that the email template reads.
- **Decided:** during step F build.

## Conversation context is the last 20 messages

- **What:** `chat.ts` loads the last 20 messages from `chat_message` and passes them to Claude on every turn. Matches spec 12 default.
- **Why worth knowing:** long conversations (rare on a sales chat) eventually drop early context. If a visitor mentions their name early then small-talks for 20 turns, Claude won't see the name when it comes time to call `save_lead`.
- **When to revisit:** if real conversations regularly exceed the window. Bump to 40 or add a system reminder, depending on what the data shows.
- **Decided:** during step F build.

## Admin SPA framework decision (locked)

- **Decision:** SvelteKit 2.x + Svelte 5 + `@sveltejs/adapter-static` in SPA mode (`fallback: 'index.html'`, `ssr: false` site-wide). Lives at `/admin/*` via `kit.paths.base = '/admin'`.
- **Why this works for v1:** Worker serves the API at `/api/*`. During dev, Vite proxies `/api/*` to `localhost:8787` so the browser sees a single origin and `HttpOnly` cookies just work. The SPA boots, calls `GET /api/admin/me`, redirects to `/admin/login` on 401, otherwise renders the dashboard.
- **What we'd want to revisit:**
  - **Production hosting topology.** Currently no `wrangler.toml` config that serves the SvelteKit build output. For prod we'll need either (a) the Worker to serve `admin/build/*` as static assets, or (b) Cloudflare Pages for SvelteKit with the Worker on a separate route. Both keep the single-origin property; pick the simpler one when we deploy.
  - **Admin + portal codebase sharing.** Spec 13 calls for "share codebase, separate routes, strict auth-context separation." Admin is currently standalone in `/admin`; the portal will live in `/portal`. The cheap shared layer is `/shared/components`, but we're not using it yet because admin has no second consumer. Refactor when portal lands.
  - **Route conflict at `/`.** The root `(authed)/+page.svelte` is now the dashboard. If someone hits `/admin/login` while already authed, they see the login form rather than being bounced to `/`. Cheap fix: a load function on `/login` that checks `/api/admin/me` and redirects if 200.
- **Decided:** during step E kickoff.

## Notes fields are single TEXT, spec asked for append-only with timestamps

- **What:** `lead.notes`, `client.notes`, and `opportunity.description` are single freely-editable TEXT columns. Spec 04 § "Client Detail View" describes Notes as "append-only notes with timestamps."
- **Why deferred:** modeling structured notes (separate `notes` table with `entity_type` / `entity_id` polymorphic ref, timestamps, author) was out of step E scope. For v1 the `audit_log` diff captures the "who/when/what changed" trail for the notes field, which is the substantive part of "append-only with timestamps."
- **When to revisit:** if the team starts treating notes as a conversation thread (multiple admins commenting over time) and the single-field UX feels lossy. The fix is a `note` table + a Notes panel in the entity detail UIs.
- **Decided:** during step E build.

## Owner-picker UX deferred until multi-admin

- **What:** `lead.owner_user_id` and `opportunity.owner_user_id` are auto-assigned to the creating admin. UI does not surface an owner dropdown.
- **Why deferred:** single admin in v1; a dropdown of one entry is noise. Schema is already correct.
- **When to revisit:** when a second admin user is added — same trigger as the proper-CLI-admin-creation flow.
- **Decided:** during step E build.

## Status state-machines are server-permissive, client-restrictive

- **What:** API allows any status transition for lead, client, opportunity (as long as the value is in the CHECK enum). UI dropdowns restrict to the documented forward path (`disqualified` is a dead-end, `converted` is only set via the conversion endpoint, etc.).
- **Why deferred:** mid-build, an admin sometimes legitimately needs to walk a status back (mistake, data correction). Strict server enforcement would just route around itself. Client-side guardrails cover the 95% case.
- **When to revisit:** if data hygiene becomes a problem (e.g., audit shows clients flipping between statuses constantly) or if we add cross-status invariants (e.g., "can't go from active back to prospect without a reason"). At that point, encode the state machine on the server.
- **Decided:** during step E build.

## v1 bootstrap admin script — replace before second admin

- **What:** `worker/scripts/seed-bootstrap-admin.mjs`. Hardcoded email + name, generates a random password, hashes via bcryptjs at 12 rounds, `INSERT OR IGNORE` into `admin_user`, prints the plaintext once. Local-only (no `--remote` flag). Does **not** write an `audit_log` row for the bootstrap event.
- **Why deferred:** approved as v1 expedient. The proper CLI flow (interactive prompts for email/name/password, `--remote` confirmation gate, `--generate` mode, `audit_log` row, exit-code-driven invariants, tested end-to-end via the actual auth API) was designed but not built.
- **Limitations of the v1 bootstrap as it stands:**
  - Only creates one user; not reusable for additional admins.
  - No `--remote` — can only seed local D1.
  - No audit_log row written for the bootstrap event.
  - Email/name are constants in the source file; changing requires editing the script.
  - Idempotent on the email column only (re-running with a different email creates a *second* admin without warning).
- **Trigger to revisit:** before we need to add a second admin user (real teammate, prod owner, recovery account, etc.). Once the proper CLI exists, delete this script.
- **Decided:** during step D scoping.

## Session row cleanup (D1)

- **What:** `admin_session` and `portal_session` rows are written on every login and marked `revoked_at` on logout, but never deleted. KV entries auto-expire via TTL; D1 grows monotonically.
- **Why deferred:** scale doesn't matter at zero traffic, and a delete-on-logout could race with concurrent revocation. Defer until we have any meaningful login volume.
- **When to revisit:** before first production traffic spike, or when `SELECT COUNT(*) FROM admin_session` exceeds ~10k. Solution is likely a periodic Worker cron that deletes rows where `expires_at < now() - 30 days` (admin) / `expires_at < now() - 180 days` (portal). Spec the cron in `wrangler.toml [triggers]`.
- **Decided:** during step D wrap-up.

## `/api/admin/auth/change-password` does not exist

- **What:** Admin password rotation has no endpoint at all. The portal has `/api/portal/auth/change-password` (still a 501 stub, but at least it's in the route inventory). Admin is not modeled in spec 12.
- **Why deferred:** the v1 bootstrap admin gets a generated random password and pastes it into a password manager. No immediate rotation need. Future admins will be created with strong passwords via the proper CLI (or the future admin UI), which can include rotation flows.
- **When to revisit:** when the admin UI lands or when a second admin user is added — whichever comes first.
- **Decided:** during step D wrap-up.

## `/api/portal/auth/change-password` is still stubbed

- **What:** Route inventory has the endpoint but the handler returns 501. It's intentionally not wired up in step D.
- **Why deferred:** Portal password change is bound up with the first-login walkthrough flow (`walkthrough_state` transitions, `must_change_password` clearing). Wiring it in isolation risks bypassing the walkthrough invariants. Better to build it as part of the walkthrough implementation step.
- **When to revisit:** when we build the portal walkthrough (workflow spec 08).
- **Decided:** during step D wrap-up.

## `@cloudflare/workers-types` version bump

- **Current:** `^4.20240924.0` (Sept 24, 2024) in `worker/package.json`.
- **Why deferred:** Wrangler is now on v4.92.0 with compat date `2026-05-18`,
  but nothing in the scaffold currently uses APIs that need a newer types
  package. Bumping now adds diff noise without delivering value.
- **When to revisit:** First time we hit a TypeScript error or missing API
  surface in the Worker that maps to a newer compatibility date. Bump to the
  latest `@cloudflare/workers-types` then.
- **How:** `pnpm --filter @bussey/worker add -D @cloudflare/workers-types@latest`
- **Decided:** during step B follow-up after wrangler 3 → 4 upgrade.

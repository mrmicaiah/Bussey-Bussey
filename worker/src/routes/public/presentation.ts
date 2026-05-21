import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * Public presentation endpoints.
 *
 *   GET /p/:opportunity_token        → HTML shell with inline JS for navigation + polling
 *   GET /p/:opportunity_token/data   → JSON payload, supports ?since=<iso> for 204 short-circuit
 *
 * Data security (per step H note):
 *   - never includes proposal.notes / proposal.presentation_notes / modifiers
 *   - never includes proposal_line_item.unit_price_at_snapshot in 'summary' or 'categorical' modes
 *   - in 'categorical', aggregates by snapshot category (no individual line item rows)
 *   - in 'summary', no line-item-level detail at all
 */

type OpportunityRow = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: string;
  presentation_token: string;
  created_at: string;
};

type ClientRow = {
  id: string;
  company_name: string;
  primary_contact_name: string | null;
};

type ProposalRow = {
  id: string;
  opportunity_id: string;
  name: string;
  status: string;
  setup_total: number;
  monthly_total: number;
  narrative_challenge: string | null;
  narrative_solution: string | null;
  key_capabilities: string | null;
  pricing_display_mode: 'summary' | 'categorical' | 'full';
  demo_enabled: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  accepted_at: string | null;
};

type LineItemRow = {
  id: string;
  component_code: string;
  quantity: number;
  unit_price_at_snapshot: number;
  line_total: number;
  description_override: string | null;
};

type SnapshotRow = { snapshot_data: string; snapshot_at: string };

type ComponentSnapshot = {
  code: string;
  name: string;
  description: string | null;
  category: string;
  unit_type: string;
  unit_price: number;
};

async function pickCurrentProposal(env: HandlerContext['env'], opportunityId: string): Promise<ProposalRow | null> {
  return env.DB.prepare(
    `SELECT * FROM proposal WHERE opportunity_id = ? AND status IN ('accepted', 'sent', 'draft') ORDER BY
       CASE status WHEN 'accepted' THEN 1 WHEN 'sent' THEN 2 WHEN 'draft' THEN 3 END,
       created_at DESC LIMIT 1`,
  )
    .bind(opportunityId)
    .first<ProposalRow>();
}

/** last_updated_at = proposal.updated_at if a proposal exists; otherwise opportunity.created_at.
 *  proposal.updated_at is touched on every write through services/proposals.ts, including
 *  recompute-totals after line-item add/update/delete and modifier changes. */
function computeLastUpdatedAt(opp: OpportunityRow, proposal: ProposalRow | null): string {
  if (!proposal) return opp.created_at;
  return proposal.updated_at > opp.created_at ? proposal.updated_at : opp.created_at;
}

export async function presentationData(ctx: HandlerContext): Promise<Response> {
  const token = ctx.params['opportunity_token'];
  if (!token) return json({ error: 'invalid_token' }, { status: 400 });

  const opp = await ctx.env.DB.prepare(`SELECT * FROM opportunity WHERE presentation_token = ?`)
    .bind(token)
    .first<OpportunityRow>();
  if (!opp) return json({ error: 'not_found' }, { status: 404 });

  const proposal = await pickCurrentProposal(ctx.env, opp.id);
  const lastUpdatedAt = computeLastUpdatedAt(opp, proposal);

  // ?since= short-circuit. If the client's timestamp matches/exceeds the server's, return 204.
  const url = new URL(ctx.request.url);
  const since = url.searchParams.get('since');
  if (since && since >= lastUpdatedAt) {
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const client = await ctx.env.DB.prepare(`SELECT id, company_name, primary_contact_name FROM client WHERE id = ?`)
    .bind(opp.client_id)
    .first<ClientRow>();
  if (!client) return json({ error: 'client_missing' }, { status: 500 });

  let pricingPayload: unknown = null;
  if (proposal) {
    pricingPayload = await buildPricingPayload(ctx.env, proposal);
  }

  return json({
    last_updated_at: lastUpdatedAt,
    client: {
      company_name: client.company_name,
      primary_contact_name: client.primary_contact_name,
    },
    opportunity: {
      name: opp.name,
      description: opp.description,
      date: opp.created_at,
    },
    proposal: proposal
      ? {
          status: proposal.status,
          name: proposal.name,
          narrative_challenge: proposal.narrative_challenge,
          narrative_solution: proposal.narrative_solution,
          key_capabilities: proposal.key_capabilities ? safeJsonArray(proposal.key_capabilities) : null,
          demo_enabled: proposal.demo_enabled === 1,
          pricing: pricingPayload,
        }
      : null,
  }, {
    headers: { 'cache-control': 'no-store' },
  });
}

async function buildPricingPayload(env: HandlerContext['env'], proposal: ProposalRow) {
  const headline = { setup_total: proposal.setup_total, monthly_total: proposal.monthly_total };
  if (proposal.pricing_display_mode === 'summary') {
    return { display_mode: 'summary', headline };
  }

  // For categorical and full we need the snapshot to look up component metadata.
  const snapRow = await env.DB.prepare(`SELECT snapshot_data, snapshot_at FROM pricing_snapshot WHERE proposal_id = ?`)
    .bind(proposal.id)
    .first<SnapshotRow>();
  if (!snapRow) return { display_mode: 'summary', headline };

  let snap: { components?: Record<string, ComponentSnapshot> } = {};
  try {
    snap = JSON.parse(snapRow.snapshot_data) as { components?: Record<string, ComponentSnapshot> };
  } catch {
    return { display_mode: 'summary', headline };
  }
  const components = snap.components ?? {};

  const items = await env.DB.prepare(
    `SELECT id, component_code, quantity, unit_price_at_snapshot, line_total, description_override
       FROM proposal_line_item WHERE proposal_id = ? ORDER BY created_at ASC`,
  )
    .bind(proposal.id)
    .all<LineItemRow>();
  const lineItems = items.results ?? [];

  if (proposal.pricing_display_mode === 'categorical') {
    const byCat = new Map<string, { category: string; subtotal_setup: number; subtotal_monthly: number; count: number; line_count: number }>();
    for (const li of lineItems) {
      const comp = components[li.component_code];
      const category = comp?.category ?? (li.component_code === 'custom_line_item' ? 'custom' : 'other');
      const unitType = comp?.unit_type ?? (li.component_code === 'custom_line_item' ? 'per_item_setup' : 'per_item_setup');
      const entry = byCat.get(category) ?? { category, subtotal_setup: 0, subtotal_monthly: 0, count: 0, line_count: 0 };
      entry.count += li.quantity;
      entry.line_count += 1;
      if (unitType === 'flat_setup' || unitType === 'per_item_setup') entry.subtotal_setup += li.line_total;
      else if (unitType === 'flat_monthly' || unitType === 'per_item_monthly') entry.subtotal_monthly += li.line_total;
      else if (unitType === 'setup_and_monthly') { entry.subtotal_setup += li.line_total; entry.subtotal_monthly += li.line_total; }
      byCat.set(category, entry);
    }
    return {
      display_mode: 'categorical',
      headline,
      categories: Array.from(byCat.values()).sort((a, b) => a.category.localeCompare(b.category)),
    };
  }

  // full
  return {
    display_mode: 'full',
    headline,
    line_items: lineItems.map((li) => {
      const comp = components[li.component_code];
      return {
        component_code: li.component_code,
        name: li.component_code === 'custom_line_item' ? (li.description_override ?? 'Custom item') : comp?.name ?? li.component_code,
        category: comp?.category ?? 'custom',
        quantity: li.quantity,
        unit_price: li.unit_price_at_snapshot,
        line_total: li.line_total,
        description: li.description_override,
        unit_type: comp?.unit_type ?? 'per_item_setup',
      };
    }),
  };
}

function safeJsonArray(s: string): string[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}

// ── Presentation HTML shell ──────────────────────────────────────────

export async function presentationShell(ctx: HandlerContext): Promise<Response> {
  const token = ctx.params['opportunity_token'];
  if (!token) return new Response('Invalid token.', { status: 400, headers: { 'content-type': 'text/plain' } });

  // Pre-fetch the data so the first paint includes everything without an extra round-trip.
  const dataReq = new Request(new URL(`/p/${token}/data`, 'http://internal').toString(), { method: 'GET' });
  const dataCtx: HandlerContext = { ...ctx, request: dataReq, params: { opportunity_token: token } };
  const dataRes = await presentationData(dataCtx);
  if (dataRes.status === 404) {
    return new Response('Presentation not found.', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  const dataJson = (await dataRes.json()) as Record<string, unknown>;

  const demoBase = ctx.env.DEMO_URL_BASE ?? '';
  const html = renderShellHtml(token, dataJson, demoBase);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'SAMEORIGIN',
    },
  });
}

function renderShellHtml(token: string, initialData: Record<string, unknown>, demoBase: string): string {
  const safeData = JSON.stringify(initialData)
    .replace(/</g, '\\u003c')
    .replace(/-->/g, '--\\u003e');
  const safeToken = token.replace(/[^A-Za-z0-9_-]/g, '');
  const safeDemoBase = demoBase.replace(/"/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Presentation</title>
<style>${PRESENTATION_CSS}</style>
</head>
<body>
<div id="root" aria-live="polite"></div>
<div id="updated-badge" hidden>Updated</div>
<script id="bb-initial-data" type="application/json">${safeData}</script>
<script>
  window.__BUSSEY_PRES__ = {
    token: ${JSON.stringify(safeToken)},
    demoBase: ${JSON.stringify(safeDemoBase)},
  };
</script>
<script>${PRESENTATION_JS}</script>
</body>
</html>`;
}

const PRESENTATION_CSS = `
:root {
  --bg: #0d1421;
  --fg: #f7f7f5;
  --muted: #9aa2b1;
  --accent: #6ea4ff;
  --surface: #18213a;
  --border: rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.55;
  color: var(--fg);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
#root { min-height: 100vh; display: flex; flex-direction: column; }

/* slide system */
.slide {
  display: none;
  flex: 1;
  padding: 4rem 2rem 6rem;
  max-width: 920px;
  margin: 0 auto;
  width: 100%;
}
.slide.active { display: block; animation: fade-in 280ms ease-out; }
@keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

.eyebrow { color: var(--muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 1rem; }
h1 { font-size: 2.5rem; line-height: 1.1; margin: 0 0 1rem; font-weight: 600; }
h2 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 1rem; font-weight: 600; }
p  { margin: 0 0 1rem; color: var(--fg); }
.lead { font-size: 1.2rem; color: var(--muted); }
.muted { color: var(--muted); }
ul.caps { list-style: none; padding: 0; }
ul.caps li {
  padding: 0.6rem 0 0.6rem 1.5rem;
  border-bottom: 1px solid var(--border);
  position: relative;
}
ul.caps li::before {
  content: '›';
  position: absolute; left: 0;
  color: var(--accent);
}

/* cover slide */
.cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 70vh;
  text-align: left;
}
.cover .prepared { color: var(--muted); margin: 1.5rem 0 0; }
.cover .begin {
  margin-top: 2.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 999px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.cover .begin:hover { filter: brightness(1.05); }

/* demo iframe */
.demo-wrap { aspect-ratio: 16 / 10; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
.demo-wrap iframe { width: 100%; height: 100%; border: none; }
.demo-missing { padding: 3rem 2rem; text-align: center; background: var(--surface); border: 1px dashed var(--border); border-radius: 8px; color: var(--muted); }

/* investment slide */
.invest-totals { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 2rem 0; }
.invest-card {
  padding: 1.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.invest-card .label { color: var(--muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; }
.invest-card .val { font-size: 2rem; font-weight: 600; margin-top: 0.4rem; }
.invest-card .val .per-month { font-size: 0.9rem; color: var(--muted); margin-left: 0.3rem; }

.cat-row, .full-row {
  display: grid;
  align-items: baseline;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border);
  gap: 0.75rem;
}
.cat-row { grid-template-columns: 1fr auto auto; }
.full-row { grid-template-columns: 1fr 4rem 6rem; }
.cat-row .cat { text-transform: capitalize; }
.cat-row .count { color: var(--muted); font-size: 0.85rem; }
.full-row .name { display: flex; flex-direction: column; }
.full-row .name small { color: var(--muted); font-size: 0.78rem; }
.full-row .qty, .full-row .total { text-align: right; font-variant-numeric: tabular-nums; }

/* nav bar */
nav.bb-nav {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(13, 20, 33, 0.92);
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--border);
  padding: 0.7rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
nav.bb-nav button {
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.5rem 1rem;
  font: inherit;
  cursor: pointer;
}
nav.bb-nav button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
nav.bb-nav button:disabled { opacity: 0.45; cursor: not-allowed; }
nav.bb-nav .indicator { color: var(--muted); font-size: 0.9rem; min-width: 6rem; text-align: center; }
nav.bb-nav .indicator strong { color: var(--fg); }

/* updated badge */
#updated-badge {
  position: fixed;
  top: 1rem; right: 1rem;
  background: var(--accent);
  color: var(--bg);
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  opacity: 0;
  transition: opacity 220ms ease;
  pointer-events: none;
  z-index: 50;
}
#updated-badge.show { opacity: 1; }

/* missing-proposal banner */
.no-proposal {
  padding: 2rem;
  text-align: center;
  color: var(--muted);
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
`;

const PRESENTATION_JS = `
(function () {
  'use strict';
  var cfg = window.__BUSSEY_PRES__ || { token: '', demoBase: '' };
  var initialEl = document.getElementById('bb-initial-data');
  var data = JSON.parse(initialEl.textContent || '{}');
  var root = document.getElementById('root');
  var badge = document.getElementById('updated-badge');
  var current = 0;
  var slidesDef = [];
  var lastUpdated = data.last_updated_at || '';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function paragraphs(s) {
    if (!s) return '';
    return s.split(/\\n\\s*\\n/).map(function (p) { return '<p>' + esc(p).replace(/\\n/g, '<br>') + '</p>'; }).join('');
  }
  function fmt(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function computeSlides(d) {
    var demoOn = d.proposal && d.proposal.demo_enabled;
    var slides = ['cover', 'challenge'];
    if (demoOn) slides.push('demo');
    slides.push('solution', 'timeline', 'investment', 'next');
    return slides;
  }

  function renderSlide(id, d) {
    if (id === 'cover') return renderCover(d);
    if (id === 'challenge') return renderChallenge(d);
    if (id === 'demo') return renderDemo(d);
    if (id === 'solution') return renderSolution(d);
    if (id === 'timeline') return renderTimeline(d);
    if (id === 'investment') return renderInvestment(d);
    if (id === 'next') return renderNext(d);
    return '';
  }
  function renderCover(d) {
    var name = d.client && d.client.company_name;
    var contact = d.client && d.client.primary_contact_name;
    var oppName = d.opportunity && d.opportunity.name;
    var date = d.opportunity && d.opportunity.date ? new Date(d.opportunity.date).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' }) : '';
    return '<section class="slide cover">' +
      '<p class="eyebrow">Bussey and Bussey</p>' +
      '<h1>' + esc(oppName || 'Proposal') + '</h1>' +
      '<p class="lead">' + esc(name || '') + '</p>' +
      (contact ? '<p class="prepared">Prepared for ' + esc(contact) + (date ? ' · ' + esc(date) : '') + '</p>' : '') +
      '<button type="button" class="begin" data-action="next">Begin →</button>' +
      '</section>';
  }
  function renderChallenge(d) {
    var t = d.proposal && d.proposal.narrative_challenge;
    return '<section class="slide">' +
      '<p class="eyebrow">The challenge</p>' +
      '<h2>What we heard</h2>' +
      (t ? paragraphs(t) : '<p class="muted">The challenge narrative isn\\'t written yet. The admin can fill this in from the calculator.</p>') +
      '</section>';
  }
  function renderDemo(d) {
    var token = cfg.token;
    var url = (cfg.demoBase || '') + '/demos/' + token + '/';
    return '<section class="slide">' +
      '<p class="eyebrow">The demo</p>' +
      '<h2>See it working</h2>' +
      '<div class="demo-wrap"><iframe src="' + esc(url) + '" title="Demo" loading="eager"></iframe></div>' +
      '<p class="muted small" style="margin-top:1rem;">If the demo doesn\\'t load, the static files for this opportunity may not be built yet (' + esc(url) + ').</p>' +
      '</section>';
  }
  function renderSolution(d) {
    var t = d.proposal && d.proposal.narrative_solution;
    var caps = (d.proposal && d.proposal.key_capabilities) || [];
    var capsHtml = caps.length ? '<ul class="caps">' + caps.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '';
    return '<section class="slide">' +
      '<p class="eyebrow">The solution</p>' +
      '<h2>What we\\'ll build</h2>' +
      (t ? paragraphs(t) : '<p class="muted">Solution narrative not yet written.</p>') +
      capsHtml +
      '</section>';
  }
  function renderTimeline(d) {
    return '<section class="slide">' +
      '<p class="eyebrow">Timeline &amp; process</p>' +
      '<h2>How an engagement runs</h2>' +
      '<p>Discovery → Build → Handoff → Ongoing support. We work in weekly cycles and you see progress every week.</p>' +
      '<ul class="caps">' +
        '<li><strong>Discovery</strong>: scoping conversations, your team\\'s real workflows, the things that have to be true on day one.</li>' +
        '<li><strong>Build</strong>: weekly demos against a tight scope, hands-on with your team where useful.</li>' +
        '<li><strong>Handoff</strong>: rollout, training, the small things that get overlooked.</li>' +
        '<li><strong>Ongoing support</strong>: monthly partnership for the long haul.</li>' +
      '</ul>' +
      '</section>';
  }
  function renderInvestment(d) {
    var p = d.proposal;
    if (!p || !p.pricing) {
      return '<section class="slide"><p class="eyebrow">Investment</p>' +
        '<div class="no-proposal">No proposal yet for this opportunity.</div></section>';
    }
    var pricing = p.pricing;
    var headline = pricing.headline || {};
    var bodyHtml = '';
    if (pricing.display_mode === 'full' && pricing.line_items) {
      bodyHtml = '<h3 style="margin-top:2rem; font-weight:500; font-size:1rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em;">Line items</h3>' +
        pricing.line_items.map(function (li) {
          return '<div class="full-row">' +
            '<div class="name">' + esc(li.name) + (li.description ? '<small>' + esc(li.description) + '</small>' : '') + '</div>' +
            '<div class="qty">' + esc(li.quantity) + '×</div>' +
            '<div class="total">$' + fmt(li.line_total) + '</div>' +
            '</div>';
        }).join('');
    } else if (pricing.display_mode === 'categorical' && pricing.categories) {
      bodyHtml = '<h3 style="margin-top:2rem; font-weight:500; font-size:1rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em;">By category</h3>' +
        pricing.categories.map(function (c) {
          var s = c.subtotal_setup > 0 ? '$' + fmt(c.subtotal_setup) + ' setup' : '';
          var m = c.subtotal_monthly > 0 ? (s ? ' · ' : '') + '$' + fmt(c.subtotal_monthly) + '/mo' : '';
          return '<div class="cat-row">' +
            '<div class="cat">' + esc(c.category) + '</div>' +
            '<div class="count">' + esc(c.line_count) + ' item' + (c.line_count === 1 ? '' : 's') + '</div>' +
            '<div>' + s + m + '</div>' +
            '</div>';
        }).join('');
    }
    return '<section class="slide">' +
      '<p class="eyebrow">Investment</p>' +
      '<h2>What it takes to do this well</h2>' +
      '<div class="invest-totals">' +
        '<div class="invest-card"><div class="label">Setup</div><div class="val">$' + fmt(headline.setup_total) + '</div></div>' +
        '<div class="invest-card"><div class="label">Monthly</div><div class="val">$' + fmt(headline.monthly_total) + '<span class="per-month">/mo</span></div></div>' +
      '</div>' +
      bodyHtml +
      '</section>';
  }
  function renderNext(d) {
    return '<section class="slide">' +
      '<p class="eyebrow">Next steps</p>' +
      '<h2>What happens after acceptance</h2>' +
      '<ul class="caps">' +
        '<li>You\\'ll get an email with portal credentials.</li>' +
        '<li>First login walks you through securing the account, signing the agreement, and setting up payment.</li>' +
        '<li>Discovery kicks off the same week.</li>' +
        '<li>Weekly progress demos start in week two.</li>' +
      '</ul>' +
      '<p class="muted" style="margin-top:2rem;">Questions? Talk to whoever shared this with you.</p>' +
      '</section>';
  }

  function render(preserveSlide) {
    slidesDef = computeSlides(data);
    if (!preserveSlide) current = Math.min(current, slidesDef.length - 1);
    if (current < 0) current = 0;

    var inner = '';
    for (var i = 0; i < slidesDef.length; i++) {
      var html = renderSlide(slidesDef[i], data);
      // Wrap with active class if it's the current slide.
      if (i === current) {
        html = html.replace('<section class="slide', '<section class="slide active');
        html = html.replace('<section class="slide active cover', '<section class="slide active cover'); // no-op safety
      }
      inner += html;
    }
    var navHtml = '<nav class="bb-nav">' +
      '<button type="button" data-action="prev"' + (current === 0 ? ' disabled' : '') + ' aria-label="Previous slide">←</button>' +
      '<div class="indicator"><strong>' + (current + 1) + '</strong> of ' + slidesDef.length + '</div>' +
      '<button type="button" data-action="next"' + (current === slidesDef.length - 1 ? ' disabled' : '') + ' aria-label="Next slide">→</button>' +
      '</nav>';
    root.innerHTML = inner + navHtml;
    bindActions();
  }

  function bindActions() {
    var buttons = root.querySelectorAll('[data-action]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', onActionClick);
    }
  }
  function onActionClick(e) {
    var action = e.currentTarget.getAttribute('data-action');
    if (action === 'next') next();
    else if (action === 'prev') prev();
  }
  function next() { if (current < slidesDef.length - 1) { current++; render(true); window.scrollTo(0, 0); } }
  function prev() { if (current > 0) { current--; render(true); window.scrollTo(0, 0); } }
  function home() { current = 0; render(true); window.scrollTo(0, 0); }

  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Escape') { home(); }
  });

  // Live sync polling.
  var POLL_VISIBLE_MS = 4000;
  var POLL_HIDDEN_MS = 30000;
  var pollHandle = null;

  function schedulePoll() {
    if (pollHandle) clearTimeout(pollHandle);
    var ms = document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    pollHandle = setTimeout(poll, ms);
  }
  function poll() {
    fetch('/p/' + cfg.token + '/data?since=' + encodeURIComponent(lastUpdated), { credentials: 'omit' })
      .then(function (r) {
        if (r.status === 204) return null;
        if (!r.ok) throw new Error('http_' + r.status);
        return r.json();
      })
      .then(function (newData) {
        if (newData && newData.last_updated_at && newData.last_updated_at !== lastUpdated) {
          var prevSlideCount = slidesDef.length;
          data = newData;
          lastUpdated = newData.last_updated_at;
          render(true);
          // If the slide count shrank (e.g. demo turned off) and current is now out of range,
          // render() already clamped it. Show the badge.
          flashUpdated();
        }
      })
      .catch(function () { /* swallow; try again next tick */ })
      .finally(function () { schedulePoll(); });
  }
  function flashUpdated() {
    if (!badge) return;
    badge.hidden = false;
    badge.classList.add('show');
    setTimeout(function () {
      badge.classList.remove('show');
      setTimeout(function () { badge.hidden = true; }, 250);
    }, 2000);
  }

  document.addEventListener('visibilitychange', function () {
    schedulePoll(); // adopt the new interval immediately
  });

  // Boot.
  render();
  schedulePoll();
})();
`;

import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

/**
 * Studio44 Dashboard — the single read endpoint (spec §4.1).
 *
 *   GET /api/admin/dashboard — funnel health + four work stations, one round-trip.
 *
 * READ-ONLY. No INSERT/UPDATE/DELETE/.run()/DB.batch anywhere in this file. All
 * queries are SELECTs run in parallel (each is independently scoped via a
 * prospect-client → open-opportunity JOIN), then composed in JS. Auth is the
 * /api/admin/ gate; the if (!ctx.session) guard mirrors the other admin reads.
 *
 * Health thresholds (§1.1, locked): prospects ≤5 crimson / ≤8 amber / else calm;
 * presentations ≤2 crimson / =3 amber / else calm; leads no threshold.
 *
 * ISO week (Monday-start, YYYY-Www) is computed server-side (§ note below). Time
 * windows for today's appointments are bucketed by the scheduled_at hour in UTC —
 * flagged: the operator's timezone isn't handled yet (fine for v1 per spec).
 */

type Health = 'calm' | 'amber' | 'crimson';
type Pill = 'green' | 'amber' | 'crimson';

// ── ISO-8601 week helpers (week starts Monday; week 1 holds the year's first Thursday) ──
function isoWeekStartIso(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Sun(0) → 7
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString();
}
function isoWeekString(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

type OppRow = { opportunity_id: string; created_at: string; company_name: string };
type AssessRow = {
  opportunity_id: string;
  id: string;
  mode: string;
  status: string;
  scheduled_at: string;
  sequence_number: number;
  notes_research_needed: string | null;
  build_to_price: string | null;
};
type DemoRow = { opportunity_id: string; id: string; status: string; body: string | null };
type PropRow = { opportunity_id: string; id: string; status: string };
type LineAgg = { proposal_id: string; n: number; priced: number };
type ApptRow = {
  opportunity_id: string;
  scheduled_at: string;
  sequence_number: number;
  mode: string;
  company_name: string;
};

export async function getDashboardHandler(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const env = ctx.env;
  const operatorId = ctx.session.subjectId;
  const now = new Date();
  const nowIso = now.toISOString();
  const weekStartIso = isoWeekStartIso(now);
  const isoWeek = isoWeekString(now);
  const todayStart = `${nowIso.slice(0, 10)}T00:00:00.000Z`;
  const tomorrowStart = new Date(Date.parse(todayStart) + 86400000).toISOString();
  const CALLABLE = `status NOT IN ('converted', 'disqualified') AND do_not_call = 0 AND is_dead_number = 0`;

  // Prospect scope = client.status='prospect' JOIN its open opportunity (Layer 1/2 pattern).
  const PROSPECT_JOIN = `JOIN opportunity o ON o.id = a.opportunity_id AND o.status = 'open'
                         JOIN client c ON c.id = o.client_id AND c.status = 'prospect'`;

  const [leadsRow, oppsRes, assessRes, demosRes, propsRes, linesRes, callsRow, targetRow, apptsRes] =
    await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS this_week
           FROM lead WHERE ${CALLABLE}`,
      )
        .bind(weekStartIso)
        .first<{ total: number; this_week: number }>(),
      env.DB.prepare(
        `SELECT o.id AS opportunity_id, o.created_at AS created_at, c.company_name AS company_name
           FROM client c JOIN opportunity o ON o.client_id = c.id AND o.status = 'open'
          WHERE c.status = 'prospect'`,
      ).all<OppRow>(),
      env.DB.prepare(
        `SELECT a.opportunity_id, a.id, a.mode, a.status, a.scheduled_at, a.sequence_number,
                a.notes_research_needed, a.build_to_price
           FROM assessment a ${PROSPECT_JOIN}`,
      ).all<AssessRow>(),
      env.DB.prepare(
        `SELECT d.opportunity_id, d.id, d.status, d.body
           FROM demo_spec d
           JOIN opportunity o ON o.id = d.opportunity_id AND o.status = 'open'
           JOIN client c ON c.id = o.client_id AND c.status = 'prospect'`,
      ).all<DemoRow>(),
      env.DB.prepare(
        `SELECT p.opportunity_id, p.id, p.status
           FROM proposal p
           JOIN opportunity o ON o.id = p.opportunity_id AND o.status = 'open'
           JOIN client c ON c.id = o.client_id AND c.status = 'prospect'`,
      ).all<PropRow>(),
      env.DB.prepare(
        `SELECT li.proposal_id AS proposal_id, COUNT(*) AS n,
                SUM(CASE WHEN li.unit_price_at_snapshot > 0 THEN 1 ELSE 0 END) AS priced
           FROM proposal_line_item li
           JOIN proposal p ON p.id = li.proposal_id
           JOIN opportunity o ON o.id = p.opportunity_id AND o.status = 'open'
           JOIN client c ON c.id = o.client_id AND c.status = 'prospect'
          GROUP BY li.proposal_id`,
      ).all<LineAgg>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM lead_activity
          WHERE created_by_user_id = ? AND created_at >= ?
            AND kind IN ('call', 'callback', 'voicemail', 'no_answer')`,
      )
        .bind(operatorId, weekStartIso)
        .first<{ n: number }>(),
      env.DB.prepare(
        `SELECT target FROM cold_calling_target WHERE admin_user_id = ? AND iso_week = ?`,
      )
        .bind(operatorId, isoWeek)
        .first<{ target: number }>(),
      env.DB.prepare(
        `SELECT a.opportunity_id, a.scheduled_at, a.sequence_number, a.mode, c.company_name
           FROM assessment a
           JOIN opportunity o ON o.id = a.opportunity_id
           JOIN client c ON c.id = o.client_id
          WHERE a.status IN ('booked', 'in_progress')
            AND a.scheduled_at >= ? AND a.scheduled_at < ?
          ORDER BY a.scheduled_at ASC`,
      )
        .bind(todayStart, tomorrowStart)
        .all<ApptRow>(),
    ]);

  const opps = oppsRes.results ?? [];
  const assessByOpp = groupBy(assessRes.results ?? [], (a) => a.opportunity_id);
  const demoByOpp = new Map((demosRes.results ?? []).map((d) => [d.opportunity_id, d]));
  const propsByOpp = groupBy(propsRes.results ?? [], (p) => p.opportunity_id);
  const linesByProposal = new Map((linesRes.results ?? []).map((l) => [l.proposal_id, l]));

  // ── A) funnel.leads ──
  const leadsTotal = leadsRow?.total ?? 0;
  const funnelLeads = {
    total: leadsTotal,
    this_week_delta: leadsRow?.this_week ?? 0,
    callable_now: leadsTotal, // identical for now; splittable later per §1.1
  };

  // ── B) funnel.prospects ──
  let digging = 0;
  let buildingPitch = 0;
  let daysSum = 0;
  for (const opp of opps) {
    const latest = latestActiveAssessment(assessByOpp.get(opp.opportunity_id) ?? []);
    if (latest?.mode === 'build_pitch') buildingPitch++;
    else if (latest?.mode === 'dig') digging++;
    daysSum += Math.max(0, Math.floor((now.getTime() - new Date(opp.created_at).getTime()) / 86400000));
  }
  const prospectsTotal = opps.length;
  const funnelProspects = {
    total: prospectsTotal,
    digging,
    building_pitch: buildingPitch,
    avg_days_in_funnel: prospectsTotal > 0 ? Math.round(daysSum / prospectsTotal) : 0,
    health: prospectsTotal <= 5 ? 'crimson' : prospectsTotal <= 8 ? 'amber' : ('calm' as Health),
  };

  // ── C/G) upcoming-presentation set (shared) ──
  // Qualifies: most-recent COMPLETED assessment is build_pitch, a demo_spec exists, the
  // proposal isn't accepted/lost, AND there is a future booked assessment (the presentation).
  type Pres = {
    opportunity_id: string;
    company: string;
    scheduled_at: string;
    demo: DemoRow;
    proposal: PropRow | null;
  };
  const presentations: Pres[] = [];
  for (const opp of opps) {
    const rows = assessByOpp.get(opp.opportunity_id) ?? [];
    const completed = rows.filter((a) => a.status === 'completed');
    if (completed.length === 0) continue;
    const lastCompleted = completed.reduce((m, a) => (a.sequence_number > m.sequence_number ? a : m));
    if (lastCompleted.mode !== 'build_pitch') continue;

    const demo = demoByOpp.get(opp.opportunity_id);
    if (!demo) continue;

    const proposal = pickProposal(propsByOpp.get(opp.opportunity_id) ?? []);
    if (!proposal || proposal.status === 'accepted' || proposal.status === 'lost') continue;

    const futureBooked = rows
      .filter((a) => a.status === 'booked' && a.scheduled_at >= nowIso)
      .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
    if (!futureBooked) continue;

    presentations.push({
      opportunity_id: opp.opportunity_id,
      company: opp.company_name,
      scheduled_at: futureBooked.scheduled_at,
      demo,
      proposal,
    });
  }
  presentations.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const presTotal = presentations.length;
  const presHealth: Health = presTotal <= 2 ? 'crimson' : presTotal === 3 ? 'amber' : 'calm';
  const funnelPresentations = {
    total: presTotal,
    health: presHealth,
    next: presentations[0]
      ? { company: presentations[0].company, scheduled_at: presentations[0].scheduled_at }
      : null,
  };

  // ── G) stations.presentations (readiness pills) ──
  const presUpcoming = presentations.slice(0, 5).map((p) => {
    const spec: Pill = (p.demo.body ?? '').trim().length > 0 ? 'green' : 'crimson';
    const demoPill: Pill =
      p.demo.status === 'built' ? 'green' : p.demo.status === 'handed_off' ? 'amber' : 'crimson';
    const agg = p.proposal ? linesByProposal.get(p.proposal.id) : undefined;
    const price: Pill = !agg || agg.n === 0 ? 'crimson' : agg.priced > 0 ? 'green' : 'amber';
    return {
      opportunity_id: p.opportunity_id,
      company: p.company,
      scheduled_at: p.scheduled_at,
      spec,
      demo: demoPill,
      price,
      demo_spec_id: p.demo.id,
      demo_spec_status: p.demo.status,
    };
  });
  const stationsPresentations = {
    upcoming: presUpcoming,
    total: presTotal,
    not_ready: presUpcoming.filter((u) => u.spec !== 'green' || u.demo !== 'green' || u.price !== 'green')
      .length,
  };

  // ── D) stations.cold_calling ──
  const suggestedTarget = presHealth === 'crimson' ? 40 : presHealth === 'amber' ? 30 : 25;
  const overrideActive = targetRow != null;
  const effectiveTarget = overrideActive ? targetRow!.target : suggestedTarget;
  const reason = overrideActive
    ? `your push (default ${suggestedTarget})`
    : suggestedTarget > 25
      ? `raised to ${suggestedTarget} because presentations is ${presHealth}`
      : 'default';
  const stationsColdCalling = {
    calls_this_week: callsRow?.n ?? 0,
    suggested_target: suggestedTarget,
    effective_target: effectiveTarget,
    override_active: overrideActive,
    iso_week: isoWeek,
    reason,
  };

  // ── E) stations.today_appointments ──
  const dow = now.getUTCDay(); // 0=Sun..6=Sat
  const isWeekday = dow >= 1 && dow <= 5;
  const WINDOWS: { window: string; from: number; to: number }[] = [
    { window: '10-12', from: 10, to: 12 },
    { window: '12-2', from: 12, to: 14 },
    { window: '2-4', from: 14, to: 16 },
    { window: '4-6', from: 16, to: 18 },
  ];
  const appts = apptsRes.results ?? [];
  const slots = isWeekday
    ? WINDOWS.map((w) => {
        const hit = appts.find((a) => {
          const hour = parseInt(a.scheduled_at.slice(11, 13), 10);
          return hour >= w.from && hour < w.to;
        });
        return {
          window: w.window,
          booked: hit
            ? {
                opportunity_id: hit.opportunity_id,
                company: hit.company_name,
                assessment_label: `Assessment ${hit.sequence_number} · ${hit.mode === 'build_pitch' ? 'pitch' : 'dig'}`,
                mode: hit.mode,
              }
            : null,
        };
      })
    : [];
  const stationsToday = { is_weekday: isWeekday, slots };

  // ── F) stations.research_and_prep ──
  type PrepRow = {
    assessment_id: string;
    opportunity_id: string;
    company: string;
    prep_type: string;
    due_at: string;
  };
  const prep: PrepRow[] = [];
  const seenAssessment = new Set<string>();
  for (const opp of opps) {
    const rows = assessByOpp.get(opp.opportunity_id) ?? [];
    const bySeq = new Map(rows.map((a) => [a.sequence_number, a]));
    // Upcoming booked assessments whose predecessor (completed) has unmet prep.
    for (const a of rows) {
      if (a.status !== 'booked' || a.scheduled_at < nowIso) continue;
      const prev = bySeq.get(a.sequence_number - 1);
      if (!prev || prev.status !== 'completed') continue;
      const digPrep = prev.mode === 'dig' && (prev.notes_research_needed ?? '').trim().length > 0;
      const pitchPrep = prev.mode === 'build_pitch' && (prev.build_to_price ?? '').trim().length > 0;
      if (!digPrep && !pitchPrep) continue;
      seenAssessment.add(a.id);
      prep.push({
        assessment_id: a.id,
        opportunity_id: opp.opportunity_id,
        company: opp.company_name,
        prep_type: pitchPrep ? 'pitch prep' : 'research',
        due_at: a.scheduled_at,
      });
    }
    // Pre-presentation case: a current in-progress build_pitch with "to price" to review.
    for (const a of rows) {
      if (a.status !== 'in_progress' || a.mode !== 'build_pitch') continue;
      if ((a.build_to_price ?? '').trim().length === 0) continue;
      if (seenAssessment.has(a.id)) continue;
      prep.push({
        assessment_id: a.id,
        opportunity_id: opp.opportunity_id,
        company: opp.company_name,
        prep_type: 'pitch prep',
        due_at: a.scheduled_at,
      });
    }
  }
  prep.sort((a, b) => a.due_at.localeCompare(b.due_at));
  const stationsPrep = { waiting: prep.slice(0, 5), total: prep.length };

  return json({
    funnel: {
      leads: funnelLeads,
      prospects: funnelProspects,
      presentations: funnelPresentations,
    },
    stations: {
      cold_calling: stationsColdCalling,
      today_appointments: stationsToday,
      research_and_prep: stationsPrep,
      presentations: stationsPresentations,
    },
  });
}

// ── helpers ──────────────────────────────────────────────────────────────

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

// Latest active assessment: in-progress (highest sequence) → soonest booked → most
// recent completed. Drives the dig/build_pitch bucketing for the prospects panel.
function latestActiveAssessment(rows: AssessRow[]): AssessRow | null {
  const inProgress = rows
    .filter((a) => a.status === 'in_progress')
    .sort((x, y) => y.sequence_number - x.sequence_number)[0];
  if (inProgress) return inProgress;
  const booked = rows
    .filter((a) => a.status === 'booked')
    .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
  if (booked) return booked;
  const completed = rows
    .filter((a) => a.status === 'completed')
    .sort((x, y) => y.sequence_number - x.sequence_number)[0];
  return completed ?? null;
}

// One proposal per opportunity in practice; prefer a draft, else the first.
function pickProposal(rows: PropRow[]): PropRow | null {
  return rows.find((p) => p.status === 'draft') ?? rows[0] ?? null;
}

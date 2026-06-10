import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import {
  type DashHealth,
  type AssessRow,
  isoWeekStartIso,
  isoWeekString,
  prospectsHealthFor,
  presentationsHealthFor,
  suggestedTargetFor,
  coldCallingReason,
  gatherProspectData,
  selectUpcomingPresentations,
} from '../../lib/dashboard-metrics';

/**
 * Studio44 Dashboard — the single read endpoint (spec §4.1).
 *
 *   GET /api/admin/dashboard — funnel health + four work stations, one round-trip.
 *
 * READ-ONLY. The ISO-week math, funnel-health thresholds, suggested-target mapping,
 * cold-calling reason, prospect-data gather, and upcoming-presentation selection all
 * come from lib/dashboard-metrics.ts — shared with the cold-calling-target WRITE so
 * the two can't drift. Auth via the /api/admin/ gate.
 *
 * Time windows for today's appointments are bucketed by the scheduled_at hour in UTC
 * — flagged: the operator's timezone isn't handled yet (fine for v1 per spec).
 */

type Pill = 'green' | 'amber' | 'crimson';
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

  const [pdata, leadsRow, linesRes, callsRow, targetRow, apptsRes, callsTodayRow, clientsRow] =
    await Promise.all([
    gatherProspectData(env), // opps + assessments + demos + proposals (prospect-scoped)
    env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS this_week
         FROM lead WHERE ${CALLABLE}`,
    )
      .bind(weekStartIso)
      .first<{ total: number; this_week: number }>(),
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
    env.DB.prepare(`SELECT target FROM cold_calling_target WHERE admin_user_id = ? AND iso_week = ?`)
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
    // Calls layer (§6.2): "Made X calls today" — card_activity rows this operator
    // logged today. card_activity.created_at is datetime('now') ("YYYY-MM-DD HH:MM:SS",
    // space-separated), so it is NOT lexically comparable to the ISO todayStart used
    // elsewhere — compare on date(created_at)=date('now') (UTC, matching the rest of
    // this handler's day math). Operator-scoped, mirroring calls_this_week above.
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM card_activity
        WHERE created_by_user_id = ? AND date(created_at) = date('now')`,
    )
      .bind(operatorId)
      .first<{ n: number }>(),
    // Calls layer (§6.1): Clients funnel-vital — active clients.
    env.DB.prepare(`SELECT COUNT(*) AS n FROM client WHERE status = 'active'`).first<{ n: number }>(),
  ]);

  const linesByProposal = new Map((linesRes.results ?? []).map((l) => [l.proposal_id, l]));

  // ── A) funnel.leads ──
  const leadsTotal = leadsRow?.total ?? 0;
  const funnelLeads = {
    total: leadsTotal,
    this_week_delta: leadsRow?.this_week ?? 0,
    callable_now: leadsTotal,
  };

  // ── B) funnel.prospects ──
  let digging = 0;
  let buildingPitch = 0;
  let daysSum = 0;
  for (const opp of pdata.opps) {
    const latest = latestActiveAssessment(pdata.assessByOpp.get(opp.opportunity_id) ?? []);
    if (latest?.mode === 'build_pitch') buildingPitch++;
    else if (latest?.mode === 'dig') digging++;
    daysSum += Math.max(0, Math.floor((now.getTime() - new Date(opp.created_at).getTime()) / 86400000));
  }
  const prospectsTotal = pdata.opps.length;
  const funnelProspects = {
    total: prospectsTotal,
    digging,
    building_pitch: buildingPitch,
    avg_days_in_funnel: prospectsTotal > 0 ? Math.round(daysSum / prospectsTotal) : 0,
    health: prospectsHealthFor(prospectsTotal),
  };

  // ── C/G) upcoming presentations (shared selection) ──
  const ups = selectUpcomingPresentations(pdata, nowIso);
  const presTotal = ups.length;
  const presHealth: DashHealth = presentationsHealthFor(presTotal);
  const funnelPresentations = {
    total: presTotal,
    health: presHealth,
    next: ups[0] ? { company: ups[0].company, scheduled_at: ups[0].scheduled_at } : null,
  };

  const presUpcoming = ups.slice(0, 5).map((p) => {
    const spec: Pill = (p.demo.body ?? '').trim().length > 0 ? 'green' : 'crimson';
    const demoPill: Pill =
      p.demo.status === 'built' ? 'green' : p.demo.status === 'handed_off' ? 'amber' : 'crimson';
    const agg = linesByProposal.get(p.proposal.id);
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
  const suggestedTarget = suggestedTargetFor(presHealth);
  const overrideActive = targetRow != null;
  const effectiveTarget = overrideActive ? targetRow!.target : suggestedTarget;
  const stationsColdCalling = {
    calls_this_week: callsRow?.n ?? 0,
    calls_today: callsTodayRow?.n ?? 0,
    suggested_target: suggestedTarget,
    effective_target: effectiveTarget,
    override_active: overrideActive,
    iso_week: isoWeek,
    reason: coldCallingReason(overrideActive, suggestedTarget, presHealth),
  };

  // ── E) stations.today_appointments ──
  const dow = now.getUTCDay();
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
  for (const opp of pdata.opps) {
    const rows = pdata.assessByOpp.get(opp.opportunity_id) ?? [];
    const bySeq = new Map(rows.map((a) => [a.sequence_number, a]));
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
      clients: { total: clientsRow?.n ?? 0 },
    },
    stations: {
      cold_calling: stationsColdCalling,
      today_appointments: stationsToday,
      research_and_prep: stationsPrep,
      presentations: stationsPresentations,
    },
  });
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

import type { Env } from '../types/env';

/**
 * Studio44 Dashboard — shared metric helpers.
 *
 * The dashboard READ (routes/admin/dashboard.ts) and the cold-calling-target WRITE
 * (routes/admin/cold-calling-target.ts) both depend on: the ISO-week math, the
 * funnel-health thresholds, the suggested-target mapping, the cold-calling reason
 * string, and the "what counts as an upcoming presentation" selection. They live
 * HERE so the two endpoints can't drift (e.g. the write computing a different
 * suggested_target than the read displayed).
 */

export type DashHealth = 'calm' | 'amber' | 'crimson';

// ── ISO-8601 week (Monday-start; week 1 holds the year's first Thursday) ──
export function isoWeekStartIso(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Sun(0) → 7
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString();
}
export function isoWeekString(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ── Health thresholds (§1.1, locked) ──
export function prospectsHealthFor(total: number): DashHealth {
  return total <= 5 ? 'crimson' : total <= 8 ? 'amber' : 'calm';
}
export function presentationsHealthFor(total: number): DashHealth {
  return total <= 2 ? 'crimson' : total === 3 ? 'amber' : 'calm';
}

// ── Cold-calling suggestion (§1.2) — the single source both endpoints use ──
export function suggestedTargetFor(health: DashHealth): number {
  return health === 'crimson' ? 40 : health === 'amber' ? 30 : 25;
}
export function coldCallingReason(overrideActive: boolean, suggested: number, health: DashHealth): string {
  if (overrideActive) return `your push (default ${suggested})`;
  if (suggested > 25) return `raised to ${suggested} because presentations is ${health}`;
  return 'default';
}

// ── Prospect-scoped data gather (client.status='prospect' JOIN open opportunity) ──
export type OppRow = { opportunity_id: string; created_at: string; company_name: string };
export type AssessRow = {
  opportunity_id: string;
  id: string;
  mode: string;
  status: string;
  scheduled_at: string;
  sequence_number: number;
  notes_research_needed: string | null;
  build_to_price: string | null;
};
export type DemoRow = { opportunity_id: string; id: string; status: string; body: string | null };
export type PropRow = { opportunity_id: string; id: string; status: string };

export type ProspectData = {
  opps: OppRow[];
  assessByOpp: Map<string, AssessRow[]>;
  demoByOpp: Map<string, DemoRow>;
  propsByOpp: Map<string, PropRow[]>;
};

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

export async function gatherProspectData(env: Env): Promise<ProspectData> {
  const [oppsRes, assessRes, demosRes, propsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT o.id AS opportunity_id, o.created_at AS created_at, c.company_name AS company_name
         FROM client c JOIN opportunity o ON o.client_id = c.id AND o.status = 'open'
        WHERE c.status = 'prospect'`,
    ).all<OppRow>(),
    env.DB.prepare(
      `SELECT a.opportunity_id, a.id, a.mode, a.status, a.scheduled_at, a.sequence_number,
              a.notes_research_needed, a.build_to_price
         FROM assessment a
         JOIN opportunity o ON o.id = a.opportunity_id AND o.status = 'open'
         JOIN client c ON c.id = o.client_id AND c.status = 'prospect'`,
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
  ]);
  return {
    opps: oppsRes.results ?? [],
    assessByOpp: groupBy(assessRes.results ?? [], (a) => a.opportunity_id),
    demoByOpp: new Map((demosRes.results ?? []).map((d) => [d.opportunity_id, d])),
    propsByOpp: groupBy(propsRes.results ?? [], (p) => p.opportunity_id),
  };
}

// One proposal per opportunity in practice; prefer a draft, else the first.
export function pickProposal(rows: PropRow[]): PropRow | null {
  return rows.find((p) => p.status === 'draft') ?? rows[0] ?? null;
}

export type UpcomingPresentation = {
  opportunity_id: string;
  company: string;
  scheduled_at: string;
  demo: DemoRow;
  proposal: PropRow;
};

// "Upcoming presentation": the most-recent COMPLETED assessment is build_pitch, a
// demo_spec exists, the proposal isn't accepted/lost, AND there's a future booked
// assessment (the presentation date). Sorted soonest-first. Pure — both endpoints
// feed it their gathered data so the qualifying logic is identical.
export function selectUpcomingPresentations(data: ProspectData, nowIso: string): UpcomingPresentation[] {
  const out: UpcomingPresentation[] = [];
  for (const opp of data.opps) {
    const rows = data.assessByOpp.get(opp.opportunity_id) ?? [];
    const completed = rows.filter((a) => a.status === 'completed');
    if (completed.length === 0) continue;
    const lastCompleted = completed.reduce((m, a) => (a.sequence_number > m.sequence_number ? a : m));
    if (lastCompleted.mode !== 'build_pitch') continue;

    const demo = data.demoByOpp.get(opp.opportunity_id);
    if (!demo) continue;

    const proposal = pickProposal(data.propsByOpp.get(opp.opportunity_id) ?? []);
    if (!proposal || proposal.status === 'accepted' || proposal.status === 'lost') continue;

    const futureBooked = rows
      .filter((a) => a.status === 'booked' && a.scheduled_at >= nowIso)
      .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
    if (!futureBooked) continue;

    out.push({
      opportunity_id: opp.opportunity_id,
      company: opp.company_name,
      scheduled_at: futureBooked.scheduled_at,
      demo,
      proposal,
    });
  }
  out.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return out;
}

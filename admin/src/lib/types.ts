// Entity shapes mirrored from the Worker API. Kept hand-maintained for v1 —
// once the API stabilizes, generate these from the D1 schema.

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'sales' | 'delivery';
};

export type LeadStatus = 'new' | 'reviewed' | 'contacted' | 'qualified' | 'disqualified' | 'converted';
export type LeadSource = 'chat' | 'manual' | 'referral' | 'event';
export type LeadUrgency = 'immediate' | 'weeks' | 'months' | 'exploring';

export type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  industry: string | null;
  source: LeadSource | null;
  origin_chat_session_id: string | null;
  pain_summary: string | null;
  urgency: LeadUrgency | null;
  status: LeadStatus;
  notes: string | null;
  notification_sent_at: string | null;
  owner_user_id: string | null;
  last_contacted_at: string | null;
  created_at: string;
  // Studio44 Layer 1 — migration 0009 (calling-wizard columns)
  next_followup_at: string | null;
  attempt_count: number;
  do_not_call: number; // 0 | 1
  is_dead_number: number; // 0 | 1
};

export type ClientStatus = 'prospect' | 'active' | 'paused' | 'former';

export type Client = {
  id: string;
  company_name: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  industry: string | null;
  billing_address: string | null;
  status: ClientStatus;
  origin_lead_id: string | null;
  notes: string | null;
  created_at: string;
};

export type OpportunityStatus = 'open' | 'proposed' | 'accepted' | 'lost' | 'paused';

export type Opportunity = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: OpportunityStatus;
  value_setup: number | null;
  value_monthly: number | null;
  next_followup_date: string | null;
  presentation_token: string;
  owner_user_id: string | null;
  accepted_at: string | null;
  lost_reason: string | null;
  lost_notes: string | null;
  lost_at: string | null;
  notes: string | null;
  monthly_start_date: string | null;
  created_at: string;
};

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'superseded' | 'declined';
export type PricingDisplayMode = 'summary' | 'categorical' | 'full';

export type ProposalModifiers = {
  complexity_multiplier: number;
  urgency_multiplier: number;
  custom_discount_percent: number;
};

export type Proposal = {
  id: string;
  opportunity_id: string;
  name: string;
  status: ProposalStatus;
  setup_total: number;
  monthly_total: number;
  narrative_challenge: string | null;
  narrative_solution: string | null;
  key_capabilities: string[] | null;
  pricing_display_mode: PricingDisplayMode;
  demo_enabled: boolean;
  modifiers: ProposalModifiers;
  notes: string | null;
  presentation_notes: string | null;
  cloned_from_proposal_id: string | null;
  created_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  stale_after: string;
  is_stale: boolean;
};

export type ProposalLineItem = {
  id: string;
  proposal_id: string;
  component_code: string;
  quantity: number;
  unit_price_at_snapshot: number;
  line_total: number;
  description_override: string | null;
  created_at: string;
};

export type PricingComponent = {
  code: string;
  name: string;
  description: string | null;
  category: 'table' | 'role' | 'workflow' | 'integration' | 'ai' | 'dashboard' | 'setup' | 'subscription' | 'custom';
  unit_type: 'flat_setup' | 'per_item_setup' | 'flat_monthly' | 'per_item_monthly' | 'setup_and_monthly';
  unit_price: number;
  active: number;
};

export type ProposalSnapshot = {
  snapshot_at: string;
  taken_at: string;
  components: Record<string, PricingComponent>;
};

export type ProposalDetail = {
  proposal: Proposal;
  snapshot: ProposalSnapshot;
  line_items: ProposalLineItem[];
};

export type ChangeOrderStatus = 'draft' | 'proposed' | 'approved' | 'rejected' | 'withdrawn';

export type ChangeOrder = {
  id: string;
  proposal_id: string;
  name: string;
  status: ChangeOrderStatus;
  reason: string | null;
  setup_delta: number;
  monthly_delta: number;
  proposed_at: string | null;
  approved_at: string | null;
  approved_by_portal_account_id: string | null;
  created_at: string;
};

export type ChangeOrderLineItem = {
  id: string;
  change_order_id: string;
  action: 'add' | 'remove';
  component_code: string;
  quantity: number;
  unit_price_from_snapshot: number;
  line_total_delta: number;
  description_override: string | null;
  created_at: string;
};

export type ChangeOrderDetail = {
  change_order: ChangeOrder;
  line_items: ChangeOrderLineItem[];
};

// ── Studio44 Layer 1 — Leads wizard (migrations 0009–0014) ──────────────
// Mirrors of the new data model. 0/1 integer flags are kept as `number` to
// match the raw row shape the Worker returns (consistent with PricingComponent.active).

export type LeadActivityKind =
  | 'call'
  | 'callback'
  | 'voicemail'
  | 'no_answer'
  | 'dead_number'
  | 'do_not_call'
  | 'skipped'
  | 'booked'
  | 'note';

export type LeadActivity = {
  id: string;
  lead_id: string;
  kind: LeadActivityKind;
  outcome: string | null;
  attempt_number: number | null;
  industry_at_time: string | null;
  opener_variant_id: string | null;
  hook_variant_id: string | null;
  discovery_variant_id: string | null;
  close_variant_id: string | null;
  card_dwell_ms: number | null;
  phone_duration_s: number | null;
  session_id: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type ScriptVariantStage = 'opener' | 'hook' | 'discovery' | 'close';
export type ScriptVariantAuthorKind = 'operator' | 'alice' | 'seed';

export type ScriptVariant = {
  id: string;
  stage: ScriptVariantStage;
  body: string;
  author_kind: ScriptVariantAuthorKind;
  author_user_id: string | null;
  label: string | null;
  industry: string | null;
  is_active: number; // 0 | 1
  created_at: string;
};

export type ScriptVariantUsage = {
  id: string;
  variant_id: string;
  lead_id: string | null;
  activity_id: string | null;
  outcome: string | null;
  used_at: string;
};

// 'in_progress' added in Layer 2 (migration 0015) — the working lifecycle.
export type AssessmentStatus =
  | 'booked'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'rescheduled';

// The mode an assessment is worked in (Layer 2, migration 0015). Forward-only flip.
export type AssessmentMode = 'dig' | 'build_pitch';

export type Assessment = {
  id: string;
  opportunity_id: string;
  scheduled_at: string;
  status: AssessmentStatus;
  outcome_notes: string | null;
  sequence_number: number;
  booked_from_activity_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  // Layer 2 (migration 0015) — workspace fields
  mode: AssessmentMode;
  mode_flipped_at: string | null;
  // dig-mode notes
  notes_heard_learned: string | null;
  notes_research_needed: string | null;
  notes_loose: string | null;
  // build-pitch-mode notes
  build_what: string | null;
  build_emphasize: string | null;
  build_ignore: string | null;
  build_to_price: string | null;
  build_notes: string | null;
};

// demo_spec — Layer 2 (migration 0016), lifecycle extended for the dashboard
// (migration 0017: 'built' status + handed_off_at/built_at). The prose brief a
// Studio87 manager builds a demo from; one of the two handoff outputs.
export type DemoSpecStatus = 'draft' | 'ready' | 'handed_off' | 'built';
export type DemoSpecAuthorKind = 'operator' | 'alice';

export type DemoSpec = {
  id: string;
  opportunity_id: string;
  assessment_id: string | null;
  body: string | null;
  status: DemoSpecStatus;
  author_kind: DemoSpecAuthorKind;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string | null;
  // Studio44 Dashboard (migration 0017) — lifecycle timestamps
  handed_off_at: string | null;
  built_at: string | null;
  // Studio44 Presentation room (migration 0019) — the URL iframed in the room
  demo_url: string | null;
};

// cold_calling_target — Studio44 Dashboard (migration 0018). The operator's per-week
// target override (the suggested target is computed on read, not stored).
export type ColdCallingTarget = {
  id: string;
  admin_user_id: string;
  iso_week: string; // 'YYYY-Www', e.g. '2026-W22'
  target: number;
  created_at: string;
  updated_at: string | null;
};

// ── Studio44 Layer 2 — step 2 read-endpoint response shapes ─────────────
// Operator language: "prospect" + "assessments". `id` is the opportunity id
// (the workspace key / plumbing) — never labelled client/opportunity to the operator.

export type ProspectListItem = {
  id: string; // opportunity id — workspace key
  company: string;
  contact: string | null;
  industry: string | null;
  started_at: string; // opportunity created_at (booking moment)
  assessment_count: number;
  next_appointment_at: string | null;
};

export type ProspectsListResponse = {
  prospects: ProspectListItem[];
};

// One row in the meeting thread (summary, not full notes).
export type AssessmentThreadItem = {
  id: string;
  sequence_number: number;
  mode: AssessmentMode;
  status: AssessmentStatus;
  scheduled_at: string;
  mode_flipped_at: string | null;
  summary: string | null;
};

// The current assessment's full structured notes (both modes' fields present).
export type CurrentAssessment = {
  id: string;
  sequence_number: number;
  scheduled_at: string;
  status: AssessmentStatus;
  mode: AssessmentMode;
  mode_flipped_at: string | null;
  outcome_notes: string | null;
  notes_heard_learned: string | null;
  notes_research_needed: string | null;
  notes_loose: string | null;
  build_what: string | null;
  build_emphasize: string | null;
  build_ignore: string | null;
  build_to_price: string | null;
  build_notes: string | null;
};

export type HandoffProposalLineItem = {
  id: string;
  component_code: string;
  description_override: string | null;
  line_total: number;
};

export type ProspectWorkspace = {
  prospect: {
    id: string; // opportunity id
    client_id: string; // plumbing — used only to route into the existing proposal editor
    company: string;
    contact: string | null;
    industry: string | null;
    days_in_funnel: number;
  };
  thread: AssessmentThreadItem[];
  current_assessment: CurrentAssessment | null;
  next_appointment: { id: string; scheduled_at: string } | null;
  demo_spec: {
    id: string;
    status: DemoSpecStatus;
    body: string | null;
    author_kind: DemoSpecAuthorKind;
    demo_url: string | null;
  } | null;
  proposal: {
    id: string;
    status: ProposalStatus;
    setup_total: number;
    monthly_total: number;
    line_items: HandoffProposalLineItem[];
  } | null;
};

// ── Studio44 Layer 2 — step 6: complete-pitch (handoff) + demo-spec write ─────
// complete-pitch accepts the five build fields (also saves) — no scheduled_at
// (the presentation was booked in the call).
export type CompletePitchRequest = {
  build_what?: string | null;
  build_emphasize?: string | null;
  build_ignore?: string | null;
  build_to_price?: string | null;
  build_notes?: string | null;
};

export type CompletePitchResponse = {
  ok: true;
  completed_assessment_id: string;
  proposal_id: string;
  demo_spec_id: string;
};

// Extended in the Presentation room (step 2): { body?, demo_url? }. At least one
// must be provided. Status transitions still have one canonical path,
// PUT /api/admin/demo-specs/:id/status (sending status here is rejected 400).
export type UpdateDemoSpecRequest = {
  body?: string | null;
  demo_url?: string;
};

export type UpdateDemoSpecResponse = {
  ok: true;
  demo_spec: DemoSpec;
};

// ── Studio44 Dashboard — step 5: demo-spec lifecycle transition (§4.3) ────────
// One step forward or back along draft → ready → handed_off → built. The server
// rejects skips (409 invalid_transition) and same-status (409 same_status), and
// stamps handed_off_at / built_at on the corresponding forward moves.
export type DemoSpecStatusRequest = {
  status: DemoSpecStatus;
};

export type DemoSpecStatusResponse = {
  ok: true;
  demo_spec: DemoSpec;
};

// ── Studio44 Layer 2 — assessment write shapes (step 4 + step 5) ────────
// Accepts dig (step 4) and build-pitch (step 5) note fields. `mode` (optional)
// drives the forward-only flip: sending 'build_pitch' on a dig assessment flips it
// (server stamps mode_flipped_at). mode_flipped_at is NEVER client-set.
export type SaveAssessmentNotesRequest = {
  mode?: AssessmentMode;
  // dig fields
  notes_heard_learned?: string | null;
  notes_research_needed?: string | null;
  notes_loose?: string | null;
  // build-pitch fields
  build_what?: string | null;
  build_emphasize?: string | null;
  build_ignore?: string | null;
  build_to_price?: string | null;
  build_notes?: string | null;
};

export type SaveAssessmentNotesResponse = {
  ok: true;
  assessment: CurrentAssessment;
};

export type CompleteDigRequest = {
  scheduled_at: string; // required — the next appointment datetime (loop discipline)
  notes_heard_learned?: string | null;
  notes_research_needed?: string | null;
  notes_loose?: string | null;
};

export type CompleteDigResponse = {
  ok: true;
  completed_assessment_id: string;
  next_assessment_id: string;
};

// ── Studio44 Layer 1 — step 2 read-endpoint response shapes ─────────────
// Mirrors of the read-only session/queue, lead-card, and script-variant payloads.

export type QueueMode = 'cold' | 'followups';
export type QueueTargetKind = 'book' | 'call';
export type QueuePriorityBucket = 'overdue' | 'due_today' | 'new';

// One entry in the calling queue. `sort_rank` is the materialized ordering
// primitive (overdue=0, due_today=1, new=2). `value_weight` is RESERVED for L4
// value-weighting and is always null in Layer 1.
export type LeadQueueItem = {
  id: string;
  name: string | null;
  company: string | null;
  industry: string | null;
  source: LeadSource | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  attempt_count: number;
  last_contacted_at: string | null;
  next_followup_at: string | null;
  priority_bucket: QueuePriorityBucket;
  sort_rank: number;
  value_weight: number | null;
};

// Ephemeral session metadata (no DB row). `id` is threaded into later write calls.
export type CallingSession = {
  id: string;
  mode: QueueMode;
  target_kind: QueueTargetKind;
  target: number | null;
  generated_at: string;
};

export type LeadQueueResponse = {
  session: CallingSession;
  queue: LeadQueueItem[];
  counts: { queued: number; overdue?: number; due_today?: number };
};

// Identity/context payload for one lead's call card. Note: the prototype's
// "contact role/title" and "rough size" have no backing column in the step-1
// schema and are intentionally absent.
export type LeadCard = {
  id: string;
  name: string | null;
  company: string | null;
  industry: string | null;
  source: LeadSource | null;
  email: string | null;
  phone: string | null;
  pain_summary: string | null;
  urgency: LeadUrgency | null;
  status: LeadStatus;
  attempt_count: number;
  last_contacted_at: string | null;
  next_followup_at: string | null;
  do_not_call: number; // 0 | 1
  is_dead_number: number; // 0 | 1
  created_at: string;
};

export type LeadCardResponse = {
  card: LeadCard;
  timeline: LeadActivity[];
};

// A script variant with its on-read usage rollup. book_rate is 0..1.
export type ScriptVariantWithUsage = ScriptVariant & {
  usage: {
    used_count: number;
    booked_count: number;
    book_rate: number;
  };
};

export type ScriptVariantsByStage = {
  opener: ScriptVariantWithUsage[];
  hook: ScriptVariantWithUsage[];
  discovery: ScriptVariantWithUsage[];
  close: ScriptVariantWithUsage[];
};

export type ScriptVariantsResponse = {
  variants: ScriptVariantsByStage;
};

// ── Studio44 Layer 1 — step 4: non-booking activity logging ─────────────
// 'booked' is intentionally NOT a member here — booking is the step-5 transaction.
export type NonBookingOutcome =
  | 'callback'
  | 'no_answer'
  | 'voicemail'
  | 'dead_number'
  | 'do_not_call'
  | 'skipped';

export type LogActivityRequest = {
  outcome: NonBookingOutcome;
  session_id?: string | null;
  card_dwell_ms?: number | null;
  phone_duration_s?: number | null;
  opener_variant_id?: string | null;
  hook_variant_id?: string | null;
  discovery_variant_id?: string | null;
  close_variant_id?: string | null;
  notes?: string | null;
  next_followup_at?: string | null; // required when outcome === 'callback'
};

export type LogActivityResponse = {
  ok: true;
  activity_id: string;
  lead: {
    id: string;
    attempt_count: number;
    last_contacted_at: string | null;
    next_followup_at: string | null;
    do_not_call: number;
    is_dead_number: number;
  };
};

// ── Studio44 Layer 1 — step 5: the booking transaction (the money moment) ─────
// No value field — value is Alice's job (L4); the opportunity's value columns
// are created NULL. The operator sends only date/time + call context.
export type BookingRequest = {
  scheduled_at: string; // required — assessment date/time
  session_id?: string | null;
  card_dwell_ms?: number | null;
  phone_duration_s?: number | null;
  opener_variant_id?: string | null;
  hook_variant_id?: string | null;
  discovery_variant_id?: string | null;
  close_variant_id?: string | null;
  notes?: string | null;
};

export type BookingResponse = {
  ok: true;
  lead_id: string;
  client_id: string;
  opportunity_id: string;
  assessment_id: string;
  activity_id: string;
};

// ── Studio44 Dashboard — GET /api/admin/dashboard response (§4.1) ────────
export type DashboardHealth = 'calm' | 'amber' | 'crimson';
export type ReadinessPill = 'green' | 'amber' | 'crimson';

export type DashboardTodaySlot = {
  window: string; // '10-12' | '12-2' | '2-4' | '4-6'
  booked: {
    opportunity_id: string;
    company: string;
    assessment_label: string; // "Assessment 4 · pitch"
    mode: AssessmentMode;
  } | null;
};

export type DashboardPrepItem = {
  assessment_id: string;
  opportunity_id: string;
  company: string;
  prep_type: string; // 'pitch prep' | 'research'
  due_at: string;
};

export type DashboardPresentationItem = {
  opportunity_id: string;
  company: string;
  scheduled_at: string;
  spec: ReadinessPill;
  demo: ReadinessPill;
  price: ReadinessPill;
  demo_spec_id: string;
  demo_spec_status: DemoSpecStatus;
};

// The dashboard's cold-calling station sub-object. The cold-calling-target PUT (§4.2)
// returns everything here EXCEPT calls_this_week, so the frontend merges its response
// into this sub-object without re-fetching the whole dashboard.
export type ColdCallingState = {
  calls_this_week: number;
  calls_today: number; // Calls layer §6.2 — card_activity rows logged today
  suggested_target: number;
  effective_target: number;
  override_active: boolean;
  iso_week: string; // 'YYYY-Www'
  reason: string;
};

// PUT /api/admin/cold-calling-target response (§4.2) — drops into ColdCallingState
// (calls_this_week is preserved client-side, as a target change doesn't move it).
export type ColdCallingTargetResponse = {
  effective_target: number;
  override_active: boolean;
  iso_week: string;
  suggested_target: number;
  reason: string;
};

export type DashboardResponse = {
  funnel: {
    leads: { total: number; this_week_delta: number; callable_now: number };
    prospects: {
      total: number;
      digging: number;
      building_pitch: number;
      avg_days_in_funnel: number;
      health: DashboardHealth;
    };
    presentations: {
      total: number;
      health: DashboardHealth;
      next: { company: string; scheduled_at: string } | null;
    };
    clients: { total: number }; // Calls layer §6.1 — active-client funnel vital
  };
  stations: {
    cold_calling: ColdCallingState;
    today_appointments: {
      is_weekday: boolean;
      slots: DashboardTodaySlot[];
    };
    research_and_prep: {
      waiting: DashboardPrepItem[];
      total: number;
    };
    presentations: {
      upcoming: DashboardPresentationItem[];
      total: number;
      not_ready: number;
    };
  };
};

// ── Studio44 Calls layer — step 2 read endpoints (§5.1, §6.1) ────────────
// Mirrors GET /api/admin/calls/queue and /api/admin/calls/funnel-vital.
export type CallCardStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'dead'
  | 'disqualified'
  | 'promoted';

export type CallQueueMode = 'cold' | 'callbacks' | 'mixed';

// One of the last-5 card_activity rows surfaced with a queue card.
export type CallPriorAttempt = {
  id: string;
  outcome: string | null;
  notes: string | null;
  attempt_number: number;
  created_at: string;
};

export type CallQueueCard = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  source: string | null;
  imported_at: string;
  notes: string | null;
  call_date: string;
  card_status: CallCardStatus;
  attempt_count: number;
  next_action_date: string | null;
  last_outcome: string | null;
  prior_attempts: CallPriorAttempt[]; // last 5, newest first
};

export type CallQueueResponse = {
  mode: CallQueueMode;
  industry_filter: string | null;
  count: number;
  cards: CallQueueCard[];
};

export type CallFunnelVitalResponse = {
  count: number; // cards with card_status in ('pending','in_progress')
  never_called_count: number; // ...and attempt_count = 0
  callbacks_due_today_count: number; // ...and a callback due today
  subline: string; // pre-formatted server-side
};

export type CallLogNextMove = 'pass' | 'retry' | 'promote' | 'book';

export type CallLogRequest = {
  outcome: string;
  next_move: CallLogNextMove;
  next_action_date: string | null;
  notes: string | null;
  script_variant_id: string | null;
  card_dwell_ms: number;
  scheduled_at?: string | null; // ISO 8601; sent only on next_move='book'
};

export type CallLogResponse = {
  ok: true;
  card_status: CallCardStatus;
  lead_id: string | null;
  opportunity_id: string | null;
  assessment_id: string | null; // set on the book path
};

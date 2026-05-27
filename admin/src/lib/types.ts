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

export type AssessmentStatus = 'booked' | 'completed' | 'no_show' | 'canceled' | 'rescheduled';

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

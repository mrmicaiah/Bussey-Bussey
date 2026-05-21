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

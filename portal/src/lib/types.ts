export type WalkthroughState =
  | 'new'
  | 'password_set'
  | 'contract_signed'
  | 'payment_set'
  | 'complete';

export type PortalMe = {
  portal_account: {
    id: string;
    email: string;
    must_change_password: boolean;
    walkthrough_completed: boolean;
    walkthrough_state: WalkthroughState;
  };
  client: {
    id: string;
    company_name: string;
    primary_contact_name: string | null;
  };
  opportunity: {
    id: string;
    name: string;
    accepted_at: string | null;
    setup_total: number;
    monthly_total: number;
  };
  contract: {
    id: string;
    template_version: string;
    signed_at: string | null;
  } | null;
};

export type WalkthroughStatePayload = {
  walkthrough_state: WalkthroughState;
  walkthrough_completed: boolean;
  must_change_password: boolean;
  contract?: {
    id: string;
    body: string;
    signed_at: string | null;
  };
  payment_summary?: {
    setup_total: number;
    monthly_total: number;
    monthly_starts_on: string; // ISO date
  };
};

export type MarkerKind = 'sig' | 'print' | 'initial' | 'date';

export type ContractMarker = {
  kind: MarkerKind;
  label: string;
  /** Raw marker text as it appears in the source — `{{kind:label}}`. Used as the React-style key. */
  raw: string;
  /** Position in the rendered body string; useful when splitting around markers. */
  index: number;
};

export type ChangeOrderStatus = 'draft' | 'proposed' | 'approved' | 'rejected' | 'withdrawn';

export type PortalChangeOrderSummary = {
  id: string;
  name: string;
  status: ChangeOrderStatus;
  reason: string | null;
  setup_delta: number;
  monthly_delta: number;
  proposed_at: string | null;
  approved_at: string | null;
  created_at: string;
  opportunity_id: string;
  opportunity_name: string;
};

export type PortalChangeOrderLineItem = {
  id: string;
  action: 'add' | 'remove';
  component_code: string;
  quantity: number;
  unit_price_from_snapshot: number;
  line_total_delta: number;
  description_override: string | null;
};

export type PortalChangeOrderDetail = {
  change_order: PortalChangeOrderSummary & {
    client_id: string;
    client_company_name: string;
    client_primary_contact_name: string | null;
    client_primary_contact_email: string;
    approved_by_portal_account_id: string | null;
  };
  line_items: PortalChangeOrderLineItem[];
};

import type { Route } from '../../types/route';
import { notImplemented } from '../../lib/responses';
import { adminLogin, adminLogout } from './auth';
import { adminMe } from './me';
import { listLeads, getLead, createLead, updateLead, deleteLead, getLeadChatTranscript } from './leads';
import { listClients, getClient, createClient, updateClient, deleteClient } from './clients';
import {
  listOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
} from './opportunities';
import {
  previewLeadDelete,
  previewClientDelete,
  previewOpportunityDelete,
} from './delete-preview';
import {
  listProposals,
  getProposal,
  createProposalHandler,
  updateProposalHandler,
  deleteProposalHandler,
  cloneProposalHandler,
  addLineItemHandler,
  updateLineItemHandler,
  deleteLineItemHandler,
} from './proposals';
import { listPricingComponents } from './pricing-components';
import { captureDisposition } from './disposition';
import { activateOpportunityHandler } from './activate';
import {
  sendCredentialsEmailHandler,
  getCredentialsHandler,
  resetCredentialsHandler,
} from './credentials';
import { listPendingActivationsHandler } from './pending-activations';
import { updateProjectHandler } from './projects';
import {
  listChangeOrdersHandler,
  createChangeOrderHandler,
  fetchChangeOrderHandler,
  updateChangeOrderHandler,
  deleteChangeOrderHandler,
  addChangeOrderLineItemHandler,
  deleteChangeOrderLineItemHandler,
  proposeChangeOrderHandler,
  withdrawChangeOrderHandler,
} from './change-orders';
import {
  listChangeRequestsHandler,
  markChangeRequestReviewedHandler,
  declineChangeRequestHandler,
  convertChangeRequestHandler,
} from './change-requests';
import {
  importCallingListHandler,
  callingListTodayHandler,
  callingListIndexHandler,
  callingListStatsHandler,
  callingListLogHandler,
  callingListRescheduleHandler,
  callingListDisqualifyHandler,
  callingListBulkRescheduleHandler,
} from './calling-list';

/**
 * Admin routes — admin_user session required.
 *
 * Mirrors the inventory in specs/12-architecture-backend.md.
 *
 * CRUD groups use a list-or-collection pattern (`GET/POST /api/admin/foo`)
 * plus an item pattern (`GET/PUT/DELETE /api/admin/foo/:id`).
 * Auth middleware is not yet wired; that comes in the next implementation pass.
 */
export const adminRoutes: Route[] = [
  // Auth
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/auth/login' }),
    description: 'Admin login.',
    handler: adminLogin,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/auth/logout' }),
    description: 'Admin logout.',
    handler: adminLogout,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/me' }),
    description: 'Current admin user (for SPA boot).',
    handler: adminMe,
  },

  // Leads
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/leads' }),
    description: 'List leads.',
    handler: listLeads,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/leads' }),
    description: 'Create a lead (manual entry).',
    handler: createLead,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/leads/:id' }),
    description: 'Fetch lead detail.',
    handler: getLead,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/leads/:id' }),
    description: 'Update lead.',
    handler: updateLead,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/leads/:id' }),
    description: 'Delete lead (rare; usually status changes instead).',
    handler: deleteLead,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/leads/:id/delete-preview' }),
    description: 'Counts of dependents that would be orphaned by deleting this lead.',
    handler: previewLeadDelete,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/leads/:id/chat-transcript' }),
    description: 'Chat transcript for a chat-sourced lead.',
    handler: getLeadChatTranscript,
  },

  // Clients
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/clients' }),
    description: 'List clients.',
    handler: listClients,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/clients' }),
    description: 'Create client (manual or via lead conversion).',
    handler: createClient,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/clients/:id' }),
    description: 'Fetch client detail.',
    handler: getClient,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/clients/:id' }),
    description: 'Update client.',
    handler: updateClient,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/clients/:id' }),
    description: 'Delete client.',
    handler: deleteClient,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/clients/:id/delete-preview' }),
    description: 'Cascade counts that would result from deleting this client.',
    handler: previewClientDelete,
  },

  // Opportunities
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities' }),
    description: 'List opportunities (filter via ?client_id= and ?status=).',
    handler: listOpportunities,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities' }),
    description: 'Create opportunity under a client.',
    handler: createOpportunity,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id' }),
    description: 'Fetch opportunity detail.',
    handler: getOpportunity,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id' }),
    description: 'Update opportunity (administrative fields only after acceptance).',
    handler: updateOpportunity,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id' }),
    description: 'Delete opportunity (refused once accepted).',
    handler: deleteOpportunity,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id/delete-preview' }),
    description: 'Cascade counts that would result from deleting this opportunity.',
    handler: previewOpportunityDelete,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id/disposition' }),
    description: 'Capture disposition (accepted | followup | changes | declined).',
    handler: captureDisposition,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id/activate' }),
    description:
      'Activation flow: lock snapshot, create project + contract + portal_account, return one-time credentials.',
    handler: activateOpportunityHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id/send-credentials-email' }),
    description: 'Email the portal credentials to the client (within 24h re-display window).',
    handler: sendCredentialsEmailHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id/credentials' }),
    description: 'Re-display state for activation credentials (within 24h window).',
    handler: getCredentialsHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/opportunities/:id/reset-credentials' }),
    description: 'Rotate the temp password; returns fresh one-time credentials.',
    handler: resetCredentialsHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/pending-activations' }),
    description: 'Accepted opportunities whose client has not yet completed the walkthrough.',
    handler: listPendingActivationsHandler,
  },

  // Projects
  // No DELETE — projects are tied to opportunities and persist for historical reference.
  // PUT is limited to administrative fields (build_status_note, current_phase, next_milestone,
  // presentation_notes); handlers must enforce this against the three-tier editability model.
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/projects' }),
    description: 'List projects.',
    handler: () => notImplemented('admin:projects.list', 'List projects'),
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/projects/:id' }),
    description: 'Fetch project detail.',
    handler: () => notImplemented('admin:projects.fetch', 'Fetch a project'),
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/projects/:id' }),
    description:
      'Update project administrative fields (build_status_note, current_phase, next_milestone, presentation_notes).',
    handler: updateProjectHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/clients/:client_id/projects' }),
    description: 'List projects for a specific client.',
    handler: () =>
      notImplemented('admin:clients.projects.list', 'List projects scoped to a client'),
  },

  // Proposals
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/proposals' }),
    description: 'List proposals (filter via ?opportunity_id=).',
    handler: listProposals,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/proposals' }),
    description: 'Create proposal (takes pricing snapshot from live rate card).',
    handler: createProposalHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id' }),
    description: 'Fetch proposal with line items + snapshot.',
    handler: getProposal,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id' }),
    description: 'Update proposal (draft/sent only; refuses on accepted).',
    handler: updateProposalHandler,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id' }),
    description: 'Delete proposal (draft only).',
    handler: deleteProposalHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id/clone' }),
    description:
      'Clone proposal. Draft/sent → new draft on same opportunity (source superseded). Accepted → new opportunity under same client.',
    handler: cloneProposalHandler,
  },
  // Line items, nested under the proposal
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id/line-items' }),
    description: 'Add a line item to a draft/sent proposal.',
    handler: addLineItemHandler,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id/line-items/:line_id' }),
    description: 'Update a line item (quantity, description_override, unit_price for custom items).',
    handler: updateLineItemHandler,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/proposals/:id/line-items/:line_id' }),
    description: 'Remove a line item from a draft/sent proposal.',
    handler: deleteLineItemHandler,
  },

  // Pricing components (live rate card)
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/pricing-components' }),
    description: 'List pricing components.',
    handler: listPricingComponents,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/pricing-components' }),
    description: 'Create a pricing component.',
    handler: () => notImplemented('admin:pricing.create', 'Create a pricing component'),
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/pricing-components/:id' }),
    description: 'Fetch a pricing component.',
    handler: () => notImplemented('admin:pricing.fetch', 'Fetch a pricing component'),
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/pricing-components/:id' }),
    description: 'Update a pricing component (live rate; existing snapshots unaffected).',
    handler: () => notImplemented('admin:pricing.update', 'Update a pricing component'),
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/pricing-components/:id' }),
    description: 'Delete (or deactivate) a pricing component.',
    handler: () => notImplemented('admin:pricing.delete', 'Delete a pricing component'),
  },

  // Change orders (post-acceptance only)
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders' }),
    description: 'List change orders (filter by proposal_id or opportunity_id).',
    handler: listChangeOrdersHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders' }),
    description: 'Create change order (against an accepted proposal; uses locked snapshot).',
    handler: createChangeOrderHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id' }),
    description: 'Fetch a change order with line items.',
    handler: fetchChangeOrderHandler,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id' }),
    description: 'Update change order (draft only; withdraw+recreate for proposed).',
    handler: updateChangeOrderHandler,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id' }),
    description: 'Delete change order (draft only).',
    handler: deleteChangeOrderHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id/line-items' }),
    description: 'Add a line item to a draft change order; recomputes deltas.',
    handler: addChangeOrderLineItemHandler,
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id/line-items/:line_id' }),
    description: 'Remove a line item from a draft change order; recomputes deltas.',
    handler: deleteChangeOrderLineItemHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id/propose' }),
    description: 'Transition draft → proposed; notify client.',
    handler: proposeChangeOrderHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-orders/:id/withdraw' }),
    description: 'Transition proposed → withdrawn.',
    handler: withdrawChangeOrderHandler,
  },

  // Change requests (client-submitted intake → admin scopes)
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/change-requests' }),
    description: 'List change requests (filter by opportunity_id).',
    handler: listChangeRequestsHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-requests/:id/mark-reviewed' }),
    description: 'Mark a change request as reviewed.',
    handler: markChangeRequestReviewedHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-requests/:id/decline' }),
    description: 'Decline a change request with optional note.',
    handler: declineChangeRequestHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/change-requests/:id/convert-to-change-order' }),
    description: 'Convert a change request into a draft change order (description pre-filled).',
    handler: convertChangeRequestHandler,
  },

  // Calling list
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/import' }),
    description: 'Import calling list CSV (?mode=skip|update|create_anyway).',
    handler: importCallingListHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/today' }),
    description: "Today's pending call cards + progress.",
    handler: callingListTodayHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/stats' }),
    description: 'Calling-list dashboard counts (today + week + all-time).',
    handler: callingListStatsHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list' }),
    description: 'Filterable calling-list history (status, date range, industry, q).',
    handler: callingListIndexHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/bulk-reschedule' }),
    description: 'Bulk-reschedule a set of calling_list_item rows.',
    handler: callingListBulkRescheduleHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/:id/log' }),
    description: 'Log a call outcome; advances status or converts to lead.',
    handler: callingListLogHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/:id/reschedule' }),
    description: 'Reschedule a single card to a new call_date.',
    handler: callingListRescheduleHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/admin/calling-list/:id/disqualify' }),
    description: 'Soft-delete a card by setting status to disqualified.',
    handler: callingListDisqualifyHandler,
  },

  // Notifications log
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/notifications' }),
    description: 'List recent notifications dispatched by the system.',
    handler: () => notImplemented('admin:notifications.list', 'List notifications'),
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/notifications/:id' }),
    description: 'Fetch a notification record.',
    handler: () => notImplemented('admin:notifications.fetch', 'Fetch a notification'),
  },

  // Audit log
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/audit-log' }),
    description: 'Query audit log (filterable by entity_type, entity_id, date range, actor).',
    handler: () => notImplemented('admin:audit-log.list', 'Query audit log'),
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/admin/audit-log/:id' }),
    description: 'Fetch a single audit log entry.',
    handler: () => notImplemented('admin:audit-log.fetch', 'Fetch an audit log entry'),
  },
];

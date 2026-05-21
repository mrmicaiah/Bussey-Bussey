import type { Route } from '../../types/route';
import { notImplemented } from '../../lib/responses';
import { portalLogin, portalLogout } from './auth';
import { portalMeHandler } from './me';
import {
  walkthroughStateHandler,
  portalChangePasswordHandler,
  portalSignContractHandler,
} from './walkthrough';
import { setupPaymentHandler } from './setup-payment';
import { walkthroughCompleteHandler } from './complete';
import { paymentConfigHandler } from './payment-config';
import {
  listPortalChangeOrdersHandler,
  fetchPortalChangeOrderHandler,
  approveChangeOrderHandler,
  rejectChangeOrderHandler,
} from './change-orders';
import { portalActivityHandler } from './activity';
import { portalProjectStatusHandler } from './project-status';
import { portalListDocumentsHandler, portalFetchDocumentHandler } from './documents';
import {
  portalPaymentSummaryHandler,
  portalPaymentInvoicesHandler,
  portalPaymentPortalSessionHandler,
} from './payment';
import {
  portalCreateChangeRequestHandler,
  portalListChangeRequestsHandler,
} from './change-requests';
import {
  portalUpdateNotificationPrefsHandler,
  portalSignatureHistoryHandler,
} from './account';

/**
 * Portal routes — portal_account session required (except auth/login).
 *
 * Mirrors the inventory in specs/12-architecture-backend.md.
 * Walkthrough routes are gated server-side until walkthrough_completed = true.
 */
export const portalRoutes: Route[] = [
  // Auth
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/auth/login' }),
    description: 'Portal login (email + password; temp password on first login).',
    handler: portalLogin,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/auth/logout' }),
    description: 'Portal logout.',
    handler: portalLogout,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/auth/change-password' }),
    description: 'Change portal password (advances walkthrough state new → password_set).',
    handler: portalChangePasswordHandler,
  },

  // Me / session
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/me' }),
    description: 'Fetch current portal account profile + linked client + opportunity + contract.',
    handler: portalMeHandler,
  },

  // Walkthrough
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/walkthrough/state' }),
    description: 'Fetch current walkthrough state + per-step data (contract body, payment summary).',
    handler: walkthroughStateHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/walkthrough/sign-contract' }),
    description: 'Submit signature/initial fields and final agreement; write document_signature rows.',
    handler: portalSignContractHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/walkthrough/payment-config' }),
    description: 'Returns Stripe publishable key (or dev_placeholder sentinel) for the payment step.',
    handler: paymentConfigHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/walkthrough/setup-payment' }),
    description: 'Create Stripe customer + subscription + setup invoice from Stripe Elements payload.',
    handler: setupPaymentHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/walkthrough/complete' }),
    description: 'Mark walkthrough completed; fire admin + client notifications; unlock the portal.',
    handler: walkthroughCompleteHandler,
  },

  // Documents
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/documents' }),
    description: 'List documents available to client (contracts, proposal, change orders).',
    handler: portalListDocumentsHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/documents/:doc_type/:doc_id' }),
    description: 'Fetch a document body + signature audit by (doc_type, doc_id).',
    handler: portalFetchDocumentHandler,
  },

  // Change orders (client side)
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/change-orders' }),
    description: 'List change orders visible to this client (excludes drafts).',
    handler: listPortalChangeOrdersHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/change-orders/:id' }),
    description: 'Fetch a change order for review (with line items).',
    handler: fetchPortalChangeOrderHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/change-orders/:id/approve' }),
    description: 'Approve change order (captures signature, fires Stripe ops).',
    handler: approveChangeOrderHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/change-orders/:id/reject' }),
    description: 'Reject change order with optional reason.',
    handler: rejectChangeOrderHandler,
  },

  // Informal change requests (not yet scoped change orders)
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/change-requests' }),
    description: 'Submit informal change request; notifies admin.',
    handler: portalCreateChangeRequestHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/change-requests' }),
    description: 'List this client\'s submitted change requests.',
    handler: portalListChangeRequestsHandler,
  },

  // Payment & billing
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/payment/summary' }),
    description: 'Current subscription + payment method on file.',
    handler: portalPaymentSummaryHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/payment/invoices' }),
    description: 'List invoices (setup, monthly, change order deltas).',
    handler: portalPaymentInvoicesHandler,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/portal/payment/portal-session' }),
    description: 'Create Stripe Customer Portal session for managing payment method.',
    handler: portalPaymentPortalSessionHandler,
  },

  // Project status
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/project-status' }),
    description: 'Fetch project status (current_phase, build_status_note, next_milestone).',
    handler: portalProjectStatusHandler,
  },

  // Activity feed + Account
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/activity' }),
    description: 'Client-visible activity feed (filtered audit_log).',
    handler: portalActivityHandler,
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/portal/account/notification-prefs' }),
    description: 'Update notification preferences (UI-only; send-side filtering deferred).',
    handler: portalUpdateNotificationPrefsHandler,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/portal/account/signatures' }),
    description: 'Signature audit history for this portal account.',
    handler: portalSignatureHistoryHandler,
  },
];

import type { Route } from '../../types/route';
import { chatSessionCreate, chatMessage, chatSessionFetch, chatPreflight } from './chat';
import { presentationData, presentationShell } from './presentation';

/**
 * Public routes — no authentication required.
 * - /api/chat/*           — Claude-powered website chat (v1's one AI feature)
 * - /p/:opportunity_token — Presentation data endpoint (read-only, token-protected)
 *
 * Mirrors the inventory in specs/12-architecture-backend.md.
 */
export const publicRoutes: Route[] = [
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/chat/session' }),
    description: 'Start or resume a chat session (anonymous visitor).',
    handler: chatSessionCreate,
  },
  {
    method: 'OPTIONS',
    pattern: new URLPattern({ pathname: '/api/chat/session' }),
    description: 'CORS preflight for chat session.',
    handler: chatPreflight,
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/chat/message' }),
    description: "Send a chat message; get Claude's response.",
    handler: chatMessage,
  },
  {
    method: 'OPTIONS',
    pattern: new URLPattern({ pathname: '/api/chat/message' }),
    description: 'CORS preflight for chat message.',
    handler: chatPreflight,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/chat/session/:token' }),
    description: 'Fetch chat session state for resume.',
    handler: chatSessionFetch,
  },
  {
    method: 'OPTIONS',
    pattern: new URLPattern({ pathname: '/api/chat/session/:token' }),
    description: 'CORS preflight for chat session fetch.',
    handler: chatPreflight,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/p/:opportunity_token/data' }),
    description: 'Public presentation data endpoint (token-protected, polled by live sync).',
    handler: presentationData,
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/p/:opportunity_token' }),
    description: 'Public presentation HTML shell (placeholder until step H).',
    handler: presentationShell,
  },
];

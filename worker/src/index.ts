import type { Env } from './types/env';
import type { Route } from './types/route';
import { json, methodNotAllowed, notFound } from './lib/responses';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { portalRoutes } from './routes/portal';
import { webhookRoutes } from './routes/webhooks';
import { verifyAdminGate, verifyPortalGate } from './middleware/auth';

const ALL_ROUTES: readonly Route[] = [
  ...publicRoutes,
  ...adminRoutes,
  ...portalRoutes,
  ...webhookRoutes,
];

const ROUTE_INVENTORY = ALL_ROUTES.map((r) => ({
  method: r.method,
  pattern: r.pattern.pathname ?? '',
  description: r.description,
}));

/** Paths that bypass the admin auth gate. Add new public-admin endpoints here cautiously. */
const ADMIN_AUTH_EXEMPT = new Set<string>([
  '/api/admin/auth/login',
]);

/** Paths that bypass the portal auth gate. */
const PORTAL_AUTH_EXEMPT = new Set<string>([
  '/api/portal/auth/login',
]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    try {
      if (pathname === '/' && method === 'GET') {
        return json({
          service: 'bussey-bussey-api',
          env: env.ENV,
          routes: ROUTE_INVENTORY,
        });
      }

      // 1. Find the matching route
      let methodMismatch = false;
      let matched: { route: Route; params: Record<string, string | undefined> } | null = null;

      for (const route of ALL_ROUTES) {
        const match = route.pattern.exec({ pathname });
        if (!match) continue;
        if (route.method !== 'ANY' && route.method !== method) {
          methodMismatch = true;
          continue;
        }
        matched = {
          route,
          params: (match.pathname.groups ?? {}) as Record<string, string | undefined>,
        };
        break;
      }

      if (!matched) {
        return methodMismatch ? methodNotAllowed(pathname, method) : notFound(pathname);
      }

      // 2. Apply audience-based auth gating BEFORE dispatching the handler.
      //    Path-prefix gating keeps the Route shape free of middleware metadata.
      //    On success, the verified session is threaded through to the handler.
      let session: import('./lib/sessions').SessionRecord | null = null;
      if (pathname.startsWith('/api/admin/') && !ADMIN_AUTH_EXEMPT.has(pathname)) {
        const gate = await verifyAdminGate(request, env);
        if (gate.kind === 'reject') return gate.response;
        session = gate.session;
      }
      if (pathname.startsWith('/api/portal/') && !PORTAL_AUTH_EXEMPT.has(pathname)) {
        const gate = await verifyPortalGate(request, env);
        if (gate.kind === 'reject') return gate.response;
        session = gate.session;
      }

      // 3. Dispatch to the matched route handler.
      return await matched.route.handler({
        request,
        env,
        ctx,
        params: matched.params,
        session,
      });
    } catch (err) {
      console.error('worker:unhandled', err);
      return json({ error: 'internal_error' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

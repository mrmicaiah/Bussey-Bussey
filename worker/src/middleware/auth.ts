import type { Env } from '../types/env';
import { json } from '../lib/responses';
import { parseCookies } from '../lib/cookies';
import { verifySession, type SessionRecord } from '../lib/sessions';

export const ADMIN_COOKIE = 'bb_admin_session';
export const PORTAL_COOKIE = 'bb_portal_session';

export type GateResult = { kind: 'pass'; session: SessionRecord } | { kind: 'reject'; response: Response };

export async function verifyAdminGate(request: Request, env: Env): Promise<GateResult> {
  return verifyGate(request, env, 'admin', ADMIN_COOKIE);
}

export async function verifyPortalGate(request: Request, env: Env): Promise<GateResult> {
  return verifyGate(request, env, 'portal', PORTAL_COOKIE);
}

async function verifyGate(
  request: Request,
  env: Env,
  scope: 'admin' | 'portal',
  cookieName: string,
): Promise<GateResult> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[cookieName];
  if (!token) return reject();
  const session = await verifySession(env, scope, token);
  if (!session) return reject();
  return { kind: 'pass', session };
}

function reject(): GateResult {
  return {
    kind: 'reject',
    response: json({ error: 'unauthenticated' }, { status: 401 }),
  };
}

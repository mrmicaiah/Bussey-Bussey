import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { verifyPassword } from '../../lib/password';
import { createSession, revokeSession, SESSION_TTLS } from '../../lib/sessions';
import { serializeCookie, parseCookies } from '../../lib/cookies';
import { PORTAL_COOKIE } from '../../middleware/auth';
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginRateLimit,
} from '../../lib/rate-limit';

type PortalRow = {
  id: string;
  client_id: string;
  email: string;
  password_hash: string;
  must_change_password: number;
  walkthrough_completed: number;
  walkthrough_state: string;
};

export async function portalLogin(ctx: HandlerContext): Promise<Response> {
  const ip = clientIp(ctx.request);

  const limit = await checkLoginRateLimit(ctx.env, 'portal', ip);
  if (!limit.allowed) {
    return json(
      { error: 'rate_limited', retry_after_seconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody(ctx.request);
  if (!body) return json({ error: 'invalid_request' }, { status: 400 });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return json({ error: 'invalid_request' }, { status: 400 });

  const account = await ctx.env.DB.prepare(
    `SELECT id, client_id, email, password_hash, must_change_password, walkthrough_completed, walkthrough_state
       FROM portal_account WHERE email = ?`,
  )
    .bind(email)
    .first<PortalRow>();

  if (!account) {
    await recordLoginFailure(ctx.env, 'portal', ip);
    return json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const ok = await verifyPassword(password, account.password_hash);
  if (!ok) {
    await recordLoginFailure(ctx.env, 'portal', ip);
    return json({ error: 'invalid_credentials' }, { status: 401 });
  }

  await clearLoginRateLimit(ctx.env, 'portal', ip);

  const userAgent = ctx.request.headers.get('user-agent');
  const { token } = await createSession(ctx.env, 'portal', account.id, ip, userAgent);

  await ctx.env.DB.prepare(`UPDATE portal_account SET last_login_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), account.id)
    .run();

  const cookie = serializeCookie(PORTAL_COOKIE, token, {
    maxAge: SESSION_TTLS.portal.absoluteSeconds,
    httpOnly: true,
    secure: ctx.env.ENV !== 'development',
    sameSite: 'Strict',
    path: '/',
  });

  return json(
    {
      account: {
        id: account.id,
        email: account.email,
        client_id: account.client_id,
        must_change_password: account.must_change_password === 1,
        walkthrough_completed: account.walkthrough_completed === 1,
        walkthrough_state: account.walkthrough_state,
      },
    },
    { status: 200, headers: { 'set-cookie': cookie } },
  );
}

export async function portalLogout(ctx: HandlerContext): Promise<Response> {
  const cookies = parseCookies(ctx.request.headers.get('cookie'));
  const token = cookies[PORTAL_COOKIE];
  if (token) await revokeSession(ctx.env, 'portal', token);
  const cleared = serializeCookie(PORTAL_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    secure: ctx.env.ENV !== 'development',
    sameSite: 'Strict',
    path: '/',
  });
  return json({ ok: true }, { status: 200, headers: { 'set-cookie': cleared } });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  return 'unknown';
}

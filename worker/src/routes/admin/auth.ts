import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { verifyPassword } from '../../lib/password';
import { createSession, revokeSession, SESSION_TTLS } from '../../lib/sessions';
import { serializeCookie, parseCookies } from '../../lib/cookies';
import { ADMIN_COOKIE } from '../../middleware/auth';
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginRateLimit,
} from '../../lib/rate-limit';

type AdminRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  active: number;
};

export async function adminLogin(ctx: HandlerContext): Promise<Response> {
  const ip = clientIp(ctx.request);

  const limit = await checkLoginRateLimit(ctx.env, 'admin', ip);
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

  const user = await ctx.env.DB.prepare(
    `SELECT id, name, email, password_hash, role, active FROM admin_user WHERE email = ? AND active = 1`,
  )
    .bind(email)
    .first<AdminRow>();

  if (!user) {
    await recordLoginFailure(ctx.env, 'admin', ip);
    return json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordLoginFailure(ctx.env, 'admin', ip);
    return json({ error: 'invalid_credentials' }, { status: 401 });
  }

  await clearLoginRateLimit(ctx.env, 'admin', ip);

  const userAgent = ctx.request.headers.get('user-agent');
  const { token } = await createSession(ctx.env, 'admin', user.id, ip, userAgent);

  await ctx.env.DB.prepare(`UPDATE admin_user SET last_login_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), user.id)
    .run();

  const cookie = serializeCookie(ADMIN_COOKIE, token, {
    maxAge: SESSION_TTLS.admin.absoluteSeconds,
    httpOnly: true,
    secure: ctx.env.ENV !== 'development',
    sameSite: 'Strict',
    path: '/',
  });

  return json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { status: 200, headers: { 'set-cookie': cookie } },
  );
}

export async function adminLogout(ctx: HandlerContext): Promise<Response> {
  const cookies = parseCookies(ctx.request.headers.get('cookie'));
  const token = cookies[ADMIN_COOKIE];
  if (token) await revokeSession(ctx.env, 'admin', token);
  const cleared = serializeCookie(ADMIN_COOKIE, '', {
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

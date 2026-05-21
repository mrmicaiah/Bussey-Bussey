import type { Env } from '../types/env';
import { randomBase64Url, bytesToBase64Url, constantTimeEqual } from './random';

export type SessionScope = 'admin' | 'portal';

export type SessionTtl = {
  /** Rolling idle TTL — session expires this many seconds after last activity. */
  idleSeconds: number;
  /** Absolute TTL — session can never live past this many seconds from creation. */
  absoluteSeconds: number;
};

export const SESSION_TTLS: Record<SessionScope, SessionTtl> = {
  admin: { idleSeconds: 12 * 60 * 60, absoluteSeconds: 24 * 60 * 60 },
  portal: { idleSeconds: 30 * 24 * 60 * 60, absoluteSeconds: 90 * 24 * 60 * 60 },
};

/** What we store in KV (and mirror to D1). Hot-path reads come from KV. */
export type SessionRecord = {
  scope: SessionScope;
  sessionId: string;
  subjectId: string; // admin_user.id or portal_account.id
  createdAtMs: number;
  lastActiveAtMs: number;
  absoluteExpiresAtMs: number;
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * Create a new session: random sessionId, KV write, D1 insert, return signed token.
 * The signed token (`<sessionId>.<HMAC>`) is what the client gets as a cookie.
 */
export async function createSession(
  env: Env,
  scope: SessionScope,
  subjectId: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<{ token: string; record: SessionRecord }> {
  const ttl = SESSION_TTLS[scope];
  const sessionId = randomBase64Url(24);
  const now = Date.now();
  const absoluteExpiresAtMs = now + ttl.absoluteSeconds * 1000;

  const record: SessionRecord = {
    scope,
    sessionId,
    subjectId,
    createdAtMs: now,
    lastActiveAtMs: now,
    absoluteExpiresAtMs,
    ipAddress,
    userAgent,
  };

  const token = await signToken(env.SESSION_SECRET, sessionId);

  // KV mirror (fast lookup, expires at idle TTL)
  await env.SESSIONS.put(kvKey(scope, sessionId), JSON.stringify(record), {
    expirationTtl: ttl.idleSeconds,
  });

  // D1 authoritative record
  const absoluteExpiresAtIso = new Date(absoluteExpiresAtMs).toISOString();
  const idleExpiresAtIso = new Date(now + ttl.idleSeconds * 1000).toISOString();
  const createdAtIso = new Date(now).toISOString();

  if (scope === 'admin') {
    await env.DB.prepare(
      `INSERT INTO admin_session (id, admin_user_id, session_token, created_at, last_active_at, expires_at, idle_expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(sessionId, subjectId, token, createdAtIso, createdAtIso, absoluteExpiresAtIso, idleExpiresAtIso, ipAddress, userAgent)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO portal_session (id, portal_account_id, session_token, created_at, last_active_at, expires_at, idle_expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(sessionId, subjectId, token, createdAtIso, createdAtIso, absoluteExpiresAtIso, idleExpiresAtIso, ipAddress, userAgent)
      .run();
  }

  return { token, record };
}

/**
 * Verify a presented token. Returns the SessionRecord if valid, null otherwise.
 * On success, opportunistically refreshes the KV entry's idle TTL (debounced to ~60s).
 */
export async function verifySession(env: Env, scope: SessionScope, token: string): Promise<SessionRecord | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const sessionId = parts[0];
  const sig = parts[1];
  if (!sessionId || !sig) return null;

  // Verify HMAC before any KV read — bad tokens cost nothing
  const expected = await hmacBase64Url(env.SESSION_SECRET, sessionId);
  if (!constantTimeEqual(sig, expected)) return null;

  const raw = await env.SESSIONS.get(kvKey(scope, sessionId));
  if (!raw) return null;

  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
  if (record.scope !== scope || record.sessionId !== sessionId) return null;

  const now = Date.now();
  if (now > record.absoluteExpiresAtMs) return null;

  const ttl = SESSION_TTLS[scope];
  if (now - record.lastActiveAtMs > ttl.idleSeconds * 1000) return null;

  // Debounced touch: refresh KV TTL only if >60s since last touch
  if (now - record.lastActiveAtMs > 60_000) {
    record.lastActiveAtMs = now;
    const remainingAbsoluteSec = Math.floor((record.absoluteExpiresAtMs - now) / 1000);
    const effectiveTtl = Math.min(ttl.idleSeconds, remainingAbsoluteSec);
    if (effectiveTtl > 0) {
      await env.SESSIONS.put(kvKey(scope, sessionId), JSON.stringify(record), {
        expirationTtl: effectiveTtl,
      });
    }
  }

  return record;
}

/** Revoke a session: delete from KV, mark revoked in D1. Safe to call with an invalid token. */
export async function revokeSession(env: Env, scope: SessionScope, token: string): Promise<void> {
  const parts = token.split('.');
  if (parts.length !== 2) return;
  const sessionId = parts[0];
  const sig = parts[1];
  if (!sessionId || !sig) return;

  // Verify HMAC before doing destructive work
  const expected = await hmacBase64Url(env.SESSION_SECRET, sessionId);
  if (!constantTimeEqual(sig, expected)) return;

  await env.SESSIONS.delete(kvKey(scope, sessionId));

  const table = scope === 'admin' ? 'admin_session' : 'portal_session';
  await env.DB.prepare(`UPDATE ${table} SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), sessionId)
    .run();
}

function kvKey(scope: SessionScope, sessionId: string): string {
  return `${scope}:session:${sessionId}`;
}

async function signToken(secret: string, sessionId: string): Promise<string> {
  const sig = await hmacBase64Url(secret, sessionId);
  return `${sessionId}.${sig}`;
}

async function hmacBase64Url(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

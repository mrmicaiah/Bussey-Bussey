import type { Env } from '../types/env';

/**
 * Login rate limiter (KV-backed).
 *
 * Spec: 5 attempts per 15 min per IP, exponential backoff after threshold.
 *
 * Behavior:
 *   - First 5 failures in a 15-minute window: returned to the handler as
 *     plain auth failures (the handler still returns 401, but the limiter
 *     does not block).
 *   - 6th failure and beyond: lock the IP for an exponentially growing window
 *     (2^overage minutes), capped at 1 hour total lockout.
 *   - Successful login clears the failure record entirely.
 *
 * State is stored in KV at `ratelimit:<scope>:login:<ip>`.
 */

const WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_THRESHOLD = 5;
const BACKOFF_CAP_SECONDS = 60 * 60;

export type RateLimitScope = 'admin' | 'portal';

type RateLimitState = {
  failures: number;
  windowStartMs: number;
  lockedUntilMs: number | null;
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function checkLoginRateLimit(env: Env, scope: RateLimitScope, ip: string): Promise<RateLimitDecision> {
  const raw = await env.SESSIONS.get(kvKey(scope, ip));
  if (!raw) return { allowed: true };

  let state: RateLimitState;
  try {
    state = JSON.parse(raw) as RateLimitState;
  } catch {
    return { allowed: true };
  }

  const now = Date.now();
  if (state.lockedUntilMs !== null && now < state.lockedUntilMs) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntilMs - now) / 1000)),
    };
  }
  return { allowed: true };
}

export async function recordLoginFailure(env: Env, scope: RateLimitScope, ip: string): Promise<void> {
  const key = kvKey(scope, ip);
  const now = Date.now();
  const raw = await env.SESSIONS.get(key);

  let state: RateLimitState;
  if (raw) {
    try {
      state = JSON.parse(raw) as RateLimitState;
    } catch {
      state = { failures: 0, windowStartMs: now, lockedUntilMs: null };
    }
    if (now - state.windowStartMs > WINDOW_MS) {
      // Window expired — reset.
      state = { failures: 1, windowStartMs: now, lockedUntilMs: null };
    } else {
      state.failures += 1;
    }
  } else {
    state = { failures: 1, windowStartMs: now, lockedUntilMs: null };
  }

  if (state.failures > ATTEMPT_THRESHOLD) {
    const overage = state.failures - ATTEMPT_THRESHOLD; // 1, 2, 3, ...
    const lockSeconds = Math.min(Math.pow(2, overage) * 60, BACKOFF_CAP_SECONDS);
    state.lockedUntilMs = now + lockSeconds * 1000;
  }

  // KV TTL covers either the rolling window or the lockout, whichever is later.
  const ttlBound = Math.max(WINDOW_MS / 1000, BACKOFF_CAP_SECONDS) + 60;

  await env.SESSIONS.put(key, JSON.stringify(state), { expirationTtl: ttlBound });
}

export async function clearLoginRateLimit(env: Env, scope: RateLimitScope, ip: string): Promise<void> {
  await env.SESSIONS.delete(kvKey(scope, ip));
}

function kvKey(scope: RateLimitScope, ip: string): string {
  return `ratelimit:${scope}:login:${ip}`;
}

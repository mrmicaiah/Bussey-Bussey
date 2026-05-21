/**
 * Thin fetch wrapper around the Worker API for the portal SPA.
 *
 * Mirrors admin/src/lib/api.ts — separate file by design so portal can
 * evolve API conventions without affecting admin (e.g., portal-specific
 * error envelopes for the walkthrough flow).
 *
 * - Sends credentials (cookies) on every request — the bb_portal_session
 *   HttpOnly cookie is set by the Worker on /api/portal/auth/login.
 * - Parses JSON responses.
 * - Throws ApiError with status + parsed body on non-2xx.
 */

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.status = status;
    this.body = body;
  }

  get errorCode(): string | null {
    if (this.body && typeof this.body === 'object' && 'error' in this.body) {
      const e = (this.body as Record<string, unknown>)['error'];
      return typeof e === 'string' ? e : null;
    }
    return null;
  }
}

type RequestInitBody = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, init: RequestInitBody = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body: BodyInit | undefined;

  if (init.body !== undefined && init.body !== null) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    body,
    credentials: 'include',
  });

  let parsed: unknown = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    parsed = await res.json().catch(() => null);
  } else {
    parsed = await res.text().catch(() => null);
  }

  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

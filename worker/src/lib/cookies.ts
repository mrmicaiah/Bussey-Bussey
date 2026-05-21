/**
 * Cookie parse + serialize helpers.
 * Defaults: HttpOnly, Secure (unless ENV=development), SameSite=Strict.
 */

export type CookieOptions = {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1));
    } catch {
      out[name] = part.slice(eq + 1);
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.httpOnly ?? true) parts.push('HttpOnly');
  if (opts.secure ?? true) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`);
  return parts.join('; ');
}

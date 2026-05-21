import type { Env } from './env';
import type { SessionRecord } from '../lib/sessions';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'ANY';

export type HandlerContext = {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string | undefined>;
  /** Verified session for gated routes; null for public/webhook routes. */
  session: SessionRecord | null;
};

export type RouteHandler = (ctx: HandlerContext) => Response | Promise<Response>;

export type Route = {
  method: HttpMethod;
  pattern: URLPattern;
  description: string;
  handler: RouteHandler;
};

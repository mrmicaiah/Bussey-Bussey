const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

export function notImplemented(route: string, purpose: string): Response {
  return json(
    {
      error: 'not_implemented',
      route,
      purpose,
      message: 'This route is scaffolded but not yet implemented.',
    },
    { status: 501 },
  );
}

export function notFound(pathname: string): Response {
  return json({ error: 'not_found', path: pathname }, { status: 404 });
}

export function methodNotAllowed(pathname: string, method: string): Response {
  return json({ error: 'method_not_allowed', path: pathname, method }, { status: 405 });
}

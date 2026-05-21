import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { api, ApiError } from '$lib/api';
import type { PortalMe } from '$lib/types';

export const ssr = false;
export const prerender = false;

export async function load({ url }) {
  let me: PortalMe;
  try {
    me = await api.get<PortalMe>('/api/portal/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const next = encodeURIComponent(url.pathname + url.search);
      throw redirect(307, `${base}/login?next=${next}`);
    }
    throw e;
  }

  // Walkthrough gate: until the walkthrough is complete the client can only
  // see /portal/walkthrough. Server is the source of truth — see
  // worker/src/routes/portal/walkthrough.ts state-machine guards.
  const walkthroughPath = `${base}/walkthrough`;
  const isOnWalkthrough = url.pathname === walkthroughPath;
  if (!me.portal_account.walkthrough_completed && !isOnWalkthrough) {
    throw redirect(307, walkthroughPath);
  }
  if (me.portal_account.walkthrough_completed && isOnWalkthrough) {
    throw redirect(307, `${base}/`);
  }

  return { me };
}

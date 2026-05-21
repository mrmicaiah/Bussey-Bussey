import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { api, ApiError } from '$lib/api';

export const ssr = false;
export const prerender = false;

/**
 * If the user already has a valid session, skip the login form and bounce them
 * to the destination they were headed for (or the dashboard).
 */
export async function load({ url }) {
  let authed = false;
  try {
    await api.get('/api/admin/me');
    authed = true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return {}; // show login form
    }
    // Anything else: don't trap the user; let them try to sign in.
    return {};
  }
  if (authed) {
    const next = url.searchParams.get('next');
    const dest = next && next.startsWith(`${base}/`) ? next : `${base}/`;
    throw redirect(307, dest);
  }
  return {};
}

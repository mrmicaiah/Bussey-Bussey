// Studio44 Presentation room — Tab 1 load (client-safe screen-share surface).
//
// This route uses a `+page@.svelte` layout reset to ROOT, so it does NOT inherit
// the (authed) layout (no admin nav/header on the client's screen). Because the
// authed layout's guard is bypassed, we re-implement the auth check inline here
// and redirect to /login on 401. Data: the prospect workspace read (identity +
// demo_url + proposal pricing) and the opportunity (status), loaded in parallel.
import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { api, ApiError } from '$lib/api';
import type { ProspectWorkspace, Opportunity } from '$lib/types';

export const ssr = false;
export const prerender = false;

export async function load({ params, url }) {
  const id = params.id;

  // Inline auth guard (the root-reset bypasses the authed layout's guard).
  try {
    await api.get('/api/admin/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const next = encodeURIComponent(url.pathname + url.search);
      throw redirect(307, `${base}/login?next=${next}`);
    }
    throw e;
  }

  const [prospect, opp] = await Promise.all([
    api.get<ProspectWorkspace>(`/api/admin/prospects/${id}`),
    api.get<{ opportunity: Opportunity }>(`/api/admin/opportunities/${id}`),
  ]);

  return { id, prospect, opportunity: opp.opportunity };
}

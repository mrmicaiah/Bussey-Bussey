// Studio44 Calls layer §8 step 6 — the old plain-list "today's calls" view is
// retired. Redirect to /calls (which itself forwards to the /calls/work wizard).
//
// Done as a load-time redirect (not an in-component $effect) so it fires BEFORE
// the page component renders — no paint of the old UI, no flash. ssr is already
// off for the whole app (root +layout.ts), so this runs client-side on nav.
// The +page.svelte is kept as a no-op fallback rather than deleted, so any
// bookmark to /calling-list/today still resolves gracefully.
import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

export const ssr = false;
export const prerender = false;

export function load() {
  throw redirect(307, `${base}/calls`);
}

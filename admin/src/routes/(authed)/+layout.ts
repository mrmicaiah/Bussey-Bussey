import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { api, ApiError } from '$lib/api';
import type { AdminUser } from '$lib/types';

export const ssr = false;
export const prerender = false;

export async function load({ url }) {
  try {
    const { user } = await api.get<{ user: AdminUser }>('/api/admin/me');
    return { user };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const next = encodeURIComponent(url.pathname + url.search);
      throw redirect(307, `${base}/login?next=${next}`);
    }
    throw e;
  }
}

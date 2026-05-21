<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import type { PortalMe } from '$lib/types';

  let {
    data,
    children,
  }: { data: { me: PortalMe }; children: import('svelte').Snippet } = $props();

  async function logout() {
    try {
      await api.post('/api/portal/auth/logout', {});
    } catch {
      // Ignore — we redirect either way.
    }
    goto(`${base}/login`, { replaceState: true });
  }

  const NAV = [
    { href: '/', label: 'Home' },
    { href: '/documents', label: 'Documents' },
    { href: '/project-status', label: 'Project' },
    { href: '/payment', label: 'Payment' },
    { href: '/change-orders', label: 'Change orders' },
    { href: '/account', label: 'Account' },
  ] as const;

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/') return path === `${base}/` || path === base || path === `${base}`;
    return path.startsWith(`${base}${href}`);
  }

  const showNav = $derived(data.me.portal_account.walkthrough_completed);
</script>

<header class="topbar">
  <div class="brand">
    <strong>Bussey and Bussey</strong>
    <span class="muted small">Client Portal</span>
  </div>
  <div class="topbar-right">
    <span class="muted small">{data.me.client.company_name}</span>
    <button type="button" class="logout-btn" onclick={logout}>Sign out</button>
  </div>
</header>

{#if showNav}
  <nav class="navbar">
    <div class="nav-inner">
      {#each NAV as item}
        <a
          class="nav-link"
          class:active={isActive(item.href)}
          href={`${base}${item.href}`}
        >
          {item.label}
        </a>
      {/each}
    </div>
  </nav>
{/if}

<main>
  {@render children()}
</main>

<style>
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-6);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: baseline; gap: 0.6rem; }
  .topbar-right { display: flex; align-items: center; gap: var(--space-4); }
  .logout-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.75rem;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
  }
  .logout-btn:hover { border-color: var(--accent); }
  .navbar {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .nav-inner {
    max-width: 1000px;
    margin: 0 auto;
    display: flex;
    gap: 0.2rem;
    padding: 0 var(--space-6);
    flex-wrap: wrap;
  }
  .nav-link {
    padding: 0.65rem 0.9rem;
    color: var(--muted);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    font-size: 0.95rem;
  }
  .nav-link:hover { color: var(--text); text-decoration: none; }
  .nav-link.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  main {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--space-6);
  }
</style>

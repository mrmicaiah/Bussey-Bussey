<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api';
  import type { AdminUser } from '$lib/types';

  let { user }: { user: AdminUser } = $props();

  async function logout() {
    try {
      await api.post('/api/admin/auth/logout');
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
    }
    goto(`${base}/login`);
  }

  const navItems = [
    { href: `${base}/`, label: 'Dashboard', match: (p: string) => p === `${base}/` || p === base },
    { href: `${base}/leads`, label: 'Leads', match: (p: string) => p.startsWith(`${base}/leads`) },
    { href: `${base}/clients`, label: 'Clients', match: (p: string) => p.startsWith(`${base}/clients`) },
    { href: `${base}/calling-list/today`, label: 'Calling list', match: (p: string) => p.startsWith(`${base}/calling-list`) },
  ];
</script>

<header>
  <div class="brand">
    <a href={`${base}/`}>Bussey · Admin</a>
  </div>
  <nav>
    {#each navItems as item}
      <a
        href={item.href}
        class:active={item.match(page.url.pathname)}
      >
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="user">
    <span class="name">{user.name}</span>
    <span class="role">{user.role}</span>
    <button onclick={logout} class="logout">Log out</button>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: 0.6rem var(--space-6);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand a {
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }
  nav { display: flex; gap: var(--space-4); flex: 1; }
  nav a {
    padding: 0.3rem 0;
    color: var(--muted);
    border-bottom: 2px solid transparent;
  }
  nav a:hover { color: var(--text); text-decoration: none; }
  nav a.active { color: var(--accent); border-color: var(--accent); }
  .user { display: flex; align-items: center; gap: var(--space-3); }
  .name { font-weight: 500; }
  .role {
    font-size: 0.75rem;
    background: #ececea;
    color: var(--muted);
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: capitalize;
  }
  .logout {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }
  .logout:hover { background: #ececea; }
</style>

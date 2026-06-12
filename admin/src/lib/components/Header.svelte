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

  // Nav mirrors the dashboard's funnel-vital order: Calls → Leads → Prospects →
  // Clients. Dashboard stays first as the home page (not a funnel stage).
  const navItems = [
    { href: `${base}/`, label: 'Dashboard', match: (p: string) => p === `${base}/` || p === base },
    { href: `${base}/calls`, label: 'Calls', match: (p: string) => p.startsWith(`${base}/calls`) || p.startsWith(`${base}/calling-list`) },
    { href: `${base}/leads`, label: 'Leads', match: (p: string) => p.startsWith(`${base}/leads`) },
    { href: `${base}/prospects`, label: 'Prospects', match: (p: string) => p.startsWith(`${base}/prospects`) },
    { href: `${base}/clients`, label: 'Clients', match: (p: string) => p.startsWith(`${base}/clients`) },
  ];
</script>

<header>
  <a class="brand" href={`${base}/`}>Studio<span class="b-accent">44</span></a>
  <!-- Calls layer §6.3: the global Work launcher points at the calls wizard. Chose the
       simple always-/calls/work link over an inline funnel-vital fetch — the header is a
       per-page component, the wizard's empty state already handles "no cards → import a
       list", and it matches the new architecture's calls-first bias. -->
  <a class="work" href={`${base}/calls/work`} title="Start a calling session" aria-label="Start a calling session">
    Work →
  </a>
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
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 500;
    letter-spacing: 0.5px;
    color: var(--text);
    text-decoration: none;
    font-size: 1.05rem;
  }
  .brand:hover { text-decoration: none; }
  .b-accent { color: var(--accent); }

  /* Work launcher — primary crimson, one-click into the calling wizard from anywhere. */
  .work {
    background: var(--accent);
    color: var(--accent-text);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.35rem 0.8rem;
    border-radius: var(--radius);
    border: 1px solid transparent;
    transition: filter 0.1s ease;
  }
  .work:hover { filter: brightness(1.1); text-decoration: none; }

  nav { display: flex; gap: var(--space-4); flex: 1; }
  nav a {
    padding: 0.3rem 0;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    text-decoration: none;
  }
  nav a:hover { color: var(--text); text-decoration: none; }
  nav a.active { color: var(--text); border-color: var(--accent); }

  .user { display: flex; align-items: center; gap: var(--space-3); }
  .name { font-weight: 500; }
  .role {
    font-size: 0.75rem;
    background: var(--border-soft);
    color: var(--muted);
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: capitalize;
  }
  .logout {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }
  .logout:hover { background: var(--surface); }
</style>

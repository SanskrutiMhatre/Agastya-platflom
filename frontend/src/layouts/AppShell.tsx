// The main dashboard frame. The navigation depends on the role:
//   administrator    Overview, Projects, Graphics, CIR, Backup, Activity, Administrator, Settings   (oversees; creates people, not projects)
//   project manager  Overview, Workspace, Projects, Graphics, CIR, Backup, Activity, Settings
//   author           Overview, Workspace, Projects, Graphics, CIR, Backup, Settings
// Notifications and the account menu sit together at the right of the top bar, icons only.

import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../store/session';
import { useInbox } from '../store/inbox';
import { useApp } from '../store/appSettings';
import { globalLabel } from '../lib/roles';

type Item = { to: string; label: string; icon: IconName; roles?: string[] };
const NAV: Item[] = [
  { to: '/overview', label: 'Overview', icon: 'dashboard' },
  { to: '/workspace', label: 'Workspace', icon: 'folderOpen', roles: ['project_manager', 'author'] },
  { to: '/projects', label: 'Projects', icon: 'projects' },
  { to: '/graphics', label: 'Graphics', icon: 'image' },
  { to: '/cir', label: 'CIR', icon: 'library' },
  { to: '/backup', label: 'Backup', icon: 'download' },
  { to: '/activity', label: 'Activity', icon: 'activity', roles: ['admin', 'project_manager'] },
  { to: '/administrator', label: 'Administrator', icon: 'shield', roles: ['admin'] },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];
// Notifications is not in the sidebar: the bell in the top bar opens it.
const TITLES: Record<string, string> = { '/notifications': 'Notifications' };
const NAV_REUSE_MS = 30_000;

export function AppShell() {
  const { user, pendingInvitations, adminQueues, logout, load } = useSession();
  const unread = useInbox((s) => s.unread);
  const appName = useApp((s) => s.settings.appName);
  const loadApp = useApp((s) => s.load);
  const refreshCount = useInbox((s) => s.refreshCount);
  const loc = useLocation();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep the badges (invitations, queues, unread notifications) fresh as the user moves around, and every half minute.
  // WP-18 (FE-020): an answer from the last 30 s is enough here, so moving around does not ask who is signed in each time; any write the
  // person makes clears it (api/query.ts), the minute heartbeat and the half-minute count still reach the server.
  useEffect(() => { void load({ ttl: NAV_REUSE_MS }); void refreshCount({ ttl: NAV_REUSE_MS }); }, [loc.pathname, load, refreshCount]);
  useEffect(() => { void loadApp(); }, [loadApp]);
  useEffect(() => { const t = setInterval(() => void refreshCount(), 30_000); return () => clearInterval(t); }, [refreshCount]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const queued = adminQueues ? adminQueues.resets + adminQueues.releases : 0;
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  const current = items.find((n) => loc.pathname.startsWith(n.to));
  const title = current?.label ?? TITLES[loc.pathname] ?? appName;

  return (
    <div className="v2-shell">
      <aside className="v2-side" aria-label="Sidebar">
        <div className="v2-brand"><span className="v2-brand-mark"><Icon name="book" size={16} /></span><span className="v2-trunc">{appName}</span></div>
        <nav className="v2-nav" aria-label="Main navigation">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} title={n.label} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} />{n.label}
              {n.to === '/overview' && pendingInvitations > 0 ? <span className="v2-count" title="Pending project invitations">{pendingInvitations}</span> : null}
              {n.to === '/settings' && queued > 0 ? <span className="v2-count" title="Items waiting for an administrator">{queued}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="v2-side-foot"><div className="v2-hint" style={{ padding: '4px 8px' }}>Offline · on-premises</div></div>
      </aside>

      <div className="v2-main">
        <header className="v2-top">
          <h1>{title}</h1>
          <span className="spacer" />
          <ThemeToggle />
          <NavLink to="/notifications" className="icon-btn v2-bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications" data-testid="bell">
            <Icon name="bell" size={17} />
            {unread > 0 ? <span className="v2-count v2-bell-count" data-testid="unread-count">{unread > 99 ? '99+' : unread}</span> : null}
          </NavLink>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu" title="Account" data-testid="account-menu">
              <Icon name="user" size={20} />
            </button>
            {menu ? (
              <div className="v2-card" role="menu" style={{ position: 'absolute', right: 0, top: 38, width: 200, zIndex: 20, padding: 6, boxShadow: 'var(--shadow-2)' }}>
                <div style={{ padding: '4px 10px 6px' }}><span className="v2-hint">{globalLabel(user?.role)}</span></div>
                <div className="v2-nav" style={{ padding: 0 }}>
                  <button className="v2-navbtn" role="menuitem" onClick={() => { setMenu(false); nav('/settings'); }}><Icon name="settings" />Account settings</button>
                  <button className="v2-navbtn" role="menuitem" onClick={() => void logout()}><Icon name="logout" />Sign out</button>
                </div>
              </div>
            ) : null}
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

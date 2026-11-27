// The main dashboard frame. The navigation depends on the role:
//   administrator    Overview, Projects, Graphics, CIR, Backup, Activity, Administrator, Settings   (oversees; creates people, not projects)
//   project manager  Overview, Workspace, Projects, Graphics, CIR, Backup, Activity, Settings
//   author           Overview, Workspace, Projects, Graphics, CIR, Backup, Settings
// Notifications and the account menu sit together at the right of the top bar, icons only.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HeadingLevel, MAIN_ID, SkipLink, useDocumentTitle } from '../components/a11y';
import { Icon, type IconName } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../store/session';
import { useInbox } from '../store/inbox';
import { useApp } from '../store/appSettings';
import { globalLabel } from '../lib/roles';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { JumpButton, QuickSwitcher, useQuickSwitcher } from '../components/QuickSwitcher';

// WP-35 (group 2, mockup workspace.html): the same items, labels and order, in three groups (work, library, manage) with a heading each.
type Item = { to: string; label: string; icon: IconName; roles?: string[]; group: 'work' | 'library' | 'manage'; hint?: string };
const NAV: Item[] = [
  { to: '/overview', label: 'Overview', icon: 'dashboard', group: 'work' },
  { to: '/workspace', label: 'Workspace', icon: 'folderOpen', roles: ['project_manager', 'author'], group: 'work' },
  { to: '/projects', label: 'Projects', icon: 'projects', group: 'work' },
  { to: '/graphics', label: 'Graphics', icon: 'image', group: 'library' },
  { to: '/cir', label: 'CIR', icon: 'library', group: 'library', hint: 'Common information repository: shared data modules' },
  { to: '/backup', label: 'Backup', icon: 'download', group: 'manage' },
  { to: '/activity', label: 'Activity', icon: 'activity', roles: ['admin', 'project_manager'], group: 'manage' },
  { to: '/administrator', label: 'Administrator', icon: 'shield', roles: ['admin'], group: 'manage' },
  { to: '/settings', label: 'Settings', icon: 'settings', group: 'manage' },
];
const GROUP_HEAD: Record<Item['group'], string | null> = { work: null, library: 'Library', manage: 'Manage' };
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
  const switcher = useQuickSwitcher();          // WP-22 (UX-021): Ctrl+K, Jump to…

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
  useDocumentTitle(title, appName);

  // WP-23 (UX-005 d): the account menu behaves as a menu: opening it puts focus on the first item, Up/Down/Home/End move between the items,
  // Escape closes it and returns focus to the button, Tab closes it and moves on. Down on the closed button opens it.
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  useEffect(() => { if (menu) menuItems()[0]?.focus(); }, [menu]);
  const menuKeys = (e: ReactKeyboardEvent) => {
    if (!menu) { if (e.key === 'ArrowDown' && e.target === menuButton.current) { e.preventDefault(); setMenu(true); } return; }
    const items = menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); setMenu(false); menuButton.current?.focus(); }
    else if (e.key === 'Tab') setMenu(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1]?.focus(); }
  };

  return (
    <div className="v2-shell">
      <SkipLink />
      <aside className="v2-side" aria-label="Sidebar">
        <div className="v2-brand"><span className="v2-brand-mark"><Icon name="book" size={16} /></span><span className="v2-trunc">{appName}</span></div>
        <nav className="v2-nav" aria-label="Main navigation">
          {items.map((n, i) => [
            GROUP_HEAD[n.group] && items[i - 1]?.group !== n.group ? <div key={`h-${n.group}`} className="v2-nav-head" aria-hidden="true">{GROUP_HEAD[n.group]}</div> : null,
            <NavLink key={n.to} to={n.to} title={n.hint ?? n.label} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} />{n.label}
              {n.to === '/overview' && pendingInvitations > 0 ? <span className="v2-count" title="Pending project invitations">{pendingInvitations}</span> : null}
              {n.to === '/settings' && queued > 0 ? <span className="v2-count" title="Items waiting for an administrator">{queued}</span> : null}
            </NavLink>,
          ])}
        </nav>
        <div className="v2-side-foot"><div className="v2-hint v2-side-note">Offline · on-premises</div></div>
      </aside>

      <div className="v2-main">
        <header className="v2-top">
          <h1>{title}</h1>
          <span className="spacer" />
          <JumpButton onClick={() => switcher.setOpen(true)} />
          <ThemeToggle />
          <NavLink to="/notifications" className="icon-btn v2-bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications" data-testid="bell">
            <Icon name="bell" size={17} />
            {unread > 0 ? <span className="v2-count v2-bell-count" data-testid="unread-count">{unread > 99 ? '99+' : unread}</span> : null}
          </NavLink>
          <div ref={menuRef} className="v2-pop-anchor" onKeyDown={menuKeys}>
            <button ref={menuButton} className="icon-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu" title="Account" data-testid="account-menu">
              <Icon name="user" size={20} />
            </button>
            {menu ? (
              <div className="v2-card v2-acct-menu" role="menu" aria-label="Account">
                <div className="v2-acct-who"><strong className="v2-trunc">{user?.fullName || user?.username}</strong><span className="v2-hint">{globalLabel(user?.role)}</span></div>
                <div className="v2-nav v2-nav-flush">
                  <button className="v2-navbtn" role="menuitem" tabIndex={-1} onClick={() => { setMenu(false); nav('/settings'); }}><Icon name="settings" />Account settings</button>
                  <button className="v2-navbtn" role="menuitem" tabIndex={-1} onClick={() => void logout()}><Icon name="logout" />Sign out</button>
                </div>
              </div>
            ) : null}
          </div>
        </header>
        <main id={MAIN_ID} className="v2-main-region" tabIndex={-1}>
          <HeadingLevel level={2}><ErrorBoundary resetKey={loc.pathname} where="platform page"><Outlet /></ErrorBoundary></HeadingLevel>
        </main>
      </div>
      {switcher.open ? <QuickSwitcher pages={[...items.map((n) => ({ to: n.to, label: n.label })), { to: '/notifications', label: 'Notifications' }]} onClose={() => switcher.setOpen(false)} /> : null}
    </div>
  );
}

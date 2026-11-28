// The main dashboard frame, drawn as the owner-approved mockups' global shell (docs/audit/mockups/workspace.html, admin.html; UI redesign
// step 1): a full-width top bar (brand, breadcrumb, search/command trigger, notifications, theme switch, account) over a left
// navigation in groups, with the page beside it. The navigation depends on the role:
//   administrator    Overview, Projects, Graphics, CIR, Activity, Backup, Administrator   (oversees; creates people, not projects)
//   project manager  Overview, Workspace, Projects, Graphics, CIR, Activity, Backup
//   author           Overview, Workspace, Projects, Graphics, CIR, Backup
// Notifications and the account menu sit at the right of the top bar, icons only; the account menu names the role, never the person.
// Phase 3 (owner: no redundant options): Settings is reached from the account menu only (it was also a sidebar item), and the bars carry no
// "Offline · on-premises" / version / "Server connected" text and no offline icon; the version is in the account menu's "About Agastya".
// A server that stops answering still shows the connection banner (SessionDialogs.tsx, data-testid server-unreachable).

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { workspaceApi } from '../api';
import { HeadingLevel, MAIN_ID, SkipLink, useDocumentTitle } from '../components/a11y';
import { Icon, type IconName } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { AccountMenu } from '../components/AccountMenu';
import { useSession } from '../store/session';
import { useInbox } from '../store/inbox';
import { useApp } from '../store/appSettings';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { JumpButton, QuickSwitcher, useQuickSwitcher } from '../components/QuickSwitcher';

// The mockup's groups: the work pages without a heading, then Library, Operations and Platform. Items, labels and roles are the app's.
type Group = 'work' | 'library' | 'operations' | 'platform';
type Item = { to: string; label: string; icon: IconName; roles?: string[]; group: Group; hint?: string };
const NAV: Item[] = [
  { to: '/overview', label: 'Overview', icon: 'dashboard', group: 'work' },
  { to: '/workspace', label: 'Workspace', icon: 'folderOpen', roles: ['project_manager', 'author'], group: 'work' },
  { to: '/projects', label: 'Projects', icon: 'folder', group: 'work' },
  { to: '/graphics', label: 'Graphics', icon: 'image', group: 'library' },
  { to: '/cir', label: 'CIR', icon: 'book2', group: 'library', hint: 'Common information repository: shared data modules' },
  { to: '/activity', label: 'Activity', icon: 'activity', roles: ['admin', 'project_manager'], group: 'operations' },
  { to: '/backup', label: 'Backup', icon: 'archive', group: 'operations' },
  { to: '/administrator', label: 'Administrator', icon: 'shield', roles: ['admin'], group: 'platform' },
];
const GROUP_HEAD: Record<Group, string | null> = { work: null, library: 'Library', operations: 'Operations', platform: 'Platform' };
// Notifications is not in the sidebar: the bell in the top bar opens it. Settings is in the account menu.
const TITLES: Record<string, string> = { '/notifications': 'Notifications', '/settings': 'Settings' };
// The breadcrumb names the area the way the mockups do (admin.html: "Platform / Administration"); the navigation keeps its own label.
const CRUMB: Record<string, string> = { '/administrator': 'Administration' };
const NAV_REUSE_MS = 30_000;

export function AppShell() {
  const { user, pendingInvitations, adminQueues, load } = useSession();
  const unread = useInbox((s) => s.unread);
  const appName = useApp((s) => s.settings.appName);
  const loadApp = useApp((s) => s.load);
  const refreshCount = useInbox((s) => s.refreshCount);
  const loc = useLocation();
  const switcher = useQuickSwitcher();          // WP-22 (UX-021): Ctrl+K, Jump to…
  // the mockup's count beside Projects: how many projects this person can open (a one-row page in the background, reused for 30 s)
  const [projectCount, setProjectCount] = useState<number | null>(null);
  useEffect(() => { let live = true; workspaceApi.projectCount().then((n) => { if (live) setProjectCount(n); }).catch(() => undefined); return () => { live = false; }; }, [loc.pathname]);

  // Keep the badges (invitations, queues, unread notifications) fresh as the user moves around, and every half minute.
  // WP-18 (FE-020): an answer from the last 30 s is enough here, so moving around does not ask who is signed in each time; any write the
  // person makes clears it (api/query.ts), the minute heartbeat and the half-minute count still reach the server.
  useEffect(() => { void load({ ttl: NAV_REUSE_MS }); void refreshCount({ ttl: NAV_REUSE_MS }); }, [loc.pathname, load, refreshCount]);
  useEffect(() => { void loadApp(); }, [loadApp]);
  useEffect(() => { const t = setInterval(() => void refreshCount(), 30_000); return () => clearInterval(t); }, [refreshCount]);

  const queued = adminQueues ? adminQueues.resets + adminQueues.releases : 0;
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  const current = items.find((n) => loc.pathname.startsWith(n.to));
  const title = current?.label ?? TITLES[Object.keys(TITLES).find((k) => loc.pathname === k || loc.pathname.startsWith(`${k}/`)) ?? ''] ?? appName;
  const groupHead = current ? GROUP_HEAD[current.group] : null;
  const crumb = (current && CRUMB[current.to]) ?? title;
  useDocumentTitle(title, appName);

  return (
    <div className="app v2-shell" data-density="comfortable">
      <SkipLink />
      <header className="topbar v2-top" data-testid="global-topbar">
        <div className="brand v2-brand"><span className="brand-mark"><Icon name="book" size={20} /></span><span className="trunc brand-name">{appName}</span></div>
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="sep" aria-hidden="true">/</span>
          {groupHead ? <><Link to="/overview" className="crumb-group">{groupHead}</Link><span className="sep" aria-hidden="true">/</span></> : null}
          <h1 className="crumb-current trunc" aria-current="page">{crumb}</h1>
        </nav>
        <span className="grow" />
        <JumpButton onClick={() => switcher.setOpen(true)} />
        <NavLink to="/notifications" className="icon-btn v2-bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications" data-testid="bell">
          <Icon name="bell" />
          {unread > 0 ? <span className="v2-bell-count" data-testid="unread-count">{unread > 99 ? '99+' : unread}</span> : null}
        </NavLink>
        <ThemeToggle />
        <AccountMenu waiting={queued} />
      </header>

      <nav className="sidenav" aria-label="Main navigation">
        {items.map((n, i) => [
          GROUP_HEAD[n.group] && items[i - 1]?.group !== n.group ? <div key={`h-${n.group}`} className="nav-group" aria-hidden="true">{GROUP_HEAD[n.group]}</div> : null,
          <NavLink key={n.to} to={n.to} title={n.hint ?? n.label} className="nav-item">
            <Icon name={n.icon} /><span className="nav-label">{n.label}</span>
            {n.to === '/overview' && pendingInvitations > 0 ? <span className="count" title="Pending project invitations">{pendingInvitations}</span> : null}
            {n.to === '/projects' && projectCount !== null ? <span className="count" aria-hidden="true" title="Projects you can open" data-testid="nav-project-count">{projectCount}</span> : null}
          </NavLink>,
        ])}
      </nav>

      <main id={MAIN_ID} className="main v2-main-region" tabIndex={-1}>
        <HeadingLevel level={2}><ErrorBoundary resetKey={loc.pathname} where="platform page"><Outlet /></ErrorBoundary></HeadingLevel>
      </main>
      {switcher.open ? <QuickSwitcher pages={[...items.map((n) => ({ to: n.to, label: n.label })), { to: '/notifications', label: 'Notifications' }, { to: '/settings', label: 'Settings' }]} onClose={() => switcher.setOpen(false)} /> : null}
    </div>
  );
}

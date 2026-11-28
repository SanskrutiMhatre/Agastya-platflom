// The frame around one project, drawn as the owner-approved mockups' project shell (docs/audit/mockups/project.html, editor.html,
// publication.html, validation.html; UI redesign step 1): a slim activity bar on the left (the project's areas, icons only; names on hover
// and keyboard focus, or beside the icons when it is pinned open), a top bar with the breadcrumb (Projects / project / page), the page's own
// actions (shellSlots.tsx: <TopbarActions>), the command trigger, the theme switch and the account menu, and a status bar at the foot
// (<StatusItems>). Opening a project lands in the Editor, because that is where work happens (the owner's rule); the editors draw their own
// header and status bar (editors/host), so on the editor page the shell shows only the activity bar, in the compact density.

import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { JumpButton, QuickSwitcher, useQuickSwitcher } from '../components/QuickSwitcher';
import { contentApi, workspaceApi, type ProjectRole, type Summary } from '../api';
import { Icon } from '../components/Icon';
import { projectRailItems } from './projectRail';
import { Alert, Loading, errText } from '../components/ui';
import { MissingBrex } from '../components/MissingBrex';
import { may, type Can } from '../lib/roles';
import { MAIN_ID, SkipLink, useDocumentTitle } from '../components/a11y';
import { useApp } from '../store/appSettings';
import { useSession } from '../store/session';
import { ThemeToggle } from '../components/ThemeToggle';
import { AccountMenu } from '../components/AccountMenu';
import { formatLabel } from '../components/project';
import { ShellSlotsContext } from './shellSlots';

export interface ProjectCtx {
  id: string;
  summary: Summary;
  role: ProjectRole;
  /** What the signed-in person may do here, as the server computed it (WP-13, FE-019; lib/roles.ts). */
  can: Can;
  reload: () => void;
}
export const useProject = (): ProjectCtx => useOutletContext<ProjectCtx>();

/** Writing data modules and documents (the routes' dm.write capability), and building a PDF (publish.build): asked of the server's map. */
export const canWrite = (can: Can | null | undefined): boolean => may(can, 'dm.write');
export const canBuild = (can: Can | null | undefined): boolean => may(can, 'publish.build');

/**
 * FE-005: one shell per project. Keyed by the id, a move from one project to another (a link, Back, Forward) starts a fresh shell with no
 * summary, so no render ever pairs the new id with the previous project's summary (which mounted the wrong kind of editor for one render).
 */
export function ProjectShell() {
  const { id = '' } = useParams();
  return <ProjectShellFor key={id} id={id} />;
}

function ProjectShellFor({ id }: { id: string }) {
  const nav = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  // WP-22 (06 section 6.5): the rail can be pinned open with its names; and Ctrl+K jumps to a project, page or data module
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; } });
  const switcher = useQuickSwitcher();
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const [statusEl, setStatusEl] = useState<HTMLElement | null>(null);
  const unreachable = useSession((s) => s.unreachable);
  // the mockup's status bar starts with the PDF renderer's state ("Renderer ready")
  const [renderer, setRenderer] = useState<boolean | null>(null);
  useEffect(() => { let live = true; contentApi.rendererStatus(id).then((r) => { if (live) setRenderer(r.warm); }).catch(() => undefined); return () => { live = false; }; }, [id]);

  const load = useCallback(() => {
    // A reply for another project (the shell was replaced meanwhile) is ignored by the unmount; one for an older request of this one is
    // harmless, it is the same project.
    let live = true;
    workspaceApi.summary(id).then((s) => { if (live) { setSummary(s); setError(''); } }).catch((e) => { if (live) setError(errText(e)); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => load(), [load]);

  // WP-23 (UX-005, WCAG 2.4.2): "Publication · Project name · Agastya Platform"
  const loc = useLocation();
  const appName = useApp((st) => st.settings.appName);
  const section = summary ? projectRailItems(id, summary).find((i) => loc.pathname.startsWith(i.to))?.label : null;
  useDocumentTitle(section, summary?.project.name, appName);

  if (error) {
    return <main className="v2-page"><Alert tone="bad">{error === 'Not found.' ? 'This project does not exist, or you are not a member of it.' : error}</Alert><p><a href="/workspace" onClick={(e) => { e.preventDefault(); nav('/workspace'); }}>Back to the workspace</a></p></main>;
  }
  if (!summary) return <Loading />;

  const isCir = summary.project.type === 'CIR';
  const s1000d = (summary.project.format ?? 's1000d') === 's1000d';           // validation (schemas, BREX) belongs to S1000D only
  const items = projectRailItems(id, summary);                                // WP-34: the rail per project kind lives in projectRail.ts
  const settings = items.find((i) => i.to.endsWith('/settings'));
  const areas = items.filter((i) => i !== settings);

  const ctx: ProjectCtx = { id, summary, role: summary.role, can: (summary.project.can ?? {}) as Can, reload: load };
  // WP-22 (UX-007): every project page names the project. The editors carry it in their own header; the other pages get the shell's top bar
  // (Projects / project / page) with the quick switcher, so the editing area keeps all its height.
  const inEditor = /\/editor\/?$/.test(loc.pathname);
  const atHome = /\/home\/?$/.test(loc.pathname);
  const togglePin = () => setPinned((p) => { try { localStorage.setItem(PIN_KEY, p ? '0' : '1'); } catch { /* private mode */ } return !p; });
  const back = isCir ? { to: '/cir', label: 'Back to the repository', short: 'Repository' } : { to: '/workspace', label: 'Back to workspace', short: 'Workspace' };
  const railLink = (i: (typeof items)[number]) => (
    <NavLink key={i.to} to={i.to} className={({ isActive }) => `act-btn v2-rail-item${isActive ? ' active' : ''}`} data-tip={pinned ? undefined : i.label} aria-label={i.label}>
      <Icon name={i.icon} size={20} />
      {pinned ? <span className="v2-rail-label">{i.label}</span> : null}
      {i.badge ? <span className={`pip v2-rail-badge ${i.badge.tone}`}>{i.badge.text}</span> : null}
    </NavLink>
  );
  return (
    <ShellSlotsContext.Provider value={{ actions: actionsEl, status: statusEl }}>
      <div className={`app project v2-pshell${pinned ? ' rail-pinned' : ''}${inEditor ? ' in-editor' : ''}`} data-density={inEditor ? 'compact' : 'comfortable'}>
        <SkipLink />
        {inEditor ? null : (
          <header className="topbar" data-testid="project-bar">
            <Link to="/overview" className="brand" aria-label={`${appName} home`} title={`${appName} home`}><span className="brand-mark"><Icon name="book" size={20} /></span></Link>
            <nav className="crumbs" aria-label="Breadcrumb">
              {atHome ? <>
                <Link to={isCir ? '/cir' : '/projects'}>{isCir ? 'Repository' : 'Projects'}</Link>
                <span className="sep" aria-hidden="true">/</span>
                <strong className="v2-pbar-name trunc" data-testid="project-bar-name" title={`${summary.project.name} · your role: ${summary.role}`} aria-current="page">{summary.project.name}</strong>
              </> : <>
                <Link to={isCir ? 'editor' : 'home'} className="v2-pbar-name trunc" data-testid="project-bar-name" title={`${summary.project.name} · your role: ${summary.role}`}>{summary.project.name}</Link>
                {section ? <><span className="sep" aria-hidden="true">/</span><strong aria-current="page">{section}</strong></> : null}
              </>}
            </nav>
            <span className="grow" />
            <JumpButton compact onClick={() => switcher.setOpen(true)} />
            <span className="topbar-actions row" ref={setActionsEl} />
            <ThemeToggle />
            <AccountMenu railPin={{ pinned, toggle: togglePin }} />
          </header>
        )}
        <aside className={`activity v2-rail${pinned ? ' is-pinned' : ''}`} aria-label="Project navigation">
          <NavLink to={back.to} className="act-btn v2-rail-item v2-rail-back" data-tip={pinned ? undefined : back.label} aria-label={back.label}>
            <Icon name="back" size={18} />{pinned ? <span className="v2-rail-label">{back.short}</span> : null}
          </NavLink>
          <span className="act-sep" aria-hidden="true" />
          <nav className="v2-rail-nav" aria-label="Project sections">
            {areas.map(railLink)}
            <span className="spacer" aria-hidden="true" />
            {settings ? railLink(settings) : null}
          </nav>
        </aside>
        <main id={MAIN_ID} className="main v2-main" tabIndex={-1}>
          {s1000d ? <MissingBrex projectId={id} canCreate={canWrite(ctx.can)} /> : null}
          <ErrorBoundary resetKey={loc.pathname} where="project page"><Outlet context={ctx} /></ErrorBoundary>
        </main>
        {inEditor ? null : (
          <footer className="statusbar" data-testid="project-status-bar">
            <span className="page-status" ref={setStatusEl} />
            <span className="default-status">
              <span className="item"><span className={`dot ${unreachable ? 'danger' : renderer === false ? 'warning' : 'success'}`} />{unreachable ? 'Server not answering' : renderer === false ? 'Renderer starts with the first build' : 'Renderer ready'}</span>
              <span className="item">{formatLabel(summary.project)}</span>
              <span className="item">{summary.dataModules.total} data module{summary.dataModules.total === 1 ? '' : 's'}</span>
              <span className="grow" />
              <span className="item">Offline · on-premises</span>
            </span>
          </footer>
        )}
      </div>
      {switcher.open ? <QuickSwitcher pages={switcherPages} project={{ id, summary }} onClose={() => switcher.setOpen(false)} /> : null}
    </ShellSlotsContext.Provider>
  );
}

const PIN_KEY = 'agastya.rail.pinned';
/** The pages of the main navigation the switcher offers inside a project (the role filter is the server's: a page not allowed redirects). */
const switcherPages = [
  { to: '/overview', label: 'Overview' }, { to: '/workspace', label: 'Workspace' }, { to: '/projects', label: 'Projects' }, { to: '/graphics', label: 'Graphics' },
  { to: '/cir', label: 'CIR' }, { to: '/notifications', label: 'Notifications' }, { to: '/settings', label: 'Settings' },
];

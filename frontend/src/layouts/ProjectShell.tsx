// The frame around one project: a slim, icon-only rail (names appear on hover and on keyboard focus, or beside the icons when the rail is
// pinned open) with the project's areas. Opening a project lands in the Editor, because that is where work happens; WP-22 added the Project
// Home (first in the rail: the state of the manual and what is next), a breadcrumb bar with the project name on every page that is not an
// editor (the editors carry the name in their own header), the quick switcher (Ctrl+K) and an error boundary around the page.

import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { JumpButton, QuickSwitcher, useQuickSwitcher } from '../components/QuickSwitcher';
import { workspaceApi, type ProjectRole, type Summary } from '../api';
import { Icon } from '../components/Icon';
import { projectRailItems } from './projectRail';
import { Alert, Loading, errText } from '../components/ui';
import { MissingBrex } from '../components/MissingBrex';
import { may, type Can } from '../lib/roles';
import { MAIN_ID, SkipLink, useDocumentTitle } from '../components/a11y';
import { useApp } from '../store/appSettings';

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

  const ctx: ProjectCtx = { id, summary, role: summary.role, can: (summary.project.can ?? {}) as Can, reload: load };
  // WP-22 (UX-007): every project page names the project. The editors carry it in their own header; the other pages get a breadcrumb bar
  // (Projects / project / page) with the quick switcher, so the editing area keeps all its height.
  const inEditor = /\/editor\/?$/.test(loc.pathname);
  const togglePin = () => setPinned((p) => { try { localStorage.setItem(PIN_KEY, p ? '0' : '1'); } catch { /* private mode */ } return !p; });
  return (
    <div className={`v2-pshell${pinned ? ' rail-pinned' : ''}`}>
      <SkipLink />
      <aside className={`v2-rail${pinned ? ' is-pinned' : ''}`} aria-label="Project navigation">
        <NavLink to={isCir ? '/cir' : '/workspace'} className="v2-rail-item v2-rail-back" data-tip={pinned ? undefined : isCir ? 'Back to the repository' : 'Back to workspace'} aria-label={isCir ? 'Back to the repository' : 'Back to workspace'}><Icon name="back" size={18} />{pinned ? <span className="v2-rail-label">{isCir ? 'Repository' : 'Workspace'}</span> : null}</NavLink>
        <div className="v2-rail-project" data-tip={`${summary.project.name} · ${summary.role}`} aria-label={`Project ${summary.project.name}`}>
          {summary.project.name.trim().charAt(0).toUpperCase()}
        </div>
        <nav className="v2-rail-nav" aria-label="Project sections">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => `v2-rail-item ${isActive ? 'active' : ''}`} data-tip={pinned ? undefined : i.label} aria-label={i.label}>
              <Icon name={i.icon} size={20} />
              {pinned ? <span className="v2-rail-label">{i.label}</span> : null}
              {i.badge ? <span className={`v2-rail-badge ${i.badge.tone}`}>{i.badge.text}</span> : null}
            </NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <button type="button" className="v2-rail-item v2-rail-pin" onClick={togglePin} aria-pressed={pinned} data-testid="rail-pin"
          aria-label={pinned ? 'Show icons only' : 'Show the names beside the icons'} data-tip={pinned ? undefined : 'Show the names beside the icons'}>
          <Icon name={pinned ? 'collapse' : 'panel'} size={16} />{pinned ? <span className="v2-rail-label">Icons only</span> : null}
        </button>
      </aside>
      <main id={MAIN_ID} className="v2-main" style={{ minWidth: 0 }} tabIndex={-1}>
        {inEditor ? null : (
          <nav className="v2-pbar" aria-label="Breadcrumb" data-testid="project-bar">
            <ol>
              <li><Link to={isCir ? '/cir' : '/projects'}>{isCir ? 'Repository' : 'Projects'}</Link></li>
              <li><Link to={isCir ? 'editor' : 'home'} className="v2-pbar-name" data-testid="project-bar-name" title={summary.project.name}>{summary.project.name}</Link></li>
              {section ? <li aria-current="page">{section}</li> : null}
            </ol>
            <span className="spacer" />
            <JumpButton onClick={() => switcher.setOpen(true)} />
          </nav>
        )}
        {s1000d ? <MissingBrex projectId={id} canCreate={canWrite(ctx.can)} /> : null}
        <ErrorBoundary resetKey={loc.pathname} where="project page"><Outlet context={ctx} /></ErrorBoundary>
      </main>
      {switcher.open ? <QuickSwitcher pages={switcherPages} project={{ id, summary }} onClose={() => switcher.setOpen(false)} /> : null}
    </div>
  );
}

const PIN_KEY = 'agastya.rail.pinned';
/** The pages of the main navigation the switcher offers inside a project (the role filter is the server's: a page not allowed redirects). */
const switcherPages = [
  { to: '/overview', label: 'Overview' }, { to: '/workspace', label: 'Workspace' }, { to: '/projects', label: 'Projects' }, { to: '/graphics', label: 'Graphics' },
  { to: '/cir', label: 'CIR' }, { to: '/notifications', label: 'Notifications' }, { to: '/settings', label: 'Settings' },
];

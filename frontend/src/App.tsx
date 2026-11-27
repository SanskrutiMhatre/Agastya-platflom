import { Suspense, lazy, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useSession } from './store/session';
import { authApi } from './api';
import { Loading, Toasts } from './components/ui';
import { ReauthDialog, UnreachableBanner, VersionMismatchDialog } from './components/SessionDialogs';
import { runHandshake } from './lib/handshake';
import { AuthScreens } from './pages/AuthScreens';
import { AppShell } from './layouts/AppShell';
import { Overview } from './pages/Overview';
import { Workspace } from './pages/Workspace';
import { Projects } from './pages/Projects';
import { canMonitor } from './lib/roles';
import { ProjectShell } from './layouts/ProjectShell';

// WP-18 (FE-020): the sign-in screens, the shells and the pages a session starts on (Overview, Workspace, Projects, the
// project editor) are in the entry; every other page is its own chunk, fetched the first time it is opened.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Activity = page(() => import('./pages/Activity'), 'Activity');
const Settings = page(() => import('./pages/Settings'), 'Settings');
const Notifications = page(() => import('./pages/Notifications'), 'Notifications');
const PreviewWindow = page(() => import('./pages/PreviewWindow'), 'PreviewWindow');
const GraphicsPage = page(() => import('./pages/Graphics'), 'GraphicsPage');
const CirPage = page(() => import('./pages/Cir'), 'CirPage');
const BackupPage = page(() => import('./pages/BackupPage'), 'BackupPage');
const AdministratorPage = page(() => import('./pages/Administrator'), 'AdministratorPage');
const ProjectGraphicsPage = page(() => import('./pages/project/GraphicsPage'), 'ProjectGraphicsPage');
const ExploreRoute = page(() => import('./pages/project/ExploreRoute'), 'ExploreRoute');
const PublicationRoute = page(() => import('./pages/project/PublicationRoute'), 'PublicationRoute');
const ValidationPage = page(() => import('./pages/project/ValidationPage'), 'ValidationPage');
const ReleasePage = page(() => import('./pages/project/ReleasePage'), 'ReleasePage');
const AncillaryRoute = page(() => import('./pages/project/AncillaryRoute'), 'AncillaryRoute');
const ProjectSettingsPage = page(() => import('./pages/project/ProjectSettingsPage'), 'ProjectSettingsPage');
const lazyEl = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

// The editors (the S1000D Studio: CodeMirror, pdfmake, the schema engine; the JSS editor) are large and only this route needs them: EditorRoute loads the one that fits.
import { FocusTooltip } from './components/FocusTooltip';
import { EditorRoute } from './pages/project/EditorRoute';

export function App() {
  const status = useSession((s) => s.status);
  const load = useSession((s) => s.load);
  const user = useSession((s) => s.user);
  const unreachable = useSession((s) => s.unreachable);
  useEffect(() => { void load(); }, [load]);
  // WP-26: the version handshake, once per page load, beside the session check (it never delays it).
  useEffect(() => { void runHandshake(); }, []);

  // WP-03 / FE-003: on every page (the editors included), typing or clicking is reported as activity at most every four minutes, so a working
  // author is not signed out for being idle; and a background check every minute notices an ended session early, while the work is still
  // on the page (the re-login dialog then appears over it). The check is not activity.
  useEffect(() => {
    if (status !== 'authed') return;
    let last = Date.now();
    const onActivity = () => { const now = Date.now(); if (now - last < 240_000) return; last = now; void authApi.activity().catch(() => undefined); };
    const evs = ['keydown', 'pointerdown', 'wheel'] as const;
    for (const e of evs) window.addEventListener(e, onActivity, { capture: true, passive: true });
    const beat = setInterval(() => { if (!useSession.getState().reauth) void useSession.getState().check(); }, 60_000);
    return () => { for (const e of evs) window.removeEventListener(e, onActivity, { capture: true }); clearInterval(beat); };
  }, [status]);

  /*
    Everyone lands on their own dashboard after signing in. The browser keeps the address of whatever
    was open when the last person signed out (say /settings), and a fresh sign-in used to reopen it -
    so the address is reset whenever the signed-in state starts or ends. A page reload keeps its address.
  */
  const nav = useNavigate();
  const wasAuthed = useRef<boolean | null>(null);
  useEffect(() => {
    if (status === 'loading') return;
    const now = status === 'authed' || status === 'gated';
    if (wasAuthed.current !== null && wasAuthed.current !== now) nav('/overview', { replace: true });
    wasAuthed.current = now;
  }, [status, nav]);

  let body;
  if (status === 'loading') body = <Loading label={unreachable ? 'Waiting for the server…' : 'Starting…'} />;
  else if (status !== 'authed') body = <AuthScreens />;
  else body = (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="projects" element={<Projects />} />
        {canMonitor(user) ? <Route path="activity" element={lazyEl(<Activity />)} /> : null}
        <Route path="notifications" element={lazyEl(<Notifications />)} />
        <Route path="graphics" element={lazyEl(<GraphicsPage />)} />
        <Route path="cir" element={lazyEl(<CirPage />)} />
        <Route path="backup" element={lazyEl(<BackupPage />)} />
        {user?.role === 'admin' ? <Route path="administrator/*" element={lazyEl(<AdministratorPage />)} /> : null}
        <Route path="settings/*" element={lazyEl(<Settings />)} />
      </Route>
      <Route path="preview/:id/:mode" element={lazyEl(<PreviewWindow />)} />
      <Route path="projects/:id" element={<ProjectShell />}>
        <Route index element={<Navigate to="editor" replace />} />
        <Route path="editor" element={<EditorRoute />} />
        <Route path="explore" element={lazyEl(<ExploreRoute />)} />
        <Route path="publication" element={lazyEl(<PublicationRoute />)} />
        <Route path="validation" element={lazyEl(<ValidationPage />)} />
        <Route path="graphics" element={lazyEl(<ProjectGraphicsPage />)} />
        <Route path="ancillary" element={lazyEl(<AncillaryRoute />)} />
        <Route path="release" element={lazyEl(<ReleasePage />)} />
        <Route path="csdb" element={<Navigate to="../editor" replace />} />   {/* the Files (CSDB) page was removed; an old link lands in the editor */}
        <Route path="settings/*" element={lazyEl(<ProjectSettingsPage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
  return <>{body}{status === 'authed' ? <ReauthDialog /> : null}<UnreachableBanner /><VersionMismatchDialog /><Toasts /><FocusTooltip /></>;
}

import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useSession } from './store/session';
import { authApi } from './api';
import { Loading, Toasts } from './components/ui';
import { ReauthDialog, UnreachableBanner } from './components/SessionDialogs';
import { AuthScreens } from './pages/AuthScreens';
import { AppShell } from './layouts/AppShell';
import { Overview } from './pages/Overview';
import { Workspace } from './pages/Workspace';
import { Projects } from './pages/Projects';
import { Activity } from './pages/Activity';
import { canMonitor } from './lib/roles';
import { Settings } from './pages/Settings';
import { Notifications } from './pages/Notifications';
import { PreviewWindow } from './pages/PreviewWindow';
import { GraphicsPage } from './pages/Graphics';
import { CirPage } from './pages/Cir';
import { BackupPage } from './pages/BackupPage';
import { AdministratorPage } from './pages/Administrator';
import { ProjectGraphicsPage } from './pages/project/GraphicsPage';
import { ProjectShell } from './layouts/ProjectShell';
import { ExploreRoute } from './pages/project/ExploreRoute';
import { PublicationRoute } from './pages/project/PublicationRoute';
import { ValidationPage } from './pages/project/ValidationPage';
import { ReleasePage } from './pages/project/ReleasePage';
import { AncillaryRoute } from './pages/project/AncillaryRoute';
import { ProjectSettingsPage } from './pages/project/ProjectSettingsPage';

// The editors (the S1000D Studio: CodeMirror, pdfmake, the schema engine; the JSS editor) are large and only this route needs them: EditorRoute loads the one that fits.
import { EditorRoute } from './pages/project/EditorRoute';

export function App() {
  const status = useSession((s) => s.status);
  const load = useSession((s) => s.load);
  const user = useSession((s) => s.user);
  const unreachable = useSession((s) => s.unreachable);
  useEffect(() => { void load(); }, [load]);

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
        {canMonitor(user) ? <Route path="activity" element={<Activity />} /> : null}
        <Route path="notifications" element={<Notifications />} />
        <Route path="graphics" element={<GraphicsPage />} />
        <Route path="cir" element={<CirPage />} />
        <Route path="backup" element={<BackupPage />} />
        {user?.role === 'admin' ? <Route path="administrator/*" element={<AdministratorPage />} /> : null}
        <Route path="settings/*" element={<Settings />} />
      </Route>
      <Route path="preview/:id/:mode" element={<PreviewWindow />} />
      <Route path="projects/:id" element={<ProjectShell />}>
        <Route index element={<Navigate to="editor" replace />} />
        <Route path="editor" element={<EditorRoute />} />
        <Route path="explore" element={<ExploreRoute />} />
        <Route path="publication" element={<PublicationRoute />} />
        <Route path="validation" element={<ValidationPage />} />
        <Route path="graphics" element={<ProjectGraphicsPage />} />
        <Route path="ancillary" element={<AncillaryRoute />} />
        <Route path="release" element={<ReleasePage />} />
        <Route path="csdb" element={<Navigate to="../editor" replace />} />   {/* the Files (CSDB) page was removed; an old link lands in the editor */}
        <Route path="settings/*" element={<ProjectSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
  return <>{body}{status === 'authed' ? <ReauthDialog /> : null}<UnreachableBanner /><Toasts /></>;
}

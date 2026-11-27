// The frame around one project: a slim, icon-only rail (names appear on hover)
// with the project's areas - Editor first, because that is where work happens.
// There is no project "overview" page; opening a project lands in the Editor.

import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { workspaceApi, type ProjectRole, type Summary } from '../api';
import { Icon } from '../components/Icon';
import { projectRailItems } from './projectRail';
import { Alert, Loading, errText } from '../components/ui';
import { MissingBrex } from '../components/MissingBrex';
import { may, type Can } from '../lib/roles';

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

  const load = useCallback(() => {
    // A reply for another project (the shell was replaced meanwhile) is ignored by the unmount; one for an older request of this one is
    // harmless, it is the same project.
    let live = true;
    workspaceApi.summary(id).then((s) => { if (live) { setSummary(s); setError(''); } }).catch((e) => { if (live) setError(errText(e)); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => load(), [load]);

  if (error) {
    return <div className="v2-page"><Alert tone="bad">{error === 'Not found.' ? 'This project does not exist, or you are not a member of it.' : error}</Alert><p><a href="/workspace" onClick={(e) => { e.preventDefault(); nav('/workspace'); }}>Back to the workspace</a></p></div>;
  }
  if (!summary) return <Loading />;

  const isCir = summary.project.type === 'CIR';
  const s1000d = (summary.project.format ?? 's1000d') === 's1000d';           // validation (schemas, BREX) belongs to S1000D only
  const items = projectRailItems(id, summary);                                // WP-34: the rail per project kind lives in projectRail.ts

  const ctx: ProjectCtx = { id, summary, role: summary.role, can: (summary.project.can ?? {}) as Can, reload: load };
  return (
    <div className="v2-pshell">
      <aside className="v2-rail" aria-label="Project navigation">
        <NavLink to={isCir ? '/cir' : '/workspace'} className="v2-rail-item v2-rail-back" data-tip={isCir ? 'Back to the repository' : 'Back to workspace'} aria-label={isCir ? 'Back to the repository' : 'Back to workspace'}><Icon name="back" size={18} /></NavLink>
        <div className="v2-rail-project" data-tip={`${summary.project.name} · ${summary.role}`} aria-label={`Project ${summary.project.name}`}>
          {summary.project.name.trim().charAt(0).toUpperCase()}
        </div>
        <nav className="v2-rail-nav" aria-label="Project sections">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => `v2-rail-item ${isActive ? 'active' : ''}`} data-tip={i.label} aria-label={i.label}>
              <Icon name={i.icon} size={20} />
              {i.badge ? <span className={`v2-rail-badge ${i.badge.tone}`}>{i.badge.text}</span> : null}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="v2-main" style={{ minWidth: 0 }}>
        {s1000d ? <MissingBrex projectId={id} canCreate={canWrite(ctx.can)} /> : null}
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

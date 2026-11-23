// The frame around one project: a slim, icon-only rail (names appear on hover)
// with the project's areas - Editor first, because that is where work happens.
// There is no project "overview" page; opening a project lands in the Editor.

import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { workspaceApi, type ProjectRole, type Summary } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { Alert, Loading, errText } from '../components/ui';
import { MissingBrex } from '../components/MissingBrex';

export interface ProjectCtx {
  id: string;
  summary: Summary;
  role: ProjectRole;
  reload: () => void;
}
export const useProject = (): ProjectCtx => useOutletContext<ProjectCtx>();

export const canWrite = (role: ProjectRole): boolean => role === 'editor' || role === 'manager' || role === 'owner';
export const canBuild = (role: ProjectRole): boolean => role !== 'viewer';

interface Item { to: string; label: string; icon: IconName; badge?: { text: string; tone: 'bad' | 'warn' | 'ok' } | null }

export function ProjectShell() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    workspaceApi.summary(id).then((s) => { setSummary(s); setError(''); }).catch((e) => setError(errText(e)));
  }, [id]);
  useEffect(() => { setSummary(null); load(); }, [id, load]);

  if (error) {
    return <div className="v2-page"><Alert tone="bad">{error === 'Not found.' ? 'This project does not exist, or you are not a member of it.' : error}</Alert><p><a href="/workspace" onClick={(e) => { e.preventDefault(); nav('/workspace'); }}>Back to the workspace</a></p></div>;
  }
  if (!summary) return <Loading />;

  const v = summary.validation;
  const rel = summary.release;
  const isCir = summary.project.type === 'CIR';
  const jssDoc = summary.project.authoring === 'jss-xml';                      // a JSS document has no S1000D publication tree to explore
  const s1000d = (summary.project.format ?? 's1000d') === 's1000d';           // validation (schemas, BREX) and the CSDB belong to S1000D only
  const items: Item[] = isCir ? [
    { to: `/projects/${id}/editor`, label: 'Editor', icon: 'editor' },
    { to: `/projects/${id}/graphics`, label: 'Graphics', icon: 'image' },
  ] : [
    { to: `/projects/${id}/editor`, label: 'Editor', icon: 'editor' },
    ...(jssDoc ? [] : [{ to: `/projects/${id}/explore`, label: 'Explore', icon: 'explore' as const }]),
    { to: `/projects/${id}/publication`, label: 'Publication', icon: 'book' },
    { to: `/projects/${id}/graphics`, label: 'Graphics', icon: 'image' },
    ...(s1000d ? [
      { to: `/projects/${id}/validation`, label: 'Validation', icon: 'shield' as const, badge: v && v.error > 0 ? { text: String(v.error), tone: 'bad' as const } : null },
      { to: `/projects/${id}/csdb`, label: 'Files (CSDB)', icon: 'layers' as const },
    ] : []),
    { to: `/projects/${id}/release`, label: 'Release', icon: 'rocket', badge: rel?.pending ? { text: '!', tone: 'warn' } : rel?.released ? { text: `R${rel.number}`, tone: 'ok' } : null },
    { to: `/projects/${id}/settings`, label: 'Settings', icon: 'settings' },
  ];
  const tone = { bad: 'var(--danger)', warn: 'var(--warning)', ok: 'var(--success)' } as const;

  const ctx: ProjectCtx = { id, summary, role: summary.role, reload: load };
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
              {i.badge ? <span className="v2-rail-badge" style={{ background: tone[i.badge.tone] }}>{i.badge.text}</span> : null}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="v2-main" style={{ minWidth: 0 }}>
        {s1000d ? <MissingBrex projectId={id} canCreate={canWrite(summary.role)} /> : null}
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

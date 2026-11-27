// Shared building blocks of the Administrator and Project Manager dashboards.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKUP_URL, workspaceApi, type Oversight, type ReleaseStatus } from '../api';
import { actionLabel } from '../lib/activity';
import { globalLabel } from '../lib/roles';
import { Icon } from './Icon';
import { RowLink } from './a11y';
import { Badge, Empty, ago } from './ui';

const initials = (name: string) => name.split(/\s+/).map((p) => p.charAt(0)).slice(0, 2).join('').toUpperCase();
export const Avatar = ({ name }: { name: string }) => <span className="v2-avatar" aria-hidden="true">{initials(name)}</span>;

export const STATUS_LABEL: Record<ReleaseStatus, string> = { released: 'Released', pending: 'Awaiting approval', unreleased: 'Not released' };
export const StatusBadge = ({ status, stale }: { status: ReleaseStatus; stale?: boolean }) => (
  <Badge tone={status === 'released' ? 'ok' : status === 'pending' ? 'warn' : undefined}>{stale && status === 'unreleased' ? 'Changed since release' : STATUS_LABEL[status]}</Badge>
);

/** Downloads a ZIP of the projects this person can open (administrators: the whole platform). */
export function BackupButton({ label = 'Back up' }: { label?: string }) {
  return <a className="btn" href={BACKUP_URL} download data-testid="backup"><Icon name="download" />{label}</a>;
}

type Filter = 'all' | ReleaseStatus;

export function ProjectStatusTable({ projects, empty }: { projects: Oversight['projects']; empty?: string }) {
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const shown = useMemo(() => projects.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.name} ${p.folder} ${p.owners.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [projects, filter, q]);
  const count = (f: Filter) => (f === 'all' ? projects.length : projects.filter((p) => p.status === f).length);
  const open = (id: string) => { void workspaceApi.open(id).catch(() => undefined); nav(`/projects/${id}`); };
  return (
    <div className="v2-card" data-testid="project-status">
      <div className="v2-card-head v2-row v2-spread">
        <div className="v2-seg" role="group" aria-label="Release status">
          {(['all', 'released', 'pending', 'unreleased'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS_LABEL[f]} <span className="v2-hint">{count(f)}</span></button>
          ))}
        </div>
        <input className="v2-input" style={{ width: 200 }} placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
      </div>
      {shown.length === 0 ? <Empty title={projects.length ? 'No project matches' : empty ?? 'No projects yet'} /> : (
        <div className="v2-scroll-x"><table className="v2-table">
          <thead><tr><th>Project</th><th>Status</th><th>Owner</th><th>Data modules</th><th>People</th><th>Last activity</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => open(p.id)} data-testid="status-row">
              <td><strong><RowLink href={`/projects/${p.id}`} onOpen={() => open(p.id)}>{p.name}</RowLink></strong>{p.folder ? <div className="v2-hint">{p.folder}</div> : null}</td>
              <td><StatusBadge status={p.status} stale={p.changedSinceRelease} />{p.releaseNumber ? <span className="v2-hint"> R{p.releaseNumber}</span> : null}</td>
              <td>{p.owners[0] ?? <span className="v2-hint">-</span>}</td><td>{p.dataModules}</td><td>{p.members}</td><td>{p.lastActivityAt ? ago(p.lastActivityAt) : <span className="v2-hint">no activity</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function TeamTable({ team, showRole = false, empty }: { team: Oversight['team']; showRole?: boolean; empty?: ReactNodeLike }) {
  return (
    <div className="v2-card" data-testid="team-table">
      {team.length === 0 ? <Empty title="No people yet">{empty}</Empty> : (
        <div className="v2-scroll-x"><table className="v2-table">
          <thead><tr><th>Name</th>{showRole ? <th>Role</th> : null}<th>Projects</th><th>Edits (30 days)</th><th>Last active</th></tr></thead>
          <tbody>{team.map((t) => (
            <tr key={t.userId} data-testid="team-row">
              <td><span className="v2-row" style={{ gap: 10 }}><Avatar name={t.fullName} /><span><strong>{t.fullName}</strong> <span className="v2-hint">@{t.username}</span>{t.disabled ? <> <Badge tone="bad">Disabled</Badge></> : null}</span></span></td>
              {showRole ? <td>{globalLabel(t.role)}</td> : null}
              <td>{t.projects.length ? t.projects.map((p) => p.name).join(', ') : <span className="v2-hint">not on a project</span>}</td>
              <td>{t.edits}</td><td>{t.lastActiveAt ? ago(t.lastActiveAt) : <span className="v2-hint">never</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

type ReactNodeLike = import('react').ReactNode;

export function FeedList({ feed }: { feed: Oversight['feed'] }) {
  const nav = useNavigate();
  return (
    <div className="v2-card">
      {feed.length === 0 ? <Empty title="Nothing yet" /> : feed.map((a) => (
        <div key={a.id} className="v2-feed-item">
          <div className="v2-feed-line"><strong>{a.actor ?? 'system'}</strong> {actionLabel(a.action)}{a.projectName ? <> <a href={`/projects/${a.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${a.projectId}`); }}>{a.projectName}</a></> : null}</div>
          <div className="v2-hint">{ago(a.at)}</div>
        </div>
      ))}
    </div>
  );
}

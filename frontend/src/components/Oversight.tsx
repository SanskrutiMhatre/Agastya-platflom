// Shared building blocks of the dashboards (screen 1 of the owner-approved mockups, docs/audit/mockups/workspace.html; UI redesign step 1):
// the Projects card with its release-status filter, the team table, the recent-activity feed, the attention list and the System card.

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKUP_URL, platformApi, backupApi, workspaceApi, type Oversight, type ReleaseStatus } from '../api';
import { actionLabel } from '../lib/activity';
import { globalLabel } from '../lib/roles';
import { Icon, type IconName } from './Icon';
import { RowLink } from './a11y';
import { Card, Pill, ago, useAsync, initialsOf } from './ui';
import { useSession } from '../store/session';

export const Avatar = ({ name }: { name: string }) => <span className="avatar v2-avatar" aria-hidden="true">{initialsOf(name)}</span>;

export const STATUS_LABEL: Record<ReleaseStatus, string> = { released: 'Released', pending: 'Awaiting approval', unreleased: 'Not released' };
export const StatusBadge = ({ status, stale }: { status: ReleaseStatus; stale?: boolean }) => (
  <Pill tone={status === 'released' ? 'success' : status === 'pending' ? 'info' : 'warning'}>{stale && status === 'unreleased' ? 'Changed since release' : STATUS_LABEL[status]}</Pill>
);

/** Downloads a ZIP of the projects this person can open (administrators: the whole platform). */
export function BackupButton({ label = 'Back up' }: { label?: string }) {
  return <a className="btn" href={BACKUP_URL} download data-testid="backup"><Icon name="download" />{label}</a>;
}

type Filter = 'all' | ReleaseStatus;

/** The mockup's Projects card: title and search in the head, the status filter below, the table with avatar, status, size and activity. */
export function ProjectStatusTable({ projects, empty, title = 'Projects', actions }: { projects: Oversight['projects']; empty?: string; title?: string; actions?: ReactNode }) {
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const shown = useMemo(() => projects.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.name} ${p.folder} ${p.owners.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [projects, filter, q]);
  const count = (f: Filter) => (f === 'all' ? projects.length : projects.filter((p) => p.status === f).length);
  const open = (id: string) => { void workspaceApi.open(id).catch(() => undefined); nav(`/projects/${id}`); };
  return (
    <div data-testid="project-status"><Card title={title} icon="folder" flush
      actions={<><input className="input search" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />{actions}</>}>
      <div className="filters">
        <div className="seg" role="group" aria-label="Release status">
          {(['all', 'released', 'pending', 'unreleased'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS_LABEL[f]}<span className="n">{count(f)}</span></button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <div className="empty-state"><strong>{projects.length ? 'No project matches' : empty ?? 'No projects yet'}</strong></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Project</th><th>Status</th><th>Data modules</th><th>People</th><th>Updated</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => open(p.id)} data-testid="status-row">
              <td className="proj-cell">
                <span className="proj-link"><Avatar name={p.owners[0] ?? p.name} /><span className="proj-text">
                  <RowLink href={`/projects/${p.id}`} onOpen={() => open(p.id)}><span className="proj-name">{p.name}</span></RowLink>
                  <span className="faint">{[p.folder, p.owners[0]].filter(Boolean).join(' · ') || 'No folder'}</span>
                </span></span>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}><StatusBadge status={p.status} stale={p.changedSinceRelease} />{p.releaseNumber ? <span className="faint"> R{p.releaseNumber}</span> : null}</td>
              <td className="num">{p.dataModules}</td><td className="num">{p.members}</td>
              <td className="faint" style={{ whiteSpace: 'nowrap' }}>{p.lastActivityAt ? ago(p.lastActivityAt) : 'no activity'}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card></div>
  );
}

export function TeamTable({ team, showRole = false, empty, title = 'People', actions }: { team: Oversight['team']; showRole?: boolean; empty?: ReactNode; title?: string; actions?: ReactNode }) {
  return (
    <div data-testid="team-table"><Card title={title} icon="users" flush actions={actions}>
      {team.length === 0 ? <div className="empty-state"><strong>No people yet</strong>{empty ? <p className="muted">{empty}</p> : null}</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th>{showRole ? <th>Role</th> : null}<th>Projects</th><th>Edits (30 days)</th><th>Last active</th></tr></thead>
          <tbody>{team.map((t) => (
            <tr key={t.userId} data-testid="team-row">
              <td><span className="team-who"><Avatar name={t.fullName} /><span><strong>{t.fullName}</strong> <span className="faint">@{t.username}</span>{t.disabled ? <> <Pill tone="danger">Disabled</Pill></> : null}</span></span></td>
              {showRole ? <td>{globalLabel(t.role)}</td> : null}
              <td>{t.projects.length ? t.projects.map((p) => p.name).join(', ') : <span className="faint">not on a project</span>}</td>
              <td className="num">{t.edits}</td><td className="faint">{t.lastActiveAt ? ago(t.lastActiveAt) : 'never'}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Card></div>
  );
}

type FeedRow = { id: number | string; at: string; actor: string | null; action: string; projectId: string | null; projectName: string | null };

/** The mockup's "Recent activity" card: avatar, who, what, the project link, when. */
export function FeedList({ feed, actions }: { feed: FeedRow[]; actions?: ReactNode }) {
  const nav = useNavigate();
  return (
    <Card title="Recent activity" icon="activity" flush actions={actions} testId="recent-activity">
      {feed.length === 0 ? <p className="todo-empty muted">Nothing yet.</p> : (
        <ul className="feed">{feed.map((a) => (
          <li key={a.id} className="v2-feed-item">
            <span className="avatar" aria-hidden="true">{initialsOf(a.actor ?? 'system')}</span>
            <div><span className="who">{a.actor ?? 'system'}</span> {actionLabel(a.action)}{a.projectName ? <> <a href={`/projects/${a.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${a.projectId}`); }}>{a.projectName}</a></> : null}
              <div className="faint">{ago(a.at)}</div></div>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

export interface Todo { key: string; tone: 'danger' | 'info' | 'warning' | 'accent'; icon: IconName; title: ReactNode; detail?: ReactNode; actions?: ReactNode; testId?: string }

/** The mockup's "Needs your attention" card: what is waiting for this person (approvals, invitations, queues), each with its own action. */
export function AttentionList({ items }: { items: Todo[] }) {
  return (
    <Card title="Needs your attention" icon="flag" flush testId="attention" actions={items.length ? <Pill tone="danger">{items.length}</Pill> : <Pill tone="success">None</Pill>}>
      {items.length === 0 ? <p className="todo-empty muted">Nothing is waiting for you.</p> : (
        <ul className="todo">{items.map((t) => (
          <li key={t.key} className={t.tone} data-testid={t.testId}>
            <Icon name={t.icon} />
            <div><div className="t">{t.title}</div>{t.detail ? <div className="faint">{t.detail}</div> : null}{t.actions ? <div className="acts">{t.actions}</div> : null}</div>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

const VERSION = typeof __AGASTYA_CLIENT_VERSION__ === 'string' ? __AGASTYA_CLIENT_VERSION__ : '';

/** The mockup's "System" card. Everyone sees the server and the mode; an administrator also sees the last backup and the audit log state. */
export function SystemCard() {
  const role = useSession((s) => s.user?.role);
  const unreachable = useSession((s) => s.unreachable);
  const admin = role === 'admin';
  const backup = useAsync(() => (admin ? backupApi.status() : Promise.resolve(null)), [admin]);
  const health = useAsync(() => (admin ? platformApi.health() : Promise.resolve(null)), [admin]);
  const latest = backup.data?.latest ?? null;
  const auditFail = health.data?.audit?.failures ?? 0;
  const healthy = !unreachable && !(backup.data?.stale) && !auditFail;
  return (
    <Card title="System" icon="server" flush testId="system-health"
      actions={<Pill tone={healthy ? 'success' : 'warning'}><span className={`dot ${healthy ? 'success' : 'warning'}`} />{healthy ? 'Healthy' : 'Check'}</Pill>}>
      <ul className="health">
        <li><Icon name="server" /><span>Server</span><span className={`k${unreachable ? ' danger' : ''}`}>{unreachable ? 'not answering' : 'connected'}</span></li>
        <li><Icon name="offline" /><span>Network</span><span className="k">offline · on-premises</span></li>
        {admin ? <li><Icon name="archive" /><span>Last backup</span><span className={`k${backup.data?.stale ? ' warning' : ''}`}>{backup.loading && !backup.data ? '…' : latest ? ago(latest.createdAt) : 'none yet'}</span></li> : null}
        {admin ? <li><Icon name="database" /><span>Audit log</span><span className={`k${auditFail ? ' danger' : ''}`}>{health.loading && !health.data ? '…' : auditFail ? `${auditFail} write failure${auditFail === 1 ? '' : 's'}` : 'ok'}</span></li> : null}
        {VERSION ? <li><Icon name="cpu" /><span>Version</span><span className="k">v{VERSION}</span></li> : null}
      </ul>
    </Card>
  );
}

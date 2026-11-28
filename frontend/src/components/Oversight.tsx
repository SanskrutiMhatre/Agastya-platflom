// Shared building blocks of the dashboards (screen 1 of the owner-approved mockups, docs/audit/mockups/workspace.html; UI redesign step 1):
// the Projects card with its release-status filter, the team table, the recent-activity feed, the attention list and the System card.

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKUP_URL, platformApi, backupApi, workspaceApi, type Oversight, type ProjectCard, type ReleaseStatus } from '../api';
import { formatLabel } from './project';
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
const FILTER_LABEL: Record<Filter, string> = { all: 'All', released: 'Released', pending: 'Awaiting approval', unreleased: 'Not released' };

/** One row of the dashboard's Projects table (the administrator's and manager's oversight rows, or an author's recent projects). */
export interface DashProject {
  id: string; name: string; status: ReleaseStatus; stale?: boolean; releaseNumber?: number | null;
  /** the person whose initials the avatar shows (the owner) */ who: string;
  /** under the name: the format, the folder ... */ sub: string;
  dataModules: number; validation: { error: number; warn: number } | null; validates: boolean; updated: string | null;
  /** an extra badge after the name's sub line (an author's role on the project) */ extra?: ReactNode;
}

/** The mockup's validation cell: "N errors" (danger), "N warnings" (warning), "Clean" (success), or "Not checked". */
export function ValidationBadge({ v, validates }: { v: DashProject['validation']; validates: boolean }) {
  if (!validates) return <span className="faint" title="Schema and BREX validation is for S1000D projects">—</span>;
  if (!v) return <Pill>Not checked</Pill>;
  if (v.error) return <Pill tone="danger" icon="xcircle">{v.error} error{v.error === 1 ? '' : 's'}</Pill>;
  if (v.warn) return <Pill tone="warning" icon="warn">{v.warn} warning{v.warn === 1 ? '' : 's'}</Pill>;
  return <Pill tone="success" icon="ok">Clean</Pill>;
}

export const fromOversight = (p: Oversight['projects'][number]): DashProject => ({
  id: p.id, name: p.name, status: p.status, stale: p.changedSinceRelease, releaseNumber: p.releaseNumber, who: p.owners[0] ?? p.name,
  sub: [formatLabel({ format: (p.format ?? 's1000d') as ProjectCard['format'], domain: p.domain ?? null, manualType: p.manualType ?? null }), p.folder, p.members > 1 ? `${p.members} people` : ''].filter(Boolean).join(' · '),
  dataModules: p.dataModules, validation: p.validation ?? null, validates: (p.format ?? 's1000d') === 's1000d', updated: p.lastActivityAt,
});

/** The mockup's Projects card: title, search and the link to every project in the head, the status filter with its counts below, then the
 *  table (avatar and name with the format under it, status, data modules, validation, last activity). */
export function ProjectStatusTable({ projects, rows, empty, title = 'Projects', actions, mine = false }: {
  projects?: Oversight['projects']; rows?: DashProject[]; empty?: string; title?: string; actions?: ReactNode;
  /** an author's own recent projects (test hooks recent-projects / recent-row) rather than the oversight list (project-status / status-row) */ mine?: boolean;
}) {
  const nav = useNavigate();
  const all = useMemo(() => rows ?? (projects ?? []).map(fromOversight), [rows, projects]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const shown = useMemo(() => all.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.name} ${p.sub} ${p.who}`.toLowerCase().includes(q.toLowerCase()))), [all, filter, q]);
  const count = (f: Filter) => (f === 'all' ? all.length : all.filter((p) => p.status === f).length);
  const open = (id: string) => { void workspaceApi.open(id).catch(() => undefined); nav(`/projects/${id}`); };
  return (
    <Wrap mine={mine}><Card title={title} icon="folder" flush
      actions={<><input className="input search" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />{actions}</>}>
      <div className="filters">
        <div className="seg" role="group" aria-label="Release status">
          {(['all', 'released', 'pending', 'unreleased'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{FILTER_LABEL[f]} {count(f)}</button>
          ))}
        </div>
        <span className="grow" />
        <span className="faint">Sorted by last activity</span>
      </div>
      {shown.length === 0 ? <div className="empty-state"><strong>{all.length ? 'No project matches' : empty ?? 'No projects yet'}</strong></div> : (
        <div className="table-wrap"><table className="table proj">
          <thead><tr><th>Project</th><th>Status</th><th className="num">Data modules</th><th>Validation</th><th>Updated</th></tr></thead>
          <tbody>{shown.map((p) => (
            <Row key={p.id} mine={mine} onOpen={() => open(p.id)}>
              <td className="proj-cell">
                <span className="proj-link"><span className="avatar" aria-hidden="true" title={p.who}>{initialsOf(p.who)}</span><span className="proj-text">
                  <RowLink href={`/projects/${p.id}`} onOpen={() => open(p.id)}><span className="proj-name">{p.name}</span></RowLink>
                  <span className="faint">{p.sub}{p.extra}</span>
                </span></span>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}><StatusBadge status={p.status} stale={p.stale} />{p.releaseNumber ? <span className="faint"> R{p.releaseNumber}</span> : null}</td>
              <td className="num faint">{p.dataModules}</td>
              <td style={{ whiteSpace: 'nowrap' }}><ValidationBadge v={p.validation} validates={p.validates} /></td>
              <td className="faint" style={{ whiteSpace: 'nowrap' }}>{p.updated ? ago(p.updated) : 'no activity'}</td>
            </Row>))}</tbody>
        </table></div>
      )}
    </Card></Wrap>
  );
}
const Wrap = ({ mine, children }: { mine: boolean; children: ReactNode }) => (mine ? <div data-testid="recent-projects">{children}</div> : <div data-testid="project-status">{children}</div>);
const Row = ({ mine, onOpen, children }: { mine: boolean; onOpen: () => void; children: ReactNode }) => (mine
  ? <tr className="clickable" onClick={onOpen} data-testid="recent-row">{children}</tr>
  : <tr className="clickable" onClick={onOpen} data-testid="status-row">{children}</tr>);

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

type FeedRow = { id: number | string; at: string; actor: string | null; actorName?: string | null; action: string; projectId: string | null; projectName: string | null };

/** The mockup's "Recent activity" card: avatar, who (the full name), what, the project link, when. The newest `max` events (the mockup shows
 *  three); the rest is one click away (Full activity, the project's own timeline). */
export function FeedList({ feed, actions, max = 3 }: { feed: FeedRow[]; actions?: ReactNode; max?: number }) {
  const nav = useNavigate();
  return (
    <Card title="Recent activity" icon="activity" flush actions={actions} testId="recent-activity">
      {feed.length === 0 ? <p className="todo-empty muted">Nothing yet.</p> : (
        <ul className="feed">{feed.slice(0, max).map((a) => (
          <li key={a.id}>
            <span className="avatar" aria-hidden="true">{initialsOf(a.actorName || a.actor || 'system')}</span>
            <div><span className="who" title={a.actor ?? undefined}>{a.actorName || a.actor || 'system'}</span> {actionLabel(a.action)}{a.projectName ? <> <a href={`/projects/${a.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${a.projectId}`); }}>{a.projectName}</a></> : null}
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

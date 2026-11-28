// Overview: every role lands on their own dashboard, drawn as screen 1 of the owner-approved mockups (docs/audit/mockups/workspace.html;
// UI redesign step 1): a greeting with the page actions, four-to-six stat tiles, then a work column (Continue where you left off, Projects)
// beside a side column (Needs your attention, Recent activity, System).
//   administrator    platform-wide oversight: people, every project with its release status, activity
//   project manager  their team of Authors, their projects and release status, approvals waiting, activity
//   author           their projects, invitations and recent activity

import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { teamApi, workspaceApi, type Oversight, type ProjectCard } from '../api';
import { Icon } from '../components/Icon';
import { SampleMenu } from '../components/SampleButton';
import { AttentionList, BackupButton, FeedList, ProjectStatusTable, StatusBadge, SystemCard, TeamTable, type Todo } from '../components/Oversight';
import { CreateProjectModal, RoleBadge, formatLabel } from '../components/project';
import { Alert, Card, Loading, Pill, StatTile, ago, useAsync } from '../components/ui';
import { useHeadingLevel } from '../components/a11y';
import { isFeedNoise } from '../lib/activity';
import { useSession } from '../store/session';
import '../styles/pages/dashboard.css';   // UI redesign step 1: the dashboard's own parts load with this page

const firstName = (full?: string) => full?.split(' ')[0] ?? '';

/** The page head: the greeting (the page title), one sub line, the page's actions. */
function Head({ title, sub, actions }: { title: string; sub: ReactNode; actions: ReactNode }) {
  const H = useHeadingLevel() === 1 ? 'h1' : 'h2';
  return <div className="page-head"><div><H>{title}</H><p>{sub}</p></div><div className="row">{actions}</div></div>;
}

/** "Continue where you left off": the three most recently active projects, one click back into the work. */
function Resume({ items, all }: { items: Array<{ id: string; name: string; badges: ReactNode; code: string; when: string }>; all: string }) {
  const nav = useNavigate();
  if (items.length === 0) return null;
  const open = (id: string) => { void workspaceApi.open(id).catch(() => undefined); nav(`/projects/${id}`); };
  return (
    <Card title="Continue where you left off" icon="history" flush testId="resume" actions={<Link to={all}>All projects</Link>}>
      <div className="resume">
        {items.slice(0, 3).map((r) => (
          <a key={r.id} href={`/projects/${r.id}`} onClick={(e) => { e.preventDefault(); open(r.id); }} data-testid="resume-item">
            <span className="row">{r.badges}</span><span className="t">{r.name}</span><span className="c">{r.code}</span><span className="faint">{r.when}</span>
          </a>
        ))}
      </div>
    </Card>
  );
}

const byActivity = (ps: Oversight['projects']) => [...ps].sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? ''))).filter((p) => p.lastActivityAt);
const oversightResume = (ps: Oversight['projects']) => byActivity(ps).map((p) => ({
  id: p.id, name: p.name, badges: <><StatusBadge status={p.status} stale={p.changedSinceRelease} /></>,
  code: `${p.dataModules} data module${p.dataModules === 1 ? '' : 's'}${p.folder ? ` · ${p.folder}` : ''}`, when: `Active ${ago(p.lastActivityAt)}`,
}));
const cardResume = (ps: ProjectCard[]) => ps.map((p) => ({
  id: p.id, name: p.name, badges: <><Pill tone="accent">{formatLabel(p)}</Pill>{p.hasPdf ? <Pill tone="success">PDF built</Pill> : null}</>,
  code: `${p.dmCount} data module${p.dmCount === 1 ? '' : 's'}${p.folder ? ` · ${p.folder}` : ''}`, when: `Opened ${ago(p.lastOpened ?? p.updatedAt)}`,
}));

function AdminOverview() {
  const nav = useNavigate();
  const user = useSession((s) => s.user);
  const queues = useSession((s) => s.adminQueues);
  const o = useAsync(() => teamApi.oversight(), []);
  if (o.loading && !o.data) return <Loading />;
  if (o.error || !o.data) return <div className="v2-page"><Alert tone="bad">{o.error || 'Could not load the overview.'}</Alert></div>;
  const { counts: c } = o.data;
  const todo: Todo[] = [];
  if (queues?.resets) todo.push({ key: 'resets', tone: 'danger', icon: 'key', title: `${queues.resets} password reset request${queues.resets === 1 ? '' : 's'}`, detail: 'People waiting to sign in again', actions: <button className="btn sm" onClick={() => nav('/settings/users')}>Open users</button> });
  if (queues?.releases) todo.push({ key: 'releases', tone: 'info', icon: 'stamp', title: `${queues.releases} release request${queues.releases === 1 ? '' : 's'} without a manager`, detail: 'An administrator approves these', actions: <button className="btn sm" onClick={() => nav('/activity')}>Review</button> });
  if (queues?.ownerless) todo.push({ key: 'ownerless', tone: 'warning', icon: 'warn', title: `${queues.ownerless} project${queues.ownerless === 1 ? ' has' : 's have'} no owner`, actions: <button className="btn sm" onClick={() => nav('/administrator')}>Open Administrator</button> });
  if (c.pending) todo.push({ key: 'pending', tone: 'info', icon: 'clock', title: `${c.pending} project${c.pending === 1 ? '' : 's'} awaiting release approval` });
  return (
    <div className="v2-page dash">
      <Head title={`Welcome back, ${firstName(user?.fullName)}`} sub={<>Platform overview · {c.projects} project{c.projects === 1 ? '' : 's'}, {c.people} people</>}
        actions={<><BackupButton label="Back up platform" /><button className="btn primary btn-primary" onClick={() => nav('/settings/users')}><Icon name="invite" />Manage users</button></>} />
      <section className="kpis" aria-label="Summary">
        <StatTile value={c.projects} label="Projects" detail={`${c.managers} project manager${c.managers === 1 ? '' : 's'} · ${c.authors} author${c.authors === 1 ? '' : 's'}`} tone="muted" />
        <StatTile value={c.released} label="Released" detail={c.released ? 'approved and issued' : 'none yet'} tone={c.released ? 'success' : 'muted'} icon={c.released ? 'ok' : undefined} />
        <StatTile value={c.pending} label="Awaiting approval" detail={c.pending ? 'waiting for a manager' : 'nothing waiting'} tone={c.pending ? 'warning' : 'muted'} icon={c.pending ? 'clock' : undefined} />
        <StatTile value={c.unreleased} label="Not released" detail={`${c.edits} edit${c.edits === 1 ? '' : 's'} in ${c.days} days`} tone="muted" />
      </section>
      <div className="wk">
        <div className="stack">
          <Resume items={oversightResume(o.data.projects)} all="/projects" />
          <ProjectStatusTable projects={o.data.projects} empty="No projects on the platform yet." />
          <TeamTable team={o.data.team} showRole actions={<Link to="/activity">Full activity</Link>} />
        </div>
        <aside className="stack" aria-label="Attention and activity">
          <AttentionList items={todo} />
          <FeedList feed={o.data.feed} actions={<Link to="/activity">Full activity</Link>} />
          <SystemCard />
        </aside>
      </div>
    </div>
  );
}

function ManagerOverview() {
  const nav = useNavigate();
  const user = useSession((s) => s.user);
  const o = useAsync(() => teamApi.oversight(), []);
  const approvals = useAsync(() => teamApi.approvals(), []);
  const [creating, setCreating] = useState(false);
  if (o.loading && !o.data) return <Loading />;
  if (o.error || !o.data) return <div className="v2-page"><Alert tone="bad">{o.error || 'Could not load the overview.'}</Alert></div>;
  const { counts: c } = o.data;
  const folders = [...new Set(o.data.projects.map((p) => p.folder).filter(Boolean))];
  const waiting = approvals.data?.length ?? c.pending;
  const todo: Todo[] = (approvals.data ?? []).map((a) => ({
    key: a.id, tone: 'info' as const, icon: 'stamp' as const, testId: 'approval-item',
    title: <>Release requested{a.requestedBy ? <> by {a.requestedBy}</> : null}</>, detail: <>{a.projectName} · {ago(a.requestedAt)}</>,
    actions: <button className="btn sm primary btn-primary" onClick={() => nav('/activity')}>Review</button>,
  }));
  return (
    <div className="v2-page dash">
      <Head title={`Welcome back, ${firstName(user?.fullName)}`} sub={<>Your team and projects{waiting ? <> · {waiting} release request{waiting === 1 ? '' : 's'} waiting for you</> : null}</>}
        actions={<>
          <BackupButton label="Back up projects" />
          <button className="btn" onClick={() => nav('/settings/authors')}><Icon name="invite" />New author</button>
          <button className="btn primary btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>
        </>} />
      <section className="kpis" aria-label="Summary">
        <StatTile value={c.projects} label="Projects" detail={`${c.authors} author${c.authors === 1 ? '' : 's'} in your team`} tone="muted" />
        <StatTile value={waiting} label="Awaiting your approval" detail={waiting ? 'release requests' : 'nothing waiting'} tone={waiting ? 'warning' : 'muted'} icon={waiting ? 'clock' : undefined} />
        <StatTile value={c.released} label="Released" detail={c.released ? 'approved and issued' : 'none yet'} tone={c.released ? 'success' : 'muted'} icon={c.released ? 'ok' : undefined} />
        <StatTile value={c.unreleased} label="Not released" detail={`${c.edits} edit${c.edits === 1 ? '' : 's'} in ${c.days} days`} tone="muted" />
      </section>
      {approvals.data?.length ? (
        <div className="v2-alert accent v2-row v2-spread v2-gap-b">
          <span><Icon name="clock" /> <strong>{approvals.data.length}</strong> release request{approvals.data.length === 1 ? '' : 's'} waiting for you.</span>
          <button className="btn btn-sm btn-primary" onClick={() => nav('/activity')}>Review</button>
        </div>
      ) : null}
      <div className="wk">
        <div className="stack">
          <Resume items={oversightResume(o.data.projects)} all="/projects" />
          <ProjectStatusTable projects={o.data.projects} title="Projects and release status" empty="Create your first project." />
          <TeamTable team={o.data.team} title="My team" empty="Create an Author, then assign them to a project." />
        </div>
        <aside className="stack" aria-label="Attention and activity">
          <AttentionList items={todo} />
          <FeedList feed={o.data.feed} actions={<Link to="/activity">Full activity</Link>} />
          <SystemCard />
        </aside>
      </div>
      {creating ? <CreateProjectModal folders={folders} onClose={() => setCreating(false)} onCreated={(p) => nav(`/projects/${p.id}`)} /> : null}
    </div>
  );
}

function AuthorOverview() {
  const nav = useNavigate();
  const user = useSession((s) => s.user);
  const ov = useAsync(() => workspaceApi.overview(), []);
  const inv = useAsync(() => workspaceApi.invitations(), []);
  const [creating, setCreating] = useState(false);

  if (ov.loading && !ov.data) return <Loading />;
  if (ov.error || !ov.data) return <div className="v2-page"><Alert tone="bad">{ov.error || 'Could not load the overview.'}</Alert></div>;
  const { counts, recent } = ov.data;
  const activity = ov.data.activity.filter((a) => !isFeedNoise(a.action));        // WP-07 (UX-015): the author's own sign-ins are not news
  const answer = async (id: string, accept: boolean) => {
    if (accept) await workspaceApi.acceptInvitation(id); else await workspaceApi.declineInvitation(id);
    inv.reload(); ov.reload();
  };
  const todo: Todo[] = (inv.data ?? []).map((i) => ({
    key: i.id, tone: 'accent' as const, icon: 'invite' as const, testId: 'invitation',
    title: <><strong>{i.invitedBy ?? 'Someone'}</strong> invited you to <strong>{i.projectName}</strong> as {i.role}.</>,
    actions: <><button className="btn sm primary btn-primary" onClick={() => answer(i.id, true)}>Accept</button><button className="btn sm" onClick={() => answer(i.id, false)}>Decline</button></>,
  }));

  return (
    <div className="v2-page dash">
      <Head title={`Welcome back, ${firstName(user?.fullName)}`} sub={<>Your projects{todo.length ? <> · {todo.length} invitation{todo.length === 1 ? '' : 's'} waiting</> : null}</>}
        actions={<><SampleMenu /><BackupButton /><button className="btn" onClick={() => nav('/workspace')}><Icon name="folderOpen" />Workspace</button><button className="btn primary btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button></>} />
      <section className="kpis" aria-label="Summary">
        <StatTile value={counts.projects} label="Projects" detail={`in ${counts.folders} folder${counts.folders === 1 ? '' : 's'}`} tone="muted" />
        <StatTile value={counts.dataModules} label="Data modules" detail="across your projects" tone="muted" />
        <StatTile value={counts.published} label="Publications built" detail={counts.published ? 'PDF ready' : 'none yet'} tone={counts.published ? 'success' : 'muted'} icon={counts.published ? 'ok' : undefined} />
        <StatTile value={counts.folders} label="Folders" detail="in your workspace" tone="muted" />
      </section>
      <div className="wk">
        <div className="stack">
          <Resume items={cardResume(recent)} all="/projects" />
          <Card title="Recent projects" icon="folder" flush testId="recent-projects" actions={<Link to="/projects">All projects</Link>}>
            {recent.length === 0 ? <div className="empty-state"><strong>No projects yet</strong><p className="muted">Create your first project, or ask your Project Manager to assign you to one.</p></div> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Project</th><th>Your role</th><th>Data modules</th><th>Engine</th><th>Opened</th></tr></thead>
                <tbody>{recent.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => { void workspaceApi.open(p.id).catch(() => undefined); nav(`/projects/${p.id}`); }} data-testid="recent-row">
                    <td className="proj-cell"><span className="proj-link"><span className="avatar" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span><span className="proj-text">
                      <a href={`/projects/${p.id}`} onClick={(e) => e.preventDefault()}><span className="proj-name">{p.name}</span></a>
                      <span className="faint">{p.folder || 'No folder'}{p.hasPdf ? ' · PDF built' : ''}</span></span></span></td>
                    <td><RoleBadge role={p.role} /></td><td className="num">{p.dmCount}</td><td>{formatLabel(p)}</td>
                    <td className="faint" style={{ whiteSpace: 'nowrap' }}>{ago(p.lastOpened ?? p.updatedAt)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
        </div>
        <aside className="stack" aria-label="Attention and activity">
          <AttentionList items={todo} />
          <FeedList feed={activity} />
          <SystemCard />
        </aside>
      </div>
      {creating ? <CreateProjectModal folders={[]} onClose={() => setCreating(false)} onCreated={(p) => nav(`/projects/${p.id}`)} /> : null}
    </div>
  );
}

export function Overview() {
  const role = useSession((s) => s.user?.role);
  if (role === 'admin') return <AdminOverview />;
  if (role === 'project_manager') return <ManagerOverview />;
  return <AuthorOverview />;
}

// Overview: every role lands on their own dashboard.
//   administrator    platform-wide oversight: people, every project with its release status, activity
//   project manager  their team of Authors, their projects and release status, activity
//   author           their projects, invitations and recent activity

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { teamApi, workspaceApi } from '../api';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { SampleButton } from '../components/SampleButton';
import { BackupButton, FeedList, ProjectStatusTable, TeamTable } from '../components/Oversight';
import { CreateProjectModal, ProjectCardView } from '../components/project';
import { Alert, Empty, Loading, ago, useAsync } from '../components/ui';
import { actionLabel } from '../lib/activity';
import { useSession } from '../store/session';

const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section style={{ marginBottom: 22 }}><div className="v2-row v2-spread" style={{ marginBottom: 10 }}><h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>{action}</div>{children}</section>
);

function AdminOverview() {
  const nav = useNavigate();
  const user = useSession((s) => s.user);
  const o = useAsync(() => teamApi.oversight(), []);
  if (o.loading && !o.data) return <Loading />;
  if (o.error || !o.data) return <div className="v2-page"><Alert tone="bad">{o.error || 'Could not load the overview.'}</Alert></div>;
  const { counts: c } = o.data;
  return (
    <div className="v2-page">
      <PageHeader icon="dashboard" title={`Welcome back, ${user?.fullName.split(' ')[0]}`} sub="Platform overview"
        actions={<><BackupButton label="Back up platform" /><button className="btn btn-primary" onClick={() => nav('/settings/users')}><Icon name="invite" />Manage users</button></>}
        stats={[
          { label: 'Project Managers', value: c.managers }, { label: 'Authors', value: c.authors }, { label: 'Projects', value: c.projects },
          { label: 'Released', value: c.released, tone: 'ok' }, { label: 'Awaiting approval', value: c.pending, tone: c.pending ? 'warn' : undefined }, { label: 'Not released', value: c.unreleased },
        ]} />
      <Section title="Projects"><ProjectStatusTable projects={o.data.projects} empty="No projects on the platform yet." /></Section>
      <div className="v2-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <Section title="People" action={<a href="/activity" onClick={(e) => { e.preventDefault(); nav('/activity'); }}>Full activity</a>}><TeamTable team={o.data.team} showRole /></Section>
        <Section title="Recent activity"><FeedList feed={o.data.feed} /></Section>
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
  return (
    <div className="v2-page">
      <PageHeader icon="dashboard" title={`Welcome back, ${user?.fullName.split(' ')[0]}`} sub="Your team and projects"
        actions={<>
          <BackupButton label="Back up projects" />
          <button className="btn" onClick={() => nav('/settings/authors')}><Icon name="invite" />New author</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>
        </>}
        stats={[
          { label: 'Authors', value: c.authors }, { label: 'Projects', value: c.projects }, { label: 'Released', value: c.released, tone: 'ok' },
          { label: 'Awaiting your approval', value: approvals.data?.length ?? c.pending, tone: (approvals.data?.length ?? c.pending) ? 'warn' : undefined }, { label: 'Not released', value: c.unreleased },
        ]} />
      {approvals.data?.length ? (
        <div className="v2-alert accent v2-row v2-spread" style={{ background: 'var(--accent-soft)', color: 'var(--text)', marginBottom: 18 }}>
          <span><Icon name="clock" /> <strong>{approvals.data.length}</strong> release request{approvals.data.length === 1 ? '' : 's'} waiting for you.</span>
          <button className="btn btn-sm btn-primary" onClick={() => nav('/activity')}>Review</button>
        </div>
      ) : null}
      <div className="v2-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div>
          <Section title="My team"><TeamTable team={o.data.team} empty="Create an Author, then assign them to a project." /></Section>
          <Section title="Projects and release status"><ProjectStatusTable projects={o.data.projects} empty="Create your first project." /></Section>
        </div>
        <Section title="Recent activity"><FeedList feed={o.data.feed} /></Section>
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
  const { counts, recent, activity } = ov.data;
  const answer = async (id: string, accept: boolean) => {
    if (accept) await workspaceApi.acceptInvitation(id); else await workspaceApi.declineInvitation(id);
    inv.reload(); ov.reload();
  };

  return (
    <div className="v2-page">
      <PageHeader icon="dashboard" title={`Welcome back, ${user?.fullName.split(' ')[0]}`} sub="Your projects"
        actions={<><SampleButton /><SampleButton kind="jsg" /><SampleButton kind="jsg-ispl" /><BackupButton /><button className="btn" onClick={() => nav('/workspace')}><Icon name="folderOpen" />Workspace</button><button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button></>}
        stats={[{ label: 'Projects', value: counts.projects }, { label: 'Data modules', value: counts.dataModules }, { label: 'Publications built', value: counts.published }, { label: 'Folders', value: counts.folders }]} />

      {inv.data && inv.data.length > 0 ? (
        <div className="v2-stack" style={{ marginBottom: 18 }}>
          {inv.data.map((i) => (
            <div key={i.id} className="v2-alert accent v2-row v2-spread" style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}>
              <span><Icon name="invite" /> <strong>{i.invitedBy ?? 'Someone'}</strong> invited you to <strong>{i.projectName}</strong> as {i.role}.</span>
              <span className="v2-row"><button className="btn btn-sm btn-primary" onClick={() => answer(i.id, true)}>Accept</button><button className="btn btn-sm" onClick={() => answer(i.id, false)}>Decline</button></span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="v2-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <Section title="Recent projects">
          {recent.length === 0
            ? <div className="v2-card"><Empty title="No projects yet">Create your first project, or ask your Project Manager to assign you to one.</Empty></div>
            : <div className="v2-grid cols-2">{recent.map((p) => <ProjectCardView key={p.id} p={p} />)}</div>}
        </Section>
        <Section title="Recent activity">
          <div className="v2-card">
            {activity.length === 0 ? <Empty title="Nothing yet" /> : activity.map((a) => (
              <div key={a.id} style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13 }}><strong>{a.actor ?? 'system'}</strong> {actionLabel(a.action)}{a.projectName ? <> <a href={`/projects/${a.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${a.projectId}`); }}>{a.projectName}</a></> : null}</div>
                <div className="v2-hint">{ago(a.at)}</div>
              </div>
            ))}
          </div>
        </Section>
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

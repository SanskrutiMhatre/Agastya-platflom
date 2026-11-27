// Project settings: the project itself, the publishing configuration (Agastya V1's
// PublishSettings, reused), the team (who has access, and the activity of that team),
// and the danger zone.

import { formatLabel } from '../../components/project';
import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { teamApi, workspaceApi, type GlobalRole, type ProjectRole } from '../../api';
import { ActivityView } from '../../components/ActivityView';
import { ExportProjectButton } from '../../components/DocCodes';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, ConfirmModal, Field, Loading, errText, useAsync } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { PROJECT_LABEL, may } from '../../lib/roles';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { PublishSettings } from './reused/PublishSettings';
import { S1000dConfig } from './S1000dConfig';
import { tablistKeys } from '../../components/a11y';

const SHARE_ROLES: ProjectRole[] = ['viewer', 'reviewer', 'editor'];
const ROLE_HELP: Record<ProjectRole, string> = {
  viewer: 'Reads data modules, the publication and the PDF.',
  reviewer: 'Also validates, previews and builds the PDF.',
  editor: 'Also changes data modules and the publication, and requests releases.',
  manager: "Project Manager: assigns authors, approves releases, sees the team's activity.",
  owner: 'Owns the project: everything above, plus roles, the shared house template and deletion.',
};

function General() {
  const { id, can, summary, reload } = useProject();
  const toast = useUi((s) => s.toast);
  const ws = useAsync(() => workspaceApi.workspace(), []);
  const p = summary.project;
  const [name, setName] = useState(p.name);
  const [folder, setFolder] = useState(p.folder);
  const [auto, setAuto] = useState(p.autoAddToPublication !== false);
  const [side, setSide] = useState(p.sideText ?? { enabled: true, publisher: '', draftNote: true });
  const [logo, setLogo] = useState(p.headerLogo !== false);
  const [style, setStyle] = useState(p.templateRef);
  const [busy, setBusy] = useState(false);
  const owner = may(can, 'project.rename');   // the PATCH route's capability (owner)
  const dirty = name !== p.name || folder !== p.folder || auto !== (p.autoAddToPublication !== false) || JSON.stringify(side) !== JSON.stringify(p.sideText ?? { enabled: true, publisher: '', draftNote: true }) || logo !== (p.headerLogo !== false) || style !== p.templateRef;

  const save = async () => {
    setBusy(true);
    try { await workspaceApi.updateProject(id, { name, folder, autoAddToPublication: auto, ...(p.format === 's1000d' ? { sideText: side, headerLogo: logo } : {}), ...(style !== p.templateRef ? { templateRef: style } : {}) }); toast('Project updated', 'success'); reload(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="v2-stack" style={{ maxWidth: 620 }}>
      <div className="v2-card v2-card-pad v2-stack">
        <Field label="Project name"><input className="v2-input" value={name} disabled={!owner} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Folder" hint="Where this project is filed in the Workspace. Leave empty for no folder.">
          <input className="v2-input" list="v2-pfolders" value={folder} disabled={!owner} onChange={(e) => setFolder(e.target.value)} />
          <datalist id="v2-pfolders">{(ws.data?.folders ?? []).map((f) => <option key={f.key} value={f.name} />)}</datalist>
        </Field>
        <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={auto} disabled={!owner} onChange={(e) => setAuto(e.target.checked)} data-testid="auto-add" />Add new data modules to the publication automatically</label>
        {p.format === 's1000d' ? (
          <div className="v2-stack" style={{ gap: 6 }} data-testid="page-furniture">
            <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={logo} disabled={!owner} onChange={(e) => setLogo(e.target.checked)} data-testid="header-logo" />Print the logo in the page header</label>
            <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={side.enabled} disabled={!owner} onChange={(e) => setSide({ ...side, enabled: e.target.checked })} data-testid="side-text" />Print the side text in the left margin (publisher name, and a draft note until the publication is released)</label>
            {side.enabled ? <Field label="Publisher name in the side text" hint="Empty = the project's responsible partner company."><input className="v2-input" value={side.publisher} disabled={!owner} onChange={(e) => setSide({ ...side, publisher: e.target.value })} data-testid="side-publisher" /></Field> : null}
          </div>
        ) : null}
        {p.type === 'S1000D' && p.format !== 'jss' && p.format !== 'jsg' ? (
          <Field label="House style" hint="The page furniture of the PDF: the reference S1000D layout (logo and company line, margin marks, mirrored header and footer) is the default of every S1000D project. An older project made on the plain style can change to it here; its data and settings are not touched.">
            <select className="v2-select" value={style} disabled={!owner} onChange={(e) => setStyle(e.target.value)} data-testid="house-style">
              {[...new Set(['xignal-s1000d', 'default', p.templateRef])].map((r) => <option key={r} value={r}>{r === 'xignal-s1000d' ? 'S1000D reference layout (default)' : r === 'default' ? 'Plain style (older projects)' : r}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Manual type" hint="Chosen when the project was created."><div className="v2-input" style={{ display: 'flex', alignItems: 'center' }} data-testid="manual-type">{formatLabel(p)}</div></Field>
        {owner ? <div><button className="btn btn-primary" disabled={!dirty || busy || !name.trim()} onClick={save}>Save changes</button></div> : <div className="v2-hint">Only an owner can change these.</div>}
      </div>
      <div className="v2-card v2-card-pad v2-stack" data-testid="export-card">
        <h3 style={{ margin: 0 }}>Export this project</h3>
        <p className="v2-sub" style={{ margin: 0 }}>The whole project in one file (.jsspub.zip): its documents, pictures, settings, house style, logos and review comments. It works for a project made here and for one that was imported and edited. <strong>Import package</strong> brings it back as a new project, in the same format.</p>
        <div><ExportProjectButton id={id} small={false} label="Export project" /></div>
      </div>
      <div className="v2-card v2-card-pad">
        <table className="v2-table" style={{ fontSize: 12.5 }}><tbody>
          <tr><td className="v2-hint">Project id</td><td className="v2-mono">{id}</td></tr>
          <tr><td className="v2-hint">Type</td><td>{p.type}</td></tr>
          <tr><td className="v2-hint">House template</td><td>{p.templateRef}</td></tr>
          <tr><td className="v2-hint">Created</td><td>{new Date(p.createdAt).toLocaleString()}</td></tr>
          <tr><td className="v2-hint">Owners</td><td>{p.owners.join(', ') || '—'}</td></tr>
        </tbody></table>
      </div>
    </div>
  );
}

/** A username box that suggests matching accounts of one kind (authors, or Project Managers). */
function PersonPicker({ role, value, onChange, placeholder }: { role: GlobalRole; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [suggest, setSuggest] = useState<Array<{ username: string; fullName: string }>>([]);
  const id = `v2-pick-${role}`;
  return (
    <>
      <input className="v2-input" list={id} placeholder={placeholder} value={value} aria-label={placeholder}
        onChange={async (e) => { onChange(e.target.value); setSuggest(e.target.value.trim() ? await workspaceApi.searchUsers(e.target.value, role).catch(() => []) : []); }} />
      <datalist id={id}>{suggest.map((u) => <option key={u.username} value={u.username}>{u.fullName}</option>)}</datalist>
    </>
  );
}

function Team() {
  const { id, role, can } = useProject();
  const me = useSession((s) => s.user);
  const toast = useUi((s) => s.toast);
  const m = useAsync(() => workspaceApi.members(id), [id]);
  const [author, setAuthor] = useState('');
  const [authorRole, setAuthorRole] = useState<ProjectRole>('editor');
  const [manager, setManager] = useState('');
  const [remove, setRemove] = useState<{ userId: string; name: string } | null>(null);
  // FE-012: changing someone's access is confirmed first
  const [access, setAccess] = useState<{ userId: string; name: string; role: ProjectRole } | null>(null);
  const isOwner = role === 'owner' || me?.role === 'admin';
  const canManage = may(can, 'members.manage');

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); m.reload(); } catch (e) { toast(errText(e), 'error'); } };

  if (m.loading && !m.data) return <Loading />;
  if (m.error || !m.data) return <Alert tone="bad">{m.error}</Alert>;
  const rowRoles: ProjectRole[] = isOwner ? ['viewer', 'reviewer', 'editor', 'manager', 'owner'] : SHARE_ROLES;
  // A Project Manager cannot change an owner or another manager; only the owner can.
  const locked = (current: ProjectRole) => !canManage || (!isOwner && (current === 'owner' || current === 'manager'));

  return (
    <div className="v2-stack" style={{ maxWidth: 860 }}>
      <div className="v2-card" data-testid="team-members">
        <div className="v2-card-head"><span>People on this project <Badge>{m.data.members.length}</Badge></span></div>
        <table className="v2-table"><thead><tr><th>Person</th><th>Access</th><th /></tr></thead>
          <tbody>{m.data.members.map((x) => (
            <tr key={x.userId}>
              <td><strong>{x.fullName}</strong> <span className="v2-hint">@{x.username}</span>{x.disabled ? <> <Badge tone="bad">disabled</Badge></> : null}{x.userId === me?.id ? <> <Badge>you</Badge></> : null}</td>
              <td style={{ width: 210 }}>{locked(x.role)
                ? <Badge tone={x.role === 'owner' || x.role === 'manager' ? 'accent' : undefined}>{PROJECT_LABEL[x.role]}</Badge>
                : <select className="v2-select" value={x.role} aria-label={`Access of ${x.username}`} onChange={(e) => setAccess({ userId: x.userId, name: x.fullName, role: e.target.value as ProjectRole })}>{rowRoles.map((r) => <option key={r} value={r}>{PROJECT_LABEL[r]}</option>)}</select>}</td>
              <td style={{ width: 44, textAlign: 'right' }}>{!locked(x.role) ? <button className="icon-btn" aria-label={`Remove ${x.username}`} onClick={() => setRemove({ userId: x.userId, name: x.fullName })}><Icon name="trash" /></button> : null}</td>
            </tr>))}</tbody></table>
        {m.data.invitations.length ? (
          <><div className="v2-card-head" style={{ borderTop: '1px solid var(--border)' }}>Invitations waiting</div>
            <table className="v2-table"><tbody>{m.data.invitations.map((i) => (
              <tr key={i.id}><td><strong>{i.fullName}</strong> <span className="v2-hint">@{i.username}</span></td><td><Badge>{PROJECT_LABEL[i.role]}</Badge></td>
                <td style={{ textAlign: 'right' }}>{canManage ? <button className="btn btn-sm" onClick={() => act(() => workspaceApi.revokeInvite(id, i.id), 'Invitation withdrawn')}>Withdraw</button> : null}</td></tr>))}</tbody></table></>
        ) : null}
      </div>

      {canManage ? (
        <div className="v2-grid cols-2">
          <div className="v2-card v2-card-pad v2-stack">
            <h3 style={{ margin: 0 }}>Give an author access</h3>
            <p className="v2-sub" style={{ margin: 0 }}>They get access straight away. Authors only see projects they own or are given access to.</p>
            <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void act(async () => { await teamApi.assign(id, author.trim(), authorRole); setAuthor(''); }, 'Access given'); }}>
              <PersonPicker role="author" value={author} onChange={setAuthor} placeholder="Author's username" />
              <select className="v2-select" value={authorRole} onChange={(e) => setAuthorRole(e.target.value as ProjectRole)} aria-label="Access level">{SHARE_ROLES.map((r) => <option key={r} value={r}>{PROJECT_LABEL[r]}</option>)}</select>
              <div className="v2-hint">{ROLE_HELP[authorRole]}</div>
              <div><button className="btn btn-primary" disabled={!author.trim()} data-testid="assign-author"><Icon name="invite" />Give access</button></div>
            </form>
          </div>
          {isOwner ? (
            <div className="v2-card v2-card-pad v2-stack">
              <h3 style={{ margin: 0 }}>Add a Project Manager</h3>
              <p className="v2-sub" style={{ margin: 0 }}>A Project Manager reviews this project's work, assigns authors and approves release requests.</p>
              <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void act(async () => { await teamApi.assign(id, manager.trim(), 'manager'); setManager(''); }, 'Project Manager added'); }}>
                <PersonPicker role="project_manager" value={manager} onChange={setManager} placeholder="Project Manager's username" />
                <div className="v2-hint">{ROLE_HELP.manager}</div>
                <div><button className="btn btn-primary" disabled={!manager.trim()} data-testid="assign-manager"><Icon name="shield" />Add Project Manager</button></div>
              </form>
            </div>
          ) : null}
        </div>
      ) : <Alert>Only the project's owner or its Project Manager can change who has access.</Alert>}
      {access ? <ConfirmModal title={`Give ${access.name} ${PROJECT_LABEL[access.role]} access?`} confirmLabel="Change access" onClose={() => setAccess(null)} onConfirm={() => { const a = access; setAccess(null); void act(() => workspaceApi.setMemberRole(id, a.userId, a.role), 'Access changed'); }} body="The change applies at once." /> : null}
      {remove ? <ConfirmModal title={`Remove ${remove.name}?`} danger confirmLabel="Remove" onClose={() => setRemove(null)} body="They lose access to this project immediately." onConfirm={() => { const r = remove; setRemove(null); void act(() => workspaceApi.removeMember(id, r.userId), 'Removed from the project'); }} /> : null}
    </div>
  );
}

function ProjectActivity() {
  const { id } = useProject();
  const [days, setDays] = useState(7);
  const rep = useAsync(() => teamApi.projectActivity(id, days), [id, days]);
  if (rep.loading && !rep.data) return <Loading />;
  if (rep.error || !rep.data) return <Alert tone="bad">{rep.error}</Alert>;
  return (
    <div className="v2-stack">
      <div className="v2-row"><select className="v2-select" style={{ width: 160 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window"><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select><span className="v2-hint">Who is working on this project, from its audit log.</span></div>
      <ActivityView report={rep.data} single />
    </div>
  );
}

function Danger() {
  const { id, can, summary } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  if (!may(can, 'project.delete')) return <Alert>Only an owner can delete the project.</Alert>;
  const del = async () => {
    setBusy(true);
    try { await workspaceApi.deleteProject(id, summary.project.name); toast('Project deleted', 'success'); nav('/workspace'); }
    catch (e) { toast(errText(e), 'error'); setBusy(false); }
  };
  return (
    <div className="v2-card v2-card-pad v2-stack" style={{ maxWidth: 620, borderColor: 'var(--danger)' }}>
      <h3 style={{ margin: 0, color: 'var(--danger)' }}>Delete this project</h3>
      <p style={{ margin: 0 }}>Removes the project and all {summary.dataModules.total} data modules, its publication, settings and built PDFs from the server. This cannot be undone.</p>
      <Field label={`Type “${summary.project.name}” to confirm`}><input className="v2-input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirm project name" /></Field>
      <div><button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={typed !== summary.project.name || busy} onClick={del}>Delete project</button></div>
    </div>
  );
}

export function ProjectSettingsPage() {
  const { role, can, summary } = useProject();
  const me = useSession((s) => s.user);
  const manages = may(can, 'members.manage');
  const tabs = [
    { to: 'general', label: 'General' }, ...(summary.project.format === 's1000d' ? [{ to: 's1000d', label: 'S1000D' }] : []), { to: 'publishing', label: 'Publishing' }, { to: 'team', label: 'Team' },
    ...(manages ? [{ to: 'activity', label: 'Activity' }] : []), { to: 'danger', label: 'Danger zone' },
  ];
  return (
    <div className="v2-page">
      <PageHeader icon="settings" title="Project settings" sub="Everything about this project that is not authoring."
        stats={[{ label: 'Members', value: summary.members }, { label: 'Type', value: formatLabel(summary.project) }, { label: 'Your access', value: PROJECT_LABEL[role], tone: 'accent' }]} />
      <div className="v2-tabs" role="tablist" aria-label="Project settings sections" onKeyDown={tablistKeys}>{tabs.map((t) => <NavLink key={t.to} to={t.to} role="tab" className={({ isActive }) => `v2-tab ${isActive ? 'active' : ''}`} style={{ textDecoration: 'none' }}>{t.label}</NavLink>)}</div>
      <Routes>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<General />} />
        <Route path="s1000d" element={<S1000dConfig />} />
        <Route path="publishing" element={<>{!may(can, 'settings.write') ? <div style={{ marginBottom: 12 }}><Alert tone="warn">You have {role} access: settings are read-only.</Alert></div> : null}<PublishSettings /></>} />
        {/* the Brand pack tab and the second SNS tab were removed (2026-11-26): the reference logos are the default, and the project's SNS lives under S1000D > SNS; old links land there */}
        <Route path="brand" element={<Navigate to="../publishing" replace />} />
        <Route path="sns/*" element={<Navigate to="../s1000d" replace />} />
        <Route path="team" element={<Team />} />
        {manages ? <Route path="activity" element={<ProjectActivity />} /> : null}
        <Route path="members" element={<Navigate to="../team" replace />} />
        <Route path="danger" element={<Danger />} />
        <Route path="*" element={<Navigate to="general" replace />} />
      </Routes>
    </div>
  );
}

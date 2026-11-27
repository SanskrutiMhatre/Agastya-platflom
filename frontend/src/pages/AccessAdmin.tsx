// Central administration of access (audit WP-27: ENT-005, PLT-016, ENT-023).
//
//   DirectorySection     Administrator > Directory sign-on: whether the server signs people in against the directory (LDAPS, Mode B),
//                        the group-to-role mapping, the connection test and "Sync now" (offboarding). The connection itself is server
//                        configuration (AGASTYA_DIRECTORY_*), shown read-only.
//   GroupsSection        Administrator > Groups: named groups of people; a project can grant a role to a whole group.
//   ProjectAccessPanel   Project settings > Access: the project's group grants and its capability rules (allow or deny one action).
//
// Every decision is the server's (routes/access.ts, core/auth/authz.js): these screens only show and edit the records.

import { useState } from 'react';
import { accessApi, type AccessGroup, type ProjectRole } from '../api';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, errText, useAsync } from '../components/ui';
import '../styles/pages/admin.css';   // WP-35 second pass
import { PROJECT_LABEL } from '../lib/roles';
import { useUi } from '../store/ui';

const GLOBAL_ROLE_LABEL: Record<string, string> = { admin: 'Software administrator', project_manager: 'Project Manager', author: 'Author', auditor: 'Auditor (read-only)' };

export function DirectorySection() {
  const toast = useUi((s) => s.toast);
  const st = useAsync(() => accessApi.directory(), []);
  const groups = useAsync(() => accessApi.groups(), []);
  const [dn, setDn] = useState(''); const [role, setRole] = useState('author'); const [groupId, setGroupId] = useState('');
  const [probe, setProbe] = useState(''); const [busy, setBusy] = useState('');
  const run = async (key: string, fn: () => Promise<string>) => { setBusy(key); try { toast(await fn(), 'success'); st.reload(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); } };
  if (st.loading && !st.data) return <Loading />;
  if (!st.data) return <Alert tone="bad">{st.error}</Alert>;
  const d = st.data; const s = d.settings;
  return (
    <div className="v2-stack v2-maxw-900" data-testid="directory-admin">
      <div className="v2-admin-head"><h3>Directory sign-on</h3><p className="v2-sub">People sign in with their domain account; the directory groups they are in decide their role. Local accounts, and at least one local administrator, keep working when the directory cannot be reached.</p></div>
      {!d.configured ? (
        <Alert>Directory sign-on is not set up on this server. It is available on a network server (Mode B): the administrator sets AGASTYA_DIRECTORY_URL (ldaps://), the base DN, the service account and its password file, and the CA certificate. See the operations guide. Everyone signs in with a local account until then.</Alert>
      ) : (
        <div className="v2-card v2-card-pad">
          <table className="v2-table"><tbody>
            <tr><td className="v2-w-220">Directory servers</td><td className="v2-mono">{s?.urls.join(', ')}</td></tr>
            <tr><td>People are searched in</td><td className="v2-mono">{s?.baseDn} ({s?.loginAttribute}, {s?.userObjectClass})</td></tr>
            <tr><td>Nested groups</td><td>{s?.nestedGroups ? 'followed' : 'direct membership only'}</td></tr>
            <tr><td>Service account</td><td className="v2-mono">{s?.bindDn} {s?.bindPasswordFileReadable ? <Badge tone="ok">password file found</Badge> : <Badge tone="bad">password file missing</Badge>}</td></tr>
            <tr><td>CA certificate</td><td className="v2-mono">{s?.caFile ?? 'the system trust store'} {s?.caFile ? (s.caFileReadable ? <Badge tone="ok">found</Badge> : <Badge tone="bad">missing</Badge>) : null}</td></tr>
            <tr><td>Offboarding check</td><td>{s?.syncHours ? `every ${s.syncHours} h` : 'on demand only'}; last: {d.lastSync ? `${new Date(d.lastSync.at).toLocaleString()} - ${d.lastSync.failed ? `failed: ${d.lastSync.failed}` : `${d.lastSync.checked} checked, ${d.lastSync.offboarded} disabled, ${d.lastSync.updated} updated`}` : 'not yet'}</td></tr>
            <tr><td>Directory accounts</td><td>{d.directoryUsers}</td></tr>
          </tbody></table>
          <div className="v2-row v2-gap-8 v2-mt12">
            <input className="v2-input v2-w-220" placeholder="Find a user name (optional)" value={probe} onChange={(e) => setProbe(e.target.value)} aria-label="User name to look up" />
            <button className="btn" disabled={!!busy} onClick={() => void run('test', async () => { const r = await accessApi.testDirectory(probe || undefined); return `Connected to ${r.url} in ${r.ms} ms${r.found ? (r.found.dn ? `; found ${r.found.dn} in ${r.found.groups?.length ?? 0} groups` : '; not found') : ''}`; })} data-testid="directory-test">Test connection</button>
            <button className="btn" disabled={!!busy} onClick={() => void run('sync', async () => { const r = await accessApi.syncDirectory(); return r.failed ? `Nothing changed: ${r.failed}` : `${r.checked} checked, ${r.offboarded} disabled, ${r.updated} updated`; })} data-testid="directory-sync">Sync now</button>
          </div>
        </div>
      )}
      <div className="v2-card">
        <div className="v2-card-head"><span>Directory groups and what they give <Badge>{d.mappings.length}</Badge></span></div>
        {d.mappings.length === 0 ? <Empty title="No directory group is mapped">Nobody can sign in with a domain account until a group gives a role.</Empty> : (
          <table className="v2-table"><thead><tr><th>Directory group</th><th>Role</th><th>Local group</th><th /></tr></thead><tbody>
            {d.mappings.map((m) => (
              <tr key={m.id}><td className="v2-mono">{m.group_dn}</td><td>{m.global_role ? GLOBAL_ROLE_LABEL[m.global_role] ?? m.global_role : '-'}</td><td>{m.group_name ?? '-'}</td>
                <td className="v2-td-end"><button className="btn btn-sm" onClick={() => void run(`rm-${m.id}`, async () => { await accessApi.removeMapping(m.id); return 'Mapping removed'; })}>Remove</button></td></tr>))}
          </tbody></table>
        )}
        <div className="v2-card-pad v2-row wrap v2-gap-8">
          <input className="v2-input v2-grow-320" placeholder="CN=Agastya Authors,OU=Groups,DC=corp,DC=local" value={dn} onChange={(e) => setDn(e.target.value)} aria-label="Directory group (distinguished name)" />
          <select className="v2-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role it gives"><option value="">No role</option>{Object.entries(GLOBAL_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="v2-select" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Local group it feeds"><option value="">No local group</option>{(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
          <button className="btn btn-primary" disabled={!dn.trim() || !!busy} onClick={() => void run('map', async () => { await accessApi.addMapping({ groupDn: dn.trim(), globalRole: role || null, groupId: groupId || null }); setDn(''); return 'Mapping added'; })} data-testid="directory-map">Add</button>
        </div>
      </div>
    </div>
  );
}

export function GroupsSection() {
  const toast = useUi((s) => s.toast);
  const groups = useAsync(() => accessApi.groups(), []);
  const [open, setOpen] = useState<AccessGroup | null>(null);
  const [name, setName] = useState(''); const [deleting, setDeleting] = useState<AccessGroup | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); groups.reload(); } catch (e) { toast(errText(e), 'error'); } };
  if (groups.loading && !groups.data) return <Loading />;
  if (!groups.data) return <Alert tone="bad">{groups.error}</Alert>;
  return (
    <div className="v2-stack v2-maxw-900" data-testid="groups-admin">
      <div className="v2-admin-head"><h3>Groups</h3><p className="v2-sub">A project can give a role to a whole group (Project settings &gt; Access). A group mapped to a directory group is filled by the directory.</p></div>
      <div className="v2-row v2-gap-8">
        <input className="v2-input v2-w-260" placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New group name" />
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void act(async () => { await accessApi.createGroup({ name: name.trim() }); setName(''); }, 'Group created')}>Create group</button>
      </div>
      <div className="v2-card">
        {groups.data.length === 0 ? <Empty title="No groups yet" /> : (
          <table className="v2-table"><thead><tr><th>Group</th><th>Members</th><th /></tr></thead><tbody>
            {groups.data.map((g) => (
              <tr key={g.id}><td><strong>{g.name}</strong>{g.description ? <div className="v2-hint">{g.description}</div> : null}</td><td>{g.members ?? 0}</td>
                <td className="v2-td-end"><button className="btn btn-sm" onClick={() => setOpen(g)}>Members</button>{' '}<button className="btn btn-sm" onClick={() => setDeleting(g)}>Delete</button></td></tr>))}
          </tbody></table>
        )}
      </div>
      {open ? <GroupMembers group={open} onChanged={() => groups.reload()} onClose={() => setOpen(null)} /> : null}
      {deleting ? <ConfirmModal title={`Delete the group ${deleting.name}?`} danger confirmLabel="Delete group" body="Its members lose every project role given to the group, and the rules naming it are removed." onClose={() => setDeleting(null)} onConfirm={() => { const g = deleting; setDeleting(null); void act(() => accessApi.removeGroup(g.id), 'Group deleted'); }} /> : null}
    </div>
  );
}

function GroupMembers({ group, onChanged, onClose }: { group: AccessGroup; onChanged: () => void; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const m = useAsync(() => accessApi.members(group.id), [group.id]);
  const [username, setUsername] = useState('');
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); m.reload(); onChanged(); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <div className="v2-card v2-card-pad" data-testid="group-members">
      <div className="v2-row v2-spread"><h4 className="v2-m0">{group.name}</h4><button className="btn btn-sm" onClick={onClose}>Close</button></div>
      {m.loading && !m.data ? <Loading /> : (
        <table className="v2-table"><tbody>{(m.data ?? []).map((x) => (
          <tr key={x.user_id}><td>{x.full_name} <span className="v2-mono">@{x.username}</span></td><td>{x.source === 'directory' ? <Badge>from the directory</Badge> : null}{x.disabled_at ? <Badge tone="bad">disabled</Badge> : null}</td>
            <td className="v2-td-end">{x.source === 'local' ? <button className="btn btn-sm" onClick={() => void act(() => accessApi.removeMember(group.id, x.user_id), 'Removed')}>Remove</button> : null}</td></tr>))}</tbody></table>
      )}
      <div className="v2-row v2-gap-8 v2-mt8">
        <input className="v2-input v2-w-220" placeholder="User name" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="User name to add" />
        <button className="btn" disabled={!username.trim()} onClick={() => void act(async () => { await accessApi.addMember(group.id, username.trim()); setUsername(''); }, 'Added')}>Add</button>
      </div>
    </div>
  );
}

const RANK: Record<ProjectRole, number> = { viewer: 1, reviewer: 2, editor: 3, manager: 4, owner: 5 };

export function ProjectAccessPanel({ projectId }: { projectId: string }) {
  const toast = useUi((s) => s.toast);
  const a = useAsync(() => accessApi.project(projectId), [projectId]);
  const [grant, setGrant] = useState({ groupId: '', role: 'viewer' as ProjectRole });
  const [rule, setRule] = useState({ subjectType: 'user' as 'user' | 'group', subject: '', capability: '', effect: 'allow' as 'allow' | 'deny' });
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); a.reload(); } catch (e) { toast(errText(e), 'error'); } };
  if (a.loading && !a.data) return <Loading />;
  if (!a.data) return <Alert tone="bad">{a.error}</Alert>;
  const mine = RANK[a.data.yourRole ?? 'viewer'];
  const roles = (Object.keys(RANK) as ProjectRole[]).filter((r) => RANK[r] <= mine);
  return (
    <div className="v2-stack v2-maxw-900" data-testid="project-access">
      <div className="v2-card">
        <div className="v2-card-head"><span>Groups with access <Badge>{a.data.groupGrants.length}</Badge></span></div>
        {a.data.groupGrants.length === 0 ? <Empty title="No group has access">Everyone here is named on the Team tab or reaches the project through its folder.</Empty> : (
          <table className="v2-table"><tbody>{a.data.groupGrants.map((g) => (
            <tr key={g.groupId}><td><strong>{g.name}</strong></td><td>{PROJECT_LABEL[g.role]}</td>
              <td className="v2-td-end"><button className="btn btn-sm" disabled={RANK[g.role] > mine} onClick={() => void act(() => accessApi.revokeGroup(projectId, g.groupId), 'Group access removed')}>Remove</button></td></tr>))}</tbody></table>
        )}
        <div className="v2-card-pad v2-row v2-gap-8">
          <select className="v2-select" value={grant.groupId} onChange={(e) => setGrant({ ...grant, groupId: e.target.value })} aria-label="Group"><option value="">Choose a group</option>{a.data.groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members})</option>)}</select>
          <select className="v2-select" value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value as ProjectRole })} aria-label="Role for the group">{roles.map((r) => <option key={r} value={r}>{PROJECT_LABEL[r]}</option>)}</select>
          <button className="btn btn-primary" disabled={!grant.groupId} onClick={() => void act(() => accessApi.grantGroup(projectId, grant.groupId, grant.role), 'Group access given')}>Give access</button>
        </div>
      </div>
      <div className="v2-card">
        <div className="v2-card-head"><span>Exceptions for single actions <Badge>{a.data.rules.length}</Badge></span></div>
        <p className="v2-sub v2-card-pad v2-m0">Allow one action to someone whose role does not include it, or deny it to someone whose role does. A denial wins over everything except the owners and the software administrators.</p>
        {a.data.rules.length ? (
          <table className="v2-table"><thead><tr><th>Who</th><th>Action</th><th>Rule</th><th /></tr></thead><tbody>{a.data.rules.map((r) => (
            <tr key={r.id}><td>{r.subjectType === 'group' ? `Group ${r.subject}` : `@${r.subject}`}</td><td className="v2-mono">{r.capability}</td><td>{r.effect === 'deny' ? <Badge tone="bad">Denied</Badge> : <Badge tone="ok">Allowed</Badge>}</td>
              <td className="v2-td-end"><button className="btn btn-sm" onClick={() => void act(() => accessApi.removeRule(projectId, r.id), 'Rule removed')}>Remove</button></td></tr>))}</tbody></table>
        ) : null}
        <div className="v2-card-pad v2-row wrap v2-gap-8">
          <select className="v2-select" value={rule.subjectType} onChange={(e) => setRule({ ...rule, subjectType: e.target.value as 'user' | 'group', subject: '' })} aria-label="Person or group"><option value="user">Person</option><option value="group">Group</option></select>
          {rule.subjectType === 'user'
            ? <Field label="User name"><input className="v2-input v2-w-180" value={rule.subject} onChange={(e) => setRule({ ...rule, subject: e.target.value })} /></Field>
            : <select className="v2-select" value={rule.subject} onChange={(e) => setRule({ ...rule, subject: e.target.value })} aria-label="Group for the rule"><option value="">Choose a group</option>{a.data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
          <select className="v2-select" value={rule.capability} onChange={(e) => setRule({ ...rule, capability: e.target.value })} aria-label="Action"><option value="">Choose an action</option>{a.data.capabilities.map((c) => <option key={c.capability} value={c.capability}>{c.capability} ({PROJECT_LABEL[c.minRole]})</option>)}</select>
          <select className="v2-select" value={rule.effect} onChange={(e) => setRule({ ...rule, effect: e.target.value as 'allow' | 'deny' })} aria-label="Allow or deny"><option value="allow">Allow</option><option value="deny">Deny</option></select>
          <button className="btn btn-primary" disabled={!rule.subject || !rule.capability} onClick={() => void act(() => accessApi.addRule(projectId, { ...rule, subject: rule.subject.trim() }), 'Rule saved')}>Save rule</button>
        </div>
      </div>
    </div>
  );
}

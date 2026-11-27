// Platform settings. Everyone gets their account; administrators also get user
// management, the approval queues (password resets, release requests), active
// sessions and the audit log - all backed by the JSS Publisher admin routes.

import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { adminApi, authApi, teamApi, type GlobalRole, type User } from '../api';
import { globalLabel } from '../lib/roles';
import { Icon } from '../components/Icon';
import { ThemeChoiceControl } from '../components/ThemeToggle';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, Modal, ago, errText, fmtDate, useAsync } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { BackupButton } from '../components/Oversight';
import { actionLabel } from '../lib/activity';

function Account() {
  const { user, logout } = useSession();
  const toast = useUi((s) => s.toast);
  const [cur, setCur] = useState(''); const [p, setP] = useState(''); const [p2, setP2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const change = async () => {
    setErr('');
    if (p !== p2) return setErr('The new passwords do not match.');
    setBusy(true);
    try { await authApi.changePassword(cur, p); toast('Password changed. Other sessions were signed out.', 'success'); setCur(''); setP(''); setP2(''); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="v2-stack" style={{ maxWidth: 560 }}>
      <div className="v2-card v2-card-pad">
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        <div className="v2-stack">
          <Field label="Name"><input className="v2-input" value={user?.fullName ?? ''} readOnly /></Field>
          <Field label="Username"><input className="v2-input" value={user?.username ?? ''} readOnly /></Field>
          <div className="v2-row"><Badge tone={user?.role === 'author' ? undefined : 'accent'}>{globalLabel(user?.role)}</Badge></div>
        </div>
      </div>
      <div className="v2-card v2-card-pad">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void change(); }}>
          <Field label="Current password"><input className="v2-input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 15 characters (a few words make a good one), and not a common password or your name."><input className="v2-input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat new password"><input className="v2-input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
          {err ? <Alert tone="bad">{err}</Alert> : null}
          <div><button className="btn btn-primary" disabled={busy || !cur || !p}>Change password</button></div>
        </form>
      </div>
      <div className="v2-card v2-card-pad" data-testid="appearance">
        <h3 style={{ marginTop: 0 }}>Appearance</h3>
        <p className="v2-sub" style={{ marginTop: 0 }}>Theme on this computer. "Follow the system" uses your organisation's default, or else the Windows setting.</p>
        <ThemeChoiceControl />
      </div>
      <div><button className="btn" onClick={() => void logout()}><Icon name="logout" />Sign out</button></div>
    </div>
  );
}

function Backup() {
  const role = useSession((s) => s.user?.role);
  return (
    <div className="v2-card v2-card-pad" style={{ maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Backup</h3>
      <p className="v2-sub">{role === 'admin' ? 'Every project, the people and memberships, and the activity log, as one ZIP file.' : role === 'project_manager' ? 'Every project you can open, as one ZIP file.' : 'Every project you can open, as one ZIP file.'}</p>
      <BackupButton label={role === 'admin' ? 'Back up the platform' : 'Back up my projects'} />
    </div>
  );
}

function TempPassword({ title, name, password, onClose }: { title: string; name: string; password: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width={480} buttons={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p style={{ marginTop: 0 }}>Temporary password for <strong>{name}</strong>. It works for the first sign-in only.</p>
      <div className="v2-row"><input className="v2-input v2-mono" readOnly value={password} onFocus={(e) => e.currentTarget.select()} aria-label="Temporary password" /><button className="btn" onClick={() => void navigator.clipboard?.writeText(password)}><Icon name="copy" />Copy</button></div>
    </Modal>
  );
}

export function Users() {
  const me = useSession((s) => s.user);
  const toast = useUi((s) => s.toast);
  const users = useAsync(() => adminApi.users(), []);
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<{ title: string; name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ user: User; action: 'disable' | 'reset' } | null>(null);
  // FE-012: a role change takes effect at once (what the person may see and do), so it is confirmed first
  const [roleChange, setRoleChange] = useState<{ user: User; role: string } | null>(null);
  const ROLE_NAME: Record<string, string> = { author: 'Author', project_manager: 'Project Manager', admin: 'Software administrator' };

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); users.reload(); } catch (e) { toast(errText(e), 'error'); } };

  return (
    <>
      <div className="v2-row v2-spread" style={{ marginBottom: 14 }}>
        <span />
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="invite" />New user</button>
      </div>
      <div className="v2-card">
        {users.loading && !users.data ? <Loading /> : (
          <table className="v2-table">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>{(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td><strong>{u.fullName}</strong></td><td className="v2-mono">@{u.username}</td>
                <td>
                  <select className="v2-select" style={{ width: 190 }} value={u.role} disabled={u.id === me?.id} aria-label={`Role of ${u.username}`}
                    onChange={(e) => setRoleChange({ user: u, role: e.target.value })}>
                    <option value="author">Author</option><option value="project_manager">Project Manager</option><option value="admin">Software administrator</option>
                  </select>
                </td>
                <td>{u.disabled ? <Badge tone="bad">Disabled</Badge> : u.onboardingPending ? <Badge tone="warn">Awaiting first sign-in</Badge> : u.mustChangePassword ? <Badge tone="warn">Must change password</Badge> : <Badge tone="ok">Active</Badge>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => setConfirm({ user: u, action: 'reset' })}><Icon name="key" size={13} />Reset password</button>{' '}
                  {u.disabled
                    ? <button className="btn btn-sm" onClick={() => act(() => adminApi.enable(u.id), 'Account enabled')}>Enable</button>
                    : <button className="btn btn-sm" disabled={u.id === me?.id} onClick={() => setConfirm({ user: u, action: 'disable' })}>Disable</button>}
                </td>
              </tr>))}</tbody>
          </table>
        )}
      </div>

      {creating ? <CreateUser roles={[['author', 'Author'], ['project_manager', 'Project Manager']]} create={(b) => adminApi.createUser(b)} onClose={() => setCreating(false)} onCreated={(name, pw) => { setCreating(false); users.reload(); setTemp({ title: 'Account created', name, password: pw }); }} /> : null}
      {temp ? <TempPassword {...temp} onClose={() => setTemp(null)} /> : null}
      {roleChange ? <ConfirmModal title={`Make ${roleChange.user.fullName} a ${ROLE_NAME[roleChange.role] ?? roleChange.role}?`} confirmLabel="Change role" onClose={() => setRoleChange(null)} onConfirm={() => { const r = roleChange; setRoleChange(null); void act(() => adminApi.updateUser(r.user.id, { role: r.role }), 'Role updated'); }} body={<p>{roleChange.role === 'admin' ? 'A software administrator can manage every account, the settings and every project.' : roleChange.role === 'project_manager' ? 'A Project Manager can create projects and approve releases of the projects they manage.' : 'An author works only in the projects shared with them.'} The change applies at once; the audit log records it.</p>} /> : null}
      {confirm ? (
        <ConfirmModal title={confirm.action === 'reset' ? `Reset ${confirm.user.fullName}'s password?` : `Disable ${confirm.user.fullName}?`} danger={confirm.action === 'disable'}
          confirmLabel={confirm.action === 'reset' ? 'Reset password' : 'Disable account'} onClose={() => setConfirm(null)}
          body={confirm.action === 'reset' ? 'Their current password stops working, every session is signed out, and they must choose a new password at next sign-in.' : 'They are signed out immediately and cannot sign in again until you enable the account.'}
          onConfirm={async () => {
            const { user, action } = confirm; setConfirm(null);
            if (action === 'disable') await act(() => adminApi.disable(user.id), 'Account disabled');
            else { try { const r = await adminApi.reset(user.id); setTemp({ title: 'Password reset', name: user.fullName, password: r.tempPassword }); users.reload(); } catch (e) { toast(errText(e), 'error'); } }
          }} />
      ) : null}
    </>
  );
}

function CreateUser({ roles, create, onClose, onCreated }: { roles: Array<[GlobalRole, string]>; create: (b: { username: string; fullName: string; role: GlobalRole }) => Promise<{ user: User; tempPassword: string }>; onClose: () => void; onCreated: (name: string, pw: string) => void }) {
  const [fullName, setFullName] = useState(''); const [username, setUsername] = useState(''); const [role, setRole] = useState<GlobalRole>(roles[0][0]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const typed = useRef(false);                       // once the username is edited by hand, stop suggesting
  useEffect(() => {
    if (typed.current) return;
    if (!fullName.trim()) { setUsername(''); return; }
    const t = setTimeout(() => { teamApi.usernameFor(fullName).then((u) => { if (!typed.current) setUsername(u); }).catch(() => undefined); }, 200);
    return () => clearTimeout(t);
  }, [fullName]);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await create({ username, fullName, role }); onCreated(r.user.fullName, r.tempPassword); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="New user" onClose={onClose} width={440} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !fullName.trim() || !username.trim()} onClick={submit}>Create account</button></>}>
      <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); if (fullName.trim() && username.trim() && !busy) void submit(); }}>
        <Field label="Name"><input className="v2-input" autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Username"><input className="v2-input" value={username} onChange={(e) => { typed.current = true; setUsername(e.target.value.toLowerCase()); }} autoComplete="off" /></Field>
        {roles.length > 1 ? <Field label="Role"><select className="v2-select" value={role} onChange={(e) => setRole(e.target.value as GlobalRole)}>{roles.map(([r, label]) => <option key={r} value={r}>{label}</option>)}</select></Field> : null}
        {err ? <Alert tone="bad">{err}</Alert> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** A Project Manager's own people: create Authors and see everyone on their projects. */
function Authors() {
  const list = useAsync(() => teamApi.users(), []);
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  return (
    <>
      <div className="v2-row v2-spread" style={{ marginBottom: 14 }}>
        <span />
        <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-author"><Icon name="invite" />New author</button>
      </div>
      <div className="v2-card">
        {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No authors yet">Create your first Author, then assign them to a project.</Empty> : (
          <table className="v2-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created by</th></tr></thead>
            <tbody>{list.data.map((u) => (
              <tr key={u.id}><td><strong>{u.fullName}</strong></td><td className="v2-mono">@{u.username}</td><td>{globalLabel(u.role)}</td>
                <td>{u.disabled ? <Badge tone="bad">Disabled</Badge> : u.onboardingPending ? <Badge tone="warn">Awaiting first sign-in</Badge> : <Badge tone="ok">Active</Badge>}</td><td>{u.createdBy ?? '-'}</td></tr>))}</tbody></table>
        )}
      </div>
      {creating ? <CreateUser roles={[['author', 'Author']]} create={(b) => teamApi.createUser(b)} onClose={() => setCreating(false)} onCreated={(name, pw) => { setCreating(false); list.reload(); setTemp({ name, password: pw }); }} /> : null}
      {temp ? <TempPassword title="Author account created" name={temp.name} password={temp.password} onClose={() => setTemp(null)} /> : null}
    </>
  );
}

function Approvals() {
  const toast = useUi((s) => s.toast);
  const releases = useAsync(() => adminApi.releases(), []);
  const resets = useAsync(() => adminApi.resets(), []);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string, reload: () => void) => { try { await fn(); toast(ok, 'success'); reload(); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <div className="v2-stack">
      <div className="v2-card">
        <div className="v2-card-head">Release requests</div>
        {releases.loading && !releases.data ? <Loading /> : !releases.data?.length ? <Empty title="No release requests waiting" /> : (
          <table className="v2-table"><thead><tr><th>Project</th><th>Requested by</th><th>Takes effect</th><th>Note</th><th /></tr></thead>
            <tbody>{releases.data.map((r) => (
              <tr key={r.id}><td><strong>{r.projectName}</strong></td><td>{r.requestedBy ?? '—'}</td><td>{fmtDate(r.scheduledAt)}</td><td>{r.note ?? ''}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-primary" onClick={() => run(() => adminApi.approveRelease(r.id), 'Release approved', releases.reload)}>Approve</button>{' '}
                  <button className="btn btn-sm" onClick={() => run(() => adminApi.rejectRelease(r.id), 'Release rejected', releases.reload)}>Reject</button></td></tr>))}</tbody></table>
        )}
      </div>
      <div className="v2-card">
        <div className="v2-card-head">Password reset requests</div>
        {resets.loading && !resets.data ? <Loading /> : !resets.data?.length ? <Empty title="No reset requests waiting" /> : (
          <table className="v2-table"><thead><tr><th>Person</th><th>Requested</th><th /></tr></thead>
            <tbody>{resets.data.map((r) => (
              <tr key={r.id}><td><strong>{r.fullName}</strong> <span className="v2-hint">@{r.username}</span></td><td>{ago(r.requestedAt)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-primary" onClick={async () => { try { const x = await adminApi.approveReset(r.id); setTemp({ name: r.fullName, password: x.tempPassword }); resets.reload(); } catch (e) { toast(errText(e), 'error'); } }}>Approve</button>{' '}
                  <button className="btn btn-sm" onClick={() => run(() => adminApi.rejectReset(r.id), 'Request rejected', resets.reload)}>Reject</button></td></tr>))}</tbody></table>
        )}
      </div>
      {temp ? <TempPassword title="Password reset" name={temp.name} password={temp.password} onClose={() => setTemp(null)} /> : null}
    </div>
  );
}

function Sessions() {
  const toast = useUi((s) => s.toast);
  const s = useAsync(() => adminApi.sessions(), []);
  return (
    <div className="v2-card">
      {s.loading && !s.data ? <Loading /> : (
        <table className="v2-table"><thead><tr><th>User</th><th>Signed in</th><th>Last seen</th><th>From</th><th /></tr></thead>
          <tbody>{(s.data ?? []).map((x) => (
            <tr key={x.id}><td><strong>{x.fullName}</strong> <span className="v2-hint">@{x.username}</span></td><td>{fmtDate(x.createdAt)}</td><td>{ago(x.lastSeenAt)}</td><td className="v2-mono">{x.ip ?? ''}</td>
              <td style={{ textAlign: 'right' }}><button className="btn btn-sm" onClick={async () => { try { await adminApi.revokeSession(x.id); toast('Session ended', 'success'); s.reload(); } catch (e) { toast(errText(e), 'error'); } }}>End session</button></td></tr>))}</tbody></table>
      )}
    </div>
  );
}

export function Audit() {
  const [filter, setFilter] = useState('');
  const a = useAsync(() => adminApi.audit(300, filter || undefined), [filter]);
  return (
    <div className="v2-stack">
      <div className="v2-row"><input className="v2-input" style={{ width: 280 }} placeholder="Filter by action, e.g. release.approved" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter audit log by action" /><button className="btn" onClick={a.reload}><Icon name="refresh" />Refresh</button></div>
      <div className="v2-card">
        {a.loading && !a.data ? <Loading /> : !a.data?.length ? <Empty title="No entries" /> : (
          <table className="v2-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Project</th><th>From</th></tr></thead>
            <tbody>{a.data.map((e) => <tr key={e.id}><td title={fmtDate(e.at)}>{ago(e.at)}</td><td>{e.actor ?? '—'}</td><td title={e.action}>{actionLabel(e.action)} <span className="v2-hint v2-mono">{e.action}</span></td><td className="v2-mono">{e.projectId ?? ''}</td><td className="v2-mono">{e.ip ?? ''}</td></tr>)}</tbody></table>
        )}
      </div>
    </div>
  );
}

export function Settings() {
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  const queues = useSession((s) => s.adminQueues);
  const waiting = queues ? queues.resets + queues.releases : 0;
  const isManager = useSession((s) => s.user?.role === 'project_manager');
  const tabs = [
    { to: '/settings/account', label: 'Account', admin: false },
    ...(isManager ? [{ to: '/settings/authors', label: 'Authors', admin: false }] : []),
    { to: '/settings/backup', label: 'Backup', admin: false },
    { to: '/settings/users', label: 'Users', admin: true },
    { to: '/settings/approvals', label: `Approvals${waiting ? ` (${waiting})` : ''}`, admin: true },
    { to: '/settings/sessions', label: 'Sessions', admin: true },
    { to: '/settings/audit', label: 'Audit log', admin: true },
  ].filter((t) => isAdmin || !t.admin);

  return (
    <div className="v2-page">
      <div className="v2-page-head"><div><h2>Settings</h2><p className="v2-sub">{isAdmin ? 'Account, people and platform administration.' : isManager ? 'Your account and your authors.' : 'Your account and preferences.'}</p></div></div>
      <div className="v2-tabs" role="tablist">
        {tabs.map((t) => <NavLink key={t.to} to={t.to} className={({ isActive }) => `v2-tab ${isActive ? 'active' : ''}`} role="tab" style={{ textDecoration: 'none' }}>{t.label}</NavLink>)}
      </div>
      <Routes>
        <Route index element={<Navigate to="account" replace />} />
        <Route path="account" element={<Account />} />
        <Route path="backup" element={<Backup />} />
        {isManager ? <Route path="authors" element={<Authors />} /> : null}
        {isAdmin ? <>
          <Route path="users" element={<Users />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="audit" element={<Audit />} />
        </> : null}
        <Route path="*" element={<Navigate to="account" replace />} />
      </Routes>
    </div>
  );
}

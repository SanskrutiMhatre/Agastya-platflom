// Platform settings. Everyone gets their account; administrators also get user
// management, the approval queues (password resets, release requests), active
// sessions and the audit log - all backed by the JSS Publisher admin routes.
//
// UI redesign screen 6 (owner-approved mockup docs/audit/mockups/admin.html): the page head, the mockup's tab row, the users table with
// one Actions button per row, and the audit table with its Time / Actor / Event / Type columns. The Administration page shows the same
// Users and audit pieces.

import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { adminApi, auditApi, auditQueryString, authApi, teamApi, type AuditQuery, type AuditVerifyReport, type GlobalRole, type User } from '../api';
import { globalLabel } from '../lib/roles';
import { Icon } from '../components/Icon';
import { ThemeChoiceControl } from '../components/ThemeToggle';
import { Callout, ConfirmModal, Dot, Empty, Field, Loading, Modal, ago, errText, fmtDate, initialsOf, Pill, useAsync } from '../components/ui';
import '../styles/pages/admin.css';   // WP-35 second pass: Users and Audit logs share the administrator styles
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { BackupButton } from '../components/Oversight';
import { actionLabel } from '../lib/activity';
import { MoreRows, useProgressive } from '../components/windowing';
import { useContextMenu, type MenuAction } from '../components/ContextMenu';
import { PasswordInput } from '../components/PasswordInput';
import { AdmHead, TabLinks } from './adminParts';

function Account() {
  const { user, logout } = useSession();
  const toast = useUi((s) => s.toast);
  const [cur, setCur] = useState(''); const [p, setP] = useState(''); const [p2, setP2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false); const repeatId = useId();

  const change = async () => {
    setErr('');
    // WP-35 (UID-002): the mismatch is the repeat field's own message, with the focus on it
    if (p !== p2) { setMismatch(true); document.getElementById(repeatId)?.focus(); return; }
    setMismatch(false);
    setBusy(true);
    try { await authApi.changePassword(cur, p); toast('Password changed. Other sessions were signed out.', 'success'); setCur(''); setP(''); setP2(''); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="adm-cols">
      <div className="stack adm-gap">
        <section className="card" aria-labelledby="acct-profile">
          <div className="card-head"><h3 id="acct-profile"><Icon name="user" />Profile</h3><Pill tone={user?.role === 'admin' ? 'danger' : user?.role === 'project_manager' ? 'info' : undefined}>{globalLabel(user?.role)}</Pill></div>
          <div className="card-body stack adm-gap">
            <div className="row user-cell"><span className="avatar" aria-hidden="true">{initialsOf(user?.fullName || user?.username || '')}</span><div className="stack who"><span className="nm">{user?.fullName}</span><span className="faint">@{user?.username}</span></div></div>
            <div className="adm-grid-2">
              <Field label="Name"><input className="input" value={user?.fullName ?? ''} readOnly /></Field>
              <Field label="Username"><input className="input" value={user?.username ?? ''} readOnly /></Field>
            </div>
          </div>
        </section>
        <section className="card" aria-labelledby="acct-pw">
          <div className="card-head"><h3 id="acct-pw"><Icon name="key" />Change password</h3></div>
          <form className="card-body stack adm-gap" onSubmit={(e) => { e.preventDefault(); void change(); }}>
            <Field label="Current password"><PasswordInput value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 15 characters (a few words make a good one), and not a common password or your name."><PasswordInput value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Repeat new password" error={mismatch && p !== p2 ? 'The new passwords do not match.' : undefined}><PasswordInput id={repeatId} value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
            {err ? <Callout tone="danger">{err}</Callout> : null}
            <div className="row end"><button className="btn primary" disabled={busy || !cur || !p}>Change password</button></div>
          </form>
        </section>
      </div>
      <aside className="stack adm-gap">
        <section className="card" data-testid="appearance" aria-labelledby="acct-look">
          <div className="card-head"><h3 id="acct-look"><Icon name="palette" />Appearance</h3></div>
          <div className="card-body stack adm-gap">
            <p className="faint">The colour theme on this computer. It is kept for you only; the top bar's theme button changes it too.</p>
            <ThemeChoiceControl />
          </div>
        </section>
        <section className="card" aria-labelledby="acct-session">
          <div className="card-head"><h3 id="acct-session"><Icon name="logout" />Session</h3></div>
          <div className="card-body stack adm-gap">
            <p className="faint">Sign out on this computer. Your other sessions stay signed in until they time out.</p>
            <div className="row end"><button className="btn" onClick={() => void logout()}><Icon name="logout" />Sign out</button></div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function Backup() {
  const role = useSession((s) => s.user?.role);
  return (
    <section className="card narrow" aria-labelledby="set-backup">
      <div className="card-head"><h3 id="set-backup"><Icon name="archive" />Backup</h3></div>
      <div className="card-body stack adm-gap">
        <p className="faint">{role === 'admin' ? 'Every project, the people and memberships, and the activity log, as one ZIP file.' : 'Every project you can open, as one ZIP file.'}</p>
        <div className="row end"><BackupButton label={role === 'admin' ? 'Back up the platform' : 'Back up my projects'} /></div>
      </div>
    </section>
  );
}

function TempPassword({ title, name, password, onClose }: { title: string; name: string; password: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width={480} buttons={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="stack adm-gap">
        <p>Temporary password for <strong>{name}</strong>. It works for the first sign-in only.</p>
        <div className="row"><input className="input mono" readOnly value={password} onFocus={(e) => e.currentTarget.select()} aria-label="Temporary password" /><button className="btn" onClick={() => void navigator.clipboard?.writeText(password)}><Icon name="copy" />Copy</button></div>
      </div>
    </Modal>
  );
}

/** The role names and badge tones of the mockup's users table (Author plain, Project manager info, Administrator danger). */
const ROLE_NAME: Record<string, string> = { author: 'Author', project_manager: 'Project manager', admin: 'Administrator' };
const ROLE_TONE: Record<string, 'info' | 'danger' | undefined> = { project_manager: 'info', admin: 'danger' };
const ROLE_SAYS: Record<string, string> = {
  admin: 'An administrator can manage every account, the settings and every project.',
  project_manager: 'A Project manager can create projects and approve releases of the projects they manage.',
  author: 'An Author works only in the projects shared with them.',
};

/** "Today 13:02", "Yesterday", "3 days ago", "3 weeks ago" (the mockup's Last sign-in column); "Never" before the first sign-in. */
export function signInWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days <= 0) return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return d.toLocaleDateString();
}

/** One account's state as the mockup's status badge (a dot and a word); directory and auditor marks follow it. */
function UserStatus({ u }: { u: User }) {
  const s = u.disabled
    ? { tone: undefined, label: u.disabledReason === 'directory' ? 'Offboarded by the directory' : 'Disabled', title: u.disabledReason === 'directory' ? 'Disabled by the directory (removed from its groups or disabled there)' : undefined }
    : u.onboardingPending ? { tone: 'warning' as const, label: 'Awaiting first sign-in' }
      : u.mustChangePassword ? { tone: 'warning' as const, label: 'Must change password' } : { tone: 'success' as const, label: 'Active' };
  return (
    <span className="row adm-badges">
      <span className={`badge${s.tone ? ` ${s.tone}` : ''}`} title={'title' in s ? s.title : undefined}><Dot tone={s.tone} />{s.label}</span>
      {u.authSource === 'directory' ? <Pill title="Signs in with the domain password">Directory</Pill> : null}
    </span>
  );
}

/**
 * The people of the platform, as the administration mockup draws them: a card with the count and a search, one row per person (avatar,
 * name, username, role badge, status, last sign-in) and one "Actions" button per row that opens the row's actions (change role, auditor,
 * reset password, disable or enable). Every change that takes effect at once is confirmed first (FE-012).
 *   limit       show the first N people and a "Show all" button (the Administration overview shows 6, as the mockup does)
 *   createTick  a counter: when it changes, the New user dialog opens (the page head's button on the Administration page)
 *   inlineNew   the New user button in the card head (Settings > Users, where the page head has none)
 */
export function Users({ limit, createTick = 0, startCreating = false, inlineNew = true, rolesHref }: { limit?: number; createTick?: number; startCreating?: boolean; inlineNew?: boolean; rolesHref?: string } = {}) {
  const me = useSession((s) => s.user);
  const toast = useUi((s) => s.toast);
  const users = useAsync(() => adminApi.users(), []);
  const [creating, setCreating] = useState(startCreating);
  const [temp, setTemp] = useState<{ title: string; name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ user: User; action: 'disable' | 'reset' } | null>(null);
  // FE-012: a role change takes effect at once (what the person may see and do), so it is chosen in a dialog and confirmed there
  const [roleOf, setRoleOf] = useState<{ user: User; role: string } | null>(null);
  const [q, setQ] = useState('');                    // the mockup's user search: narrows the list on this page
  const [all, setAll] = useState(false);             // past the overview's limit
  const menu = useContextMenu();
  const firstTick = useRef(createTick);
  useEffect(() => { if (createTick !== firstTick.current) setCreating(true); }, [createTick]);

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); users.reload(); } catch (e) { toast(errText(e), 'error'); } };
  const actions = (u: User): MenuAction[] => [
    { label: 'Change role…', icon: 'users', disabled: u.id === me?.id, onSelect: () => setRoleOf({ user: u, role: u.role }) },
    ...(u.role !== 'admin' ? [{ label: u.auditor ? 'End auditor' : 'Make auditor', icon: 'eye' as const, testId: `auditor-${u.username}`, onSelect: () => void act(() => adminApi.updateUser(u.id, { auditor: !u.auditor }), u.auditor ? 'No longer read-only' : 'Now a read-only auditor') }] : []),
    ...(u.authSource !== 'directory' ? [{ label: 'Reset password…', icon: 'key' as const, onSelect: () => setConfirm({ user: u, action: 'reset' }) }] : []),
    u.disabled
      ? { label: 'Enable', icon: 'ok', onSelect: () => void act(() => adminApi.enable(u.id), 'Account enabled') }
      : { label: 'Disable…', icon: 'ban', danger: true, disabled: u.id === me?.id, onSelect: () => setConfirm({ user: u, action: 'disable' }) },
  ];

  const list = users.data ?? [];
  const needle = q.trim().toLowerCase();
  const found = needle ? list.filter((u) => `${u.fullName} ${u.username}`.toLowerCase().includes(needle)) : list;
  const shown = limit && !all && !needle ? found.slice(0, limit) : found;
  return (
    <>
      <section className="card" aria-labelledby="users-h" data-testid="users-card">
        <div className="card-head">
          <h3 id="users-h"><Icon name="users" />Users <span className="count">{list.length}</span></h3>
          <div className="row">
            <input className="input search adm-search" type="search" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" data-testid="users-search" />
            {inlineNew ? <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New user</button> : null}
          </div>
        </div>
        {users.loading && !users.data ? <Loading /> : shown.length === 0 ? <Empty title={needle ? 'Nobody matches' : 'No users yet'} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="adm-w-actions"><span className="sr">Actions</span></th></tr></thead>
            <tbody>{shown.map((u) => (
              <tr key={u.id} {...menu.bind(`Actions for ${u.fullName}`, actions(u))}>
                <td><div className="row user-cell"><span className="avatar" aria-hidden="true">{initialsOf(u.fullName || u.username)}</span><div className="stack who"><span className="nm">{u.fullName}</span><span className="faint">@{u.username}</span></div></div></td>
                <td><span className="row adm-badges"><Pill tone={ROLE_TONE[u.role]}>{ROLE_NAME[u.role] ?? globalLabel(u.role)}</Pill>{u.auditor ? <Pill tone="accent" title="Reads every project and the audit log, changes nothing">Auditor</Pill> : null}</span></td>
                <td><UserStatus u={u} /></td>
                <td className="faint" title={u.lastSignInAt ? fmtDate(u.lastSignInAt) : undefined}>{signInWhen(u.lastSignInAt)}</td>
                <td className="adm-td-end">
                  <button type="button" className="icon-btn" aria-label={`Actions for ${u.fullName}`} title="Actions" aria-haspopup="menu" data-testid={`user-actions-${u.username}`}
                    onClick={(e) => menu.open(e.currentTarget, `Actions for ${u.fullName}`, actions(u))}><Icon name="more" /></button>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
        {users.data ? (
          <div className="card-foot">
            <span className="faint" data-testid="users-shown">{shown.length} of {list.length} shown</span>
            <span className="grow" />
            {limit && !needle && found.length > limit ? <button className="btn sm" onClick={() => setAll(!all)}>{all ? `Show ${limit}` : 'Show all'}</button> : null}
            {rolesHref ? <Link className="btn sm" to={rolesHref}><Icon name="shield" size={14} />Roles and what they can do</Link> : null}
          </div>
        ) : null}
      </section>
      {menu.menu}

      {creating ? <CreateUser roles={[['author', 'Author'], ['project_manager', 'Project Manager']]} create={(b) => adminApi.createUser(b)} onClose={() => setCreating(false)} onCreated={(name, pw) => { setCreating(false); users.reload(); setTemp({ title: 'Account created', name, password: pw }); }} /> : null}
      {temp ? <TempPassword {...temp} onClose={() => setTemp(null)} /> : null}
      {roleOf ? (
        <Modal title={`Change the role of ${roleOf.user.fullName}?`} icon="users" tone="info" width={460} onClose={() => setRoleOf(null)}
          buttons={<><button className="btn" onClick={() => setRoleOf(null)}>Cancel</button>
            <button className="btn primary" disabled={roleOf.role === roleOf.user.role} onClick={() => { const r = roleOf; setRoleOf(null); void act(() => adminApi.updateUser(r.user.id, { role: r.role }), 'Role updated'); }}>Change role</button></>}>
          <div className="stack">
            <select className="select" value={roleOf.role} aria-label={`Role of ${roleOf.user.username}`} onChange={(e) => setRoleOf({ ...roleOf, role: e.target.value })}>
              <option value="author">Author</option><option value="project_manager">Project manager</option><option value="admin">Administrator</option>
            </select>
            <p>{ROLE_SAYS[roleOf.role]} The change applies at once; the audit log records it.</p>
          </div>
        </Modal>
      ) : null}
      {confirm ? (
        <ConfirmModal title={confirm.action === 'reset' ? `Reset ${confirm.user.fullName}'s password?` : `Disable ${confirm.user.fullName}?`} danger={confirm.action === 'disable'}
          icon={confirm.action === 'reset' ? 'key' : 'ban'} tone={confirm.action === 'reset' ? 'warning' : 'danger'}
          confirmLabel={confirm.action === 'reset' ? 'Reset password' : 'Disable user'} onClose={() => setConfirm(null)}
          body={<p>{confirm.action === 'reset' ? 'Their current password stops working, every session is signed out, and they must choose a new password at next sign-in.' : `${confirm.user.fullName.split(' ')[0]} is signed out at once and cannot sign in again until you enable the account. Their work stays in the history.`}</p>}
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
    <Modal title="New user" onClose={onClose} width={440} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !fullName.trim() || !username.trim()} onClick={submit}>Create account</button></>}>
      <form className="stack adm-gap" onSubmit={(e) => { e.preventDefault(); if (fullName.trim() && username.trim() && !busy) void submit(); }}>
        <Field label="Name"><input className="input" autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Username"><input className="input" value={username} onChange={(e) => { typed.current = true; setUsername(e.target.value.toLowerCase()); }} autoComplete="off" /></Field>
        {roles.length > 1 ? <Field label="Role"><select className="select" value={role} onChange={(e) => setRole(e.target.value as GlobalRole)}>{roles.map(([r, label]) => <option key={r} value={r}>{label}</option>)}</select></Field> : null}
        {err ? <Callout tone="danger">{err}</Callout> : null}
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
      <section className="card" aria-labelledby="authors-h">
        <div className="card-head">
          <h3 id="authors-h"><Icon name="users" />Authors <span className="count">{list.data?.length ?? 0}</span></h3>
          <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-author"><Icon name="plus" />New author</button>
        </div>
        {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No authors yet">Create your first Author, then assign them to a project.</Empty> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created by</th></tr></thead>
            <tbody>{list.data.map((u) => (
              <tr key={u.id}>
                <td><div className="row user-cell"><span className="avatar" aria-hidden="true">{initialsOf(u.fullName || u.username)}</span><div className="stack who"><span className="nm">{u.fullName}</span><span className="faint">@{u.username}</span></div></div></td>
                <td><Pill tone={ROLE_TONE[u.role]}>{ROLE_NAME[u.role] ?? globalLabel(u.role)}</Pill></td>
                <td><UserStatus u={u} /></td><td className="faint">{u.createdBy ?? '-'}</td></tr>))}</tbody></table></div>
        )}
      </section>
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
    <div className="stack adm-gap">
      <section className="card" aria-labelledby="appr-rel-h">
        <div className="card-head"><h3 id="appr-rel-h"><Icon name="stamp" />Release requests <span className="count">{releases.data?.length ?? 0}</span></h3></div>
        {releases.loading && !releases.data ? <Loading /> : !releases.data?.length ? <Empty title="No release requests waiting" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Requested by</th><th>Takes effect</th><th>Note</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>{releases.data.map((r) => (
              <tr key={r.id}><td><span className="nm">{r.projectName}</span></td><td>{r.requestedBy ?? '—'}</td><td className="faint">{fmtDate(r.scheduledAt)}</td><td>{r.note ?? ''}</td>
                <td className="adm-td-end">
                  <button className="btn sm primary" onClick={() => run(() => adminApi.approveRelease(r.id), 'Release approved', releases.reload)}>Approve</button>
                  <button className="btn sm" onClick={() => run(() => adminApi.rejectRelease(r.id), 'Release rejected', releases.reload)}>Reject</button></td></tr>))}</tbody></table></div>
        )}
      </section>
      <section className="card" aria-labelledby="appr-pw-h">
        <div className="card-head"><h3 id="appr-pw-h"><Icon name="key" />Password reset requests <span className="count">{resets.data?.length ?? 0}</span></h3></div>
        {resets.loading && !resets.data ? <Loading /> : !resets.data?.length ? <Empty title="No reset requests waiting" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>User</th><th>Requested</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>{resets.data.map((r) => (
              <tr key={r.id}><td><div className="row user-cell"><span className="avatar" aria-hidden="true">{initialsOf(r.fullName || r.username)}</span><div className="stack who"><span className="nm">{r.fullName}</span><span className="faint">@{r.username}</span></div></div></td><td className="faint">{ago(r.requestedAt)}</td>
                <td className="adm-td-end">
                  <button className="btn sm primary" onClick={async () => { try { const x = await adminApi.approveReset(r.id); setTemp({ name: r.fullName, password: x.tempPassword }); resets.reload(); } catch (e) { toast(errText(e), 'error'); } }}>Approve</button>
                  <button className="btn sm" onClick={() => run(() => adminApi.rejectReset(r.id), 'Request rejected', resets.reload)}>Reject</button></td></tr>))}</tbody></table></div>
        )}
      </section>
      {temp ? <TempPassword title="Password reset" name={temp.name} password={temp.password} onClose={() => setTemp(null)} /> : null}
    </div>
  );
}

function Sessions() {
  const toast = useUi((s) => s.toast);
  const s = useAsync(() => adminApi.sessions(), []);
  return (
    <section className="card" aria-labelledby="sess-h">
      <div className="card-head"><h3 id="sess-h"><Icon name="monitor" />Active sessions <span className="count">{s.data?.length ?? 0}</span></h3></div>
      {s.loading && !s.data ? <Loading /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>User</th><th>Signed in</th><th>Last seen</th><th>From</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{(s.data ?? []).map((x) => (
            <tr key={x.id}><td><div className="row user-cell"><span className="avatar" aria-hidden="true">{initialsOf(x.fullName || x.username)}</span><div className="stack who"><span className="nm">{x.fullName}</span><span className="faint">@{x.username}</span></div></div></td>
              <td className="faint">{fmtDate(x.createdAt)}</td><td className="faint">{ago(x.lastSeenAt)}</td><td className="mono adm-xs">{plainIp(x.ip)}</td>
              <td className="adm-td-end"><button className="btn sm" onClick={async () => { try { await adminApi.revokeSession(x.id); toast('Session ended', 'success'); s.reload(); } catch (e) { toast(errText(e), 'error'); } }}>End session</button></td></tr>))}</tbody></table></div>
      )}
    </section>
  );
}

/** "::ffff:127.0.0.1" is an IPv4 address written as IPv6; the log shows it as 127.0.0.1 (WP-22, UX-025). */
export const plainIp = (ip: string | null): string => (ip ?? '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

/** The mockup's Type column: what kind of event a row is, from its action name (sign-in trouble and access changes are Security, settings
 *  and reference data are Config, everything else is Info; an ordinary sign-in or sign-out is Info, as the mockup draws it). */
export function auditKind(action: string): { label: string; tone: 'danger' | 'warning' | 'info' } {
  const a = action.toLowerCase();
  if (a === 'auth.login' || a === 'auth.logout' || a === 'auth.onboarding.completed') return { label: 'Info', tone: 'info' };
  if (/(fail|denied|refused|locked|lockout|offboard|revoke|disable|reset|password|session\.ended|auth\.)/.test(a)) return { label: 'Security', tone: 'danger' };
  if (/(setting|config|policy|accent|theme|backup|restore|access\.|role|group|directory|maintenance)/.test(a)) return { label: 'Config', tone: 'warning' };
  return { label: 'Info', tone: 'info' };
}

type AuditRow = Awaited<ReturnType<typeof adminApi.audit>>[number];

/** The mockup's Event column: the action as a sentence ("Signed in from 10.20.4.17", "Created an account: rita"). */
export function auditEvent(e: Pick<AuditRow, 'action' | 'ip' | 'meta'>): string {
  const said = actionLabel(e.action);
  const text = said.charAt(0).toUpperCase() + said.slice(1);
  const m = (e.meta && typeof e.meta === 'object' ? e.meta : {}) as Record<string, unknown>;
  const who = typeof m.username === 'string' ? m.username : '';
  if (e.action.startsWith('auth.login') && e.ip) return `${text} from ${plainIp(e.ip)}`;
  return who ? `${text}: ${who}` : text;
}

/** The mockup's Time column: the clock time for today, the day and time before that. */
export function auditTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

/** The Administration overview's audit card: the newest entries, as the mockup draws them, and View all. */
export function RecentAudit({ rows = 5, allHref }: { rows?: number; allHref: string }) {
  const a = useAsync(() => adminApi.audit(rows), [rows]);
  return (
    <section className="card" aria-labelledby="recent-audit-h" data-testid="recent-audit">
      <div className="card-head"><h3 id="recent-audit-h"><Icon name="log" />Audit log</h3><Link to={allHref}>View all</Link></div>
      {a.loading && !a.data ? <Loading /> : a.error ? <div className="card-body"><Callout tone="danger">{a.error}</Callout></div> : !a.data?.length ? <Empty title="No entries yet" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Type</th></tr></thead>
          <tbody>{a.data.map((e) => { const k = auditKind(e.action); return (
            <tr key={e.id}><td className="faint mono nowrap" title={fmtDate(e.at)}>{auditTime(e.at)}</td><td>{e.actor ?? 'unknown'}</td><td title={e.action}>{auditEvent(e)}</td><td><Pill tone={k.tone}>{k.label}</Pill></td></tr>); })}</tbody>
        </table></div>
      )}
    </section>
  );
}

export function Audit() {
  const [typed, setTyped] = useState<AuditQuery>({});
  const [filter, setFilter] = useState<AuditQuery>({});
  // WP-18 (FE-020): the filter asks the server once the typing pauses, not once per key
  useEffect(() => { const t = setTimeout(() => setFilter(typed), 300); return () => clearTimeout(t); }, [typed]);
  const key = auditQueryString(filter);
  const a = useAsync(() => adminApi.audit(300, filter), [key]);
  // WP-29 supersedes WP-22's client-side who/day narrowing: person, project and dates are asked of the server (and reach the export);
  // WP-22's plainIp display is kept below
  const rows = a.data ?? [];
  const drawn = useProgressive(rows.length, key);     // WP-18 (FE-030): first rows now, more on scroll
  // WP-29: verify the chain, and export every row matching the filters (not only the 300 shown)
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<AuditVerifyReport | null>(null);
  const [verr, setVerr] = useState('');
  const verify = async () => {
    setVerifying(true); setVerr('');
    try { setReport(await auditApi.verify()); } catch (e) { setVerr(errText(e)); } finally { setVerifying(false); }
  };
  const set = (k: keyof AuditQuery) => (e: React.ChangeEvent<HTMLInputElement>) => setTyped({ ...typed, [k]: e.target.value });
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') setFilter(typed); };
  return (
    <div className="stack adm-gap">
      {verr ? <Callout tone="danger">{verr}</Callout> : null}
      {report ? (
        <Callout tone={report.ok ? 'success' : 'danger'}>
          <span data-testid="audit-verify-result">{report.ok ? 'Intact' : 'Problems found'}: {report.summary}.</span>
          {!report.ok ? <ul className="adm-list">{report.problems.slice(0, 20).map((p, i) => <li key={i}>{p.message}</li>)}{report.problemCount > 20 ? <li>… and {report.problemCount - 20} more (run AgastyaCtl --verify-audit for the full list)</li> : null}</ul> : null}
        </Callout>
      ) : null}
      <section className="card" aria-labelledby="audit-h">
        <div className="card-head">
          <h3 id="audit-h"><Icon name="log" />Audit log <span className="count">{rows.length}</span></h3>
          <div className="row wrap">
            <button className="btn sm" onClick={verify} disabled={verifying} data-testid="audit-verify"><Icon name="shield" size={14} />{verifying ? 'Verifying…' : 'Verify chain'}</button>
            <a className="btn sm" href={auditApi.exportUrl('csv', filter)} download data-testid="audit-export-csv"><Icon name="download" size={14} />Export CSV</a>
            <a className="btn sm" href={auditApi.exportUrl('jsonl', filter)} download data-testid="audit-export-jsonl"><Icon name="download" size={14} />Export JSON Lines</a>
          </div>
        </div>
        <div className="adm-filters">
          <input className="input search adm-w-220" placeholder="Action, e.g. release.approved" value={typed.action ?? ''} onChange={set('action')} onKeyDown={enter} aria-label="Filter audit log by action" />
          <input className="input search adm-w-140" placeholder="Person" value={typed.actor ?? ''} onChange={set('actor')} onKeyDown={enter} aria-label="Filter audit log by person" data-testid="audit-actor" />
          <input className="input search adm-w-180" placeholder="Project id" value={typed.project ?? ''} onChange={set('project')} onKeyDown={enter} aria-label="Filter audit log by project" data-testid="audit-project" />
          <label className="row adm-date">From <input className="input" type="date" value={typed.from ?? ''} onChange={set('from')} aria-label="Entries from this date" data-testid="audit-from" /></label>
          <label className="row adm-date">To <input className="input" type="date" value={typed.to ?? ''} onChange={set('to')} aria-label="Entries up to this date" data-testid="audit-to" /></label>
          <button className="icon-btn" onClick={a.reload} aria-label="Refresh" title="Refresh"><Icon name="refresh" /></button>
          <span className="grow" />
          <span className="faint adm-xs">Newest first · at most 300 shown; the export holds every matching entry.</span>
        </div>
        {a.loading && !a.data ? <Loading /> : !rows.length ? <Empty title="No entries" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Type</th><th>Project</th><th>From</th></tr></thead>
            <tbody>{rows.slice(0, drawn.limit).map((e) => { const k = auditKind(e.action); return (
              <tr key={e.id}><td title={fmtDate(e.at)} className="faint mono nowrap">{auditTime(e.at)}</td><td>{e.actor ?? 'unknown'}</td>
                <td title={e.action}>{auditEvent(e)} <span className="faint mono adm-xs">{e.action}</span></td><td><Pill tone={k.tone}>{k.label}</Pill></td>
                <td className="mono adm-xs">{e.projectId ?? ''}</td><td className="mono adm-xs">{plainIp(e.ip)}</td></tr>); })}
              <MoreRows as="tr" colSpan={6} shown={drawn.limit} total={rows.length} onMore={drawn.more} onAll={drawn.all} /></tbody></table></div>
        )}
      </section>
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
    <div className="v2-page adm">
      <AdmHead title="Settings" sub={isAdmin ? 'Your account, the people and platform administration of this installation.' : isManager ? 'Your account and your authors.' : 'Your account and preferences.'} />
      <TabLinks label="Settings sections" tabs={tabs} />
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

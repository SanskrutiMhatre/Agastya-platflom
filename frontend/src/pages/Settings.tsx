// Platform settings. Everyone gets their account; administrators also get user
// management, the approval queues (password resets, release requests), active
// sessions and the audit log - all backed by the JSS Publisher admin routes.

import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { adminApi, auditApi, auditQueryString, authApi, teamApi, type AuditQuery, type AuditVerifyReport, type GlobalRole, type User } from '../api';
import { globalLabel } from '../lib/roles';
import { Icon } from '../components/Icon';
import { ThemeChoiceControl } from '../components/ThemeToggle';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, Modal, ago, errText, fmtDate, initialsOf, Pill, useAsync } from '../components/ui';
import '../styles/pages/admin.css';   // WP-35 second pass: Users and Audit logs share the administrator styles
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { BackupButton } from '../components/Oversight';
import { actionLabel } from '../lib/activity';
import { MoreRows, useProgressive } from '../components/windowing';
import { tablistKeys } from '../components/a11y';
import { PasswordInput } from '../components/PasswordInput';
import { AdmHead } from './adminParts';

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
    <div className="v2-stack v2-maxw-560">
      <section className="card" aria-labelledby="acct-profile">
        <div className="card-head"><h3 id="acct-profile"><Icon name="user" />Profile</h3></div>
        <div className="card-body v2-stack">
          <div className="user-cell"><span className="avatar" aria-hidden="true">{initialsOf(user?.fullName || user?.username || '')}</span><div className="who"><strong>{user?.fullName}</strong><span className="v2-mono">@{user?.username}</span></div></div>
          <Field label="Name"><input className="v2-input" value={user?.fullName ?? ''} readOnly /></Field>
          <Field label="Username"><input className="v2-input" value={user?.username ?? ''} readOnly /></Field>
          <div className="v2-row"><Badge tone={user?.role === 'author' ? undefined : 'accent'}>{globalLabel(user?.role)}</Badge></div>
        </div>
      </section>
      <section className="card" aria-labelledby="acct-pw">
        <div className="card-head"><h3 id="acct-pw"><Icon name="key" />Change password</h3></div>
        <form className="card-body v2-stack" onSubmit={(e) => { e.preventDefault(); void change(); }}>
          <Field label="Current password"><PasswordInput value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 15 characters (a few words make a good one), and not a common password or your name."><PasswordInput value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat new password" error={mismatch && p !== p2 ? 'The new passwords do not match.' : undefined}><PasswordInput id={repeatId} value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
          {err ? <Alert tone="bad">{err}</Alert> : null}
          <div><button className="btn btn-primary" disabled={busy || !cur || !p}>Change password</button></div>
        </form>
      </section>
      <section className="card" data-testid="appearance" aria-labelledby="acct-look">
        <div className="card-head"><h3 id="acct-look"><Icon name="monitor" />Appearance</h3></div>
        <div className="card-body v2-stack">
        <p className="v2-sub v2-m0">Theme on this computer. Until you pick one, your organisation's default is used (light unless the administrator chose dark).</p>
        <ThemeChoiceControl />
        </div>
      </section>
      <div><button className="btn" onClick={() => void logout()}><Icon name="logout" />Sign out</button></div>
    </div>
  );
}

function Backup() {
  const role = useSession((s) => s.user?.role);
  return (
    <section className="card v2-maxw-560" aria-labelledby="set-backup">
      <div className="card-head"><h3 id="set-backup"><Icon name="download" />Backup</h3></div>
      <div className="card-body v2-stack">
      <p className="v2-sub v2-m0">{role === 'admin' ? 'Every project, the people and memberships, and the activity log, as one ZIP file.' : role === 'project_manager' ? 'Every project you can open, as one ZIP file.' : 'Every project you can open, as one ZIP file.'}</p>
      <div><BackupButton label={role === 'admin' ? 'Back up the platform' : 'Back up my projects'} /></div>
      </div>
    </section>
  );
}

function TempPassword({ title, name, password, onClose }: { title: string; name: string; password: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width={480} buttons={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="v2-mt0">Temporary password for <strong>{name}</strong>. It works for the first sign-in only.</p>
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
  const [q, setQ] = useState('');                    // the mockup's user search: narrows the list on this page

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); users.reload(); } catch (e) { toast(errText(e), 'error'); } };

  const all = users.data ?? [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((u) => `${u.fullName} ${u.username}`.toLowerCase().includes(needle)) : all;
  return (
    <>
      <section className="card" aria-labelledby="users-h" data-testid="users-card">
        <div className="card-head">
          <h3 id="users-h"><Icon name="users" />Users <span className="count">{all.length}</span></h3>
          <div className="row wrap">
            <input className="v2-input v2-w-220" type="search" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" data-testid="users-search" />
            <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="invite" />New user</button>
          </div>
        </div>
        {users.loading && !users.data ? <Loading /> : shown.length === 0 ? <Empty title={needle ? 'Nobody matches' : 'No users yet'} /> : (
          <div className="table-wrap"><table className="v2-table">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th><span className="v2-sr">Actions</span></th></tr></thead>
            <tbody>{shown.map((u) => (
              <tr key={u.id}>
                <td><div className="user-cell"><span className="avatar" aria-hidden="true">{initialsOf(u.fullName || u.username)}</span><div className="who"><strong>{u.fullName}</strong><span className="v2-mono">@{u.username}</span></div></div></td>
                <td>
                  <select className="v2-select v2-w-190" value={u.role} disabled={u.id === me?.id} aria-label={`Role of ${u.username}`}
                    onChange={(e) => setRoleChange({ user: u, role: e.target.value })}>
                    <option value="author">Author</option><option value="project_manager">Project Manager</option><option value="admin">Software administrator</option>
                  </select>
                </td>
                <td>{u.disabled ? <Badge tone="bad" title={u.disabledReason === 'directory' ? 'Disabled by the directory (removed from its groups or disabled there)' : undefined}>{u.disabledReason === 'directory' ? 'Offboarded by the directory' : 'Disabled'}</Badge> : u.onboardingPending ? <Badge tone="warn">Awaiting first sign-in</Badge> : u.mustChangePassword ? <Badge tone="warn">Must change password</Badge> : <Badge tone="ok">Active</Badge>}
                  {u.authSource === 'directory' ? <> <Badge title="Signs in with the domain password">Directory</Badge></> : null}{u.auditor ? <> <Badge tone="accent" title="Reads every project and the audit log, changes nothing">Auditor</Badge></> : null}</td>
                <td className="v2-td-end">
                  {u.role !== 'admin' ? <><button className="btn btn-sm" data-testid={`auditor-${u.username}`} onClick={() => act(() => adminApi.updateUser(u.id, { auditor: !u.auditor }), u.auditor ? 'No longer read-only' : 'Now a read-only auditor')}>{u.auditor ? 'End auditor' : 'Make auditor'}</button>{' '}</> : null}
                  {u.authSource !== 'directory' ? <><button className="btn btn-sm" onClick={() => setConfirm({ user: u, action: 'reset' })}><Icon name="key" size={13} />Reset password</button>{' '}</> : null}
                  {u.disabled
                    ? <button className="btn btn-sm" onClick={() => act(() => adminApi.enable(u.id), 'Account enabled')}>Enable</button>
                    : <button className="btn btn-sm" disabled={u.id === me?.id} onClick={() => setConfirm({ user: u, action: 'disable' })}>Disable</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
        {users.data ? <div className="card-foot"><span className="faint" data-testid="users-shown">{shown.length} of {all.length} shown</span></div> : null}
      </section>

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
      <div className="v2-row v2-spread v2-mb14">
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
        <div className="card-head"><h3><Icon name="stamp" />Release requests</h3></div>
        {releases.loading && !releases.data ? <Loading /> : !releases.data?.length ? <Empty title="No release requests waiting" /> : (
          <table className="v2-table"><thead><tr><th>Project</th><th>Requested by</th><th>Takes effect</th><th>Note</th><th /></tr></thead>
            <tbody>{releases.data.map((r) => (
              <tr key={r.id}><td><strong>{r.projectName}</strong></td><td>{r.requestedBy ?? '—'}</td><td>{fmtDate(r.scheduledAt)}</td><td>{r.note ?? ''}</td>
                <td className="v2-td-end">
                  <button className="btn btn-sm btn-primary" onClick={() => run(() => adminApi.approveRelease(r.id), 'Release approved', releases.reload)}>Approve</button>{' '}
                  <button className="btn btn-sm" onClick={() => run(() => adminApi.rejectRelease(r.id), 'Release rejected', releases.reload)}>Reject</button></td></tr>))}</tbody></table>
        )}
      </div>
      <div className="v2-card">
        <div className="card-head"><h3><Icon name="key" />Password reset requests</h3></div>
        {resets.loading && !resets.data ? <Loading /> : !resets.data?.length ? <Empty title="No reset requests waiting" /> : (
          <table className="v2-table"><thead><tr><th>Person</th><th>Requested</th><th /></tr></thead>
            <tbody>{resets.data.map((r) => (
              <tr key={r.id}><td><strong>{r.fullName}</strong> <span className="v2-hint">@{r.username}</span></td><td>{ago(r.requestedAt)}</td>
                <td className="v2-td-end">
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
              <td className="v2-td-end"><button className="btn btn-sm" onClick={async () => { try { await adminApi.revokeSession(x.id); toast('Session ended', 'success'); s.reload(); } catch (e) { toast(errText(e), 'error'); } }}>End session</button></td></tr>))}</tbody></table>
      )}
    </div>
  );
}

/** "::ffff:127.0.0.1" is an IPv4 address written as IPv6; the log shows it as 127.0.0.1 (WP-22, UX-025). */
export const plainIp = (ip: string | null): string => (ip ?? '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

/** The mockup's Type column: what kind of event a row is, from its action name (sign-in trouble and access changes are Security, settings
 *  and reference data are Config, everything else is Info). */
export function auditKind(action: string): { label: string; tone: 'danger' | 'warning' | 'info' } {
  const a = action.toLowerCase();
  if (/(fail|denied|refused|locked|lockout|offboard|revoke|disable|reset|password|session\.ended|auth\.)/.test(a)) return { label: 'Security', tone: 'danger' };
  if (/(setting|config|policy|accent|theme|backup|restore|access\.|role|group|directory|maintenance)/.test(a)) return { label: 'Config', tone: 'warning' };
  return { label: 'Info', tone: 'info' };
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
    <div className="v2-stack">
      <div className="v2-row wrap v2-gap-8">
        <input className="v2-input v2-w-220" placeholder="Action, e.g. release.approved" value={typed.action ?? ''} onChange={set('action')} onKeyDown={enter} aria-label="Filter audit log by action" />
        <input className="v2-input v2-w-140" placeholder="Person" value={typed.actor ?? ''} onChange={set('actor')} onKeyDown={enter} aria-label="Filter audit log by person" data-testid="audit-actor" />
        <input className="v2-input v2-w-180" placeholder="Project id" value={typed.project ?? ''} onChange={set('project')} onKeyDown={enter} aria-label="Filter audit log by project" data-testid="audit-project" />
        <label className="v2-row v2-gap-4">From <input className="v2-input" type="date" value={typed.from ?? ''} onChange={set('from')} aria-label="Entries from this date" data-testid="audit-from" /></label>
        <label className="v2-row v2-gap-4">To <input className="v2-input" type="date" value={typed.to ?? ''} onChange={set('to')} aria-label="Entries up to this date" data-testid="audit-to" /></label>
        <button className="btn" onClick={a.reload}><Icon name="refresh" />Refresh</button>
      </div>
      <div className="v2-row wrap v2-gap-8">
        <a className="btn" href={auditApi.exportUrl('csv', filter)} download data-testid="audit-export-csv"><Icon name="download" />Export CSV</a>
        <a className="btn" href={auditApi.exportUrl('jsonl', filter)} download data-testid="audit-export-jsonl"><Icon name="download" />Export JSON Lines</a>
        <button className="btn" onClick={verify} disabled={verifying} data-testid="audit-verify"><Icon name="check" />{verifying ? 'Verifying…' : 'Verify chain'}</button>
        <span className="v2-hint">The export holds every matching entry, not only those shown.</span>
      </div>
      {verr ? <Alert tone="bad">{verr}</Alert> : null}
      {report ? (
        <Alert tone={report.ok ? 'ok' : 'bad'}>
          <span data-testid="audit-verify-result">{report.ok ? 'Intact' : 'Problems found'}: {report.summary}.</span>
          {!report.ok ? <ul className="v2-mt6">{report.problems.slice(0, 20).map((p, i) => <li key={i}>{p.message}</li>)}{report.problemCount > 20 ? <li>… and {report.problemCount - 20} more (run AgastyaCtl --verify-audit for the full list)</li> : null}</ul> : null}
        </Alert>
      ) : null}
      <section className="card" aria-labelledby="audit-h">
        <div className="card-head"><h3 id="audit-h"><Icon name="history" />Entries <span className="count">{rows.length}</span></h3><span className="faint">Newest first · at most 300 shown</span></div>
        {a.loading && !a.data ? <Loading /> : !rows.length ? <Empty title="No entries" /> : (
          <div className="table-wrap"><table className="v2-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Project</th><th>From</th></tr></thead>
            <tbody>{rows.slice(0, drawn.limit).map((e) => { const k = auditKind(e.action); return <tr key={e.id}><td title={fmtDate(e.at)} className="faint">{ago(e.at)}</td><td>{e.actor ?? '—'}</td><td title={e.action}>{actionLabel(e.action)} <span className="v2-hint v2-mono">{e.action}</span></td><td><Pill tone={k.tone}>{k.label}</Pill></td><td className="v2-mono">{e.projectId ?? ''}</td><td className="v2-mono">{plainIp(e.ip)}</td></tr>; })}
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
      <AdmHead title="Settings" sub={isAdmin ? 'Account, people and platform administration.' : isManager ? 'Your account and your authors.' : 'Your account and preferences.'} />
      <div className="v2-tabs" role="tablist" aria-label="Settings sections" onKeyDown={tablistKeys}>
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

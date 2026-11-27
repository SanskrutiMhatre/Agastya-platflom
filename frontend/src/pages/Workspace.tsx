// Workspace: projects arranged in folders (ported from JSS Publisher's dashboard
// model). A folder is a name plus an owner; access can be granted on a whole
// folder so it applies to every project filed in it, now and later.

import { useState } from 'react';
import { workspaceApi, adminApi, type FolderView, type ProjectRole } from '../api';
import { Icon } from '../components/Icon';
import { CreateProjectModal, ProjectCardView } from '../components/project';
import { Alert, ConfirmModal, Empty, Loading, Modal, PromptModal, errText, useAsync } from '../components/ui';
import { SampleMenu } from '../components/SampleButton';
import { useContextMenu } from '../components/ContextMenu';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

function FolderAccessModal({ folder, onClose }: { folder: FolderView; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const acc = useAsync(() => workspaceApi.folderAccess(folder.key), [folder.key]);
  const [grants, setGrants] = useState<Array<{ userId: string; username: string; fullName: string; role: string }> | null>(null);
  const users = useAsync(() => adminApi.users().catch(() => []), []);
  const [add, setAdd] = useState('');
  const rows = grants ?? acc.data?.grants ?? [];
  const [err, setErr] = useState('');

  const save = async () => {
    try { await workspaceApi.setFolderAccess(folder.key, rows.map((g) => ({ userId: g.userId, role: g.role }))); toast('Folder access saved', 'success'); onClose(); }
    catch (e) { setErr(errText(e)); }
  };
  return (
    <Modal title={`Access to "${folder.name}"`} onClose={onClose} width={560} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <p className="v2-sub" style={{ marginTop: 0 }}>A role granted here applies to <strong>every project in this folder</strong>, including projects added later. Project-level membership still applies on top; the stronger of the two wins.</p>
      {acc.loading ? <Loading /> : (
        <div className="v2-stack">
          {rows.length === 0 ? <Empty title="No folder-level grants" /> : (
            <table className="v2-table"><tbody>{rows.map((g) => (
              <tr key={g.userId}>
                <td><strong>{g.fullName}</strong> <span className="v2-hint">@{g.username}</span></td>
                <td style={{ width: 130 }}>
                  <select className="v2-select" value={g.role} onChange={(e) => setGrants(rows.map((x) => (x.userId === g.userId ? { ...x, role: e.target.value } : x)))}>
                    {(['viewer', 'reviewer', 'editor', 'owner'] as ProjectRole[]).map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{ width: 40 }}><button className="icon-btn" aria-label={`Remove ${g.username}`} onClick={() => setGrants(rows.filter((x) => x.userId !== g.userId))}><Icon name="trash" /></button></td>
              </tr>))}</tbody></table>
          )}
          {users.data && users.data.length > 0 ? (
            <div className="v2-row">
              <select className="v2-select" value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Add a person…</option>
                {users.data.filter((u) => !u.disabled && !rows.some((r) => r.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.fullName} (@{u.username})</option>)}
              </select>
              <button className="btn" disabled={!add} onClick={() => { const u = users.data!.find((x) => x.id === add)!; setGrants([...rows, { userId: u.id, username: u.username, fullName: u.fullName, role: 'viewer' }]); setAdd(''); }}>Add</button>
            </div>
          ) : <div className="v2-hint">Only an administrator can browse the user directory to add people here.</div>}
          {err ? <Alert tone="bad">{err}</Alert> : null}
        </div>
      )}
    </Modal>
  );
}

export function Workspace() {
  const toast = useUi((s) => s.toast);
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  const ws = useAsync(() => workspaceApi.workspace(), []);
  const [creating, setCreating] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [rename, setRename] = useState<FolderView | null>(null);
  const [del, setDel] = useState<FolderView | null>(null);
  const [access, setAccess] = useState<FolderView | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const ctx = useContextMenu();             // WP-35 (UID-005): right-click, the Menu key or Shift+F10 on a folder heading: its own buttons as a menu

  if (ws.loading && !ws.data) return <Loading />;
  if (ws.error || !ws.data) return <div className="v2-page"><Alert tone="bad">{ws.error}</Alert></div>;
  const { folders, ungrouped } = ws.data;
  const match = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());
  const folderNames = folders.map((f) => f.name);
  const total = folders.reduce((n, f) => n + f.projects.length, 0) + ungrouped.length;

  return (
    <div className="v2-page">
      <div className="v2-page-head">
        <div><h2>Workspace</h2><p className="v2-sub">{total} project{total === 1 ? '' : 's'} in {folders.length} folder{folders.length === 1 ? '' : 's'}.</p></div>
        <div className="v2-row">
          <input className="v2-input" style={{ width: 220 }} placeholder="Filter projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter projects" />
          {isAdmin ? null : <SampleMenu onCreated={() => ws.reload()} />}
          <button className="btn" onClick={() => setNewFolder(true)}><Icon name="folderPlus" />New folder</button>
          {isAdmin ? null : <button className="btn btn-primary" onClick={() => setCreating('')}><Icon name="plus" />New project</button>}
        </div>
      </div>

      {folders.map((f) => {
        const projects = f.projects.filter((p) => match(p.name));
        if (q && projects.length === 0) return null;
        return (
          <section key={f.key} className="v2-folder" aria-label={`Folder ${f.name}`}>
            <div className="v2-folder-head" {...ctx.bind(`Folder ${f.name}`, [
              ...(isAdmin ? [] : [{ label: 'New project here', icon: 'plus' as const, onSelect: () => setCreating(f.name) }]),
              ...(f.canManage ? [
                { label: 'Folder access…', icon: 'users' as const, onSelect: () => setAccess(f) },
                { label: 'Rename folder…', icon: 'edit' as const, onSelect: () => setRename(f) },
                { label: 'Delete folder…', icon: 'trash' as const, danger: true, onSelect: () => setDel(f) },
              ] : []),
            ])}>
              <Icon name="folderOpen" /><h3>{f.name}</h3>
              <span className="v2-hint">{f.projects.length} project{f.projects.length === 1 ? '' : 's'}{f.owner ? ` · owned by ${f.owner.fullName}` : ''}</span>
              <span className="spacer" />
              {isAdmin ? null : <button className="btn btn-sm" onClick={() => setCreating(f.name)}><Icon name="plus" size={13} />Project</button>}
              {f.canManage ? <>
                <button className="icon-btn" title="Folder access" aria-label={`Access to ${f.name}`} onClick={() => setAccess(f)}><Icon name="users" /></button>
                <button className="icon-btn" title="Rename folder" aria-label={`Rename ${f.name}`} onClick={() => setRename(f)}><Icon name="edit" /></button>
                <button className="icon-btn" title="Delete folder" aria-label={`Delete ${f.name}`} onClick={() => setDel(f)}><Icon name="trash" /></button>
              </> : null}
            </div>
            {projects.length === 0 ? <div className="v2-card"><Empty title="Empty folder">Create a project here, or move one in from its settings.</Empty></div>
              : <div className="v2-grid cols-3">{projects.map((p) => <ProjectCardView key={p.id} p={p} />)}</div>}
          </section>
        );
      })}

      {(ungrouped.filter((p) => match(p.name)).length > 0 || folders.length === 0) ? (
        <section className="v2-folder" aria-label="Projects not in a folder">
          <div className="v2-folder-head"><Icon name="folder" /><h3>Not in a folder</h3></div>
          {ungrouped.length === 0
            ? <div className="v2-card"><Empty title="Nothing here yet">Create a project to get started.</Empty></div>
            : <div className="v2-grid cols-3">{ungrouped.filter((p) => match(p.name)).map((p) => <ProjectCardView key={p.id} p={p} />)}</div>}
        </section>
      ) : null}

      {ctx.menu}
      {creating !== null ? <CreateProjectModal folders={folderNames} defaultFolder={creating} onClose={() => setCreating(null)} onCreated={() => ws.reload()} /> : null}
      {newFolder ? <PromptModal title="New folder" label="Folder name" confirmLabel="Create folder" onClose={() => setNewFolder(false)} onSubmit={async (n) => { await workspaceApi.createFolder(n); toast(`Folder "${n}" created`, 'success'); ws.reload(); }} /> : null}
      {rename ? <PromptModal title="Rename folder" label="Folder name" initial={rename.name} onClose={() => setRename(null)} onSubmit={async (n) => { await workspaceApi.renameFolder(rename.key, n); ws.reload(); }} /> : null}
      {access ? <FolderAccessModal folder={access} onClose={() => setAccess(null)} /> : null}
      {del ? (
        <ConfirmModal title={`Delete "${del.name}"?`} danger busy={busy} confirmLabel="Delete folder" onClose={() => setDel(null)}
          body={<><p style={{ marginTop: 0 }}>The folder is removed. {del.projects.length ? `Its ${del.projects.length} project${del.projects.length === 1 ? '' : 's'} move to “Not in a folder” — nothing is deleted.` : ''}</p>{isAdmin && del.projects.length ? <p className="v2-hint">Administrators can also delete a folder together with its projects from the API; it is deliberately not offered here.</p> : null}</>}
          onConfirm={async () => { setBusy(true); try { await workspaceApi.deleteFolder(del.key); setDel(null); ws.reload(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); } }} />
      ) : null}
    </div>
  );
}

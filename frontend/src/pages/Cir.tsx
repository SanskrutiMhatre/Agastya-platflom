// Common Information Repository: one shared pool of common data modules. Everyone can browse it, create
// modules in it (the normal editor and wizard, in the repository's own workspace) or upload them, and edit
// them; only a Project Manager or an administrator deletes. A module is reused by copying it into a project.

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { cirApi, workspaceApi, type CirModule } from '../api';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, ConfirmModal, Empty, Loading, Modal, ago, errText, fmtDate, useAsync } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { may } from '../lib/roles';

// The copy route checks dm.write on the target project; the server's `can` map on each card says where that holds (WP-13, FE-019).

export function CirPage() {
  const toast = useUi((s) => s.toast);
  const nav = useNavigate();
  const me = useSession((s) => s.user);
  const list = useAsync(() => cirApi.list(), []);
  const projects = useAsync(() => workspaceApi.projects(), []);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [use, setUse] = useState<CirModule | null>(null);
  const [look, setLook] = useState<{ file: string; xml: string } | null>(null);
  const [del, setDel] = useState<CirModule | null>(null);

  const modules = list.data?.modules ?? [];
  const workspace = list.data?.workspace;
  const rows = useMemo(() => modules.filter((m) => !q || `${m.file} ${m.title ?? ''} ${m.infoName ?? ''} ${m.kind ?? ''} ${m.note ?? ''}`.toLowerCase().includes(q.toLowerCase())), [modules, q]);
  const mayDelete = me?.role !== 'author';                                  // only a Project Manager or an administrator deletes

  return (
    <div className="v2-page">
      <PageHeader icon="library" title="Common information repository" sub="Data modules shared by everyone. Add one for others to reuse, or copy one into your project."
        actions={<>
          <button className="btn" onClick={() => setAdding(true)} data-testid="cir-add"><Icon name="upload" />Upload data modules</button>
          <button className="btn btn-primary" disabled={!workspace} onClick={() => nav(`/projects/${workspace}/editor?create=1`)} data-testid="cir-create"><Icon name="plus" />Create data module</button>
        </>}
        stats={[{ label: 'Modules', value: modules.length }]} />
      <div className="v2-row"><input className="v2-input" style={{ maxWidth: 320 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter common data modules" /></div>
      {list.error ? <Alert tone="bad">{list.error}</Alert> : null}
      <div className="v2-card" data-testid="cir-list">
        {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <Empty title={q ? 'No module matches' : 'The repository is empty'}>{q ? undefined : 'Create a data module here, or upload one, for other people to reuse.'}</Empty> : (
          <div className="v2-scroll-x"><table className="v2-table">
            <thead><tr><th>Data module</th><th>Kind</th><th>Note</th><th>Added by</th><th /></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id} data-testid="cir-row" data-file={m.file}>
                <td><b>{m.title || m.file}</b><div className="v2-hint v2-mono" title={m.file}>{m.dmc ?? m.file}{m.infoName ? ` · ${m.infoName}` : ''}</div></td>
                <td><Badge>{m.kind ?? 'Common module'}</Badge></td>
                <td className="v2-hint">{m.note ?? ''}</td>
                <td title={fmtDate(m.addedAt)}>{m.addedByName ?? '—'}<div className="v2-hint">{ago(m.addedAt)}</div></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={async () => { try { setLook(await cirApi.read(m.id)); } catch (e) { toast(errText(e), 'error'); } }}><Icon name="eye" size={13} />View</button>{' '}
                  <button className="btn btn-sm" disabled={!workspace} onClick={() => nav(`/projects/${workspace}/editor?file=${encodeURIComponent(m.file)}`)} data-testid="cir-edit"><Icon name="edit" size={13} />Edit</button>{' '}
                  <button className="btn btn-sm btn-primary" onClick={() => setUse(m)} data-testid="cir-use"><Icon name="copy" size={13} />Add to project</button>
                  {mayDelete ? <>{' '}<button className="icon-btn" aria-label={`Remove ${m.file}`} title="Remove from the repository" onClick={() => setDel(m)}><Icon name="trash" size={14} /></button></> : null}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      {adding ? <AddModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /> : null}
      {use ? (
        <UseModal module={use} projects={(projects.data ?? []).filter((p) => may(p.can, 'dm.write'))} onClose={() => setUse(null)} />
      ) : null}
      {look ? <Modal title={look.file} width={760} onClose={() => setLook(null)} buttons={<button className="btn" onClick={() => setLook(null)}>Close</button>}><pre className="v2-pre" style={{ maxHeight: '60vh', overflow: 'auto', margin: 0 }}>{look.xml}</pre></Modal> : null}
      {del ? (
        <ConfirmModal title="Remove from the repository?" danger confirmLabel="Remove" onClose={() => setDel(null)}
          body={<p style={{ marginTop: 0 }}><strong>{del.file}</strong> is removed for everyone. Copies already placed in projects are not affected.</p>}
          onConfirm={async () => { const m = del; setDel(null); try { await cirApi.remove(m.id); toast(`Removed ${m.file}`, 'success'); list.reload(); } catch (e) { toast(errText(e), 'error'); } }} />
      ) : null}
    </div>
  );
}

function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    setBusy(true); setProblems([]); setErr('');
    try {
      let r;
      try { r = await cirApi.add(files, note); }
      catch (e) {
        // WP-11: some are already in the repository. Replacing them is a deliberate step: ask, then send again naming the versions replaced.
        const existing = (e as ApiError).code === 'CIR_EXISTS' ? (e as ApiError).body?.existing as Array<{ file: string; hash: string }> | undefined : undefined;
        if (!existing?.length || !window.confirm(`${errText(e)}\n\nReplace ${existing.map((x) => x.file).join(', ')}?`)) throw e;
        r = await cirApi.add(files, note, Object.fromEntries(existing.map((x) => [x.file, x.hash])));
      }
      toast(`Added ${r.added.length} data module${r.added.length === 1 ? '' : 's'} to the repository`, 'success'); onDone(); }
    catch (e) { const p = (e as ApiError).body?.problems as string[] | undefined; if (p?.length) setProblems(p); else setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Upload to the repository" onClose={onClose} width={560} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !files.length} onClick={submit} data-testid="cir-submit">Add</button></>}>
      <div className="v2-stack">
        <div>
          <button className="btn" onClick={() => input.current?.click()}><Icon name="upload" />Choose data modules…</button>
          <input ref={input} type="file" hidden multiple accept=".xml,.XML" onChange={(e) => setFiles([...(e.target.files ?? [])])} data-testid="cir-file" />
          <div className="v2-hint" style={{ marginTop: 6 }}>{files.length ? files.map((f) => f.name).join(', ') : 'DMC-….xml files. Each must be a well-formed S1000D data module, and its enterprises must be registered.'}</div>
        </div>
        <label className="v2-stack" style={{ gap: 4 }}>Note<input className="v2-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is this for?" /></label>
        {problems.length ? <Alert tone="bad"><b>Nothing was added.</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert> : null}
        {err ? <Alert tone="bad">{err}</Alert> : null}
      </div>
    </Modal>
  );
}

function UseModal({ module: m, projects, onClose }: { module: CirModule; projects: Array<{ id: string; name: string }>; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const [pid, setPid] = useState(projects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await cirApi.copy(m.id, pid); toast(`${m.file} was added to the project`, 'success'); onClose(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Add to a project" onClose={onClose} width={480} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !pid} onClick={go} data-testid="cir-copy">Add</button></>}>
      <div className="v2-stack">
        <p style={{ margin: 0 }}>A copy of <strong>{m.file}</strong> becomes a data module of the project you choose. Changing it there does not change the repository.</p>
        {projects.length === 0 ? <Alert>You have no project you can edit. Create one first.</Alert> : (
          <label className="v2-stack" style={{ gap: 4 }}>Project
            <select className="v2-select" value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
        )}
        {err ? <Alert tone="bad">{err}</Alert> : null}
      </div>
    </Modal>
  );
}

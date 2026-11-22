// A project's own graphics: ICN artwork (beside the data modules) and symbols (icons). Nothing from
// any other project appears here.

import { useRef, useState, type DragEvent } from 'react';
import { ApiError } from '../../api/client';
import { graphicsApi, type Graphic } from '../../api';
import { Icon } from '../../components/Icon';
import { GraphicsView } from '../../components/GraphicsView';
import { PageHeader } from '../../components/PageHeader';
import { Alert, ConfirmModal, Loading, errText, useAsync } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { useUi } from '../../store/ui';

export function ProjectGraphicsPage() {
  const { id, role, summary } = useProject();
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => graphicsApi.list(id), [id]);
  const [kind, setKind] = useState<'auto' | 'icn' | 'symbol'>('auto');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [del, setDel] = useState<Graphic | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const writable = canWrite(role);

  const upload = async (files: FileList | File[] | null) => {
    const f = files ? [...files] : [];
    if (!f.length) return;
    setBusy(true); setProblems([]);
    try {
      const r = await graphicsApi.upload(id, f, kind === 'auto' ? undefined : kind);
      toast(`Added ${r.added.length} graphic${r.added.length === 1 ? '' : 's'}`, 'success');
      list.reload();
    } catch (e) {
      const p = (e as ApiError).body?.problems as string[] | undefined;
      if (p?.length) setProblems(p); else toast(errText(e), 'error');
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (writable) void upload(e.dataTransfer.files); };

  const remove = async (g: Graphic, force = false) => {
    try { await graphicsApi.remove(id, g.name, force); toast(`Deleted ${g.name}`, 'success'); setDel(null); list.reload(); }
    catch (e) { toast(errText(e), 'error'); setDel(null); }
  };

  const all = list.data ?? [];
  return (
    <div className="v2-page">
      <PageHeader icon="image" title="Graphics" sub={`ICN artwork and symbols of ${summary.project.name}.`}
        stats={[{ label: 'ICNs', value: all.filter((g) => g.kind === 'icn').length }, { label: 'Symbols', value: all.filter((g) => g.kind === 'symbol').length }, { label: 'Not used', value: all.filter((g) => !g.usedBy.length).length }]} />
      {writable ? (
        <div className={`v2-card v2-card-pad v2-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop} data-testid="graphics-drop">
          <div className="v2-row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Icon name="upload" size={18} />
            <span>Drop images here, or</span>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => input.current?.click()} data-testid="graphics-add">Add graphics…</button>
            <input ref={input} type="file" hidden multiple accept=".png,.jpg,.jpeg,.gif,.svg,.bmp,.webp" onChange={(e) => void upload(e.target.files)} data-testid="graphics-file" />
            <label className="v2-row" style={{ gap: 6, marginLeft: 'auto' }}>As
              <select className="v2-select" style={{ height: 30 }} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Add as">
                <option value="auto">Detect from the name</option><option value="icn">ICN artwork</option><option value="symbol">Symbol (icon)</option>
              </select>
            </label>
          </div>
          <p className="v2-hint" style={{ marginBottom: 0 }}>An ICN is named <b>ICN-…</b> and sits beside the data modules, where the figure's entity finds it. A symbol is any other image and is kept in the project's media folder.</p>
        </div>
      ) : null}
      {problems.length ? <Alert tone="bad"><b>Nothing was added.</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert> : null}
      {list.error ? <Alert tone="bad">{list.error}</Alert> : null}
      {list.loading && !list.data ? <Loading /> : <GraphicsView projectId={id} graphics={all} onDelete={writable ? setDel : undefined} empty="This project has no graphics yet." />}
      {del ? (
        <ConfirmModal title="Delete graphic?" danger confirmLabel={del.usedBy.length ? 'Delete anyway' : 'Delete'} onClose={() => setDel(null)}
          body={<><p style={{ marginTop: 0 }}><strong>{del.name}</strong> is removed from this project.</p>{del.usedBy.length ? <p className="v2-error">It is used by {del.usedBy.length} data module{del.usedBy.length === 1 ? '' : 's'} ({del.usedBy.slice(0, 3).join(', ')}{del.usedBy.length > 3 ? ', …' : ''}); those figures will be blank.</p> : null}</>}
          onConfirm={() => remove(del, del.usedBy.length > 0)} />
      ) : null}
    </div>
  );
}

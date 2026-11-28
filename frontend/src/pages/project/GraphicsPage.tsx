// A project's own graphics: ICN artwork (beside the data modules) and symbols (icons). Nothing from
// any other project appears here.

import { useRef, useState, type DragEvent } from 'react';
import { ApiError } from '../../api/client';
import { graphicsApi, type Graphic } from '../../api';
import { Icon } from '../../components/Icon';
import { GraphicsView } from '../../components/GraphicsView';
import { PageHeader } from '../../components/PageHeader';
import { Callout, ConfirmModal, Loading, Spinner, errText, useAsync } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { useUi } from '../../store/ui';

export function ProjectGraphicsPage() {
  const { id, role, can, summary } = useProject();
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => graphicsApi.list(id), [id]);
  const [kind, setKind] = useState<'auto' | 'icn' | 'symbol'>('auto');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [del, setDel] = useState<Graphic | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const writable = canWrite(can);

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
    <div className="v2-page pp">
      <PageHeader icon="image" title="Graphics" sub={`ICN artwork and symbols of ${summary.project.name}.`}
        actions={writable ? <button className="btn primary" disabled={busy} onClick={() => input.current?.click()} data-testid="graphics-add">{busy ? <Spinner /> : <Icon name="upload" size={16} />}Add graphics…</button> : null}
        stats={[{ label: 'ICNs', value: all.filter((g) => g.kind === 'icn').length }, { label: 'Symbols', value: all.filter((g) => g.kind === 'symbol').length }, { label: 'Not used', value: all.filter((g) => !g.usedBy.length).length, tone: all.some((g) => !g.usedBy.length) ? 'warn' : undefined }]} />
      {writable ? (
        <section className={`card v2-drop pp-gap ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop} data-testid="graphics-drop" aria-label="Add graphics">
          <div className="card-body">
            <div className="v2-drop-row">
              <Icon name="upload" size={18} />
              <span>Drop images here, or use <strong>Add graphics…</strong> above.</span>
              <input ref={input} type="file" hidden multiple accept=".png,.jpg,.jpeg,.gif,.svg,.bmp,.webp" onChange={(e) => void upload(e.target.files)} data-testid="graphics-file" />
              <label className="v2-drop-as">As
                <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Add as">
                  <option value="auto">Detect from the name</option><option value="icn">ICN artwork</option><option value="symbol">Symbol (icon)</option>
                </select>
              </label>
            </div>
            <p className="pp-note">An ICN is named <b>ICN-…</b> and sits beside the data modules, where the figure's entity finds it. A symbol is any other image and is kept in the project's media folder.</p>
          </div>
        </section>
      ) : null}
      {problems.length ? <div className="pp-gap"><Callout tone="danger" title="Nothing was added."><ul className="v2-gfx-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Callout></div> : null}
      {list.error ? <div className="pp-gap"><Callout tone="danger" title="The graphics could not be read">{list.error}</Callout></div> : null}
      <section className="card" aria-labelledby="gfx-lib-h">
        <div className="card-head"><h3 id="gfx-lib-h"><Icon name="library" />Library</h3><span className="faint">{all.length} graphic{all.length === 1 ? '' : 's'}</span></div>
        <div className="card-body">
          {list.loading && !list.data ? <Loading /> : <GraphicsView projectId={id} graphics={all} onDelete={writable ? setDel : undefined} empty="This project has no graphics yet." />}
        </div>
      </section>
      {del ? (
        <ConfirmModal title="Delete graphic?" danger icon="trash" confirmLabel={del.usedBy.length ? 'Delete anyway' : 'Delete'} onClose={() => setDel(null)}
          body={<><p><strong>{del.name}</strong> is removed from this project.</p>{del.usedBy.length ? <p className="v2-error">It is used by {del.usedBy.length} data module{del.usedBy.length === 1 ? '' : 's'} ({del.usedBy.slice(0, 3).join(', ')}{del.usedBy.length > 3 ? ', …' : ''}); those figures will be blank.</p> : null}</>}
          onConfirm={() => remove(del, del.usedBy.length > 0)} />
      ) : null}
    </div>
  );
}

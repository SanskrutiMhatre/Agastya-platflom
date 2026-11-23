// The editor's left panel: the project's data modules, shown as the publication's chapter
// hierarchy (as saved in Publication) or as a flat list of every module. Project-level
// functions (release, watermark, publication settings) are intentionally NOT here.

import { useMemo, useRef, useState } from 'react';
import { contentApi, IMPORT_MAX_FILES, type DmSummary, type ExploreNode } from '../../../api';
import { Icon } from '../../../components/Icon';
import { ConfirmModal, Modal, errText, useAsync } from '../../../components/ui';
import { canWrite, type ProjectCtx } from '../../../layouts/ProjectShell';
import { CirPicker } from '../../../components/CirPicker';
import { canImportPackage } from '../../../lib/roles';
import { ImportPackageDialog } from './ImportPackageDialog';
import { studio, useStudio } from '../../../lib/studioSession';
import { useSession } from '../../../store/session';
import { useUi } from '../../../store/ui';

type View = 'tree' | 'all';

export function EditorSide({ ctx, refreshKey, width, onCollapse }: { ctx: ProjectCtx; refreshKey: number; width: number; onCollapse: () => void }) {
  const toast = useUi((s) => s.toast);
  const docs = useStudio((s) => s.docs);
  const list = useAsync(() => contentApi.dms(ctx.id), [ctx.id, refreshKey]);
  const explore = useAsync(() => contentApi.explore(ctx.id), [ctx.id, refreshKey]);
  const [q, setQ] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);   // the "Import package" dialog (editor/ImportPackageDialog.tsx)
  const [refused, setRefused] = useState<{ files: File[]; problems: string[]; otherModel?: Array<{ file: string; mic: string }>; projectMic?: string } | null>(null);   // an import the server refused, kept so it can be repeated without validation
  const isCir = ctx.summary.project.type === 'CIR';
  const globalRole = useSession((s) => s.user?.role);
  const mayDelete = !isCir || globalRole !== 'author';          // in the shared repository only a Project Manager or an administrator deletes
  const [viewPref, setViewPref] = useState<View | null>(() => { try { const v = localStorage.getItem('agastya.editor.dmview'); return v === 'all' || v === 'tree' ? v : null; } catch { return null; } });
  const [closed, setClosed] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(`agastya.editor.closed.${ctx.id}`) ?? '[]')); } catch { return new Set(); } });
  const fileInput = useRef<HTMLInputElement>(null);
  const rawInput = useRef<HTMLInputElement>(null);       // the same picker, for "Import without validation"
  const writable = canWrite(ctx.role);

  const hasChapters = !isCir && (explore.data?.counts.folders ?? 0) > 0;
  const view: View = isCir ? 'all' : viewPref ?? (hasChapters ? 'tree' : 'all');
  const setView = (v: View) => { setViewPref(v); try { localStorage.setItem('agastya.editor.dmview', v); } catch { /* private mode */ } };
  const toggle = (key: string) => setClosed((c) => {
    const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key);
    try { localStorage.setItem(`agastya.editor.closed.${ctx.id}`, JSON.stringify([...n])); } catch { /* private mode */ }
    return n;
  });

  const openMap = useMemo(() => new Map(docs.filter((d) => d.file).map((d) => [d.file!, d])), [docs]);
  const untitled = docs.filter((d) => !d.file);
  const byFile = useMemo(() => new Map((list.data ?? []).map((d) => [d.file, d])), [list.data]);
  const match = (d: { file: string; title?: string; dmc?: string; techName?: string; infoName?: string }) =>
    !q || `${d.file} ${d.title ?? ''} ${d.techName ?? ''} ${d.infoName ?? ''} ${d.dmc ?? ''}`.toLowerCase().includes(q.toLowerCase());

  const open = (file: string) => { studio.openDm(file).catch((e) => toast(errText(e), 'error')); };

  /** Data modules (.xml) and graphics (images) can be imported together; graphics go beside the modules so ICN entities resolve. */
  const doImport = async (files: FileList | File[] | null, skipChecks = false, otherModel?: 'keep' | 'recode') => {
    if (!files?.length) return;
    const all = [...files];
    const images = all.filter((f) => /\.(png|jpe?g|gif|svg|bmp|webp)$/i.test(f.name));
    const xml = all.filter((f) => !images.includes(f));
    if (fileInput.current) fileInput.current.value = '';
    if (rawInput.current) rawInput.current.value = '';
    if (xml.length > IMPORT_MAX_FILES) { toast(`Too many data modules: one import takes at most ${IMPORT_MAX_FILES} (you selected ${xml.length}). Import them in batches.`, 'error'); return; }
    try {
      const said: string[] = [];
      let flagged: Array<{ file: string; problem: string }> = [];
      if (xml.length) { const r = await contentApi.importDms(ctx.id, xml, false, skipChecks, otherModel); flagged = r.withProblems ?? []; said.push(`${r.imported.length} data module${r.imported.length === 1 ? '' : 's'}`); }
      for (const img of images) await contentApi.uploadMedia(ctx.id, img, 'csdb');
      if (images.length) { said.push(`${images.length} graphic${images.length === 1 ? '' : 's'}`); await studio.relinkArtwork(); }
      toast(`Imported ${said.join(' and ')}${skipChecks ? ' without validation' : ''}`, 'success');
      if (flagged.length) toast(`${flagged.length} imported file${flagged.length === 1 ? ' has' : 's have'} content problems and will fail validation until fixed: ${flagged.slice(0, 3).map((f) => f.file).join(', ')}${flagged.length > 3 ? ', …' : ''}`, 'error');
      void studio.refreshProjectData();
      list.reload(); explore.reload(); ctx.reload();
    } catch (e) {
      const body = (e as { body?: { problems?: string[]; otherModel?: Array<{ file: string; mic: string }>; projectMic?: string } }).body;
      const problems = body?.problems;
      if (problems?.length) setRefused({ files: all, problems, otherModel: body?.otherModel, projectMic: body?.projectMic });      // shown with the choice to import anyway
      else toast(errText(e), 'error');
    }
  };

  /** The package dialog wrote modules, graphics or the publication: bring every list that shows them up to date. */
  const onPackageChanged = ({ media }: { media: boolean }) => {
    void studio.refreshProjectData();
    if (media) void studio.relinkArtwork();
    list.reload(); explore.reload(); ctx.reload();
  };

  const row = ({ file, title, sub, indent = 0 }: { file: string; title: string; sub: string; indent?: number }) => {
    const o = openMap.get(file);
    const locked = byFile.get(file)?.locked;
    return (
      <div key={file} className="v2-row" style={{ gap: 0, paddingLeft: indent * 14 }}>
        <button className={`v2-dm ${o?.active ? 'active' : ''}`} style={{ flex: 1, minWidth: 0 }} onClick={() => open(file)} title={`${sub}\n${file}`} data-file={file} data-testid="dm-row">
          <span className={`v2-dot ${o ? (o.dirty ? 'dirty' : 'open') : ''}`} />
          <span className="t"><b>{title || file}</b><span>{sub}{locked ? ' · locked' : ''}</span></span>
        </button>
        {locked ? <Icon name="lock" size={13} /> : null}
        {writable && mayDelete ? <button className="icon-btn" style={{ opacity: .55 }} aria-label={`Delete ${file}`} title="Delete" onClick={() => setDel(file)}><Icon name="trash" size={13} /></button> : null}
      </div>
    );
  };

  /** Chapters with their modules, in publication order. A chapter is shown when it, or anything in it, matches the filter. */
  const renderNodes = (nodes: ExploreNode[], depth: number, path: string): React.ReactNode[] => nodes.flatMap((n, i): React.ReactNode[] => {
    const key = `${path}/${i}`;
    if (n.kind === 'chapter') {
      const inner = renderNodes(n.children, depth + 1, key);
      if (q && inner.length === 0) return [];
      const shut = !q && closed.has(key);
      return [(
        <div key={key} data-testid="chapter-node">
          <button className="v2-chap" style={{ paddingLeft: 4 + depth * 14 }} onClick={() => toggle(key)} aria-expanded={!shut}>
            <Icon name={shut ? 'right' : 'down'} size={13} /><Icon name="folder" size={14} /><span className="v2-trunc">{n.title || 'Untitled chapter'}</span><span className="v2-hint">{n.dmCount}</span>
          </button>
          {shut ? null : inner}
        </div>
      )];
    }
    if (n.kind === 'dm') {
      const d = byFile.get(n.file);
      if (!match({ file: n.file, title: n.title, dmc: n.dmc, infoName: n.infoName, techName: d?.techName })) return [];
      return [row({ file: n.file, title: d?.techName || n.title, sub: n.infoName || n.dmc, indent: depth + 0.5 })];
    }
    if (n.kind === 'missing' && !q) return [<div key={key} className="v2-hint" style={{ padding: `2px 8px 2px ${12 + depth * 14}px` }} title="Listed in the publication but not in the project">Missing: {n.ref}</div>];
    return [];
  });

  const rows: DmSummary[] = (list.data ?? []).filter(match);
  const tree = explore.data ? renderNodes(explore.data.tree, 0, 'r') : [];
  const unplaced = (explore.data?.unplaced ?? []).filter(match);

  return (
    <aside className="v2-dmpanel" aria-label="Data modules" style={{ flex: `0 0 ${width}px`, width }}>
      <div className="v2-dmpanel-head v2-row v2-spread">
        <h2 title={ctx.summary.project.name}>{ctx.summary.project.name}</h2>
        <button className="icon-btn" onClick={onCollapse} title="Hide this panel" aria-label="Hide the data module panel" data-testid="collapse-side"><Icon name="panel" size={15} /></button>
      </div>
      <section className="v2-pside-section" style={{ flex: 1, minHeight: 120, borderTop: 0 }} aria-label="Data module list">
        <header style={{ gap: 4 }}>
          {isCir ? <b className="v2-trunc" style={{ fontSize: 12.5 }}>{list.data?.length ?? 0} common data modules</b> : (
            <div className="v2-seg" role="group" aria-label="Show">
              <button className={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')} aria-pressed={view === 'tree'} data-testid="view-tree">Publication</button>
              <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')} aria-pressed={view === 'all'} data-testid="view-all" title={`${list.data?.length ?? 0} data modules`}>All</button>
            </div>)}
          <span className="spacer" />
          {writable ? <>
            <button className="btn btn-sm btn-primary" title="Write a new data module" aria-label="New data module" data-testid="new-dm" onClick={() => studio.newDocument()}><Icon name="plus" size={13} />New</button>
            <span className="v2-vsep" aria-hidden="true" />
            <button className="icon-btn" title="Import data modules (.xml) and graphics" aria-label="Import data modules and graphics" onClick={() => fileInput.current?.click()}><Icon name="upload" size={14} /></button>
            <button className="icon-btn" title="Import without validation: brings in every file as it is (enterprise and content checks skipped)" aria-label="Import without validation" data-testid="import-raw" onClick={() => rawInput.current?.click()}><Icon name="warn" size={14} /></button>
            {canImportPackage(ctx.role) && !isCir ? <button className="icon-btn" title="Import a package: a folder, a .zip or files from another S1000D tool, scanned and repaired first" aria-label="Import package" data-testid="import-package" onClick={() => setPackageOpen(true)}><Icon name="package" size={14} /></button> : null}
            {isCir ? null : <button className="icon-btn" title="Add a data module from the common repository" aria-label="Add from the common repository" onClick={() => setPicking(true)} data-testid="cir-pick"><Icon name="library" size={14} /></button>}
            <input ref={fileInput} type="file" accept=".xml,.XML,.png,.jpg,.jpeg,.gif,.svg,.bmp,.webp" multiple hidden onChange={(e) => void doImport(e.target.files)} />
            <input ref={rawInput} data-testid="import-raw-input" type="file" accept=".xml,.XML,.png,.jpg,.jpeg,.gif,.svg,.bmp,.webp" multiple hidden onChange={(e) => void doImport(e.target.files, true)} />
          </> : null}
          <button className="icon-btn" title="Refresh" aria-label="Refresh list" onClick={() => { list.reload(); explore.reload(); }}><Icon name="refresh" size={14} /></button>
        </header>
        <div className="v2-filter">
          <Icon name="search" size={13} />
          <input className="v2-input" placeholder="Search by title, code or file…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} aria-label="Filter data modules" />
          {q ? <button className="icon-btn" aria-label="Clear the filter" title="Clear (Esc)" onClick={() => setQ('')}><span aria-hidden="true">×</span></button> : null}
        </div>
        <div className="v2-hint v2-dmcount" aria-live="polite">
          {q ? `${rows.length} of ${list.data?.length ?? 0} data modules match` : `${list.data?.length ?? 0} data module${(list.data?.length ?? 0) === 1 ? '' : 's'}`}
          {docs.some((d) => d.dirty) ? <> · <span style={{ color: 'var(--warning)' }}>{docs.filter((d) => d.dirty).length} unsaved</span></> : null}
        </div>
        <div className="v2-dmlist" data-testid="dm-list">
          {untitled.map((d) => (
            <button key={d.key} className={`v2-dm ${d.active ? 'active' : ''}`} onClick={() => studio.focusEditor()}>
              <span className={`v2-dot ${d.dirty ? 'dirty' : 'open'}`} /><span className="t"><b>{d.title}</b><span>New, not saved to the project yet</span></span>
            </button>
          ))}
          {list.loading && !list.data ? <div className="v2-hint" style={{ padding: 8 }}>Loading…</div> : null}
          {list.error ? <div className="v2-error" style={{ padding: 8 }}>{list.error}</div> : null}

          {view === 'tree' ? (
            <>
              {tree}
              {unplaced.length ? (
                <div data-testid="unplaced-group">
                  <div className="v2-chap static" title="Not placed in the publication yet. Add them from the Publication tab.">Not in the publication <span className="v2-hint">{unplaced.length}</span></div>
                  {unplaced.map((d) => row({ file: d.file, title: d.techName, sub: d.infoName || d.dmc, indent: 0.5 }))}
                </div>
              ) : null}
              {!explore.loading && !tree.length && !unplaced.length && !untitled.length ? <div className="v2-hint" style={{ padding: 10 }}>{q ? 'No data module matches.' : 'No chapters yet. Arrange them in the Publication tab.'}</div> : null}
            </>
          ) : (
            <>
              {rows.map((d) => row({ file: d.file, title: d.techName, sub: d.infoName || d.dmc }))}
              {!list.loading && rows.length === 0 && !untitled.length ? <div className="v2-hint" style={{ padding: 10 }}>{q ? <>No data module matches “{q}”. <button className="v2-link" onClick={() => setQ('')}>Clear the search</button></> : <>No data modules yet. Press <b>New</b> to write one, or use the upload button to import existing files.</>}</div> : null}
            </>
          )}
        </div>
      </section>
      {picking ? <CirPicker projectId={ctx.id} existing={new Set((list.data ?? []).map((d) => d.file))} onClose={() => setPicking(false)} onAdded={() => { list.reload(); explore.reload(); void studio.refreshProjectData(); ctx.reload(); }} /> : null}
      {packageOpen ? <ImportPackageDialog projectId={ctx.id} role={ctx.role} onClose={() => setPackageOpen(false)} onChanged={onPackageChanged} /> : null}
      {refused ? (
        <Modal title="Import refused" width={620} onClose={() => setRefused(null)} buttons={<>
          <button className="btn" onClick={() => setRefused(null)}>Cancel</button>
          {refused.otherModel?.length ? <>
            <button className="btn" data-testid="import-keep-code" title="The modules keep their own model code and are imported as shared modules of another model" onClick={() => { const f = refused.files; setRefused(null); void doImport(f, false, 'keep'); }}>Keep their own model code</button>
            <button className="btn btn-primary" data-testid="import-recode" title={`Rename them and every reference to them to ${refused.projectMic}`} onClick={() => { const f = refused.files; setRefused(null); void doImport(f, false, 'recode'); }}>Change them to {refused.projectMic}</button>
          </> : null}
          <button className="btn btn-primary" data-testid="import-anyway" onClick={() => { const f = refused.files; setRefused(null); void doImport(f, true); }}>Import without validation</button>
        </>}>
          <p style={{ marginTop: 0 }}>Nothing was imported. {refused.problems.length} problem{refused.problems.length === 1 ? '' : 's'} found:</p>
          <ul data-testid="import-problems" style={{ maxHeight: 220, overflow: 'auto', paddingLeft: 18, margin: '0 0 10px' }}>
            {refused.problems.slice(0, 50).map((p, i) => <li key={i}>{p}</li>)}
            {refused.problems.length > 50 ? <li>… and {refused.problems.length - 50} more</li> : null}
          </ul>
          <p className="v2-hint" style={{ marginBottom: 0 }}><strong>Import without validation</strong> skips the enterprise check and the content rules (well-formed XML, a data module root), so files with problems come in and can be fixed in the editor. Wrong file names, unsafe XML, files that already exist and two copies of the same data module are still refused.</p>
        </Modal>
      ) : null}
      {del ? (
        <ConfirmModal title="Delete data module?" danger confirmLabel="Delete" onClose={() => setDel(null)}
          body={<><p style={{ marginTop: 0 }}><strong>{del}</strong> is removed from the project. Its last saved version stays in the history.</p>{openMap.get(del) ? <p className="v2-hint">It is open in the editor; the open copy is not closed for you.</p> : null}</>}
          onConfirm={async () => { const f = del; setDel(null); try { await contentApi.deleteDm(ctx.id, f); studio.forget(f); void studio.refreshProjectData(); toast(`Deleted ${f}`, 'success'); list.reload(); explore.reload(); ctx.reload(); } catch (e) { toast(errText(e), 'error'); } }} />
      ) : null}
    </aside>
  );
}

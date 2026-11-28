// The editor's left panel: the project's data modules, shown as the publication's chapter
// hierarchy (as saved in Publication) or as a flat list of every module. Project-level
// functions (release, watermark, publication settings) are intentionally NOT here.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { MoreRows, VirtualRows, useProgressive } from '../../../components/windowing';
import { countTreeRows, layoutTree, type TreeItem } from './publicationTree';

type View = 'tree' | 'all';

/**
 * `refreshKey` reloads the module list; `treeKey` (default: the same) reloads the publication tree. A save of an existing module changes the
 * list (title, lock, time) but not the tree, so the editor bumps only the first after such a save (WP-18, FE-029).
 */
export function EditorSide({ ctx, refreshKey, treeKey, width, onCollapse }: { ctx: ProjectCtx; refreshKey: number; treeKey?: number; width: number; onCollapse: () => void }) {
  const toast = useUi((s) => s.toast);
  const docs = useStudio((s) => s.docs);
  const list = useAsync(() => contentApi.dms(ctx.id), [ctx.id, refreshKey]);
  const explore = useAsync(() => contentApi.explore(ctx.id), [ctx.id, treeKey ?? refreshKey]);
  const listBox = useRef<HTMLDivElement>(null);
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
  const writable = canWrite(ctx.can);

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

  // UI redesign (mockup editor.html): each module's row carries the state of the project's last check (a dot), the foot the totals
  const checks = useAsync(() => contentApi.validation(ctx.id).catch(() => null), [ctx.id, ctx.summary.validation?.ranAt]);
  const fileState = useMemo(() => {
    const m = new Map<string, 'danger' | 'warning' | 'success'>();
    const run = checks.data?.run; if (!run) return m;
    for (const i of run.issues) {
      const f = i.file?.split(/[\\/]/).pop(); if (!f) continue;
      if (i.sev === 'error') m.set(f, 'danger'); else if (i.sev === 'warn' && m.get(f) !== 'danger') m.set(f, 'warning');
    }
    for (const d of list.data ?? []) if (!m.has(d.file)) m.set(d.file, 'success');
    return m;
  }, [checks.data, list.data]);
  const errorsTotal = checks.data?.run?.summary.error ?? 0;
  const drafts = (list.data ?? []).filter((d) => d.inWork && d.inWork !== '00').length;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);
  const chapterKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: ExploreNode[], path: string) => nodes.forEach((n, i) => { const k = `${path}/${i}`; if (n.kind === 'chapter') { keys.push(k); walk(n.children, k); } });
    walk(explore.data?.tree ?? [], 'r');
    return keys;
  }, [explore.data]);
  const allShut = chapterKeys.length > 0 && chapterKeys.every((k) => closed.has(k));
  const collapseAll = () => {
    const n = allShut ? new Set<string>() : new Set(chapterKeys);
    setClosed(n);
    try { localStorage.setItem(`agastya.editor.closed.${ctx.id}`, JSON.stringify([...n])); } catch { /* private mode */ }
  };
  const menuAct = (f: () => void) => () => { setMenuOpen(false); f(); };

  const row = ({ file, title, sub, indent = 0 }: { file: string; title: string; sub: string; indent?: number }) => {
    const o = openMap.get(file);
    const locked = byFile.get(file)?.locked;
    const state = o?.dirty ? 'warning' : fileState.get(file);
    return (
      <div key={file} className="node ed-node" style={{ '--depth': indent } as CSSProperties} aria-selected={o?.active || undefined}>
        <button className="ed-node-btn" onClick={() => open(file)} title={`${title || file}\n${sub}${locked ? ' · locked' : ''}\n${file}`} data-file={file} data-testid="dm-row">
          <span className="twist" /><Icon name="file" size={16} className="ico" />
          <span className="label trunc">{title || file}</span>
          {state ? <span className={`dot ${state}`} title={o?.dirty ? 'Open, unsaved changes' : state === 'danger' ? 'Errors in the last check' : state === 'warning' ? 'Warnings in the last check' : 'No problems in the last check'} /> : null}
        </button>
        {locked ? <Icon name="lock" size={13} className="ico sm" /> : null}
        {writable && mayDelete ? <button className="icon-btn ed-node-del" aria-label={`Delete ${file}`} title="Delete" onClick={() => setDel(file)}><Icon name="trash" size={13} /></button> : null}
      </div>
    );
  };
  /** the row's words, as the mockup's: "Pump - Description" (the technical name and the information name) */
  const rowTitle = (techName: string | undefined, infoName: string | undefined, fallback: string) => techName ? (infoName ? `${techName} - ${infoName}` : techName) : fallback;

  const matchNode = (n: Extract<ExploreNode, { kind: 'dm' }>) => match({ file: n.file, title: n.title, dmc: n.dmc, infoName: n.infoName, techName: byFile.get(n.file)?.techName });
  const treeOpts = { closed, q, match: matchNode };

  /** Draws the laid-out tree (publicationTree.ts): chapters with their modules, in publication order. */
  const renderItems = (items: TreeItem[]): React.ReactNode[] => items.map((it) => {
    if (it.kind === 'chapter') return (
      <div key={it.key} data-testid="chapter-node" role="group">
        <button className="v2-chap node group" style={{ '--depth': it.depth } as CSSProperties} onClick={() => toggle(it.key)} aria-expanded={!it.shut}>
          <span className="twist"><Icon name={it.shut ? 'right' : 'down'} size={14} className="ico sm" /></span><Icon name={it.shut ? 'folder' : 'folderOpen'} size={16} className="ico" /><span className="label trunc">{it.title || 'Untitled chapter'}</span><span className="meta">{it.dmCount}</span>
        </button>
        {it.shut ? null : renderItems(it.children)}
      </div>
    );
    if (it.kind === 'dm') { const s = byFile.get(it.node.file); return row({ file: it.node.file, title: rowTitle(s?.techName, s?.infoName || it.node.infoName, it.node.title), sub: it.node.infoName || it.node.dmc, indent: it.depth + 1 }); }
    return <div key={it.key} className="node ed-node-missing" style={{ '--depth': it.depth + 1 } as CSSProperties} title="Listed in the publication but not in the project"><span className="twist" /><Icon name="warn" size={14} className="ico sm" /><span className="label trunc">Missing: {it.ref}</span></div>;
  });

  const rows: DmSummary[] = (list.data ?? []).filter(match);
  const unplaced = (explore.data?.unplaced ?? []).filter(match);
  // WP-18 (FE-030): in a large publication the tree draws its first rows and more as the end comes into view
  const treeTotal = view === 'tree' && explore.data ? countTreeRows(explore.data.tree, treeOpts) + unplaced.length : 0;
  const progressive = useProgressive(treeTotal, `${q}|${view}|${ctx.id}`);
  const laid = explore.data ? layoutTree(explore.data.tree, { ...treeOpts, limit: progressive.limit, total: treeTotal }) : { items: [], left: progressive.limit };
  const tree = renderItems(laid.items);
  const unplacedShown = unplaced.slice(0, Math.max(0, laid.left));
  const treeShown = progressive.limit;
  const total = list.data?.length ?? 0;
  const unsaved = docs.filter((d) => d.dirty).length;

  return (
    <aside className="v2-dmpanel pane tree-pane ed-explorer" aria-label="Data modules" style={{ width, flex: `0 0 ${width}px` }}>
      {/* UI redesign (mockup editor.html): the Explorer: its head carries the panel's commands, the project's name is its tooltip */}
      <div className="pane-head" title={ctx.summary.project.name}>
        <span>Explorer</span>
        <span className="grow" />
        {writable ? <button className="icon-btn" title="New data module" aria-label="New data module" data-testid="new-dm" onClick={() => studio.newDocument()}><Icon name="plus" size={16} className="ico" /></button> : null}
        {view === 'tree' && chapterKeys.length ? <button className="icon-btn" title={allShut ? 'Expand all' : 'Collapse all'} aria-label={allShut ? 'Expand all' : 'Collapse all'} data-testid="collapse-all" onClick={collapseAll}><Icon name="tree" size={16} className="ico" /></button> : null}
        <div className="v2-pop-anchor ed-explorer-menu" ref={menuRef} onKeyDown={(e) => { if (e.key === 'Escape' && menuOpen) { e.stopPropagation(); setMenuOpen(false); (menuRef.current?.querySelector('button') as HTMLButtonElement | null)?.focus(); } }}>
          <button className="icon-btn" title="Filter, import and more" aria-label="Filter, import and more" aria-expanded={menuOpen} aria-controls="ed-explorer-menu" data-testid="explorer-menu" onClick={() => setMenuOpen((m) => !m)}><Icon name="filter" size={16} className="ico" /></button>
          {menuOpen ? (
            <div className="menu" id="ed-explorer-menu" role="group" aria-label="Explorer">
              {isCir ? null : <>
                <div className="menu-label">Show</div>
                <button type="button" className="item" aria-pressed={view === 'tree'} onClick={menuAct(() => setView('tree'))} data-testid="view-tree"><Icon name="book" size={16} className="ico" />Publication<span className="k faint">{view === 'tree' ? '✓' : ''}</span></button>
                <button type="button" className="item" aria-pressed={view === 'all'} onClick={menuAct(() => setView('all'))} data-testid="view-all" title={`${total} data modules`}><Icon name="file" size={16} className="ico" />All<span className="k faint">{view === 'all' ? '✓' : ''}</span></button>
                <div className="sep" />
              </>}
              {writable ? <>
                <button type="button" className="item" title="Import data modules (.xml) and graphics" aria-label="Import data modules and graphics" onClick={menuAct(() => fileInput.current?.click())}><Icon name="upload" size={16} className="ico" />Import data modules and graphics…</button>
                <button type="button" className="item" title="Import without validation: brings in every file as it is (enterprise and content checks skipped)" aria-label="Import without validation" data-testid="import-raw" onClick={menuAct(() => rawInput.current?.click())}><Icon name="warn" size={16} className="ico" />Import without validation…</button>
                {canImportPackage(ctx.can) && !isCir ? <button type="button" className="item" title="Import a package: a folder, a .zip or files from another S1000D tool, scanned and repaired first" aria-label="Import package" data-testid="import-package" onClick={menuAct(() => setPackageOpen(true))}><Icon name="package" size={16} className="ico" />Import package…</button> : null}
                {isCir ? null : <button type="button" className="item" title="Add a data module from the common repository" aria-label="Add from the common repository" onClick={menuAct(() => setPicking(true))} data-testid="cir-pick"><Icon name="library" size={16} className="ico" />Add from the common repository…</button>}
                <div className="sep" />
              </> : null}
              <button type="button" className="item" title="Refresh" aria-label="Refresh list" onClick={menuAct(() => { list.reload(); explore.reload(); checks.reload(); })}><Icon name="refresh" size={16} className="ico" />Refresh</button>
              <button type="button" className="item" onClick={menuAct(onCollapse)} title="Hide this panel" aria-label="Hide the data module panel" data-testid="collapse-side"><Icon name="panel" size={16} className="ico" />Hide this panel</button>
            </div>
          ) : null}
        </div>
        {writable ? <>
          <input ref={fileInput} type="file" accept=".xml,.XML,.png,.jpg,.jpeg,.gif,.svg,.bmp,.webp" multiple hidden onChange={(e) => void doImport(e.target.files)} />
          <input ref={rawInput} data-testid="import-raw-input" type="file" accept=".xml,.XML,.png,.jpg,.jpeg,.gif,.svg,.bmp,.webp" multiple hidden onChange={(e) => void doImport(e.target.files, true)} />
        </> : null}
      </div>
      <div className="search-box">
        <input className="input search" placeholder="Filter by title, code or file…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} aria-label="Filter data modules" />
      </div>
      <div className="tree-scroll" data-testid="dm-list" ref={listBox}>
        <div className="tree focused" role="tree" aria-label={view === 'tree' ? 'Data modules by publication chapter' : 'All data modules'}>
          {untitled.map((d) => (
            <div key={d.key} className="node ed-node" aria-selected={d.active || undefined}>
              <button className="ed-node-btn" onClick={() => studio.focusEditor()} title="New, not saved to the project yet">
                <span className="twist" /><Icon name="file" size={16} className="ico" /><span className="label trunc">{d.title}</span>{d.dirty ? <span className="dot warning" /> : null}
              </button>
            </div>
          ))}
          {list.loading && !list.data ? <div className="ed-tree-note">Loading…</div> : null}
          {list.error ? <div className="ed-tree-note v2-error">{list.error}</div> : null}

          {view === 'tree' ? (
            <>
              {tree}
              {unplaced.length ? (
                <div data-testid="unplaced-group" role="group">
                  <div className="v2-chap static node group" title="Not placed in the publication yet. Add them from the Publication tab."><span className="twist" /><Icon name="folder" size={16} className="ico" /><span className="label trunc">Not in the publication</span><span className="meta">{unplaced.length}</span></div>
                  {unplacedShown.map((d) => row({ file: d.file, title: rowTitle(d.techName, d.infoName, d.dmc), sub: d.infoName || d.dmc, indent: 1 }))}
                </div>
              ) : null}
              <MoreRows shown={treeShown} total={treeTotal} onMore={progressive.more} onAll={progressive.all} />
              {!explore.loading && !tree.length && !unplaced.length && !untitled.length ? <div className="ed-tree-note">{q ? 'No data module matches.' : 'No chapters yet. Arrange them in the Publication tab.'}</div> : null}
            </>
          ) : (
            <>
              <VirtualRows items={rows} scrollRef={listBox} keyOf={(d) => d.file} row={(d) => row({ file: d.file, title: rowTitle(d.techName, d.infoName, d.dmc), sub: d.infoName || d.dmc })} />
              {!list.loading && rows.length === 0 && !untitled.length ? <div className="ed-tree-note">{q ? <>No data module matches “{q}”. <button className="v2-link" onClick={() => setQ('')}>Clear the search</button></> : <>No data modules yet. Press <b>New data module</b> (+) to write one, or import existing files from the explorer menu.</>}</div> : null}
            </>
          )}
        </div>
      </div>
      <div className="tree-foot" aria-live="polite">
        <span>{q ? `${view === 'all' ? rows.length : treeTotal} of ${total} match` : `${total} module${total === 1 ? '' : 's'}`}</span>
        {errorsTotal ? <span className="ed-foot-bad">{errorsTotal} error{errorsTotal === 1 ? '' : 's'}</span> : null}
        {drafts ? <span className="ed-foot-warn">{drafts} draft{drafts === 1 ? '' : 's'}</span> : null}
        {unsaved ? <span className="ed-foot-warn">{unsaved} unsaved</span> : null}
      </div>
      {picking ? <CirPicker projectId={ctx.id} existing={new Set((list.data ?? []).map((d) => d.file))} onClose={() => setPicking(false)} onAdded={() => { list.reload(); explore.reload(); void studio.refreshProjectData(); ctx.reload(); }} /> : null}
      {packageOpen ? <ImportPackageDialog projectId={ctx.id} can={ctx.can} onClose={() => setPackageOpen(false)} onChanged={onPackageChanged} /> : null}
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

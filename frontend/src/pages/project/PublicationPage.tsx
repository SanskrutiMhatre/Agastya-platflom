// Publication: arrange data modules into chapters and build the final manual.
//
// The tree logic (where a dropped chapter or module lands, without ever losing or duplicating one)
// is Agastya V1's pmcTree, reused and unit-tested; this screen is its interface, drawn as the owner-approved mockup 4
// (docs/audit/mockups/publication.html): the structure as a checklist tree (a ticked row is in the publication; untick it to take it out,
// tick a module under "Not placed" to add it to the selected chapter), drag-and-drop with up/down buttons for keyboard users, the built PDF
// on a themed canvas, and the build settings with the list of builds on the right.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import '../../styles/pages/structure.css';   // WP-35: this page's styles load with its chunk
import { useNavigate } from 'react-router-dom';
import { contentApi, workspaceApi, type DmSummary } from '../../api';
import { onlyRuleBreaks } from '../../lib/ruleBreaks';
import { confirmDialog } from '../../lib/dialogs';
import { Icon } from '../../components/Icon';
import { LazyPdfViewer } from '../../components/pdf/LazyPdfViewer';
import type { OutlinePage, PdfView } from '../../components/pdf/PdfJsViewer';
import { PublishRefusal } from '../../components/PublishRefusal';
import { Alert, Empty, Loading, PromptModal, Spinner, ago, errText, useAsync } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { useLeaveGuard } from '../../lib/leaveGuard';
import { useProgress } from '../../lib/progress';
import { countOf, dropTarget, getAt, insertAt, moveTo, removeAt, shiftBy, updateAt, type DropWhere, type Path, type PmEntry } from '../../lib/pmcTree';
import { pmcApi, poolToEntry } from '../../api/pmc';
import { refusalOf, type Refusal } from '../../lib/waivers';
import { PublishWaivers } from './PublishWaivers';
import { useUi } from '../../store/ui';
import { MoreRows, useProgressive } from '../../components/windowing';
import { BuildList, LastBuildBadge, PubStatus, PubTopbar, pagesFromOutline, paperShort, sheetWidth, useBuilds, type PageNode } from './pubChrome';

const keyOf = (p: Path) => p.join('.');
const pathOf = (k: string) => k.split('.').map(Number);
const baseName = (href: string) => href.replace(/\\/g, '/').replace(/^.*\//, '').toLowerCase();
const dmcFrom = (a: Record<string, string> = {}) =>
  [a.modelIdentCode, a.systemDiffCode, a.systemCode, `${a.subSystemCode ?? ''}${a.subSubSystemCode ?? ''}`, a.assyCode, `${a.disassyCode ?? ''}${a.disassyCodeVariant ?? ''}`, `${a.infoCode ?? ''}${a.infoCodeVariant ?? ''}`, a.itemLocationCode].map((x) => x ?? '').join('-');

interface Described { title: string; sub: string; code: string; issue: string; found: boolean; file?: string }

function describe(e: PmEntry, byFile: Map<string, DmSummary>, byCode: Map<string, DmSummary>): Described {
  if (e.type === 'include') {
    const hit = byFile.get(baseName(e.href ?? ''));
    return hit ? { title: e.title || hit.techName || hit.file, sub: hit.infoName, code: hit.dmc, issue: `${hit.issueNumber}-${hit.inWork}`, found: true, file: hit.file }
      : { title: e.title || e.href || 'Missing module', sub: e.href ?? '', code: '', issue: '', found: false };
  }
  if (e.type === 'dm') {
    const code = dmcFrom((e as { dmCode?: Record<string, string> }).dmCode);
    const hit = byCode.get(code);
    return { title: e.title || (e as { techName?: string }).techName || hit?.techName || code, sub: (e as { infoName?: string }).infoName ?? hit?.infoName ?? '', code, issue: hit ? `${hit.issueNumber}-${hit.inWork}` : '', found: !!hit, file: hit?.file };
  }
  return { title: e.title || 'Annexure', sub: 'Another publication', code: '', issue: '', found: true };
}

interface DragState { from: string | null; pool: DmSummary | null; over: string | null; where: DropWhere | null }

const LAYOUTS: Record<string, string> = { 'xignal-s1000d': 'Xignal S1000D', default: 'Plain style (older projects)' };

export function PublicationPage() {
  const { id, role, can, summary, reload } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const progress = useProgress(id);
  const data = useAsync(async () => ({ pm: await contentApi.pmc(id), dms: await contentApi.dms(id) }), [id]);
  const writable = canWrite(can);
  const ownerSettings = !!can['project.rename'];

  const [entries, setEntries] = useState<PmEntry[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [undo, setUndo] = useState<PmEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'save' | 'build' | null>(null);
  const [rename, setRename] = useState<{ key: string; title: string } | null>(null);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);   // the server's publish gate said no: what it found, and (for a missing BREX) the waiver
  const [waiverTick, setWaiverTick] = useState(0);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [outline, setOutline] = useState<OutlinePage[] | null>(null);
  const [pdfView, setPdfView] = useState<PdfView | null>(null);
  const [startW] = useState(sheetWidth);
  const importRef = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!more) return;
    const off = (ev: MouseEvent | KeyboardEvent) => { if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !moreRef.current?.contains(ev.target as Node)) setMore(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off); };
  }, [more]);

  useEffect(() => { if (data.data) { setEntries(data.data.pm.entries as PmEntry[]); setMeta((data.data.pm.meta ?? {}) as Record<string, unknown>); setDirty(false); setUndo(null); } }, [data.data]);

  const dms = data.data?.dms ?? [];
  const byFile = useMemo(() => new Map(dms.map((d) => [d.file.toLowerCase(), d])), [dms]);
  const byCode = useMemo(() => new Map(dms.map((d) => [d.dmc, d])), [dms]);

  const placed = useMemo(() => {
    const files = new Set<string>();
    (function walk(list: PmEntry[]) { for (const e of list) { if (e.type === 'folder') walk(e.children ?? []); else { const d = describe(e, byFile, byCode); if (d.file) files.add(d.file); } } })(entries);
    return files;
  }, [entries, byFile, byCode]);
  const pool = useMemo(() => dms.filter((d) => !placed.has(d.file)).filter((d) => !q || `${d.techName} ${d.infoName} ${d.dmc} ${d.file}`.toLowerCase().includes(q.toLowerCase())), [dms, placed, q]);
  const poolDrawn = useProgressive(pool.length, q);       // WP-18 (FE-030): a large pool draws its first rows, more on scroll
  const counts = useMemo(() => countOf(entries), [entries]);
  const missing = useMemo(() => { let n = 0; (function walk(list: PmEntry[]) { for (const e of list) { if (e.type === 'folder') walk(e.children ?? []); else if (!describe(e, byFile, byCode).found) n++; } })(entries); return n; }, [entries, byFile, byCode]);
  // the page each chapter and module starts on in the built PDF (its bookmarks), shown at the right of the row as the mockup does ("p.19")
  const pages = useMemo(() => {
    const nodes = (list: PmEntry[], path: Path): PageNode[] => list.map((e, i) => {
      const p = [...path, i];
      return e.type === 'folder' ? { key: keyOf(p), title: e.title || '', kids: nodes(e.children ?? [], p) } : { key: keyOf(p), title: describe(e, byFile, byCode).title };
    });
    return pagesFromOutline(outline, nodes(entries, []));
  }, [outline, entries, byFile, byCode]);

  const apply = useCallback((next: PmEntry[]) => { setUndo(entries); setEntries(next); setDirty(true); setError(''); }, [entries]);

  // ── editing ──────────────────────────────────────────────────────────────
  const addChapter = (title: string) => apply(insertAt(entries, [], entries.length, { type: 'folder', title, children: [] }));
  const target = (): { parentPath: Path; index: number } => {
    const sel = selected ? pathOf(selected) : null;
    const node = sel ? getAt(entries, sel) : undefined;
    return node?.type === 'folder' ? { parentPath: sel!, index: (node.children ?? []).length } : { parentPath: [], index: entries.length };
  };
  const addModule = (d: DmSummary) => {
    if (entries.length === 0) { setError('Add a chapter first, then place data modules in it.'); return; }
    const { parentPath, index } = target();
    apply(insertAt(entries, parentPath, index, poolToEntry({ file: d.file, techName: d.techName, infoName: d.infoName, dmCode: d.dmCodeAttrs, identExtension: d.identExtension, issueInfo: d.issueInfoAttrs, language: d.languageAttrs })));
  };
  const remove = (k: string) => { apply(removeAt(entries, pathOf(k)).entries); if (selected === k) setSelected(null); };
  const shift = (k: string, delta: -1 | 1) => { const next = shiftBy(entries, pathOf(k), delta); if (next !== entries) apply(next); };
  const toggleOpen = (k: string) => setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const onDrop = (key: string, where: DropWhere) => {
    if (!drag) return;
    const to = pathOf(key);
    const { parentPath, index } = dropTarget(entries, to, where);
    if (drag.pool) apply(insertAt(entries, parentPath, index, poolToEntry({ file: drag.pool.file, techName: drag.pool.techName, infoName: drag.pool.infoName, dmCode: drag.pool.dmCodeAttrs, identExtension: drag.pool.identExtension, issueInfo: drag.pool.issueInfoAttrs, language: drag.pool.languageAttrs })));
    else if (drag.from) { const next = moveTo(entries, pathOf(drag.from), parentPath, index); if (next !== entries) apply(next); }
    setDrag(null);
  };
  const zone = (ev: DragEvent, isFolder: boolean): DropWhere => {
    const r = ev.currentTarget.getBoundingClientRect(); const y = (ev.clientY - r.top) / r.height;
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : isFolder ? 'inside' : 'after';
  };

  const save = async (): Promise<boolean> => {
    setBusy('save'); setError('');
    try {
      const allowEmpty = counts.total === 0 && await confirmDialog({ title: 'Save an empty publication?', message: 'This saves a publication with no content. Continue?', confirmLabel: 'Save' });
      const r = await pmcApi.save(id, { meta, entries } as Parameters<typeof pmcApi.save>[1], allowEmpty, data.data!.pm.hash ?? 'new');      // WP-11: the version this screen loaded
      setDirty(false); setUndo(null);
      toast(`Saved: ${r.counts.dms} data module${r.counts.dms === 1 ? '' : 's'} in ${r.counts.folders} chapter${r.counts.folders === 1 ? '' : 's'}`, 'success');
      data.reload(); reload();
      return true;
    } catch (e) { setError(errText(e)); return false; } finally { setBusy(null); }
  };
  const [rulesOnly, setRulesOnly] = useState(false);
  const build = async (allowRuleBreaks = false) => {
    if (dirty && !(await save())) return;
    setBusy('build'); progress.clear(); setError(''); setRulesOnly(false); setRefusal(null);
    try { const r = await contentApi.build(id, undefined, allowRuleBreaks); toast(`Publication built in ${((r.totalMs ?? 0) / 1000).toFixed(1)} s${r.ruleBreaks?.length ? `, with ${r.ruleBreaks.length} business rule break${r.ruleBreaks.length === 1 ? '' : 's'} not fixed` : ''}`, 'success'); reload(); }
    catch (e) {
      // only broken business rules: the author may generate anyway. Any other gate refusal: list the findings, and offer the waiver for a missing BREX.
      const only = onlyRuleBreaks(e);
      const r = only ? null : refusalOf(e);
      if (r) setRefusal(r); else { setError(errText(e)); setRulesOnly(only); }
    } finally { setBusy(null); }
  };
  const importPm = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirmDialog({ title: 'Replace the publication?', message: `Replace this project's publication with "${file.name}"? The current one is kept as publication.xml.bak.`, confirmLabel: 'Replace', danger: true }))) { if (importRef.current) importRef.current.value = ''; return; }
    try { const r = await pmcApi.import(id, file); toast(`Imported ${r.counts.dms} modules in ${r.counts.folders} chapters${r.missingModules.length ? `; ${r.missingModules.length} not in this project` : ''}`, r.missingModules.length ? 'info' : 'success'); data.reload(); reload(); }
    catch (e) { setError(errText(e)); }
    if (importRef.current) importRef.current.value = '';
  };
  // the project's build options (Project settings has the same ones): saved at once, the next build uses them
  const setOption = async (patch: Parameters<typeof workspaceApi.updateProject>[1], what: string) => {
    try { await workspaceApi.updateProject(id, patch); toast(`${what}. The next build uses it.`, 'success'); reload(); }
    catch (e) { toast(errText(e), 'error'); }
  };

  const guard = useLeaveGuard(dirty, { what: 'changes to the publication', save });
  const [side, setSide] = useState<'build' | 'history'>('build');
  const rel = useAsync(async () => (side === 'history' ? contentApi.release(id) : null), [id, side]);   // the release history, read when the History tab opens
  const built = summary.build;
  const jobs = useBuilds(id, `${built?.builtAt ?? ''}|${busy}`);

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <div className="v2-page"><Alert tone="bad">{data.error || 'Could not read the publication.'}</Alert></div>;

  // ── render ───────────────────────────────────────────────────────────────
  const actions = (children: ReactNode) => <span className="v2-mod-actions">{children}</span>;
  const renderEntry = (e: PmEntry, path: Path, depth: number, number: string) => {
    const k = keyOf(path);
    const hint = drag?.over === k ? drag.where : null;
    if (e.type === 'folder') {
      const kids = e.children ?? [];
      const mods = countOf(kids).dms;
      const open = !closed.has(k);
      return (
        <section key={k} className={`v2-chapter ${selected === k ? 'sel' : ''} ${hint === 'inside' ? 'drop-inside' : ''} ${hint === 'before' ? 'drop-before' : ''} ${hint === 'after' ? 'drop-after' : ''}`}
          data-testid="chapter" aria-label={`Chapter ${e.title}`}
          onDragOver={(ev) => { if (!drag || !writable) return; ev.preventDefault(); ev.stopPropagation(); const where = zone(ev, true); if (drag.over !== k || drag.where !== where) setDrag({ ...drag, over: k, where }); }}
          onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); onDrop(k, zone(ev, true)); }}>
          <header className="node group v2-chapter-head" style={{ '--depth': depth } as CSSProperties} aria-selected={selected === k} draggable={writable} onClick={() => setSelected(selected === k ? null : k)}
            title={writable ? 'Select this chapter: modules you tick under Not placed are added to it' : undefined}
            onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; setDrag({ from: k, pool: null, over: null, where: null }); }} onDragEnd={() => setDrag(null)}>
            <button type="button" className="twist" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${e.title}`} title={open ? "Collapse" : "Expand"} onClick={(ev) => { ev.stopPropagation(); toggleOpen(k); }}><Icon name={open ? 'down' : 'right'} size={14} /></button>
            <input type="checkbox" className="chk" checked disabled={!writable} aria-label={`Include ${e.title}`} title={writable ? 'Untick to take the chapter out (its modules go back to Not placed)' : undefined}
              onClick={(ev) => ev.stopPropagation()} onChange={() => remove(k)} />
            <span className="v2-chapter-no">{number}</span>
            <h3 className="label trunc">{e.title || '(untitled chapter)'}</h3>
            <span className="meta" title={`${mods} data module${mods === 1 ? '' : 's'}`}>{mods}</span>
            {writable ? actions(<>
              <button className="icon-btn" aria-label={`Move ${e.title} up`} title="Move up" onClick={(ev) => { ev.stopPropagation(); shift(k, -1); }}><Icon name="up" size={14} /></button>
              <button className="icon-btn" aria-label={`Move ${e.title} down`} title="Move down" onClick={(ev) => { ev.stopPropagation(); shift(k, 1); }}><Icon name="down" size={14} /></button>
              <button className="icon-btn" aria-label={`Rename ${e.title}`} title="Rename" onClick={(ev) => { ev.stopPropagation(); setRename({ key: k, title: e.title || '' }); }}><Icon name="edit" size={14} /></button>
              <button className="icon-btn" aria-label={`Remove ${e.title}`} title="Remove chapter (its modules return to the list)" onClick={(ev) => { ev.stopPropagation(); remove(k); }}><Icon name="trash" size={14} /></button>
            </>) : null}
          </header>
          {open ? (
            <div className="v2-chapter-body">
              {kids.length === 0 ? <div className="v2-chapter-empty" style={{ '--depth': depth + 1 } as CSSProperties}>{writable ? 'Drag data modules here, or select this chapter and tick one under Not placed.' : 'No data modules in this chapter.'}</div> : kids.map((c, i) => renderEntry(c, [...path, i], depth + 1, `${number}.${i + 1}`))}
            </div>
          ) : null}
        </section>
      );
    }
    const d = describe(e, byFile, byCode);
    const pg = pages.get(k);
    return (
      <div key={k} className={`node v2-mod ${!d.found ? 'missing' : ''} ${hint === 'before' ? 'drop-before' : ''} ${hint === 'after' ? 'drop-after' : ''}`} data-testid="pub-module" draggable={writable}
        style={{ '--depth': depth } as CSSProperties} title={[d.title, d.sub, d.code, d.issue ? `Issue ${d.issue}` : ''].filter(Boolean).join('\n')}
        onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation(); setDrag({ from: k, pool: null, over: null, where: null }); }} onDragEnd={() => setDrag(null)}
        onDragOver={(ev) => { if (!drag || !writable) return; ev.preventDefault(); ev.stopPropagation(); const where = zone(ev, false); if (drag.over !== k || drag.where !== where) setDrag({ ...drag, over: k, where }); }}
        onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); onDrop(k, zone(ev, false)); }}>
        <span className="twist" />
        <input type="checkbox" className="chk" checked disabled={!writable} aria-label={`Include ${d.title}`} title={writable ? 'Untick to take it out of the publication (it goes back to Not placed)' : undefined} onChange={() => remove(k)} />
        <span className="v2-mod-no">{number}</span>
        <span className="label trunc"><span className="v2-mod-title">{d.title}</span>{d.sub ? <span className="pub-sub"> · {d.sub}</span> : null}</span>
        {!d.found ? <span className="dot danger" title="Not in this project: nothing is published for it" /> : null}
        <span className="meta">{pg ? `p.${pg}` : d.issue}</span>
        {actions(<>
          {d.file ? <button className="icon-btn" aria-label={`Open ${d.title} in the editor`} title="Open in editor" onClick={() => nav(`../editor?file=${encodeURIComponent(d.file!)}`)}><Icon name="editor" size={14} /></button> : null}
          {writable ? <>
            <button className="icon-btn" aria-label={`Move ${d.title} up`} title="Move up" onClick={() => shift(k, -1)}><Icon name="up" size={14} /></button>
            <button className="icon-btn" aria-label={`Move ${d.title} down`} title="Move down" onClick={() => shift(k, 1)}><Icon name="down" size={14} /></button>
            <button className="icon-btn" aria-label={`Remove ${d.title} from the publication`} title="Remove from the publication" onClick={() => remove(k)}><Icon name="close" size={14} /></button>
          </> : null}
        </>)}
      </div>
    );
  };

  const released = summary.review?.state === 'approved';
  const notPlaced = dms.length - placed.size;
  const pdfSrc = built ? `${contentApi.pdfUrl(id)}?t=${Date.parse(built.builtAt) || 0}` : null;
  const lastPdf = built ? { builtAt: built.builtAt, size: built.size } : null;
  const selTitle = selected && getAt(entries, pathOf(selected))?.type === 'folder' ? (getAt(entries, pathOf(selected)) as { title: string }).title : null;
  const poolOpen = !closed.has('pool');
  const p = summary.project;
  const side1 = p.sideText ?? { enabled: true, publisher: '', draftNote: true };
  const layouts = [...new Set(['xignal-s1000d', 'default', p.templateRef])];
  const paper = paperShort(pdfView);
  // UI redesign 2026-11-28 (mockup 4): structure on the left, the built PDF on a themed canvas in the middle, build settings and history on the right
  return (
    <div className="pub" data-testid="pub-layout">
      <h1 className="pub-sr">Publication</h1>
      <PubTopbar downloadHref={built ? contentApi.pdfUrl(id, true) : null} canBuild={writable} busy={busy !== null} onBuild={() => void build(false)} />
      <PubStatus jobs={jobs} pdf={lastPdf} view={pdfView} busy={busy === 'build'} />
      <aside className="pane" aria-label="Publication structure">
        <div className="pane-head">
          <span className="trunc" title={`${counts.folders} chapter${counts.folders === 1 ? '' : 's'}, ${counts.dms} data module${counts.dms === 1 ? '' : 's'}`}>Structure</span>
          <span className="grow" />
          {writable ? <>
            <button className="icon-btn" onClick={() => setNaming(true)} data-testid="add-chapter" aria-label="Add chapter" title="Add chapter"><Icon name="plus" /></button>
            <button className="icon-btn" onClick={() => undo && (setEntries(undo), setUndo(null), setDirty(true))} disabled={!undo} aria-label="Undo" title="Undo"><Icon name="undo" /></button>
          </> : null}
          <span className="pub-more" ref={moreRef}>
            <button className="icon-btn" onClick={() => setMore((o) => !o)} aria-haspopup="menu" aria-expanded={more} aria-label="More: export or import the publication module" title="Export or import the PM"><Icon name="more" /></button>
            {more ? (
              <div className="menu" role="menu">
                <a className="item" role="menuitem" href={pmcApi.exportUrl(id, 'pdf')} onClick={() => setMore(false)}><Icon name="download" />Export PM</a>
                {writable ? <button type="button" className="item" role="menuitem" style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }} onClick={() => { setMore(false); importRef.current?.click(); }}><Icon name="upload" />Import PM…</button> : null}
              </div>
            ) : null}
          </span>
          <input ref={importRef} type="file" accept=".xml,.XML" hidden onChange={(e) => void importPm(e.target.files?.[0])} />
        </div>
        {dirty ? (
          <div className="v2-savebar" role="status" data-testid="unsaved-bar">
            <span><Icon name="alert" size={14} /> Unsaved changes</span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => data.reload()}>Discard</button>
            <button className="btn sm primary" onClick={() => void save()} disabled={busy !== null} data-testid="save-publication">{busy === 'save' ? <Spinner /> : null}Save changes</button>
          </div>
        ) : null}
        <div className="scroll">
          <div className="tree focused v2-pub-main" data-testid="pub-tree">
            {entries.length === 0 ? (
              <Empty title="The publication is empty">{writable ? <>Add a chapter, then tick data modules under Not placed to put them in it.<div style={{ marginTop: 12 }}><button className="btn primary sm" onClick={() => setNaming(true)}><Icon name="plus" />Add the first chapter</button></div></> : 'Nothing has been placed in it yet.'}</Empty>
            ) : entries.map((e, i) => renderEntry(e, [i], 0, String(i + 1)))}

            {notPlaced > 0 || q ? (
              <div className="pub-pool" data-testid="pub-pool">
                <div className="node group" onClick={() => toggleOpen('pool')} title={writable ? `Tick a module to add it to ${selTitle ? `“${selTitle}”` : 'the selected chapter (select a chapter first)'}` : undefined}>
                  <button type="button" className="twist" aria-expanded={poolOpen} title={poolOpen ? "Collapse" : "Expand"} aria-label={`${poolOpen ? 'Collapse' : 'Expand'} Not placed`} onClick={(ev) => { ev.stopPropagation(); toggleOpen('pool'); }}><Icon name={poolOpen ? 'down' : 'right'} size={14} /></button>
                  <input type="checkbox" className="chk" checked={false} disabled aria-label="Not placed: not in the publication" />
                  <span className="label trunc">Not placed</span>
                  <span className="meta">{notPlaced}</span>
                </div>
                {poolOpen ? <>
                  {dms.length - placed.size > 6 || q ? <div className="pub-pool-search"><input className="input search" placeholder="Search data modules…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search data modules not placed" /></div> : null}
                  {pool.length === 0 ? <div className="pub-pool-none">No data module matches.</div> : pool.slice(0, poolDrawn.limit).map((d) => (
                    <div key={d.file} className="node v2-pool-item" style={{ '--depth': 1 } as CSSProperties} draggable={writable} data-testid="pool-item" title={[d.techName, d.infoName, d.dmc].filter(Boolean).join('\n')}
                      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'copy'; setDrag({ from: null, pool: d, over: null, where: null }); }} onDragEnd={() => setDrag(null)}>
                      <span className="twist" />
                      <input type="checkbox" className="chk" checked={false} disabled={!writable} aria-label={`Include ${d.techName || d.file}`} onChange={() => addModule(d)} />
                      <span className="label trunc"><span className="v2-mod-title">{d.techName || d.file}</span>{d.infoName ? <span className="pub-sub"> · {d.infoName}</span> : null}</span>
                      <span className="meta">{d.issueNumber ? `${d.issueNumber}-${d.inWork}` : ''}</span>
                      {writable ? actions(<button className="icon-btn" onClick={() => addModule(d)} aria-label={`Add ${d.techName || d.file} to the selected chapter`} title={`Add to ${selTitle ? `“${selTitle}”` : 'the selected chapter'}`}><Icon name="plus" size={14} /></button>) : null}
                    </div>
                  ))}
                  <MoreRows shown={poolDrawn.limit} total={pool.length} onMore={poolDrawn.more} onAll={poolDrawn.all} />
                </> : null}
              </div>
            ) : null}
          </div>
        </div>
        {missing > 0 ? <div className="alert warning pub-note"><Icon name="warn" /><div>{missing} entr{missing === 1 ? 'y points' : 'ies point'} at data modules this project does not have. Nothing is published for {missing === 1 ? 'it' : 'them'} until you import the module or remove the entry.</div></div>
          : notPlaced > 0 ? <div className="alert warning pub-note"><Icon name="warn" /><div>{notPlaced} data module{notPlaced === 1 ? ' is' : 's are'} not in the publication. {writable ? 'Select a chapter, then tick a module under Not placed to add it.' : ''}</div></div>
          : entries.length ? <div className="alert success pub-note"><Icon name="ok" /><div>All {counts.dms} data module{counts.dms === 1 ? ' is' : 's are'} in the publication, in {counts.folders} chapter{counts.folders === 1 ? '' : 's'}.</div></div> : null}
        {!writable ? <div className="alert warning pub-note"><Icon name="warn" /><div>You have {role} access: you can look at the publication, but only editors, managers and owners can change or build it.</div></div> : null}
      </aside>

      <section className="pane viewer" aria-label="PDF preview" data-testid="pub-preview">
        <LazyPdfViewer src={pdfSrc} downloadName="publication.pdf" download={false} startWidth={startW} onView={setPdfView} onOutline={setOutline}
          placeholder={<div className="pub-empty"><Icon name="pdf" size={30} /><p>{writable ? 'Not built yet. Press Build publication to make the PDF.' : 'Not built yet.'}</p></div>} />
      </section>

      <aside className="pane" aria-label="Build settings">
        <div className="tabs" role="tablist" aria-label="Build">
          <button className="tab" role="tab" aria-selected={side === 'build'} onClick={() => setSide('build')}>Build</button>
          <button className="tab" role="tab" aria-selected={side === 'history'} onClick={() => setSide('history')}>History</button>
        </div>
        <div className="scroll">
          {side === 'build' ? <>
            <div className="opt">
              {error ? <div><Alert tone="bad">{error}</Alert>{rulesOnly ? <p className="v2-hint" style={{ margin: '6px 0 0' }}>Only business rules (BREX) are broken. You can still generate the PDF to look at it; it stays stamped NOT RELEASED and cannot be approved until the rules are met. <button className="btn sm primary" disabled={busy !== null} onClick={() => void build(true)} data-testid="generate-anyway">Generate anyway</button></p> : null}</div> : null}
              {refusal ? <PublishRefusal refusal={refusal} projectId={id} can={can} mode="draft" onDismiss={() => setRefusal(null)} onRecorded={() => { setWaiverTick((t) => t + 1); void build(); }} /> : null}
              <div className="field"><label htmlFor="pub-layout">Output profile</label>
                <select className="select" id="pub-layout" value={p.templateRef} disabled={!ownerSettings} onChange={(e) => void setOption({ templateRef: e.target.value }, 'Output profile changed')}>
                  {layouts.map((r) => <option key={r} value={r}>{LAYOUTS[r] ?? r}{paper ? ` - ${paper}` : ''}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="pub-wm">Watermark</label>
                <select className="select" id="pub-wm" value="auto" onChange={() => undefined}><option value="auto">{released ? 'Release settings (project released)' : 'NOT RELEASED (project not released)'}</option></select>
                <span className="hint">{released ? 'Set on Review and release.' : 'Added automatically until the project is released.'}</span>
              </div>
              <div className="field"><label htmlFor="pub-title">Publication title</label>
                <input className="input" id="pub-title" value={String(meta.pmTitle ?? '')} placeholder={summary.project.name} disabled={!writable}
                  onChange={(e) => { setMeta({ ...meta, pmTitle: e.target.value }); setDirty(true); }} />
              </div>
              <label className="check"><input type="checkbox" checked={p.headerLogo !== false} disabled={!ownerSettings} onChange={(e) => void setOption({ headerLogo: e.target.checked }, e.target.checked ? 'Header logo on' : 'Header logo off')} />Logo in the page header</label>
              <label className="check"><input type="checkbox" checked={side1.enabled !== false} disabled={!ownerSettings} onChange={(e) => void setOption({ sideText: { ...side1, enabled: e.target.checked } }, e.target.checked ? 'Margin text on' : 'Margin text off')} />Margin text (draft line, printed stamp)</label>
              <label className="check"><input type="checkbox" checked={side1.draftNote !== false} disabled={!ownerSettings || side1.enabled === false} onChange={(e) => void setOption({ sideText: { ...side1, draftNote: e.target.checked } }, e.target.checked ? 'Draft note on' : 'Draft note off')} />Draft note in the margin</label>
            </div>
            <div className="card-head"><h3>Last build</h3><LastBuildBadge jobs={jobs} pdf={lastPdf} busy={busy === 'build'} /></div>
            <BuildList jobs={jobs} pdf={lastPdf} pages={pdfView?.numPages ?? 0} limit={2} />
            <div className="pub-waivers"><PublishWaivers projectId={id} can={can} refreshKey={waiverTick} /></div>
          </> : (
            <div data-testid="pub-history">
              <div className="card-head"><h3>Builds</h3><LastBuildBadge jobs={jobs} pdf={lastPdf} busy={busy === 'build'} /></div>
              <BuildList jobs={jobs} pdf={lastPdf} pages={pdfView?.numPages ?? 0} />
              <div className="card-head"><h3>Releases</h3></div>
              {rel.loading && !rel.data ? <Loading /> : rel.error ? <div className="opt"><Alert tone="bad">{rel.error}</Alert></div> : (
                <ul className="hist">
                  {(rel.data?.history ?? []).length === 0 ? <li><Icon name="clock" /><div className="faint">Nothing submitted yet</div><span /></li> : (rel.data?.history ?? []).map((h) => (
                    <li key={h.id}><Icon name={h.status === 'approved' ? 'ok' : h.status === 'rejected' ? 'xcircle' : 'clock'} />
                      <div><strong>{h.releaseNumber ? `Release ${h.releaseNumber}` : 'Review request'}</strong><div className="faint">{h.status === 'rejected' ? 'changes requested' : h.status === 'pending' ? 'in review' : h.status}{h.requestedBy ? ` · ${h.requestedBy}` : ''}</div></div>
                      <span className="faint" title={h.requestedAt}>{ago(h.requestedAt)}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="build">
          <div className={`progress${busy === 'build' ? ' busy' : ''}`} role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={busy === 'build' ? undefined : 0}><i style={{ width: busy === 'build' ? '40%' : '0%' }} /></div>
          {busy === 'build' && progress.lines.length ? <div className="v2-log">{progress.lines.slice(-5).map((l, i) => <div key={i}>{l}</div>)}</div> : null}
          <button className="btn primary" onClick={() => void build(false)} disabled={busy !== null || !writable} data-testid="build-publication">{busy === 'build' ? <Spinner /> : <Icon name="play" />}Build publication</button>
          <button className="btn" onClick={() => nav('../release')}><Icon name="external" />Review and release</button>
        </div>
      </aside>

      {guard}
      {naming ? <PromptModal title="New chapter" label="Chapter title" confirmLabel="Add chapter" onClose={() => setNaming(false)} onSubmit={async (t) => { addChapter(t); }} /> : null}
      {rename ? <PromptModal title="Rename" label="Title" initial={rename.title} onClose={() => setRename(null)} onSubmit={async (t) => { apply(updateAt(entries, pathOf(rename.key), (x) => ({ ...x, title: t }) as PmEntry)); }} /> : null}
    </div>
  );
}

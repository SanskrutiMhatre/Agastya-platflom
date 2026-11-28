// Publication of a JSS / JSG project: the chapters of the document with the document code (DMC) of each section, the publication identity (PMC), the picture names (ICN), and one
// clear place to save and build. It is the counterpart of the S1000D Publication page and looks and works like it: chapter cards with module rows, drag and drop (with up / down
// buttons for the keyboard), rename, add a chapter, undo, an unsaved-changes bar and an Output card.
//
// What is different is what a "module" is. In S1000D the author picks data modules out of a pool and places them; here every section of the document already is a data module of
// the package the document exports as, so there is no pool and nothing to place - the page arranges what the document has. What the author does is a short list of edits (see
// lib/docPublication.ts); the page shows the tree with the edits applied, and Save writes the same edits into the document through the same model the editor uses, then the server
// keeps the codes of the sections that moved. Where the stencil fixes the chapters or the sections of a document type, they are shown and cannot be moved.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import '../../styles/pages/structure.css';   // WP-35: this page's styles load with its chunk
import { useNavigate } from 'react-router-dom';
import { contentApi } from '../../api';
import { ApiError } from '../../api/client';
import { jsgApi } from '../../api/jsg';
import { jssApi } from '../../api/jss';
import { xengineApi, type DocCodes, type DocCodesPatch } from '../../api/xengine';
import { ConvertButton, ExportProjectButton } from '../../components/DocCodes';
import { Icon } from '../../components/Icon';
import { LazyPdfViewer } from '../../components/pdf/LazyPdfViewer';
import type { OutlinePage, PdfView } from '../../components/pdf/PdfJsViewer';
import { BuildList, LastBuildBadge, PubStatus, PubTopbar, pagesFromOutline, paperShort, sheetWidth, useBuilds, type PageNode } from './pubChrome';
import { Alert, ConfirmModal, Empty, Loading, PromptModal, Spinner, errText, useAsync } from '../../components/ui';
import { canBuild, canWrite, useProject } from '../../layouts/ProjectShell';
import { JsgParseError, parseJsg } from '../../jsg/xml';
import { serializeJsg } from '../../jsg/xml';
import { JssParseError, parseJss, serializeJss } from '../../jss/xml';
import {
  applyEdits, applyToJsg, applyToJss, buildPublication, fingerprintOfJsg, fingerprintOfJss, fingerprintOfTree, isNoop, landing, sameFingerprint, starterSections, type Edit, type PubModule,
} from '../../lib/docPublication';
import { useLeaveGuard } from '../../lib/leaveGuard';
import { useProgress } from '../../lib/progress';
import { useUi } from '../../store/ui';

type Where = 'before' | 'after' | 'inside';
type Drag = { kind: 'chapter'; ch: number } | { kind: 'section'; ch: number; at: number } | { kind: 'appendix'; at: number };
const STALE = 'The document was changed after this page was opened (its chapters or sections are not the same any more), so the arrangement was not saved. Reload the page to see the document as it is now.';

const kindText = (m: PubModule): string => (m.kind === 'chapter-intro' ? 'Introduction of the chapter' : m.kind === 'appendix' ? 'Appendix' : m.kind === 'plate' ? 'Plate' : 'Section');
const detail = (m: PubModule): string => [kindText(m), m.subs.length ? `${m.subs.length} sub-heading${m.subs.length === 1 ? '' : 's'}` : '', m.pictures.length ? `${m.pictures.length} picture${m.pictures.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');

export function DocPublicationPage() {
  const { id, role, can, summary, reload } = useProject();
  const nav = useNavigate(); const toast = useUi((s) => s.toast); const progress = useProgress(id);
  const jss = summary.project.authoring === 'jss-xml';
  const writable = canWrite(can);
  const codes = useAsync(() => xengineApi.codes(id), [id]);
  const rules = useAsync(async () => (jss ? await jssApi.read(id) : null), [id, jss]);     // the stencil's rules (are the chapters and sections the author's?) and its first chapter
  const base = useMemo(() => (codes.data ? buildPublication(codes.data) : null), [codes.data]);

  const [edits, setEditsRaw] = useState<Edit[]>([]);
  // WP-22 (GAP-003): undo is a stack with redo; a new edit clears what could be redone, as in the editors
  const [undone, setUndone] = useState<Edit[]>([]);
  const setEdits = (next: Edit[] | ((l: Edit[]) => Edit[])) => { setEditsRaw(next); setUndone([]); };
  const undo = () => { if (!edits.length) return; setUndone([...undone, edits[edits.length - 1]]); setEditsRaw(edits.slice(0, -1)); };
  const redo = () => { if (!undone.length) return; setEditsRaw([...edits, undone[undone.length - 1]]); setUndone(undone.slice(0, -1)); };
  const [adding, setAdding] = useState<{ kind: 'section'; ch: number } | { kind: 'appendix' } | null>(null);
  const [delApp, setDelApp] = useState<{ at: number; title: string } | null>(null);
  const view = useMemo(() => (base ? applyEdits(base, edits) : null), [base, edits]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<{ key: string; where: Where } | null>(null);
  const [busy, setBusy] = useState<'save' | 'build' | 'identity' | null>(null);
  const [error, setError] = useState('');
  const [naming, setNaming] = useState(false);
  const [rename, setRename] = useState<{ ch: number; at: number | null; title: string } | null>(null);
  const [del, setDel] = useState<{ ch: number; at: number | null; title: string; n: number } | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<DocCodesPatch>({});
  const [builtAt, setBuiltAt] = useState<string | null>(null);   // a build made on this page (a JSG project has no build record of its own)
  const [hasPdf, setHasPdf] = useState(false);
  const [side, setSide] = useState<'build' | 'history'>('build');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [outline, setOutline] = useState<OutlinePage[] | null>(null);
  const [pdfView, setPdfView] = useState<PdfView | null>(null);
  const [startW] = useState(sheetWidth);
  const jobs = useBuilds(id, `${summary.build?.builtAt ?? ''}|${builtAt ?? ''}|${busy}`);
  // the page each chapter and section starts on in the built PDF (its bookmarks), shown at the right of the row as the mockup does ("p.19")
  const pages = useMemo(() => {
    if (!view) return new Map<string, number>();
    const nodes: PageNode[] = [
      ...view.chapters.map((ch) => ({ key: ch.key, title: ch.title, kids: ch.modules.map((m) => ({ key: m.key, title: m.title })) })),
      ...view.appendices.map((m) => ({ key: m.key, title: m.title })), ...view.plates.map((m) => ({ key: m.key, title: m.title })),
    ];
    const map = pagesFromOutline(outline, nodes);
    // a chapter's page is its first section's when the bookmarks have no row of the chapter's own
    for (const ch of view.chapters) if (!map.has(ch.key)) { const first = ch.modules.find((m) => map.has(m.key)); if (first) map.set(ch.key, map.get(first.key)!); }
    return map;
  }, [outline, view]);
  const dirty = edits.length > 0;
  const saveRef = useRef<() => Promise<boolean>>();
  const guard = useLeaveGuard(dirty, { what: 'changes to the arrangement of the document', save: () => saveRef.current?.() ?? Promise.resolve(false) });

  useEffect(() => { setEdits([]); setError(''); }, [id]);
  useEffect(() => { const c = codes.data; if (c) setForm({ modelIdentCode: c.modelIdentCode, pmIssuer: c.pmc.pmIssuer, pmNumber: c.pmc.pmNumber, pmVolume: c.pmc.pmVolume }); }, [codes.data]);
  useEffect(() => {                                           // a JSG PDF built earlier is still there; the project record only knows the JSS one
    if (jss || summary.build) return; let live = true;
    void fetch(jsgApi.pdfUrl(id), { method: 'HEAD', credentials: 'same-origin' }).then((r) => { if (live && r.ok) setHasPdf(true); }).catch(() => undefined);
    return () => { live = false; };
  }, [id, jss, summary.build]);

  // what the stencil lets the author do
  const jsgEditable = !jss && !!base && base.plates.length === 0;                 // a parts list (plates) is not arranged here
  const chaptersFree = writable && (jss ? rules.data?.chapterRule === 'free' : jsgEditable);
  const sectionsFree = writable && (jss ? !!rules.data && !rules.data.sectionsFixed : jsgEditable);
  const appendicesFree = writable && jsgEditable;
  const locked = !!view && writable && !(chaptersFree && sectionsFree) && (jss ? !!rules.data : !jsgEditable);

  if ((codes.loading && !codes.data) || (jss && rules.loading && !rules.data)) return <Loading />;
  if (codes.error || !codes.data || !base || !view) return <div className="v2-page"><Alert tone="bad">{codes.error || 'Could not read the publication.'}</Alert></div>;
  const c: DocCodes = codes.data;

  // ── editing ──────────────────────────────────────────────────────────────
  const push = (e: Edit) => { if (isNoop(view, e)) return; setEdits((l) => [...l, e]); setError(''); };
  const nSecs = (ch: number): number => view.chapters[ch]?.modules.filter((m) => m.kind === 'section').length ?? 0;
  const shiftChapter = (i: number, d: -1 | 1) => { if (i + d >= 0 && i + d < view.chapters.length) push({ op: 'moveChapter', from: i, to: i + d }); };
  const shiftSection = (ci: number, si: number, d: -1 | 1) => {
    const from = { ch: ci, at: si };
    if (si + d >= 0 && si + d < nSecs(ci)) push({ op: 'moveSection', from, to: { ch: ci, at: si + d } });
    else if (d < 0 && ci > 0) push({ op: 'moveSection', from, to: { ch: ci - 1, at: nSecs(ci - 1) } });       // up from the first section: the end of the chapter above
    else if (d > 0 && ci < view.chapters.length - 1) push({ op: 'moveSection', from, to: { ch: ci + 1, at: 0 } });
  };
  const half = (ev: DragEvent): 'before' | 'after' => { const r = ev.currentTarget.getBoundingClientRect(); return (ev.clientY - r.top) / r.height < 0.5 ? 'before' : 'after'; };
  const hint = (key: string, where: Where) => { if (over?.key !== key || over.where !== where) setOver({ key, where }); };
  const end = () => { setDrag(null); setOver(null); };
  const openInEditor = (key?: string) => nav(key ? `../editor?goto=${encodeURIComponent(key)}` : '../editor');       // unsaved changes: the leave guard asks

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy('save'); setError('');
    try {
      let errors = 0;
      if (jss) {
        const d = await jssApi.read(id); const doc = parseJss(d.xml);
        if (!sameFingerprint(fingerprintOfTree(base), fingerprintOfJss(doc))) throw new Error(STALE);
        applyToJss(doc, edits, d.chapterStarter ?? null);
        errors = (await jssApi.save(id, serializeJss(doc), d.hash)).report.errors;
      } else {
        const d = await jsgApi.read(id); const doc = parseJsg(d.xml);
        if (!sameFingerprint(fingerprintOfTree(base), fingerprintOfJsg(doc))) throw new Error(STALE);
        applyToJsg(doc, edits);
        errors = (await jsgApi.save(id, serializeJsg(doc), d.hash)).report.errors;
      }
      codes.set(await xengineApi.codes(id)); setEdits([]); reload();         // the server has made the codes of anything new and kept the codes of what moved
      toast(errors ? `Saved as a draft: ${errors} error${errors === 1 ? '' : 's'} to fix in the editor before a PDF can be built.` : 'The arrangement is saved.', errors ? 'info' : 'success');
      return true;
    } catch (e) { setError(e instanceof JssParseError || e instanceof JsgParseError ? `The document cannot be read: ${e.message}` : errText(e)); return false; }
    finally { setBusy(null); }
  };

  saveRef.current = save;

  const build = async () => {
    if (dirty && !(await save())) return;
    setBusy('build'); progress.clear(); setError('');
    try {
      const ms = (jss ? await contentApi.build(id) : await jsgApi.build(id)).totalMs ?? 0;
      toast(`Publication built in ${(ms / 1000).toFixed(1)} s`, 'success'); setBuiltAt(new Date().toISOString()); setHasPdf(true); reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const n = ((e.body as { findings?: unknown[] } | undefined)?.findings ?? []).length;
        setError(`The publication was not built: ${n ? `${n} problem${n === 1 ? '' : 's'} in the document` : e.message}. Open the editor and press Check to see them.`);
      } else setError(errText(e));
    } finally { setBusy(null); }
  };

  const saveIdentity = async () => {
    setBusy('identity');
    try {
      const patch: DocCodesPatch = {};
      for (const k of ['modelIdentCode', 'pmIssuer', 'pmNumber', 'pmVolume'] as const) if (form[k] !== undefined && form[k] !== (k === 'modelIdentCode' ? c.modelIdentCode : c.pmc[k])) patch[k] = form[k];
      codes.set(await xengineApi.setCodes(id, patch)); toast('Publication identity saved.', 'success');
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(null); }
  };
  const showDmc = async (on: boolean) => {
    codes.set({ ...c, show: { ...c.show, dmc: on } });
    try { codes.set(await xengineApi.setShow(id, { dmc: on })); } catch (e) { toast(errText(e), 'error'); codes.reload(); }
  };

  // ── render ───────────────────────────────────────────────────────────────
  const total = view.chapters.reduce((n, ch) => n + ch.modules.length, 0) + view.appendices.length + view.plates.length;
  const pics = c.pictures.filter((p) => !q || `${p.file} ${p.icn} ${p.packageFile}`.toLowerCase().includes(q.toLowerCase()));
  const titleOf = (key: string): string => c.modules.find((m) => m.key === key)?.title ?? '';
  const build_ = summary.build;
  const pdfHref = jss ? contentApi.pdfUrl(id, true) : jsgApi.pdfUrl(id, true);
  // the document code of a row: in the row's tooltip and read out to a screen reader (the mockup's rows show the title and the page only)
  const code = (m: PubModule) => <span className="pub-sronly" data-testid="pub-code">{m.fresh ? 'code made on save' : m.dmc}</span>;
  const tip = (m: PubModule) => [m.title, detail(m), m.fresh ? 'Code made on save' : m.dmc, m.origin === 'imported' ? 'Code kept from the imported package' : ''].filter(Boolean).join('\n');
  const tick = <span className="pub-tick" aria-hidden="true" title="In the publication" />;
  const twist = (key: string, title: string) => {
    const open = !closed.has(key);
    return <button type="button" className="twist" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} title={open ? "Collapse" : "Expand"} onClick={(ev) => { ev.stopPropagation(); setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; }); }}><Icon name={open ? 'down' : 'right'} size={14} /></button>;
  };
  const depth = (d: number) => ({ '--depth': d }) as CSSProperties;
  const meta = (m: PubModule) => { const pg = pages.get(m.key); return <span className="meta">{pg ? `p.${pg}` : m.fresh ? 'new' : ''}</span>; };

  const moduleRow = (m: PubModule, ci: number, si: number | null) => {
    const k = si === null ? `i${ci}` : `s${ci}.${si}`; const hintW = over?.key === k ? over.where : null; const movable = si !== null && sectionsFree;
    return (
      <div key={m.key} className={`node v2-mod ${hintW === 'before' ? 'drop-before' : ''} ${hintW === 'after' ? 'drop-after' : ''}`} data-testid="pub-module" data-code={m.dmc} draggable={movable} style={depth(1)} title={tip(m)}
        onDragStart={(ev) => { if (!movable) return; ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation(); setDrag({ kind: 'section', ch: ci, at: si! }); }} onDragEnd={end}
        onDragOver={(ev) => { if (!movable || drag?.kind !== 'section') return; ev.preventDefault(); ev.stopPropagation(); hint(k, half(ev)); }}
        onDrop={(ev) => { if (drag?.kind !== 'section') return; ev.preventDefault(); ev.stopPropagation(); const w = half(ev); const same = drag.ch === ci; const at = landing(nSecs(ci), same ? drag.at : null, si!, w); push({ op: 'moveSection', from: { ch: drag.ch, at: drag.at }, to: { ch: ci, at } }); end(); }}>
        <span className="twist" />
        {tick}
        <span className="v2-mod-no">{m.label}</span>
        <span className="label trunc"><span className="v2-mod-title">{m.title || '(untitled)'}</span></span>
        {m.fresh ? <span className="dot warning" title="New: its code is made when you save" /> : null}
        {code(m)}
        {meta(m)}
        <span className="v2-mod-actions">
          {!m.fresh ? <button className="icon-btn" aria-label={`Open ${m.title} in the editor`} title="Open in editor" onClick={() => openInEditor(m.key)}><Icon name="editor" size={14} /></button> : null}
          {movable ? <>
            <button className="icon-btn" aria-label={`Move ${m.title} up`} title="Move up" onClick={() => shiftSection(ci, si!, -1)}><Icon name="up" size={14} /></button>
            <button className="icon-btn" aria-label={`Move ${m.title} down`} title="Move down" onClick={() => shiftSection(ci, si!, 1)}><Icon name="down" size={14} /></button>
            <button className="icon-btn" aria-label={`Rename ${m.title}`} title="Rename" onClick={() => setRename({ ch: ci, at: si, title: m.title })}><Icon name="edit" size={14} /></button>
            <button className="icon-btn" aria-label={`Delete ${m.title}`} title="Delete this section" onClick={() => setDel({ ch: ci, at: si, title: m.title, n: 1 })}><Icon name="trash" size={14} /></button>
          </> : null}
        </span>
      </div>
    );
  };

  const chapterCard = (ch: (typeof view.chapters)[number], ci: number) => {
    const k = `c${ci}`; const hintW = over?.key === k ? over.where : null; let si = -1;
    return (
      <section key={ch.key} className={`v2-chapter ${hintW === 'inside' ? 'drop-inside' : ''} ${hintW === 'before' ? 'drop-before' : ''} ${hintW === 'after' ? 'drop-after' : ''}`} data-testid="chapter" aria-label={`Chapter ${ch.title}`}
        onDragOver={(ev) => {
          if (!drag) return;
          if (drag.kind === 'chapter' && chaptersFree) { ev.preventDefault(); ev.stopPropagation(); hint(k, half(ev)); }
          else if (drag.kind === 'section' && sectionsFree) { ev.preventDefault(); ev.stopPropagation(); hint(k, 'inside'); }
        }}
        onDrop={(ev) => {
          if (!drag) return; ev.preventDefault(); ev.stopPropagation();
          if (drag.kind === 'chapter') push({ op: 'moveChapter', from: drag.ch, to: landing(view.chapters.length, drag.ch, ci, half(ev)) });
          else if (drag.kind === 'section') { const same = drag.ch === ci; push({ op: 'moveSection', from: { ch: drag.ch, at: drag.at }, to: { ch: ci, at: same ? nSecs(ci) - 1 : nSecs(ci) } }); }
          end();
        }}>
        <header className="node group v2-chapter-head" draggable={chaptersFree} style={{ ...depth(0), cursor: chaptersFree ? undefined : 'default' }} title={`${ch.modules.length} module${ch.modules.length === 1 ? '' : 's'}${ch.fresh ? ' · new: its code is made when you save' : ''}`}
          onDragStart={(ev) => { if (!chaptersFree) return; ev.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'chapter', ch: ci }); }} onDragEnd={end}>
          {twist(ch.key, ch.title)}
          {tick}
          <span className="v2-chapter-no">{ch.label}</span>
          <h3 className="label trunc">{ch.title || '(untitled chapter)'}</h3>
          {ch.fresh ? <span className="dot warning" title="New chapter" /> : null}
          <span className="meta">{ch.modules.length}</span>
          {chaptersFree || sectionsFree ? <span className="v2-mod-actions">
            {chaptersFree ? <>
              <button className="icon-btn" aria-label={`Move ${ch.title} up`} title="Move up" onClick={() => shiftChapter(ci, -1)}><Icon name="up" size={14} /></button>
              <button className="icon-btn" aria-label={`Move ${ch.title} down`} title="Move down" onClick={() => shiftChapter(ci, 1)}><Icon name="down" size={14} /></button>
              <button className="icon-btn" aria-label={`Rename ${ch.title}`} title="Rename" onClick={() => setRename({ ch: ci, at: null, title: ch.title })}><Icon name="edit" size={14} /></button>
              <button className="icon-btn" aria-label={`Delete ${ch.title}`} title={view.chapters.length > 1 ? 'Delete this chapter and its sections' : 'A document needs at least one chapter'} disabled={view.chapters.length < 2} onClick={() => setDel({ ch: ci, at: null, title: ch.title, n: ch.modules.length })}><Icon name="trash" size={14} /></button>
            </> : null}
            {sectionsFree ? <button className="icon-btn" aria-label={`Add a section to ${ch.title}`} title="Add a section at the end of this chapter" onClick={() => setAdding({ kind: 'section', ch: ci })} data-testid="add-section"><Icon name="plus" size={14} /></button> : null}
          </span> : null}
        </header>
        {closed.has(ch.key) ? null : (
          <div className="v2-chapter-body">
            {ch.modules.length === 0 ? <div className="v2-chapter-empty">This chapter has no section of its own yet.</div> : ch.modules.map((m) => moduleRow(m, ci, m.kind === 'section' ? ++si : null))}
          </div>
        )}
      </section>
    );
  };

  const appendixRow = (m: PubModule, ai: number) => {
    const k = `a${ai}`; const hintW = over?.key === k ? over.where : null;
    return (
      <div key={m.key} className={`node v2-mod ${hintW === 'before' ? 'drop-before' : ''} ${hintW === 'after' ? 'drop-after' : ''}`} data-testid="pub-appendix" draggable={appendicesFree} style={depth(1)} title={tip(m)}
        onDragStart={(ev) => { if (!appendicesFree) return; ev.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'appendix', at: ai }); }} onDragEnd={end}
        onDragOver={(ev) => { if (drag?.kind !== 'appendix' || !appendicesFree) return; ev.preventDefault(); hint(k, half(ev)); }}
        onDrop={(ev) => { if (drag?.kind !== 'appendix') return; ev.preventDefault(); push({ op: 'moveAppendix', from: drag.at, to: landing(view.appendices.length, drag.at, ai, half(ev)) }); end(); }}>
        <span className="twist" />
        {tick}
        <span className="v2-mod-no">{m.label}</span>
        <span className="label trunc"><span className="v2-mod-title">{m.title}</span></span>
        {code(m)}
        {meta(m)}
        <span className="v2-mod-actions">
          {!m.fresh ? <button className="icon-btn" aria-label={`Open ${m.title} in the editor`} title="Open in editor" onClick={() => openInEditor(m.key)}><Icon name="editor" size={14} /></button> : null}
          {appendicesFree ? <>
            <button className="icon-btn" aria-label={`Move ${m.title} up`} title="Move up" onClick={() => ai > 0 && push({ op: 'moveAppendix', from: ai, to: ai - 1 })}><Icon name="up" size={14} /></button>
            <button className="icon-btn" aria-label={`Move ${m.title} down`} title="Move down" onClick={() => ai < view.appendices.length - 1 && push({ op: 'moveAppendix', from: ai, to: ai + 1 })}><Icon name="down" size={14} /></button>
            <button className="icon-btn" aria-label={`Delete ${m.title}`} title="Delete this appendix" onClick={() => setDelApp({ at: ai, title: m.title })} data-testid="delete-appendix"><Icon name="trash" size={14} /></button>
          </> : null}
        </span>
      </div>
    );
  };

  const sections = view.chapters.reduce((n, ch) => n + ch.modules.length, 0);
  const hasBuild = !!(build_ || builtAt || hasPdf);
  const stamp = build_ ? Date.parse(build_.builtAt) || 0 : builtAt ? Date.parse(builtAt) || 0 : 0;
  const viewSrc = hasBuild ? `${jss ? contentApi.pdfUrl(id) : jsgApi.pdfUrl(id)}?t=${stamp}` : null;
  const released = summary.review?.state === 'approved';
  const lastPdf = hasBuild ? { builtAt: build_?.builtAt ?? builtAt, size: build_?.size ?? null } : null;
  const profile = jss ? `JSS ${summary.project.domain === 'naval' ? 'Naval' : 'Land'}${summary.project.manualType ? ` ${summary.project.manualType.toUpperCase()}` : ''} stencil` : `JSG ${summary.project.manualType === 'ispl' ? 'ISPL' : 'UHB'} layout`;
  // UI redesign 2026-11-28 (mockup 4): structure on the left, the built PDF on a themed canvas in the middle, build settings and history on the right
  return (
    <div className="pub" data-testid="pub-layout">
      <h1 className="pub-sr">Publication</h1>
      <PubTopbar downloadHref={hasBuild ? pdfHref : null} downloadTestId="download-pdf" canBuild={canBuild(can)} busy={busy !== null} onBuild={() => void build()} />
      <PubStatus jobs={jobs} pdf={lastPdf} view={pdfView} busy={busy === 'build'} />
      <aside className="pane" aria-label="Publication structure">
        <div className="pane-head">
          <span className="trunc" title={`${view.chapters.length} chapters, ${total} modules`}>Structure</span>
          <span className="grow" />
          {chaptersFree ? <button className="icon-btn" onClick={() => setNaming(true)} data-testid="add-chapter" aria-label="Add chapter" title="Add chapter"><Icon name="plus" /></button> : null}
          {writable ? <button className="icon-btn" onClick={undo} disabled={!dirty} data-testid="undo-arrangement" aria-label="Undo" title="Undo"><Icon name="undo" /></button> : null}
          {writable ? <button className="icon-btn" onClick={redo} disabled={!undone.length} data-testid="redo-arrangement" aria-label="Redo" title="Redo"><Icon name="undo" className="pub-flip" /></button> : null}
        </div>
        {dirty ? (
          <div className="v2-savebar" role="status" data-testid="unsaved-bar">
            <span><Icon name="alert" size={14} /> Unsaved changes to the arrangement</span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => setEdits([])}>Discard</button>
            <button className="btn sm primary" onClick={() => void save()} disabled={busy !== null} data-testid="save-publication">{busy === 'save' ? <Spinner /> : null}Save changes</button>
          </div>
        ) : null}
        <div className="scroll">
          <div className="tree focused v2-pub-main" data-testid="pub-tree">
            {view.chapters.length === 0 && view.appendices.length === 0 && view.plates.length === 0 ? (
              <Empty title="The document has no chapters yet">{chaptersFree ? <>Add a chapter to start the publication.<div style={{ marginTop: 12 }}><button className="btn primary sm" onClick={() => setNaming(true)}><Icon name="plus" />Add the first chapter</button></div></> : 'Open the editor to start writing.'}</Empty>
            ) : view.chapters.map(chapterCard)}
            {view.appendices.length || (appendicesFree && view.chapters.length) ? (
              <section className="v2-chapter" data-testid="appendices" aria-label="Appendices">
                <header className="node group v2-chapter-head" style={{ ...depth(0), cursor: 'default' }}>
                  {twist('appendices', 'Appendices')}
                  {tick}
                  <h3 className="label trunc">Appendices</h3>
                  <span className="meta">{view.appendices.length}</span>
                  {appendicesFree ? <span className="v2-mod-actions"><button className="icon-btn" onClick={() => setAdding({ kind: 'appendix' })} data-testid="add-appendix" aria-label="Add appendix" title="Add appendix"><Icon name="plus" size={14} /></button></span> : null}
                </header>
                {closed.has('appendices') ? null : <div className="v2-chapter-body">{view.appendices.length ? view.appendices.map(appendixRow) : <div className="v2-chapter-empty">No appendices.</div>}</div>}
              </section>
            ) : null}
            {view.plates.length ? (
              <section className="v2-chapter" data-testid="plates" aria-label="Plates">
                <header className="node group v2-chapter-head" style={{ ...depth(0), cursor: 'default' }}>{twist('plates', 'Plates')}{tick}<h3 className="label trunc">Plates</h3><span className="meta">{view.plates.length}</span></header>
                {closed.has('plates') ? null : <div className="v2-chapter-body">{view.plates.map((m) => (
                  <div key={m.key} className="node v2-mod" data-testid="pub-plate" style={depth(1)} title={tip(m)}><span className="twist" />{tick}<span className="v2-mod-no">{m.label}</span><span className="label trunc"><span className="v2-mod-title">{m.title}</span></span>{code(m)}{meta(m)}</div>
                ))}</div>}
              </section>
            ) : null}
          </div>
        </div>
        {locked ? <div className="alert info pub-note" data-testid="pub-locked"><Icon name="lock" /><div>{jss ? `The stencil of this document type fixes ${!chaptersFree && !sectionsFree ? 'the chapters and the sections' : !chaptersFree ? 'the chapters' : 'the sections'}, so ${!chaptersFree && !sectionsFree ? 'they' : 'these'} cannot be moved or renamed here.` : 'A parts list is arranged by its plate references, not here.'}</div></div>
          : <div className="alert success pub-note"><Icon name="ok" /><div>{sections} section{sections === 1 ? '' : 's'} in {view.chapters.length} chapter{view.chapters.length === 1 ? '' : 's'} · {c.counts.pictures} picture{c.counts.pictures === 1 ? '' : 's'}{c.counts.imported ? ` · ${c.counts.imported} code${c.counts.imported === 1 ? '' : 's'} from import` : ''}. Every section is in the publication.</div></div>}
        {!writable ? <div className="alert warning pub-note"><Icon name="warn" /><div>You have {role} access: you can look at the publication, but only editors, managers and owners can change it.</div></div> : null}
      </aside>

      <section className="pane viewer" aria-label="PDF preview" data-testid="pub-preview">
        <LazyPdfViewer src={viewSrc} downloadName={jss ? 'publication.pdf' : 'document.pdf'} download={false} startWidth={startW} onView={setPdfView} onOutline={setOutline}
          placeholder={<div className="pub-empty"><Icon name="pdf" size={30} /><p>{canBuild(can) ? 'Not built yet. Press Build publication to make the PDF.' : 'Not built yet.'}</p></div>} />
      </section>

      <aside className="pane" aria-label="Build settings">
        <div className="tabs" role="tablist" aria-label="Build">
          <button className="tab" role="tab" aria-selected={side === 'build'} onClick={() => setSide('build')}>Build</button>
          <button className="tab" role="tab" aria-selected={side === 'history'} onClick={() => setSide('history')}>History</button>
        </div>
        <div className="scroll">
          {side === 'build' ? <>
            <div className="opt">
              {error ? <Alert tone="bad">{error}</Alert> : null}
              <div className="field"><label htmlFor="pub-layout">Output profile</label>
                <select className="select" id="pub-layout" value="own" onChange={() => undefined}><option value="own">{profile}{paperShort(pdfView) ? ` - ${paperShort(pdfView)}` : ''}</option></select>
              </div>
              <div className="field"><label htmlFor="pub-wm">Watermark</label>
                <select className="select" id="pub-wm" value="auto" onChange={() => undefined}><option value="auto">{released ? 'Release settings (project released)' : 'NOT RELEASED (project not released)'}</option></select>
                <span className="hint">{released ? 'Set on Review and release.' : 'Added automatically until the project is released.'}</span>
              </div>
              <div className="field"><label htmlFor="pub-pmc">Publication code</label>
                <div className="input code" id="pub-pmc" data-testid="doc-codes-pmc" title={`${c.pmc.code}\n${c.pmc.issue} · ${c.pmc.language} · ${c.pmc.origin === 'imported' ? 'kept from the imported package' : 'made by the platform'}`}>{c.pmc.code}</div>
              </div>
              <label className="check" title="Writes each section's document code beside its heading. It is not part of the document."><input type="checkbox" checked={c.show.dmc} disabled={!writable} onChange={(e) => void showDmc(e.target.checked)} data-testid="doc-codes-show-dmc" />Show the code in the editor</label>
            </div>
            <div className="card-head"><h3>Last build</h3><LastBuildBadge jobs={jobs} pdf={lastPdf} busy={busy === 'build'} /></div>
            <BuildList jobs={jobs} pdf={lastPdf} pages={pdfView?.numPages ?? 0} limit={2} />

            <details className="pub-sect" data-testid="pub-identity">
              <summary><Icon name="right" size={14} />Publication identity<span className="grow" /><span className="faint">{c.pmc.issue}</span></summary>
              <div className="opt">
                <div className="pub-idgrid">
                  {([['modelIdentCode', 'Model code'], ['pmIssuer', 'Issuer'], ['pmNumber', 'Number'], ['pmVolume', 'Volume']] as const).map(([k, label]) => (
                    <div key={k} className="field"><label htmlFor={`pub-id-${k}`}>{label}</label><input className="input" id={`pub-id-${k}`} value={form[k] ?? ''} disabled={!writable} data-testid={`identity-${k}`} onChange={(e) => setForm({ ...form, [k]: e.target.value.toUpperCase() })} /></div>
                  ))}
                </div>
                {writable ? <div><button className="btn sm" onClick={() => void saveIdentity()} disabled={busy !== null} data-testid="identity-save">{busy === 'identity' ? <Spinner /> : null}Save identity</button></div> : null}
              </div>
            </details>
            <details className="pub-sect" data-testid="pub-pictures">
              <summary><Icon name="right" size={14} />Picture names (ICN)<span className="grow" /><span className="badge">{c.pictures.length}</span></summary>
              {c.pictures.length > 6 || q ? <div className="pub-pool-search"><input className="input search" placeholder="Search pictures…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pictures" /></div> : null}
              <ul className="hist pub-pics">
                {pics.length === 0 ? <li><Icon name="image" /><div className="faint">{c.pictures.length === 0 ? 'No pictures in this document.' : 'No picture matches.'}</div><span /></li> : pics.map((p) => (
                  <li key={p.file} data-testid="pub-picture"><Icon name="image" /><div><strong>{p.file}</strong><div className="faint mono">{p.icn}</div><div className="faint">{titleOf(p.module)}</div></div><span /></li>
                ))}
              </ul>
            </details>
            <details className="pub-sect">
              <summary><Icon name="right" size={14} />Export and convert</summary>
              <div className="opt"><div className="v2-row wrap"><ExportProjectButton id={id} dirty={dirty} saveFirst={save} label="Export project" /><ConvertButton id={id} from={jss ? 'jss' : 'jsg'} name={summary.project.name} dirty={dirty} saveFirst={save} /></div></div>
            </details>
          </> : (
            <div data-testid="pub-history">
              <div className="card-head"><h3>Builds</h3><LastBuildBadge jobs={jobs} pdf={lastPdf} busy={busy === 'build'} /></div>
              <BuildList jobs={jobs} pdf={lastPdf} pages={pdfView?.numPages ?? 0} />
            </div>
          )}
        </div>
        <div className="build">
          <div className={`progress${busy === 'build' ? ' busy' : ''}`} role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={busy === 'build' ? undefined : 0}><i style={{ width: busy === 'build' ? '40%' : '0%' }} /></div>
          {busy === 'build' && progress.lines.length ? <div className="v2-log">{progress.lines.slice(-5).map((l, i) => <div key={i}>{l}</div>)}</div> : null}
          <button className="btn primary" onClick={() => void build()} disabled={busy !== null || !canBuild(can)} data-testid="build-publication" title={canBuild(can) ? 'Save the arrangement, then build the PDF' : 'Reviewers, editors and owners can build the PDF'}>{busy === 'build' ? <Spinner /> : <Icon name="play" />}Build publication</button>
          <button className="btn" onClick={() => nav('../release')}><Icon name="external" />Review and release</button>
        </div>
      </aside>

      {naming ? <PromptModal title="New chapter" label="Chapter title" confirmLabel="Add chapter" onClose={() => setNaming(false)} onSubmit={async (t) => { push({ op: 'addChapter', title: t, sections: jss ? starterSections(rules.data?.chapterStarter) : ['New section'] }); }} /> : null}
      {del ? <ConfirmModal title={del.at === null ? 'Delete this chapter?' : 'Delete this section?'} danger confirmLabel="Delete" onClose={() => setDel(null)}
        body={del.at === null ? `Chapter “${del.title}” and its ${del.n} section${del.n === 1 ? '' : 's'} are taken out of the document when you save, with all their text, tables and pictures. Cross-references to them will need fixing. Undo brings them back until you save.` : `Section “${del.title}” is taken out of the document when you save, with its text, tables and pictures. Cross-references to it will need fixing. Undo brings it back until you save.`}
        onConfirm={async () => { push(del.at === null ? { op: 'removeChapter', ch: del.ch } : { op: 'removeSection', ch: del.ch, at: del.at }); setDel(null); }} /> : null}
      {adding ? <PromptModal title={adding.kind === 'section' ? 'New section' : 'New appendix'} label={adding.kind === 'section' ? 'Section title' : 'Appendix title'} confirmLabel={adding.kind === 'section' ? 'Add section' : 'Add appendix'}
        onClose={() => setAdding(null)} onSubmit={async (t) => { push(adding.kind === 'section' ? { op: 'addSection', ch: adding.ch, title: t } : { op: 'addAppendix', title: t }); }} /> : null}
      {delApp ? <ConfirmModal title="Delete this appendix?" danger confirmLabel="Delete" onClose={() => setDelApp(null)}
        body={`Appendix “${delApp.title}” is taken out of the document when you save, with its text, tables and pictures. Undo brings it back until you save.`}
        onConfirm={async () => { push({ op: 'removeAppendix', at: delApp.at }); setDelApp(null); }} /> : null}
      {guard}
      {rename ? <PromptModal title="Rename" label="Title" initial={rename.title} onClose={() => setRename(null)} onSubmit={async (t) => { push(rename.at === null ? { op: 'renameChapter', ch: rename.ch, title: t } : { op: 'renameSection', ch: rename.ch, at: rename.at, title: t }); }} /> : null}
    </div>
  );
}

// Publication of a JSS / JSG project: the chapters of the document with the document code (DMC) of each section, the publication identity (PMC), the picture names (ICN), and one
// clear place to save and build. It is the counterpart of the S1000D Publication page and looks and works like it: chapter cards with module rows, drag and drop (with up / down
// buttons for the keyboard), rename, add a chapter, undo, an unsaved-changes bar and an Output card.
//
// What is different is what a "module" is. In S1000D the author picks data modules out of a pool and places them; here every section of the document already is a data module of
// the package the document exports as, so there is no pool and nothing to place - the page arranges what the document has. What the author does is a short list of edits (see
// lib/docPublication.ts); the page shows the tree with the edits applied, and Save writes the same edits into the document through the same model the editor uses, then the server
// keeps the codes of the sections that moved. Where the stencil fixes the chapters or the sections of a document type, they are shown and cannot be moved.

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentApi } from '../../api';
import { ApiError } from '../../api/client';
import { jsgApi } from '../../api/jsg';
import { jssApi } from '../../api/jss';
import { xengineApi, type DocCodes, type DocCodesPatch } from '../../api/xengine';
import { ConvertButton, ExportProjectButton } from '../../components/DocCodes';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, ConfirmModal, Empty, Loading, PromptModal, Spinner, ago, errText, useAsync } from '../../components/ui';
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
  const { id, role, summary, reload } = useProject();
  const nav = useNavigate(); const toast = useUi((s) => s.toast); const progress = useProgress(id);
  const jss = summary.project.authoring === 'jss-xml';
  const writable = canWrite(role);
  const codes = useAsync(() => xengineApi.codes(id), [id]);
  const rules = useAsync(async () => (jss ? await jssApi.read(id) : null), [id, jss]);     // the stencil's rules (are the chapters and sections the author's?) and its first chapter
  const base = useMemo(() => (codes.data ? buildPublication(codes.data) : null), [codes.data]);

  const [edits, setEdits] = useState<Edit[]>([]);
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
  const builtText = build_ ? `Last built ${ago(build_.builtAt)} · ${(build_.size / 1048576).toFixed(1)} MB` : builtAt ? `Built ${ago(builtAt)}` : hasPdf ? 'A PDF has been built.' : 'Not built yet.';
  const pdfHref = jss ? contentApi.pdfUrl(id, true) : jsgApi.pdfUrl(id, true);
  const grip = (on: boolean) => (on ? <span className="v2-grip" aria-hidden="true">⋮⋮</span> : null);
  const code = (m: PubModule) => (m.fresh ? <Badge tone="warn">code on save</Badge> : <span className="v2-mono v2-mod-code" data-testid="pub-code" title={m.file} style={{ maxWidth: 330 }}>{m.dmc}</span>);

  const moduleRow = (m: PubModule, ci: number, si: number | null) => {
    const k = si === null ? `i${ci}` : `s${ci}.${si}`; const hintW = over?.key === k ? over.where : null; const movable = si !== null && sectionsFree;
    return (
      <div key={m.key} className={`v2-mod ${hintW === 'before' ? 'drop-before' : ''} ${hintW === 'after' ? 'drop-after' : ''}`} data-testid="pub-module" data-code={m.dmc} draggable={movable}
        onDragStart={(ev) => { if (!movable) return; ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation(); setDrag({ kind: 'section', ch: ci, at: si! }); }} onDragEnd={end}
        onDragOver={(ev) => { if (!movable || drag?.kind !== 'section') return; ev.preventDefault(); ev.stopPropagation(); hint(k, half(ev)); }}
        onDrop={(ev) => { if (drag?.kind !== 'section') return; ev.preventDefault(); ev.stopPropagation(); const w = half(ev); const same = drag.ch === ci; const at = landing(nSecs(ci), same ? drag.at : null, si!, w); push({ op: 'moveSection', from: { ch: drag.ch, at: drag.at }, to: { ch: ci, at } }); end(); }}>
        {grip(movable)}
        <span className="v2-mod-no">{m.label}</span>
        <div className="v2-mod-main"><div className="v2-mod-title">{m.title || '(untitled)'}{m.origin === 'imported' ? <Badge title="The code was kept from the imported package">imported code</Badge> : null}</div><div className="v2-hint v2-trunc">{detail(m)}</div></div>
        {code(m)}
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
        <header className="v2-chapter-head" draggable={chaptersFree} style={{ cursor: chaptersFree ? undefined : 'default' }}
          onDragStart={(ev) => { if (!chaptersFree) return; ev.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'chapter', ch: ci }); }} onDragEnd={end}>
          {grip(chaptersFree)}
          <span className="v2-chapter-no">{ch.label}</span>
          <h3>{ch.title || '(untitled chapter)'}</h3>
          <Badge>{ch.modules.length} module{ch.modules.length === 1 ? '' : 's'}</Badge>
          {ch.fresh ? <Badge tone="warn">new</Badge> : null}
          <span className="spacer" />
          {chaptersFree ? <>
            <button className="icon-btn" aria-label={`Move ${ch.title} up`} title="Move up" onClick={() => shiftChapter(ci, -1)}><Icon name="up" size={14} /></button>
            <button className="icon-btn" aria-label={`Move ${ch.title} down`} title="Move down" onClick={() => shiftChapter(ci, 1)}><Icon name="down" size={14} /></button>
            <button className="icon-btn" aria-label={`Rename ${ch.title}`} title="Rename" onClick={() => setRename({ ch: ci, at: null, title: ch.title })}><Icon name="edit" size={14} /></button>
            <button className="icon-btn" aria-label={`Delete ${ch.title}`} title={view.chapters.length > 1 ? 'Delete this chapter and its sections' : 'A document needs at least one chapter'} disabled={view.chapters.length < 2} onClick={() => setDel({ ch: ci, at: null, title: ch.title, n: ch.modules.length })}><Icon name="trash" size={14} /></button>
          </> : null}
        </header>
        <div className="v2-chapter-body">
          {ch.modules.length === 0 ? <div className="v2-chapter-empty">This chapter has no section of its own yet.</div> : ch.modules.map((m) => moduleRow(m, ci, m.kind === 'section' ? ++si : null))}
        </div>
      </section>
    );
  };

  const appendixRow = (m: PubModule, ai: number) => {
    const k = `a${ai}`; const hintW = over?.key === k ? over.where : null;
    return (
      <div key={m.key} className={`v2-mod ${hintW === 'before' ? 'drop-before' : ''} ${hintW === 'after' ? 'drop-after' : ''}`} data-testid="pub-appendix" draggable={appendicesFree}
        onDragStart={(ev) => { if (!appendicesFree) return; ev.dataTransfer.effectAllowed = 'move'; setDrag({ kind: 'appendix', at: ai }); }} onDragEnd={end}
        onDragOver={(ev) => { if (drag?.kind !== 'appendix' || !appendicesFree) return; ev.preventDefault(); hint(k, half(ev)); }}
        onDrop={(ev) => { if (drag?.kind !== 'appendix') return; ev.preventDefault(); push({ op: 'moveAppendix', from: drag.at, to: landing(view.appendices.length, drag.at, ai, half(ev)) }); end(); }}>
        {grip(appendicesFree)}
        <span className="v2-mod-no">{m.label}</span>
        <div className="v2-mod-main"><div className="v2-mod-title">{m.title}</div><div className="v2-hint v2-trunc">{detail(m)}</div></div>
        {code(m)}
        <span className="v2-mod-actions">
          <button className="icon-btn" aria-label={`Open ${m.title} in the editor`} title="Open in editor" onClick={() => openInEditor(m.key)}><Icon name="editor" size={14} /></button>
          {appendicesFree ? <>
            <button className="icon-btn" aria-label={`Move ${m.title} up`} title="Move up" onClick={() => ai > 0 && push({ op: 'moveAppendix', from: ai, to: ai - 1 })}><Icon name="up" size={14} /></button>
            <button className="icon-btn" aria-label={`Move ${m.title} down`} title="Move down" onClick={() => ai < view.appendices.length - 1 && push({ op: 'moveAppendix', from: ai, to: ai + 1 })}><Icon name="down" size={14} /></button>
          </> : null}
        </span>
      </div>
    );
  };

  const sections = view.chapters.reduce((n, ch) => n + ch.modules.length, 0);
  return (
    <div className="v2-page">
      <PageHeader icon="book" title="Publication" sub={`“${c.pmc.title || summary.project.name}”: arrange the chapters, then build the ${jss ? 'publication' : 'document'}.`}
        actions={<>
          {chaptersFree ? <button className="btn" onClick={() => setNaming(true)} data-testid="add-chapter"><Icon name="plus" />Add chapter</button> : null}
          {writable ? <button className="btn" onClick={() => setEdits((l) => l.slice(0, -1))} disabled={!dirty} data-testid="undo-arrangement">Undo</button> : null}
          <button className="btn btn-primary" onClick={() => void build()} disabled={busy !== null || !canBuild(role)} data-testid="build-publication" title={canBuild(role) ? 'Save the arrangement, then build the PDF' : 'Reviewers, editors and owners can build the PDF'}>{busy === 'build' ? <Spinner /> : <Icon name="rocket" />}Build publication</button>
        </>}
        stats={[
          { label: 'Chapters', value: view.chapters.length },
          { label: 'Data modules', value: total, tone: 'accent' },
          { label: 'Pictures', value: c.counts.pictures },
          { label: 'Codes from import', value: c.counts.imported, tone: c.counts.imported ? 'ok' : undefined },
          { label: 'Last build', value: build_ ? ago(build_.builtAt) : builtAt ? ago(builtAt) : hasPdf ? 'yes' : 'never', tone: build_ || builtAt || hasPdf ? 'ok' : undefined },
        ]} />

      {dirty ? (
        <div className="v2-savebar" role="status" data-testid="unsaved-bar">
          <span><Icon name="alert" size={15} /> You have unsaved changes to the arrangement of the document.</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setEdits([])}>Discard</button>
          <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy !== null} data-testid="save-publication">{busy === 'save' ? <Spinner /> : null}Save changes</button>
        </div>
      ) : null}
      {error ? <div style={{ marginBottom: 12 }}><Alert tone="bad">{error}</Alert></div> : null}
      {!writable ? <div style={{ marginBottom: 12 }}><Alert tone="warn">You have {role} access: you can look at the publication, but only editors, managers and owners can change it.</Alert></div> : null}
      {locked ? <div style={{ marginBottom: 12 }} data-testid="pub-locked"><Alert>{jss ? `The stencil of this document type fixes ${!chaptersFree && !sectionsFree ? 'the chapters and the sections' : !chaptersFree ? 'the chapters' : 'the sections'}, so ${!chaptersFree && !sectionsFree ? 'they' : 'these'} cannot be moved or renamed here.` : 'A parts list is arranged by its plate references, not here.'}</Alert></div> : null}

      <div className="v2-pub-grid">
        <div className="v2-pub-main" data-testid="pub-tree">
          {view.chapters.length === 0 && view.appendices.length === 0 && view.plates.length === 0 ? (
            <div className="v2-card"><Empty title="The document has no chapters yet">{chaptersFree ? <>Add a chapter to start the publication.<div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setNaming(true)}><Icon name="plus" size={15} />Add the first chapter</button></div></> : 'Open the editor to start writing.'}</Empty></div>
          ) : view.chapters.map(chapterCard)}
          {view.appendices.length ? (
            <section className="v2-chapter" data-testid="appendices" aria-label="Appendices">
              <header className="v2-chapter-head" style={{ cursor: 'default' }}><h3>Appendices</h3><Badge>{view.appendices.length}</Badge></header>
              <div className="v2-chapter-body">{view.appendices.map(appendixRow)}</div>
            </section>
          ) : null}
          {view.plates.length ? (
            <section className="v2-chapter" data-testid="plates" aria-label="Plates">
              <header className="v2-chapter-head" style={{ cursor: 'default' }}><h3>Plates</h3><Badge>{view.plates.length}</Badge></header>
              <div className="v2-chapter-body">{view.plates.map((m) => (
                <div key={m.key} className="v2-mod" data-testid="pub-plate"><span className="v2-mod-no">{m.label}</span><div className="v2-mod-main"><div className="v2-mod-title">{m.title}</div><div className="v2-hint v2-trunc">{detail(m)}</div></div>{code(m)}</div>
              ))}</div>
            </section>
          ) : null}
          {chaptersFree && view.chapters.length > 0 ? <button className="v2-add-chapter" onClick={() => setNaming(true)}><Icon name="plus" size={15} />Add chapter</button> : null}
        </div>

        <aside className="v2-pub-side">
          <div className="v2-card" data-testid="pub-identity">
            <div className="v2-card-head"><span>Publication code</span></div>
            <div className="v2-stack" style={{ padding: '10px 14px 14px' }}>
              <div><code className="v2-mono" data-testid="doc-codes-pmc" style={{ wordBreak: 'break-all' }}>{c.pmc.code}</code><div className="v2-hint">{c.pmc.issue} · {c.pmc.language} · {c.pmc.origin === 'imported' ? 'kept from the imported package' : 'made by the platform'}</div></div>
              <div className="v2-row wrap" style={{ gap: 8 }}>
                {([['modelIdentCode', 'Model code', 110], ['pmIssuer', 'Issuer', 90], ['pmNumber', 'Number', 90], ['pmVolume', 'Volume', 64]] as const).map(([k, label, w]) => (
                  <label key={k} className="v2-field" style={{ width: w }}><span>{label}</span><input className="v2-input" value={form[k] ?? ''} disabled={!writable} data-testid={`identity-${k}`} onChange={(e) => setForm({ ...form, [k]: e.target.value.toUpperCase() })} /></label>
                ))}
              </div>
              {writable ? <div><button className="btn btn-sm" onClick={() => void saveIdentity()} disabled={busy !== null} data-testid="identity-save">{busy === 'identity' ? <Spinner /> : null}Save identity</button></div> : null}
              <label className="v2-row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={c.show.dmc} disabled={!writable} onChange={(e) => void showDmc(e.target.checked)} data-testid="doc-codes-show-dmc" />
                <span><strong>Show the code in the editor</strong><br /><span className="v2-hint">Writes each section's document code beside its heading. It is not part of the document.</span></span>
              </label>
            </div>
          </div>

          <div className="v2-card" data-testid="pub-pictures">
            <div className="v2-card-head"><span>Picture names (ICN) <Badge>{c.pictures.length}</Badge></span></div>
            <div style={{ padding: '10px 12px 4px' }}><input className="v2-input" placeholder="Search pictures…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pictures" /></div>
            <div className="v2-pool">
              {pics.length === 0 ? <div className="v2-hint" style={{ padding: 14 }}>{c.pictures.length === 0 ? 'No pictures in this document.' : 'No picture matches.'}</div> : pics.map((p) => (
                <div key={p.file} className="v2-pool-item" data-testid="pub-picture"><div style={{ minWidth: 0, flex: 1 }}><div className="v2-mod-title">{p.file}</div><div className="v2-mono v2-hint" style={{ wordBreak: 'break-all' }}>{p.icn}</div><div className="v2-hint v2-trunc">{titleOf(p.module)}</div></div></div>
              ))}
            </div>
          </div>

          <div className="v2-card v2-card-pad v2-stack">
            <strong>Output</strong>
            <div className="v2-hint">{builtText}</div>
            <div className="v2-row wrap">
              {build_ || builtAt || hasPdf ? <a className="btn btn-sm" href={pdfHref} data-testid="download-pdf"><Icon name="download" size={13} />Download PDF</a> : null}
              <button className="btn btn-sm" onClick={() => openInEditor()}><Icon name="editor" size={13} />View in editor</button>
              <ExportProjectButton id={id} dirty={dirty} saveFirst={save} label="Export project" />
              <ConvertButton id={id} from={jss ? 'jss' : 'jsg'} name={summary.project.name} dirty={dirty} saveFirst={save} />
            </div>
            {busy === 'build' && progress.lines.length ? <div className="v2-log" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>{progress.lines.slice(-5).map((l, i) => <div key={i}>{l}</div>)}</div> : null}
            <div className="v2-hint">{sections} section{sections === 1 ? '' : 's'} in {view.chapters.length} chapter{view.chapters.length === 1 ? '' : 's'}.</div>
          </div>
        </aside>
      </div>

      {naming ? <PromptModal title="New chapter" label="Chapter title" confirmLabel="Add chapter" onClose={() => setNaming(false)} onSubmit={async (t) => { push({ op: 'addChapter', title: t, sections: jss ? starterSections(rules.data?.chapterStarter) : ['New section'] }); }} /> : null}
      {del ? <ConfirmModal title={del.at === null ? 'Delete this chapter?' : 'Delete this section?'} danger confirmLabel="Delete" onClose={() => setDel(null)}
        body={del.at === null ? `Chapter “${del.title}” and its ${del.n} section${del.n === 1 ? '' : 's'} are taken out of the document when you save, with all their text, tables and pictures. Cross-references to them will need fixing. Undo brings them back until you save.` : `Section “${del.title}” is taken out of the document when you save, with its text, tables and pictures. Cross-references to it will need fixing. Undo brings it back until you save.`}
        onConfirm={async () => { push(del.at === null ? { op: 'removeChapter', ch: del.ch } : { op: 'removeSection', ch: del.ch, at: del.at }); setDel(null); }} /> : null}
      {guard}
      {rename ? <PromptModal title="Rename" label="Title" initial={rename.title} onClose={() => setRename(null)} onSubmit={async (t) => { push(rename.at === null ? { op: 'renameChapter', ch: rename.ch, title: t } : { op: 'renameSection', ch: rename.ch, at: rename.at, title: t }); }} /> : null}
    </div>
  );
}

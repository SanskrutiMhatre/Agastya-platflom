// The editor page of a JSG document project: the JSG editor (src/jsg, independent of the JSS editor and of the S1000D Studio) beside the PDF the server builds from it.
//
// The document is one XML file, the project's source of truth. Saving writes that XML as the editor produces it; Generate saves, then asks the JSG engine on the server to
// build the PDF from the saved file (XML -> XSL-FO -> PDF), so what is shown is what the server renders, never a browser approximation.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { graphicsApi } from '../../api';
import { ApiError } from '../../api/client';
import { jsgApi, type JsgDocument, type JsgFinding } from '../../api/jsg';
import { Icon } from '../../components/Icon';
import { LazyPdfViewer } from '../../components/pdf/LazyPdfViewer';
import { ThemeToggle } from '../../components/ThemeToggle';
import { ConvertButton, ExportProjectButton, useSectionCode } from '../../components/DocCodes';
import { Alert, ConfirmModal, Loading, Spinner, ago, errText } from '../../components/ui';
import { canBuild, canWrite, useProject } from '../../layouts/ProjectShell';
import { JsgEditor } from '../../jsg/editor';
import { IsplEditor } from '../../jsg/ispl-editor';
import type { GraphicInfo, JsgEditorLike } from '../../jsg/shared';
import { JsgParseError, parseJsg } from '../../jsg/xml';
import { useLeaveGuard } from '../../lib/leaveGuard';
import { downloadText, useLocalDraft } from '../../lib/localDraft';
import { useProgress } from '../../lib/progress';
import { useUi } from '../../store/ui';
import { splitterKeys } from '../../components/a11y';

type View = 'edit' | 'split' | 'pdf';
const VIEW_KEY = 'agastya.jsg.view';
const SPLIT_KEY = 'agastya.jsg.split';

export function JsgEditorPage() {
  const ctx = useProject(); const { id, role, can, summary } = ctx;
  const toast = useUi((s) => s.toast);
  const progress = useProgress(id);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<JsgEditorLike | null>(null);
  const hashRef = useRef('');
  const splitRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<JsgDocument | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);
  const [importing, setImporting] = useState(false);
  // PUB-023: autosave is on unless the author switched it off
  const [autosave, setAutosave] = useState(() => { try { return localStorage.getItem('agastya.jsg.autosave') !== '0'; } catch { return true; } });
  // FE-006 / PUB-023: a local draft while there are unsaved changes, offered back when the editor opens again
  const draft = useLocalDraft(id, 'jsg', () => { const ed = editorRef.current; return ed && ed.isDirty() ? ed.getXml() : null; }, dirty, () => hashRef.current, loaded?.xml ?? null);
  const recovered = useRef(false);
  const recover = () => {
    const d = draft.found; if (!d || !loaded) return;
    try { parseJsg(d.xml); } catch (e) { toast(`The draft cannot be opened: ${errText(e)}`, 'error'); return; }
    draft.dismiss(); recovered.current = true; setLoaded({ ...loaded, xml: d.xml });
    toast('Your unsaved changes are back. Save to keep them.', 'info');
  };
  const [confirmReload, setConfirmReload] = useState(false);
  const wordInput = useRef<HTMLInputElement>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [view, setView] = useState<View>(() => { const v = localStorage.getItem(VIEW_KEY); return v === 'edit' || v === 'pdf' ? v : 'split'; });
  const [pct, setPct] = useState(() => Math.min(80, Math.max(30, Number(localStorage.getItem(SPLIT_KEY)) || 58)));
  const [dragging, setDragging] = useState(false);
  const writable = canWrite(can);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)'); const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);
  const shown: View = narrow && view === 'split' ? 'edit' : view;

  const load = useCallback(async () => {
    setError(''); setLoaded(null);
    try { const d = await jsgApi.read(id); hashRef.current = d.hash; setLoaded(d); setStale(false); }
    catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const applyFindings = (findings: JsgFinding[]) => editorRef.current?.setFindings(findings);

  const save = useCallback(async (): Promise<boolean> => {
    const ed = editorRef.current; if (!ed || !writable) return true;
    if (!ed.isDirty()) return true;
    setSaving(true);
    try {
      const out = await jsgApi.save(id, ed.getXml(), hashRef.current);
      hashRef.current = out.hash; ed.markSaved(); void draft.clear(); setSavedAt(new Date()); applyFindings(out.report.findings);
      if (out.report.errors) toast(`Saved as a draft: ${out.report.errors} error${out.report.errors === 1 ? '' : 's'} to fix before a PDF can be built.`, 'info');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') setStale(true); else toast(errText(e), 'error');
      return false;
    } finally { setSaving(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, writable]);

  const check = useCallback(async () => {
    const ed = editorRef.current; if (!ed) return;
    setChecking(true);
    try { const r = await jsgApi.validate(id, ed.getXml()); applyFindings(r.findings); toast(r.errors ? `${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.` : r.warnings ? `No errors; ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.` : 'No problems found.', r.errors ? 'error' : 'success'); }
    catch (e) { toast(errText(e), 'error'); }
    finally { setChecking(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // mount the editor once the document is here
  useEffect(() => {
    if (!loaded || !hostRef.current) return;
    let doc;
    try { doc = parseJsg(loaded.xml); }
    catch (e) { setError(e instanceof JsgParseError ? `The editor cannot open this document: ${e.message}` : errText(e)); return; }
    const Editor = doc.type === 'ispl' ? IsplEditor : JsgEditor;          // two document types, two editors; the page, the save and the PDF are the same
    const editor = new Editor(hostRef.current, {
      doc, readOnly: !writable,
      host: {
        graphics: async (): Promise<GraphicInfo[]> => (await graphicsApi.list(id)).map((g) => ({ src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) })),
        uploadGraphic: async (file: File): Promise<GraphicInfo> => {
          const out = await graphicsApi.upload(id, [file], 'symbol');
          const name = out.added[0]; const g = out.graphics.find((x) => x.name === name) ?? out.graphics[0];
          return { src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) };
        },
        imageUrl: (s) => graphicsApi.url(id, s.split('/').pop() ?? s),
        onDirty: setDirty,
        onSaveRequested: () => { void save(); },
        onCheckRequested: () => { void check(); },
        notify: (m, kind) => toast(m, kind === 'error' ? 'error' : 'info'),
      },
    });
    editorRef.current = editor; editor.setFindings(loaded.report.findings);
    if (recovered.current) { recovered.current = false; editor.markDirty(); } else setDirty(editor.isDirty());
    return () => { editor.destroy(); editorRef.current = null; };
    // the editor is built once per loaded document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, writable]);

  // going to another tab of the project with unsaved work asks first (the browser's own question for closing the tab is asked below)
  const guard = useLeaveGuard(dirty, { what: 'changes to the document', save, unload: false });

  // opened from the Publication or Explore page at a row: scroll to that section (the key is the one the server gives its data module)
  const [params] = useSearchParams(); const goto = params.get('goto');
  useEffect(() => { if (!loaded || !goto) return; const t = setTimeout(() => editorRef.current?.goToModule?.(goto), 150); return () => clearTimeout(t); }, [loaded, goto]);

  // the sections' document codes beside their headings, when the author has switched them on (on the Publication page; a User Handbook; a parts list has no sections of this kind)
  const sectionCode = useSectionCode(id, savedAt);
  useEffect(() => { editorRef.current?.setSectionBadge?.(loaded?.docType === 'uhb' ? sectionCode : undefined); }, [sectionCode, loaded]);

  // Auto-save: a minute after the last change, when the author has asked for it. A save that fails (someone else saved, or the document is broken) is not repeated by it.
  useEffect(() => { try { localStorage.setItem('agastya.jsg.autosave', autosave ? '1' : '0'); } catch { /* private mode */ } }, [autosave]);
  useEffect(() => {
    if (!autosave || !dirty || !writable || saving) return;
    const t = setTimeout(() => { void save(); }, 60_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave, dirty, writable, saving, savedAt]);

  /** Replace the handbook with a Word file written in the JSG styles. */
  const importWord = async (file: File | undefined) => {
    if (wordInput.current) wordInput.current.value = '';
    if (!file) return;
    if (!window.confirm(`Replace this handbook with "${file.name}"?\n\nThe whole document and its front matter are replaced by what the Word file contains (its pictures are added to the project). The handbook as it is now is kept in the project folder as jsg-document.before-import.bak.`)) return;
    setImporting(true);
    try {
      const r = await jsgApi.importDocx(id, file);
      toast(`Imported ${r.import.chapters} chapters, ${r.import.sections} sections, ${r.import.tables} tables and ${r.pictures} pictures from Word${r.import.skipped.length ? ` (${r.import.skipped.length} item${r.import.skipped.length === 1 ? '' : 's'} could not be imported)` : ''}.`, 'success');
      if (r.report.errors) toast(`The imported handbook has ${r.report.errors} error${r.report.errors === 1 ? '' : 's'} to fix before a PDF can be built.`, 'info');
      await load(); ctx.reload();
    } catch (e) { toast(errText(e), 'error'); } finally { setImporting(false); }
  };

  const generate = useCallback(async () => {
    if (!canBuild(can)) return;
    setBuilding(true); setNote(''); progress.clear();
    try {
      if (!(await save())) return;
      const out = await jsgApi.build(id);
      setSrc(`${jsgApi.pdfUrl(id)}?t=${Date.now()}`);
      setNote(`Built in ${((out.totalMs ?? 0) / 1000).toFixed(1)} s by the JSG engine`);
      if (view === 'edit') setView(window.matchMedia('(max-width: 900px)').matches ? 'pdf' : 'split');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const findings = ((e.body as { findings?: JsgFinding[] } | undefined)?.findings ?? []).filter((f) => f && typeof f.message === 'string');
        if (findings.length) applyFindings(findings);
        setNote(`The PDF was not built: ${findings.length ? `${findings.length} problem${findings.length === 1 ? '' : 's'} in the document (listed in the outline).` : e.message}`);
      } else setNote(errText(e));
    } finally { setBuilding(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, role, view, save]);

  // the last built PDF, if there is one, is shown at first
  useEffect(() => {
    let live = true;
    void fetch(jsgApi.pdfUrl(id), { method: 'HEAD', credentials: 'same-origin' }).then((r) => { if (live && r.ok) setSrc(`${jsgApi.pdfUrl(id)}?t=${Date.now()}`); }).catch(() => undefined);
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (editorRef.current?.isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault(); const rect = splitRef.current!.getBoundingClientRect(); let last = pct; setDragging(true);
    const move = (ev: PointerEvent) => { last = Math.min(80, Math.max(30, ((ev.clientX - rect.left) / rect.width) * 100)); setPct(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(false); localStorage.setItem(SPLIT_KEY, String(Math.round(last))); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <>
      {guard}
      <header className="v2-top v2-edhead">
        <h1 style={{ fontSize: 14 }} className="v2-trunc">{summary.project.name}</h1>
        {loaded ? <span className="v2-badge accent" title={`JSG document type ${loaded.docType}, from the stencil ${loaded.stencil}`}>JSG · {loaded.label}</span> : null}
        <span className={`v2-badge ${dirty ? 'warn' : 'ok'}`} data-testid="jsg-state" aria-live="polite">{saving ? 'Saving…' : dirty ? '● Unsaved changes' : savedAt ? `✓ Saved ${ago(savedAt.toISOString())}` : '✓ All changes saved'}</span>
        <span className="spacer" />
        {loaded?.docType === 'uhb' && writable ? <>
          <input ref={wordInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden data-testid="jsg-word-input" onChange={(e) => void importWord(e.target.files?.[0])} />
          <button className="btn btn-sm" onClick={() => wordInput.current?.click()} disabled={importing || saving || building} data-testid="jsg-import-word" title="Replace this handbook with a Word file written in the JSG styles (Section, Heading 1-5, L2-L5 paragraphs, Caption ...)">{importing ? <Spinner /> : <Icon name="upload" size={12} />}Import Word…</button>
        </> : null}
        {writable ? <label className="v2-row" style={{ gap: 4, fontSize: 12 }} title="Save by itself a minute after the last change"><input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} data-testid="jsg-autosave" />Auto-save</label> : null}
        <button className="btn btn-sm" onClick={() => void check()} disabled={!loaded || checking} data-testid="jsg-check" title="Check the document for problems without saving or building">{checking ? <Spinner /> : <Icon name="search" size={12} />}Check</button>
        <button className="btn btn-sm" onClick={() => void save()} disabled={!writable || !dirty || saving} data-testid="jsg-save" title={!writable ? 'You have read-only access' : !dirty ? 'Nothing to save' : 'Save the document (Ctrl+S)'}>{saving ? <Spinner /> : <Icon name="check" size={12} />}Save</button>
        {loaded?.docType === 'uhb' ? <ConvertButton id={id} from="jsg" name={summary.project.name} dirty={dirty} saveFirst={save} /> : null}
        <ExportProjectButton id={id} dirty={dirty} saveFirst={save} />
        <button className="btn btn-sm btn-primary" onClick={() => void generate()} disabled={!canBuild(can) || building || !loaded} data-testid="jsg-generate" title={!canBuild(can) ? 'Reviewers, editors and owners can build the PDF' : 'Save, then build the document as a PDF'}>{building ? <Spinner /> : <Icon name="play" size={12} />}{building ? 'Building…' : 'Generate PDF'}</button>
        <div className="v2-seg" role="group" aria-label="Editor layout">
          <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')} aria-pressed={view === 'edit'} title="Write only">Editor</button>
          {narrow ? null : <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')} aria-pressed={view === 'split'} title="Write and see the PDF side by side">Split</button>}
          <button className={view === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')} aria-pressed={view === 'pdf'} title="PDF only">PDF</button>
        </div>
        <ThemeToggle />
      </header>
      {!writable ? <Alert tone="warn">You have {role} access to this project: you can read the document, but changes cannot be saved.</Alert> : null}
      {stale ? <Alert tone="warn"><span data-testid="jsg-conflict">Someone else saved this document after you opened it, so your save was refused. Your changes are still here.</span>{' '}
        <button className="btn btn-sm" onClick={() => { const ed = editorRef.current; if (ed) downloadText(`${summary.project.name || 'document'} (my version).xml`, ed.getXml()); }} data-testid="conflict-download">Download my version</button>{' '}
        {role === 'manager' || role === 'owner' ? <><button className="btn btn-sm" onClick={() => void (async () => { try { const d = await jsgApi.read(id); hashRef.current = d.hash; setStale(false); if (await save()) toast('Saved: your version replaced the other one.', 'success'); } catch (e) { toast(errText(e), 'error'); } })()} data-testid="conflict-overwrite">Save mine over theirs</button>{' '}</> : null}
        <button className="btn btn-sm" onClick={() => { if (!dirty) void load(); else setConfirmReload(true); }} data-testid="conflict-reload">Open their version</button></Alert> : null}
      {confirmReload ? <ConfirmModal title="Open the other version?" danger confirmLabel="Discard my changes" body={<p>Your unsaved changes will be discarded. Download your version first if you want to keep a copy.</p>} onClose={() => setConfirmReload(false)} onConfirm={() => { setConfirmReload(false); void draft.clear(); void load(); }} /> : null}
      {draft.found && !stale ? <Alert tone="warn"><span data-testid="draft-found">Unsaved changes from {new Date(draft.found.savedAt).toLocaleString()} were kept on this computer.</span>{' '}
        <button className="btn btn-sm btn-primary" onClick={recover} data-testid="draft-recover">Recover them</button>{' '}
        <button className="btn btn-sm" onClick={() => void draft.clear()} data-testid="draft-discard">Discard them</button></Alert> : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {!loaded && !error ? <Loading label="Opening the document…" /> : null}
      <div className="v2-split" data-testid="jsg-split" ref={splitRef} style={{ display: loaded ? undefined : 'none', ...(dragging ? { userSelect: 'none' } : {}) }}>
        <div className="a" style={{ display: shown === 'pdf' ? 'none' : 'flex', flex: shown === 'edit' ? '1 1 0' : `0 0 ${pct}%`, minWidth: 0 }}>
          <div ref={hostRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }} data-testid="jsg-host" />
        </div>
        {shown === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" tabIndex={0} aria-valuenow={Math.round(pct)} aria-valuemin={30} aria-valuemax={80}
          onKeyDown={splitterKeys(pct, 30, 80, 2, (v) => { setPct(v); localStorage.setItem(SPLIT_KEY, String(v)); })} onPointerDown={startDrag} /> : null}
        <div className="b" style={{ flex: '1 1 0', display: shown === 'edit' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, borderLeft: shown === 'pdf' ? 0 : undefined }}>
          <div className="v2-pdfbar">
            <span className="v2-hint">{src ? 'The PDF built by the JSG engine from the saved document' : 'Press Generate PDF to build the document'}</span>
            <span className="spacer" />
            {src ? <a className="btn btn-sm" href={jsgApi.pdfUrl(id, true)} data-testid="jsg-download">Download</a> : null}
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="pdf-pane">
            <LazyPdfViewer autoFit src={src} downloadName={`${summary.project.name}.pdf`}
              placeholder={<div className="v2-center"><div className="v2-empty v2-empty-steps">
                <Icon name="pdf" size={30} />
                <h3>No PDF yet</h3>
                <ol>
                  <li>Write in the editor on the left. <strong>Ctrl+S</strong> saves.</li>
                  <li>Press <strong>Check</strong> to find problems early.</li>
                  <li>Press <strong>Generate PDF</strong> to save and build the document here.</li>
                </ol>
              </div></div>} />
          </div>
          {note || (building && progress.lines.length) ? <div className="v2-log" aria-live="polite" data-testid="jsg-note">{building ? progress.lines.slice(-4).map((l, i) => <div key={i}>{l}</div>) : <div>{note}</div>}</div> : null}
        </div>
      </div>
    </>
  );
}

// The editor page of a JSS document project: the JSS editor (src/jss, independent of the S1000D Studio) beside the PDF the server builds from it.
//
// The document is one XML file, the project's source of truth. Saving writes that XML as the editor produces it; Generate saves, then asks the server to
// build the PDF from the saved file through the JSS pipeline (XML -> XSL-FO -> PDF), so what is shown is what the server renders, never a browser approximation.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { contentApi, graphicsApi } from '../../api';
import { ApiError } from '../../api/client';
import { jssApi, type JssDocument, type JssFinding } from '../../api/jss';
import { Icon } from '../../components/Icon';
import { LazyPdfViewer } from '../../components/pdf/LazyPdfViewer';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Alert, Loading, Spinner, ago, errText } from '../../components/ui';
import { canBuild, canWrite, useProject } from '../../layouts/ProjectShell';
import { JssEditor, type GraphicInfo } from '../../jss/editor';
import { JssParseError, parseJss } from '../../jss/xml';
import { useProgress } from '../../lib/progress';
import { useUi } from '../../store/ui';

type View = 'edit' | 'split' | 'pdf';
const VIEW_KEY = 'agastya.jss.view';
const SPLIT_KEY = 'agastya.jss.split';

export function JssEditorPage() {
  const ctx = useProject(); const { id, role, summary } = ctx;
  const toast = useUi((s) => s.toast);
  const progress = useProgress(id);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<JssEditor | null>(null);
  const hashRef = useRef('');
  const splitRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<JssDocument | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [stale, setStale] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [view, setView] = useState<View>(() => { const v = localStorage.getItem(VIEW_KEY); return v === 'edit' || v === 'pdf' ? v : 'split'; });
  const [pct, setPct] = useState(() => Math.min(80, Math.max(30, Number(localStorage.getItem(SPLIT_KEY)) || 58)));
  const [dragging, setDragging] = useState(false);
  const writable = canWrite(role);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  const load = useCallback(async () => {
    setError(''); setLoaded(null);
    try { const d = await jssApi.read(id); hashRef.current = d.hash; setLoaded(d); setStale(false); }
    catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // mount the editor once the document is here
  useEffect(() => {
    if (!loaded || !hostRef.current) return;
    let doc;
    try { doc = parseJss(loaded.xml); }
    catch (e) { setError(e instanceof JssParseError ? `The editor cannot open this document: ${e.message}` : errText(e)); return; }
    const editor = new JssEditor(hostRef.current, {
      doc, maxDepth: loaded.maxDepth, readOnly: !writable,
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
    editorRef.current = editor; setDirty(editor.isDirty()); editor.setFindings(loaded.report.findings);          // a freshly loaded document has nothing unsaved
    return () => { editor.destroy(); editorRef.current = null; };
    // the editor is built once per loaded document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, writable]);

  const applyFindings = (findings: JssFinding[]) => editorRef.current?.setFindings(findings);

  const save = useCallback(async (): Promise<boolean> => {
    const ed = editorRef.current; if (!ed || !writable) return true;
    if (!ed.isDirty()) return true;
    setSaving(true);
    try {
      const out = await jssApi.save(id, ed.getXml(), hashRef.current);
      hashRef.current = out.hash; ed.markSaved(); setSavedAt(new Date()); applyFindings(out.report.findings); ctx.reload();
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
    try { const r = await jssApi.validate(id, ed.getXml()); applyFindings(r.findings); toast(r.errors ? `${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.` : r.warnings ? `No errors; ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.` : 'No problems found.', r.errors ? 'error' : 'success'); }
    catch (e) { toast(errText(e), 'error'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const generate = useCallback(async () => {
    if (!canBuild(role)) return;
    setBuilding(true); setNote(''); progress.clear();
    try {
      if (!(await save())) return;
      const out = await contentApi.build(id);
      setSrc(`${contentApi.pdfUrl(id)}?t=${Date.now()}`);
      setNote(`Built in ${((out.totalMs ?? 0) / 1000).toFixed(1)} s${out.releaseLabel ? ` · ${out.releaseLabel}` : ' · stamped NOT RELEASED'}`);
      if (view === 'edit') setView('split');
      ctx.reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const findings = ((e.body as { findings?: JssFinding[] } | undefined)?.findings ?? []).filter((f) => f && typeof f.message === 'string');
        if (findings.length) applyFindings(findings);
        setNote(`The PDF was not built: ${findings.length ? `${findings.length} problem${findings.length === 1 ? '' : 's'} in the document (listed below the page).` : e.message}`);
      } else setNote(errText(e));
    } finally { setBuilding(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, role, view, save]);

  // the last built PDF is shown at first
  useEffect(() => { if (!src && summary.build) setSrc(`${contentApi.pdfUrl(id)}?t=${new Date(summary.build.builtAt).getTime()}`); /* eslint-disable-next-line */ }, [id]);

  // leaving with unsaved work
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
      <header className="v2-top" style={{ height: 42 }}>
        <h1 style={{ fontSize: 14 }} className="v2-trunc">{summary.project.name}</h1>
        {loaded ? <span className="v2-badge accent" title={`Document type ${loaded.docType}, from the stencil ${loaded.stencil}`}>{loaded.label}</span> : null}
        <span className={`v2-badge ${dirty ? 'warn' : 'ok'}`} data-testid="jss-state" aria-live="polite">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Saved ${ago(savedAt.toISOString())}` : 'Saved'}</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void save()} disabled={!writable || !dirty || saving} data-testid="jss-save" title="Save the document (Ctrl+S)">{saving ? <Spinner /> : <Icon name="check" size={12} />}Save</button>
        <button className="btn btn-sm btn-primary" onClick={() => void generate()} disabled={!canBuild(role) || building || !loaded} data-testid="jss-generate" title="Save, then build the whole publication as a PDF">{building ? <Spinner /> : <Icon name="play" size={12} />}Generate PDF</button>
        <div className="v2-seg" role="group" aria-label="Editor layout">
          <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')} aria-pressed={view === 'edit'}>Editor</button>
          <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')} aria-pressed={view === 'split'}>Split</button>
          <button className={view === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')} aria-pressed={view === 'pdf'}>PDF</button>
        </div>
        <ThemeToggle />
      </header>
      {!writable ? <Alert tone="warn">You have {role} access to this project: you can read the document, but changes cannot be saved.</Alert> : null}
      {stale ? <Alert tone="warn">Someone else saved this document after you opened it, so your save was refused. <button className="btn btn-sm" onClick={() => { if (!dirty || window.confirm('Reload the saved document? Your unsaved changes will be lost.')) void load(); }}>Reload the saved document</button></Alert> : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      {!loaded && !error ? <Loading label="Opening the document…" /> : null}
      <div className="v2-split" data-testid="jss-split" ref={splitRef} style={{ display: loaded ? undefined : 'none', ...(dragging ? { userSelect: 'none' } : {}) }}>
        <div className="a" style={{ display: view === 'pdf' ? 'none' : 'flex', flex: view === 'edit' ? '1 1 0' : `0 0 ${pct}%`, minWidth: 0 }}>
          <div ref={hostRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }} data-testid="jss-host" />
        </div>
        {view === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" onPointerDown={startDrag} /> : null}
        <div className="b" style={{ flex: '1 1 0', display: view === 'edit' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, borderLeft: view === 'pdf' ? 0 : undefined }}>
          <div className="v2-pdfbar">
            <span className="v2-hint">{src ? 'The PDF built by the server from the saved document' : 'Press Generate PDF to build the publication'}</span>
            <span className="spacer" />
            {src ? <a className="btn btn-sm" href={contentApi.pdfUrl(id, true)} data-testid="jss-download">Download</a> : null}
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="pdf-pane">
            <LazyPdfViewer autoFit src={src} downloadName={`${summary.project.name}.pdf`}
              placeholder={<div className="v2-center"><div style={{ textAlign: 'center', padding: 16 }}><Icon name="pdf" size={30} /><p>Press <strong>Generate PDF</strong> to build the whole publication from this document.</p></div></div>} />
          </div>
          {note || (building && progress.lines.length) ? <div className="v2-log" aria-live="polite" data-testid="jss-note">{building ? progress.lines.slice(-4).map((l, i) => <div key={i}>{l}</div>) : <div>{note}</div>}</div> : null}
        </div>
      </div>
    </>
  );
}

// The editor page: project navigation + data-module list + quick preview on the
// left, the Studio editor and the generated PDF in the middle. Nothing about
// release, watermark or publication settings appears here - those are the
// project dashboard's job - which is what keeps this surface to authoring.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Alert, errText } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { studio, useStudio } from '../../lib/studioSession';
import { useUi } from '../../store/ui';
import { EditorSide } from './editor/EditorSide';
import { PdfPane } from './editor/PdfPane';

type View = 'edit' | 'split' | 'pdf';
const VIEW_KEY = 'agastya.editor.view';

export function EditorPage() {
  const ctx = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [params, setParams] = useSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => { const v = localStorage.getItem(VIEW_KEY); return v === 'edit' || v === 'pdf' ? v : 'split'; });
  const [savedTick, setSavedTick] = useState(0);
  const [error, setError] = useState('');
  const [sideKey, setSideKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [pct, setPct] = useState(() => Math.min(80, Math.max(25, Number(localStorage.getItem('agastya.editor.split')) || 56)));
  const [dragging, setDragging] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('agastya.editor.side') !== '0');
  const [bothPopped, setBothPopped] = useState(false);
  const [listW, setListW] = useState(() => Math.min(480, Math.max(180, Number(localStorage.getItem('agastya.editor.listw')) || 248)));
  const [listDrag, setListDrag] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const reload = ctx.reload;
  // With both previews in their own windows the editor takes the whole width.
  // On a narrow window two panes side by side are unusable: show one at a time.
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => { setNarrow(mq.matches); studio.relayout(); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const shown: View = (bothPopped || narrow) && view === 'split' ? 'edit' : view;
  const docs = useStudio((s) => s.docs);
  const dirtyCount = docs.filter((d) => d.dirty).length;
  const activeDoc = docs.find((d) => d.active);
  const [saving, setSaving] = useState(false);
  const saveNow = async () => { setSaving(true); try { await studio.saveActive(); } catch (e) { toast(errText(e), 'error'); } finally { setSaving(false); } };
  const setSide = (open: boolean) => { setSideOpen(open); localStorage.setItem('agastya.editor.side', open ? '1' : '0'); studio.relayout(); };

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); studio.relayout(); }, [view, bothPopped]);
  // Alongside the PDF the editor gets all the room it can: its own side panes open only when it has the page to itself.
  useEffect(() => { if (ready) studio.relayout(); }, [shown, ready]);

  /** Drag the edge of the data-module list; the width is remembered. */
  const startListDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const left = splitRef.current!.getBoundingClientRect().left;
    let last = listW;
    setListDrag(true);
    const move = (ev: PointerEvent) => { last = Math.min(480, Math.max(180, Math.round(ev.clientX - left))); setListW(last); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setListDrag(false); localStorage.setItem('agastya.editor.listw', String(last)); studio.relayout();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const rect = splitRef.current!.getBoundingClientRect();
    let last = pct;
    setDragging(true);
    const move = (ev: PointerEvent) => { last = Math.min(80, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100)); setPct(last); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDragging(false); localStorage.setItem('agastya.editor.split', String(Math.round(last))); studio.relayout();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    studio.notify = (m, kind) => toast(m, kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'info');
    studio.onSaved = () => { setSavedTick((t) => t + 1); setSideKey((k) => k + 1); reload(); };
    let alive = true;
    (async () => {
      try {
        // Another project's documents are still open: do not silently throw away unsaved work.
        if (studio.currentProject && studio.currentProject !== ctx.id && studio.hasUnsaved()) {
          if (!window.confirm('You have unsaved changes in another project’s editor. Discard them and open this project?')) { nav(`/projects/${studio.currentProject}/editor`, { replace: true }); return; }
        }
        await studio.setProject(ctx.id);
        if (!alive || !hostRef.current) return;
        await studio.mount(hostRef.current);
        setReady(true);
        // (not ?new=1: the Studio's own startup reads that one and opens the wizard itself)
        if (params.get('create') === '1') { setParams({}, { replace: true }); studio.newDocument(); }
        const object = params.get('object');
        if (object) { setParams({}, { replace: true }); await studio.openObject(object); }
        const file = params.get('file');
        if (file) {
          const line = Number(params.get('line') ?? 0) || undefined;
          setParams({}, { replace: true });
          await studio.openDm(file, line);
        }
      } catch (e) { if (alive) setError(errText(e)); }
    })();
    return () => { alive = false; studio.unmount(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.id]);

  const openAt = useCallback((file: string, line?: number) => { studio.openDm(file, line).catch((e) => toast(errText(e), 'error')); }, [toast]);

  return (
    <>
      <header className="v2-top v2-edhead">
        <button className="icon-btn" onClick={() => setSide(!sideOpen)} title={sideOpen ? 'Hide the data module panel' : 'Show the data module panel'} aria-label={sideOpen ? 'Hide the data module panel' : 'Show the data module panel'} aria-pressed={sideOpen} data-testid="toggle-side"><Icon name="panel" size={17} /></button>
        <h1 style={{ fontSize: 14 }} className="v2-trunc">{ctx.summary.project.name}</h1>
        {activeDoc ? <span className="v2-hint v2-trunc v2-crumb" title={activeDoc.file ?? activeDoc.title}>/ {activeDoc.title || activeDoc.file}</span> : null}
        <span className="spacer" />
        {ready && canWrite(ctx.role) ? (
          dirtyCount > 0
            ? <button className="btn btn-sm btn-primary" onClick={() => void saveNow()} disabled={saving || !activeDoc} title="Save the open data module (Ctrl+S)" data-testid="save-now"><Icon name="check" size={12} />{saving ? 'Saving…' : `Save${dirtyCount > 1 ? ` (${dirtyCount} unsaved)` : ''}`}</button>
            : <span className="v2-hint v2-saved" aria-live="polite" data-testid="save-state"><Icon name="check" size={12} /> All changes saved</span>
        ) : null}
        <div className="v2-seg" role="group" aria-label="Editor layout">
          <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')} aria-pressed={view === 'edit'} title="Write only">Editor</button>
          {narrow ? null : <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')} aria-pressed={view === 'split'} title="Write and see the PDF side by side">Split</button>}
          <button className={view === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')} aria-pressed={view === 'pdf'} title="PDF only">PDF</button>
        </div>
        <ThemeToggle />
      </header>
      {!canWrite(ctx.role) ? <Alert tone="warn">You have {ctx.role} access to this project: you can read and proof data modules, but changes cannot be saved.</Alert> : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <div className="v2-split" data-testid="editor-split" ref={splitRef} style={dragging || listDrag ? { userSelect: 'none' } : undefined}>
        {sideOpen ? <EditorSide ctx={ctx} refreshKey={sideKey} width={listW} onCollapse={() => setSide(false)} /> : null}
        {sideOpen ? <div className={`v2-divider ${listDrag ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize data module list" tabIndex={0}
          onPointerDown={startListDrag} onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const w = Math.min(480, Math.max(180, listW + (e.key === 'ArrowRight' ? 16 : -16))); setListW(w); localStorage.setItem('agastya.editor.listw', String(w)); studio.relayout(); } }} /> : null}
        <div className="a" style={{ display: shown === 'pdf' ? 'none' : 'flex', flex: shown === 'edit' ? '1 1 0' : `0 0 calc((100% - ${sideOpen ? listW + 5 : 0}px) * ${pct / 100})` }}>
          <div ref={hostRef} className="v2-studio-host" data-testid="studio-host" />
        </div>
        {shown === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" onPointerDown={startDrag} /> : null}
        <div className="b" style={{ flex: '1 1 0', borderLeft: shown === 'pdf' ? 0 : undefined, display: shown === 'edit' ? 'none' : undefined }}><PdfPane ctx={ctx} savedTick={savedTick} onOpenAt={openAt} onPopped={setBothPopped} /></div>
      </div>
    </>
  );
}

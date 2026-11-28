// =============================================================================
// Phase 3 (P3-4): the PDF review view. A reviewer opens a project PDF (the generated build, a quick preview, or a PDF kept in the
// project), selects words (a popover offers Comment / Suggest a change / Remark) or draws an area with the Area tool, and writes the
// comment; every thread is in the Comments panel and drawn on the page; clicking one jumps to its page and place and highlights it.
// New and changed threads arrive over the project WebSocket (lib/pdfReview.ts). Anchors are made with the shared module
// backend/src/shared/pdfAnchor.ts (PDF user space + text quote), the same one the server re-anchors with after a rebuild.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LazyPdfViewer } from '../pdf/LazyPdfViewer';
import type { PageOverlayInfo, PdfJump } from '../pdf/PdfJsViewer';
import { pdfReviewApi, type PdfAnchor, type PdfAnnotation, type PdfAnnotationKind, type PdfReviewFile, type Rect } from '../../api/pdfReview';
import { AnnotationLayer } from './AnnotationLayer';
import { PdfCommentsPanel } from './PdfCommentsPanel';
import { NO_FILTER, anchorOfArea, anchorOfSelection, pageIndexOf, toPdfRects, usePdfAnnotations, type ThreadFilter } from '../../lib/pdfReview';
import { subscribe } from '../../lib/progress';
import { Callout, errText } from '../ui';
import { Icon } from '../Icon';
import { useUi } from '../../store/ui';
import type { PageIndex } from '../../../../backend/src/shared/pdfAnchor';
import '../../styles/pages/pdf-review.css';

interface Pending { page: number; rects: Rect[]; exact?: string; area?: boolean; x: number; y: number }
interface Draft { anchor: PdfAnchor; kind: PdfAnnotationKind; x: number; y: number }
type PdfDoc = { getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> };

export function PdfReviewView({ projectId, initialKey, initialId, onKeyChange }: {
  projectId: string; initialKey?: string | null; initialId?: string | null; onKeyChange?: (key: string) => void;
}) {
  const toast = useUi((s) => s.toast);
  const [files, setFiles] = useState<PdfReviewFile[] | null>(null);
  const [key, setKey] = useState<string | null>(initialKey ?? null);
  const [src, setSrc] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const threads = usePdfAnnotations(projectId, key);
  const [focusId, setFocusId] = useState<string | null>(initialId ?? null);
  const [jump, setJump] = useState<PdfJump | null>(null);
  const [filter, setFilter] = useState<ThreadFilter>(initialId ? { ...NO_FILTER, status: 'all' } : NO_FILTER);
  const [areaTool, setAreaTool] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDoc | null>(null);
  const viewports = useRef(new Map<number, PageOverlayInfo['viewport']>());
  const indexes = useRef(new Map<number, PageIndex>());
  const blobUrl = useRef<string | null>(null);
  const jumpSeq = useRef(0);
  const me = threads.me;

  // the reviewable PDFs; the first build is opened when none was asked for
  const loadFiles = useCallback(() => pdfReviewApi.files(projectId).then((r) => { setFiles(r.files); setKey((k) => k ?? r.files[0]?.key ?? null); }, (e) => setLoadErr(errText(e))), [projectId]);
  useEffect(() => { void loadFiles(); }, [loadFiles]);
  useEffect(() => { if (key) onKeyChange?.(key); }, [key, onKeyChange]);

  // the PDF's bytes and version from one answer (what is shown is what an anchor names)
  const loadPdf = useCallback(async () => {
    if (!key) { setSrc(null); setHash(null); return; }
    try {
      const f = await pdfReviewApi.fetchFile(projectId, key);
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = URL.createObjectURL(f.blob);
      indexes.current.clear();
      setSrc(blobUrl.current); setHash(f.hash); setLoadErr('');
    } catch (e) { setSrc(null); setHash(null); setLoadErr(errText(e)); }
  }, [projectId, key]);
  useEffect(() => { void loadPdf(); setPending(null); setDraft(null); }, [loadPdf]);
  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);
  // the threads were re-anchored on a newer version than the one on screen (a rebuild): show that version
  useEffect(() => { if (threads.file?.hash && hash && threads.file.hash !== hash) void loadPdf(); }, [threads.file?.hash, hash, loadPdf]);
  // a build finished (the project socket says reload): the file and its threads are read again
  const reloadAll = useCallback(() => { void loadFiles(); void loadPdf(); threads.reload(); }, [loadFiles, loadPdf, threads]);
  const reloadRef = useRef(reloadAll); reloadRef.current = reloadAll;
  useEffect(() => subscribe((m) => { if (m.projectId === projectId && m.type === 'reload') reloadRef.current(); }), [projectId]);

  const indexOf = useCallback(async (page: number): Promise<PageIndex | null> => {
    const hit = indexes.current.get(page); if (hit) return hit;
    if (!pdfRef.current) return null;
    try { const ix = await pageIndexOf(await pdfRef.current.getPage(page)); indexes.current.set(page, ix); return ix; } catch { return null; }
  }, []);

  const goTo = useCallback((a: PdfAnnotation) => {
    const r = a.anchor.rects[0];
    setJump({ page: a.anchorState === 'orphaned' ? a.page : a.anchor.page, x: r?.[0], y: r?.[3], seq: ++jumpSeq.current });
  }, []);
  const focus = useCallback((id: string) => { setFocusId(id); const a = threads.annotations.find((x) => x.id === id); if (a) goTo(a); }, [threads.annotations, goTo]);
  // a link to one thread (?a=): jump there once its PDF and threads are loaded
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !initialId || !src) return;
    const a = threads.annotations.find((x) => x.id === initialId);
    if (a) { deepDone.current = true; window.setTimeout(() => goTo(a), 300); }
  }, [initialId, src, threads.annotations, goTo]);

  const viewPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const b = viewRef.current?.getBoundingClientRect();
    const w = viewRef.current?.clientWidth ?? 800;
    return { x: Math.max(8, Math.min(w - 350, clientX - (b?.left ?? 0))), y: Math.max(8, clientY - (b?.top ?? 0) + 8) };
  };

  // ── selection -> popover ────────────────────────────────────────────────────────────────────────────────────────────────────
  const onMouseUp = (): void => {
    if (areaTool || draft) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { setPending(null); return; }
    const range = s.getRangeAt(0);
    const start = (range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>('.pdfv-sheet');
    const page = Number(start?.dataset.page);
    const vp = viewports.current.get(page);
    if (!start || !page || !vp) return;
    const sheet = start.getBoundingClientRect();
    const inPage = Array.from(range.getClientRects()).filter((r) => r.top >= sheet.top - 2 && r.bottom <= sheet.bottom + 2);
    const rects = toPdfRects(inPage, start, vp);
    const exact = s.toString().replace(/\s+/g, ' ').trim();
    if (!rects.length || !exact) return;
    const last = inPage[inPage.length - 1];
    setPending({ page, rects, exact, ...viewPoint(last.left, last.bottom) });
  };

  const startDraft = async (kind: PdfAnnotationKind, p: Pending): Promise<void> => {
    const ix = await indexOf(p.page);
    const anchor = p.area ? anchorOfArea(ix, p.page, p.rects[0]) : ix ? anchorOfSelection(ix, p.page, p.exact ?? '', p.rects) : { page: p.page, rects: p.rects, quote: { exact: p.exact ?? '' } };
    if (!anchor) return;
    window.getSelection()?.removeAllRanges();
    setPending(null);
    if (placing) { await placeHere(placing, anchor); return; }
    setDraft({ anchor, kind, x: p.x, y: p.y });
  };

  const placeHere = async (id: string, anchor: PdfAnchor): Promise<void> => {
    try { const r = await pdfReviewApi.place(projectId, id, { fileHash: hash ?? undefined, anchor }); threads.upsert(r.annotation); setFocusId(id); toast('Comment placed again', 'success'); }
    catch (e) { toast(errText(e), 'error'); } finally { setPlacing(null); }
  };

  // ── the area tool ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const drawLayer = (info: PageOverlayInfo) => {
    if (!areaTool) return null;
    const box = drawing && drawing.page === info.page ? { left: Math.min(drawing.x0, drawing.x1), top: Math.min(drawing.y0, drawing.y1), width: Math.abs(drawing.x1 - drawing.x0), height: Math.abs(drawing.y1 - drawing.y0) } : null;
    const local = (e: React.MouseEvent<HTMLDivElement>) => { const b = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    return <div className="prv-draw" data-testid="pdf-area-surface" data-page={info.page}
      onMouseDown={(e) => { e.preventDefault(); const p = local(e); setDrawing({ page: info.page, x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
      onMouseMove={(e) => { if (drawing && drawing.page === info.page) { const p = local(e); setDrawing({ ...drawing, x1: p.x, y1: p.y }); } }}
      onMouseUp={(e) => {
        if (!drawing || drawing.page !== info.page) return;
        const d = drawing; setDrawing(null);
        if (Math.abs(d.x1 - d.x0) < 6 || Math.abs(d.y1 - d.y0) < 6) return;
        const [ax, ay] = info.viewport.convertToPdfPoint(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
        const [bx, by] = info.viewport.convertToPdfPoint(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
        const rect: Rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)].map((v) => Math.round(v * 100) / 100) as Rect;
        setAreaTool(false);
        setPending({ page: info.page, rects: [rect], area: true, ...viewPoint(e.clientX, e.clientY) });
      }}>
      {box ? <span className="prv-draft" style={box} /> : null}
    </div>;
  };

  const overlay = (info: PageOverlayInfo) => {
    viewports.current.set(info.page, info.viewport);
    return <>
      <AnnotationLayer info={info} annotations={threads.annotations} focusId={focusId} onPick={focus}
        draft={draft ? { page: draft.anchor.page, rects: draft.anchor.rects } : pending ? { page: pending.page, rects: pending.rects } : null} />
      {drawLayer(info)}
    </>;
  };

  const counts = useMemo(() => ({ open: threads.annotations.filter((a) => a.status === 'open').length }), [threads.annotations]);
  const file = files?.find((f) => f.key === key) ?? null;
  const can = me?.can;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { setPending(null); setDraft(null); setAreaTool(false); setPlacing(null); setDrawing(null); }
  };

  return (
    <div className="prv" data-testid="pdf-review" onKeyDown={onKeyDown}>
      <div className="prv-main">
        <div className="prv-bar" role="toolbar" aria-label="PDF review">
          <Icon name="pdf" />
          <select className="select" aria-label="PDF to review" value={key ?? ''} onChange={(e) => { setKey(e.target.value || null); setFocusId(null); }} data-testid="pdf-review-file">
            {!files?.length ? <option value="">No PDF yet</option> : null}
            {(files ?? []).map((f) => <option key={f.key} value={f.key}>{f.label}{f.open ? ` (${f.open} open)` : ''}</option>)}
          </select>
          {threads.file ? <span className="faint" data-testid="pdf-version" title={`SHA-256 ${threads.file.hash}`}>Version {threads.file.version} of {threads.file.versions}</span> : null}
          <span className="grow" />
          {can?.create ? <button type="button" className={`btn sm${areaTool ? ' is-on' : ''}`} aria-pressed={areaTool} onClick={() => { setAreaTool((t) => !t); setPending(null); }} data-testid="pdf-area-tool" title="Draw a rectangle on the page to comment on a picture or a region (Esc cancels)"><Icon name="image" size={14} />Area</button> : null}
          <button type="button" className="btn sm subtle" onClick={reloadAll} data-testid="pdf-reload" title="Read the PDF and its comments again"><Icon name="refresh" size={14} />Reload</button>
          {key ? <a className="btn sm subtle" href={pdfReviewApi.exportUrl(projectId, 'csv', key)} download data-testid="pdf-export-csv" title="The comments of this PDF as a spreadsheet"><Icon name="download" size={14} />CSV</a> : null}
          {key ? <a className="btn sm subtle" href={pdfReviewApi.exportUrl(projectId, 'xfdf', key)} download data-testid="pdf-export-xfdf" title="The comments as XFDF, for Acrobat or another PDF reader"><Icon name="download" size={14} />XFDF</a> : null}
          {key && can?.create ? (
            <label className="btn sm subtle" data-testid="pdf-import-xfdf" aria-label="Import XFDF" title="Import XFDF: comments made in Acrobat or another PDF reader (an .xfdf file) become comments on this PDF">
              <Icon name="upload" size={14} />
              <input type="file" accept=".xfdf,application/vnd.adobe.xfdf,text/xml" hidden data-testid="pdf-import-xfdf-file" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = ''; if (!f || !key) return;
                void f.text().then((xfdf) => pdfReviewApi.importXfdf(projectId, key, xfdf)).then((r) => {
                  toast(`${r.annotations.length} comment${r.annotations.length === 1 ? '' : 's'} and ${r.replies} repl${r.replies === 1 ? 'y' : 'ies'} imported${r.skipped.length ? `; ${r.skipped.length} left out: ${r.skipped.slice(0, 3).join(' ')}` : ''}.`, r.skipped.length ? 'info' : 'success');
                  threads.reload();
                }, (err) => toast(errText(err), 'error'));
              }} />
            </label>
          ) : null}
        </div>
        {placing ? <div className="prv-bar"><Callout tone="info">Select the words (or draw an area) where the comment belongs now. <button type="button" className="btn sm" onClick={() => setPlacing(null)}>Cancel</button></Callout></div> : null}
        {loadErr ? <div className="prv-bar"><Callout tone="warning">{loadErr}</Callout></div> : null}
        {threads.error ? <div className="prv-bar"><Callout tone="danger">{threads.error}</Callout></div> : null}
        <div className="prv-view" ref={viewRef}>
          <LazyPdfViewer src={src} downloadName={file?.key.split('/').pop() ?? 'review.pdf'} download={false} startWidth={760}
            pageOverlay={overlay} jumpTo={jump} onDocument={(d) => { pdfRef.current = d as unknown as PdfDoc | null; indexes.current.clear(); }}
            onPagesMouseUp={onMouseUp} pagesClass={areaTool ? 'prv-tool-area' : undefined}
            placeholder={<div className="empty-state"><Icon name="pdf" size={28} /><div className="title">{files && !files.length ? 'This project has no PDF yet' : 'Choose a PDF'}</div><div>Generate the publication (or keep a PDF in the project), then review it here.</div></div>} />
          {pending && !draft ? (
            <div className="prv-pop" style={{ left: pending.x, top: pending.y }} role="toolbar" aria-label="Comment on the selection" data-testid="pdf-selection-popover">
              {placing ? <button type="button" className="btn sm primary" onClick={() => void startDraft('comment', pending)} data-testid="pdf-sel-place">Place here</button>
                : can?.create ? <>
                  <button type="button" className="btn sm" onClick={() => void startDraft('comment', pending)} data-testid="pdf-sel-comment"><Icon name="comment" size={14} />Comment</button>
                  {!pending.area ? <button type="button" className="btn sm" onClick={() => void startDraft('suggestion', pending)} data-testid="pdf-sel-suggest"><Icon name="edit" size={14} />Suggest change</button> : null}
                  <button type="button" className="btn sm" onClick={() => void startDraft('remark', pending)} data-testid="pdf-sel-remark"><Icon name="flag" size={14} />Remark</button>
                </> : <span className="faint" style={{ padding: '0 var(--space-2)' }}>Reviewers, Authors and Project Managers can comment.</span>}
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setPending(null)}><Icon name="close" size={14} /></button>
            </div>
          ) : null}
          {draft ? <Composer key={`${draft.anchor.page}-${draft.x}-${draft.y}`} draft={draft} setKind={(kind) => setDraft({ ...draft, kind })} onCancel={() => setDraft(null)}
            onSave={async (fields) => {
              if (!key) return false;
              try {
                const r = await pdfReviewApi.create(projectId, { fileKey: key, fileHash: hash ?? undefined, kind: draft.kind, anchor: draft.anchor, ...fields });
                threads.upsert(r.annotation); setFocusId(r.annotation.id); setDraft(null); toast('Comment added', 'success'); return true;
              } catch (e) { toast(errText(e), 'error'); return false; }
            }} /> : null}
        </div>
      </div>
      <PdfCommentsPanel projectId={projectId} annotations={threads.annotations} me={me} focusId={focusId} onFocus={focus} filter={filter} setFilter={setFilter}
        onChanged={(a, removed) => { if (a) threads.upsert(a); if (removed) { threads.drop(removed); setFocusId(null); } }}
        onPlaceAgain={(id) => { setPlacing(id); setPending(null); setDraft(null); }} />
      <span hidden data-testid="pdf-open-count">{counts.open}</span>
    </div>
  );
}

function Composer({ draft, setKind, onCancel, onSave }: {
  draft: Draft; setKind: (k: PdfAnnotationKind) => void; onCancel: () => void;
  onSave: (f: { body: string; replacement?: string; required?: boolean }) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const [replacement, setReplacement] = useState(draft.kind === 'suggestion' ? draft.anchor.quote?.exact ?? '' : '');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = draft.kind === 'suggestion' ? true : !!body.trim();
  return (
    <form className="prv-composer" style={{ left: draft.x, top: draft.y }} data-testid="pdf-composer" aria-label="New comment"
      onSubmit={async (e) => { e.preventDefault(); if (!ready) return; setBusy(true); await onSave({ body, ...(draft.kind === 'suggestion' ? { replacement } : {}), required }); setBusy(false); }}>
      <div className="seg" role="group" aria-label="Type">
        {(['comment', 'suggestion', 'remark'] as PdfAnnotationKind[]).filter((k) => !(draft.anchor.area && k === 'suggestion')).map((k) => (
          <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => { setKind(k); if (k === 'suggestion' && !replacement) setReplacement(draft.anchor.quote?.exact ?? ''); }} data-testid={`pdf-kind-${k}`}>{k === 'comment' ? 'Comment' : k === 'suggestion' ? 'Suggestion' : 'Remark'}</button>
        ))}
      </div>
      {draft.anchor.quote ? <p className="quote">“{draft.anchor.quote.exact.slice(0, 300)}”</p> : <p className="quote">An area of page {draft.anchor.page}</p>}
      {draft.kind === 'suggestion' ? <label className="field"><span>Replace with</span>
        <textarea className="input" rows={2} maxLength={4000} value={replacement} onChange={(e) => setReplacement(e.target.value)} data-testid="pdf-composer-replacement" /></label> : null}
      <textarea className="input" rows={3} maxLength={4000} autoFocus value={body} onChange={(e) => setBody(e.target.value)} aria-label={draft.kind === 'suggestion' ? 'Why (optional)' : 'Comment'}
        placeholder={draft.kind === 'suggestion' ? 'Why (optional)…' : draft.kind === 'remark' ? 'Your review remark…' : 'Your comment…'} data-testid="pdf-composer-text"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }} />
      <div className="row">
        <label className="check"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} data-testid="pdf-composer-required" />Required before release</label>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" disabled={busy || !ready} data-testid="pdf-composer-save"><Icon name="comment" size={14} />Save</button>
      </div>
    </form>
  );
}

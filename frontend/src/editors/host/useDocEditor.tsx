// WP-21 (FE-021, the editor host contract): what the JSS and JSG editor pages had each written for themselves, written once.
//
// A document editor (jss/editor.ts, jsg/editor.ts, jsg/ispl-editor.ts) is framework-free and knows nothing of the server. The host owns, for any of them:
//   load      the document and its hash (the version the author edits)
//   dirty     the unsaved flag the editor reports, the leave guard (rail, links, Back) and the browser's question when the tab closes
//   save      Ctrl+S and the Save button, against the loaded hash; a refused save (someone else saved) keeps the author's text and offers: download it,
//             compare and merge (PRD-004), open theirs, or (manager, owner) save over theirs
//   drafts    a local draft while unsaved, offered back on the next visit (lib/localDraft.ts)
//   check     the server's check of the text in the editor, without saving
//   build     save, then the server's PDF; the PDF pane opens to show it
//   goto      ?goto=<module key> from the Publication and Explore pages; a key that no longer matches says so (GAP-004) instead of landing at the top
// The page keeps what is its own: how to build its editor, its header actions, how a draft is put back.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { Alert, ConfirmModal, Loading, errText } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { canBuild, canWrite, type ProjectCtx } from '../../layouts/ProjectShell';
import { useLeaveGuard } from '../../lib/leaveGuard';
import { downloadText, useLocalDraft } from '../../lib/localDraft';
import { useProgress } from '../../lib/progress';
import { useUi } from '../../store/ui';
import { ConflictDialog, type ConflictCheck } from './ConflictDialog';
import { DOC_IDS } from './testIds';
import type { EditorLayout } from './useEditorLayout';

export interface DocFinding { severity: 'error' | 'warning'; message: string; rule?: string; location?: string }
export interface DocReport { errors: number; warnings: number; findings: DocFinding[] }
export interface DocLoaded { xml: string; hash: string; report: { findings: DocFinding[] } }

/** What the host needs from an editor (the EditorHandle of 03 FE-021). */
export interface DocEditorHandle {
  destroy(): void;
  isDirty(): boolean;
  markSaved(): void;
  getXml(): string;
  setFindings(f: never[]): void;
  goToModule?(key: string): boolean;
}

export interface DocAdapter<L extends DocLoaded> {
  kind: 'jss' | 'jsg';
  read(id: string): Promise<L>;
  /** WP-11: `merged` = the server merged this save with another author's changes to other parts (D22); `xml` is then the document now on the server. */
  save(id: string, xml: string, hash: string): Promise<{ hash: string; report: DocReport; merged?: boolean; xml?: string }>;
  validate(id: string, xml: string): Promise<DocReport>;
  build(id: string): Promise<{ totalMs?: number; releaseLabel?: string | null }>;
  /** the Quick preview: the saved document rendered by the server as a draft PDF (nothing is published; the PDF the build made stays as it is) */
  preview?(id: string): Promise<Blob>;
  pdfUrl(id: string, download?: boolean): string;
  /** the note under the PDF after a build */
  builtNote(out: { totalMs?: number; releaseLabel?: string | null }): string;
  /** where the findings of a refused build are shown ("below the page", "in the outline") */
  findingsWhere: string;
  /** reading the text with the editor's own model: throws on a document the editor cannot open */
  parse(xml: string): void;
  /** the editor's own writing of a text (its parser and serializer), so that the three versions of a compare differ only where the content does */
  normalize?(xml: string): string;
  /** the project summary is asked for again after a save and a build (the JSS page shows its counts) */
  reloadProject: boolean;
}

/**
 * Phase 3 (P3-1): a document the page opened LIVE (co-edited in its room, collab/client.ts). Saving is continuous; Save asks the server to
 * write the file and record a revision now. The page sets `host.liveRef.current` and reports the room's state with `host.setLive`.
 */
export interface LiveDocHandle { flush(revision: boolean): Promise<{ hash: string | null }> }
export type LiveSaveState = 'saved' | 'syncing' | 'offline';

export function useDocEditor<L extends DocLoaded>(ctx: ProjectCtx, adapter: DocAdapter<L>, layout: EditorLayout) {
  const { id, role, can, summary } = ctx;
  const toast = useUi((s) => s.toast);
  const progress = useProgress(id);
  const writable = canWrite(can);
  const editorRef = useRef<DocEditorHandle | null>(null);
  const hashRef = useRef('');
  /** the text both the author and a later save started from: the loaded document, then each saved one (the base of a merge) */
  const baseRef = useRef('');
  const [loaded, setLoaded] = useState<L | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [stale, setStale] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [gotoMissing, setGotoMissing] = useState('');
  const liveRef = useRef<LiveDocHandle | null>(null);
  const [live, setLive] = useState<LiveSaveState | null>(null);

  const load = useCallback(async () => {
    setError(''); setLoaded(null);
    try { const d = await adapter.read(id); hashRef.current = d.hash; baseRef.current = d.xml; setLoaded(d); setStale(false); setFailed(false); }
    catch (e) { setError(errText(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // UI redesign: the findings the editor shows are also kept here, for the workspace's status bar and Problems panel
  const [findings, setFindings] = useState<DocFinding[]>([]);
  useEffect(() => { setFindings(loaded?.report.findings ?? []); }, [loaded]);
  const applyFindings = (list: DocFinding[]) => { setFindings(list); editorRef.current?.setFindings(list as never[]); };

  // (a live document keeps no draft: its unacknowledged changes are in IndexedDB until the server has them, collab/pending.ts)
  const draft = useLocalDraft(id, adapter.kind, () => { const ed = editorRef.current; return ed && !liveRef.current && ed.isDirty() ? ed.getXml() : null; }, dirty, () => hashRef.current, loaded?.xml ?? null);

  const save = useCallback(async (opts?: { revision?: boolean }): Promise<boolean> => {
    const ed = editorRef.current; if (!ed || !writable) return true;
    if (liveRef.current) {
      // P3-1: live: everything is sent; the server writes the file now (and a revision), so a build or a preview reads the merged document.
      // Phase 8: a Quick preview asks for the file only (revision false): an auto-preview after every save would otherwise add a history
      // entry each time; it is not a save either (no "saved" moment, so it does not start another auto-preview)
      const quiet = opts?.revision === false;
      if (!quiet) setSaving(true);
      try { await liveRef.current.flush(!quiet); if (!quiet) setSavedAt(new Date()); setFailed(false); if (adapter.reloadProject && !quiet) ctx.reload(); return true; }
      catch (e) { setFailed(true); toast(errText(e), 'error'); return false; }
      finally { setSaving(false); }
    }
    if (!ed.isDirty()) return true;
    setSaving(true);
    try {
      const xml = ed.getXml();
      const out = await adapter.save(id, xml, hashRef.current);
      hashRef.current = out.hash; baseRef.current = xml; ed.markSaved(); void draft.clear(); setSavedAt(new Date()); setFailed(false); applyFindings(out.report.findings);
      if (adapter.reloadProject) ctx.reload();
      if (out.report.errors) toast(`Saved as a draft: ${out.report.errors} error${out.report.errors === 1 ? '' : 's'} to fix before a PDF can be built.`, 'info');
      // WP-11 (D22): saved from an older version and merged on the server with another author's changes to other chapters or sections:
      // the merged document is what is saved now, so the editor shows it (and the next save and a later merge start from it)
      if (out.merged) { toast('Saved. Another author had changed other parts meanwhile; their changes are kept and shown now.', 'info'); await load(); }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') setStale(true); else { setFailed(true); toast(errText(e), 'error'); }
      return false;
    } finally { setSaving(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, writable]);

  // going to another tab of the project with unsaved work asks first (the browser's own question for closing the tab is asked below)
  const guard = useLeaveGuard(dirty, { what: 'changes to the document', save, unload: false });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (editorRef.current?.isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const check = useCallback(async () => {
    const ed = editorRef.current; if (!ed) return;
    setChecking(true);
    try {
      const r = await adapter.validate(id, ed.getXml()); applyFindings(r.findings);
      toast(r.errors ? `${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.` : r.warnings ? `No errors; ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.` : 'No problems found.', r.errors ? 'error' : 'success');
    } catch (e) { toast(errText(e), 'error'); }
    finally { setChecking(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** a build or a preview the server refused: its findings go to the Problems panel, the reason under the PDF */
  const refused = (e: unknown, what: string) => {
    if (e instanceof ApiError && e.status === 422) {
      const findings = ((e.body as { findings?: DocFinding[] } | undefined)?.findings ?? []).filter((f) => f && typeof f.message === 'string');
      if (findings.length) applyFindings(findings);
      setNote(`${what}: ${findings.length ? `${findings.length} problem${findings.length === 1 ? '' : 's'} in the document (${adapter.findingsWhere}).` : e.message}`);
    } else setNote(errText(e));
  };

  // the PDF on show: the publication the server built (a URL) or a Quick preview (a draft, held in the browser as a blob)
  const [shown, setShown] = useState<'build' | 'preview' | null>(null);
  const blobUrl = useRef<string | null>(null);
  const dropBlob = () => { if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = null; } };
  useEffect(() => dropBlob, []);

  const generate = useCallback(async () => {
    if (!canBuild(can)) return;
    setBuilding(true); setNote(''); progress.clear();
    try {
      if (!(await save())) return;
      const out = await adapter.build(id);
      dropBlob(); setSrc(`${adapter.pdfUrl(id)}?t=${Date.now()}`); setShown('build');
      setNote(adapter.builtNote(out));
      layout.reveal();
      if (adapter.reloadProject) ctx.reload();
    } catch (e) { refused(e, 'The PDF was not built'); } finally { setBuilding(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, role, save, layout.reveal]);

  // ---- Quick preview: save, then the server renders the saved document as a draft PDF beside the PDF pane's publication (no release, no build
  // state, not in the publication history). "Refresh on save" renders it again after each save while a preview is on show.
  const [previewing, setPreviewing] = useState(false);
  const [autoPreview, setAutoPreviewState] = useState(() => { try { return localStorage.getItem(`agastya.${adapter.kind}.preview.auto`) !== '0'; } catch { return true; } });
  const setAutoPreview = useCallback((on: boolean) => { setAutoPreviewState(on); try { localStorage.setItem(`agastya.${adapter.kind}.preview.auto`, on ? '1' : '0'); } catch { /* private mode */ } }, [adapter.kind]);
  const previewRun = useRef(0);
  const preview = useCallback(async () => {
    if (!canBuild(can) || !adapter.preview) return;
    const mine = ++previewRun.current;
    layout.reveal();
    setPreviewing(true); setNote(''); progress.clear();
    try {
      if (!(await save({ revision: false }))) return;          // live: the file is written for the preview, no revision
      const t0 = performance.now();
      const blob = await adapter.preview(id);
      if (mine !== previewRun.current) return;
      dropBlob(); blobUrl.current = URL.createObjectURL(blob);
      setSrc(blobUrl.current); setShown('preview');
      setNote(`Quick preview rendered by the server in ${((performance.now() - t0) / 1000).toFixed(1)} s from the saved document: a draft, not the publication (Generate PDF builds that).`);
    } catch (e) { if (mine === previewRun.current) refused(e, 'The quick preview was not rendered'); } finally { if (mine === previewRun.current) setPreviewing(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, role, save, layout.reveal]);
  // after a save (Ctrl+S, the Save button, auto-save), while a Quick preview is on show
  useEffect(() => {
    if (savedAt && autoPreview && shown === 'preview' && !previewing && !building) void preview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt]);

  // ---- a refused save: the author's version is kept (FE-007), and can be compared with theirs (PRD-004)
  const [confirmReload, setConfirmReload] = useState(false);
  const [merge, setMerge] = useState<{ mine: string; theirs: string; theirsHash: string; base: string } | null>(null);
  const downloadMine = () => { const ed = editorRef.current; if (ed) downloadText(`${summary.project.name || 'document'} (my version).xml`, ed.getXml()); };
  const overwrite = async () => {
    try { const d = await adapter.read(id); hashRef.current = d.hash; setStale(false); if (await save()) toast('Saved: your version replaced the other one.', 'success'); }
    catch (e) { toast(errText(e), 'error'); }
  };
  const compare = async () => {
    const ed = editorRef.current; if (!ed) return;
    // the server keeps the text as it was written (a stencil, an import, another tool): compare the editor's writing of each version
    const norm = (x: string) => { try { return adapter.normalize ? adapter.normalize(x) : x; } catch { return x; } };
    try { const d = await adapter.read(id); setMerge({ mine: ed.getXml(), theirs: norm(d.xml), theirsHash: d.hash, base: norm(baseRef.current) }); }
    catch (e) { toast(errText(e), 'error'); }
  };
  const checkMerged = async (xml: string): Promise<ConflictCheck> => {
    try { adapter.parse(xml); } catch (e) { return { errors: 1, messages: [errText(e)] }; }
    const r = await adapter.validate(id, xml);
    return { errors: r.errors, messages: r.findings.filter((f) => f.severity === 'error').map((f) => f.message) };
  };
  const saveMerged = async (xml: string): Promise<boolean> => {
    if (!merge) return false;
    try {
      await adapter.save(id, xml, merge.theirsHash);
      editorRef.current?.markSaved();                     // the merged text is on the server: the leave guard must not ask while the editor reloads
      void draft.clear(); setSavedAt(new Date()); setStale(false); setFailed(false);
      if (adapter.reloadProject) ctx.reload();
      toast('Saved: the merged document replaced both versions.', 'success');
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast('Someone saved again while you were merging. Compare again to include their newest change.', 'error');
      else toast(errText(e), 'error');
      return false;
    }
  };

  // ---- ?goto=<module key> from the Publication and Explore pages (GAP-004: a key that matches nothing says so)
  const [params] = useSearchParams(); const goto = params.get('goto');
  // (the page builds its editor in an effect of the same render; the jump waits a moment for the sheet to be drawn)
  useEffect(() => {
    if (!loaded || !goto) return;
    const t = setTimeout(() => {
      const ed = editorRef.current; if (!ed?.goToModule) return;
      setGotoMissing(ed.goToModule(goto) ? '' : goto);
    }, 150);
    return () => clearTimeout(t);
  }, [loaded, goto]);

  const kind = adapter.kind;
  /** The alerts above the editor, the same in both pages. `recover` puts the found draft back (each editor does it its own way). */
  const banners = (recover: () => void): ReactNode => <>
    {!writable ? <Alert tone="warn">You have {role} access to this project: you can read the document, but changes cannot be saved.</Alert> : null}
    {stale ? <Alert tone="warn"><span {...DOC_IDS[kind].conflict}>Someone else saved this document after you opened it, so your save was refused. Your changes are still here.</span>{' '}
      <button className="btn btn-sm btn-primary" onClick={() => void compare()} data-testid="conflict-compare" title="See your version and theirs side by side, keep what you want from each, and save the checked result"><Icon name="compare" size={12} />Compare and merge…</button>{' '}
      <button className="btn btn-sm" onClick={downloadMine} data-testid="conflict-download">Download my version</button>{' '}
      {role === 'manager' || role === 'owner' ? <><button className="btn btn-sm" onClick={() => void overwrite()} data-testid="conflict-overwrite">Save mine over theirs</button>{' '}</> : null}
      <button className="btn btn-sm" onClick={() => { if (!dirty) void load(); else setConfirmReload(true); }} data-testid="conflict-reload">Open their version</button></Alert> : null}
    {confirmReload ? <ConfirmModal title="Open the other version?" danger confirmLabel="Discard my changes" body={<p>Your unsaved changes will be discarded. Download your version first if you want to keep a copy.</p>} onClose={() => setConfirmReload(false)} onConfirm={() => { setConfirmReload(false); void draft.clear(); void load(); }} /> : null}
    {merge ? <ConflictDialog base={merge.base} mine={merge.mine} theirs={merge.theirs} check={checkMerged} save={saveMerged} onClose={() => setMerge(null)} /> : null}
    {draft.found && !stale ? <Alert tone="warn"><span data-testid="draft-found">Unsaved changes from {new Date(draft.found.savedAt).toLocaleString()} were kept on this computer.</span>{' '}
      <button className="btn btn-sm btn-primary" onClick={recover} data-testid="draft-recover">Recover them</button>{' '}
      <button className="btn btn-sm" onClick={() => void draft.clear()} data-testid="draft-discard">Discard them</button></Alert> : null}
    {gotoMissing ? <Alert tone="warn"><span data-testid="goto-missing">That section is no longer in the document (it may have been renamed, moved or deleted), so the editor opened at the top.</span>{' '}
      <button className="btn btn-sm" onClick={() => setGotoMissing('')}>Dismiss</button></Alert> : null}
    {error ? <Alert tone="bad">{error}</Alert> : null}
    {!loaded && !error ? <Loading label="Opening the document…" /> : null}
  </>;

  return {
    id, writable, editorRef, hashRef, loaded, setLoaded, error, setError, dirty, setDirty, saving, failed, checking, building, savedAt, stale,
    src, setSrc, note, progress, draft, load, save, check, generate, applyFindings, findings, guard, banners,
    preview, previewing, autoPreview, setAutoPreview, shown,
    liveRef, live, setLive,
    saveState: { saving, dirty, savedAt, failed, ...(live ? { live } : {}) },
  };
}

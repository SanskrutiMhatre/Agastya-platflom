// The editor page: project navigation + data-module list + quick preview on the
// left, the Studio editor and the generated PDF in the middle. Nothing about
// release, watermark or publication settings appears here - those are the
// project dashboard's job - which is what keeps this surface to authoring.
//
// WP-21: the page is the S1000D adapter of the editor host (src/editors/host): the same header, save-state words, layout switch, palette and
// shortcut keys (the Studio's own, reached from the header too), focus mode and conflict comparison as the JSS and JSG pages. A new session
// starts in Write (no PDF pane, the ribbon folded to its tabs): Quick preview and Generate then sit in the header and open the PDF pane.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import '../../styles/pages/editor-host.css';   // WP-35 second pass: the editor page's columns, panel and import dialog styles
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Alert, errText } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { studio, useStudio, type StudioConflict } from '../../lib/studioSession';
import { useUi } from '../../store/ui';
import { ConflictDialog } from '../../editors/host/ConflictDialog';
import { EditorHeader, SaveStateChip } from '../../editors/host/EditorHeader';
import { useEditorLayout } from '../../editors/host/useEditorLayout';
import { useHostKeys } from '../../editors/host/useHostKeys';
import { ViewSwitch, type PanelId } from '../../editors/host/ChromeControls';
import type { EditorView } from '../../editors/host/useEditorLayout';
import { S1000D_STATE } from '../../editors/host/testIds';
import { EditorSide } from './editor/EditorSide';
import { PdfPane } from './editor/PdfPane';
import { rememberDoc } from '../../lib/continueDoc';
import { confirmDialog } from '../../lib/dialogs';
import { CommentsButton, CommentsPanel, useEditorComments } from '../../editors/host/EditorComments';
import { TeamChip } from '../../editors/host/TeamChip';
import { StatusBar } from '../../editors/host/Workspace';
import { useSession } from '../../store/session';

export function EditorPage() {
  const ctx = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [params, setParams] = useSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const layout = useEditorLayout({ format: 'editor', split: [25, 80, 56], onResize: () => studio.relayout() });
  const { view, setView, pct, dragging, startDrag, dividerKey, splitRef, narrow, focus, setFocus, toggleFocus } = layout;
  const [savedTick, setSavedTick] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [sideKey, setSideKey] = useState(0);
  const [treeKey, setTreeKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('agastya.editor.side') !== '0');
  const [bothPopped, setBothPopped] = useState(false);
  const [listW, setListW] = useState(() => Math.min(480, Math.max(180, Number(localStorage.getItem('agastya.editor.listw')) || 248)));
  const [listDrag, setListDrag] = useState(false);
  const [conflict, setConflict] = useState<(StudioConflict & { theirs: string; hash: string }) | null>(null);
  // the header slot that holds Quick preview and Generate while the PDF pane is closed
  const [slot, setSlot] = useState<HTMLSpanElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const [viewSlot, setViewSlot] = useState<HTMLElement | null>(null);
  const reload = ctx.reload;
  // With both previews in their own windows the editor takes the whole width.
  // On a narrow window two panes side by side are unusable: show one at a time.
  const shown = focus ? 'edit' : (bothPopped || narrow) && view === 'split' ? 'edit' : view;
  const side = sideOpen && !focus;
  const docs = useStudio((s) => s.docs);
  const dirtyCount = docs.filter((d) => d.dirty).length;
  const activeDoc = docs.find((d) => d.active);
  // WP-22 (UX-007): the Project Home's Continue card opens the data module the author last had in front of them
  useEffect(() => { if (activeDoc?.file && /^DMC-.*\.xml$/i.test(activeDoc.file)) rememberDoc(ctx.id, activeDoc.file, activeDoc.title || activeDoc.file); }, [ctx.id, activeDoc?.file, activeDoc?.title]);
  const [saving, setSaving] = useState(false);
  const saveNow = async () => { setSaving(true); try { await studio.saveActive(); } catch (e) { toast(errText(e), 'error'); } finally { setSaving(false); } };
  const setSide = (open: boolean) => { setSideOpen(open); localStorage.setItem('agastya.editor.side', open ? '1' : '0'); studio.relayout(); };

  useEffect(() => { studio.relayout(); }, [bothPopped, side]);
  // Alongside the PDF the editor gets all the room it can: its own side panes open only when it has the page to itself.
  useEffect(() => { if (ready) studio.relayout(); }, [shown, ready]);

  // the platform's focus mode is the Studio's too (Ctrl+. inside the Studio, the header button, the palette)
  const focusRef = useRef(focus); focusRef.current = focus;
  useEffect(() => {
    studio.focus = { toggle: toggleFocus, isOn: () => focusRef.current };
    return () => { studio.focus = null; };
  }, [toggleFocus]);
  // WP-22 (UX-009): the review comments in the editor (the open data module's first); stepping to one in another module opens it
  const comments = useEditorComments(ctx.id, ctx.can, activeDoc?.file, (c) => { if (c.dmFile) studio.openDm(c.dmFile).catch((e) => toast(errText(e), 'error')); });
  // UI redesign, second pass: the three panel toggles of the top bar (the data module explorer is the page's; the Properties and Problems panes
  // are the Studio's own, opened and closed through it so its remembered layout stays the one record)
  const panes = useStudio((s) => s.panes);
  const togglePanel = (p: PanelId) => {
    if (focus) setFocus(false);
    if (p === 'explorer') setSide(!sideOpen);
    else studio.setPane(p === 'props' ? 'right' : 'bottom', !(p === 'props' ? panes.right : panes.bottom));
  };
  const pickView = (v: EditorView) => { if (focus) setFocus(false); setView(v === 'split' && narrow ? 'pdf' : v); };
  const pageRef = useRef({ togglePanel, pickView }); pageRef.current = { togglePanel, pickView };
  useEffect(() => {
    // the palette and the shortcuts dialog of the Studio list these too (the Studio's own pane commands give way to the page's)
    studio.pageCommands = () => [
      { id: 'explorer', label: 'Show or hide the data module explorer', group: 'View', keys: ['Mod+Shift+B'], run: () => pageRef.current.togglePanel('explorer') },
      { id: 'props', label: 'Show or hide the Properties panel', group: 'View', keys: ['Mod+Alt+Shift+B'], replaces: 'view.props', run: () => pageRef.current.togglePanel('props') },
      { id: 'problems', label: 'Show or hide the Problems panel', group: 'View', keys: ['Mod+J'], replaces: 'view.problems', run: () => pageRef.current.togglePanel('problems') },
      { id: 'view-edit', label: 'Editor only', group: 'View', keys: ['Mod+Shift+1'], run: () => pageRef.current.pickView('edit') },
      { id: 'view-split', label: 'Editor and PDF side by side (Split)', group: 'View', keys: ['Mod+Shift+2'], run: () => pageRef.current.pickView('split') },
      { id: 'view-pdf', label: 'PDF only', group: 'View', keys: ['Mod+Shift+3'], run: () => pageRef.current.pickView('pdf') },
    ];
    return () => { studio.pageCommands = null; };
  }, []);
  useHostKeys({
    palette: () => studio.run('tools.palette'),
    shortcuts: () => studio.run('tools.shortcuts'),
    focus: toggleFocus,
    find: (replace) => studio.run(replace ? 'edit.replace' : 'edit.find'),
    comment: comments.comments.length ? comments.step : undefined,
    escape: () => { if (comments.shown) { comments.setShown(false); return true; } if (focus) { setFocus(false); return true; } return false; },
    panel: togglePanel,
    view: pickView,
  });

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

  useEffect(() => {
    studio.notify = (m, kind) => toast(m, kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'info');
    // WP-18 (FE-029): after a save the list and the project summary are asked for again; the publication tree only when a new module was created
    studio.onSaved = (created) => { setSavedTick((t) => t + 1); setSavedAt(new Date()); setSideKey((k) => k + 1); if (created) setTreeKey((k) => k + 1); reload(); };
    // WP-21 (PRD-004): a refused save the author wants to compare
    studio.onConflict = (c) => { void studio.serverVersion(c.file).then((t) => setConflict({ ...c, theirs: t.xml, hash: t.hash }), (e) => toast(errText(e), 'error')); };
    let alive = true;
    (async () => {
      try {
        // Another project's documents are still open: do not silently throw away unsaved work.
        if (studio.currentProject && studio.currentProject !== ctx.id && studio.hasUnsaved()) {
          const discard = await confirmDialog({ title: 'Discard unsaved changes?', message: 'You have unsaved changes in another project’s editor. Discard them and open this project?', confirmLabel: 'Discard and open', danger: true });
          if (!alive) return;
          if (!discard) { nav(`/projects/${studio.currentProject}/editor`, { replace: true }); return; }
        }
        await studio.setProject(ctx.id);
        if (!alive || !hostRef.current) return;
        await studio.mount(hostRef.current);
        // UI redesign: the save state sits at the start of the Studio's status bar (a slot the page owns; the Studio's own items are untouched)
        const bar = hostRef.current.querySelector<HTMLElement>('.status-bar');
        if (bar) { let slot = bar.querySelector<HTMLElement>(':scope > .ed-status-slot'); if (!slot) { slot = document.createElement('span'); slot.className = 'ed-status-slot'; bar.prepend(slot); } setStatusSlot(slot); }
        // the Editor | Split | PDF switch: at the right end of the Studio's document tab row (a slot the page owns, after the Studio's tabs)
        const tabRow = hostRef.current.querySelector<HTMLElement>('.app-header');
        if (tabRow) { let vs = tabRow.querySelector<HTMLElement>(':scope > .ed-view-slot'); if (!vs) { vs = document.createElement('span'); vs.className = 'ed-view-slot'; tabRow.append(vs); } setViewSlot(vs); }
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
    return () => { alive = false; studio.onConflict = null; studio.unmount(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.id]);

  const openAt = useCallback((file: string, line?: number) => { studio.openDm(file, line).catch((e) => toast(errText(e), 'error')); }, [toast]);
  const writable = canWrite(ctx.can);
  // WP-28 (PRD-003): who else is here, and the open data module's check-out
  const me = useSession((s) => s.user);
  const dmFile = activeDoc?.file && /^DMC-.*\.xml$/i.test(activeDoc.file) ? activeDoc.file : null;
  const teamDoc = dmFile ? { kind: 'dm' as const, path: dmFile, title: activeDoc?.title || undefined, leases: `/api/projects/${ctx.id}/dms/${encodeURIComponent(dmFile)}/checkout`, checkout: `/api/projects/${ctx.id}/dms/${encodeURIComponent(dmFile)}/checkout` } : null;
  const canBreak = ctx.role === 'owner' || ctx.role === 'manager' || me?.role === 'admin';

  const chip = ready && writable ? <SaveStateChip state={{ saving, dirty: dirtyCount > 0, savedAt, dirtyCount }} ids={S1000D_STATE} /> : null;
  // UI redesign (mockup editor.html): the Studio's status bar is the window's status bar, under the activity bar and the workspace: it is moved
  // into the page's status bar (a shell slot) while the page is shown, and back into the Studio when the page goes (the Studio outlives it)
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const root = hostRef.current?.querySelector<HTMLElement>(':scope > .app');
    const bar = root?.querySelector<HTMLElement>(':scope > .status-bar');
    if (!ready || !statusHost || !root || !bar) return;
    statusHost.appendChild(bar);
    return () => { root.insertBefore(bar, root.querySelector(':scope > .toasts')); };
  }, [ready, statusHost]);
  // the review comments: the Properties panel's Comments tab (its badge is the number still open)
  useEffect(() => { if (ready) studio.setCommentCount(comments.open.length); }, [ready, comments.open.length]);
  const chipInStatus = !!statusSlot;
  // the top bar's crumbs: the project, the module's system and sub-system ("29-10"), the data module code, its state
  const m = activeDoc?.file?.match(/^(DMC-[^_]+?)(?:_(\d{3})-(\d{2}))?(?:_[A-Z]{2}-[A-Z]{2})?\.xml$/i);
  const sns = activeDoc?.file?.match(/^DMC-[^-]+-[^-]+-([^-]+)-([^-]+)-/i);
  const draft = m?.[3] && m[3] !== '00';
  return (
    <>
      <EditorHeader layout={layout} title={ctx.summary.project.name} homeHref={ctx.summary.project.type === 'CIR' ? undefined : `/projects/${ctx.id}/home`}
        panels={{ explorer: { on: sideOpen, set: setSide }, problems: { on: panes.bottom, set: (on) => studio.setPane('bottom', on) }, props: { on: panes.right, set: (on) => studio.setPane('right', on) } }}
        section={sns ? `${sns[1]}-${sns[2]}` : undefined}
        doc={activeDoc ? <span title={activeDoc.file ?? activeDoc.title}>{m ? m[1] : activeDoc.title || activeDoc.file}</span> : undefined}
        badge={activeDoc?.file && m ? <span className={`badge ${draft ? 'warning' : 'success'} ed-crumb-badge`} title={`Issue ${m[2] ?? ''}-${m[3] ?? ''}`}>{draft ? 'Draft' : `Issue ${m[2]}`}</span> : null}
        state={chipInStatus ? null : chip}
        actions={<>
          <button type="button" className="btn ed-validate" onClick={() => studio.run('review.validate')} disabled={!ready || !activeDoc} title="Validate the open data module against its schema and the business rules (F7)" aria-keyshortcuts="F7" data-testid="chrome-validate">
            <Icon name="shield" size={16} className="ico" />Validate<kbd>F7</kbd></button>
          {ready && writable && dirtyCount > 1
            ? <button className="btn" onClick={() => void saveNow()} disabled={saving || !activeDoc} title="Save the open data module (Ctrl+S)" data-testid="save-now"><Icon name="save" size={16} className="ico" />{saving ? 'Saving…' : `Save (${dirtyCount} unsaved)`}</button>
            : null}
          <span className="ed-actions" ref={setSlot} data-testid="chrome-preview-slot" />
        </>}
        extra={<><TeamChip projectId={ctx.id} doc={teamDoc} writable={ready && writable} canBreak={canBreak} editing={!!activeDoc?.dirty} /><CommentsButton state={comments} /></>}
        onPalette={() => studio.run('tools.palette')} onShortcuts={() => studio.run('tools.shortcuts')} />
      <CommentsPanel projectId={ctx.id} state={comments} activeFile={activeDoc?.file} onOpen={(c) => { if (c.dmFile) openAt(c.dmFile); }} />
      {ready && studio.commentsEl ? createPortal(<CommentsPanel inline projectId={ctx.id} state={comments} activeFile={activeDoc?.file} onOpen={(c) => { if (c.dmFile) openAt(c.dmFile); }} />, studio.commentsEl) : null}
      {!writable ? <Alert tone="warn">You have {ctx.role} access to this project: you can read and proof data modules, but changes cannot be saved.</Alert> : null}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <div className={`v2-split ed ed-s1000d${focus ? ' is-focus' : ''}${shown !== 'edit' ? ' is-split' : ''}`} data-density="compact" data-testid="editor-split" ref={splitRef} style={dragging || listDrag ? { userSelect: 'none' } : undefined}>
        {side ? <EditorSide ctx={ctx} refreshKey={sideKey} treeKey={treeKey} width={listW} onCollapse={() => setSide(false)} /> : null}
        {side ? <div className={`panel-resize rz1 ${listDrag ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize data module list" tabIndex={0} aria-valuenow={listW} aria-valuemin={180} aria-valuemax={480}
          onPointerDown={startListDrag} onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const w = Math.min(480, Math.max(180, listW + (e.key === 'ArrowRight' ? 16 : -16))); setListW(w); localStorage.setItem('agastya.editor.listw', String(w)); studio.relayout(); } }} /> : null}
        <div className="a" style={{ display: shown === 'pdf' ? 'none' : 'flex', flex: shown === 'edit' ? '1 1 0' : `0 0 calc((100% - ${side ? listW + 1 : 0}px) * ${pct / 100})` }}>
          <div ref={hostRef} className="v2-studio-host" data-testid="studio-host" />
        </div>
        {shown === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" aria-valuenow={Math.round(pct)} aria-valuemin={layout.splitRange[0]} aria-valuemax={layout.splitRange[1]} tabIndex={0} onPointerDown={startDrag} onKeyDown={dividerKey} /> : null}
        <div className="b" style={{ flex: '1 1 0', borderLeft: shown === 'pdf' ? 0 : undefined, display: shown === 'edit' ? 'none' : undefined }}>
          <PdfPane ctx={ctx} savedTick={savedTick} onOpenAt={openAt} onPopped={setBothPopped} slot={focus ? null : slot} onReveal={layout.reveal}
            viewSwitch={shown === 'pdf' && !focus ? <ViewSwitch layout={layout} canSplit={!bothPopped} /> : null} />
        </div>
      </div>
      <StatusBar testId="s1000d-statusbar"><span className="ed-studio-status" ref={setStatusHost} /></StatusBar>
      {chipInStatus && chip ? createPortal(<span className="item">{chip}</span>, statusSlot!) : null}
      {/* PDF only hides the Studio (and its tab row): the switch then heads the PDF pane, at the same right-hand end */}
      {viewSlot && !focus && shown !== 'pdf' ? createPortal(<ViewSwitch layout={layout} canSplit={!bothPopped} />, viewSlot) : null}
      {conflict ? <ConflictDialog base={conflict.base} mine={conflict.mine} theirs={conflict.theirs} onClose={() => setConflict(null)}
        check={(xml) => studio.checkText(xml, conflict.file)}
        save={async (xml) => { const ok = await studio.saveMerged(conflict.file, xml, conflict.hash); if (ok) toast('Saved: the merged data module replaced both versions.', 'success'); return ok; }} /> : null}
    </>
  );
}

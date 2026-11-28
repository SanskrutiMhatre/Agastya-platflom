// WP-21 (06 section 7.1): the workspace shell of the JSS and JSG editor pages: the one header, the alerts, the editor beside the PDF, and the
// host's palette, shortcuts dialog, find bar (JSS) and focus mode. The page passes its editor's element, its own header actions and the PDF pane.
//
// UI redesign (owner-approved mockup docs/audit/mockups/editor.html, 2026-11-28): the editor sits in the mockup's workspace grid: the explorer
// (the editor's own document outline, moved beside the sheet), the open-document tab (with the page's document commands), the canvas (its
// toolbar, its sheet; the JSS Problems drawer under it), the Problems panel (JSG), the Properties panel (the block at the cursor, the document's
// metadata, the review comments) and the window-wide status bar. Nothing of the canvas's editing changes (D16): its nodes are moved, not rebuilt.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import { useUi } from '../../store/ui';
import { CommandPalette, toolbarCommands, type PaletteCommand } from './CommandPalette';
import { EditorHeader, SaveStateChip } from './EditorHeader';
import { FindBar } from './FindBar';
import { ShortcutsDialog } from './ShortcutsDialog';
import type { SaveStateInput } from './saveState';
import type { EditorLayout } from './useEditorLayout';
import { useHostKeys } from './useHostKeys';
import { DOC_IDS } from './testIds';
import { CommentsButton, CommentsPanel, useEditorComments } from './EditorComments';
import type { Can } from '../../lib/roles';
import { TeamChip } from './TeamChip';
import { useSession } from '../../store/session';
import { DocTabs, ProblemsPanel, PropRow, PropsPanel, StatusBar, problemCounts, usePaneWidth, useRemembered, type ProblemItem, type PropsTab } from './Workspace';
import '../../styles/pages/editor-host.css';   // WP-35 second pass: the split, divider and PDF placeholder styles

export interface DocEditorShellProps {
  kind: 'jss' | 'jsg';
  /** which keys the shortcuts dialog lists (a JSG parts list has its own editor) */
  shortcuts: 'jss' | 'jsg' | 'jsg-ispl';
  layout: EditorLayout;
  title: string;
  /** after the document's name in the top bar: its type badge */
  crumb?: ReactNode;
  /** the second crumb (the document type: "JSS Land", "JSG") */
  section?: ReactNode;
  saveState: SaveStateInput;
  /** the document commands (Save, packages, conversion, export): on the document tab row */
  actions: ReactNode;
  /** the top bar's commands (Check, Generate PDF): the mockup's Validate and Build PDF */
  topActions?: ReactNode;
  /** the leave guard, the alerts (conflict, draft, read-only, errors) */
  guard: ReactNode;
  banners: ReactNode;
  loaded: boolean;
  hostRef: RefObject<HTMLDivElement>;
  pdf: ReactNode;
  /** the host's find bar (the JSS editor has none of its own) */
  find: boolean;
  readOnly: boolean;
  /** WP-22 (UX-009): the project, for its review comments in the header */
  projectId: string;
  can: Can;
  /** WP-28: the person's project role (a project owner or manager may break another author's check-out) */
  role?: string;
  /** UI redesign: the document tab's name, the findings of the last check, the document's properties */
  docName?: string;
  findings?: ProblemItem[];
  meta?: Array<[string, ReactNode]>;
}

const VIEW_WORDS = { edit: 'Editor', split: 'Split', pdf: 'PDF' } as const;
/** the editors' outline (moved into the explorer) and their outline rows (the explorer's filter hides the rows that do not match) */
const OUTLINE = '.jss-outline, .jsg-nav';
const ROWS = '.jss-ol, a';

export function DocEditorShell({ kind, shortcuts, layout, title, crumb, section, saveState, actions, topActions, guard, banners, loaded, hostRef, pdf, find, readOnly, projectId, can, role, docName, findings = [], meta = [] }: DocEditorShellProps) {
  const comments = useEditorComments(projectId, can);
  // WP-28 (PRD-003): the people in the project and the document's check-out (the whole document; chapter / section check-outs are listed)
  const me = useSession((s) => s.user);
  const teamDoc = { kind, path: `${kind}-document`, title: kind === 'jss' ? 'the JSS document' : 'the JSG document', leases: `/api/projects/${projectId}/${kind}/checkouts`, checkout: `/api/projects/${projectId}/${kind}/checkout` };
  const toast = useUi((s) => s.toast);
  const [palette, setPalette] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [finding, setFinding] = useState<{ replace: boolean; n: number } | null>(null);
  const actionsRef = useRef<HTMLSpanElement>(null);
  const topRef = useRef<HTMLSpanElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const { view, setView, narrow, focus, setFocus, toggleFocus, pct, dragging, startDrag, dividerKey, splitRef } = layout;
  const shown = focus ? 'edit' : narrow && view === 'split' ? 'edit' : view;
  // the mockup's first view: the explorer, the Properties panel and the Problems panel open (the author's choice is remembered from then on)
  const [treeOn, setTreeOn] = useRemembered(`agastya.${kind}.explorer`, () => true);
  const [propsOn, setPropsOn] = useRemembered(`agastya.${kind}.props.v2`, () => true);
  const [problemsOn, setProblemsOn] = useRemembered(`agastya.${kind}.problems`, () => true);
  const [propsTab, setPropsTab] = useState('element');
  const [filter, setFilter] = useState('');
  const [sections, setSections] = useState(0);
  const [here, setHere] = useState<{ section: string; block: string; text: string }>({ section: '', block: '', text: '' });
  const tree = usePaneWidth(`agastya.${kind}.treew`, 248, 180, 420, 'left');
  const pane = usePaneWidth(`agastya.${kind}.propsw`, 288, 220, 480, 'right');
  const counts = problemCounts(findings);
  const showTree = treeOn && !focus && !narrow;
  const showProps = propsOn && !focus && !narrow;
  const showProblems = problemsOn && kind === 'jsg' && !focus;

  // the editor's outline is the explorer's tree: whenever the editor (re)draws it, it is moved into the explorer (a JSG document type switch
  // builds a new editor, so the observer keeps watching); the JSS Problems drawer opens on the first view, as the mockup's panel is open
  useEffect(() => {
    const host = hostRef.current; const into = outlineRef.current;
    if (!loaded || !host || !into) return;
    let openedOnce = false;
    const adopt = () => {
      const nav = host.querySelector<HTMLElement>(OUTLINE);
      if (nav) { into.replaceChildren(nav); }
      if (!openedOnce && kind === 'jss') { const d = host.querySelector<HTMLDetailsElement>('details.jss-problems'); if (d) { openedOnce = true; if (problemsOn) d.open = true; } }
      const rows = into.querySelectorAll(kind === 'jss' ? '.jss-ol' : 'a');
      setSections(rows.length);
    };
    adopt();
    const mo = new MutationObserver(adopt);
    mo.observe(host, { childList: true, subtree: true });
    const rowsMo = new MutationObserver(() => setSections(into.querySelectorAll(kind === 'jss' ? '.jss-ol' : 'a').length));
    rowsMo.observe(into, { childList: true, subtree: true });
    return () => { mo.disconnect(); rowsMo.disconnect(); };
    // the Problems choice is read once, on the first view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, kind, hostRef]);

  // the explorer's filter: rows whose text does not contain the words are hidden (the editor's outline is not rebuilt)
  useEffect(() => {
    const into = outlineRef.current; if (!into) return;
    const q = filter.trim().toLowerCase();
    into.querySelectorAll<HTMLElement>(ROWS).forEach((r) => { r.hidden = !!q && !(r.textContent ?? '').toLowerCase().includes(q); });
  }, [filter, sections]);

  // the Properties panel's Element tab: the block at the cursor and the section it is in (read from the page, never changed)
  useEffect(() => {
    if (!loaded) return;
    const read = () => {
      const host = hostRef.current; const sel = document.getSelection();
      const node = sel?.anchorNode ?? null;
      const el = node ? (node.nodeType === 1 ? node as Element : node.parentElement) : null;
      if (!host || !el || !host.contains(el)) return;
      let block = '';
      for (let e: Element | null = el; e && e !== host; e = e.parentElement) {
        const c = [...e.classList].find((k) => /^(jss|jsg)-(?!root|ed\b|main|scroll|sheet|paper)/.test(k));
        if (c && (e as HTMLElement).isContentEditable !== undefined && e.getAttribute('contenteditable') !== null) { block = c.replace(/^(jss|jsg)-/, ''); break; }
        if (c && !block) block = c.replace(/^(jss|jsg)-/, '');
      }
      const cur = outlineRef.current?.querySelector('.jss-ol.cur, a.cur, a.on, a.active');
      const text = (el.closest('[contenteditable]')?.textContent ?? '').trim().replace(/\s+/g, ' ');
      setHere({ section: (cur?.textContent ?? '').trim(), block, text: text.length > 80 ? `${text.slice(0, 80)}…` : text });
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [loaded, hostRef]);

  /** the status bar's problem counts: the JSS editor has its own Problems drawer, the JSG editor's findings open the workspace's panel */
  const toggleProblems = () => {
    if (kind === 'jss') { const d = hostRef.current?.querySelector<HTMLDetailsElement>('details.jss-problems'); if (d) { d.open = !d.open; setProblemsOn(d.open); if (d.open) d.querySelector<HTMLElement>('summary')?.focus(); } }
    else setProblemsOn(!problemsOn);
  };

  const openFind = (replace: boolean) => { if (shown === 'pdf') setView('edit'); setFinding((f) => ({ replace: replace && !readOnly, n: (f?.n ?? 0) + 1 })); };
  useHostKeys({
    palette: () => setPalette(true),
    shortcuts: () => setKeysOpen(true),
    focus: toggleFocus,
    find: find ? openFind : undefined,
    comment: comments.comments.length ? comments.step : undefined,
    escape: () => { if (finding) { setFinding(null); return true; } if (comments.shown) { comments.setShown(false); return true; } if (focus) { setFocus(false); return true; } return false; },
  });

  const commands = useMemo<PaletteCommand[]>(() => {
    if (!palette) return [];
    const buttons = [...(topRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []), ...(actionsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const header: PaletteCommand[] = buttons.map((b, i) => ({
      id: `page.${b.dataset.testid ?? i}`, label: (b.textContent || b.getAttribute('aria-label') || b.title || '').replace(/…$/, '').trim(), group: 'Document',
      keys: /Ctrl\+S/.test(b.title) ? 'Ctrl+S' : undefined, disabled: b.disabled, run: () => b.click(),
    })).filter((c) => c.label);
    const host: PaletteCommand[] = [
      ...(find ? [{ id: 'host.find', label: 'Find', group: 'Edit', keys: 'Ctrl+F', run: () => openFind(false) }, ...(readOnly ? [] : [{ id: 'host.replace', label: 'Find and replace', group: 'Edit', keys: 'Ctrl+H', run: () => openFind(true) }])] : []),
      { id: 'host.edit', label: 'Show the editor only', group: 'View', run: () => setView('edit') },
      ...(narrow ? [] : [{ id: 'host.split', label: 'Show the editor and the PDF side by side', group: 'View', run: () => setView('split') }]),
      { id: 'host.pdf', label: 'Show the PDF only', group: 'View', run: () => setView('pdf') },
      { id: 'host.focus', label: focus ? 'Leave focus mode' : 'Focus mode', group: 'View', keys: 'Ctrl+.', run: toggleFocus },
      { id: 'host.explorer', label: treeOn ? 'Hide the explorer' : 'Show the explorer', group: 'View', run: () => setTreeOn(!treeOn) },
      { id: 'host.props', label: propsOn ? 'Hide the Properties panel' : 'Show the Properties panel', group: 'View', run: () => setPropsOn(!propsOn) },
      { id: 'host.problems', label: 'Show or hide the Problems panel', group: 'View', run: toggleProblems },
      { id: 'host.shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: 'F1', run: () => setKeysOpen(true) },
    ];
    return [...header, ...host, ...toolbarCommands(hostRef.current, kind === 'jss' ? 'JSS editor' : 'JSG editor')];
    // the list is taken when the palette opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  const state = <SaveStateChip state={saveState} ids={DOC_IDS[kind].state} />;
  const docType = kind === 'jss' ? 'JSS' : 'JSG';
  const tabs: PropsTab[] = [{ id: 'element', label: 'Element' }, { id: 'document', label: 'Document' }, { id: 'comments', label: 'Comments', badge: comments.open.length || undefined }];
  return (
    <>
      {guard}
      <EditorHeader layout={layout} title={title} homeHref={`/projects/${projectId}/home`} section={section} doc={docName ? <span>{docName}</span> : undefined} badge={crumb} state={focus ? state : null}
        actions={<span className="v2-edactions" ref={topRef}>{topActions}</span>}
        extra={<><TeamChip projectId={projectId} doc={loaded ? teamDoc : null} writable={!readOnly} canBreak={role === 'owner' || role === 'manager' || me?.role === 'admin'} editing={saveState.dirty} /><CommentsButton state={comments} /></>}
        onPalette={() => setPalette(true)} onShortcuts={() => setKeysOpen(true)} />
      <CommentsPanel projectId={projectId} state={comments} />
      {banners}
      <div className={`ed ed-doc ed-${kind}${showTree ? ' has-tree' : ''}${showProps ? ' has-props' : ''}${showProblems ? ' has-problems' : ''}${focus ? ' is-focus' : ''}`} data-density="compact"
        style={{ display: loaded ? undefined : 'none', '--tree-w': `${tree.width}px`, '--props-w': `${pane.width}px` } as CSSProperties}>
        {/* the explorer: the editor's own document outline, moved here (its rows, their clicks and marks are the editor's) */}
        <aside className="pane tree-pane ed-explorer" aria-label="Explorer" hidden={!showTree} data-testid="doc-explorer">
          <div className="pane-head"><span className="title">Explorer</span><span className="grow" />
            <button className="icon-btn" type="button" onClick={() => setTreeOn(false)} aria-label="Hide the explorer" title="Hide the explorer"><Icon name="panel" size={16} className="ico" /></button>
          </div>
          <div className="search-box"><input className="input search" type="search" placeholder="Filter the outline…" aria-label="Filter the outline" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <div className="tree-scroll ed-outline-host" ref={outlineRef} />
          <div className="tree-foot" aria-live="polite"><span>{sections} section{sections === 1 ? '' : 's'}</span>
            {counts.errors ? <span className="ed-foot-bad">{counts.errors} error{counts.errors === 1 ? '' : 's'}</span> : null}
            {counts.warnings ? <span className="ed-foot-warn">{counts.warnings} warning{counts.warnings === 1 ? '' : 's'}</span> : null}</div>
        </aside>
        {showTree ? <div {...tree.separator('Resize the explorer', 'rz1')} /> : null}
        <section className="pane center" aria-label="Document">
          {focus ? null : <DocTabs tabs={[{ key: kind, title: docName || title, hint: `${title}${docName ? ` · ${docName}` : ''}`, dirty: saveState.dirty, dot: counts.errors ? 'danger' : counts.warnings ? 'warning' : undefined }]}>
            <span className="grow" />
            {/* the page's own document commands (Save, packages, conversion, export) on the tab row's free space, beside the panel toggles */}
            <span className="ed-doc-actions" ref={actionsRef}>{actions}</span>
            {narrow || treeOn ? null : <button className="icon-btn" type="button" onClick={() => setTreeOn(true)} aria-label="Show the explorer" title="Show the explorer"><Icon name="panel" size={14} /></button>}
            {narrow ? null : <button className="icon-btn" type="button" onClick={() => setPropsOn(!propsOn)} aria-pressed={propsOn} aria-label={propsOn ? 'Hide the Properties panel' : 'Show the Properties panel'} title="Properties of the document" data-testid="doc-props-toggle"><Icon name="sliders" size={14} /></button>}
          </DocTabs>}
          {finding && find ? <FindBar key={finding.n} root={() => hostRef.current?.querySelector<HTMLElement>('[data-testid="jss-paper"], .jsg-sheet') ?? hostRef.current} replace={finding.replace} readOnly={readOnly} onClose={() => setFinding(null)} notify={(m) => toast(m, 'info')} /> : null}
          <div className={`v2-split${focus ? ' is-focus' : ''}`} {...DOC_IDS[kind].split} ref={splitRef} style={{ display: loaded ? undefined : 'none', ...(dragging ? { userSelect: 'none' } : {}) }}>
            <div className="a" style={{ display: shown === 'pdf' ? 'none' : 'flex', flex: shown === 'edit' ? '1 1 0' : `0 0 ${pct}%`, minWidth: 0 }}>
              <div ref={hostRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }} {...DOC_IDS[kind].host} />
            </div>
            {shown === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" aria-valuenow={Math.round(pct)} aria-valuemin={layout.splitRange[0]} aria-valuemax={layout.splitRange[1]} tabIndex={0} onPointerDown={startDrag} onKeyDown={dividerKey} /> : null}
            <div className="b" style={{ flex: '1 1 0', display: shown === 'edit' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, borderLeft: shown === 'pdf' ? 0 : undefined }}>{pdf}</div>
          </div>
        </section>
        {showProblems ? <ProblemsPanel items={findings} onClose={() => setProblemsOn(false)} /> : null}
        {showProps ? <>
          <div {...pane.separator('Resize the Properties panel', 'rz2')} />
          <PropsPanel tabs={tabs} tab={propsTab} onTab={setPropsTab}>
            {propsTab === 'element' ? <>
              <div className="el-title"><span className="mono">{here.block || (kind === 'jss' ? 'jss' : 'jsgdoc')}</span><span className="muted">{here.block ? 'The block at the cursor' : 'Click in the document to see the block at the cursor'}</span></div>
              <div><div className="sec-h">Position</div>
                <PropRow name="section">{here.section || '—'}</PropRow>
                <PropRow name="block">{here.block || '—'}</PropRow>
                {here.text ? <PropRow name="text">{here.text}</PropRow> : null}
              </div>
              <div className="alert info"><Icon name="info" size={14} className="ico sm" /><span>The {docType} sheet edits its blocks in place: the toolbar above the page inserts, arranges and formats them.</span></div>
            </> : propsTab === 'document' ? <>
              <div className="el-title"><span className="mono">{kind === 'jss' ? 'jss' : 'jsgdoc'}</span><span className="muted">{docName || title}</span></div>
              <div><div className="sec-h">Document</div>
                <PropRow name="Project">{title}</PropRow>
                {meta.map(([k, v]) => <PropRow key={k} name={k}>{v}</PropRow>)}
                <PropRow name="Access">{readOnly ? 'Read only' : 'Can edit'}</PropRow>
              </div>
              <div><div className="sec-h">Last check</div>
                <PropRow name="Errors">{counts.errors}</PropRow>
                <PropRow name="Warnings">{counts.warnings}</PropRow>
              </div>
            </> : <CommentsPanel inline projectId={projectId} state={comments} />}
          </PropsPanel>
        </> : null}
      </div>
      {loaded ? <StatusBar testId={`${kind}-statusbar`}>
        {focus ? null : <span className="item">{state}</span>}
        <button className="item" type="button" onClick={toggleProblems} title="Show or hide the problems of the last check" data-testid={`${kind}-status-problems`}>
          <Icon name="xcircle" size={12} />{counts.errors} error{counts.errors === 1 ? '' : 's'}</button>
        <button className="item" type="button" onClick={toggleProblems} title="Show or hide the problems of the last check"><Icon name="warn" size={12} />{counts.warnings} warning{counts.warnings === 1 ? '' : 's'}</button>
        <span className="item">{docType} schema</span>
        <span className="grow" />
        {here.section ? <span className="item mono">{here.section}</span> : null}
        {docName ? <span className="item">{docName}</span> : null}
        {readOnly ? <span className="item">Read only</span> : null}
        <span className="item">UTF-8</span>
        <span className="item">{focus ? 'Focus' : VIEW_WORDS[shown]}</span>
      </StatusBar> : null}
      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
      {keysOpen ? <ShortcutsDialog editor={shortcuts} onClose={() => setKeysOpen(false)} /> : null}
    </>
  );
}

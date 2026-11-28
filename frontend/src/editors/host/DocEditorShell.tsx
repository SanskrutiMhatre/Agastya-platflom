// WP-21 (06 section 7.1): the workspace shell of the JSS and JSG editor pages: the one header, the alerts, the editor beside the PDF, and the
// host's palette, shortcuts dialog, find bar (JSS) and focus mode. The page passes its editor's element, its own header actions and the PDF pane.
//
// UI redesign (owner-approved mockup docs/audit/mockups/editor.html, 2026-11-28): the editor sits in the workspace grid: the open-document tab,
// the canvas (its own outline = the explorer, its toolbar, its sheet), the Problems panel, the Properties panel (the document's metadata: the
// canvases do not expose a selected element) and the status bar (save state, problems, document type, layout). Nothing of the canvas changes.

import { useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
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
import { DocTabs, ProblemsPanel, PropRow, PropsPanel, StatusBar, problemCounts, usePaneWidth, useRemembered, type ProblemItem } from './Workspace';
import '../../styles/pages/editor-host.css';   // WP-35 second pass: the split, divider and PDF placeholder styles

export interface DocEditorShellProps {
  kind: 'jss' | 'jsg';
  /** which keys the shortcuts dialog lists (a JSG parts list has its own editor) */
  shortcuts: 'jss' | 'jsg' | 'jsg-ispl';
  layout: EditorLayout;
  title: string;
  crumb?: ReactNode;
  saveState: SaveStateInput;
  actions: ReactNode;
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

export function DocEditorShell({ kind, shortcuts, layout, title, crumb, saveState, actions, guard, banners, loaded, hostRef, pdf, find, readOnly, projectId, can, role, docName, findings = [], meta = [] }: DocEditorShellProps) {
  const comments = useEditorComments(projectId, can);
  // WP-28 (PRD-003): the people in the project and the document's check-out (the whole document; chapter / section check-outs are listed)
  const me = useSession((s) => s.user);
  const teamDoc = { kind, path: `${kind}-document`, title: kind === 'jss' ? 'the JSS document' : 'the JSG document', leases: `/api/projects/${projectId}/${kind}/checkouts`, checkout: `/api/projects/${projectId}/${kind}/checkout` };
  const toast = useUi((s) => s.toast);
  const [palette, setPalette] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [finding, setFinding] = useState<{ replace: boolean; n: number } | null>(null);
  const actionsRef = useRef<HTMLSpanElement>(null);
  const { view, setView, narrow, focus, setFocus, toggleFocus, pct, dragging, startDrag, dividerKey, splitRef } = layout;
  const shown = focus ? 'edit' : narrow && view === 'split' ? 'edit' : view;
  // the Properties panel: open by default only where there is room for it beside the sheet; the JSG Problems panel opens on request
  const [propsOn, setPropsOn] = useRemembered(`agastya.${kind}.props`, () => window.matchMedia('(min-width: 1600px)').matches);
  const [problemsOn, setProblemsOn] = useState(false);
  const pane = usePaneWidth(`agastya.${kind}.propsw`, 288, 220, 480, 'right');
  const counts = problemCounts(findings);
  const showProps = propsOn && !focus && !narrow;

  /** the status bar's problem counts: the JSS editor has its own Problems drawer, the JSG editor's findings open the workspace's panel */
  const toggleProblems = () => {
    if (kind === 'jss') { const d = hostRef.current?.querySelector<HTMLDetailsElement>('details.jss-problems'); if (d) { d.open = !d.open; if (d.open) d.querySelector<HTMLElement>('summary')?.focus(); } }
    else setProblemsOn((o) => !o);
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
    const header: PaletteCommand[] = [...(actionsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b, i) => ({
      id: `page.${b.dataset.testid ?? i}`, label: (b.textContent || b.getAttribute('aria-label') || b.title || '').replace(/…$/, '').trim(), group: 'Document',
      keys: /Ctrl\+S/.test(b.title) ? 'Ctrl+S' : undefined, disabled: b.disabled, run: () => b.click(),
    })).filter((c) => c.label);
    const host: PaletteCommand[] = [
      ...(find ? [{ id: 'host.find', label: 'Find', group: 'Edit', keys: 'Ctrl+F', run: () => openFind(false) }, ...(readOnly ? [] : [{ id: 'host.replace', label: 'Find and replace', group: 'Edit', keys: 'Ctrl+H', run: () => openFind(true) }])] : []),
      { id: 'host.edit', label: 'Show the editor only', group: 'View', run: () => setView('edit') },
      ...(narrow ? [] : [{ id: 'host.split', label: 'Show the editor and the PDF side by side', group: 'View', run: () => setView('split') }]),
      { id: 'host.pdf', label: 'Show the PDF only', group: 'View', run: () => setView('pdf') },
      { id: 'host.focus', label: focus ? 'Leave focus mode' : 'Focus mode', group: 'View', keys: 'Ctrl+.', run: toggleFocus },
      { id: 'host.props', label: propsOn ? 'Hide the Properties panel' : 'Show the Properties panel', group: 'View', run: () => setPropsOn(!propsOn) },
      { id: 'host.problems', label: 'Show or hide the Problems panel', group: 'View', run: toggleProblems },
      { id: 'host.shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: 'F1', run: () => setKeysOpen(true) },
    ];
    return [...header, ...host, ...toolbarCommands(hostRef.current, kind === 'jss' ? 'JSS editor' : 'JSG editor')];
    // the list is taken when the palette opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  const state = <SaveStateChip state={saveState} ids={DOC_IDS[kind].state} />;
  return (
    <>
      {guard}
      <EditorHeader layout={layout} title={title} crumb={crumb} state={focus ? state : null}
        actions={<span className="v2-edactions" ref={actionsRef}>{actions}</span>} extra={<><TeamChip projectId={projectId} doc={loaded ? teamDoc : null} writable={!readOnly} canBreak={role === 'owner' || role === 'manager' || me?.role === 'admin'} editing={saveState.dirty} /><CommentsButton state={comments} /></>} onPalette={() => setPalette(true)} onShortcuts={() => setKeysOpen(true)} />
      <CommentsPanel projectId={projectId} state={comments} />
      {banners}
      <div className={`ed ed-doc ed-${kind}${showProps ? ' has-props' : ''}${problemsOn && kind === 'jsg' && !focus ? ' has-problems' : ''}${focus ? ' is-focus' : ''}`} data-density="compact"
        style={{ display: loaded ? undefined : 'none', '--props-w': `${pane.width}px` } as CSSProperties}>
        <section className="pane center" aria-label="Document">
          {focus ? null : <DocTabs tabs={[{ key: kind, title: docName || title, hint: `${title}${docName ? ` · ${docName}` : ''}`, dirty: saveState.dirty, dot: counts.errors ? 'danger' : counts.warnings ? 'warning' : undefined }]}>
            {narrow ? null : <button className="icon-btn" onClick={() => setPropsOn(!propsOn)} aria-pressed={propsOn} aria-label={propsOn ? 'Hide the Properties panel' : 'Show the Properties panel'} title="Properties of the document" data-testid="doc-props-toggle"><Icon name="sliders" size={14} /></button>}
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
        {problemsOn && kind === 'jsg' && !focus ? <ProblemsPanel items={findings} onClose={() => setProblemsOn(false)} /> : null}
        {showProps ? <>
          <div {...pane.separator('Resize the Properties panel', 'rz2')} />
          <PropsPanel tab="Document" onClose={() => setPropsOn(false)}>
            <div className="el-title"><span className="mono">{kind === 'jss' ? 'jss' : 'jsgdoc'}</span><span className="muted">{docName || title}</span></div>
            <div><div className="sec-h">Document</div><dl className="kv">
              <PropRow name="Project">{title}</PropRow>
              {meta.map(([k, v]) => <PropRow key={k} name={k}>{v}</PropRow>)}
              <PropRow name="Access">{readOnly ? 'Read only' : 'Can edit'}</PropRow>
            </dl></div>
            <div><div className="sec-h">Last check</div><dl className="kv">
              <PropRow name="Errors">{counts.errors}</PropRow>
              <PropRow name="Warnings">{counts.warnings}</PropRow>
            </dl></div>
          </PropsPanel>
        </> : null}
      </div>
      {loaded ? <StatusBar testId={`${kind}-statusbar`}>
        {focus ? null : <span className="item">{state}</span>}
        <button className="item" onClick={toggleProblems} title="Show or hide the problems of the last check" data-testid={`${kind}-status-problems`}>
          <Icon name="alert" size={12} />{counts.errors} error{counts.errors === 1 ? '' : 's'}</button>
        <button className="item" onClick={toggleProblems} title="Show or hide the problems of the last check"><Icon name="warn" size={12} />{counts.warnings} warning{counts.warnings === 1 ? '' : 's'}</button>
        <span className="grow" />
        {docName ? <span className="item">{docName}</span> : null}
        <span className="item">{kind === 'jss' ? 'JSS' : 'JSG'}</span>
        {readOnly ? <span className="item">Read only</span> : null}
        <span className="item">{focus ? 'Focus' : VIEW_WORDS[shown]}</span>
      </StatusBar> : null}
      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
      {keysOpen ? <ShortcutsDialog editor={shortcuts} onClose={() => setKeysOpen(false)} /> : null}
    </>
  );
}

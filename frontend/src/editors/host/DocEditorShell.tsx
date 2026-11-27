// WP-21 (06 section 7.1): the workspace shell of the JSS and JSG editor pages: the one header, the alerts, the editor beside the PDF, and the
// host's palette, shortcuts dialog, find bar (JSS) and focus mode. The page passes its editor's element, its own header actions and the PDF pane.

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
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
}

export function DocEditorShell({ kind, shortcuts, layout, title, crumb, saveState, actions, guard, banners, loaded, hostRef, pdf, find, readOnly, projectId, can, role }: DocEditorShellProps) {
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
      { id: 'host.shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: 'F1', run: () => setKeysOpen(true) },
    ];
    return [...header, ...host, ...toolbarCommands(hostRef.current, kind === 'jss' ? 'JSS editor' : 'JSG editor')];
    // the list is taken when the palette opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  return (
    <>
      {guard}
      <EditorHeader layout={layout} title={title} crumb={crumb} state={<SaveStateChip state={saveState} ids={DOC_IDS[kind].state} />}
        actions={<span className="v2-edactions" ref={actionsRef}>{actions}</span>} extra={<><TeamChip projectId={projectId} doc={loaded ? teamDoc : null} writable={!readOnly} canBreak={role === 'owner' || role === 'manager' || me?.role === 'admin'} editing={saveState.dirty} /><CommentsButton state={comments} /></>} onPalette={() => setPalette(true)} onShortcuts={() => setKeysOpen(true)} />
      <CommentsPanel projectId={projectId} state={comments} />
      {banners}
      {finding && find ? <FindBar key={finding.n} root={() => hostRef.current?.querySelector<HTMLElement>('[data-testid="jss-paper"], .jsg-sheet') ?? hostRef.current} replace={finding.replace} readOnly={readOnly} onClose={() => setFinding(null)} notify={(m) => toast(m, 'info')} /> : null}
      <div className={`v2-split${focus ? ' is-focus' : ''}`} {...DOC_IDS[kind].split} ref={splitRef} style={{ display: loaded ? undefined : 'none', ...(dragging ? { userSelect: 'none' } : {}) }}>
        <div className="a" style={{ display: shown === 'pdf' ? 'none' : 'flex', flex: shown === 'edit' ? '1 1 0' : `0 0 ${pct}%`, minWidth: 0 }}>
          <div ref={hostRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }} {...DOC_IDS[kind].host} />
        </div>
        {shown === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" aria-valuenow={Math.round(pct)} aria-valuemin={layout.splitRange[0]} aria-valuemax={layout.splitRange[1]} tabIndex={0} onPointerDown={startDrag} onKeyDown={dividerKey} /> : null}
        <div className="b" style={{ flex: '1 1 0', display: shown === 'edit' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, borderLeft: shown === 'pdf' ? 0 : undefined }}>{pdf}</div>
      </div>
      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
      {keysOpen ? <ShortcutsDialog editor={shortcuts} onClose={() => setKeysOpen(false)} /> : null}
    </>
  );
}

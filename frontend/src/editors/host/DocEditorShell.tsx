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
}

export function DocEditorShell({ kind, shortcuts, layout, title, crumb, saveState, actions, guard, banners, loaded, hostRef, pdf, find, readOnly }: DocEditorShellProps) {
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
    escape: () => { if (finding) { setFinding(null); return true; } if (focus) { setFocus(false); return true; } return false; },
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
      <EditorHeader layout={layout} title={title} crumb={crumb} state={<SaveStateChip state={saveState} testId={`${kind}-state`} />}
        actions={<span className="v2-edactions" ref={actionsRef}>{actions}</span>} onPalette={() => setPalette(true)} onShortcuts={() => setKeysOpen(true)} />
      {banners}
      {finding && find ? <FindBar key={finding.n} root={() => hostRef.current?.querySelector<HTMLElement>('[data-testid="jss-paper"], .jsg-sheet') ?? hostRef.current} replace={finding.replace} readOnly={readOnly} onClose={() => setFinding(null)} notify={(m) => toast(m, 'info')} /> : null}
      <div className={`v2-split${focus ? ' is-focus' : ''}`} data-testid={`${kind}-split`} ref={splitRef} style={{ display: loaded ? undefined : 'none', ...(dragging ? { userSelect: 'none' } : {}) }}>
        <div className="a" style={{ display: shown === 'pdf' ? 'none' : 'flex', flex: shown === 'edit' ? '1 1 0' : `0 0 ${pct}%`, minWidth: 0 }}>
          <div ref={hostRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }} data-testid={`${kind}-host`} />
        </div>
        {shown === 'split' ? <div className={`v2-divider ${dragging ? 'drag' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize editor and PDF" aria-valuenow={Math.round(pct)} aria-valuemin={layout.splitRange[0]} aria-valuemax={layout.splitRange[1]} tabIndex={0} onPointerDown={startDrag} onKeyDown={dividerKey} /> : null}
        <div className="b" style={{ flex: '1 1 0', display: shown === 'edit' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, borderLeft: shown === 'pdf' ? 0 : undefined }}>{pdf}</div>
      </div>
      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
      {keysOpen ? <ShortcutsDialog editor={shortcuts} onClose={() => setKeysOpen(false)} /> : null}
    </>
  );
}

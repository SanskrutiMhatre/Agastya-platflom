// WP-21 (UX-003 stage 1, 06 section 7.1): the one header of the three editor pages.
//
//   [lead] Project name / document   [state]          [actions ...]   [Commands Ctrl+K] [?] [focus] [Editor|Split|PDF] [theme]
//
// Each page supplies what is its own (the S1000D data-module panel toggle, the JSS/JSG document type, the Save, Check, Generate and package actions);
// the state words, the palette, the shortcuts, focus mode and the layout switch are the host's and behave the same in all three. In focus mode the
// header is slim: the name, the state, the palette and the way back.

import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { ThemeToggle } from '../../components/ThemeToggle';
import '../../styles/pages/editor-host.css';   // WP-35 second pass: the header's styles load with the editor chunks
import { saveStateLabel, type SaveStateInput } from './saveState';
import type { EditorLayout } from './useEditorLayout';
import type { TestId } from './testIds';

export function SaveStateChip({ state, ids }: { state: SaveStateInput; ids: TestId }) {
  const { text, tone } = saveStateLabel(state);
  const mark = tone === 'ok' ? '✓ ' : tone === 'warn' ? '● ' : tone === 'bad' ? '! ' : '';
  return <span className={`v2-badge v2-edstate ${tone === 'busy' ? '' : tone}`} {...ids} data-tone={tone} aria-live="polite" title={tone === 'bad' ? 'The last save did not reach the server. Press Save (Ctrl+S) to try again.' : undefined}>{mark}{text}</span>;
}

export interface EditorHeaderProps {
  layout: EditorLayout;
  title: string;
  /** before the title (the S1000D panel toggle) */
  lead?: ReactNode;
  /** after the title: the open document, the document type */
  crumb?: ReactNode;
  state: ReactNode;
  /** the page's own actions (Save, Check, packages, Generate) */
  actions?: ReactNode;
  onPalette: () => void;
  onShortcuts: () => void;
  /** WP-22: beside the palette button, also in focus mode (the review comments) */
  extra?: ReactNode;
  /** the layout switch can offer Split (not on a narrow window) */
  canSplit?: boolean;
}

export function EditorHeader({ layout, title, lead, crumb, state, actions, extra, onPalette, onShortcuts, canSplit = true }: EditorHeaderProps) {
  const { view, setView, narrow, focus, toggleFocus } = layout;
  return (
    <header className={`v2-top v2-edhead${focus ? ' is-focus' : ''}`} data-testid="editor-header">
      {focus ? null : lead}
      <h1 className="v2-trunc v2-edtitle" title={title}>{title}</h1>
      {crumb}
      {state}
      <span className="spacer" />
      {focus ? null : actions}
      {extra}
      <span className="v2-edsep" aria-hidden="true" />
      <button className="btn btn-sm v2-edcmd" onClick={onPalette} data-testid="chrome-palette" title="Command palette: every command of this editor by name (Ctrl+K)" aria-keyshortcuts="Control+K">
        <Icon name="command" size={12} /><span className="v2-edcmd-label">Commands</span><kbd className="v2-kbd">Ctrl K</kbd>
      </button>
      <button className="icon-btn" onClick={onShortcuts} data-testid="chrome-shortcuts" title="Keyboard shortcuts (F1)" aria-label="Keyboard shortcuts" aria-keyshortcuts="F1"><Icon name="keyboard" size={16} /></button>
      <button className={`icon-btn${focus ? ' is-on' : ''}`} onClick={toggleFocus} data-testid="chrome-focus" aria-pressed={focus} aria-keyshortcuts="Control+Period"
        title={focus ? 'Leave focus mode (Ctrl+. or Esc)' : 'Focus mode: only the document (Ctrl+.)'} aria-label={focus ? 'Leave focus mode' : 'Focus mode'}><Icon name={focus ? 'unfocus' : 'focus'} size={16} /></button>
      {focus ? null : <div className="v2-seg" role="group" aria-label="Editor layout">
        <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')} aria-pressed={view === 'edit'} title="Write only">Editor</button>
        {narrow || !canSplit ? null : <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')} aria-pressed={view === 'split'} title="Write and see the PDF side by side">Split</button>}
        <button className={view === 'pdf' ? 'on' : ''} onClick={() => setView('pdf')} aria-pressed={view === 'pdf'} title="PDF only">PDF</button>
      </div>}
      {focus ? null : <ThemeToggle />}
    </header>
  );
}

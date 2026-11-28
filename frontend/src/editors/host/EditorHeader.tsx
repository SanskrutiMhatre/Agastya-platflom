// WP-21 (UX-003 stage 1, 06 section 7.1): the one header of the three editor pages, drawn as the owner-approved mockup's top bar
// (docs/audit/mockups/editor.html, UI redesign): it spans the window over the activity bar (a shell slot, Workspace.tsx useShellSlot).
//
//   [brand] Project / section / DOCUMENT [badge]   [team] [Commands Ctrl K] [actions: Validate, Quick preview, Build]  [panels] [?] [focus] [theme] [account]
//
// UI redesign, second pass: [panels] are the VS Code-style toggles of the explorer, the Problems panel and the Properties panel; the
// Editor | Split | PDF switch moved to the right end of the document tab row (ChromeControls.tsx ViewSwitch), where view modes are looked for.
//
// Each page supplies what is its own (the document's place and code, the S1000D data-module panel toggle, Check / Validate, Save, Generate and
// the package actions); the state words, the palette, the shortcuts, focus mode and the layout switch are the host's and behave the same in all
// three. In focus mode the bar keeps the name, the palette, the shortcuts and the way back.

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ThemeToggle } from '../../components/ThemeToggle';
import { AccountMenu } from '../../components/AccountMenu';
import '../../styles/pages/editor-host.css';   // WP-35 second pass: the header's styles load with the editor chunks
import { saveStateLabel, type SaveStateInput } from './saveState';
import type { EditorLayout } from './useEditorLayout';
import type { TestId } from './testIds';
import { useShellSlot } from './Workspace';
import { PanelToggles, type PanelId, type PanelToggle } from './ChromeControls';

/** The save state, as the mockup's status-bar item (`.save-state`, `.dirty` while there are unsaved changes). */
export function SaveStateChip({ state, ids }: { state: SaveStateInput; ids: TestId }) {
  const { text, tone } = saveStateLabel(state);
  const icon = tone === 'ok' ? 'ok' : tone === 'bad' ? 'xcircle' : 'edit';
  return (
    <span className={`save-state v2-edstate ${tone === 'warn' || tone === 'busy' ? 'dirty' : ''} ${tone === 'bad' ? 'bad' : ''}`} {...ids} data-tone={tone} aria-live="polite"
      title={tone === 'bad' ? 'The last save did not reach the server. Press Save (Ctrl+S) to try again.' : undefined}>
      <Icon name={icon} size={14} className="ico sm" />{text}
    </span>
  );
}

export interface EditorHeaderProps {
  layout: EditorLayout;
  /** the project's name (the first crumb, a link to the project) */
  title: string;
  /** where the project's name leads */
  homeHref?: string;
  /** the second crumb: where the document is (the S1000D chapter or SNS, the JSS/JSG document type) */
  section?: ReactNode;
  /** the open document, in mono (the data module code); the page's heading */
  doc?: ReactNode;
  /** after the document: a status badge */
  badge?: ReactNode;
  /** before the crumbs (the S1000D panel toggle) */
  lead?: ReactNode;
  /** the save state, shown here only while the status bar is not (focus mode) */
  state?: ReactNode;
  /** the page's own actions (Validate / Check, Save, packages, Generate) */
  actions?: ReactNode;
  onPalette: () => void;
  onShortcuts: () => void;
  /** WP-22: beside the palette button, also in focus mode (the check-out, the review comments) */
  extra?: ReactNode;
  /** UI redesign: the panel toggles (explorer, Problems, Properties); the Editor | Split | PDF switch is on the document tab row (ViewSwitch) */
  panels?: Partial<Record<PanelId, PanelToggle>>;
}

export function EditorHeader({ layout, title, homeHref, section, doc, badge, lead, state, actions, extra, onPalette, onShortcuts, panels }: EditorHeaderProps) {
  const { focus, toggleFocus } = layout;
  const slot = useShellSlot('top');
  const bar = (
    <header className={`topbar ed-topbar${focus ? ' is-focus' : ''}`} data-testid="editor-header">
      <Link to="/overview" className="brand" aria-label="Agastya home" title="Agastya home"><span className="brand-mark"><Icon name="book" size={20} className="ico lg" /></span></Link>
      {focus ? null : lead}
      <nav className="crumbs" aria-label="Breadcrumb">
        {homeHref ? <Link to={homeHref} className="trunc ed-crumb-project" title={title}>{title}</Link> : <span className="trunc ed-crumb-project" title={title}>{title}</span>}
        {section ? <><span className="sep" aria-hidden="true">/</span><span className="trunc ed-crumb-section">{section}</span></> : null}
        {doc ? <><span className="sep" aria-hidden="true">/</span><h1 className="mono trunc ed-crumb-doc">{doc}</h1></> : <h1 className="sr">{title}</h1>}
        {badge}
      </nav>
      {state}
      <span className="grow" />
      {extra}
      <button type="button" className="search-trigger ed-cmd" onClick={onPalette} data-testid="chrome-palette" title="Command palette: every command of this editor by name (Ctrl+K)" aria-keyshortcuts="Control+K">
        <Icon name="search" size={16} className="ico" /><span className="ed-cmd-label">Commands…</span><span className="kbd-group"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </button>
      {focus ? null : actions}
      {focus || !panels ? null : <PanelToggles panels={panels} />}
      <button type="button" className="icon-btn" onClick={onShortcuts} data-testid="chrome-shortcuts" title="Keyboard shortcuts (F1)" aria-label="Keyboard shortcuts" aria-keyshortcuts="F1"><Icon name="keyboard" size={16} className="ico" /></button>
      <button type="button" className="icon-btn" onClick={toggleFocus} data-testid="chrome-focus" aria-pressed={focus} aria-keyshortcuts="Control+Period"
        title={focus ? 'Leave focus mode (Ctrl+. or Esc)' : 'Focus mode: only the document (Ctrl+.)'} aria-label={focus ? 'Leave focus mode' : 'Focus mode'}><Icon name={focus ? 'unfocus' : 'focus'} size={16} className="ico" /></button>
      {focus ? null : <ThemeToggle />}
      {focus ? null : <AccountMenu />}
    </header>
  );
  return slot ? createPortal(bar, slot) : null;
}

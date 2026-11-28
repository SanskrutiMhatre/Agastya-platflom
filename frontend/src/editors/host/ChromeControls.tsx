// UI redesign, second pass (owner's requests 2026-11-28): the workspace controls the three editors share, so that S1000D, JSS and JSG look and
// answer the same.
//
//   PanelToggles   the top bar's three VS Code-style toggles: the explorer (left), the Problems panel (bottom), the Properties panel (right);
//                  pressed = open. Keys: Ctrl+Shift+B, Ctrl+J, Ctrl+Alt+Shift+B (Ctrl+B is Bold in all three editors and Ctrl+Alt+B the
//                  Studio's bulleted list, so VS Code's keys take a Shift here). Each panel also closes from its own head.
//   ViewSwitch     Editor | Split | PDF, a labelled segmented control at the right end of the document tab row (Ctrl+Shift+1, 2, 3).
//   QuickPreview   Quick preview (the open document rendered by the server as a draft PDF) and its "Refresh on save" toggle, in the top bar.
//
// The keys are answered by useHostKeys.ts and listed in lib/editorShortcuts.ts (the JSS and JSG dialogs) and, for the Studio, by the page's
// commands (StudioHost.commands) in its palette and shortcuts dialog.

import { Icon, type IconName } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import type { EditorLayout, EditorView } from './useEditorLayout';

/** The keys, as shown in tooltips (the palette and the shortcuts lists use the same words). */
export const PANEL_KEYS = { explorer: 'Ctrl+Shift+B', problems: 'Ctrl+J', props: 'Ctrl+Alt+Shift+B' } as const;
export const VIEW_KEYS: Record<EditorView, string> = { edit: 'Ctrl+Shift+1', split: 'Ctrl+Shift+2', pdf: 'Ctrl+Shift+3' };
/** aria-keyshortcuts wants the key names spelled out */
const aria = (k: string): string => k.replace('Ctrl', 'Control');

export interface PanelToggle { on: boolean; set: (on: boolean) => void; disabled?: boolean }
export type PanelId = keyof typeof PANEL_KEYS;

const PANELS: Array<{ id: PanelId; icon: IconName; name: string; what: string; testId: string }> = [
  { id: 'explorer', icon: 'panel', name: 'Explorer', what: 'the explorer', testId: 'toggle-side' },
  { id: 'problems', icon: 'panelBottom', name: 'Problems panel', what: 'the Problems panel', testId: 'toggle-problems' },
  { id: 'props', icon: 'panelRight', name: 'Properties panel', what: 'the Properties panel (Element, Document, Comments)', testId: 'doc-props-toggle' },
];

/** The top bar's panel toggles. A panel the page cannot show now (a narrow window, focus mode) is left out. */
export function PanelToggles({ panels }: { panels: Partial<Record<PanelId, PanelToggle>> }) {
  return (
    <div className="ed-panels" role="group" aria-label="Panels" data-testid="panel-toggles">
      {PANELS.map((p) => {
        const t = panels[p.id]; if (!t) return null;
        return (
          <button key={p.id} type="button" className="icon-btn ed-panel-toggle" aria-pressed={t.on} aria-label={p.name} aria-keyshortcuts={aria(PANEL_KEYS[p.id])}
            title={`${t.on ? 'Hide' : 'Show'} ${p.what} (${PANEL_KEYS[p.id]})`} onClick={() => t.set(!t.on)} disabled={t.disabled} data-testid={p.testId}>
            <Icon name={p.icon} size={16} className="ico" />
          </button>
        );
      })}
    </div>
  );
}

/** The close button of a panel's head (the explorer, Problems, Properties): the same look and words everywhere. */
export function PanelClose({ panel, onClose, testId }: { panel: PanelId; onClose: () => void; testId?: string }) {
  const p = PANELS.find((x) => x.id === panel)!;
  return (
    <button type="button" className="icon-btn pane-close" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} aria-label={`Close the ${p.name === 'Explorer' ? 'explorer' : p.name}`}
      title={`Close ${p.what.replace(/ \(.*\)$/, '')} (${PANEL_KEYS[panel]})`} data-testid={testId}>
      <Icon name="close" size={14} className="ico sm" />
    </button>
  );
}

const VIEWS: Array<{ v: EditorView; icon: IconName; label: string; tip: string }> = [
  { v: 'edit', icon: 'editor', label: 'Editor', tip: 'Editor only' },
  { v: 'split', icon: 'split', label: 'Split', tip: 'Editor and PDF side by side' },
  { v: 'pdf', icon: 'pdf', label: 'PDF', tip: 'PDF only' },
];

/** Editor | Split | PDF: what the document area shows. Split is not offered on a narrow window (the two panes would not fit). */
export function ViewSwitch({ layout, canSplit = true }: { layout: EditorLayout; canSplit?: boolean }) {
  const { view, setView, narrow } = layout;
  return (
    <div className="seg ed-viewswitch" role="group" aria-label="Editor layout" data-testid="view-switch">
      {VIEWS.filter((x) => x.v !== 'split' || (canSplit && !narrow)).map((x) => (
        <button key={x.v} type="button" aria-pressed={view === x.v} onClick={() => setView(x.v)} aria-label={x.label} title={`${x.tip} (${VIEW_KEYS[x.v]})`} aria-keyshortcuts={aria(VIEW_KEYS[x.v])} data-view={x.v}>
          <Icon name={x.icon} size={14} className="ico sm" /><span className="ed-viewswitch-label">{x.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface QuickPreviewProps {
  onRun: () => void;
  busy: boolean;
  disabled?: boolean;
  /** why it cannot run, or what it does */
  title: string;
  auto: boolean;
  setAuto: (on: boolean) => void;
  testId: string;
  autoTestId: string;
}

/** Quick preview and its "Refresh on save" toggle (pressed = the preview is rendered again after every save while it is on show). */
export function QuickPreview({ onRun, busy, disabled, title, auto, setAuto, testId, autoTestId }: QuickPreviewProps) {
  return (
    <span className="ed-qp" role="group" aria-label="Quick preview">
      <button type="button" className="btn ed-qp-run" onClick={onRun} disabled={disabled || busy} title={title} aria-label="Quick preview" data-testid={testId}>
        {busy ? <Spinner /> : <Icon name="eye" size={16} className="ico" />}<span className="ed-qp-label">Quick preview</span>
      </button>
      <button type="button" className="btn ed-qp-auto" aria-pressed={auto} aria-label="Refresh on save" onClick={() => setAuto(!auto)} data-testid={autoTestId}
        title={auto ? 'Refresh on save is on: the quick preview is rendered again after every save. Press to turn it off.' : 'Refresh on save is off. Press to render the quick preview again after every save.'}>
        <Icon name="refresh" size={14} className="ico sm" />
      </button>
    </span>
  );
}

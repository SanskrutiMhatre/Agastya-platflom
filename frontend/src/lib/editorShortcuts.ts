// WP-34 (GAP-009): the keyboard shortcuts of the JSS and JSG editors, written down in one place. The S1000D Studio has a command registry
// (studio/ui/commands.ts) that its key handler reads; the JSS and JSG editors handle their keys in their own keydown handlers. This registry
// describes those handlers so that the feature-preservation baseline (docs/audit/baseline/parity-baseline.json) can list every key, and so
// that a help screen can show them. editorShortcuts.test.ts holds it to the source: a key compared in one of the listed files that has no
// entry here, or an entry whose key no longer appears in its file, fails that test.
//
// `keys` use the Studio's notation: Mod = Ctrl on Windows (Cmd on a Mac), then Shift, Alt, and the key name as the browser reports it.

export type ShortcutEditor = 'jss' | 'jsg' | 'jsg-ispl' | 'host' | 'platform';

export interface EditorShortcut {
  id: string;
  editor: ShortcutEditor;
  keys: string[];
  /** What the key does. */
  action: string;
  /** Where the key works (focus, mode). */
  where: string;
  /** The file (under src/) whose keydown handler implements it. */
  file: string;
}

const jss = (id: string, keys: string[], action: string, where: string, file = 'jss/editor.ts'): EditorShortcut => ({ id: `jss.${id}`, editor: 'jss', keys, action, where, file });
const jsg = (id: string, keys: string[], action: string, where: string, file = 'jsg/editor.ts'): EditorShortcut => ({ id: `jsg.${id}`, editor: 'jsg', keys, action, where, file });
const host = (id: string, keys: string[], action: string, where: string, file = 'editors/host/useHostKeys.ts'): EditorShortcut => ({ id: `host.${id}`, editor: 'host', keys, action, where, file });

export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  // ---- JSS editor (jss/editor.ts, jss/dom.ts)
  jss('save', ['Mod+S'], 'Save the document', 'anywhere on the page (WP-22: also after the find bar was closed)'),
  jss('undo', ['Mod+Z'], 'Undo', 'anywhere in the editor'),
  jss('redo', ['Mod+Y', 'Mod+Shift+Z'], 'Redo', 'anywhere in the editor'),
  jss('indent', ['Tab'], 'Indent the list item; in a table, go to the next cell (a new row after the last cell)', 'list item or table cell'),
  jss('outdent', ['Shift+Tab'], 'Outdent the list item; in a table, go to the previous cell', 'list item or table cell'),
  jss('split', ['Enter'], 'Split the paragraph or item at the caret; in a one-line field, go to the next field', 'a text block'),
  jss('lineBreak', ['Shift+Enter'], 'Line break (Enter alone also breaks the line in a table cell)', 'a text block or table cell'),
  jss('merge', ['Backspace'], 'At the start of a block: join it with the one before', 'caret at the start of a block'),
  jss('nextField', ['ArrowDown'], 'At the end of a block: go to the next one', 'caret at the end of a block'),
  jss('prevField', ['ArrowUp'], 'At the start of a block: go to the one before', 'caret at the start of a block'),
  jss('closeProblems', ['Escape'], 'Close the Problems drawer (WP-22)', 'the Problems drawer at the foot of the editor'),
  jss('goto', ['Enter', 'Space'], 'Go to the heading of an outline row or the place of a problem (Space too, WP-23)', 'outline row, problems row'),
  jss('dialogOk', ['Enter'], 'Confirm the dialog', 'a JSS dialog (not in a text area or on a button)', 'jss/dom.ts'),
  jss('dialogCancel', ['Escape'], 'Cancel the dialog, or close a pop-up menu', 'a JSS dialog or pop-up menu', 'jss/dom.ts'),

  // ---- JSG editor (jsg/editor.ts, jsg/shared.ts)
  jsg('save', ['Mod+S'], 'Save the document', 'anywhere on the page'),
  jsg('find', ['Mod+F'], 'Open Find', 'in the editor'),
  jsg('replace', ['Mod+H'], 'Open Find and replace (not in a read-only document)', 'in the editor'),
  jsg('closeFind', ['Escape'], 'Close the find bar', 'in the find bar'),
  jsg('undo', ['Mod+Z'], 'Undo', 'in the editor, not in a form field'),
  jsg('redo', ['Mod+Y', 'Mod+Shift+Z'], 'Redo', 'in the editor, not in a form field'),
  jsg('findStep', ['Enter', 'Shift+Enter'], 'Next match; with Shift the previous one', 'the find box'),
  jsg('replaceOne', ['Enter'], 'Replace this match', 'the replace box'),
  jsg('newBlock', ['Enter'], 'A new paragraph after this one (in a title, Enter is ignored)', 'a rich-text block or a title'),
  jsg('lineBreak', ['Shift+Enter'], 'Line break', 'a rich-text block'),
  jsg('closeMenu', ['Escape'], 'Close the pop-up menu', 'a JSG pop-up menu', 'jsg/shared.ts'),

  // ---- JSG parts list (ISPL) editor (jsg/ispl-editor.ts)
  { id: 'jsg-ispl.save', editor: 'jsg-ispl', keys: ['Mod+S'], action: 'Save the document', where: 'anywhere on the page', file: 'jsg/ispl-editor.ts' },

  // ---- WP-21: the editor host, the same in the JSS and JSG editors (editors/host). The S1000D Studio has the same keys in its own registry
  // (studio/ui/commands.ts: tools.palette Mod+K and Mod+Shift+P, tools.shortcuts F1, view.focus Mod+.; its find bar answers Mod+F and Mod+H).
  host('palette', ['Mod+K', 'Mod+Shift+P'], 'Open the command palette', 'anywhere on the editor page'),
  host('shortcuts', ['F1'], 'Show the keyboard shortcuts', 'anywhere on the editor page'),
  host('focus', ['Mod+.'], 'Focus mode on or off: only the document and a slim header', 'anywhere on the editor page'),
  host('find', ['Mod+F', 'Mod+H'], 'Open Find; with H, Find and replace', 'the JSS editor (the JSG editor has its own find bar on the same keys)'),
  host('escape', ['Escape'], 'Close the find bar, or leave focus mode', 'anywhere on the editor page'),
  host('comments', ['Alt+Shift+N', 'Alt+Shift+P'], 'Next review comment; with P the previous one (the comments panel opens; WP-22)', 'anywhere on the editor page, when the project has review comments'),
  // UI redesign: the workspace's panels and layout (the same keys on the S1000D page, listed there in the Studio's own dialog). VS Code's
  // Ctrl+B and Ctrl+Alt+B take a Shift: Ctrl+B is Bold in the three editors, Ctrl+Alt+B the Studio's bulleted list.
  host('explorer', ['Mod+Shift+B'], 'Show or hide the explorer (the document outline)', 'anywhere on the editor page'),
  host('problems', ['Mod+J'], 'Show or hide the Problems panel', 'anywhere on the editor page'),
  host('props', ['Mod+Alt+Shift+B'], 'Show or hide the Properties panel (Element, Document, Comments)', 'anywhere on the editor page'),
  host('view', ['Mod+Shift+1', 'Mod+Shift+2', 'Mod+Shift+3'], 'Editor only; Editor and PDF side by side; PDF only', 'anywhere on the editor page'),
  host('paletteMove', ['ArrowDown', 'ArrowUp'], 'Move through the commands', 'the command palette', 'editors/host/CommandPalette.tsx'),
  host('paletteRun', ['Enter'], 'Run the command', 'the command palette', 'editors/host/CommandPalette.tsx'),
  host('findStep', ['Enter', 'Shift+Enter'], 'Next match; with Shift the previous one', 'the JSS find box', 'editors/host/FindBar.tsx'),
  host('findClose', ['Escape'], 'Close the find bar', 'the JSS find bar', 'editors/host/FindBar.tsx'),

  // ---- WP-22: the platform pages (not an editor): the quick switcher (components/QuickSwitcher.tsx). On an editor page Ctrl+K stays the palette.
  { id: 'platform.jump', editor: 'platform', keys: ['Mod+K'], action: 'Jump to a project, a page or a data module', where: 'every platform and project page except the editors', file: 'components/QuickSwitcher.tsx' },
  // the switcher draws its own list since the global UI pass (2026-11-28: the mockups' palette); the keys are the command palette's
  { id: 'platform.jumpMove', editor: 'platform', keys: ['ArrowDown', 'ArrowUp'], action: 'Move through the results', where: 'Jump to', file: 'components/QuickSwitcher.tsx' },
  { id: 'platform.jumpOpen', editor: 'platform', keys: ['Enter'], action: 'Open the result', where: 'Jump to', file: 'components/QuickSwitcher.tsx' },
  { id: 'platform.jumpClose', editor: 'platform', keys: ['Escape'], action: 'Close Jump to', where: 'Jump to', file: 'components/QuickSwitcher.tsx' },
  { id: 'platform.jumpStay', editor: 'platform', keys: ['Tab'], action: 'Keep the focus in the search field (the only control)', where: 'Jump to', file: 'components/QuickSwitcher.tsx' },
];

/** The keys of one editor page: the host's, then the editor's own (JSG parts lists also have the JSG editor's page keys). */
export const shortcutsFor = (editor: 'jss' | 'jsg' | 'jsg-ispl'): EditorShortcut[] => EDITOR_SHORTCUTS.filter((s) => s.editor === editor || (s.editor === 'host' && (editor === 'jss' || !s.id.startsWith('host.find'))));

/** The key name of a chord without its modifiers, lower-cased: `Mod+Shift+Z` -> `z`. What the handlers compare `e.key` with. */
export const baseKey = (chord: string): string => chord.split('+').pop()!.toLowerCase();

// WP-34 (GAP-009): the keyboard shortcuts of the JSS and JSG editors, written down in one place. The S1000D Studio has a command registry
// (studio/ui/commands.ts) that its key handler reads; the JSS and JSG editors handle their keys in their own keydown handlers. This registry
// describes those handlers so that the feature-preservation baseline (docs/audit/baseline/parity-baseline.json) can list every key, and so
// that a help screen can show them. editorShortcuts.test.ts holds it to the source: a key compared in one of the listed files that has no
// entry here, or an entry whose key no longer appears in its file, fails that test.
//
// `keys` use the Studio's notation: Mod = Ctrl on Windows (Cmd on a Mac), then Shift, Alt, and the key name as the browser reports it.

export type ShortcutEditor = 'jss' | 'jsg' | 'jsg-ispl';

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

export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  // ---- JSS editor (jss/editor.ts, jss/dom.ts)
  jss('save', ['Mod+S'], 'Save the document', 'anywhere in the editor'),
  jss('undo', ['Mod+Z'], 'Undo', 'anywhere in the editor'),
  jss('redo', ['Mod+Y', 'Mod+Shift+Z'], 'Redo', 'anywhere in the editor'),
  jss('indent', ['Tab'], 'Indent the list item; in a table, go to the next cell (a new row after the last cell)', 'list item or table cell'),
  jss('outdent', ['Shift+Tab'], 'Outdent the list item; in a table, go to the previous cell', 'list item or table cell'),
  jss('split', ['Enter'], 'Split the paragraph or item at the caret; in a one-line field, go to the next field', 'a text block'),
  jss('lineBreak', ['Shift+Enter'], 'Line break (Enter alone also breaks the line in a table cell)', 'a text block or table cell'),
  jss('merge', ['Backspace'], 'At the start of a block: join it with the one before', 'caret at the start of a block'),
  jss('nextField', ['ArrowDown'], 'At the end of a block: go to the next one', 'caret at the end of a block'),
  jss('prevField', ['ArrowUp'], 'At the start of a block: go to the one before', 'caret at the start of a block'),
  jss('goto', ['Enter'], 'Go to the heading of an outline row or the place of a problem', 'outline row, problems row'),
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
];

/** The key name of a chord without its modifiers, lower-cased: `Mod+Shift+Z` -> `z`. What the handlers compare `e.key` with. */
export const baseKey = (chord: string): string => chord.split('+').pop()!.toLowerCase();

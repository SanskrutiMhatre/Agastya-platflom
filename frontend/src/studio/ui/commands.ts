/**
 * Command registry: every ribbon button, menu item, context-menu entry,
 * palette entry and keyboard shortcut maps to one of these commands.
 */
import type { App } from './app';
import type { DocumentEditor } from './editor';
import { EMPHASIS } from './editor';
import * as T from '../core/table';

export interface Command {
  id: string;
  label: string;
  icon?: string;
  keys?: string[];
  group: string;
  description?: string;
  /** Command works without an open document. */
  global?: boolean;
  run(app: App, ed: DocumentEditor | null): void | Promise<void>;
  enabled?(app: App, ed: DocumentEditor): boolean;
  checked?(app: App, ed: DocumentEditor | null): boolean;
}

const inTable = (_: App, ed: DocumentEditor) => !!T.entryOf(ed.elementSelection ?? ed.currentPos().node);
const inAnyTable = (_: App, ed: DocumentEditor) => !!T.tableOf(ed.elementSelection ?? ed.currentPos().node);
const editable = (_: App, ed: DocumentEditor) => !ed.readOnlyReason();

export function buildCommands(): Command[] {
  const c: Command[] = [];
  const add = (cmd: Command) => c.push(cmd);

  // ---------------------------------------------------------------- File
  add({ id: 'file.new', label: 'New data module…', icon: 'new', keys: ['Mod+Alt+N'], group: 'File', global: true, run: (a) => a.dialogs.newDm() });
  add({ id: 'file.open', label: 'Open…', icon: 'open', keys: ['Mod+O'], group: 'File', global: true, run: (a) => a.openFiles() });
  add({ id: 'file.save', label: 'Save', icon: 'save', keys: ['Mod+S'], group: 'File', run: (a, ed) => a.save(ed!) });
  add({ id: 'file.saveAs', label: 'Save as…', icon: 'saveAs', keys: ['Mod+Shift+S'], group: 'File', run: (a, ed) => a.save(ed!, true) });
  add({ id: 'file.exportXml', label: 'Export XML (download)', icon: 'export', group: 'File', run: (a, ed) => a.exportXml(ed!) });
  add({ id: 'file.exportHtml', label: 'Export as HTML', icon: 'html', group: 'File', run: (a, ed) => a.exportHtml(ed!) });
  add({ id: 'file.exportPdf', label: 'Export as PDF…', icon: 'pdf', group: 'File', description: 'S1000D publication PDF: title page, contents lists, data module pages', run: (a, ed) => a.exportPdf(ed!) });
  add({ id: 'file.close', label: 'Close document', icon: 'close', keys: ['Mod+Alt+W'], group: 'File', run: (a, ed) => a.closeEditor(ed!) });
  add({ id: 'file.samples', label: 'Open sample data module…', icon: 'sample', group: 'File', global: true, run: (a) => a.dialogs.samples() });
  add({ id: 'file.recent', label: 'Recent files…', icon: 'recent', group: 'File', global: true, run: (a) => a.dialogs.recent() });

  // ---------------------------------------------------------------- Edit
  add({ id: 'edit.undo', label: 'Undo', icon: 'undo', keys: ['Mod+Z'], group: 'Edit', run: (_, ed) => ed!.undo(), enabled: (_, ed) => ed.doc.canUndo || ed.xml.hasPending });
  add({ id: 'edit.redo', label: 'Redo', icon: 'redo', keys: ['Mod+Y', 'Mod+Shift+Z'], group: 'Edit', run: (_, ed) => ed!.redo(), enabled: (_, ed) => ed.doc.canRedo });
  add({ id: 'edit.cut', label: 'Cut', icon: 'cut', group: 'Edit', description: 'Ctrl+X', run: (a) => a.clipboardAction('cut'), enabled: editable });
  add({ id: 'edit.copy', label: 'Copy', icon: 'copy', group: 'Edit', description: 'Ctrl+C', run: (a) => a.clipboardAction('copy') });
  add({ id: 'edit.paste', label: 'Paste', icon: 'paste', group: 'Edit', description: 'Ctrl+V', run: (a) => a.clipboardAction('paste'), enabled: editable });
  add({ id: 'edit.pastePlain', label: 'Paste as plain text', icon: 'paste', keys: ['Mod+Shift+V'], group: 'Edit', run: (a) => a.clipboardAction('pastePlain'), enabled: editable });
  add({ id: 'edit.selectAll', label: 'Select all', group: 'Edit', description: 'Ctrl+A', run: (_, ed) => ed!.selectAllSmart() });
  add({ id: 'edit.find', label: 'Find…', icon: 'find', keys: ['Mod+F'], group: 'Edit', run: (a) => a.find.open(false) });
  add({ id: 'edit.replace', label: 'Replace…', icon: 'replace', keys: ['Mod+H'], group: 'Edit', run: (a) => a.find.open(true) });
  add({ id: 'edit.findNext', label: 'Find next', keys: ['F3'], group: 'Edit', run: (a) => a.find.next(1) });
  add({ id: 'edit.findPrev', label: 'Find previous', keys: ['Shift+F3'], group: 'Edit', run: (a) => a.find.next(-1) });
  add({ id: 'edit.gotoId', label: 'Go to ID / target…', icon: 'id', keys: ['Mod+G'], group: 'Edit', run: (a) => a.dialogs.gotoTarget() });

  // ---------------------------------------------------------------- Format
  const fmt = (id: string, label: string, icon: string, type: string, keys?: string[]) =>
    add({ id, label, icon, keys, group: 'Format', run: (_, ed) => ed!.toggleEmphasis(type), checked: (_, ed) => !!ed && ed.isFormatActive(type), enabled: (a, ed) => editable(a, ed) && (ed.isFormatActive(type) || ed.canInsert('emphasis')) });
  fmt('format.bold', 'Bold', 'bold', EMPHASIS.bold, ['Mod+B']);
  fmt('format.italic', 'Italic', 'italic', EMPHASIS.italic, ['Mod+I']);
  fmt('format.underline', 'Underline', 'underline', EMPHASIS.underline, ['Mod+U']);
  fmt('format.overline', 'Overline', 'overline', EMPHASIS.overline);
  fmt('format.strike', 'Strikethrough', 'strike', EMPHASIS.strike);
  add({ id: 'format.subscript', label: 'Subscript', icon: 'sub', keys: ['Mod+='], group: 'Format', run: (_, ed) => ed!.toggleInlineEl('subScript'), checked: (_, ed) => !!ed && ed.isInside('subScript'), enabled: (a, ed) => editable(a, ed) && (ed.isInside('subScript') || ed.canInsert('subScript')) });
  add({ id: 'format.superscript', label: 'Superscript', icon: 'sup', keys: ['Mod+Shift+='], group: 'Format', run: (_, ed) => ed!.toggleInlineEl('superScript'), checked: (_, ed) => !!ed && ed.isInside('superScript'), enabled: (a, ed) => editable(a, ed) && (ed.isInside('superScript') || ed.canInsert('superScript')) });

  // ---------------------------------------------------------------- Structure
  add({ id: 'struct.insert', label: 'Insert element…', icon: 'element', keys: ['Mod+E'], group: 'Structure', run: (a) => a.dialogs.elementPicker('insert'), enabled: editable });
  add({ id: 'struct.wrap', label: 'Wrap in element…', icon: 'wrap', keys: ['Mod+Alt+G'], group: 'Structure', run: (a) => a.dialogs.elementPicker('wrap'), enabled: editable });
  add({ id: 'struct.change', label: 'Change element…', icon: 'change', keys: ['Mod+Shift+E'], group: 'Structure', run: (a) => a.dialogs.elementPicker('change'), enabled: editable });
  add({ id: 'struct.removeTag', label: 'Remove tag (keep content)', icon: 'unwrap', keys: ['Mod+Alt+U'], group: 'Structure', run: (_, ed) => ed!.removeTag(), enabled: editable });
  add({ id: 'struct.delete', label: 'Delete element', icon: 'trash', keys: ['Mod+Shift+K'], group: 'Structure', run: (_, ed) => ed!.deleteElement(), enabled: editable });
  add({ id: 'struct.selectParent', label: 'Select element / parent', icon: 'parent', keys: ['Mod+Shift+ArrowUp'], group: 'Structure', run: (_, ed) => ed!.selectParent() });
  add({ id: 'struct.moveUp', label: 'Move up', icon: 'up', keys: ['Alt+Shift+ArrowUp'], group: 'Structure', run: (_, ed) => ed!.move(-1), enabled: (a, ed) => editable(a, ed) && !!ed.movable()?.previousElementSibling });
  add({ id: 'struct.moveDown', label: 'Move down', icon: 'down', keys: ['Alt+Shift+ArrowDown'], group: 'Structure', run: (_, ed) => ed!.move(1), enabled: (a, ed) => editable(a, ed) && !!ed.movable()?.nextElementSibling });
  add({ id: 'struct.demote', label: 'Demote (nest)', icon: 'indent', keys: ['Alt+Shift+ArrowRight'], group: 'Structure', run: (_, ed) => ed!.demote(), enabled: (a, ed) => editable(a, ed) && !!ed.nestable()?.previousElementSibling });
  add({ id: 'struct.promote', label: 'Promote (un-nest)', icon: 'outdent', keys: ['Alt+Shift+ArrowLeft'], group: 'Structure', run: (_, ed) => ed!.promote(), enabled: (a, ed) => editable(a, ed) && !!ed.nestable() && isNested(ed.nestable()!) });
  add({ id: 'struct.attributes', label: 'Element attributes…', icon: 'props', keys: ['Alt+Enter'], group: 'Structure', run: (a, ed) => a.openProperties(ed!.currentElement()) });

  // ---------------------------------------------------------------- Insert
  add({ id: 'insert.levelledPara', label: 'Levelled paragraph', icon: 'section', keys: ['Mod+Alt+L'], group: 'Insert', description: 'New section after the current one', run: (_, ed) => ed!.insertSibling('levelledPara', ['levelledPara']), enabled: (a, ed) => editable(a, ed) && ed.canInsert('levelledPara') });
  add({ id: 'insert.subLevelledPara', label: 'Sub-paragraph', icon: 'substep', group: 'Insert', description: 'New nested section inside the current one', run: (_, ed) => ed!.insertSibling('levelledPara', ['levelledPara'], true), enabled: (a, ed) => editable(a, ed) && ed.isInside('levelledPara') });
  add({ id: 'insert.para', label: 'Paragraph', icon: 'para', keys: ['Mod+Alt+P'], group: 'Insert', run: (_, ed) => ed!.insertElementNamed('para'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('para') });
  add({ id: 'insert.step', label: 'Procedural step', icon: 'step', keys: ['Mod+Alt+S'], group: 'Insert', run: (_, ed) => ed!.insertSibling('proceduralStep', ['proceduralStep']), enabled: (a, ed) => editable(a, ed) && ed.canInsert('proceduralStep') });
  add({ id: 'insert.substep', label: 'Sub-step', icon: 'substep', group: 'Insert', run: (_, ed) => ed!.insertSibling('proceduralStep', ['proceduralStep'], true), enabled: (a, ed) => editable(a, ed) && ed.isInside('proceduralStep') });
  add({ id: 'insert.warning', label: 'Warning', icon: 'warning', keys: ['Mod+Alt+1'], group: 'Insert', run: (_, ed) => ed!.insertElementNamed('warning', 'before'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('warning') });
  add({ id: 'insert.caution', label: 'Caution', icon: 'caution', keys: ['Mod+Alt+2'], group: 'Insert', run: (_, ed) => ed!.insertElementNamed('caution', 'before'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('caution') });
  add({ id: 'insert.note', label: 'Note', icon: 'note', keys: ['Mod+Alt+3'], group: 'Insert', run: (_, ed) => ed!.insertElementNamed('note'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('note') });
  add({ id: 'insert.randomList', label: 'Bulleted list', icon: 'bullets', keys: ['Mod+Alt+B'], group: 'Insert', run: (_, ed) => ed!.insertElementNamed('randomList'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('randomList') });
  add({ id: 'insert.sequentialList', label: 'Numbered list', icon: 'numbers', keys: ['Mod+Alt+Q'], group: 'Insert', run: (_, ed) => ed!.insertElementNamed('sequentialList'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('sequentialList') });
  add({ id: 'insert.definitionList', label: 'Definition list…', icon: 'definition', group: 'Insert', run: (a, ed) => a.dialogs.definitionList(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('definitionList') });
  add({ id: 'insert.table', label: 'Table…', icon: 'table', keys: ['Mod+Alt+T'], group: 'Insert', run: (a, ed) => a.dialogs.table(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('table') });
  add({ id: 'insert.figure', label: 'Figure…', icon: 'figure', keys: ['Mod+Alt+F'], group: 'Insert', run: (a, ed) => a.openFigureDialog(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('figure') });
  add({ id: 'insert.internalRef', label: 'Internal reference…', icon: 'link', keys: ['Mod+Alt+R'], group: 'Insert', run: (a, ed) => a.dialogs.internalRef(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('internalRef') });
  add({ id: 'insert.dmRef', label: 'External reference (data module)…', icon: 'dmref', keys: ['Mod+Alt+D'], group: 'Insert', run: (a, ed) => a.dialogs.dmRef(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('dmRef') });
  add({ id: 'insert.externalPubRef', label: 'External publication reference…', icon: 'extref', group: 'Insert', run: (a, ed) => a.dialogs.externalPubRef(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('externalPubRef') });
  add({ id: 'insert.acronym', label: 'Acronym…', icon: 'acronym', group: 'Insert', run: (a, ed) => a.dialogs.acronym(ed!), enabled: (a, ed) => editable(a, ed) && ed.canInsert('acronym') });
  add({ id: 'insert.verbatim', label: 'Verbatim text', icon: 'verbatim', group: 'Insert', run: (_, ed) => ed!.insertElementNamed('verbatimText'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('verbatimText') });
  add({ id: 'insert.footnote', label: 'Footnote', icon: 'footnote', group: 'Insert', run: (_, ed) => ed!.insertElementNamed('footnote'), enabled: (a, ed) => editable(a, ed) && ed.canInsert('footnote') });
  add({ id: 'insert.specialChar', label: 'Special character…', icon: 'symbol', group: 'Insert', run: (a, ed) => a.dialogs.specialChar(ed!), enabled: editable });

  // ---------------------------------------------------------------- Table
  const tbl = (id: string, label: string, icon: string, op: string) => add({ id, label, icon, group: 'Table', run: (_, ed) => ed!.tableOp(op), enabled: (a, ed) => editable(a, ed) && inTable(a, ed) });
  tbl('table.rowAbove', 'Insert row above', 'rowAbove', 'rowAbove');
  tbl('table.rowBelow', 'Insert row below', 'rowBelow', 'rowBelow');
  tbl('table.colLeft', 'Insert column left', 'colLeft', 'colLeft');
  tbl('table.colRight', 'Insert column right', 'colRight', 'colRight');
  tbl('table.deleteRow', 'Delete row', 'delRow', 'deleteRow');
  tbl('table.deleteCol', 'Delete column', 'delCol', 'deleteCol');
  tbl('table.mergeRight', 'Merge cell right', 'merge', 'mergeRight');
  tbl('table.mergeDown', 'Merge cell down', 'merge', 'mergeDown');
  tbl('table.split', 'Split cell', 'splitCell', 'split');
  tbl('table.header', 'Toggle header row', 'header', 'header');
  add({ id: 'table.delete', label: 'Delete table', icon: 'trash', group: 'Table', run: (_, ed) => ed!.tableOp('deleteTable'), enabled: (a, ed) => editable(a, ed) && inAnyTable(a, ed) });
  add({ id: 'table.properties', label: 'Table properties…', icon: 'tableProps', group: 'Table', run: (a, ed) => a.dialogs.tableProps(ed!), enabled: (a, ed) => editable(a, ed) && inAnyTable(a, ed) });
  const align = (id: string, label: string, icon: string, value: string) =>
    add({ id, label, icon, group: 'Table', run: (_, ed) => ed!.tableOp('align', value), enabled: (a, ed) => editable(a, ed) && inTable(a, ed), checked: (_, ed) => ed?.cellAlignment()?.align === value });
  align('table.alignLeft', 'Align cell left', 'alignLeft', 'left');
  align('table.alignCenter', 'Align cell center', 'alignCenter', 'center');
  align('table.alignRight', 'Align cell right', 'alignRight', 'right');
  align('table.alignJustify', 'Align cell justify', 'alignJustify', 'justify');
  const valign = (id: string, label: string, icon: string, value: string) =>
    add({ id, label, icon, group: 'Table', run: (_, ed) => ed!.tableOp('valign', value), enabled: (a, ed) => editable(a, ed) && inTable(a, ed), checked: (_, ed) => ed?.cellAlignment()?.valign === value });
  valign('table.valignTop', 'Align cell top', 'valignTop', 'top');
  valign('table.valignMiddle', 'Align cell middle', 'valignMiddle', 'middle');
  valign('table.valignBottom', 'Align cell bottom', 'valignBottom', 'bottom');

  // ---------------------------------------------------------------- Review
  add({ id: 'review.validate', label: 'Validate (XSD + BREX)', icon: 'validate', keys: ['F7'], group: 'Review', run: (a, ed) => a.validate(ed!, { live: false }) });
  add({ id: 'review.xsd', label: 'Validate against schema', icon: 'validate', group: 'Review', run: (a, ed) => a.validate(ed!, { live: false, xsd: true, brex: false }) });
  add({ id: 'review.brex', label: 'Check BREX', icon: 'brex', keys: ['Shift+F7'], group: 'Review', run: (a, ed) => a.validate(ed!, { live: false, xsd: false, brex: true }) });
  add({ id: 'review.live', label: 'Live validation', icon: 'sync', group: 'Review', global: true, run: (a) => a.toggleSetting('liveValidation'), checked: (a) => a.settings.liveValidation });
  add({ id: 'review.brexLibrary', label: 'BREX library…', icon: 'upload', group: 'Review', global: true, run: (a) => a.dialogs.brexLibrary() });
  add({ id: 'review.nextProblem', label: 'Next problem', keys: ['F8'], group: 'Review', run: (a) => a.problems.step(1) });
  add({ id: 'review.prevProblem', label: 'Previous problem', keys: ['Shift+F8'], group: 'Review', run: (a) => a.problems.step(-1) });
  add({ id: 'review.markModify', label: 'Mark as modified', icon: 'changeMark', keys: ['Mod+Shift+M'], group: 'Review', run: (_, ed) => ed!.markChange('modify'), enabled: editable });
  add({ id: 'review.markAdd', label: 'Mark as added', icon: 'plus', group: 'Review', run: (_, ed) => ed!.markChange('add'), enabled: editable });
  add({ id: 'review.markDelete', label: 'Mark as deleted', icon: 'minus', group: 'Review', run: (_, ed) => ed!.markChange('delete'), enabled: editable });
  add({ id: 'review.markClear', label: 'Clear change mark', icon: 'clear', group: 'Review', run: (_, ed) => ed!.markChange(null), enabled: editable });
  add({ id: 'review.clearAllMarks', label: 'Clear all change marks', icon: 'clear', group: 'Review', run: (_, ed) => ed!.clearAllChangeMarks(), enabled: editable });

  // ---------------------------------------------------------------- View
  const view = (id: string, label: string, icon: string, mode: 'design' | 'tags' | 'split' | 'xml', key: string) =>
    add({ id, label, icon, keys: [key], group: 'View', run: (_, ed) => void ed!.setMode(mode), checked: (_, ed) => ed?.mode === mode });
  view('view.design', 'Design view', 'design', 'design', 'Alt+1');
  view('view.tags', 'Tags view', 'tags', 'tags', 'Alt+2');
  view('view.split', 'Split view', 'split', 'split', 'Alt+3');
  view('view.xml', 'XML view', 'xml', 'xml', 'Alt+4');
  add({ id: 'view.outline', label: 'Navigation pane', icon: 'outline', group: 'View', global: true, run: (a) => a.togglePane('left'), checked: (a) => a.layout.left });
  add({ id: 'view.props', label: 'Properties pane', icon: 'props', group: 'View', global: true, run: (a) => a.togglePane('right'), checked: (a) => a.layout.right });
  add({ id: 'view.problems', label: 'Problems pane', icon: 'problems', group: 'View', global: true, run: (a) => a.togglePane('bottom'), checked: (a) => a.layout.bottom });
  add({ id: 'view.zoomIn', label: 'Zoom in', icon: 'zoomIn', keys: ['Mod+Alt+='], group: 'View', global: true, run: (a) => a.zoom(0.1) });
  add({ id: 'view.zoomOut', label: 'Zoom out', icon: 'zoomOut', keys: ['Mod+Alt+-'], group: 'View', global: true, run: (a) => a.zoom(-0.1) });
  add({ id: 'view.zoomReset', label: 'Zoom 100%', group: 'View', keys: ['Mod+Alt+0'], global: true, run: (a) => a.zoom(0) });
  // WP-21 (UX-002, UX-012): fold the ribbon to its tabs; the platform's focus mode (only offered inside the platform, which owns it)
  add({ id: 'view.ribbon', label: 'Collapse the ribbon', icon: 'collapse', keys: ['Mod+F1'], group: 'View', global: true, run: (a) => a.toggleRibbon(), checked: (a) => a.ribbonCollapsed });
  add({ id: 'view.focus', label: 'Focus mode', icon: 'design', keys: ['Mod+.'], group: 'View', global: true, run: (a) => a.host?.toggleFocus?.(), checked: (a) => !!a.host?.isFocus?.(), enabled: (a) => !!a.host?.toggleFocus });
  add({ id: 'view.theme', label: 'Dark theme', icon: 'theme', group: 'View', global: true, run: (a) => a.toggleTheme(), checked: (a) => a.isDark() });
  add({ id: 'view.sync', label: 'Synchronise selection (Split)', icon: 'sync', group: 'View', global: true, run: (a) => a.toggleSetting('syncSelection'), checked: (a) => a.settings.syncSelection });
  add({ id: 'view.splitTags', label: 'Show tags in Split view', icon: 'tags', group: 'View', global: true, run: (a) => { a.toggleSetting('splitTags'); a.editors.forEach((e) => { if (e.mode === 'split') { e.mode = 'design'; e.setMode('split'); } }); }, checked: (a) => a.settings.splitTags });
  add({ id: 'view.identToggle', label: 'Collapse identification section', icon: 'collapse', group: 'View', run: (_, ed) => { ed!.design.identCollapsed = !ed!.design.identCollapsed; ed!.design.invalidate(); }, checked: (_, ed) => !!ed?.design.identCollapsed });

  // ---------------------------------------------------------------- Tools
  add({ id: 'tools.dmProps', label: 'Data module properties…', icon: 'props2', keys: ['Mod+Alt+I'], group: 'Tools', run: (a, ed) => a.dialogs.dmProperties(ed!), enabled: editable });
  add({ id: 'tools.entities', label: 'Declare ICN entities', icon: 'figure', group: 'Tools', run: (a, ed) => { const n = ed!.declareMissingEntities(); a.toast(n ? `Declared ${n} ICN entit${n === 1 ? 'y' : 'ies'} in the DOCTYPE` : 'All ICN entities are already declared', 'info'); }, enabled: editable });
  add({ id: 'tools.images', label: 'Linked images…', icon: 'image', group: 'Tools', global: true, run: (a) => a.dialogs.images() });
  add({ id: 'tools.ids', label: 'Generate missing IDs', icon: 'id', group: 'Tools', run: (a, ed) => { const n = ed!.generateIds(); a.toast(n ? `Generated ${n} ID${n === 1 ? '' : 's'}` : 'All referenceable elements already have IDs', 'info'); }, enabled: editable });
  add({ id: 'tools.settings', label: 'Settings…', icon: 'settings', keys: ['Mod+,'], group: 'Tools', global: true, run: (a) => a.dialogs.settings() });
  add({ id: 'tools.shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', keys: ['F1'], group: 'Tools', global: true, run: (a) => a.dialogs.shortcuts() });
  add({ id: 'tools.palette', label: 'Command palette…', icon: 'palette', keys: ['Mod+Shift+P', 'Mod+K'], group: 'Tools', global: true, run: (a) => a.dialogs.palette() });
  add({ id: 'tools.about', label: 'About S1000D Studio', icon: 'info', group: 'Tools', global: true, run: (a) => a.dialogs.about() });
  return c;
}

function isNested(el: Element): boolean {
  if (el.nodeName === 'listItem') return el.parentNode?.parentNode?.parentNode?.nodeName === 'listItem';
  return el.parentNode?.nodeName === el.nodeName;
}

export interface RibbonGroup {
  label: string;
  items: (string | { menu: string; label: string; icon: string; items: string[] })[];
  large?: string[];
}

export interface RibbonTab {
  id: string;
  label: string;
  contextual?: (app: App, ed: DocumentEditor | null) => boolean;
  groups: RibbonGroup[];
}

export const RIBBON: RibbonTab[] = [
  {
    id: 'home',
    label: 'Home',
    groups: [
      { label: 'Clipboard', items: ['edit.paste', 'edit.cut', 'edit.copy'], large: ['edit.paste'] },
      { label: 'History', items: ['edit.undo', 'edit.redo'] },
      { label: 'Text', items: ['format.bold', 'format.italic', 'format.underline', 'format.subscript', 'format.superscript'] },
      { label: 'Paragraph', items: ['insert.randomList', 'insert.sequentialList', 'struct.demote', 'struct.promote', 'struct.moveUp', 'struct.moveDown'] },
      { label: 'Structure', items: ['struct.insert', 'struct.wrap', 'struct.change', 'struct.removeTag', 'struct.delete', 'struct.selectParent'] },
      { label: 'Editing', items: ['edit.find', 'edit.replace', 'edit.gotoId'] },
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    groups: [
      { label: 'Sections', items: ['insert.levelledPara', 'insert.subLevelledPara', 'insert.para', 'insert.step', 'insert.substep'], large: ['insert.levelledPara'] },
      { label: 'Safety', items: ['insert.warning', 'insert.caution', 'insert.note'], large: ['insert.warning', 'insert.caution', 'insert.note'] },
      { label: 'Objects', items: ['insert.table', 'insert.figure', 'insert.randomList', 'insert.sequentialList', 'insert.definitionList'], large: ['insert.table', 'insert.figure'] },
      { label: 'References', items: ['insert.internalRef', 'insert.dmRef', 'insert.externalPubRef'], large: ['insert.internalRef', 'insert.dmRef'] },
      { label: 'Inline', items: ['insert.acronym', 'insert.specialChar'] },
    ],
  },
  {
    id: 'table',
    label: 'Table',
    contextual: (a, ed) => !!ed && !!T.tableOf(ed.elementSelection ?? ed.currentPos().node),
    groups: [
      { label: 'Rows & columns', items: ['table.rowAbove', 'table.rowBelow', 'table.colLeft', 'table.colRight', 'table.deleteRow', 'table.deleteCol'] },
      { label: 'Merge', items: ['table.mergeRight', 'table.mergeDown', 'table.split'] },
      { label: 'Cell alignment', items: ['table.alignLeft', 'table.alignCenter', 'table.alignRight', 'table.alignJustify', 'table.valignTop', 'table.valignMiddle', 'table.valignBottom'] },
      { label: 'Table', items: ['table.header', 'table.properties', 'table.delete'] },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    groups: [
      { label: 'Validation', items: ['review.validate', 'review.xsd', 'review.brex', 'review.live'], large: ['review.validate'] },
      { label: 'Business rules', items: ['review.brexLibrary'], large: ['review.brexLibrary'] },
      { label: 'Change marks', items: ['review.markModify', 'review.markAdd', 'review.markDelete', 'review.markClear', 'review.clearAllMarks'] },
      { label: 'Problems', items: ['review.prevProblem', 'review.nextProblem'] },
    ],
  },
  {
    id: 'view',
    label: 'View',
    groups: [
      { label: 'Views', items: ['view.design', 'view.tags', 'view.split', 'view.xml'], large: ['view.design', 'view.tags', 'view.split', 'view.xml'] },
      { label: 'Panes', items: ['view.outline', 'view.props', 'view.problems'] },
      { label: 'Options', items: ['view.sync', 'view.splitTags', 'view.identToggle', 'view.theme'] },
      { label: 'Zoom', items: ['view.zoomOut', 'view.zoomReset', 'view.zoomIn'] },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    groups: [
      { label: 'Data module', items: ['tools.dmProps', 'tools.entities', 'tools.ids'], large: ['tools.dmProps'] },
      { label: 'Resources', items: ['tools.images', 'review.brexLibrary'] },
      { label: 'Application', items: ['tools.settings', 'tools.shortcuts', 'tools.palette', 'tools.about'] },
    ],
  },
];

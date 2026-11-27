// The JSS editor: a WYSIWYG page for a JSS document, independent of the S1000D Studio.
//
//   model (model.ts)  <->  the sheet drawn in the stencil's measurements  <->  the XML (xml.ts), which the host saves as the project's source of truth
//
// The author edits on the sheet. Typing is read back into the model as it happens (inline.ts); structural changes (a new section, a table, a list item
// moved) change the model through ops.ts and the sheet is drawn again. Undo and redo are whole-document snapshots of the XML, so they can never disagree
// with what is saved. Most stencils fix a document's chapters, so chapters are shown but cannot be added, renamed, moved or removed; a type whose chapters are the author's
// (the Part IV volumes of the Naval technical manual: one chapter for each system or sub-system) gets those controls, and a type that also fixes its sections locks them.

import {
  META_FIELDS, chapterFromOutline, inlineText, isNotice, isSection, newChapter, newFigure, newId, newList, newNotice, newSection, newTable, para as newPara, tableFromTemplate, templateColumns,
  type Align, type Block, type Cell, type Chapter, type Figure, type Inline, type JssDoc, type List, type ListItem, type ListType, type NoticeKind, type Orientation, type OutlineNode, type Para, type Part, type Section, type Table, type TableTemplate,
} from './model';
import { parseJss, serializeJss } from './xml';
import { effectiveListType, itemLabel, numberDocument, type Numbers } from './numbering';
import * as ops from './ops';
import { renderInline, readInline, mergeMarks, XREF_CLASS } from './inline';
import { ask, atEnd, atStart, caretOffset, confirmDialog, field, h, openMenu, placeCaret, selection, takeAfterCaret, type MenuItem } from './dom';
import { ensureStyles } from './style';

export interface GraphicInfo { src: string; name: string; url: string }
export interface Finding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }

export interface EditorHost {
  graphics(): Promise<GraphicInfo[]>;
  uploadGraphic(file: File): Promise<GraphicInfo>;
  /** Where the editor can load a graphic from, given its `src` in the document. */
  imageUrl(src: string): string;
  onDirty(dirty: boolean): void;
  onSaveRequested(): void;
  onCheckRequested(): void;
  notify(message: string, kind?: 'info' | 'error'): void;
}

export interface EditorOptions {
  doc: JssDoc; maxDepth: number; readOnly: boolean; host: EditorHost;
  /** 'free': the chapters are the author's (add, rename, move, delete). Anything else: the stencil fixes them. */
  chapterRule?: 'fixed' | 'free';
  /** The stencil fixes the sections under each chapter too: they cannot be added, renamed, moved or deleted. */
  sectionsFixed?: boolean;
  /** The tables the stencil fixes, offered when a table is inserted. */
  tableTemplates?: TableTemplate[];
  /** What a new chapter starts from (its sections and the stencil tables under them), for a type with free chapters. */
  chapterStarter?: OutlineNode | null;
  /** The text shown beside a section's heading (its document code) - only the sections that are data modules of the package, and only when this returns text. `chapter` is 0 for a section below the top level. */
  sectionBadge?: (s: Section, chapter: number) => string | null;
}

type Children = Array<Block | Section>;
interface Bind { kind: 'inline' | 'plain'; sync(): void }
interface ItemRef { list: List; item: ListItem; depth: number; parentItem: ListItem | null; parentList: List | null }
interface CellRef { table: Table; group: 'head' | 'body'; row: number; col: number; cell: Cell }

const ALIGNS: Array<[Align | undefined, string]> = [[undefined, 'Justified (default)'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
const NOTICE_LABEL: Record<NoticeKind, string> = { note: 'NOTE', warning: 'WARNING', caution: 'CAUTION' };

export class JssEditor {
  private doc: JssDoc;
  private numbers: Numbers;
  private readonly opts: EditorOptions;
  private readonly root: HTMLElement;
  private toolbar!: HTMLElement; private outlineEl!: HTMLElement; private scrollEl!: HTMLElement; private paper!: HTMLElement; private problemsEl!: HTMLDetailsElement; private sourceEl!: HTMLElement; private mainEl!: HTMLElement;
  private readonly nodeEl = new Map<object, HTMLElement>();
  private readonly elNode = new WeakMap<Element, object>();
  private readonly binds = new WeakMap<HTMLElement, Bind>();
  private readonly itemRefs = new WeakMap<Element, ItemRef>();
  private readonly cellRefs = new WeakMap<Element, CellRef>();
  private labelFns: Array<() => void> = [];
  private undoStack: string[] = []; private redoStack: string[] = [];
  private typingAt = 0; private dirty = false; private findings: Finding[] = [];
  private lastBlock: Block | null = null; private lastSection: Section | Chapter | null = null;
  private view: 'edit' | 'source' = 'edit';
  private labelTimer: ReturnType<typeof setTimeout> | undefined;
  private savedRange: Range | null = null;
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly onSelChange = () => this.selectionChanged();
  private fit: ResizeObserver | null = null;

  constructor(container: HTMLElement, opts: EditorOptions) {
    ensureStyles();
    this.opts = opts; this.doc = opts.doc; this.numbers = numberDocument(this.doc);
    this.root = h('div', { class: `jss-root${opts.readOnly ? ' jss-ro' : ''}`, 'data-testid': 'jss-editor', tabindex: -1, style: 'outline:none' });
    container.append(this.root);
    this.buildChrome();
    this.renderAll();
    document.addEventListener('selectionchange', this.onSelChange);
    if (opts.doc.reordered) {
      // the file listed content after a sub-section; the PDF prints it before, so that is where the sheet shows it. Saving writes it in that order.
      this.dirty = true; opts.host.onDirty(true);
      opts.host.notify('This document had content after a sub-section. The PDF prints a section’s own content before its sub-sections, so it is shown there. Save to write the file in that order.');
    }
  }

  // ── public surface ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

  getDoc(): JssDoc { return this.doc; }
  getXml(): string { return serializeJss(this.doc); }
  isDirty(): boolean { return this.dirty; }
  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  /** The document has been saved: it is no longer unsaved. */
  markSaved(): void { this.dirty = false; this.opts.host.onDirty(false); }

  /** Replace the whole document (after a reload from the server). History is cleared. */
  setDocument(doc: JssDoc): void { this.doc = doc; this.undoStack = []; this.redoStack = []; this.dirty = false; this.renderAll(); this.opts.host.onDirty(false); this.updateToolbar(); }

  /** Put back a recovered draft (FE-006 / PUB-023): the document is replaced and counts as unsaved until it is saved. */
  restoreDocument(doc: JssDoc): void { this.setDocument(doc); this.dirty = true; this.opts.host.onDirty(true); }

  /** Show (or stop showing) a code beside each section's heading; the document itself is not touched. */
  setSectionBadge(fn: EditorOptions['sectionBadge'] | undefined): void { this.opts.sectionBadge = fn; this.refreshLabels(); }
  /** The chapter a top-level section belongs to; 0 for a section lower down. */
  private chapterNumberOf(s: Section): number { for (const ch of this.doc.chapters) if (ch.children.includes(s)) return ch.number; return 0; }

  setFindings(findings: Finding[]): void { this.findings = findings; this.applyFindingMarks(); this.renderProblems(); this.markOutline(); }

  destroy(): void { document.removeEventListener('selectionchange', this.onSelChange); this.fit?.disconnect(); clearTimeout(this.labelTimer); this.root.remove(); }

  /** Scroll to and flash what a finding is about. */
  goTo(location: string): void {
    const n = this.resolveLocation(location); if (!n) return;
    this.setView('edit'); this.scrollToNode(n);
  }

  /**
   * Scroll to and flash a data module by the key the server gives it ("id:<element id>", or "t:<chapter>:<title>" for a section without an id), the way the Publication and
   * Explore pages open the editor at a row. A chapter's own introduction ("(introduction)" in its key) opens its chapter. Returns false when nothing matches.
   */
  goToModule(key: string): boolean {
    const norm = (t: string): string => t.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    let node: object | null = null;
    if (key.startsWith('id:')) node = this.nodeById(key.slice(3));
    else { const m = /^t:(\d+):(.*?)(?:#\d+)?$/.exec(key); if (m) {
      const ch = this.doc.chapters[Number(m[1]) - 1]; const title = m[2].replace(/ \(introduction\)$/, '');
      node = ch ? (ch.children.filter(isSection).find((s) => norm(s.title) === title) ?? (norm(ch.title) === title ? ch : null)) : null;
    } }
    if (!node) return false;
    this.setView('edit'); this.scrollToNode(node); return true;
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(serializeJss(this.doc)); this.restore(this.undoStack.pop() as string);
  }
  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(serializeJss(this.doc)); this.restore(this.redoStack.pop() as string);
  }
  private restore(xml: string): void {
    const top = this.scrollEl.scrollTop; this.doc = parseJss(xml); this.renderAll(); this.scrollEl.scrollTop = top; this.setDirty(true); this.updateToolbar();
    this.root.focus({ preventScroll: true });                    // the sheet was redrawn: keep the keyboard (Ctrl+Z, Ctrl+Y, Ctrl+S) inside the editor
  }

  // ── chrome ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private buildChrome(): void {
    this.toolbar = h('div', { class: 'jss-toolbar', role: 'toolbar', 'aria-label': 'Formatting and insertion' });
    this.outlineEl = h('nav', { class: 'jss-outline', 'aria-label': 'Document outline' });
    this.paper = h('div', { class: 'jss-paper', 'data-testid': 'jss-paper' });
    this.sourceEl = h('pre', { class: 'jss-source', 'data-testid': 'jss-source', hidden: true });
    this.scrollEl = h('div', { class: 'jss-scroll' }, this.paper);
    this.mainEl = h('div', { class: 'jss-main' }, this.outlineEl, this.scrollEl, this.sourceEl);
    this.problemsEl = h('details', { class: 'jss-problems', 'data-testid': 'jss-problems' }) as HTMLDetailsElement;
    this.root.append(this.toolbar, this.mainEl, this.problemsEl);
    this.buildToolbar();
    this.sourceEl.hidden = true;
    // the sheet is 210 mm wide: in a narrower pane it is scaled down to fit rather than scrolled sideways
    if (typeof ResizeObserver !== 'undefined') {
      this.fit = new ResizeObserver(() => { const avail = this.scrollEl.clientWidth - 32; const full = 210 * 3.7795; const z = avail > 0 && avail < full ? avail / full : 1; (this.paper.style as CSSStyleDeclaration & { zoom: string }).zoom = z === 1 ? '' : String(z.toFixed(3)); });
      this.fit.observe(this.scrollEl);
    }

    const p = this.paper;
    p.addEventListener('input', (e) => this.onInput(e));
    p.addEventListener('beforeinput', () => { if (Date.now() - this.typingAt > 1200) this.pushHistory(); this.typingAt = Date.now(); });
    p.addEventListener('keydown', (e) => this.onKeyDown(e));
    p.addEventListener('paste', (e) => this.onPaste(e));
    p.addEventListener('focusin', (e) => this.onFocusIn(e));
    p.addEventListener('click', (e) => { const x = (e.target as HTMLElement).closest(`.${XREF_CLASS}`); if (x) { const id = x.getAttribute('data-to'); const n = id ? this.nodeById(id) : null; if (n) this.scrollToNode(n); } });
    this.root.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.opts.host.onSaveRequested(); }
      else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    });
  }

  private buildToolbar(): void {
    const ro = this.opts.readOnly;
    // The tools are sorted into tabs by what the author is doing: write, insert, arrange, or look after the document. Every button stays in the page
    // (a tab only hides its panel), so keyboard shortcuts and tests reach them whichever tab is open.
    const tabs: Array<{ id: string; label: string; panel: HTMLElement; tab: HTMLButtonElement }> = [];
    const strip = h('div', { class: 'jss-tabs', role: 'tablist', 'aria-label': 'Toolbar sections' });
    const panels = h('div', { class: 'jss-panels' });
    this.toolbar.append(strip, panels);
    const pick = (id: string) => { for (const t of tabs) { const on = t.id === id; t.panel.hidden = !on; t.tab.classList.toggle('on', on); t.tab.setAttribute('aria-selected', String(on)); } try { localStorage.setItem('agastya.jss.tab', id); } catch { /* private mode */ } };
    const tab = (id: string, label: string): HTMLElement => {
      const panel = h('div', { class: 'jss-panel', role: 'tabpanel', 'aria-label': label });
      const t = h('button', { class: 'jss-tab', type: 'button', role: 'tab', 'data-tab': id, on: { click: () => pick(id) } }, label) as HTMLButtonElement;
      tabs.push({ id, label, panel, tab: t }); strip.append(t); panels.append(panel); return panel;
    };
    let current: HTMLElement = this.toolbar;
    const group = (label: string, ...btns: HTMLElement[]) => current.append(h('div', { class: 'jss-tgroup', role: 'group', 'aria-label': label }, h('div', { class: 'jss-tbtns' }, ...btns), h('span', { class: 'jss-tlabel' }, label)));
    const btn = (id: string, label: string | Node, title: string, run: (b: HTMLButtonElement) => void, writes = true): HTMLButtonElement => {
      const b = h('button', { class: 'jss-tb', type: 'button', title, 'aria-label': title, 'data-cmd': id, disabled: ro && writes }, label as string);
      b.addEventListener('mousedown', (e) => e.preventDefault());                 // keep the caret where it is
      b.addEventListener('click', () => run(b));
      this.toolButtons.set(id, b); return b;
    };

    // Undo and Redo are always in reach, left of the tabs.
    strip.prepend(h('div', { class: 'jss-quick' }, btn('undo', 'Undo', 'Undo (Ctrl+Z)', () => this.undo()), btn('redo', 'Redo', 'Redo (Ctrl+Y)', () => this.redo())));

    current = tab('write', 'Write');
    group('Text style',
      btn('bold', h('b', {}, 'B'), 'Bold (Ctrl+B)', () => this.format('bold')), btn('italic', h('i', {}, 'I'), 'Italic (Ctrl+I)', () => this.format('italic')),
      btn('underline', h('u', {}, 'U'), 'Underline (Ctrl+U)', () => this.format('underline')),
      btn('sup', 'x²', 'Superscript', () => this.format('superscript')), btn('sub', 'x₂', 'Subscript', () => this.format('subscript')));
    group('Paragraph',
      btn('align', 'Align ▾', 'Paragraph alignment', (b) => openMenu(b, ALIGNS.map(([a, label]) => ({ label, run: () => this.setAlign(a) })))),
      btn('noindent', 'No indent', 'Start this paragraph flush with the margin (switch on or off)', () => this.toggleNoIndent()),
      btn('linebreak', 'Line break', 'Break the line here without starting a new paragraph (Shift+Enter)', () => this.lineBreak()));
    group('List',
      btn('nest', 'Nest ▸', 'Make this list item a sub-item of the item above, a list inside a list (Tab)', () => this.nestItem(false)),
      btn('unnest', '◂ Un-nest', 'Move this sub-item back out one level (Shift+Tab)', () => this.nestItem(true)));
    group('Links',
      btn('xref', 'Cross-reference…', 'Refer to a table, figure or section', () => void this.insertXrefDialog()),
      btn('link', 'Link…', 'Link to a web address', () => void this.insertLinkDialog()));

    current = tab('insert', 'Insert');
    group('Text',
      btn('para', 'Paragraph', 'Add a paragraph after the current block', () => this.insertBlock(newPara())),
      btn('section', 'Section ▾', 'Add a section', (b) => openMenu(b, this.sectionMenu())),
      btn('list', 'List ▾', 'Add or change a list', (b) => openMenu(b, this.listMenu())));
    group('Objects',
      btn('table', 'Table…', 'Insert a table', () => void this.insertTableDialog()),
      btn('figure', 'Figure…', 'Insert a picture with a caption', () => void this.insertFigureDialog()),
      btn('notice', 'Notice ▾', 'Insert a note, warning or caution', (b) => openMenu(b, (['note', 'warning', 'caution'] as NoticeKind[]).map((k) => ({ label: NOTICE_LABEL[k][0] + NOTICE_LABEL[k].slice(1).toLowerCase(), run: () => this.insertBlock(newNotice(k)) })))));
    group('Page',
      btn('pagebreak', 'Page break', 'Start a new page here', () => this.insertBlock({ k: 'pageBreak' })));

    current = tab('arrange', 'Arrange');
    group('Move the current block',
      btn('up', 'Move up', 'Move the current block up', () => this.moveBlock(-1)), btn('down', 'Move down', 'Move the current block down', () => this.moveBlock(1)));
    group('Heading level',
      btn('demote', 'Demote ▸', 'Make the current heading one level lower (a sub-heading of the heading above it)', () => this.changeLevel(1)),
      btn('promote', '◂ Promote', 'Make the current heading one level higher', () => this.changeLevel(-1)));
    group('Remove',
      btn('delete', 'Delete block', 'Delete the current block', () => void this.deleteBlock()));
    current.append(h('span', { class: 'jss-thint' }, 'Sections have their own move, indent and page-orientation controls beside their heading; tables and figures show theirs when you click inside them.'));

    current = tab('document', 'Document');
    group('Document',
      btn('details', 'Document details…', 'Title, system name, Code No., Rev No. and the other details printed on the cover', () => void this.detailsDialog()),
      btn('check', 'Check', 'Check the document against the schema and the stencil', () => this.opts.host.onCheckRequested(), false));
    group('View',
      btn('outline', 'Outline', 'Show or hide the outline on the left', () => { this.outlineEl.hidden = !this.outlineEl.hidden; this.toolButtons.get('outline')?.classList.toggle('on', !this.outlineEl.hidden); }, false),
      btn('source', 'XML', 'Show the XML that will be saved', () => this.setView(this.view === 'edit' ? 'source' : 'edit'), false));
    this.toolButtons.get('outline')?.classList.add('on');

    let saved: string | null = null; try { saved = localStorage.getItem('agastya.jss.tab'); } catch { /* private mode */ }
    pick(tabs.some((t) => t.id === saved) ? (saved as string) : 'write');
    this.updateToolbar();
  }

  /** Move the heading the caret is in one level down (inside the heading above) or up. The stencil allows `maxDepth` levels, the chapter being level 1. */
  private changeLevel(dir: 1 | -1): void {
    const cur = this.activeSection();
    if (cur.k === 'chapter') return this.opts.host.notify('Click in a section heading first: chapters are fixed by the stencil.');
    const s = cur as Section; const level = ops.headingLevel(this.doc, s);
    if (dir === 1) {
      if (!ops.canIndentSection(this.doc, s, this.opts.maxDepth)) return this.opts.host.notify(level >= this.opts.maxDepth ? `Heading level ${this.opts.maxDepth} is the deepest this document type has.` : 'A heading needs a heading above it, at the same level, to go under.');
      this.mutate(() => ops.indentSection(this.doc, s, this.opts.maxDepth), () => s);
    } else {
      if (!ops.canOutdentSection(this.doc, s)) return this.opts.host.notify('This heading is already at the top level of its chapter.');
      this.mutate(() => ops.outdentSection(this.doc, s), () => s);
    }
  }

  /** The list item under the caret, if any. */
  private itemUnderCaret(): ItemRef | null {
    const sel = selection(); const n = sel?.anchorNode; const li = n && (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('.jss-li');
    return (li && this.itemRefs.get(li)) || null;
  }

  /** Nest the item under the caret inside the item above it (a list inside a list), or bring a nested item back out. The same as Tab and Shift+Tab. */
  private nestItem(out: boolean): void {
    const ref = this.itemUnderCaret(); if (!ref) return this.opts.host.notify('Click in a list item first.');
    const target = ref.item; const idx = ref.list.items.indexOf(target);
    if (!out) {
      if (idx < 1) return this.opts.host.notify('The first item has no item above it to go under. Add an item first, then nest the second one.');
      this.mutate(() => ops.indentItem(ref.list, idx), () => target); return;
    }
    if (!ref.parentList || !ref.parentItem) return this.opts.host.notify('This item is not nested.');
    const parentList = ref.parentList; const pi = parentList.items.indexOf(ref.parentItem);
    this.mutate(() => ops.outdentItem(parentList, pi, ref.list, idx), () => target);
  }

  /** A new list at the caret: after the paragraph when the caret is in a notice (the list then belongs to the notice), else after the current block. */
  private insertListHere(type: ListType): void {
    const sel = selection(); const el = this.editableOf(sel?.anchorNode ?? null); const node = el && this.elNode.get(el);
    const inNotice = node ? ops.locateInNotice(this.doc, node) : null;
    if (inNotice) { const l = newList(type, 1); this.mutate(() => ops.insertAt(inNotice.list, inNotice.index + 1, l), () => l); return; }
    this.insertBlock(newList(type, 1));
  }

  /** Switch the "no first-line indent" setting of the paragraph under the caret. */
  private toggleNoIndent(): void {
    const sel = selection(); const el = this.editableOf(sel?.anchorNode ?? null); const p = el && (this.elNode.get(el) as Para | undefined);
    if (!p || p.k !== 'para') return this.opts.host.notify('Click in a paragraph first.');
    this.mutate(() => { p.indentNone = p.indentNone ? undefined : true; }, () => p);
  }

  /** A line break inside the paragraph (what Shift+Enter does), for authors who do not know the shortcut. */
  private lineBreak(): void {
    const sel = selection(); const el = this.editableOf(sel?.anchorNode ?? null); const bind = el && this.binds.get(el);
    if (!el || !bind || bind.kind === 'plain') return this.opts.host.notify('Click in the text where the line should break.');
    document.execCommand('insertLineBreak'); bind.sync(); this.setDirty(true);
  }

  private updateToolbar(): void {
    const set = (id: string, on: boolean) => this.toolButtons.get(id)?.classList.toggle('on', on);
    const dis = (id: string, d: boolean) => { const b = this.toolButtons.get(id); if (b) b.disabled = d || (this.opts.readOnly && !['check', 'source'].includes(id)); };
    dis('undo', !this.undoStack.length); dis('redo', !this.redoStack.length);
    const editing = this.view === 'edit';
    for (const id of ['bold', 'italic', 'underline', 'sup', 'sub', 'align', 'noindent', 'linebreak', 'nest', 'unnest', 'demote', 'promote', 'para', 'section', 'list', 'table', 'figure', 'notice', 'pagebreak', 'xref', 'link', 'up', 'down', 'delete', 'details']) dis(id, !editing);
    if (typeof document.queryCommandState === 'function' && editing) {
      const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
      set('bold', q('bold')); set('italic', q('italic')); set('underline', q('underline')); set('sup', q('superscript')); set('sub', q('subscript'));
    }
  }

  private setView(v: 'edit' | 'source'): void {
    this.view = v;
    this.scrollEl.hidden = v === 'source'; this.outlineEl.hidden = v === 'source' || !this.toolButtons.get('outline')?.classList.contains('on'); this.sourceEl.hidden = v === 'edit';
    if (v === 'source') this.sourceEl.textContent = this.getXml();
    this.toolButtons.get('source')?.classList.toggle('on', v === 'source');
    this.updateToolbar();
  }

  // ── drawing the sheet ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private renderAll(): void {
    this.numbers = numberDocument(this.doc);
    this.nodeEl.clear(); this.labelFns = [];
    this.paper.textContent = '';
    for (const ch of this.doc.chapters) this.paper.append(this.chapterEl(ch));
    if (this.opts.chapterRule === 'free' && !this.opts.readOnly) {
      this.paper.append(h('button', { type: 'button', class: 'jss-addch', 'data-testid': 'jss-add-chapter', title: 'Add a chapter for another system or sub-system', on: { mousedown: (e: Event) => e.preventDefault(), click: () => this.addChapter() } }, '+ Add a chapter'));
    }
    this.renderOutline(); this.applyFindingMarks(); this.markOutline();
    if (this.view === 'source') this.sourceEl.textContent = this.getXml();
  }

  private reg<T extends HTMLElement>(node: object, el: T): T { this.nodeEl.set(node, el); this.elNode.set(el, node); return el; }

  private chapterEl(ch: Chapter): HTMLElement {
    const el = this.reg(ch, h('section', { class: 'jss-chapter', 'data-kind': 'chapter' }));
    const free = this.opts.chapterRule === 'free';
    const page = ch.orientation === 'a3-landscape' ? 'A3 landscape pages' : ch.orientation === 'landscape' ? 'landscape pages' : '';
    const title = h('div', { class: 'jss-ch-title', ...(free ? { 'data-ph': 'Name of the system or sub-system' } : { title: 'The stencil fixes the chapters of this publication, so their titles cannot be changed here' }) });
    if (free) this.plainEditable(title, () => ch.title, (v) => { ch.title = v; });
    else title.append(ch.title, h('span', { class: 'jss-ch-lock' }, 'fixed by the stencil'));
    el.append(
      this.chapterTools(ch),
      h('div', { class: 'jss-ch-no' }, `Chapter ${ch.number}`, ...(page ? [h('span', { class: 'jss-ch-lock', title: 'The stencil sets this chapter on a page of its own size' }, `printed on ${page}`)] : [])),
      title,
    );
    this.appendChildren(el, el, ch.children, ch, 1);
    return el;
  }

  /** Move, add after and delete, for a type whose chapters are the author's. */
  private chapterTools(ch: Chapter): HTMLElement {
    if (this.opts.readOnly || this.opts.chapterRule !== 'free') return h('span');
    const i = this.doc.chapters.indexOf(ch); const last = this.doc.chapters.length - 1;
    const mk = (label: string, title: string, run: () => void, ok: boolean) => h('button', { type: 'button', title, 'aria-label': title, disabled: !ok, on: { mousedown: (e: Event) => e.preventDefault(), click: run } }, label);
    return h('div', { class: 'jss-sec-tools jss-ch-tools' },
      mk('↑', 'Move this chapter up', () => this.mutate(() => ops.moveChapter(this.doc, ch, -1), () => ch), i > 0),
      mk('↓', 'Move this chapter down', () => this.mutate(() => ops.moveChapter(this.doc, ch, 1), () => ch), i < last),
      mk('+', 'Add a chapter after this one', () => this.addChapter(ch), true),
      mk('✕', 'Delete this chapter', () => void this.deleteChapter(ch), last > 0));
  }

  /** A new chapter, started from the stencil's first chapter (its sections and tables), on the same page as the others; its title is selected, ready to be typed over. */
  private addChapter(after?: Chapter): void {
    if (this.opts.readOnly || this.opts.chapterRule !== 'free') return;
    const at = after ? this.doc.chapters.indexOf(after) : this.doc.chapters.length - 1; const orientation = this.doc.chapters[0]?.orientation;
    const ch = this.opts.chapterStarter ? chapterFromOutline(this.doc, this.opts.chapterStarter, at + 2, orientation) : newChapter(at + 2, 'New chapter', newId(this.doc, 'c'), orientation);
    this.mutate(() => ops.addChapter(this.doc, ch, at), () => ch);
    const t = this.nodeEl.get(ch)?.querySelector<HTMLElement>('.jss-ch-title');
    if (t) { placeCaret(t, 0); const sel = selection(); if (sel) { const r = document.createRange(); r.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(r); } }
  }

  private async deleteChapter(ch: Chapter): Promise<void> {
    if (this.doc.chapters.length <= 1) return this.opts.host.notify('A publication has at least one chapter.');
    if ((ch.children.length || ch.title.trim()) && !(await confirmDialog('Delete this chapter?', `"${ch.title || 'Untitled'}"${ch.children.length ? ' and everything in it' : ''} will be removed. You can undo this.`))) return;
    this.mutate(() => ops.removeChapter(this.doc, ch), () => null);
  }

  /** A section's own content first (into `bodyEl`), then its sub-sections (into `subsEl`): the order the pipeline prints them in. */
  private appendChildren(bodyEl: HTMLElement, subsEl: HTMLElement, children: Children, owner: Chapter | Section, depth: number): void {
    const blocks = children.filter((c): c is Block => !isSection(c)); const subs = children.filter(isSection);
    for (const b of blocks) bodyEl.append(this.blockEl(b));
    if (!blocks.length && !this.opts.readOnly) {
      bodyEl.append(h('div', { class: 'jss-empty', style: 'color:var(--paper-placeholder);font-size:10pt;cursor:text;margin:0 0 3mm', on: { click: () => this.insertParaInto(owner) } }, 'Click to add text here, or use Insert.'));
    }
    for (const s of subs) subsEl.append(this.sectionEl(s, depth + 1));
  }

  private sectionEl(s: Section, depth: number): HTMLElement {
    const group = h('div', { class: 'jss-secgroup' });
    const sec = this.reg(s, h('div', { class: `jss-sec d${Math.min(depth - 1, 5)}`, 'data-kind': 'section' }));
    const no = h('span', { class: 'jss-sec-no' }); const title = h('div', { class: 'jss-sec-title', 'data-ph': 'Section title' });
    this.plainEditable(title, () => s.title, (v) => { s.title = v; });
    if (this.opts.sectionsFixed) { this.setEditable(title, false); title.title = 'The stencil fixes the sections of this publication, so their titles cannot be changed here'; }
    const bindNo = () => { no.textContent = this.numbers.heading.get(s) ?? ''; }; bindNo(); this.labelFns.push(bindNo);
    // the section's document code (DMC), kept in the backend and shown here only when the author switches it on; it is never part of the document
    const code = h('span', { class: 'jss-sec-code', contenteditable: 'false', title: 'Data module code of this section (kept in the backend, not in the document)' });
    const bindCode = () => { const t = this.opts.sectionBadge?.(s, this.chapterNumberOf(s)) ?? ''; code.textContent = t; code.style.display = t ? '' : 'none'; }; bindCode(); this.labelFns.push(bindCode);
    const bodyEl = h('div', { class: 'jss-sec-body' });
    sec.append(this.sectionTools(s), h('div', { class: 'jss-sec-head' }, no, title, code), bodyEl);
    group.append(sec);
    this.appendChildren(bodyEl, group, s.children, s, depth);
    return group;
  }

  private sectionTools(s: Section): HTMLElement {
    if (this.opts.readOnly || this.opts.sectionsFixed) return h('span');
    const mk = (label: string, title: string, run: () => void, ok: boolean) => { const b = h('button', { type: 'button', title, 'aria-label': title, disabled: !ok, on: { mousedown: (e: Event) => e.preventDefault(), click: run } }, label); return b; };
    const at = ops.locate(this.doc, s); const sibs = at ? at.list.filter(isSection) : []; const si = sibs.indexOf(s);
    const orient = h('select', { title: 'Page orientation of this section', 'aria-label': 'Page orientation' },
      ...(['portrait', 'landscape', 'a3-landscape'] as Orientation[]).map((o) => h('option', { value: o, selected: (s.orientation ?? 'portrait') === o }, o === 'a3-landscape' ? 'A3 landscape' : o[0].toUpperCase() + o.slice(1))));
    orient.addEventListener('change', () => this.mutate(() => { s.orientation = (orient as HTMLSelectElement).value === 'portrait' ? undefined : ((orient as HTMLSelectElement).value as Orientation); }, () => s));
    return h('div', { class: 'jss-sec-tools' },
      mk('↑', 'Move section up', () => this.mutate(() => this.moveSection(s, -1), () => s), si > 0),
      mk('↓', 'Move section down', () => this.mutate(() => this.moveSection(s, 1), () => s), si >= 0 && si < sibs.length - 1),
      mk('→', 'Make this a sub-section of the section above', () => this.mutate(() => ops.indentSection(this.doc, s, this.opts.maxDepth), () => s), ops.canIndentSection(this.doc, s, this.opts.maxDepth)),
      mk('←', 'Move this section up one level', () => this.mutate(() => ops.outdentSection(this.doc, s), () => s), ops.canOutdentSection(this.doc, s)),
      orient,
      mk('✕', 'Delete this section', () => void this.deleteSection(s), true),
    );
  }

  private moveSection(s: Section, dir: -1 | 1): boolean {
    const at = ops.locate(this.doc, s); if (!at) return false;
    let j = at.index + dir; while (j >= 0 && j < at.list.length && !isSection(at.list[j])) j += dir;
    if (j < 0 || j >= at.list.length) return false;
    [at.list[at.index], at.list[j]] = [at.list[j], at.list[at.index]]; return true;
  }

  private blockEl(b: Block): HTMLElement {
    const w = this.reg(b, h('div', { class: `jss-block${b.k === 'table' || b.k === 'note' || b.k === 'warning' || b.k === 'caution' ? ' jss-wide' : ''}`, 'data-kind': b.k }));
    switch (b.k) {
      case 'para': { const p = h('div', { class: 'jss-para', 'data-ph': 'Type here' }); this.paraEditable(p, b); w.append(p); break; }
      case 'list': w.append(this.listEl(b, 1)); break;
      case 'table': w.append(this.tableEl(b)); break;
      case 'figure': w.append(this.figureEl(b)); break;
      case 'pageBreak': w.append(h('div', { class: 'jss-pb' }, h('span', {}, 'page break'))); break;
      default: w.append(this.noticeEl(b));
    }
    return w;
  }

  // editable text -----------------------------------------------------------------------------------------------------------------

  private setEditable(el: HTMLElement, on: boolean): void { el.setAttribute('contenteditable', on && !this.opts.readOnly ? 'true' : 'false'); }

  private inlineEditable(el: HTMLElement, get: () => Inline[], set: (v: Inline[]) => void, ph?: string): void {
    if (ph) el.setAttribute('data-ph', ph);
    renderInline(el, get(), this.numbers.label); this.setEditable(el, true); el.setAttribute('data-edit', 'inline');
    this.binds.set(el, { kind: 'inline', sync: () => set(readInline(el)) });
  }
  private plainEditable(el: HTMLElement, get: () => string, set: (v: string) => void): void {
    el.textContent = get(); this.setEditable(el, true); el.setAttribute('data-edit', 'plain');
    this.binds.set(el, { kind: 'plain', sync: () => set((el.textContent ?? '').replace(/\s+/g, ' ')) });
  }
  private paraEditable(el: HTMLElement, p: Para): void {
    this.inlineEditable(el, () => p.inline, (v) => { p.inline = v; });
    if (p.align) el.setAttribute('data-align', p.align);
    this.elNode.set(el, p); if (!this.nodeEl.has(p)) this.nodeEl.set(p, el);          // a top-level paragraph is already registered through its wrapper
  }

  /** The parts of a list item or table cell. */
  private partsEls(into: HTMLElement, parts: Part[], depth: number, ownerItem: ListItem | null, ownerList: List | null): void {
    for (const part of parts) {
      if (part.k === 'inline') {
        const d = h('div', { class: 'jss-itext' }); this.inlineEditable(d, () => part.inline, (v) => { part.inline = v; }); this.reg(part, d); into.append(d);
      } else if (part.k === 'para') {
        const d = h('div', { class: 'jss-para', style: 'margin-bottom:1.5mm' }); this.paraEditable(d, part); into.append(d);
      } else into.append(this.listEl(part, depth + 1, ownerItem, ownerList));
    }
  }

  private listEl(l: List, depth: number, parentItem: ListItem | null = null, parentList: List | null = null): HTMLElement {
    const type = effectiveListType(l, depth);
    const el = this.reg(l, h('div', { class: 'jss-list', 'data-type': type }));
    l.items.forEach((item, i) => {
      const label = h('span', { class: 'jss-li-label', 'aria-hidden': 'true' }, itemLabel(type, i + 1));
      const body = h('div', { class: 'jss-li-body' });
      const li = this.reg(item, h('div', { class: 'jss-li' }, label, body));
      this.itemRefs.set(li, { list: l, item, depth, parentItem, parentList });
      this.partsEls(body, item.parts, depth, item, l);
      el.append(li);
    });
    return el;
  }

  private tableEl(t: Table): HTMLElement {
    const wrap = h('div', { class: 'jss-tablewrap' });
    wrap.append(this.tableTools(t));
    const cap = h('div', { class: 'jss-cap' }); const no = h('span', { class: 'no' }); const titleEl = h('span', { 'data-ph': 'Table caption' });
    this.plainEditable(titleEl, () => t.title ?? '', (v) => { t.title = v; });
    const bindNo = () => { no.textContent = this.numbers.caption.get(t) ? `${this.numbers.caption.get(t)}: ` : 'Table: '; }; bindNo(); this.labelFns.push(bindNo);
    cap.append(no, titleEl); wrap.append(cap);
    const tbl = h('table', { class: 'jss-table' });
    const widths = this.columnWidths(t); if (widths) tbl.append(h('colgroup', {}, ...widths.map((w) => h('col', { style: `width:${w}` }))));
    const addRows = (group: 'head' | 'body') => {
      const sec = h(group === 'head' ? 'thead' : 'tbody');
      (group === 'head' ? t.head : t.body).forEach((row, r) => {
        const tr = h('tr');
        row.cells.forEach((cell, c) => {
          const td = this.reg(cell, h('td', { ...(cell.colspan ? { colspan: cell.colspan } : {}), ...(cell.rowspan ? { rowspan: cell.rowspan } : {}), ...(cell.align ? { style: `text-align:${cell.align}` } : {}) }));
          this.cellRefs.set(td, { table: t, group, row: r, col: c, cell });
          this.partsEls(td, cell.parts, 0, null, null); tr.append(td);
        });
        sec.append(tr);
      });
      return sec;
    };
    if (t.head.length) tbl.append(addRows('head'));
    tbl.append(addRows('body'));
    wrap.append(tbl);
    return wrap;
  }

  private columnWidths(t: Table): string[] | null {
    if (!t.widths?.trim()) return null;
    const parts = t.widths.trim().split(/\s+/); const page = 170;
    const fixed = parts.map((p) => (p.endsWith('mm') ? parseFloat(p) : 0)); const stars = parts.map((p) => (p.endsWith('*') ? parseFloat(p) : 0));
    const left = Math.max(0, page - fixed.reduce((a, b) => a + b, 0)); const sum = stars.reduce((a, b) => a + b, 0) || 1;
    return parts.map((_, i) => `${(((fixed[i] || (left * stars[i]) / sum) / page) * 100).toFixed(2)}%`);
  }

  private tableTools(t: Table): HTMLElement {
    if (this.opts.readOnly) return h('div');
    const spans = ops.hasSpans(t); const bodySpans = ops.groupHasSpans(t, 'body');
    const mk = (label: string, title: string, run: () => void, enabled = true) => h('button', { type: 'button', title, disabled: !enabled, on: { mousedown: (e: Event) => e.preventDefault(), click: run } }, label);
    const cell = () => this.activeCell(t);
    // a stencil's merged head ("Recommended Nos." over five columns) does not stop rows being added to or removed from the body under it; only the merged part itself is refused
    const rowsOk = (c: CellRef): boolean => { if (!ops.groupHasSpans(t, c.group)) return true; this.opts.host.notify(`This ${c.group === 'head' ? 'header' : 'part of the table'} has merged cells: split them to add or remove rows there${c.group === 'head' ? ', or click in the body to add rows to it' : ''}.`); return false; };
    const row = (where: 'above' | 'below') => { const c = cell(); if (!c) return this.opts.host.notify('Click in a cell first.'); if (!rowsOk(c)) return; this.mutate(() => ops.addRow(t, c.group, c.row, where), () => t); };
    const merge = (dir: 'right' | 'down') => {
      const c = cell(); if (!c) return this.opts.host.notify('Click in a cell first.');
      const why = ops.mergeCheck(t, c.group, c.row, c.col, dir); if (why) return this.opts.host.notify(why);
      this.mutate(() => ops.mergeCells(t, c.group, c.row, c.col, dir), () => t);
    };
    const col = (where: 'before' | 'after') => { const c = cell(); if (!c) return this.opts.host.notify('Click in a cell first.'); this.mutate(() => ops.addColumn(t, c.col, where), () => t); };
    // Text alignment of this cell, its column or the whole table (left, centre, right or justified). "Default" clears it.
    const allCells = (): Cell[] => [...t.head, ...t.body].flatMap((r) => r.cells);
    const setAlign = (scope: 'cell' | 'column' | 'table', a: Align | undefined) => {
      const c = cell();
      if (scope !== 'table' && !c) return this.opts.host.notify('Click in a cell first.');
      const targets = scope === 'table' ? allCells() : scope === 'cell' ? [(c as CellRef).cell] : [...t.head, ...t.body].map((r) => r.cells[(c as CellRef).col]).filter(Boolean);
      this.mutate(() => { for (const x of targets) x.align = a; }, () => t);
    };
    const A: Array<[Align | undefined, string]> = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['justify', 'Justified'], [undefined, 'Default']];
    const alignBtn = mk('Align ▾', 'Align the text of a cell, a column or the whole table', () => openMenu(alignBtn, [
      ...A.map(([a, label]): MenuItem => ({ label: `This cell: ${label}`, run: () => setAlign('cell', a) })),
      ...A.map(([a, label]): MenuItem => ({ label: `This column: ${label}`, run: () => setAlign('column', a), disabled: spans })),
      ...A.map(([a, label]): MenuItem => ({ label: `Whole table: ${label}`, run: () => setAlign('table', a) })),
    ]));
    return h('div', { class: 'jss-ttools' },
      mk('+ Row above', 'Add a row above the current one', () => row('above'), !bodySpans), mk('+ Row below', 'Add a row below the current one', () => row('below'), !bodySpans),
      mk('− Row', 'Delete the current row', () => { const c = cell(); if (c) { if (rowsOk(c)) this.mutate(() => ops.deleteRow(t, c.group, c.row), () => t); } else this.opts.host.notify('Click in a cell first.'); }, !bodySpans),
      mk('+ Column left', 'Add a column to the left of the current one', () => col('before'), !spans), mk('+ Column right', 'Add a column to the right of the current one', () => col('after'), !spans),
      mk('− Column', 'Delete the current column', () => { const c = cell(); if (c) this.mutate(() => ops.deleteColumn(t, c.col), () => t); else this.opts.host.notify('Click in a cell first.'); }, !spans),
      mk(t.head.length ? 'Header row: on' : 'Header row: off', 'Show the first row as a header', () => this.mutate(() => ops.toggleHeader(t), () => t)),
      mk('Merge right', 'Merge this cell with the one to its right', () => merge('right')), mk('Merge down', 'Merge this cell with the one below it', () => merge('down')),
      mk('Split cell', 'Split a merged cell back into single cells', () => { const c = cell(); if (!c) return this.opts.host.notify('Click in a cell first.'); if ((c.cell.colspan ?? 1) === 1 && (c.cell.rowspan ?? 1) === 1) return this.opts.host.notify('This cell is not merged.'); this.mutate(() => ops.splitCell(t, c.group, c.row, c.col), () => t); }),
      alignBtn,
      mk('Equal columns', 'Give every column the same width; the table always fills the full text width', () => this.mutate(() => { t.widths = Array.from({ length: ops.columnCount(t) }, () => '1*').join(' '); }, () => t)),
      mk('Widths…', 'Set the column widths (the table always fills the full text width, so these only divide it)', () => void this.widthsDialog(t)),
      mk('Delete table', 'Delete this table', () => this.removeBlock(t)),
      spans ? h('span', { class: 'hint' }, bodySpans ? 'This table has merged cells: split them to add or remove rows and columns.' : 'The header has merged cells (as the stencil has them): rows can be added to the body; split the header cells to change the columns.') : null,
    );
  }

  private activeCell(t: Table): CellRef | null {
    const sel = selection(); const node = sel?.anchorNode; if (!node) return null;
    const td = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('td'); if (!td) return null;
    const ref = this.cellRefs.get(td); return ref && ref.table === t ? ref : null;
  }

  private figureEl(f: Figure): HTMLElement {
    const el = h('div', { class: 'jss-figure' });
    if (!this.opts.readOnly) {
      const width = h('input', { type: 'text', value: f.graphics[0]?.width ?? '', placeholder: 'width, e.g. 80mm', 'aria-label': 'Picture width' }) as HTMLInputElement;
      width.addEventListener('change', () => {
        const v = width.value.trim();
        if (v && !/^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(v)) { this.opts.host.notify('A width is a number with a unit: 80mm, 8cm, 3in.', 'error'); width.value = f.graphics[0]?.width ?? ''; return; }
        this.mutate(() => { for (const g of f.graphics) g.width = v || undefined; }, () => f);
      });
      el.append(h('div', { class: 'jss-ftools' },
        h('button', { type: 'button', on: { mousedown: (e: Event) => e.preventDefault(), click: () => void this.changePicture(f) } }, 'Change picture…'), width,
        h('button', { type: 'button', on: { mousedown: (e: Event) => e.preventDefault(), click: () => this.mutate(() => { f.legend.push({ num: String(f.legend.length + 1), text: '' }); }, () => f) } }, 'Add key item'),
        h('button', { type: 'button', on: { mousedown: (e: Event) => e.preventDefault(), click: () => this.removeBlock(f) } }, 'Delete figure')));
    }
    for (const g of f.graphics) {
      const box = h('div', { class: 'jss-imgbox' });
      const img = h('img', { src: this.opts.host.imageUrl(g.src), alt: g.src, ...(g.width ? { style: `width:${g.width}` } : {}) });
      img.addEventListener('error', () => { box.textContent = ''; box.append(h('div', { class: 'jss-missing' }, `The picture ${g.src} is not in the project.`)); });
      box.append(img); el.append(box);
    }
    const cap = h('div', { class: 'jss-cap', style: 'margin-top:2mm' }); const no = h('span', { class: 'no' }); const titleEl = h('span', { 'data-ph': 'Figure caption' });
    this.plainEditable(titleEl, () => f.title ?? '', (v) => { f.title = v; });
    const bindNo = () => { no.textContent = this.numbers.caption.get(f) ? `${this.numbers.caption.get(f)}: ` : 'Figure: '; }; bindNo(); this.labelFns.push(bindNo);
    cap.append(no, titleEl); el.append(cap);
    if (f.legend.length) {
      const legend = h('div', { class: 'jss-legend' });
      f.legend.forEach((k, i) => {
        const n = h('b'); const tx = h('span', { style: 'flex:1', 'data-ph': 'Part name' });
        this.plainEditable(n, () => k.num, (v) => { k.num = v; }); this.plainEditable(tx, () => k.text, (v) => { k.text = v; });
        const rm = this.opts.readOnly ? null : h('button', { type: 'button', title: 'Remove this key item', 'aria-label': 'Remove this key item', style: 'border:0;background:none;cursor:pointer;color:var(--paper-error)', on: { mousedown: (e: Event) => e.preventDefault(), click: () => this.mutate(() => { f.legend.splice(i, 1); }, () => f) } }, '✕');
        legend.append(h('div', { class: 'row' }, n, tx, rm)); void i;
      });
      el.append(legend);
    }
    return el;
  }

  private noticeEl(n: Block & { k: NoticeKind; parts: Array<Para | List> }): HTMLElement {
    const el = h('div', { class: `jss-notice ${n.k}` }, h('div', { class: 'band' }, `! ${NOTICE_LABEL[n.k]}`));
    const txt = h('div', { class: 'txt' });
    for (const part of n.parts) {
      if (part.k === 'list') txt.append(this.listEl(part, 1));
      else { const d = h('div', { class: 'jss-para' }); this.paraEditable(d, part); txt.append(d); }
    }
    el.append(txt); return el;
  }

  // ── the outline ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private renderOutline(): void {
    this.outlineEl.textContent = '';
    this.outlineEl.append(h('h3', {}, 'Outline'));
    const add = (node: Chapter | Section, label: string, num: string, cls: string) => {
      const row = h('div', { class: `jss-ol ${cls}`, role: 'button', tabindex: 0, title: label, on: { click: () => this.scrollToNode(node), keydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.scrollToNode(node); } } } }, h('span', { class: 'n' }, num), h('span', {}, label));
      this.elNode.set(row, node); row.setAttribute('data-ol', ''); this.outlineEl.append(row);
    };
    const walk = (children: Children, indent: number) => { for (const c of children) if (isSection(c)) { add(c, c.title || '(untitled)', this.numbers.heading.get(c) ?? '', ''); (this.outlineEl.lastElementChild as HTMLElement).style.paddingLeft = `${12 + indent * 12}px`; walk(c.children, indent + 1); } };
    for (const ch of this.doc.chapters) { add(ch, ch.title, `Ch ${ch.number}`, 'ch'); walk(ch.children, 1); }
  }

  private scrollToNode(node: object): void {
    const el = this.nodeEl.get(node); if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.classList.remove('jss-flash'); void el.offsetWidth; el.classList.add('jss-flash');
    setTimeout(() => el.classList.remove('jss-flash'), 1700);
  }

  private markOutline(): void {
    const bad = new Set<object>(); const warn = new Set<object>();
    for (const f of this.findings) { const n = this.resolveLocation(f.location); if (!n) continue; const owner = this.sectionOwner(n); if (owner) (f.severity === 'error' ? bad : warn).add(owner); }
    this.outlineEl.querySelectorAll('.jss-ol').forEach((row) => { const n = this.elNode.get(row); row.classList.toggle('bad', !!n && bad.has(n)); row.classList.toggle('warn', !!n && !bad.has(n) && warn.has(n)); });
  }

  private sectionOwner(n: object): Chapter | Section | null {
    if ((n as Chapter).k === 'chapter' || (n as Section).k === 'section') return n as Chapter | Section;
    const at = ops.locate(this.doc, n as Block | Section); return at ? at.owner : null;
  }

  private selectionChanged(): void {
    if (this.view !== 'edit') return;
    this.updateToolbar();
    const sel = selection(); const n = sel?.anchorNode; if (!n || !this.paper.contains(n)) return;
    const el = (n.nodeType === 1 ? (n as Element) : n.parentElement); const sec = el?.closest('.jss-sec, .jss-chapter');
    const node = sec ? (this.elNode.get(sec) as Section | Chapter | undefined) : undefined;
    if (node) { this.lastSection = node; this.outlineEl.querySelectorAll('.jss-ol').forEach((row) => row.classList.toggle('cur', this.elNode.get(row) === node)); }
  }

  // ── problems ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private renderProblems(): void {
    const errors = this.findings.filter((f) => f.severity === 'error').length; const warns = this.findings.length - errors;
    this.problemsEl.textContent = '';
    this.problemsEl.append(h('summary', {}, this.findings.length ? `Problems: ${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}` : 'No problems found'));
    if (errors) this.problemsEl.open = true;
    for (const f of this.findings) {
      this.problemsEl.append(h('div', { class: 'jss-pr', role: 'button', tabindex: 0, on: { click: () => this.goTo(f.location), keydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.goTo(f.location); } } } },
        h('span', { class: `sev ${f.severity}`, title: f.severity }), h('span', { class: 'rule' }, f.rule), h('span', {}, f.message), h('span', { class: 'at' }, `line ${f.line}`)));
    }
  }

  private applyFindingMarks(): void {
    this.paper.querySelectorAll('.jss-has-error, .jss-has-warn').forEach((e) => e.classList.remove('jss-has-error', 'jss-has-warn'));
    this.paper.querySelectorAll('.jss-problem-mark').forEach((e) => e.remove());
    const best = new Map<object, 'e' | 'w'>();
    for (const f of this.findings) { const n = this.resolveLocation(f.location); if (!n) continue; const sev = f.severity === 'error' ? 'e' : 'w'; if (best.get(n) !== 'e') best.set(n, sev); }
    for (const [n, sev] of best) {
      const el = this.nodeEl.get(n); if (!el) continue;
      el.classList.add(sev === 'e' ? 'jss-has-error' : 'jss-has-warn'); el.style.position = el.style.position || 'relative';
      el.prepend(h('span', { class: `jss-problem-mark ${sev}`, title: 'This has a problem: see the list below' }, sev === 'e' ? '!' : '?'));
    }
  }

  /** The model node a finding's XML location names (as far down as the editor draws it). */
  private resolveLocation(location: string): object | null {
    const segs = location.split('/').filter(Boolean); if (segs[0] !== 'jssbook') return null;
    let i = 1; if (segs[i] === 'bookmeta') return null; if (segs[i] === 'body') i += 1;
    const pick = (seg: string): [string, number] => { const m = /^([A-Za-z]+)(?:\[(\d+)\])?$/.exec(seg); return [m?.[1] ?? seg, m?.[2] ? Number(m[2]) : 1]; };
    if (i >= segs.length) return null;
    const [cn, ci] = pick(segs[i]); if (cn !== 'chapter') return null;
    let cur: Chapter | Section | Block | null = this.doc.chapters[ci - 1] ?? null; i += 1;
    while (cur && i < segs.length) {
      if (cur.k !== 'chapter' && cur.k !== 'section') break;
      const [name, idx] = pick(segs[i]); const kids: Array<Block | Section> = (cur as Chapter | Section).children.filter((c: Block | Section) => c.k === name);
      const next: Block | Section | undefined = kids[idx - 1]; if (!next) break; cur = next; i += 1;
    }
    return cur;
  }

  private nodeById(id: string): object | null {
    for (const [node] of this.nodeEl) { const n = node as { id?: string }; if (n.id === id) return node; }
    return null;
  }

  // ── events ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private editableOf(target: EventTarget | null): HTMLElement | null {
    const n = target as Node | null; const el = n && (n.nodeType === 1 ? (n as Element) : n.parentElement);
    return (el?.closest('[data-edit]') as HTMLElement | null) ?? null;
  }

  private onInput(e: Event): void {
    const el = this.editableOf(e.target); if (!el) return;
    this.binds.get(el)?.sync(); this.setDirty(true);
    clearTimeout(this.labelTimer); this.labelTimer = setTimeout(() => this.refreshLabels(), 250);
  }

  private onFocusIn(e: FocusEvent): void {
    const blk = (e.target as HTMLElement).closest('.jss-block'); if (blk) this.lastBlock = (this.elNode.get(blk) as Block) ?? null;
    try { document.execCommand('styleWithCSS', false, 'false'); } catch { /* not available */ }
  }

  private refreshLabels(): void {
    this.numbers = numberDocument(this.doc);
    for (const fn of this.labelFns) fn();
    this.paper.querySelectorAll(`.${XREF_CLASS}[data-to]`).forEach((x) => { const id = x.getAttribute('data-to') ?? ''; const l = this.numbers.label.get(id); x.textContent = l ?? `⚠ ${id}`; x.classList.toggle('missing', l === undefined); });
    this.renderOutline(); this.markOutline();
    if (this.view === 'source') this.sourceEl.textContent = this.getXml();
  }

  private setDirty(d: boolean): void { if (this.dirty !== d) { this.dirty = d; this.opts.host.onDirty(d); } else if (d) this.opts.host.onDirty(true); }

  private onPaste(e: ClipboardEvent): void {
    const el = this.editableOf(e.target); if (!el) return;
    e.preventDefault(); if (this.opts.readOnly) return;
    const text = e.clipboardData?.getData('text/plain') ?? ''; if (!text) return;
    const chunks = text.replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    const isTopPara = el.classList.contains('jss-para') && !!el.closest('.jss-block[data-kind="para"]');
    this.pushHistory();
    document.execCommand('insertText', false, (isTopPara ? chunks[0] : chunks.join(' ')) ?? '');
    this.binds.get(el)?.sync(); this.setDirty(true);
    if (isTopPara && chunks.length > 1) {
      const block = this.elNode.get(el.closest('.jss-block') as Element) as Para; const at = ops.locate(this.doc, block); if (!at) return;
      const added = chunks.slice(1).map((c) => newPara(c)); at.list.splice(at.index + 1, 0, ...added); this.afterStructural(added[added.length - 1]);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const el = this.editableOf(e.target); if (!el || this.opts.readOnly) return;
    const bind = this.binds.get(el); if (!bind) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (mod) return;

    if (e.key === 'Tab') { if (this.onTab(el, e)) e.preventDefault(); return; }
    if (e.key === 'Enter') {
      if (bind.kind === 'plain') { e.preventDefault(); this.focusNext(el, 1); return; }
      if (e.shiftKey || el.closest('td')) { if (el.closest('td') || e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); bind.sync(); this.setDirty(true); } return; }
      e.preventDefault(); this.splitAtCaret(el); return;
    }
    if (e.key === 'Backspace' && atStart(el) && selection()?.isCollapsed) { if (this.backspaceAtStart(el)) e.preventDefault(); return; }
    if (e.key === 'ArrowDown' && atEnd(el) && !e.shiftKey) { if (this.focusNext(el, 1)) e.preventDefault(); return; }
    if (e.key === 'ArrowUp' && atStart(el) && !e.shiftKey) { if (this.focusNext(el, -1)) e.preventDefault(); }
  }

  private focusNext(from: HTMLElement, dir: 1 | -1): boolean {
    const all = Array.from(this.paper.querySelectorAll<HTMLElement>('[data-edit][contenteditable="true"]')); const i = all.indexOf(from); const to = all[i + dir];
    if (!to) return false; placeCaret(to, dir === 1 ? 0 : Infinity); return true;
  }

  private onTab(el: HTMLElement, e: KeyboardEvent): boolean {
    const li = el.closest('.jss-li'); const ref = li ? this.itemRefs.get(li) : undefined;
    if (ref) {
      const target = ref.item; const idx = ref.list.items.indexOf(target);
      if (!e.shiftKey) {
        if (idx > 0) { this.mutate(() => ops.indentItem(ref.list, idx), () => target); return true; }
        return true;
      }
      if (ref.parentList && ref.parentItem) { const pi = ref.parentList.items.indexOf(ref.parentItem); this.mutate(() => ops.outdentItem(ref.parentList as List, pi, ref.list, idx), () => target); return true; }
      return true;
    }
    const td = el.closest('td'); const cref = td ? this.cellRefs.get(td) : undefined;
    if (cref) {
      const cells = Array.from(this.paper.querySelectorAll<HTMLElement>('td [data-edit][contenteditable="true"]')); const i = cells.indexOf(el);
      const to = cells[i + (e.shiftKey ? -1 : 1)];
      if (to) { placeCaret(to, 0); return true; }
      if (!e.shiftKey && !ops.hasSpans(cref.table)) { this.mutate(() => ops.addRow(cref.table, 'body', cref.table.body.length - 1, 'below'), () => cref.table.body[cref.table.body.length - 1].cells[0].parts[0]); return true; }
      return true;
    }
    return false;
  }

  /** The editable element that holds a model node's text (the node's own element, or the one inside its wrapper). */
  private editableFor(node: object): HTMLElement | null {
    const el = this.nodeEl.get(node); if (!el) return null;
    return el.matches('[data-edit]') ? el : (el.querySelector('[data-edit]') as HTMLElement | null);
  }

  /** Enter: split the paragraph, list item or notice paragraph at the caret. */
  private splitAtCaret(el: HTMLElement): void {
    this.pushHistory();                                           // the model is in step with the sheet, so this is the state before the split
    const holder = document.createElement('div'); holder.append(takeAfterCaret(el));
    const before = readInline(el); const after = readInline(holder);
    const li = el.closest('.jss-li'); const ref = li ? this.itemRefs.get(li) : undefined;
    const node = this.elNode.get(el) as Part | undefined; if (!node) { this.renderAll(); return; }

    if (ref && node.k === 'inline') {
      const idx = ref.list.items.indexOf(ref.item);
      const emptyLast = !before.length && !after.length && idx === ref.list.items.length - 1 && ref.item.parts[0] === node;
      if (emptyLast) {
        // Enter on an empty last item leaves the list: out of a sub-list into its parent, or out of a top-level list into a paragraph below it
        if (ref.parentList && ref.parentItem) {
          ops.outdentItem(ref.parentList, ref.parentList.items.indexOf(ref.parentItem), ref.list, idx); this.afterStructural(ref.item.parts[0]); return;
        }
        // the list sits among a section's blocks, or inside a notice
        const blk = ref.list; const at = (ops.locate(this.doc, blk) ?? ops.locateInNotice(this.doc, blk)) as { list: Array<Block | Para | List>; index: number } | null;
        if (at) {
          const p = newPara();
          if (blk.items.length === 1) { ops.removeAt(at.list, at.index); ops.insertAt(at.list, at.index, p); } else { ops.removeItem(blk, idx); ops.insertAt(at.list, at.index + 1, p); }
          this.afterStructural(p); return;
        }
      }
      node.inline = before;
      const it = ops.addItem(ref.list, idx); it.parts = [{ k: 'inline', inline: after }];
      this.afterStructural(it.parts[0]); return;
    }

    if (node.k === 'para') {
      node.inline = before; const np = newPara(); np.inline = after; np.align = node.align;
      const blockEl = el.closest('.jss-block'); const blk = blockEl ? (this.elNode.get(blockEl) as Block) : null;
      if (blk === node) { const at = ops.locate(this.doc, blk); if (at) { ops.insertAt(at.list, at.index + 1, np); this.afterStructural(np); return; } }
      if (blk && isNotice(blk)) { ops.insertAt(blk.parts, blk.parts.indexOf(node) + 1, np); this.afterStructural(np); return; }
      if (ref) { ops.insertAt(ref.item.parts, ref.item.parts.indexOf(node) + 1, np); this.afterStructural(np); return; }
    }
    // not something that can be split: put the text back as it was
    if (node.k !== 'list') node.inline = mergeMarks([...before, ...after]);
    this.renderAll();
  }

  /** Backspace at the start of a text: join with the paragraph before, or remove an empty paragraph or list item. Returns whether it did anything. */
  private backspaceAtStart(el: HTMLElement): boolean {
    const node = this.elNode.get(el) as Part | undefined; if (!node) return false;
    const blockEl = el.closest('.jss-block'); const blk = blockEl ? (this.elNode.get(blockEl) as Block) : null;
    const li = el.closest('.jss-li'); const ref = li ? this.itemRefs.get(li) : undefined;
    const empty = readInline(el).length === 0;

    if (ref && node.k === 'inline' && ref.item.parts[0] === node) {
      const idx = ref.list.items.indexOf(ref.item);
      if (idx > 0 && empty) {
        this.pushHistory(); const prev = ref.list.items[idx - 1].parts[0]; const len = (this.editableFor(prev)?.textContent ?? '').length;
        ops.removeItem(ref.list, idx); this.afterStructural(prev, len); return true;
      }
      return false;
    }
    if (node.k === 'para' && blk === node) {
      const at = ops.locate(this.doc, node); if (!at) return false;
      const prev = at.list[at.index - 1];
      if (prev && prev.k === 'para') {
        this.pushHistory(); const len = (this.editableFor(prev)?.textContent ?? '').length;
        prev.inline = mergeMarks([...prev.inline, ...node.inline]); ops.removeAt(at.list, at.index); this.afterStructural(prev, len); return true;
      }
      if (empty && at.list.length > 1) {
        this.pushHistory(); ops.removeAt(at.list, at.index);
        const next = at.list[Math.max(0, at.index - 1)]; this.afterStructural(next ?? null, Infinity); return true;
      }
    }
    return false;
  }

  // ── commands ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private format(cmd: string): void {
    if (this.opts.readOnly) return;
    const sel = selection(); const el = this.editableOf(sel?.anchorNode ?? null); if (!el || el.getAttribute('data-edit') !== 'inline') return this.opts.host.notify('Click in some text first.');
    this.pushHistory(); document.execCommand(cmd); this.binds.get(el)?.sync(); this.setDirty(true); this.updateToolbar();
  }

  private setAlign(a: Align | undefined): void {
    const sel = selection(); const el = this.editableOf(sel?.anchorNode ?? null); const p = el && (this.elNode.get(el) as Para | undefined);
    if (!p || p.k !== 'para') return this.opts.host.notify('Click in a paragraph first.');
    this.mutate(() => { p.align = a; }, () => p);
  }

  /** The top-level block holding the caret (or the last one that had it), with where it sits. */
  private activeBlock(): { block: Block; list: Children; index: number } | null {
    const sel = selection(); const n = sel?.anchorNode;
    let block: Block | null = null;
    if (n && this.paper.contains(n)) { const blk = (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('.jss-block'); if (blk) block = (this.elNode.get(blk) as Block) ?? null; }
    block = block ?? this.lastBlock; if (!block) return null;
    const at = ops.locate(this.doc, block); return at ? { block, list: at.list, index: at.index } : null;
  }

  private activeSection(): Section | Chapter {
    const sel = selection(); const n = sel?.anchorNode;
    if (n && this.paper.contains(n)) { const el = (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('.jss-sec, .jss-chapter'); const node = el && (this.elNode.get(el) as Section | Chapter | undefined); if (node) return node; }
    return this.lastSection ?? this.doc.chapters[0];
  }

  private insertBlock(b: Block): void {
    if (this.opts.readOnly) return;
    this.mutate(() => {
      const at = this.activeBlock();
      if (at) ops.insertAt(at.list, at.index + 1, b);
      else this.appendToOwner(this.activeSection(), b);
    }, () => b);
  }
  private appendToOwner(owner: Chapter | Section, b: Block): void {
    const firstSub = owner.children.findIndex(isSection);
    ops.insertAt(owner.children, firstSub < 0 ? owner.children.length : firstSub, b);
  }
  private insertParaInto(owner: Chapter | Section): void { const p = newPara(); this.mutate(() => this.appendToOwner(owner, p), () => p); }

  private removeBlock(b: Block): void { this.mutate(() => { const at = ops.locate(this.doc, b); if (at) ops.removeAt(at.list, at.index); }, () => null); }

  private async deleteBlock(): Promise<void> {
    const at = this.activeBlock(); if (!at) return this.opts.host.notify('Click in the block you want to delete.');
    const empty = at.block.k === 'para' && !at.block.inline.length;
    if (!empty && !(await confirmDialog('Delete this block?', 'The block and everything in it will be removed. You can undo this.'))) return;
    this.removeBlock(at.block);
  }

  private moveBlock(dir: -1 | 1): void {
    const at = this.activeBlock(); if (!at) return this.opts.host.notify('Click in the block you want to move.');
    let j = at.index + dir; while (j >= 0 && j < at.list.length && isSection(at.list[j])) j += dir;
    if (j < 0 || j >= at.list.length || isSection(at.list[j])) return;
    this.mutate(() => { [at.list[at.index], at.list[j]] = [at.list[j], at.list[at.index]]; }, () => at.block);
  }

  private sectionMenu(): MenuItem[] {
    const cur = this.activeSection(); const isCh = cur.k === 'chapter';
    const make = (parent: Chapter | Section, where: 'end' | 'after') => {
      const s = newSection('New section', newId(this.doc, 's'));
      this.mutate(() => { if (where === 'end') parent.children.push(s); else { const at = ops.locate(this.doc, parent as Section); if (at) ops.insertAt(at.list, at.index + 1, s); else parent.children.push(s); } }, () => s);
      const t = this.nodeEl.get(s)?.querySelector<HTMLElement>('.jss-sec-title'); if (t) { placeCaret(t, 0); const sel = selection(); if (sel) { const r = document.createRange(); r.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(r); } }   // the new title is selected, ready to be typed over
    };
    const level = isCh ? 1 : ops.headingLevel(this.doc, cur as Section);
    if (this.opts.sectionsFixed) {
      return [{ label: 'Add a section', disabled: true, hint: 'the stencil fixes the sections', run: () => undefined }];
    }
    const items: MenuItem[] = [
      { label: isCh ? 'Add a section to this chapter (heading level 2)' : `Add a heading after this one (level ${level})`, disabled: !isCh && false, run: () => make(isCh ? cur : (ops.locate(this.doc, cur as Section)?.owner ?? cur), isCh ? 'end' : 'after') },
      { label: `Add a sub-heading inside this one (level ${level + 1})`, disabled: level + 1 > this.opts.maxDepth, hint: level + 1 > this.opts.maxDepth ? `level ${this.opts.maxDepth} is the deepest` : `of ${this.opts.maxDepth}`, run: () => make(cur, 'end') },
    ];
    if (this.opts.chapterRule === 'free') items.push({ label: 'Add a chapter (another system or sub-system)', run: () => this.addChapter(ops.chapterOf(this.doc, cur) ?? undefined) });
    return items;
  }

  private async deleteSection(s: Section): Promise<void> {
    if ((s.children.length || s.title.trim()) && !(await confirmDialog('Delete this section?', `"${s.title || 'Untitled'}"${s.children.length ? ' and everything in it' : ''} will be removed. You can undo this.`))) return;
    this.mutate(() => { const at = ops.locate(this.doc, s); if (at) ops.removeAt(at.list, at.index); }, () => null);
  }

  private listMenu(): MenuItem[] {
    const sel = selection(); const li = (sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement))?.closest('.jss-li');
    const ref = li ? this.itemRefs.get(li) : undefined;
    const types: Array<[ListType, string]> = [['alpha', '(a) (b) (c) lettered'], ['roman', '(i) (ii) (iii) roman'], ['number', '1. 2. 3. numbered'], ['bullet', '• bullets'], ['dash', '– dashes']];
    const items: MenuItem[] = types.map(([t, label]) => ({ label: `New list: ${label}`, run: () => this.insertListHere(t) }));
    if (ref) {
      items.push(...types.map(([t, label]): MenuItem => ({ label: `Change this list to ${label}`, run: () => this.mutate(() => { ref.list.type = t; }, () => ref.item) })));
      items.push({ label: 'Nest this item under the one above (Tab)', run: () => this.nestItem(false) });
      items.push({ label: 'Move this item out one level (Shift+Tab)', run: () => this.nestItem(true), disabled: !ref.parentList });
      items.push({ label: 'Add an item below', run: () => { const it = ops.addItem(ref.list, ref.list.items.indexOf(ref.item)); this.afterStructural(it.parts[0]); } });
      items.push({ label: 'Remove this item', run: () => this.mutate(() => ops.removeItem(ref.list, ref.list.items.indexOf(ref.item)), () => null), disabled: ref.list.items.length < 2 });
    }
    return items;
  }

  // ── dialogs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async insertTableDialog(): Promise<void> {
    // the tables the stencil fixes are offered first: the one that belongs under the section the caret is in, else the only one the stencil has
    const templates = this.opts.tableTemplates ?? [];
    const here = this.activeSection(); const hereTitle = here.k === 'section' ? here.title.trim().toLowerCase() : '';
    const preset = templates.findIndex((t) => t.forSection && t.forSection.trim().toLowerCase() === hereTitle);
    const initial = preset >= 0 ? preset : templates.length === 1 && !templates[0].forSection ? 0 : -1;
    const label = (t: TableTemplate): string => `${t.forSection ? `${t.forSection}: ` : ''}${t.caption ?? 'the stencil’s table'} (${templateColumns(t)} columns)`;
    const r = await ask<{ template: TableTemplate | null; rows: number; cols: number; head: boolean; title: string }>('Insert a table', (body, api) => {
      const rows = h('input', { type: 'number', min: 1, max: 100, value: 3 }) as HTMLInputElement; const cols = h('input', { type: 'number', min: 1, max: 12, value: 3 }) as HTMLInputElement;
      const head = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement; const title = h('input', { type: 'text', placeholder: 'e.g. Technical Specifications' }) as HTMLInputElement;
      const kind = h('select', { 'aria-label': 'Kind of table' }, h('option', { value: '-1' }, 'A table of my own'), ...templates.map((t, i) => h('option', { value: String(i), selected: i === initial }, label(t)))) as HTMLSelectElement;
      const sync = () => {
        const tpl = Number(kind.value) >= 0 ? templates[Number(kind.value)] : null;
        for (const el of [rows, cols, head]) el.disabled = !!tpl;
        title.placeholder = tpl?.caption ? tpl.caption : 'e.g. Technical Specifications';
      };
      kind.addEventListener('change', sync); sync();
      if (templates.length) body.append(field('Table', kind, 'The stencil’s own tables keep its columns and its header, merged as the stencil merges it; you fill the rows.'));
      body.append(field('Caption', title, 'The stencil numbers and captions every table (Table 1-1: ...).'), h('div', { class: 'grid' }, field('Rows (below the header)', rows), field('Columns', cols)), h('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, head, 'First row is a header row'));
      return () => {
        const template = Number(kind.value) >= 0 ? templates[Number(kind.value)] : null;
        if (template) return { template, rows: 0, cols: 0, head: true, title: title.value.trim() };
        const r = Math.round(Number(rows.value)); const c = Math.round(Number(cols.value)); if (!(r >= 1 && r <= 100)) { api.error('Rows: a number from 1 to 100.'); return null; } if (!(c >= 1 && c <= 12)) { api.error('Columns: a number from 1 to 12.'); return null; }
        return { template: null, rows: r, cols: c, head: head.checked, title: title.value.trim() };
      };
    }, 'Insert table', this.root);
    if (!r) return;
    if (r.template) { const t = tableFromTemplate(r.template, newId(this.doc, 't')); if (r.title) t.title = r.title; this.insertBlock(t); return; }
    const t = newTable(r.rows, r.cols, newId(this.doc, 't')); t.title = r.title; if (!r.head) { t.body.unshift(...t.head); t.head = []; }
    this.insertBlock(t);
  }

  private async widthsDialog(t: Table): Promise<void> {
    const r = await ask<string>('Column widths', (body, api) => {
      const input = h('input', { type: 'text', value: t.widths ?? '', placeholder: '20mm 1* 2*' }) as HTMLInputElement;
      body.append(field('Widths, one per column', input, `This table has ${ops.columnCount(t)} columns. Use millimetres (20mm) for a fixed width and a number with a star (1*, 2*) to share what is left. Leave empty for equal columns.`));
      return () => { const m = ops.checkWidths(t, input.value); if (m) { api.error(m); return null; } return input.value.trim(); };
    }, 'Set widths', this.root);
    if (r === null) return;
    this.mutate(() => { t.widths = r || undefined; }, () => t);
  }

  private async insertFigureDialog(): Promise<void> {
    const pick = await this.pictureDialog('Insert a figure'); if (!pick) return;
    const f = newFigure(pick.src, newId(this.doc, 'f')); this.insertBlock(f);
  }
  private async changePicture(f: Figure): Promise<void> {
    const pick = await this.pictureDialog('Change the picture'); if (!pick) return;
    this.mutate(() => { f.graphics = [{ src: pick.src, width: f.graphics[0]?.width, height: f.graphics[0]?.height }]; }, () => f);
  }
  private pictureDialog(title: string): Promise<GraphicInfo | null> {
    return ask<GraphicInfo>(title, (body, api) => {
      let chosen: GraphicInfo | null = null; const grid = h('div', { class: 'pick' }); const msg = h('div', { class: 'hint' }, 'Loading the project’s pictures…');
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/svg+xml', 'aria-label': 'Upload a picture' }) as HTMLInputElement;
      const show = (list: GraphicInfo[]) => {
        grid.textContent = ''; msg.textContent = list.length ? '' : 'The project has no pictures yet: upload one below.';
        for (const g of list) {
          const b = h('button', { type: 'button', title: g.src, on: { click: () => { chosen = g; grid.querySelectorAll('button').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); } } }, h('img', { src: g.url, alt: '' }), g.name);
          grid.append(b);
        }
      };
      this.opts.host.graphics().then(show).catch((e) => { msg.textContent = `Could not list the pictures: ${(e as Error).message}`; });
      file.addEventListener('change', async () => {
        const f = file.files?.[0]; if (!f) return; msg.textContent = 'Uploading…';
        try { const g = await this.opts.host.uploadGraphic(f); chosen = g; show(await this.opts.host.graphics()); grid.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x.getAttribute('title') === g.src)); msg.textContent = `${g.name} uploaded and selected.`; }
        catch (e) { api.error(`The upload failed: ${(e as Error).message}`); msg.textContent = ''; }
      });
      body.append(msg, grid, field('Or upload a new picture', file, 'PNG, JPEG, GIF or SVG. It is stored in the project’s Media folder.'));
      return () => { if (!chosen) { api.error('Choose a picture, or upload one.'); return null; } return chosen; };
    }, 'Use this picture', this.root);
  }

  private rememberSelection(): void { const sel = selection(); this.savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; }
  private restoreSelection(): HTMLElement | null {
    const sel = selection(); if (!sel || !this.savedRange) return null; sel.removeAllRanges(); sel.addRange(this.savedRange);
    return this.editableOf(this.savedRange.startContainer);
  }

  private async insertXrefDialog(): Promise<void> {
    this.rememberSelection(); const targets = this.numbers.targets;
    if (!targets.length) return this.opts.host.notify('There is nothing to refer to yet: give a table or figure a caption, or add a section.');
    const r = await ask<string>('Insert a cross-reference', (body, api) => {
      let chosen = ''; const list = h('div', { class: 'list' });
      for (const t of targets) { const b = h('button', { type: 'button', on: { click: () => { chosen = t.id; list.querySelectorAll('button').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); } } }, h('span', { class: 'kind' }, t.kind), h('span', {}, t.label), h('span', { style: 'margin-left:auto;color:var(--text-faint)' }, t.where)); list.append(b); }
      body.append(h('div', { class: 'hint' }, 'The reference prints the number (Table 1-2, Figure 3-1) or the section title, and follows it if it is renumbered.'), list);
      return () => { if (!chosen) { api.error('Choose what to refer to.'); return null; } return chosen; };
    }, 'Insert', this.root);
    const el = this.restoreSelection(); if (!r || !el || el.getAttribute('data-edit') !== 'inline') return;
    this.pushHistory();
    const span = document.createElement('span'); span.className = XREF_CLASS; span.setAttribute('contenteditable', 'false'); span.setAttribute('data-to', r); span.textContent = this.numbers.label.get(r) ?? r;
    const range = selection()!.getRangeAt(0); range.deleteContents(); range.insertNode(span); range.setStartAfter(span); range.collapse(true);
    const sel = selection()!; sel.removeAllRanges(); sel.addRange(range);
    this.binds.get(el)?.sync(); this.setDirty(true);
  }

  private async insertLinkDialog(): Promise<void> {
    this.rememberSelection(); const selected = selection()?.toString() ?? '';
    const r = await ask<{ href: string; label: string }>('Link to a web address', (body, api) => {
      const href = h('input', { type: 'url', placeholder: 'https://' }) as HTMLInputElement; const label = h('input', { type: 'text', value: selected }) as HTMLInputElement;
      body.append(field('Address', href), field('Text to show', label, 'Printed in the PDF; readers can click it in a PDF viewer.'));
      return () => { if (!/^(https?:\/\/|mailto:)\S+$/i.test(href.value.trim())) { api.error('Give a full address starting with http://, https:// or mailto:.'); return null; } if (!label.value.trim()) { api.error('Give the text to show.'); return null; } return { href: href.value.trim(), label: label.value.trim() }; };
    }, 'Insert link', this.root);
    const el = this.restoreSelection(); if (!r || !el || el.getAttribute('data-edit') !== 'inline') return;
    this.pushHistory();
    const span = document.createElement('span'); span.className = XREF_CLASS; span.setAttribute('contenteditable', 'false'); span.setAttribute('data-href', r.href); span.textContent = r.label; span.title = r.href;
    const range = selection()!.getRangeAt(0); range.deleteContents(); range.insertNode(span); range.setStartAfter(span); range.collapse(true);
    const sel = selection()!; sel.removeAllRanges(); sel.addRange(range);
    this.binds.get(el)?.sync(); this.setDirty(true);
  }

  private async detailsDialog(): Promise<void> {
    const r = await ask<Record<string, string>>('Document details', (body, api) => {
      const inputs = new Map<string, HTMLInputElement>();
      for (const f of META_FIELDS) { const i = h('input', { type: 'text', value: this.doc.meta[f.key] ?? '' }) as HTMLInputElement; inputs.set(f.key, i); body.append(field(f.label, i, f.hint)); }
      return () => { const out: Record<string, string> = {}; for (const [k, i] of inputs) out[k] = i.value.trim(); if (!out.bookName) { api.error('The publication needs a title.'); return null; } return out; };
    }, 'Save details', this.root);
    if (!r) return;
    this.mutate(() => { this.doc.meta = r; }, () => null);
  }

  // ── history and the one path for structural change ──────────────────────────────────────────────────────────────────────────────

  private pushHistory(): void {
    const s = serializeJss(this.doc);
    if (this.undoStack[this.undoStack.length - 1] !== s) { this.undoStack.push(s); if (this.undoStack.length > 200) this.undoStack.shift(); }
    this.redoStack = []; this.updateToolbar();
  }

  /** Change the model, draw it again, and put the caret in `focus`. Refused (nothing changes) when `fn` returns false. */
  private mutate(fn: () => boolean | void, focus: () => object | null): void {
    if (this.opts.readOnly) return;
    this.pushHistory(); const before = this.undoStack.length;
    if (fn() === false) { if (this.undoStack.length === before) this.undoStack.pop(); this.updateToolbar(); return; }
    this.afterStructural(focus());
  }

  private afterStructural(focus: object | null, offset: number = 0): void {
    const top = this.scrollEl.scrollTop;
    this.renderAll(); this.scrollEl.scrollTop = top; this.setDirty(true); this.updateToolbar();
    if (!focus) return;
    const el = this.nodeEl.get(focus); if (!el) return;
    const target = el.matches('[data-edit]') ? el : (el.querySelector('[data-edit][contenteditable="true"]') as HTMLElement | null);
    if (target) placeCaret(target, offset);
  }

  // ── what the tests (and the host) may ask of the editor directly ───────────────────────────────────────────────────────────────

  /** Insert blocks and sections from outside the toolbar (used by the page's own commands and by tests). */
  exec(cmd: 'paragraph' | 'list' | 'table' | 'notice' | 'pageBreak' | 'section' | 'subsection', arg?: ListType | NoticeKind | { rows: number; cols: number; title?: string }): void {
    switch (cmd) {
      case 'paragraph': this.insertBlock(newPara()); break;
      case 'list': this.insertBlock(newList((arg as ListType) ?? undefined, 1)); break;
      case 'notice': this.insertBlock(newNotice((arg as NoticeKind) ?? 'note')); break;
      case 'pageBreak': this.insertBlock({ k: 'pageBreak' }); break;
      case 'table': { const a = (arg as { rows: number; cols: number; title?: string }) ?? { rows: 2, cols: 2 }; const t = newTable(a.rows, a.cols, newId(this.doc, 't')); t.title = a.title ?? ''; this.insertBlock(t); break; }
      case 'section': case 'subsection': { const items = this.sectionMenu(); items[cmd === 'section' ? 0 : 1].run(); break; }
    }
  }
}

export { inlineText };

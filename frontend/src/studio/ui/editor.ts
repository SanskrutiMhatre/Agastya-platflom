/**
 * DocumentEditor: per-document controller tying the model, views
 * (Design / Tags / Split / XML), selection state and editing commands.
 */
import type { ChangeEvent, EditorDocument, ModelPos, ModelSelection } from '../core/document';
import * as ops from '../core/ops';
import { idClash, idPrefixFor, rewriteIdRefs } from '../core/ids';
import * as T from '../core/table';
import { ATOMIC, ATOMIC_BLOCK } from '../core/display';
import { ParseError, XmlParseError, XML_NAME, parseXml, withEntity, elementChildren, nodeIndex, setAttr, removeAttr, createEl, textOf } from '../core/xml';
import { DmCodeParts, writeDmCode, INTERNAL_REF_TYPES } from '../core/s1000d';
import { DesignView } from '../view/design';
import { XmlView } from '../view/xmlview';
import type { ValidationIssue, ValidationReport } from '../validation/types';
import { readClipboard, writeClipboard, xmlToFragment, htmlToFragment, textToFragment, insertFragment } from './clipboard';
import { usedEntities } from './validator';
import { h, debounce } from './dom';
import type { App } from './app';

export type ViewMode = 'design' | 'tags' | 'split' | 'xml';

export const EMPHASIS = { bold: 'em01', italic: 'em02', underline: 'em03', overline: 'em04', strike: 'em05' } as const;

export class DocumentEditor {
  readonly el: HTMLElement;
  readonly design: DesignView;
  readonly xml: XmlView;
  mode: ViewMode = 'design';
  elementSelection: Element | null = null;
  report: ValidationReport | null = null;
  /** The document version the report describes; an edited document is no longer the one the report talks about. */
  reportVersion = -1;
  validating = false;
  /** A validation asked for while another was running (a click on Validate must not be lost), and a live one owed after edits. */
  pendingValidation: { xsd?: boolean; brex?: boolean } | null = null;
  revalidate = false;
  /** When Ctrl+Shift+V was pressed: the paste event that follows inserts plain text only. */
  plainPasteAt = -Infinity;
  xmlError: ParseError | null = null;
  private banner: HTMLElement;
  /** Phase 3: why this live document cannot be changed by this person now (a check-out by someone else, review, role), or null */
  private lockText: string | null = null;
  private lockBanner: HTMLElement;
  private views: HTMLElement;
  private splitter: HTMLElement;
  private cache: { version: number; text: string; spans: Map<Node, [number, number]> } | null = null;
  private xmlCaretNode: Element | null = null;
  private splitRatio = 0.5;
  private liveValidate = debounce(() => this.app.validate(this, { live: true }), 1500);
  private autosave = debounce(() => this.app.saveDraft(this), 2500);
  private chrome = debounce(() => this.app.updateChrome(), 60);

  constructor(readonly app: App, readonly doc: EditorDocument) {
    this.design = new DesignView(this, false);
    this.xml = new XmlView(this);
    this.banner = h('div', { class: 'doc-banner', hidden: true });
    this.splitter = h('div', { class: 'split-handle', title: 'Drag to resize', role: 'separator', 'aria-orientation': 'vertical' });
    this.views = h('div', { class: 'doc-views' }, this.design.el, this.splitter, this.xml.el);
    this.lockBanner = h('div', { class: 'doc-banner doc-banner-lock', hidden: true, 'data-testid': 'collab-lock', role: 'status' });
    this.el = h('div', { class: 'doc-editor' }, this.lockBanner, this.banner, this.views);
    this.bindSplitter();
    doc.addEventListener('change', (e) => this.onChange((e as CustomEvent<ChangeEvent>).detail));
    doc.addEventListener('saved', () => this.app.updateChrome());
    this.setMode(app.settings.defaultView);
  }

  // ------------------------------------------------------------ views
  setMode(mode: ViewMode): boolean {
    if (mode === this.mode && this.el.isConnected) return true;
    const leavingXml = this.mode === 'xml' || this.mode === 'split';
    if (leavingXml && mode !== 'xml' && mode !== 'split') {
      if (!this.xml.flush()) {
        this.app.confirmMalformed(this);
        return false;
      }
    }
    if (mode === 'xml' || mode === 'split') this.xml.flush();
    this.mode = mode;
    this.views.dataset.mode = mode;
    const showDesign = mode !== 'xml';
    const tags = mode === 'tags' || (mode === 'split' && this.app.settings.splitTags);
    if (this.design.showTags !== tags) this.design.setTags(tags);
    this.design.setVisible(showDesign);
    this.xml.setVisible(mode === 'xml' || mode === 'split');
    this.splitter.hidden = mode !== 'split';
    this.applySplit();
    if (showDesign) this.design.applySelection(this.doc.selection, false);
    if (mode === 'split' || mode === 'xml') this.syncXmlFocus(true);
    this.app.updateChrome();
    return true;
  }

  /** Re-applies the settings that change how the current view looks (Tags in Split view) without leaving the mode. */
  applyViewSettings() {
    const tags = this.mode === 'tags' || (this.mode === 'split' && this.app.settings.splitTags);
    if (this.design.showTags === tags) return;
    this.design.setTags(tags);
    if (this.mode !== 'xml') this.design.applySelection(this.doc.selection, false);
  }

  private applySplit() {
    if (this.mode === 'split') {
      this.design.el.style.flex = `${this.splitRatio} 1 0`;
      this.xml.el.style.flex = `${1 - this.splitRatio} 1 0`;
    } else {
      this.design.el.style.flex = '';
      this.xml.el.style.flex = '';
    }
  }

  private bindSplitter() {
    this.splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.splitter.setPointerCapture(e.pointerId);
      const box = this.views.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        this.splitRatio = Math.min(0.85, Math.max(0.15, (ev.clientX - box.left) / box.width));
        this.applySplit();
      };
      const up = () => {
        this.splitter.removeEventListener('pointermove', move);
        this.splitter.removeEventListener('pointerup', up);
        this.xml.view.requestMeasure();
      };
      this.splitter.addEventListener('pointermove', move);
      this.splitter.addEventListener('pointerup', up);
    });
  }

  focus() {
    if (this.mode === 'xml') this.xml.focus();
    else {
      this.design.page.focus({ preventScroll: true });
      this.design.applySelection(this.doc.selection, false);
    }
  }

  // ------------------------------------------------------------ model sync
  private onChange(ev: ChangeEvent) {
    this.cache = null;
    if (this.elementSelection && !this.elementSelection.isConnected) this.elementSelection = null;
    if (ev.source !== 'xml-reload') this.design.onModelChange(ev);
    if (ev.source !== 'xml') this.xml.markStale();
    else this.xml.setValidation([]);
    if (this.mode === 'xml') this.design.invalidate();
    this.app.onDocChanged(this, ev);
    if (this.app.settings.liveValidation) this.liveValidate();
    this.autosave();
    this.chrome();
  }

  serializedText(): string {
    return this.serialized().text;
  }

  private serialized() {
    if (!this.cache || this.cache.version !== this.doc.version) {
      const r = this.doc.serialize(true);
      this.cache = { version: this.doc.version, text: r.text, spans: r.spans! };
    }
    return this.cache;
  }

  spanOf(node: Node): [number, number] | null {
    return this.serialized().spans.get(node) ?? null;
  }

  /** Innermost element whose serialised span contains `offset`. */
  elementAtOffset(offset: number): Element | null {
    const { spans } = this.serialized();
    let best: Element | null = null;
    let bestLen = Infinity;
    for (const [n, [s, e]] of spans) {
      if (n.nodeType !== 1) continue;
      if (offset >= s && offset < e && e - s < bestLen) {
        best = n as Element;
        bestLen = e - s;
      }
    }
    return best;
  }

  lineOf(node: Node): number | null {
    const sp = this.spanOf(node);
    if (!sp) return null;
    const text = this.serializedText();
    let line = 1;
    for (let i = 0; i < sp[0]; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  }

  /** Element at a 1-based line of the serialised XML (for XSD messages). */
  elementAtLine(line: number): Element | null {
    const text = this.serializedText();
    let off = 0;
    for (let l = 1; l < line && off >= 0; l++) off = text.indexOf('\n', off) + 1;
    if (off < 0) return null;
    // first '<' on that line that starts an element
    const eol = text.indexOf('\n', off);
    const lineText = text.slice(off, eol < 0 ? undefined : eol);
    const m = lineText.search(/<[A-Za-z]/);
    return this.elementAtOffset(off + (m >= 0 ? m + 1 : 0));
  }

  commitXmlText(text: string) {
    let parsed;
    try {
      parsed = parseXml(text);
    } catch (e) {
      if (e instanceof XmlParseError) this.onXmlError(e.errors[0]);
      return;
    }
    this.onXmlError(null);
    const selPath = this.xmlCaretNode;
    this.doc.replaceFromParsed(parsed, 'xml');
    void this.doc.refreshSchema().then((changed) => {
      if (changed) {
        this.xml.setGrammar(this.doc.grammar);
        this.design.invalidate();
        this.app.updateChrome();
      }
    });
    if (selPath && !selPath.isConnected) this.xmlCaretNode = null;
  }

  onXmlError(err: ParseError | null) {
    const same = JSON.stringify(err) === JSON.stringify(this.xmlError);
    this.xmlError = err;
    if (same && (err ? !this.banner.hidden : this.banner.hidden)) return;
    if (err) {
      this.banner.hidden = false;
      this.banner.className = 'doc-banner doc-banner-error';
      this.banner.replaceChildren(
        h('span', { class: 'banner-text' }, h('b', null, 'XML is not well-formed'), ` — line ${err.line}, column ${err.column}: ${err.message}. The visual views are read-only until the error is fixed.`),
        h('button', { class: 'btn btn-sm', on: { click: () => this.gotoXmlError() } }, 'Go to error'),
        h('button', { class: 'btn btn-sm', on: { click: () => this.xml.revert() } }, 'Discard XML changes'),
      );
    } else {
      this.banner.hidden = true;
      this.banner.replaceChildren();
    }
    this.app.updateChrome();
  }

  gotoXmlError() {
    if (!this.xmlError) return;
    if (this.mode !== 'xml' && this.mode !== 'split') this.setMode('split');
    this.xml.gotoLine(this.xmlError.line);
  }

  onXmlCaret(offset: number) {
    const el = this.elementAtOffset(offset);
    if (!el) return;
    this.xmlCaretNode = el;
    if (this.mode === 'split' && this.app.settings.syncSelection) {
      this.design.reveal(el, false);
      this.design.markSelected(el);
    }
    this.app.onSelectionChange(this);
  }

  syncXmlFocus(scroll: boolean) {
    if (this.mode !== 'split' && this.mode !== 'xml') return;
    const el = this.currentElement();
    if (!el) return;
    const sp = this.spanOf(el);
    if (sp) this.xml.focusRange(sp[0], sp[1], scroll && this.app.settings.syncSelection);
  }

  readOnlyReason(): string | null {
    if (this.xmlError) return 'The XML source is not well-formed — fix it in the XML view first.';
    return this.lockText;
  }

  /** Phase 3 (live co-editing): this person may not change the document now (null: they may). The canvas stays readable and selectable. */
  setLock(reason: string | null) {
    if (reason === this.lockText) return;
    this.lockText = reason;
    this.lockBanner.hidden = !reason;
    this.lockBanner.replaceChildren(...(reason ? [h('span', { class: 'banner-text' }, reason)] : []));
    this.el.classList.toggle('is-locked', !!reason);
    this.app.updateChrome();
  }
  get locked(): boolean { return !!this.lockText; }

  /** Phase 3: another person's change was applied; put this person's caret back where it was (the view's text nodes were rewritten). */
  afterRemote() {
    if (this.mode === 'xml') return;
    const sel = this.doc.selection;
    if (!sel || !sel.anchor.node.isConnected || !sel.focus.node.isConnected) return;
    const active = document.activeElement;
    if (active && this.design.page.contains(active)) this.design.applySelection(sel, false);
  }

  // ------------------------------------------------------------ selection
  onDomSelection() {
    const sel = this.design.readSelection();
    if (!sel) return;
    if (this.elementSelection && this.elementSelection.isConnected) {
      // the DOM selection set for an element selection reports the element's boundaries
      const el = this.elementSelection;
      const inside = (p: ModelPos) => p.node === el || el.contains(p.node) || (p.node === el.parentNode && (p.offset === nodeIndex(el) || p.offset === nodeIndex(el) + 1));
      if (inside(sel.anchor) && inside(sel.focus)) return;
    }
    this.doc.selection = sel;
    if (this.elementSelection) {
      this.elementSelection = null;
      this.design.markSelected(null);
    }
    this.xmlCaretNode = null;
    this.app.onSelectionChange(this);
    if (this.mode === 'split') this.syncXmlFocus(true);
  }

  selectElement(el: Element, opts: { scroll?: boolean; focusView?: boolean } = {}) {
    this.elementSelection = el;
    const parent = el.parentNode!;
    const i = nodeIndex(el);
    this.doc.selection = { anchor: { node: parent, offset: i }, focus: { node: parent, offset: i + 1 }, element: el };
    this.xmlCaretNode = null;
    if (this.mode !== 'xml') {
      this.design.applySelection(this.doc.selection, opts.scroll ?? true);
      if (opts.scroll) this.design.reveal(el, false);
    }
    this.syncXmlFocus(true);
    this.app.onSelectionChange(this);
  }

  clearElementSelection() {
    const el = this.elementSelection;
    this.elementSelection = null;
    this.design.markSelected(null);
    if (el && el.isConnected) {
      const tb = ops.firstTextBlock(el, this.doc.grammar);
      const pos = tb ? ops.startOf(tb, this.doc.grammar) : ops.after(el);
      this.doc.selection = ops.caret(pos);
      this.design.applySelection(this.doc.selection);
    }
    this.app.onSelectionChange(this);
  }

  leaveElementSelection(dir: -1 | 1) {
    const el = this.elementSelection;
    if (!el) return;
    this.elementSelection = null;
    this.design.markSelected(null);
    const pos = dir < 0 ? ops.before(el) : ops.after(el);
    this.doc.selection = ops.caret(ops.normalizePos(pos));
    this.design.applySelection(this.doc.selection);
    this.app.onSelectionChange(this);
  }

  /** The element the UI context refers to: selected element, XML caret element or innermost element at the caret. */
  currentElement(): Element | null {
    if (this.elementSelection?.isConnected) return this.elementSelection;
    if ((this.mode === 'xml' || this.mode === 'split') && this.xmlCaretNode?.isConnected && document.activeElement && this.xml.el.contains(document.activeElement)) return this.xmlCaretNode;
    const sel = this.doc.selection;
    if (!sel || !sel.focus.node.isConnected) return this.doc.root ?? null;
    const n = sel.focus.node;
    const el = (n.nodeType === 1 ? n : n.parentNode) as Element | null;
    return el && el.nodeType === 1 ? el : this.doc.root;
  }

  currentPos(): ModelPos {
    const sel = this.doc.selection;
    if (sel && sel.focus.node.isConnected) return sel.focus;
    const content = this.doc.xml.getElementsByTagName('content')[0] ?? this.doc.root;
    return ops.startOf(content, this.doc.grammar);
  }

  get grammar() { return this.doc.grammar; }

  // ------------------------------------------------------------ editing core
  /**
   * Runs an editing operation in a transaction. `fn` receives the current
   * selection and returns the new selection. OpErrors are shown to the user.
   */
  exec(label: string, fn: (sel: ModelSelection) => ModelSelection | void | null, opts: { merge?: string; requireDesign?: boolean } = {}): boolean {
    const ro = this.readOnlyReason();
    if (ro) {
      this.app.toast(ro, 'warning');
      return false;
    }
    if (this.mode === 'xml' || this.mode === 'split') {
      if (!this.xml.flush()) return false;
    }
    let sel = this.doc.selection;
    if (!sel || !sel.anchor.node.isConnected || !sel.focus.node.isConnected) {
      const p = this.currentPos();
      sel = ops.caret(p);
    }
    if (this.elementSelection && !sel.element) sel = { ...sel, element: this.elementSelection };
    const before = sel;
    try {
      this.doc.transact(label, () => {
        const r = fn(before);
        this.doc.selection = r ?? before;
      }, { merge: opts.merge, selectionBefore: before });
    } catch (e) {
      if (e instanceof ops.OpError) {
        this.app.toast(e.message, 'warning');
        return false;
      }
      console.error(e);
      this.app.toast(`${label} failed: ${(e as Error).message}`, 'error');
      return false;
    }
    if (!opts.merge) this.doc.breakMerge();
    const after = this.doc.selection;
    this.elementSelection = after?.element && after.element.isConnected ? after.element : null;
    if (this.mode !== 'xml') this.design.applySelection(after);
    else this.syncXmlFocus(true);
    this.app.onSelectionChange(this);
    return true;
  }

  undo() {
    if (this.mode === 'xml' || this.mode === 'split') {
      if (this.xml.hasPending && !this.xml.flush()) {
        this.xml.revert();
        return;
      }
    }
    if (!this.doc.undo()) return this.app.toast('Nothing to undo', 'info');
    this.afterHistory();
  }

  redo() {
    if (this.mode === 'xml' || this.mode === 'split') this.xml.flush();
    if (!this.doc.redo()) return this.app.toast('Nothing to redo', 'info');
    this.afterHistory();
  }

  private afterHistory() {
    const sel = this.doc.selection;
    this.elementSelection = sel?.element && sel.element.isConnected ? sel.element : null;
    if (sel && sel.anchor.node.isConnected && this.mode !== 'xml') this.design.applySelection(sel);
    this.app.onSelectionChange(this);
  }

  textBlockAt(pos: ModelPos): Element | null {
    return pos.node.isConnected ? ops.textBlockOf(pos.node, this.grammar) : null;
  }

  // ------------------------------------------------------------ keyboard ops
  insertTextAt(sel: ModelSelection, text: string, typing = false) {
    const g = this.grammar;
    this.exec('Typing', (s) => {
      const src = this.elementSelection ? s : sel;
      let pos: ModelPos;
      if (src.element && this.elementSelection) {
        const el = src.element;
        const p = ops.before(el);
        el.parentNode!.removeChild(el);
        pos = ops.normalizePos(p);
      } else if (!ops.isCollapsed(src)) {
        const [a, b] = ops.rangeOrdered(src);
        pos = ops.deleteRange(a, b, g);
      } else pos = src.anchor;
      return ops.caret(ops.insertText(pos, text, g));
    }, { merge: typing && text.length === 1 && !/\s/.test(text) ? 'typing' : typing ? 'typing' : undefined });
  }

  enterKey(sel: ModelSelection | null, _shift: boolean) {
    const g = this.grammar;
    this.exec('New paragraph', (s) => {
      let src = sel ?? s;
      if (this.elementSelection) src = ops.caret(ops.after(this.elementSelection));
      let pos = src.anchor;
      if (!ops.isCollapsed(src)) {
        const [a, b] = ops.rangeOrdered(src);
        pos = ops.deleteRange(a, b, g);
      }
      return ops.smartEnter(pos, g).sel;
    });
  }

  deleteKey(sel: ModelSelection | null, dir: -1 | 1, word: boolean, lineRange: ModelSelection | null) {
    const g = this.grammar;
    this.exec(dir < 0 ? 'Delete backward' : 'Delete forward', (s) => {
      if (this.elementSelection) {
        const el = this.elementSelection;
        return ops.deleteElement(el, g);
      }
      const src = sel ?? s;
      if (!ops.isCollapsed(src)) {
        const [a, b] = ops.rangeOrdered(src);
        return ops.caret(ops.deleteRange(a, b, g));
      }
      if (lineRange && !ops.isCollapsed(lineRange)) {
        const [a, b] = ops.rangeOrdered(lineRange);
        if (ops.textBlockOf(a.node, g) === ops.textBlockOf(b.node, g)) return ops.caret(ops.deleteRange(a, b, g));
      }
      return dir < 0 ? ops.backspace(src.anchor, g, { word }) : ops.deleteForward(src.anchor, g, { word });
    }, { merge: !word && !lineRange ? 'delete' + dir : undefined });
  }

  tabKey(shift: boolean) {
    const pos = this.currentPos();
    const entry = T.entryOf(pos.node);
    const g = this.grammar;
    if (entry) {
      let next = T.adjacentCell(entry, shift ? -1 : 1);
      if (!next && !shift) {
        this.exec('Insert row', () => {
          const row = T.insertRow(entry, 'below', g);
          const first = row.firstElementChild as Element;
          return ops.caret(ops.startOf(first, g));
        });
        return;
      }
      if (next) {
        const tb = ops.firstTextBlock(next, g) ?? next;
        const s = ops.startOf(tb, g);
        const e = ops.endOf(tb, g);
        this.doc.selection = { anchor: s, focus: e };
        this.design.applySelection(this.doc.selection);
        this.app.onSelectionChange(this);
      }
      return;
    }
    const item = this.nestable();
    if (item) {
      this.app.run(shift ? 'struct.promote' : 'struct.demote');
      return;
    }
  }

  /** Nearest list item / step / levelled paragraph at the caret. */
  nestable(): Element | null {
    const el = this.currentElement();
    return ops.closest(el, (e) => ['listItem', 'proceduralStep', 'levelledPara', 'attentionRandomListItem', 'attentionSequentialListItem', 'crewDrillStep'].includes(e.nodeName));
  }

  selectAllSmart() {
    const pos = this.currentPos();
    const g = this.grammar;
    const block = ops.textBlockOf(pos.node, g);
    const sel = this.doc.selection;
    if (block) {
      const s = ops.startOf(block, g);
      const e = ops.endOf(block, g);
      const already = sel && !ops.isCollapsed(sel) && sel.anchor.node === s.node && sel.anchor.offset === s.offset && sel.focus.node === e.node && sel.focus.offset === e.offset;
      if (!already) {
        this.doc.selection = { anchor: s, focus: e };
        this.design.applySelection(this.doc.selection, false);
        this.app.onSelectionChange(this);
        return;
      }
    }
    const content = this.doc.xml.getElementsByTagName('content')[0];
    if (content) {
      this.doc.selection = { anchor: ops.startOf(content, g), focus: ops.endOf(content, g) };
      this.design.applySelection(this.doc.selection, false);
      this.app.onSelectionChange(this);
    }
  }

  // ------------------------------------------------------------ clipboard
  copyTo(dt: DataTransfer, cut: boolean): boolean {
    const el = this.elementSelection;
    const sel = this.doc.selection;
    let frag: Node | null = null;
    let plain = '';
    if (el) {
      frag = el.cloneNode(true);
      plain = textOf(el);
    } else if (sel && !ops.isCollapsed(sel)) {
      const [a, b] = ops.rangeOrdered(sel);
      const r = this.doc.xml.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      frag = r.cloneContents();
      plain = r.toString();
    }
    if (!frag) return false;
    writeClipboard(dt, frag, plain);
    if (cut) {
      if (el) this.exec('Cut', () => ops.deleteElement(el, this.grammar));
      else this.deleteKey(sel, -1, false, null);
    }
    return true;
  }

  pasteFrom(dt: DataTransfer, plainOnly = false) {
    const files = Array.from(dt.files ?? []);
    if (files.length && files.every((f) => f.type.startsWith('image/'))) {
      this.app.openFigureDialog(this, files[0]);
      return;
    }
    const src = readClipboard(dt);
    this.pasteSource(src, plainOnly);
  }

  pasteSource(src: { xml?: string | null; html?: string | null; text?: string | null }, plainOnly = false) {
    const g = this.grammar;
    const doc = this.doc.xml;
    const inVerbatim = (() => {
      const p = this.currentPos();
      return !!ops.closestName(p.node, 'verbatimText');
    })();
    let frag: DocumentFragment | null = null;
    if (!plainOnly && src.xml) frag = xmlToFragment(src.xml, doc);
    if (!frag && !plainOnly && src.html && !inVerbatim) frag = htmlToFragment(src.html, doc, g);
    if ((!frag || !frag.childNodes.length) && src.text) frag = textToFragment(src.text, doc, !inVerbatim);
    if (!frag || !frag.childNodes.length) return;
    const f = frag;
    this.exec('Paste', (s) => {
      let sel = s;
      if (this.elementSelection) sel = ops.caret(ops.after(this.elementSelection));
      return insertFragment(sel, f, g);
    });
  }

  // ------------------------------------------------------------ structure commands
  insertElementNamed(name: string, prefer: 'after' | 'before' = 'after') {
    const g = this.grammar;
    this.exec(`Insert <${name}>`, (s) => {
      let pos = s.focus;
      if (this.elementSelection) pos = prefer === 'after' ? ops.after(this.elementSelection) : ops.before(this.elementSelection);
      else if (!ops.isCollapsed(s) && g?.has(name)) {
        // inline element with selected text: wrap
        const container = ops.containerElement(s.anchor);
        if (ops.allowsText(container, g) && g.childCandidates(container.nodeName).includes(name) && g.allowsText(name)) {
          const el = ops.wrapInline(s, name, g);
          return { anchor: ops.startOf(el, g), focus: ops.endOf(el, g) };
        }
      }
      return ops.insertElement(pos, name, g, { prefer }).sel;
    });
  }

  /** Inserts a structural block after the nearest ancestor of a given type (Word-like "new section"). */
  insertSibling(name: string, contextNames: string[], child = false) {
    const g = this.grammar;
    this.exec(`Insert <${name}>`, (s) => {
      const doc = this.doc.xml;
      const ctx = ops.closest(this.currentElementFrom(s), (e) => contextNames.includes(e.nodeName));
      const el = this.buildNew(name);
      if (ctx) {
        if (child && ops.canInsertAt(g, ctx, elementChildren(ctx).length, name)) ctx.appendChild(el);
        else if (!child && ops.canInsertAt(g, ctx.parentNode as Element, elementChildren(ctx.parentNode as Element).indexOf(ctx) + 1, name)) ctx.parentNode!.insertBefore(el, ctx.nextSibling);
        else {
          const ip = ops.findInsertionPoint(ctx, name, g, 'after');
          if (!ip) throw new ops.OpError(`<${name}> is not allowed here`);
          ip.parent.insertBefore(el, ip.ref);
        }
      } else {
        const r = ops.insertElement(s.focus, el, g);
        void r;
      }
      void doc;
      const tb = ops.firstTextBlock(el, g);
      return tb ? ops.caret(ops.startOf(tb, g)) : ops.caret(ops.after(el));
    });
  }

  private currentElementFrom(s: ModelSelection): Element {
    if (this.elementSelection) return this.elementSelection;
    const n = s.focus.node;
    return (n.nodeType === 1 ? n : n.parentNode) as Element;
  }

  /** Creates a new element with friendly default content. */
  buildNew(name: string): Element {
    const g = this.grammar;
    const doc = this.doc.xml;
    const el = ops.createSkeleton(doc, g, name);
    if (name === 'levelledPara') {
      if (!elementChildren(el).some((c) => c.nodeName === 'title')) el.insertBefore(createEl(doc, 'title'), el.firstChild);
      if (!elementChildren(el).some((c) => c.nodeName === 'para')) el.appendChild(createEl(doc, 'para'));
    }
    if (name === 'proceduralStep' || name === 'crewDrillStep') {
      for (const c of elementChildren(el)) if (c.nodeName === 'title') el.removeChild(c);
      if (!elementChildren(el).some((c) => c.nodeName === 'para')) el.appendChild(createEl(doc, 'para'));
    }
    return el;
  }

  wrapIn(name: string) {
    const g = this.grammar;
    this.exec(`Wrap in <${name}>`, (s) => {
      if (this.elementSelection) {
        const el = ops.wrapElements(this.elementSelection, this.elementSelection, name, g);
        return { anchor: ops.before(el), focus: ops.after(el), element: el };
      }
      if (ops.isCollapsed(s)) {
        // wrap the current block element
        const block = ops.textBlockOf(s.focus.node, g);
        if (!block) throw new ops.OpError('Select content to wrap');
        const el = ops.wrapElements(block, block, name, g);
        return ops.caret(ops.startOf(el, g));
      }
      const [a, b] = ops.rangeOrdered(s);
      const ba = ops.textBlockOf(a.node, g);
      const bb = ops.textBlockOf(b.node, g);
      if (ba && ba === bb) {
        const el = ops.wrapInline(s, name, g);
        return { anchor: ops.startOf(el, g), focus: ops.endOf(el, g) };
      }
      // multiple blocks: wrap the sibling range under their common parent
      const r = this.doc.xml.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      const common = r.commonAncestorContainer as Element;
      const first = topChild(common, a.node);
      const last = topChild(common, b.node);
      if (!first || !last) throw new ops.OpError('Select whole paragraphs to wrap');
      const el = ops.wrapElements(first, last, name, g);
      return ops.caret(ops.startOf(el, g));
    });
  }

  changeTo(name: string) {
    const g = this.grammar;
    const target = this.elementSelection ?? this.blockOrCurrent();
    if (!target) return;
    this.exec(`Change to <${name}>`, () => {
      const n = ops.rename(target, name, g);
      return this.elementSelection ? { anchor: ops.before(n), focus: ops.after(n), element: n } : ops.caret(ops.startOf(n, g));
    });
  }

  blockOrCurrent(): Element | null {
    const el = this.currentElement();
    return el;
  }

  removeTag(target?: Element | null) {
    const el = target ?? this.elementSelection ?? this.currentElement();
    if (!el || el === this.doc.root) return;
    this.exec(`Remove <${el.nodeName}> tag`, () => ops.unwrap(el, this.grammar));
  }

  deleteElement(target?: Element | null) {
    const el = target ?? this.elementSelection ?? this.currentElement();
    if (!el || el === this.doc.root) return;
    if (['content', 'identAndStatusSection', 'dmAddress', 'dmStatus'].includes(el.nodeName)) {
      this.app.toast(`<${el.nodeName}> is required and cannot be deleted`, 'warning');
      return;
    }
    this.exec(`Delete <${el.nodeName}>`, () => ops.deleteElement(el, this.grammar));
  }

  selectParent() {
    const el = this.currentElement();
    if (!el) return;
    const target = this.elementSelection ? (el.parentNode as Element) : ATOMIC.has(el.nodeName) ? el : el;
    if (target && target.nodeType === 1) this.selectElement(target, { scroll: true });
  }

  /** The block to move: selected element, or nearest movable block around the caret. */
  movable(): Element | null {
    if (this.elementSelection) return this.elementSelection;
    const el = this.currentElement();
    return ops.closest(el, (e) => ['levelledPara', 'proceduralStep', 'listItem', 'para', 'figure', 'table', 'note', 'warning', 'caution', 'row', 'definitionListItem', 'crewDrillStep'].includes(e.nodeName) && e.parentNode?.nodeType === 1 && !ATOMIC.has(e.nodeName));
  }

  move(dir: -1 | 1) {
    const el = this.movable();
    if (!el) return;
    const keepSel = this.doc.selection;
    this.exec(dir < 0 ? 'Move up' : 'Move down', () => {
      if (el.nodeName === 'row') T.assertRowMovable(el, dir);
      ops.moveElement(el, dir, this.grammar);
      return this.elementSelection ? { anchor: ops.before(el), focus: ops.after(el), element: el } : keepSel;
    });
  }

  demote() {
    const el = this.nestable();
    if (!el) return this.app.toast('Place the caret in a list item, step or levelled paragraph', 'info');
    const keep = this.doc.selection;
    this.exec(`Demote <${el.nodeName}>`, () => {
      ops.demote(el, this.grammar);
      return keep;
    });
  }

  promote() {
    const el = this.nestable();
    if (!el) return this.app.toast('Place the caret in a list item, step or levelled paragraph', 'info');
    const keep = this.doc.selection;
    this.exec(`Promote <${el.nodeName}>`, () => {
      ops.promote(el, this.grammar);
      return keep;
    });
  }

  toggleEmphasis(type: string) {
    const g = this.grammar;
    const matches = (e: Element) => e.nodeName === 'emphasis' && (e.getAttribute('emphasisType') ?? 'em01') === type;
    this.exec('Emphasis', (s) => ops.toggleInline(s, 'emphasis', { emphasisType: type }, matches, g));
  }

  toggleInlineEl(name: string) {
    const g = this.grammar;
    this.exec(`<${name}>`, (s) => ops.toggleInline(s, name, {}, (e) => e.nodeName === name, g));
  }

  isFormatActive(type: string): boolean {
    const el = this.currentElement();
    return !!ops.closest(el, (e) => e.nodeName === 'emphasis' && (e.getAttribute('emphasisType') ?? 'em01') === type);
  }

  isInside(name: string): boolean {
    return !!ops.closestName(this.currentElement(), name);
  }

  /** Can `name` be inserted somewhere around the caret? (for ribbon enablement) */
  canInsert(name: string): boolean {
    const g = this.grammar;
    if (!g) return true;
    if (!g.has(name)) return false;
    const pos = this.currentPos();
    const container = ops.containerElement(pos);
    if (ops.allowsText(container, g) && ops.inlineAllowedAt(ops.normalizePos(pos), name, g)) return true;
    const from = this.elementSelection ?? (pos.node.nodeType === 3 ? pos.node.parentNode! : pos.node);
    return !!ops.findInsertionPoint(from, name, g, 'after');
  }

  /** The element that text/structure would be inserted into/near at the caret, for UI context display. */
  insertionContainer(): Element | null {
    if (!this.grammar) return null;
    return this.elementSelection ?? ops.containerElement(this.currentPos());
  }

  /** Elements insertable at the caret, split into inline (at caret) and block (nearby structure) lists. */
  insertableElements(): { inline: string[]; block: string[] } {
    const g = this.grammar;
    if (!g) return { inline: [], block: [] };
    const pos = ops.normalizePos(this.currentPos());
    const container = ops.containerElement(pos);
    const inline: string[] = [];
    const block = new Set<string>();
    if (!this.elementSelection && ops.allowsText(container, g) && g.has(container.nodeName)) {
      const kids = elementChildren(container);
      let idx = 0;
      for (const k of kids) if (k.compareDocumentPosition(pos.node) & Node.DOCUMENT_POSITION_FOLLOWING || k === pos.node) idx++;
      if (pos.node.nodeType === 1 && pos.node === container) idx = kids.filter((k) => nodeIndex(k) < pos.offset).length;
      inline.push(...g.allowedAt(container.nodeName, kids.map((k) => k.nodeName), Math.min(idx, kids.length)));
    }
    // structural: positions around the current element chain
    let child: Element | null = this.elementSelection ?? container;
    let parent = child?.parentNode as Element | null;
    if (this.elementSelection === null && !ops.allowsText(container, g) && pos.node === container) {
      const kids = elementChildren(container);
      const idx = kids.filter((k) => nodeIndex(k) < pos.offset).length;
      g.allowedAt(container.nodeName, kids.map((k) => k.nodeName), idx).forEach((n) => block.add(n));
    }
    let depth = 0;
    while (child && parent && parent.nodeType === 1 && depth < 6) {
      if (g.has(parent.nodeName)) {
        const kids = elementChildren(parent);
        const i = kids.indexOf(child);
        g.allowedAt(parent.nodeName, kids.map((k) => k.nodeName), i + 1).forEach((n) => block.add(n));
      }
      if (parent.nodeName === 'content') break;
      child = parent;
      parent = parent.parentNode as Element | null;
      depth++;
    }
    return { inline: inline.sort(), block: [...block].filter((n) => !inline.includes(n)).sort() };
  }

  // ------------------------------------------------------------ attributes
  /**
   * Sets or removes an attribute as one undo step. An `id` is kept unique (a clash is refused and reported) and renaming one repoints
   * the references to it in the same step. Returns false when nothing was changed.
   */
  setAttribute(el: Element, name: string, value: string | null): boolean {
    if (name === 'infoEntityIdent' && value && !XML_NAME.test(value)) {
      this.app.toast(`"${value}" is not a valid ICN: use letters, digits, "-", "_", "." or ":", starting with a letter`, 'warning');
      return false;
    }
    if (name === 'id' && value) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
        this.app.toast(`"${value}" is not a valid ID: start with a letter or underscore, then letters, digits, "-", "_" or "."`, 'warning');
        return false;
      }
      if (idClash(this.doc.xml, value, el)) {
        this.app.toast(`The ID "${value}" is already used by another element`, 'warning');
        return false;
      }
    }
    this.exec(value == null ? `Remove @${name}` : `Set @${name}`, (s) => {
      const oldId = name === 'id' ? el.getAttribute('id') : null;
      if (value == null) removeAttr(el, name);
      else setAttr(el, name, value);
      if (oldId && value && oldId !== value) rewriteIdRefs(this.doc.xml, this.grammar, oldId, value);
      if (name === 'infoEntityIdent' && value) this.ensureEntity(value);
      return this.elementSelection === el ? { anchor: ops.before(el), focus: ops.after(el), element: el } : s;
    });
    return true;
  }

  /** Declares an ICN as an unparsed entity (DOCTYPE) when missing. */
  ensureEntity(icn: string, fileName?: string, notation?: string) {
    const decl = this.doc.doctype?.decls.find((d) => d.kind === 'entity' && d.name === icn);
    if (decl && !fileName) return;
    const ext = (fileName?.match(/\.([^.]+)$/)?.[1] ?? notation ?? this.app.settings.defaultNotation).toLowerCase();
    const not = ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext;
    const sys = fileName ?? `${icn}.${not === 'jpeg' ? 'jpg' : not}`;
    this.doc.setDoctype(withEntity(this.doc.doctype, this.doc.root.nodeName, icn, sys, not));
  }

  declareMissingEntities(): number {
    const used = usedEntities(this.doc);
    const declared = new Set((this.doc.doctype?.decls ?? []).filter((d) => d.kind === 'entity').map((d) => d.name));
    const missing = [...new Set(used.map((u) => u.name).filter((n) => !declared.has(n)))];
    if (!missing.length) return 0;
    this.exec('Declare ICN entities', (s) => {
      for (const m of missing) this.ensureEntity(m);
      return s;
    });
    return missing.length;
  }

  markChange(type: 'add' | 'modify' | 'delete' | null) {
    const el = this.elementSelection ?? ops.closest(this.currentElement(), (e) => !!this.grammar?.attribute(e.nodeName, 'changeMark'));
    if (!el) return this.app.toast('Change marks are not allowed on this element', 'info');
    this.exec(type ? 'Mark as changed' : 'Clear change mark', (s) => {
      if (type) {
        el.setAttribute('changeMark', '1');
        el.setAttribute('changeType', type);
      } else {
        el.removeAttribute('changeMark');
        el.removeAttribute('changeType');
        el.removeAttribute('reasonForUpdateRefIds');
      }
      return s;
    });
  }

  clearAllChangeMarks() {
    const els = Array.from(this.doc.xml.getElementsByTagName('*')).filter((e) => e.hasAttribute('changeMark') || e.hasAttribute('changeType'));
    if (!els.length) return this.app.toast('No change marks in this data module', 'info');
    this.exec('Clear all change marks', (s) => {
      for (const e of els) {
        e.removeAttribute('changeMark');
        e.removeAttribute('changeType');
        e.removeAttribute('reasonForUpdateRefIds');
      }
      for (const ci of Array.from(this.doc.xml.getElementsByTagName('changeInline'))) {
        while (ci.firstChild) ci.parentNode!.insertBefore(ci.firstChild, ci);
        ci.parentNode!.removeChild(ci);
      }
      return s;
    });
  }

  generateIds(): number {
    const g = this.grammar;
    const targets = ['levelledPara', 'figure', 'table', 'proceduralStep', 'warning', 'caution', 'note', 'graphic', 'multimedia', 'supportEquipDescr', 'supplyDescr', 'spareDescr'];
    const els = Array.from(this.doc.xml.getElementsByTagName('*')).filter((e) => targets.includes(e.nodeName) && !e.getAttribute('id') && (!g || g.attribute(e.nodeName, 'id')));
    if (!els.length) return 0;
    this.exec('Generate IDs', (s) => {
      for (const e of els) e.setAttribute('id', ops.uniqueId(this.doc.xml, idPrefixFor(e.nodeName)));
      return s;
    });
    return els.length;
  }

  // ------------------------------------------------------------ objects
  insertTable(o: T.NewTableOptions) {
    const g = this.grammar;
    this.exec('Insert table', (s) => {
      const t = T.createTable(this.doc.xml, g, o);
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, t, g);
      const firstEntry = t.getElementsByTagName('entry')[0];
      const title = t.getElementsByTagName('title')[0];
      return ops.caret(ops.startOf(title && !title.textContent ? title : firstEntry, g));
    });
  }

  /** Inserts (or replaces) a `<definitionList>` fully populated with one or more term/definition pairs. */
  insertDefinitionList(entries: { term: string; definition: string }[], headers?: { term: string; definition: string }, existing?: Element) {
    const g = this.grammar;
    const doc = this.doc.xml;
    const build = (): Element => {
      const dl = createEl(doc, 'definitionList');
      if (headers?.term || headers?.definition) {
        const hdr = createEl(doc, 'definitionListHeader');
        const tt = createEl(doc, 'termTitle');
        tt.appendChild(doc.createTextNode(headers.term || ' '));
        const dt = createEl(doc, 'definitionTitle');
        dt.appendChild(doc.createTextNode(headers.definition || ' '));
        hdr.append(tt, dt);
        dl.appendChild(hdr);
      }
      for (const { term, definition } of entries) {
        if (!term.trim() && !definition.trim()) continue;
        const item = createEl(doc, 'definitionListItem');
        const termEl = createEl(doc, 'listItemTerm');
        termEl.appendChild(doc.createTextNode(term.trim()));
        const defEl = createEl(doc, 'listItemDefinition');
        const p = createEl(doc, 'para');
        p.appendChild(doc.createTextNode(definition.trim()));
        defEl.appendChild(p);
        item.append(termEl, defEl);
        dl.appendChild(item);
      }
      return dl;
    };
    this.exec(existing ? 'Edit definition list' : 'Insert definition list', (s) => {
      const dl = build();
      if (existing) {
        existing.replaceWith(dl);
        return this.elementSelection === existing ? { anchor: ops.before(dl), focus: ops.after(dl), element: dl } : s;
      }
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, dl, g);
      return { anchor: ops.before(dl), focus: ops.after(dl), element: dl };
    });
  }

  insertFigure(o: { title: string; icn: string; fileName?: string; notation?: string; id?: string }) {
    const g = this.grammar;
    this.exec('Insert figure', (s) => {
      const doc = this.doc.xml;
      const fig = createEl(doc, 'figure');
      fig.setAttribute('id', o.id || ops.uniqueId(doc, 'fig'));
      const title = createEl(doc, 'title');
      title.appendChild(doc.createTextNode(o.title));
      const gr = createEl(doc, 'graphic');
      gr.setAttribute('infoEntityIdent', o.icn);
      fig.append(title, gr);
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, fig, g);
      this.ensureEntity(o.icn, o.fileName, o.notation);
      return { anchor: ops.before(fig), focus: ops.after(fig), element: fig };
    });
  }

  insertDmRef(code: DmCodeParts, opts: { techName?: string; infoName?: string; issueNumber?: string; inWork?: string } = {}) {
    const g = this.grammar;
    this.exec('Insert data module reference', (s) => {
      const doc = this.doc.xml;
      const ref = createEl(doc, 'dmRef');
      const ident = createEl(doc, 'dmRefIdent');
      const dc = createEl(doc, 'dmCode');
      writeDmCode(dc, code);
      ident.appendChild(dc);
      if (opts.issueNumber) {
        const ii = createEl(doc, 'issueInfo');
        ii.setAttribute('issueNumber', opts.issueNumber);
        ii.setAttribute('inWork', opts.inWork || '00');
        ident.appendChild(ii);
      }
      ref.appendChild(ident);
      if (opts.techName) {
        const items = createEl(doc, 'dmRefAddressItems');
        const title = createEl(doc, 'dmTitle');
        const tn = createEl(doc, 'techName');
        tn.appendChild(doc.createTextNode(opts.techName));
        title.appendChild(tn);
        if (opts.infoName) {
          const inn = createEl(doc, 'infoName');
          inn.appendChild(doc.createTextNode(opts.infoName));
          title.appendChild(inn);
        }
        items.appendChild(title);
        ref.appendChild(items);
      }
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, ref, g);
      return ops.caret(ops.normalizePos(ops.after(ref)));
    });
  }

  /**
   * Inserts (or edits) an `<acronym>` fully populated with its term and
   * definition, directly at the caret, as a single transaction — so there is
   * never a moment where an empty, differently-classified shell is in the
   * document for the caret to land in oddly.
   */
  insertAcronym(term: string, definition: string, existing?: Element) {
    const g = this.grammar;
    const doc = this.doc.xml;
    this.exec(existing ? 'Edit acronym' : 'Insert acronym', (s) => {
      let el: Element;
      if (existing) {
        el = existing;
        while (el.firstChild) el.removeChild(el.firstChild);
      } else {
        el = createEl(doc, 'acronym');
      }
      const termEl = createEl(doc, 'acronymTerm');
      termEl.appendChild(doc.createTextNode(term));
      el.appendChild(termEl);
      // acronymTerm and acronymDefinition are both mandatory in every issue: never emit a term alone
      const defEl = createEl(doc, 'acronymDefinition');
      if (definition) defEl.appendChild(doc.createTextNode(definition));
      el.appendChild(defEl);
      if (existing) return { anchor: ops.normalizePos(ops.after(el)), focus: ops.normalizePos(ops.after(el)) };
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, el, g);
      return ops.caret(ops.normalizePos(ops.after(el)));
    });
  }

  /** Inserts (or edits) an `<externalPubRef>` to a non-S1000D publication or document. */
  insertExternalPubRef(o: { code: string; title: string; issue: string; href: string }, existing?: Element) {
    const g = this.grammar;
    const doc = this.doc.xml;
    this.exec(existing ? 'Edit external publication reference' : 'Insert external publication reference', (s) => {
      let ref: Element;
      if (existing) {
        ref = existing;
        while (ref.firstChild) ref.removeChild(ref.firstChild);
      } else {
        ref = createEl(doc, 'externalPubRef');
      }
      if (o.href) setAttr(ref, 'xlink:href', o.href);
      else removeAttr(ref, 'xlink:href');
      const ident = createEl(doc, 'externalPubRefIdent');
      if (o.code) {
        const codeEl = createEl(doc, 'externalPubCode');
        codeEl.appendChild(doc.createTextNode(o.code));
        ident.appendChild(codeEl);
      }
      if (o.title) {
        const titleEl = createEl(doc, 'externalPubTitle');
        titleEl.appendChild(doc.createTextNode(o.title));
        ident.appendChild(titleEl);
      }
      if (o.issue) {
        const issueInfo = createEl(doc, 'externalPubIssueInfo');
        const issueEl = createEl(doc, 'externalPubIssue');
        issueEl.appendChild(doc.createTextNode(o.issue));
        issueInfo.appendChild(issueEl);
        ident.appendChild(issueInfo);
      }
      ref.appendChild(ident);
      if (existing) return { anchor: ops.normalizePos(ops.after(ref)), focus: ops.normalizePos(ops.after(ref)) };
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, ref, g);
      return ops.caret(ops.normalizePos(ops.after(ref)));
    });
  }

  insertInternalRef(target: Element) {
    const g = this.grammar;
    this.exec('Insert cross-reference', (s) => {
      const doc = this.doc.xml;
      const id = this.idOf(target);
      const ref = createEl(doc, 'internalRef');
      ref.setAttribute('internalRefId', id);
      const tt = INTERNAL_REF_TYPES[target.nodeName];
      if (tt && g?.attribute('internalRef', 'internalRefTargetType')) ref.setAttribute('internalRefTargetType', tt);
      const pos = this.elementSelection ? ops.after(this.elementSelection) : s.focus;
      ops.insertElement(pos, ref, g);
      return ops.caret(ops.normalizePos(ops.after(ref)));
    });
  }

  /** The id of `target`, generating one when it has none. Call inside a transaction. */
  private idOf(target: Element): string {
    let id = target.getAttribute('id');
    if (!id) {
      id = ops.uniqueId(this.doc.xml, idPrefixFor(target.nodeName));
      target.setAttribute('id', id);
    }
    return id;
  }

  /** Points an existing cross-reference at another element: the id and the target type that goes with it. */
  retargetInternalRef(ref: Element, target: Element) {
    this.exec('Change cross-reference', (s) => {
      ref.setAttribute('internalRefId', this.idOf(target));
      const tt = INTERNAL_REF_TYPES[target.nodeName];
      if (tt && this.grammar?.attribute('internalRef', 'internalRefTargetType')) ref.setAttribute('internalRefTargetType', tt);
      return s;
    });
  }

  followReference(el: Element) {
    if (el.nodeName === 'internalRef') {
      const id = el.getAttribute('internalRefId');
      const t = id ? ops.findById(this.doc.xml, id) : null;
      if (t) this.selectElement(t, { scroll: true });
      else this.app.toast(`Target "${id}" not found`, 'warning');
    } else if (el.nodeName === 'dmRef') {
      this.app.openReferencedDm(el);
    }
  }

  tableOp(op: string, arg?: string) {
    const pos = this.currentPos();
    const entry = T.entryOf(this.elementSelection ?? pos.node);
    const g = this.grammar;
    if (!entry && op !== 'deleteTable' && op !== 'frame') return this.app.toast('Place the caret in a table cell', 'info');
    const labels: Record<string, string> = {
      rowAbove: 'Insert row above', rowBelow: 'Insert row below', colLeft: 'Insert column left', colRight: 'Insert column right', deleteRow: 'Delete row',
      deleteCol: 'Delete column', mergeRight: 'Merge cells right', mergeDown: 'Merge cells down', split: 'Split cell', header: 'Toggle header row', deleteTable: 'Delete table',
    };
    this.exec(labels[op] ?? op, (s) => {
      const e = entry!;
      switch (op) {
        case 'rowAbove': { const r = T.insertRow(e, 'above', g); return ops.caret(ops.startOf(r.firstElementChild ?? r, g)); }
        case 'rowBelow': { const r = T.insertRow(e, 'below', g); return ops.caret(ops.startOf(r.firstElementChild ?? r, g)); }
        case 'colLeft': T.insertColumn(e, 'left', g); return s;
        case 'colRight': T.insertColumn(e, 'right', g); return s;
        case 'deleteRow': {
          const next = (e.parentNode as Element).nextElementSibling ?? (e.parentNode as Element).previousElementSibling;
          T.deleteRow(e);
          const tgt = next?.isConnected ? next.querySelector('entry') : null;
          return tgt ? ops.caret(ops.startOf(tgt, g)) : s;
        }
        case 'deleteCol': {
          const sib = e.nextElementSibling ?? e.previousElementSibling;
          T.deleteColumn(e);
          return sib?.isConnected ? ops.caret(ops.startOf(sib, g)) : ops.caret(ops.startOf(T.tgroupOf(e) ?? this.doc.root, g));
        }
        case 'mergeRight': T.mergeRight(e); return ops.caret(ops.startOf(e, g));
        case 'mergeDown': T.mergeDown(e); return ops.caret(ops.startOf(e, g));
        case 'split': T.splitCell(e, g); return ops.caret(ops.startOf(e, g));
        case 'header': T.toggleHeaderRow(e); return s;
        case 'deleteTable': {
          const t = T.tableOf(entry ?? this.elementSelection ?? pos.node);
          if (!t) throw new ops.OpError('Not inside a table');
          return ops.deleteElement(t, g);
        }
        case 'frame': {
          const t = T.tableOf(e);
          if (t && arg) t.setAttribute('frame', arg);
          return s;
        }
        case 'align':
          if (arg) e.setAttribute('align', arg);
          else e.removeAttribute('align');
          return s;
        case 'valign':
          if (arg) e.setAttribute('valign', arg);
          else e.removeAttribute('valign');
          return s;
      }
      return s;
    });
  }

  /** Current cell's horizontal/vertical alignment (own attribute, or the column's default). */
  cellAlignment(): { align: string; valign: string } | null {
    const entry = T.entryOf(this.elementSelection ?? this.currentPos().node);
    if (!entry) return null;
    const tg = T.tgroupOf(entry);
    const grid = tg ? T.buildGrid(tg) : null;
    const cell = grid?.cellOf.get(entry);
    const colAlign = cell && grid ? grid.colspecs[cell.col]?.getAttribute('align') : null;
    return { align: entry.getAttribute('align') ?? colAlign ?? 'left', valign: entry.getAttribute('valign') ?? 'top' };
  }

  /** Commits a live column-resize drag (boundary between column `i` and `i + 1`, new widths in px) as a single undo step. */
  resizeTableColumns(tg: Element, i: number, widthA: number, widthB: number) {
    let done = true;
    this.exec('Resize table column', (s) => {
      done = T.resizeColumnPair(tg, i, widthA, widthB);
      return s;
    });
    if (!done) {
      this.design.render(); // drop the live drag widths
      this.app.toast('These columns have a mixed width (for example 1*+10pt): change it in Table properties.', 'info');
    }
  }

  /** Commits a live image-resize drag (`reproductionWidth`/`reproductionHeight`, in mm) as a single undo step. */
  resizeGraphic(graphic: Element, widthMm: number, heightMm: number) {
    this.exec('Resize image', (s) => {
      graphic.setAttribute('reproductionWidth', `${Math.round(widthMm * 10) / 10}mm`);
      graphic.setAttribute('reproductionHeight', `${Math.round(heightMm * 10) / 10}mm`);
      return s;
    });
  }

  insertSpecialChar(ch: string) {
    const sel = this.doc.selection ?? ops.caret(this.currentPos());
    this.insertTextAt(sel, ch);
  }

  // ------------------------------------------------------------ find / replace
  showIssueLocation(i: ValidationIssue) {
    let node: Node | null | undefined = i.node;
    if (!node && i.line) node = this.elementAtLine(i.line);
    if (this.mode === 'xml' && i.line) {
      this.xml.gotoLine(i.line);
      return;
    }
    if (node && node.isConnected) {
      const el = (node.nodeType === 1 ? node : node.parentNode) as Element;
      if (ATOMIC.has(el.nodeName) || ATOMIC_BLOCK.has(el.nodeName) || this.mode === 'tags') this.selectElement(el, { scroll: true });
      else {
        this.design.reveal(el);
        const tb = ops.firstTextBlock(el, this.grammar);
        if (tb) {
          this.doc.selection = ops.caret(ops.startOf(tb, this.grammar));
          this.design.applySelection(this.doc.selection, false);
          this.app.onSelectionChange(this);
        } else this.selectElement(el, { scroll: true });
      }
      if (this.mode === 'split') {
        const sp = this.spanOf(el);
        if (sp) this.xml.focusRange(sp[0], sp[1], true);
      }
    } else if (i.line) {
      if (this.mode === 'design' || this.mode === 'tags') this.setMode('split');
      this.xml.gotoLine(i.line);
    }
  }

  destroy() {
    this.liveValidate.cancel();
    this.autosave.cancel();
    this.xml.destroy();
    this.design.destroy();
    this.el.remove();
  }
}

function topChild(common: Node, n: Node): Element | null {
  let c: Node | null = n;
  while (c && c.parentNode !== common) c = c.parentNode;
  return c && c.nodeType === 1 ? (c as Element) : null;
}

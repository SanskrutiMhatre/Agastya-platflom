/**
 * Design / Tags view: a contenteditable WYSIWYG surface whose every edit is
 * routed through model operations (beforeinput is intercepted), so the XML
 * model stays the single source of truth and the views can never diverge.
 */
import type { ChangeEvent, ModelPos, ModelSelection } from '../core/document';
import { ATOMIC, ATOMIC_BLOCK } from '../core/display';
import { nodeIndex } from '../core/xml';
import { buildGrid } from '../core/table';
import { Renderer } from './render';
import { internalRefLabel } from './labels';
import type { DocumentEditor } from '../ui/editor';

export class DesignView {
  /** A host (the platform) can open every document with the identification section folded away; the standalone Studio keeps it open. */
  static defaultIdentCollapsed = false;
  readonly el: HTMLElement;
  readonly page: HTMLElement;
  renderer!: Renderer;
  showTags: boolean;
  identCollapsed = DesignView.defaultIdentCollapsed;
  private composing: ModelSelection | null = null;
  private selectedDom: Element | null = null;
  private suppressSelection = 0;
  private visible = false;
  private needsRender = true;

  constructor(private host: DocumentEditor, showTags: boolean) {
    this.showTags = showTags;
    this.el = document.createElement('div');
    this.el.className = 'design-scroll' + (showTags ? ' tags-on' : '');
    this.page = document.createElement('div');
    this.page.className = 'design-page';
    this.page.contentEditable = 'true';
    this.page.spellcheck = host.app.settings.spellcheck;
    this.page.setAttribute('role', 'textbox');
    this.page.setAttribute('aria-multiline', 'true');
    this.page.setAttribute('aria-label', showTags ? 'Tags view' : 'Design view');
    this.page.setAttribute('translate', 'no');
    this.el.appendChild(this.page);
    this.bind();
  }

  get doc() { return this.host.doc; }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.hidden = !v;
    if (v && this.needsRender) this.render();
  }

  setTags(on: boolean) {
    this.showTags = on;
    this.el.classList.toggle('tags-on', on);
    this.page.setAttribute('aria-label', on ? 'Tags view' : 'Design view');
    this.needsRender = true;
    if (this.visible) this.render();
  }

  // ------------------------------------------------------------- rendering
  render() {
    this.needsRender = false;
    this.renderer = new Renderer(this.doc.xml, {
      grammar: this.doc.grammar,
      showTags: this.showTags,
      images: this.host.app.images.resolver,
      identCollapsed: this.identCollapsed,
    });
    const t0 = performance.now();
    this.page.replaceChildren(this.renderer.renderDocument());
    this.host.app.perf('render', performance.now() - t0);
    this.selectedDom = null;
    if (this.host.elementSelection) this.markSelected(this.host.elementSelection);
  }

  invalidate() {
    this.needsRender = true;
    if (this.visible) this.render();
  }

  /** Applies model changes with minimal DOM updates. */
  onModelChange(ev: ChangeEvent) {
    if (!this.visible || this.needsRender || !this.renderer) {
      this.needsRender = true;
      return;
    }
    const r = this.renderer;
    const reRender = new Set<Node>();
    // the identification header summarises descendants (DMC, titles): refresh it on any change inside
    const ident = this.doc.root ? Array.from(this.doc.root.children).find((c) => c.nodeName === 'identAndStatusSection') : undefined;
    if (ident && ev.records.some((rec) => ident.contains(rec.target))) reRender.add(ident);
    for (const rec of ev.records) {
      if (rec.type === 'characterData') {
        const d = r.domOf.get(rec.target);
        if (d && d.isConnected && rec.target.isConnected) {
          if (d.nodeValue !== rec.target.nodeValue) d.nodeValue = rec.target.nodeValue;
          continue;
        }
        if (rec.target.parentNode) reRender.add(rec.target.parentNode);
        continue;
      }
      reRender.add(rec.target);
    }
    if (ev.doctypeChanged) {
      // graphics may resolve differently
    }
    // map to nearest rendered, connected elements; tables re-render as a whole
    const targets = new Set<Node>();
    for (let n of reRender) {
      if (!n.isConnected || n.nodeType === 9) {
        targets.add(this.doc.root);
        continue;
      }
      const tbl = closestXml(n, 'table') ?? closestXml(n, 'tgroup');
      if (tbl) n = tbl;
      // attribute changes on an element inside the identification header affect its summary line
      let cur: Node | null = n;
      while (cur && !(r.domOf.get(cur) && r.domOf.get(cur)!.isConnected)) cur = cur.parentNode;
      targets.add(cur && cur.nodeType === 1 ? cur : this.doc.root);
    }
    const list = [...targets].filter((t) => ![...targets].some((o) => o !== t && o.contains(t)));
    if (list.length && list.some((t) => t === this.doc.root || t.nodeType === 9)) {
      this.render();
      return;
    }
    r.refreshIndexes();
    for (const t of list) this.rerender(t as Element);
    this.refreshGenerated();
  }

  rerender(el: Element) {
    const r = this.renderer;
    const old = r.domOf.get(el) as Element | undefined;
    if (!old || !old.isConnected) {
      this.render();
      return;
    }
    const fresh = r.renderNode(el);
    if (fresh) old.replaceWith(fresh);
    else old.remove();
    if (this.selectedDom && !this.selectedDom.isConnected) {
      this.selectedDom = null;
      if (this.host.elementSelection) this.markSelected(this.host.elementSelection);
    }
  }

  /** Updates numbering, captions and cross-reference labels after structural edits. */
  refreshGenerated() {
    const r = this.renderer;
    const idx = r.labels;
    for (const num of Array.from(this.page.querySelectorAll('.x-num'))) {
      const hostDom = num.parentElement;
      const x = hostDom ? (r.xmlOf.get(hostDom) as Element | undefined) : undefined;
      if (!x) continue;
      const target = x.nodeName === 'title' ? (x.parentNode as Element) : x;
      const n = idx.numbers.get(target) ?? '';
      const txt = target.nodeName === 'figure' ? `Fig ${n}` : target.nodeName === 'table' ? `Table ${n}` : n;
      if (num.textContent !== txt) num.textContent = txt;
    }
    // the caption of a table without a title ("Table 3") renumbers like the numbered titles do
    for (const cap of Array.from(this.page.querySelectorAll('.x-caption-standalone'))) {
      const x = cap.parentElement ? (r.xmlOf.get(cap.parentElement) as Element | undefined) : undefined;
      if (!x || x.nodeName !== 'table') continue;
      const txt = `Table ${idx.numbers.get(x) ?? ''}`;
      if (cap.textContent !== txt) cap.textContent = txt;
    }
    for (const chip of Array.from(this.page.querySelectorAll('[data-x="internalRef"]'))) {
      const x = r.xmlOf.get(chip) as Element | undefined;
      if (!x) continue;
      const label = internalRefLabel(x, idx);
      const textNode = Array.from(chip.childNodes).find((c) => c.nodeType === 3);
      if (textNode && textNode.nodeValue !== label) textNode.nodeValue = label;
      chip.classList.toggle('x-chip-broken', label.startsWith('⚠'));
    }
  }

  // ----------------------------------------------------- selection mapping
  /** DOM boundary -> model position. */
  domToModel(node: Node, offset: number): ModelPos | null {
    const r = this.renderer;
    if (!r || !this.page.contains(node)) return null;
    // inside generated content: resolve to the boundary of the generated node
    let n: Node | null = node;
    let genRoot: Element | null = null;
    while (n && n !== this.page) {
      if (n.nodeType === 1 && (n as Element).hasAttribute('data-gen')) genRoot = n as Element;
      n = n.parentNode;
    }
    if (genRoot && genRoot.parentNode) {
      const parent = genRoot.parentNode;
      const isEnd = genRoot.classList.contains('x-tag-end');
      node = parent;
      offset = nodeIndex(genRoot) + (isEnd ? 0 : 1);
    }
    if (node.nodeType === 3) {
      const x = r.xmlOf.get(node);
      if (x && x.nodeType === 3) return { node: x, offset: Math.min(offset, x.nodeValue!.length) };
      if (r.placeholders.has(node)) {
        const ownerDom = node.parentNode!;
        const owner = r.xmlOf.get(ownerDom);
        if (owner) return { node: owner, offset: 0 };
      }
      offset = nodeIndex(node) + (offset > 0 ? 1 : 0);
      node = node.parentNode!;
    }
    // element position: climb to the nearest mapped element
    let dom: Node | null = node;
    while (dom && dom !== this.page && !r.xmlOf.get(dom)) {
      offset = nodeIndex(dom) + (offset > 0 ? 1 : 0);
      dom = dom.parentNode;
    }
    if (!dom || dom === this.page) {
      const root = this.doc.root;
      return root ? { node: root, offset: offset > 0 ? root.childNodes.length : 0 } : null;
    }
    const x = r.xmlOf.get(dom)!;
    if (x.nodeType === 3) return { node: x, offset: 0 };
    const xel = x as Element;
    if (ATOMIC.has(xel.nodeName) || ATOMIC_BLOCK.has(xel.nodeName)) {
      const p = xel.parentNode!;
      return { node: p, offset: nodeIndex(xel) + (offset > 0 ? 1 : 0) };
    }
    // count mapped children before offset
    let k = 0;
    const kids = dom.childNodes;
    for (let i = Math.min(offset, kids.length) - 1; i >= 0; i--) {
      const cx = r.xmlOf.get(kids[i]);
      if (cx && cx.parentNode === xel) {
        k = nodeIndex(cx) + 1;
        break;
      }
    }
    return { node: xel, offset: k };
  }

  /** Model position -> DOM boundary. */
  modelToDom(pos: ModelPos): { node: Node; offset: number } | null {
    const r = this.renderer;
    if (!r) return null;
    if (pos.node.nodeType === 3 || pos.node.nodeType === 4) {
      const d = r.domOf.get(pos.node);
      if (d && d.isConnected) return { node: d, offset: Math.min(pos.offset, d.nodeValue!.length) };
      return pos.node.parentNode ? this.modelToDom({ node: pos.node.parentNode, offset: nodeIndex(pos.node) }) : null;
    }
    const el = pos.node as Element;
    if (pos.node.nodeType === 9) {
      // The root element itself may have no rendered node yet (view detached or not rendered): climbing from it would end here again.
      const rootDom = r.domOf.get(this.doc.root);
      return rootDom && rootDom.isConnected ? this.modelToDom({ node: this.doc.root, offset: 0 }) : null;
    }
    let dEl = r.domOf.get(el) as Element | undefined;
    if (!dEl || !dEl.isConnected) {
      return el.parentNode ? this.modelToDom({ node: el.parentNode, offset: nodeIndex(el) }) : null;
    }
    if (ATOMIC.has(el.nodeName) || ATOMIC_BLOCK.has(el.nodeName)) {
      return { node: dEl.parentNode!, offset: nodeIndex(dEl) + 1 };
    }
    const kids = el.childNodes;
    for (let i = pos.offset; i < kids.length; i++) {
      const d = r.domOf.get(kids[i]);
      if (d && d.isConnected && d.parentNode) {
        if (d.nodeType === 3) return { node: d, offset: 0 };
        return { node: d.parentNode, offset: nodeIndex(d) };
      }
    }
    for (let i = Math.min(pos.offset, kids.length) - 1; i >= 0; i--) {
      const d = r.domOf.get(kids[i]);
      if (d && d.isConnected && d.parentNode) {
        if (d.nodeType === 3) return { node: d, offset: d.nodeValue!.length };
        return { node: d.parentNode, offset: nodeIndex(d) + 1 };
      }
    }
    // empty element: after leading generated nodes, at the placeholder
    if (dEl.nodeName === 'TABLE') dEl = dEl.querySelector('td,th') ?? dEl;
    const ch = Array.from(dEl.childNodes);
    const ph = ch.find((c) => (c.nodeType === 3 && r.placeholders.has(c)) || (c as Element).getAttribute?.('data-gen') === 'br');
    if (ph) return ph.nodeType === 3 ? { node: ph, offset: 1 } : { node: dEl, offset: nodeIndex(ph) };
    let i = 0;
    while (i < ch.length && (ch[i] as Element).hasAttribute?.('data-gen') && !(ch[i] as Element).classList.contains('x-tag-end')) i++;
    return { node: dEl, offset: i };
  }

  readSelection(): ModelSelection | null {
    const s = window.getSelection();
    if (!s || !s.anchorNode || !this.page.contains(s.anchorNode) || !this.renderer) return null;
    const a = this.domToModel(s.anchorNode, s.anchorOffset);
    const f = s.focusNode ? this.domToModel(s.focusNode, s.focusOffset) : a;
    if (!a || !f) return null;
    return { anchor: a, focus: f };
  }

  applySelection(sel: ModelSelection | null, scroll = true) {
    if (!sel || !this.visible || !this.renderer) return;
    if (this.needsRender) this.render();
    this.markSelected(sel.element ?? null);
    const s = window.getSelection();
    if (!s) return;
    if (sel.element) {
      const d = this.renderer.domOf.get(sel.element) as Element | undefined;
      if (d && d.isConnected) {
        this.suppressSelection++;
        try {
          const range = document.createRange();
          if (d.getAttribute('contenteditable') === 'false' || d.nodeName === 'TABLE') range.selectNode(d);
          else range.selectNodeContents(d);
          s.removeAllRanges();
          s.addRange(range);
        } finally {
          queueMicrotask(() => this.suppressSelection--);
        }
        if (scroll) (d as HTMLElement).scrollIntoView?.({ block: 'nearest' });
      }
      return;
    }
    const a = this.modelToDom(sel.anchor);
    const f = this.modelToDom(sel.focus);
    if (!a || !f) return;
    this.suppressSelection++;
    try {
      if (document.activeElement !== this.page && this.host.app.isEditorFocusIntended()) this.page.focus({ preventScroll: true });
      s.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    } catch {
      /* ignore invalid ranges */
    } finally {
      queueMicrotask(() => this.suppressSelection--);
    }
    if (scroll) this.scrollToCaret();
  }

  scrollToCaret() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return;
    const range = s.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const n = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
      if (!n) return;
      rect = n.getBoundingClientRect();
    }
    const box = this.el.getBoundingClientRect();
    if (rect.top < box.top + 20) this.el.scrollTop -= box.top + 40 - rect.top;
    else if (rect.bottom > box.bottom - 20) this.el.scrollTop += rect.bottom - box.bottom + 40;
  }

  markSelected(el: Element | null) {
    this.selectedDom?.classList.remove('x-selected');
    this.selectedDom = null;
    if (el && this.renderer) {
      const d = this.renderer.domOf.get(el) as Element | undefined;
      if (d) {
        d.classList.add('x-selected');
        this.selectedDom = d;
      }
    }
  }

  /** Scrolls an element into view and flashes it (navigation from tree / problems / XML view). */
  reveal(el: Element, flash = true) {
    if (!this.renderer) return;
    if (this.needsRender) this.render();
    let n: Node | null = el;
    let d: Element | undefined;
    while (n && !(d = this.renderer.domOf.get(n) as Element | undefined)) n = n.parentNode;
    if (!d) return;
    if (this.identCollapsed && closestXml(el, 'identAndStatusSection')) {
      this.identCollapsed = false;
      this.render();
      d = this.renderer.domOf.get(n!) as Element;
    }
    const target = d.nodeType === 1 ? d : d.parentElement!;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    if (flash) {
      target.classList.remove('x-flash');
      void (target as HTMLElement).offsetWidth;
      target.classList.add('x-flash');
      setTimeout(() => target.classList.remove('x-flash'), 1200);
    }
  }

  /** Highlights find matches using the CSS Custom Highlight API. */
  highlight(ranges: [ModelPos, ModelPos][], current: number) {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HL = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !HL) return;
    if (!ranges.length || !this.visible) {
      reg.delete('find');
      reg.delete('find-current');
      return;
    }
    const all: Range[] = [];
    let cur: Range | null = null;
    ranges.forEach(([a, b], i) => {
      const da = this.modelToDom(a);
      const db = this.modelToDom(b);
      if (!da || !db) return;
      const r = document.createRange();
      try {
        r.setStart(da.node, da.offset);
        r.setEnd(db.node, db.offset);
      } catch {
        return;
      }
      if (i === current) cur = r;
      else all.push(r);
    });
    reg.set('find', new HL(...all));
    if (cur) reg.set('find-current', new HL(cur));
    else reg.delete('find-current');
  }

  // ---------------------------------------------------------------- events
  private bind() {
    const p = this.page;
    p.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    p.addEventListener('compositionstart', () => {
      const sel = this.readSelection();
      this.composing = sel;
    });
    p.addEventListener('compositionend', (e) => this.onCompositionEnd(e));
    p.addEventListener('keydown', (e) => this.onKeyDown(e));
    p.addEventListener('mousedown', (e) => this.onMouseDown(e));
    p.addEventListener('dblclick', (e) => this.onDblClick(e));
    p.addEventListener('click', (e) => this.onClick(e));
    p.addEventListener('contextmenu', (e) => {
      if (e.shiftKey) return; // native menu (spelling suggestions)
      e.preventDefault();
      const target = this.xmlTargetFromEvent(e);
      if (target && (ATOMIC.has(target.nodeName) || ATOMIC_BLOCK.has(target.nodeName) || (e.target as Element).closest?.('.x-tag'))) {
        this.host.selectElement(target);
      } else {
        const s = window.getSelection();
        const inside = s && s.rangeCount && !s.isCollapsed && s.getRangeAt(0).isPointInRange(...caretPoint(e));
        if (!inside) {
          const cp = caretFromPoint(e.clientX, e.clientY);
          if (cp && this.page.contains(cp.node)) s?.setBaseAndExtent(cp.node, cp.offset, cp.node, cp.offset);
        }
        this.host.onDomSelection();
      }
      this.host.app.showContextMenu(e.clientX, e.clientY, e.button !== 2);
    });
    p.addEventListener('copy', (e) => {
      if (this.host.copyTo(e.clipboardData!, false)) e.preventDefault();
    });
    p.addEventListener('cut', (e) => {
      if (this.host.copyTo(e.clipboardData!, true)) e.preventDefault();
    });
    p.addEventListener('paste', (e) => {
      e.preventDefault();
      const plain = performance.now() - this.host.plainPasteAt < 1500;
      this.host.plainPasteAt = -Infinity;
      this.host.pasteFrom(e.clipboardData!, plain);
    });
    p.addEventListener('dragstart', (e) => e.preventDefault());
    p.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      } else e.preventDefault();
    });
    p.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length) {
        this.host.app.dropFiles(files, this.host);
        return;
      }
      const text = e.dataTransfer?.getData('text/plain');
      if (text) {
        const cp = caretFromPoint(e.clientX, e.clientY);
        if (cp) {
          const pos = this.domToModel(cp.node, cp.offset);
          if (pos) this.host.insertTextAt({ anchor: pos, focus: pos }, text);
        }
      }
    });
    document.addEventListener('selectionchange', this.onSelectionChange);
  }

  /** A document listener: it must be removed with the view, or every closed document stays alive through it. */
  private onSelectionChange = () => {
    if (this.suppressSelection > 0 || !this.visible) return;
    const s = window.getSelection();
    if (!s || !s.anchorNode || !this.page.contains(s.anchorNode)) return;
    this.host.onDomSelection();
  };

  destroy() {
    document.removeEventListener('selectionchange', this.onSelectionChange);
  }

  private xmlTargetFromEvent(e: Event): Element | null {
    let t = e.target as Node | null;
    while (t && t !== this.page) {
      const x = this.renderer?.xmlOf.get(t);
      if (x && x.nodeType === 1) return x as Element;
      t = t.parentNode;
    }
    return null;
  }

  private onMouseDown(e: MouseEvent) {
    const t = e.target as Element;
    if (t.classList.contains('x-col-resize') && e.button === 0) {
      e.preventDefault();
      this.startColumnResize(e, t as HTMLElement);
      return;
    }
    if (t.classList.contains('x-resize-handle') && e.button === 0) {
      e.preventDefault();
      this.startImageResize(e, t as HTMLElement);
      return;
    }
    if (t.closest?.('[data-action="toggle-ident"]')) {
      e.preventDefault();
      return;
    }
    const tag = t.closest?.('.x-tag');
    const chip = t.closest?.('.x-atomic, .x-atomic-block');
    if ((tag || chip) && e.button === 0) {
      e.preventDefault();
      const x = this.xmlTargetFromEvent(e);
      if (x) {
        if (document.activeElement !== this.page) this.page.focus({ preventScroll: true });
        this.host.selectElement(x);
      }
    }
  }

  /**
   * Drags the boundary between column `data-col-resize` and the next one: the two columns trade width live (every other column keeps
   * its rendered width) and the result is committed as one undo step on release, in the unit each column is written in (`n*` or an
   * absolute length, see `resizeColumnPair`).
   */
  private startColumnResize(e: MouseEvent, handle: HTMLElement) {
    const td = handle.closest('td, th') as HTMLElement | null;
    const table = handle.closest('table.x-tgroup') as HTMLTableElement | null;
    if (!td || !table) return;
    const tg = this.renderer.xmlOf.get(table) as Element | undefined;
    if (!tg) return;
    const colIndex = parseInt(handle.dataset.colResize!, 10);
    const grid = buildGrid(tg);
    // rendered width of every column, read from its single-column cells
    const px: number[] = Array(grid.cols).fill(0);
    for (const cell of Array.from(table.querySelectorAll<HTMLElement>('td, th'))) {
      const entry = this.renderer.xmlOf.get(cell) as Element | undefined;
      const c = entry ? grid.cellOf.get(entry) : undefined;
      if (c && c.colspan === 1 && !px[c.col]) px[c.col] = cell.getBoundingClientRect().width;
    }
    const fallback = (table.getBoundingClientRect().width || 1) / Math.max(1, grid.cols);
    for (let i = 0; i < px.length; i++) if (!px[i]) px[i] = fallback;
    const startX = e.clientX;
    const startA = px[colIndex] ?? fallback;
    const startB = px[colIndex + 1] ?? fallback;
    const minW = Math.min(40, (startA + startB) * 0.25);
    const delta = (ev: MouseEvent) => Math.max(minW - startA, Math.min(startB - minW, ev.clientX - startX));
    const cols = Array.from(table.querySelectorAll(':scope > colgroup > col')) as HTMLElement[];
    const original = cols.map((c) => c.style.width);
    handle.classList.add('x-resizing');
    const move = (ev: MouseEvent) => {
      const d = delta(ev);
      if (cols[colIndex]) cols[colIndex].style.width = `${startA + d}px`;
      if (cols[colIndex + 1]) cols[colIndex + 1].style.width = `${startB - d}px`;
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      handle.classList.remove('x-resizing');
      const d = delta(ev);
      if (Math.abs(d) < 1) {
        cols.forEach((c, i) => { c.style.width = original[i]; });
        return;
      }
      this.host.resizeTableColumns(tg, colIndex, startA + d, startB - d);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /** Drags a graphic's corner/edge handle, scaling width and height together (aspect ratio kept unless Shift is held), committed in mm as one undo step. */
  private startImageResize(e: MouseEvent, handle: HTMLElement) {
    const wrap = handle.closest('.x-graphic-wrap') as HTMLElement | null;
    const img = wrap?.querySelector('img') as HTMLImageElement | null;
    const block = handle.closest('.x-atomic-block');
    if (!wrap || !img || !block) return;
    const graphic = this.renderer.xmlOf.get(block) as Element | undefined;
    if (!graphic) return;
    const dir = handle.dataset.resizeHandle!;
    const rect = img.getBoundingClientRect();
    const aspect = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : rect.width / rect.height || 1;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startX = e.clientX;
    const startY = e.clientY;
    const containerWidth = (wrap.parentElement?.getBoundingClientRect().width ?? startWidth) || startWidth;
    const PX_PER_MM = 96 / 25.4;
    handle.classList.add('x-resizing');
    // the aspect ratio stays locked; holding Shift frees it (an edge handle then changes one dimension, a corner both)
    const sizeFor = (ev: MouseEvent): { w: number; h: number } => {
      const dx = dir.includes('e') ? ev.clientX - startX : dir.includes('w') ? startX - ev.clientX : 0;
      const dy = dir.includes('s') ? ev.clientY - startY : dir.includes('n') ? startY - ev.clientY : 0;
      if (ev.shiftKey) return { w: Math.min(containerWidth, Math.max(24, startWidth + dx)), h: Math.max(24, startHeight + dy) };
      const w = Math.min(containerWidth, Math.max(24, startWidth + (dir === 'n' || dir === 's' ? dy * aspect : dx)));
      return { w, h: w / aspect };
    };
    const move = (ev: MouseEvent) => {
      const { w, h } = sizeFor(ev);
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      handle.classList.remove('x-resizing');
      const { w, h } = sizeFor(ev);
      if (Math.abs(w - startWidth) < 1 && Math.abs(h - startHeight) < 1) return;
      this.host.resizeGraphic(graphic, w / PX_PER_MM, h / PX_PER_MM);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  private onClick(e: MouseEvent) {
    const t = e.target as Element;
    if (t.closest?.('[data-action="toggle-ident"]')) {
      this.identCollapsed = !this.identCollapsed;
      const ident = this.doc.root ? Array.from(this.doc.root.children).find((c) => c.nodeName === 'identAndStatusSection') : null;
      if (ident) {
        this.renderer.opts.identCollapsed = this.identCollapsed;
        this.rerender(ident);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const chip = t.closest?.('[data-x="internalRef"], [data-x="dmRef"]');
      if (chip) {
        const x = this.renderer.xmlOf.get(chip) as Element | undefined;
        if (x) this.host.followReference(x);
      }
    }
  }

  private onDblClick(e: MouseEvent) {
    const t = e.target as Element;
    const tag = t.closest?.('.x-tag');
    const chip = t.closest?.('.x-atomic, .x-atomic-block');
    const acronym = t.closest?.('[data-x="acronym"]');
    if (tag || chip || acronym) {
      e.preventDefault();
      const x = acronym && !tag && !chip ? (this.renderer.xmlOf.get(acronym) as Element | undefined) : this.xmlTargetFromEvent(e);
      if (x) this.host.app.openProperties(x);
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      this.host.tabKey(e.shiftKey);
      return;
    }
    if (e.key === 'Escape' && this.host.elementSelection) {
      e.preventDefault();
      this.host.clearElementSelection();
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.host.selectAllSmart();
      return;
    }
    if (this.host.elementSelection && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      this.host.leaveElementSelection(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    // The keyboard route to the context menu (Menu key, Shift+F10). Browsers differ in whether and with which modifiers they turn
    // these keys into a "contextmenu" event (Firefox sends Shift+F10 with shiftKey set, which the handler above leaves to the native
    // menu), so the menu is opened here, at the caret.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !mod && !e.altKey)) {
      e.preventDefault();
      this.openContextMenuAtCaret();
      return;
    }
  }

  private openContextMenuAtCaret() {
    this.host.onDomSelection();
    const s = window.getSelection();
    const empty = (r: DOMRect) => !r.width && !r.height && !r.left && !r.top;
    let r: DOMRect | null = s && s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
    if (!r || empty(r)) {
      // a collapsed range at an element boundary has no box: use the element the caret is in, or the page
      const n = s?.focusNode;
      const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
      r = el && this.page.contains(el) ? el.getBoundingClientRect() : this.page.getBoundingClientRect();
    }
    this.host.app.showContextMenu(r.left, Math.min(r.bottom, window.innerHeight - 8), true);
  }

  private onBeforeInput(e: InputEvent) {
    const t = e.inputType;
    if (t === 'insertCompositionText') return; // handled at compositionend
    e.preventDefault();
    if (this.host.readOnlyReason()) {
      this.host.app.toast(this.host.readOnlyReason()!, 'warning');
      return;
    }
    const sel = this.readSelection();
    const targetRange = (): ModelSelection | null => {
      const rs = e.getTargetRanges?.() ?? [];
      if (!rs.length) return null;
      const a = this.domToModel(rs[0].startContainer, rs[0].startOffset);
      const b = this.domToModel(rs[0].endContainer, rs[0].endOffset);
      return a && b ? { anchor: a, focus: b } : null;
    };
    switch (t) {
      case 'insertText':
      case 'insertReplacementText': {
        const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
        if (!data) return;
        const range = t === 'insertReplacementText' ? targetRange() ?? sel : sel;
        if (range) this.host.insertTextAt(range, data, t === 'insertText');
        return;
      }
      case 'insertParagraph':
      case 'insertLineBreak':
        this.host.enterKey(sel, t === 'insertLineBreak');
        return;
      case 'deleteContentBackward':
      case 'deleteWordBackward':
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        this.host.deleteKey(sel, -1, t === 'deleteWordBackward', t.includes('Line') ? targetRange() : null);
        return;
      case 'deleteContentForward':
      case 'deleteWordForward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        this.host.deleteKey(sel, 1, t === 'deleteWordForward', t.includes('Line') ? targetRange() : null);
        return;
      case 'deleteContent':
      case 'deleteByCut':
      case 'deleteByDrag':
        this.host.deleteKey(sel, -1, false, null);
        return;
      case 'formatBold': this.host.app.run('format.bold'); return;
      case 'formatItalic': this.host.app.run('format.italic'); return;
      case 'formatUnderline': this.host.app.run('format.underline'); return;
      case 'formatStrikeThrough': this.host.app.run('format.strike'); return;
      case 'formatSubscript': this.host.app.run('format.subscript'); return;
      case 'formatSuperscript': this.host.app.run('format.superscript'); return;
      case 'historyUndo': this.host.app.run('edit.undo'); return;
      case 'historyRedo': this.host.app.run('edit.redo'); return;
      default:
        return;
    }
  }

  private onCompositionEnd(e: CompositionEvent) {
    const sel = this.composing;
    this.composing = null;
    const data = e.data ?? '';
    // the browser mutated the DOM during composition: re-render after applying to the model
    if (sel && data) this.host.insertTextAt(sel, data, true);
    const block = sel ? this.host.textBlockAt(sel.anchor) : null;
    if (block) {
      this.renderer.refreshIndexes();
      this.rerender(block);
    } else this.render();
    this.applySelection(this.doc.selection, false);
  }
}

function closestXml(n: Node, name: string): Element | null {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) if (c.nodeName === name) return c as Element;
  return null;
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

function caretPoint(e: MouseEvent): [Node, number] {
  const cp = caretFromPoint(e.clientX, e.clientY);
  return cp ? [cp.node, cp.offset] : [document.body, 0];
}

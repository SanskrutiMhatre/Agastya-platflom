// The JSG editor: a WYSIWYG editor for a Joint Services Guide document (User Handbook).
//
// It shows the document the way the JSG stencil sets it - Times New Roman 12 pt, blue capital headings numbered CHAPTER n / SECTION n / n.n, captions numbered
// Figure n / Table n - and edits the model (./model.ts) directly. Pagination (mirrored margins, the blank versos, the contents with page numbers) is the PDF
// engine's job: the page beside this editor is the server-built PDF.
//
// Independent of the JSS editor (src/jss) and the S1000D Studio (src/studio): it imports only its own model and XML code.

import { isClause, newClause, newFigure, newList, newNotice, newPara, newTable, META_FIELDS, plain, text,
  type Align, type Appendix, type Block, type Cell, type Chapter, type Clause, type Figure, type Graphic, type Inline, type JsgDoc, type List, type ListType, type Mark, type Notice, type Orientation, type Para, type Part, type Section, type Table } from './model';
import { parseJsg, serializeJsg } from './xml';
import { confirmDialog } from '../lib/dialogs';
import { BASE_CSS, escH, injectCss, mk, openMenu, pickGraphic, tabbedBar, type BarTab, type GraphicInfo, type JsgCollab, type JsgEditorLike, type JsgEditorOptions, type JsgFinding, type JsgHost, type JsgLiveSurface, type JsgSlot, type MenuItem, type SectionBadge } from './shared';

export type { GraphicInfo, JsgFinding, JsgHost, JsgEditorOptions } from './shared';

type Container = Array<Block | Clause>;
interface Slot { list: Array<any>; index: number }

/** What JsgEditor.inspect() says about the selected block (the workspace's Properties panel shows it; nothing in it edits the document). */
export interface ElementInfo { element: string; label: string; attrs: Array<[string, string]>; inner?: { element: string; attrs: Array<[string, string]> }; where?: string }
const JSG_BLOCK_LABEL: Record<string, string> = { clause: 'Heading', para: 'Paragraph', list: 'List', table: 'Table', figure: 'Figure', note: 'Note', warning: 'Warning', caution: 'Caution', pageBreak: 'Page break' };

/** 1 -> i, 4 -> iv ... (the stencil's roman lists) */
const toRoman = (n: number): string => { const m: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let r = ''; for (const [v, t] of m) while (n >= v) { r += t; n -= v; } return r; };
/** the longest a slice of the sheet's drawing takes when the editor opens (render(..., true)) */
const SLICE_MS = 30;
const ALIGNS: Array<[Align | undefined, string]> = [[undefined, 'Justified (default)'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
const MARK_TAGS: Record<string, Mark> = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', SUP: 'sup', SUB: 'sub' };

export function inlineHtml(inl: Inline[]): string {
  return inl.map((i) => {
    if (i.t === 'text') return escH(i.text).replace(/\n/g, '<br>');
    if (i.t === 'br') return '<br>';
    if (i.t === 'xref') return `<span class="jsg-xref" data-to="${escH(i.to)}">${inlineHtml(i.children)}</span>`;
    return `<${i.mark}>${inlineHtml(i.children)}</${i.mark}>`;
  }).join('');
}

/** The inline model of what the author typed: marks become marks, blocks the browser made (div, p) become line breaks, anything else is plain text. */
export function readInline(el: Node): Inline[] {
  const out: Inline[] = [];
  const push = (i: Inline): void => { const last = out[out.length - 1]; if (i.t === 'text' && last?.t === 'text') last.text += i.text; else out.push(i); };
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) { const t = (n.nodeValue ?? '').replace(/ /g, ' '); if (t) push({ t: 'text', text: t }); continue; }
    if (n.nodeType !== 1) continue;
    const e = n as HTMLElement;
    if (e.tagName === 'BR') { push({ t: 'br' }); continue; }
    if (MARK_TAGS[e.tagName]) { const c = readInline(e); if (c.length) out.push({ t: 'mark', mark: MARK_TAGS[e.tagName], children: c }); continue; }
    if (e.classList.contains('jsg-xref')) { out.push({ t: 'xref', to: e.dataset.to ?? '', children: readInline(e) }); continue; }
    if (e.tagName === 'DIV' || e.tagName === 'P') { if (out.length) push({ t: 'br' }); for (const c of readInline(e)) push(c); continue; }
    for (const c of readInline(e)) push(c);
  }
  return out;
}

export class JsgEditor implements JsgEditorLike, JsgLiveSurface {
  private readonly root: HTMLElement;
  private readonly doc: JsgDoc;
  private readonly host: JsgHost;
  private readonly readOnly: boolean;
  private dirty = false;
  private findings: JsgFinding[] = [];
  private selected: Slot | null = null;
  private selectedEl: HTMLElement | null = null;
  private slots = new WeakMap<HTMLElement, Slot>();
  /** the elements in `slots`, in drawing order (a selection is found again after a redraw) */
  private slotEls: HTMLElement[] = [];
  /** render() calls so far (a newer one stops the slices of an older one) and what an unfinished sliced render still has to draw */
  private renderGen = 0;
  private pending: { gen: number; run: () => void } | null = null;
  private sheet!: HTMLElement; private nav!: HTMLElement; private bar!: HTMLElement;
  private figures = 0; private tables = 0;
  // history: the document as XML before each burst of editing (typing is grouped by a short pause), so Undo and Redo work on the model whatever was edited
  private undoStack: string[] = []; private redoStack: string[] = []; private lastXml = ''; private histTimer: ReturnType<typeof setTimeout> | undefined; private restoring = false;
  private findBar!: HTMLElement; private findInput!: HTMLInputElement; private replaceInput!: HTMLInputElement; private matchCase!: HTMLInputElement; private findCount!: HTMLElement;
  private hits: Range[] = []; private hitAt = -1; private status!: HTMLElement;
  // Phase 3 (P3-1): live co-editing (collab/jsg.ts). While live, each change is reported to the binding (which brings the room to the model),
  // undo/redo are the room's per-person history, and "unsaved" is what the server has not acknowledged. The fields drawn are listed (slots)
  // so another person's change is put into them in place.
  private collab: JsgCollab | null = null;
  private slotList: JsgSlot[] = [];
  private onKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); this.host.onSaveRequested(); return; }
    const inside = this.root.contains(e.target as Node);
    if (!inside) return;
    const field = (e.target as HTMLElement | null)?.closest('input,textarea,select');
    if (mod && (k === 'f' || k === 'h')) { e.preventDefault(); this.openFind(k === 'h' && !this.readOnly); return; }
    if (k === 'escape' && this.findBar.classList.contains('open') && this.findBar.contains(e.target as Node)) { this.closeFind(); return; }
    if (field && !this.findBar.contains(field)) return;                                           // the cover card's own inputs keep the browser's undo
    if (mod && k === 'z' && !e.shiftKey && !this.findBar.contains(e.target as Node)) { e.preventDefault(); this.undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey)) && !this.findBar.contains(e.target as Node)) { e.preventDefault(); this.redo(); }
  };

  private badge: SectionBadge | undefined;
  constructor(host: HTMLElement, opts: JsgEditorOptions) {
    this.root = host; this.doc = opts.doc; this.host = opts.host; this.readOnly = opts.readOnly; this.badge = opts.sectionBadge;
    injectCss('jsg-editor-css', BASE_CSS);
    this.root.innerHTML = '';
    this.root.classList.add('jsg-ed'); if (this.readOnly) this.root.classList.add('jsg-ro');
    this.nav = document.createElement('aside'); this.nav.className = 'jsg-nav';
    const main = document.createElement('div'); main.className = 'jsg-main';
    this.bar = document.createElement('div'); this.bar.className = 'jsg-bar';
    const scroll = document.createElement('div'); scroll.className = 'jsg-scroll';
    this.sheet = document.createElement('div'); this.sheet.className = 'jsg-sheet'; this.sheet.setAttribute('data-testid', 'jsg-sheet');
    this.findBar = document.createElement('div'); this.findBar.className = 'jsg-find'; this.findBar.setAttribute('role', 'search'); this.findBar.setAttribute('data-testid', 'jsg-find');
    this.status = document.createElement('div'); this.status.className = 'jsg-status'; this.status.setAttribute('data-testid', 'jsg-status');
    scroll.appendChild(this.sheet); main.append(this.bar, this.findBar, scroll, this.status); this.root.append(this.nav, main);
    this.buildFind(); this.buildStatus();
    document.addEventListener('keydown', this.onKey);          // the page, not just the editor: Ctrl+S must save after a dialog closed with focus on the body
    this.buildBar();
    this.render(undefined, true);                                 // opening: drawn in slices (Phase 8, the opening long task)
    this.lastXml = serializeJsg(this.doc); this.refreshHistory();
  }

  destroy(): void { this.renderGen++; this.pending = null; document.removeEventListener('keydown', this.onKey); if (this.histTimer) clearTimeout(this.histTimer); this.clearHits(); this.root.innerHTML = ''; this.root.classList.remove('jsg-ed', 'jsg-ro'); }
  isDirty(): boolean { return this.collab ? this.collab.dirty() : this.dirty; }
  // ── live co-editing (JsgLiveSurface) ──
  setCollab(c: JsgCollab | null): void { this.collab = c; if (this.histTimer) { clearTimeout(this.histTimer); this.histTimer = undefined; } this.refreshHistory(); }
  liveSlots(): JsgSlot[] { this.ensureRendered(); this.slotList = this.slotList.filter((s) => s.el.isConnected); return this.slotList; }
  liveRedraw(): void {
    const keep = this.sheet.parentElement?.scrollTop ?? 0;
    // the selected block (a table, a figure ...) is the same model object after a remote change (it keeps its object when moved): select it again where it now is
    const was = this.selected ? this.selected.list[this.selected.index] as unknown : null;
    this.selected = null; this.selectedEl = null; this.render();
    if (was) for (const e of this.slotEls) { const sl = this.slots.get(e); if (sl && sl.list[sl.index] === was && e.isConnected) { this.select(e); break; } }
    if (this.sheet.parentElement) this.sheet.parentElement.scrollTop = keep;
  }
  afterRemote(): void { this.renderNav(); this.refreshStatus(); this.refreshHistory(); if (this.findBar.classList.contains('open')) this.runFind(false); }
  liveParts(): { root: HTMLElement; sheet: HTMLElement; scroll: HTMLElement; nav: HTMLElement } { return { root: this.root, sheet: this.sheet, scroll: this.sheet.parentElement as HTMLElement, nav: this.nav }; }
  /** Show (or stop showing) a code beside each section heading. The document is not touched; the sheet is drawn again where it stood. */
  setSectionBadge(fn: SectionBadge | undefined): void { if (fn === this.badge) return; this.badge = fn; const keep = this.sheet.parentElement?.scrollTop ?? 0; this.render(); if (this.sheet.parentElement) this.sheet.parentElement.scrollTop = keep; }
  private codeEl(s: { id?: string; title: string }, chapter: number): HTMLElement | null { const t = this.badge?.(s, chapter); if (!t) return null; const e = this.el('span', 'jsg-code', t); e.setAttribute('contenteditable', 'false'); e.title = 'Data module code of this section (kept in the backend, not in the document)'; return e; }
  /**
   * Scroll to a section or appendix by the key the server gives it ("id:<element id>", or "t:<number>:<title>" without an id; an appendix is numbered after the chapters),
   * the way the Publication and Explore pages open the editor at a row. Returns false when nothing matches.
   */
  goToModule(key: string): boolean {
    this.ensureRendered();
    const norm = (t: string): string => t.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    const m = /^t:(\d+):(.*?)(?:#(\d+))?$/.exec(key); const id = key.startsWith('id:') ? key.slice(3) : '';
    // WP-21 (GAP-004): "#n" is the n-th section of that title without an id in that chapter (the server numbers them so, xengine/outline.ts keyOf)
    const nth = Number(m?.[3] ?? 1);
    let target = '';
    this.doc.chapters.forEach((ch, ci) => {
      if (!target && id && ch.id === id) target = `jsg-ch-${ci}`;
      let seen = 0;
      ch.sections.forEach((s, si) => {
        if (target) return;
        if (id && s.id === id) { target = `jsg-sec-${ci}-${si}`; return; }
        if (m && Number(m[1]) === ci + 1 && !s.id && norm(s.title) === m[2] && ++seen === nth) target = `jsg-sec-${ci}-${si}`;
      });
      if (!target && m && !m[3] && Number(m[1]) === ci + 1) { const si = ch.sections.findIndex((s) => norm(s.title) === m[2]); if (si >= 0) target = `jsg-sec-${ci}-${si}`; }
    });
    this.doc.appendices.forEach((a, ai) => { if (!target && ((id && a.id === id) || (m && Number(m[1]) === this.doc.chapters.length + ai + 1 && norm(`${a.label ? `${a.label} ` : ''}${a.title}`) === m[2]))) target = `jsg-app-${ai}`; });
    const el = target ? document.getElementById(target) : null; if (!el) return false;
    el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    el.classList.remove('jsg-flash'); void el.offsetWidth; el.classList.add('jsg-flash'); setTimeout(() => el.classList.remove('jsg-flash'), 1700);
    return true;
  }
  markSaved(): void { this.dirty = false; this.host.onDirty(false); }
  /** A recovered draft was loaded (FE-006): it counts as unsaved until it is saved. */
  markDirty(): void { this.dirty = true; this.host.onDirty(true); }
  getXml(): string { return serializeJsg(this.doc); }
  getDoc(): JsgDoc { return this.doc; }
  setFindings(f: JsgFinding[]): void { this.findings = f; this.renderNav(); }

  /**
   * UI redesign (the workspace's Properties panel, Element tab): the block the author is in, read from the model and never changed (D16): its
   * XML element and attributes, the table cell inside it, and the heading above it. Null when nothing in the sheet is selected. The toolbar
   * above the sheet stays the one place that edits them.
   */
  inspect(): ElementInfo | null {
    this.ensureRendered();
    const e = this.selectedEl; const slot = this.selected;
    if (!e || !slot || !e.isConnected) return null;
    const x = slot.list[slot.index] as Block | Clause | undefined; if (!x) return null;
    let h: Element | null = isClause(x) ? null : e;
    while (h && !/\bjsg-(clause|sectionh|chapter|app)\b/.test(h.className)) h = h.previousElementSibling;
    const where = h ? Array.from(h.childNodes, (c) => c.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 90) : undefined;
    const a = (k: string, v: string | number | boolean | undefined | null): Array<[string, string]> => (v === undefined || v === null || v === '' || v === false ? [] : [[k, String(v)]]);
    const info: ElementInfo = { element: x.k, label: JSG_BLOCK_LABEL[x.k] ?? x.k, attrs: [], where };
    switch (x.k) {
      case 'clause': info.attrs = [...a('title', x.title), ...a('id', x.id), ...a('orientation', x.orientation ?? 'portrait'), ...a('content', x.children.length)]; break;
      case 'para': info.attrs = [...a('indent', x.indent), ...a('align', x.align ?? 'justify')]; break;
      case 'list': info.attrs = [...a('type', x.type), ...a('indent', x.indent), ...a('items', x.items.length)]; break;
      case 'table': info.attrs = [...a('id', x.id), ...a('title', x.title), ...a('widths', x.widths), ...a('header rows', x.head.length), ...a('body rows', x.body.length)]; break;
      case 'figure': info.attrs = [...a('id', x.id), ...a('title', x.title), ...a('graphics', x.graphics.length), ...a('src', x.graphics[0]?.src), ...a('width', x.graphics[0]?.width)]; break;
      case 'note': case 'warning': case 'caution': info.attrs = a('paragraphs', x.paras.length); break;
      default: break;
    }
    if (x.k === 'table') {
      const n = document.getSelection()?.anchorNode ?? null; const at = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
      const td = at && e.contains(at) ? at.closest<HTMLElement>('td, th') : null;
      const r = td ? Number(td.dataset.r) : NaN; const c = td ? Number(td.dataset.c) : NaN;
      const cell: Cell | undefined = td && Number.isFinite(r) && Number.isFinite(c) ? [...x.head, ...x.body][r]?.cells[c] : undefined;
      if (td && cell) info.inner = { element: td.tagName === 'TH' ? 'cell (header)' : 'cell', attrs: [...a('row', r + 1), ...a('column', c + 1), ...a('colspan', cell.colspan), ...a('rowspan', cell.rowspan), ...a('align', cell.align), ...a('bold', cell.bold)] };
    }
    return info;
  }

  private touch(typing = true): void {
    if (this.collab) { this.collab.changed(typing); this.refreshHistory(); return; }
    if (!this.dirty) { this.dirty = true; this.host.onDirty(true); }
    if (this.restoring) return;
    if (this.histTimer) clearTimeout(this.histTimer);
    this.histTimer = setTimeout(() => this.checkpoint(), 600);
  }

  // ── history ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Remember the document as it was before the edit that has just been made (nothing is remembered if nothing changed). */
  private checkpoint(): void {
    if (this.histTimer) { clearTimeout(this.histTimer); this.histTimer = undefined; }
    if (this.restoring || this.collab) return;
    const now = serializeJsg(this.doc);
    if (now === this.lastXml) return;
    this.undoStack.push(this.lastXml); if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = []; this.lastXml = now; this.refreshHistory(); this.refreshStatus();
  }
  canUndo(): boolean { if (this.collab) return this.collab.canUndo(); this.checkpoint(); return this.undoStack.length > 0; }
  canRedo(): boolean { return this.collab ? this.collab.canRedo() : this.redoStack.length > 0; }
  undo(): void {
    if (this.readOnly) return;
    if (this.collab) { this.collab.undo(); return; }
    this.checkpoint();
    const prev = this.undoStack.pop(); if (prev === undefined) return this.host.notify('Nothing to undo.', 'info');
    this.redoStack.push(this.lastXml); this.restore(prev);
  }
  redo(): void {
    if (this.readOnly) return;
    if (this.collab) { this.collab.redo(); return; }
    this.checkpoint();
    const next = this.redoStack.pop(); if (next === undefined) return this.host.notify('Nothing to redo.', 'info');
    this.undoStack.push(this.lastXml); this.restore(next);
  }
  private restore(xml: string): void {
    this.restoring = true;
    try {
      const d = parseJsg(xml); Object.assign(this.doc, d); this.lastXml = xml; this.selected = null; this.selectedEl = null;
      const keep = this.sheet.parentElement?.scrollTop ?? 0; this.render(); if (this.sheet.parentElement) this.sheet.parentElement.scrollTop = keep;
      if (!this.dirty) { this.dirty = true; this.host.onDirty(true); }
    } finally { this.restoring = false; }
    this.refreshHistory(); this.refreshStatus(); if (this.findBar.classList.contains('open')) this.runFind(false);
  }
  private refreshHistory(): void {
    const u = this.buttons.get('undo'); const r = this.buttons.get('redo');
    if (u) u.disabled = this.readOnly || !(this.collab ? this.collab.canUndo() : this.undoStack.length); if (r) r.disabled = this.readOnly || !(this.collab ? this.collab.canRedo() : this.redoStack.length);
  }

  // ── find and replace ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Works on the sheet as the author sees it: every match in editable text (paragraphs, list items, table cells, headings, captions) is found, highlighted and counted; a replacement is typed
  // into the text and the model follows through the editor's own input handling, so it is one more edit that Undo takes back.
  private buildFind(): void {
    const btn = (label: string, title: string, fn: () => void, edit = false): HTMLButtonElement => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', fn);
      if (edit && this.readOnly) b.style.display = 'none'; return b;
    };
    this.findInput = document.createElement('input'); this.findInput.type = 'text'; this.findInput.placeholder = 'Find…'; this.findInput.setAttribute('aria-label', 'Find');
    this.replaceInput = document.createElement('input'); this.replaceInput.type = 'text'; this.replaceInput.placeholder = 'Replace with…'; this.replaceInput.setAttribute('aria-label', 'Replace with'); if (this.readOnly) this.replaceInput.style.display = 'none';
    this.matchCase = document.createElement('input'); this.matchCase.type = 'checkbox';
    const mc = document.createElement('label'); mc.style.cssText = 'display:inline-flex;align-items:center;gap:4px'; mc.append(this.matchCase, document.createTextNode('Match case'));
    this.findCount = document.createElement('span'); this.findCount.className = 'cnt'; this.findCount.setAttribute('aria-live', 'polite');
    this.findInput.addEventListener('input', () => this.runFind(true)); this.matchCase.addEventListener('change', () => this.runFind(true));
    this.findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.stepFind(e.shiftKey ? -1 : 1); } });
    this.replaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.replaceOne(); } });
    this.findBar.append(this.findInput, btn('↑', 'Previous match (Shift+Enter)', () => this.stepFind(-1)), btn('↓', 'Next match (Enter)', () => this.stepFind(1)), mc, this.findCount,
      this.replaceInput, btn('Replace', 'Replace this match', () => this.replaceOne(), true), btn('Replace all', 'Replace every match', () => this.replaceAll(), true), btn('✕', 'Close (Esc)', () => this.closeFind()));
  }
  openFind(replace: boolean): void {
    this.findBar.classList.add('open');
    const picked = window.getSelection()?.toString().trim(); if (picked && picked.length < 80 && !picked.includes('\n')) this.findInput.value = picked;
    (replace ? this.replaceInput : this.findInput).focus(); if (!replace) this.findInput.select();
    this.runFind(true);
  }
  closeFind(): void { this.findBar.classList.remove('open'); this.clearHits(); }
  private collectHits(): Range[] {
    const q = this.findInput.value; if (!q) return [];
    const cs = this.matchCase.checked; const needle = cs ? q : q.toLowerCase(); const out: Range[] = [];
    const walker = document.createTreeWalker(this.sheet, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
      const el = n.parentElement; if (!el) return NodeFilter.FILTER_REJECT;
      if (el.closest('.jsg-card,.jsg-orient,.jsg-tag,button,.jsg-num,.jsg-ttools,.jsg-code,.jsg-clause .n,.jsg-li .m')) return NodeFilter.FILTER_REJECT;
      return el.closest('[contenteditable]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const hay = cs ? (n.nodeValue ?? '') : (n.nodeValue ?? '').toLowerCase();
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length); out.push(r); }
    }
    return out;
  }
  private runFind(jump: boolean): void {
    this.ensureRendered();
    this.hits = this.collectHits();
    this.hitAt = this.hits.length ? (jump ? 0 : Math.min(Math.max(this.hitAt, 0), this.hits.length - 1)) : -1;
    this.paintHits(jump);
  }
  private paintHits(scroll: boolean): void {
    const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS; const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (css?.highlights && H) { css.highlights.set('jsg-hit', new H(...this.hits)); if (this.hitAt >= 0) css.highlights.set('jsg-cur', new H(this.hits[this.hitAt])); else css.highlights.delete('jsg-cur'); }
    this.findCount.textContent = !this.findInput.value ? '' : this.hits.length ? `${this.hitAt + 1} of ${this.hits.length}` : 'No matches';
    if (scroll && this.hitAt >= 0) this.hits[this.hitAt].startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
  }
  private clearHits(): void {
    const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS; css?.highlights?.delete('jsg-hit'); css?.highlights?.delete('jsg-cur'); this.hits = []; this.hitAt = -1;
  }
  private stepFind(d: 1 | -1): void { if (!this.hits.length) return this.runFind(true); this.hitAt = (this.hitAt + d + this.hits.length) % this.hits.length; this.paintHits(true); }
  private sync(node: Node): void { (node.parentElement?.closest('[contenteditable]') as HTMLElement | null)?.dispatchEvent(new Event('input', { bubbles: true })); }
  private replaceOne(): void {
    if (this.readOnly || this.hitAt < 0) return;
    const r = this.hits[this.hitAt]; const node = r.startContainer as Text; if (node.nodeType !== 3) return;
    node.data = node.data.slice(0, r.startOffset) + this.replaceInput.value + node.data.slice(r.endOffset); this.sync(node); this.checkpoint();
    this.runFind(false);
  }
  private replaceAll(): void {
    if (this.readOnly || !this.hits.length) return;
    const n = this.hits.length; const touched = new Set<Node>(); const rep = this.replaceInput.value;
    for (const r of [...this.hits].reverse()) { const node = r.startContainer as Text; if (node.nodeType !== 3) continue; node.data = node.data.slice(0, r.startOffset) + rep + node.data.slice(r.endOffset); touched.add(node); }
    for (const node of touched) this.sync(node);
    this.checkpoint(); this.host.notify(`Replaced ${n} match${n === 1 ? '' : 'es'}.`, 'info'); this.runFind(true);
  }

  // ── status bar and zoom ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private buildStatus(): void {
    const mkSpan = (key: string, cls = ''): HTMLElement => { const e = document.createElement('span'); if (cls) e.className = cls; e.dataset.st = key; return e; };
    const zl = document.createElement('label'); zl.append(document.createTextNode('Zoom '));
    const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Zoom');
    let saved = 100; try { saved = Number(localStorage.getItem('agastya.jsg.zoom')) || 100; } catch { /* private mode */ }
    for (const z of [75, 90, 100, 110, 125, 150]) { const o = document.createElement('option'); o.value = String(z); o.textContent = `${z}%`; if (z === saved) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => this.setZoom(Number(sel.value))); zl.appendChild(sel);
    this.status.append(mkSpan('path', 'grow'), mkSpan('words'), mkSpan('counts'), zl);
    this.sheet.addEventListener('focusin', () => this.refreshStatus());
    this.setZoom(saved);
  }
  private setZoom(pct: number): void {
    (this.sheet.style as CSSStyleDeclaration & { zoom: string }).zoom = pct === 100 ? '' : String(pct / 100);
    try { localStorage.setItem('agastya.jsg.zoom', String(pct)); } catch { /* private mode */ }
  }
  private refreshStatus(): void {
    const set = (k: string, v: string): void => { const e = this.status.querySelector<HTMLElement>(`[data-st="${k}"]`); if (e) e.textContent = v; };
    const words = Array.from(this.sheet.querySelectorAll('.jsg-p,.jsg-li .b,.jsg-cap,td,th,.jsg-clause .t,.jsg-notice')).map((e) => e.textContent ?? '').join(' ').split(/\s+/).filter(Boolean).length;
    set('words', `${words.toLocaleString()} words`); set('counts', `${this.figures} figure${this.figures === 1 ? '' : 's'} · ${this.tables} table${this.tables === 1 ? '' : 's'}`);
    // where the caret is: the heading above the selected block
    let where = ''; let n: Element | null = this.selectedEl;
    while (n && !/\bjsg-(clause|sectionh|chapter|app)\b/.test(n.className)) n = n.previousElementSibling;
    if (n) where = (n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
    const slot = this.selectedEl ? this.slots.get(this.selectedEl) : undefined; const kind = slot ? (slot.list[slot.index] as { k?: string })?.k : undefined;
    set('path', where ? `${where}${kind && kind !== 'clause' ? ` › ${kind === 'para' ? 'paragraph' : kind === 'pageBreak' ? 'page break' : kind}` : ''}` : '');
  }

  // ── paste ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Text from Word or the web comes in clean: several lines become several paragraphs, and a pasted table becomes a table; formatting from outside is never kept. */
  private paste(ev: ClipboardEvent, el: HTMLElement): void {
    ev.preventDefault();
    const html = ev.clipboardData?.getData('text/html') ?? ''; const plain = ev.clipboardData?.getData('text/plain') ?? '';
    if (html && /<table[\s>]/i.test(html) && this.selected) { const t = this.tableFromHtml(html); if (t) { this.insert(t); this.host.notify('Pasted a table. Check the header row and the caption.', 'info'); return; } }
    const slot = this.slots.get(el); const blk = slot ? slot.list[slot.index] : null;
    const lines = plain.split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (slot && blk && (blk as Para).k === 'para' && lines.length > 1) {
      const p = blk as Para; document.execCommand('insertText', false, lines[0]);
      let at = slot.list.indexOf(p); let last: unknown = p;
      for (const line of lines.slice(1)) { const np = newPara(line, p.indent); slot.list.splice(++at, 0, np); last = np; }
      this.afterEdit(last); this.host.notify(`Pasted ${lines.length} paragraphs.`, 'info'); return;
    }
    document.execCommand('insertText', false, lines.length ? lines.join(' ') : plain);
  }
  private tableFromHtml(html: string): Table | null {
    const t = new DOMParser().parseFromString(html, 'text/html').querySelector('table'); if (!t) return null;
    const rows = Array.from(t.rows).map((r) => ({ head: !!r.querySelector('th'), cells: Array.from(r.cells).map((c) => ({ text: (c.textContent ?? '').replace(/\s+/g, ' ').trim(), span: c.colSpan > 1 ? c.colSpan : undefined })) })).filter((r) => r.cells.length);
    if (!rows.length) return null;
    const cell = (c: { text: string; span?: number }, align?: Align): Cell => ({ ...(c.span ? { colspan: c.span } : {}), ...(align ? { align } : {}), parts: [{ k: 'text', inline: text(c.text) }] });
    const headRows = rows.filter((r, i) => r.head && i === 0 ? true : false);
    const head = headRows.map((r) => ({ cells: r.cells.map((c) => cell(c, 'center')) })); const body = rows.slice(head.length).map((r) => ({ cells: r.cells.map((c) => cell(c)) }));
    return { k: 'table', title: 'TABLE NAME', head, body: body.length ? body : head.splice(0) };
  }

  // ── toolbar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // The tools are sorted into tabs by what the author is doing: write, insert, work on a table, arrange the page, look after the document.
  private buttons = new Map<string, HTMLButtonElement>();

  private buildBar(): void {
    const tabs: BarTab[] = [
      { id: 'write', label: 'Write', hint: 'These work on the text you clicked in.', groups: [
        { label: 'Text style', buttons: [
          { id: 'bold', label: 'B', title: 'Bold (Ctrl+B)', run: () => this.mark('bold') }, { id: 'italic', label: 'I', title: 'Italic (Ctrl+I)', run: () => this.mark('italic') },
          { id: 'underline', label: 'U', title: 'Underline (Ctrl+U)', run: () => this.mark('underline') },
          { id: 'sup', label: 'x²', title: 'Superscript', run: () => this.mark('superscript') }, { id: 'sub', label: 'x₂', title: 'Subscript', run: () => this.mark('subscript') },
        ] },
        { label: 'Paragraph', buttons: [
          { id: 'align', label: 'Align ▾', title: 'Align the selected paragraph', run: (b) => openMenu(b, ALIGNS.map(([a, label]) => ({ label, run: () => this.setAlign(a) }))) },
          { id: 'indent', label: 'Indent ▸', title: 'Move the selected paragraph or list one step in (the stencil\'s L2 to L5 paragraph levels)', run: () => this.indentBlock(1) },
          { id: 'outdent', label: '◂ Outdent', title: 'Move the selected paragraph or list one step out', run: () => this.indentBlock(-1) },
        ] },
      ] },
      { id: 'insert', label: 'Insert', groups: [
        { label: 'Text', buttons: [
          { id: 'para', label: 'Paragraph', title: 'Add a paragraph after the selected block', run: () => this.insert(newPara('')) },
          { id: 'heading', label: 'Heading', title: 'Add a numbered heading (1.1, 1.1.1 ...) under the selected one', run: () => this.addClause() },
          { id: 'list', label: 'List ▾', title: 'Add a list', run: (b) => openMenu(b, ([['alpha', '(a) (b) (c) lettered'], ['number', '1. 2. 3. numbered'], ['roman', '(i) (ii) (iii) roman'], ['step', 'Step 1) Step 2) procedure'], ['bullet', '• bullets'], ['dash', '- dashes']] as Array<[ListType, string]>).map(([t, label]) => ({ label, run: () => this.insert(newList(t)) }))) },
        ] },
        { label: 'Objects', buttons: [
          { id: 'table', label: 'Table', title: 'Add a table (3 x 3)', run: () => this.insert(newTable(3, 3, 'TABLE NAME')) },
          { id: 'figure', label: 'Figure', title: 'Add a figure with its caption', run: () => this.insert(newFigure()) },
          { id: 'notice', label: 'Notice ▾', title: 'Add a note, warning or caution', run: (b) => openMenu(b, (['note', 'warning', 'caution'] as const).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), run: () => this.insert(newNotice(k)) }))) },
        ] },
        { label: 'Page', buttons: [{ id: 'pagebreak', label: 'Page break', title: 'Start a new page here', run: () => this.insert({ k: 'pageBreak' }) }] },
      ] },
      { id: 'table', label: 'Table', hint: 'Click in a cell of the table first.', groups: [
        { label: 'Rows and columns', buttons: [
          { id: 'row+', label: 'Row +', title: 'Add a table row below the cursor', run: () => this.tableOp('row+') }, { id: 'row-', label: 'Row −', title: 'Delete the table row', run: () => this.tableOp('row-') },
          { id: 'col+', label: 'Col +', title: 'Add a table column right of the cursor', run: () => this.tableOp('col+') }, { id: 'col-', label: 'Col −', title: 'Delete the table column', run: () => this.tableOp('col-') },
        ] },
        { label: 'Alignment and size', buttons: [
          { id: 'talign', label: 'Align ▾', title: 'Align the text of a cell, a column or the whole table', run: (b) => openMenu(b, this.tableAlignMenu()) },
          { id: 'thead', label: 'Header row', title: 'Switch the first row between a header (bold, repeated on every page) and an ordinary row', run: () => this.toggleHeader() },
          { id: 'equal', label: 'Equal columns', title: 'Give every column the same width (the table always fills the full text width)', run: () => this.equalColumns() },
        ] },
      ] },
      { id: 'arrange', label: 'Arrange', groups: [
        { label: 'Move the selected block', buttons: [
          { id: 'up', label: 'Move up', title: 'Move the selected block up', run: () => this.move(-1) }, { id: 'down', label: 'Move down', title: 'Move the selected block down', run: () => this.move(1) },
        ] },
        { label: 'Page orientation', buttons: [{ id: 'orient', label: 'Orientation ▾', title: 'Print this section, or the selected heading, on landscape pages', run: (b) => openMenu(b, this.orientationMenu()) }] },
        { label: 'Remove', buttons: [{ id: 'delete', label: 'Delete', title: 'Delete the selected block', run: () => this.remove() }] },
      ] },
      { id: 'document', label: 'Document', groups: [
        { label: 'Check', buttons: [{ id: 'check', label: 'Check', title: 'Check the document without saving', run: () => this.host.onCheckRequested(), edit: false }] },
        { label: 'View', buttons: [
          { id: 'outline', label: 'Outline', title: 'Show or hide the outline on the left', edit: false, run: () => { this.nav.hidden = !this.nav.hidden; this.buttons.get('outline')?.classList.toggle('on', !this.nav.hidden); } },
        ] },
      ] },
    ];
    this.buttons = tabbedBar(this.bar, tabs, { readOnly: this.readOnly, storageKey: 'agastya.jsg.tab', quick: [
      { id: 'undo', label: '↶ Undo', title: 'Undo (Ctrl+Z)', run: () => this.undo() }, { id: 'redo', label: '↷ Redo', title: 'Redo (Ctrl+Y)', run: () => this.redo() },
      { id: 'find', label: 'Find', title: 'Find and replace (Ctrl+F, Ctrl+H)', run: () => this.openFind(false), edit: false },
    ] });
    this.refreshHistory();
    this.buttons.get('outline')?.classList.add('on');
  }

  /** The selected block (a paragraph, list, table ...), or null. */
  private selectedBlock(): any { return this.selected ? this.selected.list[this.selected.index] : null; }

  private setAlign(a: Align | undefined): void {
    const p = this.selectedBlock();
    if (!p || p.k !== 'para') return this.host.notify('Click in a paragraph first.', 'info');
    p.align = a; this.afterEdit(p);
  }

  /** One step in or out for a paragraph or list: the stencil has paragraph levels L2 (22.7 pt in) to L5. */
  private indentBlock(d: 1 | -1): void {
    const b = this.selectedBlock();
    if (!b || (b.k !== 'para' && b.k !== 'list')) return this.host.notify('Click in a paragraph or a list first.', 'info');
    const now = b.indent ?? 2; const next = Math.max(2, Math.min(5, now + d));
    if (next === now) return this.host.notify(d > 0 ? 'This is already the deepest level (L5).' : 'This is already at the first level.', 'info');
    b.indent = next; this.afterEdit(b);
  }

  private activeCell(): { t: Table; r: number; c: number } | null {
    const td = (document.activeElement as HTMLElement | null)?.closest('td,th') as HTMLElement | null; const t = (td?.closest('table') as any)?._jsg as Table | undefined;
    return td && t ? { t, r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
  }

  private tableAlignMenu(): MenuItem[] {
    const A: Array<[Align | undefined, string]> = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['justify', 'Justified'], [undefined, 'Default']];
    const set = (scope: 'cell' | 'column' | 'table', a: Align | undefined): void => {
      const at = this.activeCell(); if (!at) return this.host.notify('Click in a table cell first.', 'info');
      const all = [...at.t.head, ...at.t.body];
      const cells = scope === 'table' ? all.flatMap((r) => r.cells) : scope === 'cell' ? [all[at.r]?.cells[at.c]] : all.map((r) => r.cells[at.c]);
      for (const c of cells) if (c) { if (a) c.align = a; else delete c.align; }
      this.afterEdit(at.t);
    };
    const spans = (() => { const at = this.activeCell(); return !!at && [...at.t.head, ...at.t.body].some((r) => r.cells.some((c) => (c.colspan ?? 1) > 1 || (c.rowspan ?? 1) > 1)); })();
    return [
      ...A.map(([a, label]): MenuItem => ({ label: `This cell: ${label}`, run: () => set('cell', a) })), { label: '', separator: true, run: () => undefined },
      ...A.map(([a, label]): MenuItem => ({ label: `This column: ${label}`, run: () => set('column', a), disabled: spans })), { label: '', separator: true, run: () => undefined },
      ...A.map(([a, label]): MenuItem => ({ label: `Whole table: ${label}`, run: () => set('table', a) })),
    ];
  }

  private toggleHeader(): void {
    const at = this.activeCell(); if (!at) return this.host.notify('Click in a table cell first.', 'info');
    const t = at.t;
    if (t.head.length) { t.body.unshift(...t.head); t.head = []; }
    else if (t.body.length > 1) { t.head = [t.body.shift() as Table['body'][number]]; }
    else return this.host.notify('A table needs at least one other row to have a header.', 'info');
    this.afterEdit(t);
  }

  private equalColumns(): void {
    const at = this.activeCell(); if (!at) return this.host.notify('Click in a table cell first.', 'info');
    const cols = Math.max(1, ...[...at.t.head, ...at.t.body].map((r) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0)));
    at.t.widths = Array.from({ length: cols }, () => '1').join(' '); this.afterEdit(at.t);
  }

  /** The section or appendix holding the selection, and the heading (clause) the selection is, or is inside, when that heading is a direct child of the section. */
  private pageOwner(): { holder: Section | Appendix | null; clause: Clause | null } {
    const sel = this.selected; if (!sel) return { holder: null, clause: null };
    const item = sel.list[sel.index];
    let found: { holder: Section | Appendix | null; clause: Clause | null } = { holder: null, clause: null };
    const within = (list: Array<Block | Clause>, holder: Section | Appendix, top: Clause | null): void => {
      if (list === sel.list) found = { holder, clause: top }; 
      for (const x of list) if (isClause(x)) within(x.children, holder, holder.k === 'section' && (holder.children as Array<Block | Clause>).includes(x) ? x : top);
    };
    for (const ch of this.doc.chapters) for (const sec of ch.sections) { within(sec.children, sec, null); }
    for (const ap of this.doc.appendices) within(ap.children, ap, null);
    if (item && isClause(item) && found.holder && found.holder.k === 'section' && (found.holder.children as Array<Block | Clause>).includes(item)) found.clause = item;
    return found;
  }

  private orientationMenu(): MenuItem[] {
    const { holder, clause } = this.pageOwner();
    const O: Array<[Orientation, string]> = [['portrait', 'Portrait'], ['landscape', 'Landscape'], ['a3-landscape', 'A3 landscape']];
    const items: MenuItem[] = [];
    items.push(...O.map(([o, label]): MenuItem => ({ label: `All of this ${holder?.k === 'appendix' ? 'appendix' : 'section'}: ${label}`, disabled: !holder, hint: holder?.orientation === o ? '✓' : '', run: () => { if (holder) { holder.orientation = o; this.afterEdit(null); } } })));
    items.push({ label: '', separator: true, run: () => undefined });
    items.push(...O.map(([o, label]): MenuItem => ({ label: `This heading on its own page: ${label}`, disabled: !clause, hint: (clause?.orientation ?? 'portrait') === o ? '✓' : '', run: () => { if (clause) { if (o === 'portrait') delete clause.orientation; else clause.orientation = o; this.afterEdit(clause); } } })));
    return items;
  }

  private mark(cmd: string): void { if (this.readOnly) return; document.execCommand(cmd); const el = this.activeEditable(); if (el) el.dispatchEvent(new Event('input', { bubbles: true })); }
  private activeEditable(): HTMLElement | null { const a = document.activeElement as HTMLElement | null; return a && this.sheet.contains(a) && a.isContentEditable ? a : null; }

  // ── structure edits (all on the model; then a re-render that keeps the selection) ────────────────────────────────────────────
  private containerOfSelection(): { list: Array<any>; index: number } | null {
    if (this.selected) return this.selected;
    return null;
  }
  private insert(block: Block): void {
    const s = this.containerOfSelection();
    if (s) { s.list.splice(s.index + 1, 0, block); this.afterEdit(block); return; }
    // nothing selected: append to the last section / appendix of the document
    const last = this.doc.chapters[this.doc.chapters.length - 1]?.sections.slice(-1)[0];
    if (last) { last.children.push(block); this.afterEdit(block); } else this.host.notify('Click in the document first, then add.', 'info');
  }
  private addClause(): void {
    const s = this.containerOfSelection();
    const c = newClause('New heading');
    if (s && s.list[s.index] && isClause(s.list[s.index])) { (s.list[s.index] as Clause).children.push(c); this.afterEdit(c); return; }
    if (s) { s.list.splice(s.index + 1, 0, c); this.afterEdit(c); return; }
    const last = this.doc.chapters[this.doc.chapters.length - 1]?.sections.slice(-1)[0];
    if (last) { last.children.push(c); this.afterEdit(c); } else this.host.notify('Add a chapter and a section first.', 'info');
  }
  private move(d: number): void {
    const s = this.selected; if (!s) return; const j = s.index + d;
    if (j < 0 || j >= s.list.length) return;
    const [x] = s.list.splice(s.index, 1); s.list.splice(j, 0, x); this.afterEdit(x);
  }
  private remove(): void {
    const s = this.selected; if (!s) return;
    if (s.list.length === 1 && s.list === (this.selected?.list)) { /* a container may end up empty: that is valid */ }
    s.list.splice(s.index, 1); this.selected = null; this.afterEdit(null);
  }
  private tableOp(op: 'row+' | 'row-' | 'col+' | 'col-'): void {
    const td = (document.activeElement as HTMLElement | null)?.closest('td,th') as HTMLElement | null; if (!td) { this.host.notify('Click in a table cell first.', 'info'); return; }
    const t = (td.closest('table') as any)?._jsg as Table | undefined; if (!t) return;
    const all = [...t.head, ...t.body]; const r = Number(td.dataset.r); const c = Number(td.dataset.c);
    const blank = (): Cell => ({ parts: [{ k: 'text', inline: [] }] });
    if (op === 'row+') { const cols = all[0]?.cells.length ?? 1; const row = { cells: Array.from({ length: cols }, blank) }; if (r < t.head.length) t.body.unshift(row); else t.body.splice(r - t.head.length + 1, 0, row); }
    else if (op === 'row-') { if (r < t.head.length) t.head.splice(r, 1); else if (t.body.length > 1) t.body.splice(r - t.head.length, 1); else return this.host.notify('A table keeps at least one body row.', 'info'); }
    else if (op === 'col+') for (const row of all) row.cells.splice(c + 1, 0, blank());
    else { if ((all[0]?.cells.length ?? 0) <= 1) return this.host.notify('A table keeps at least one column.', 'info'); for (const row of all) row.cells.splice(c, 1); }
    t.widths = undefined; this.afterEdit(t);
  }
  private afterEdit(focus: unknown): void { this.touch(false); this.checkpoint(); const keep = this.sheet.parentElement?.scrollTop ?? 0; this.render(focus); if (this.sheet.parentElement) this.sheet.parentElement.scrollTop = keep; }

  // ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Draw the whole sheet. `sliced` (opening the editor, Phase 8): the first sections are drawn at once and the rest in short tasks after
   * it (each at most SLICE_MS), so opening a long handbook is not one long task; anything that needs the whole sheet calls ensureRendered()
   * first, and any other render() stops the slices of an earlier one.
   */
  private render(focus?: unknown, sliced = false): void {
    const gen = ++this.renderGen; this.pending = null;
    this.sheet.innerHTML = ''; this.slots = new WeakMap(); this.slotEls = []; this.figures = 0; this.tables = 0; this.slotList = [];
    const s = this.sheet; let focusEl: HTMLElement | null = null;
    this.ancillaryNote();
    const jobs: Array<() => void> = [];
    this.doc.chapters.forEach((ch, ci) => {
      jobs.push(() => { const h = this.el('div', 'jsg-chapter'); h.id = `jsg-ch-${ci}`; h.append(this.el('span', 'jsg-num', `CHAPTER ${ci + 1}`)); h.append(this.titleEl(ch, 'title', 'Chapter title')); s.appendChild(h); });
      ch.sections.forEach((sec, si) => jobs.push(() => {
        const sh = this.el('div', 'jsg-sectionh'); sh.id = `jsg-sec-${ci}-${si}`;
        sh.append(this.el('span', 'jsg-num', `SECTION ${si + 1}`)); sh.append(this.titleEl(sec, 'title', 'Section title')); const code = this.codeEl(sec, ci + 1); if (code) sh.append(code); s.appendChild(sh);
        if (sec.orientation !== 'portrait') s.appendChild(this.el('div', 'jsg-orient', `This section prints on ${sec.orientation === 'a3-landscape' ? 'A3 landscape' : 'landscape'} pages`));
        const slot = (list: Array<any>, i: number): Slot => ({ list, index: i });
        const walk = (list: Container, prefix: string): void => list.forEach((x, i) => {
          if (isClause(x)) {
            const n = list.slice(0, i + 1).filter(isClause).length; const num = `${prefix}${n}`;
            const c = this.el('div', 'jsg-clause'); c.append(this.el('span', 'n', num)); c.append(this.titleEl(x, 'title', 'Heading'));
            this.slots.set(c, slot(list, i)); this.slotEls.push(c); c.addEventListener('focusin', () => this.select(c)); s.appendChild(c); if (focus === x) focusEl = c;
            if (x.orientation && x.orientation !== 'portrait') s.appendChild(this.el('div', 'jsg-orient', `This heading is on its own ${x.orientation === 'a3-landscape' ? 'A3 landscape' : 'landscape'} page`));
            walk(x.children, `${num}.`);
          } else { const e = this.blockEl(x, slot(list, i)); s.appendChild(e); if (focus === x) focusEl = e; }
        });
        walk(sec.children, `${si + 1}.`);
      }));
    });
    this.doc.appendices.forEach((a, ai) => jobs.push(() => this.appendix(s, a, ai, focus, (e) => { focusEl = e; })));
    const finish = (): void => {
      this.pending = null;
      this.renderNav(); this.refreshStatus();
      if (focusEl) { const f = focusEl as HTMLElement; const first = f.querySelector<HTMLElement>('[contenteditable]'); (first ?? f).focus?.(); this.select(f); }
      if (sliced) this.root.dispatchEvent(new CustomEvent('jsg-rendered'));
    };
    if (!sliced) { for (const j of jobs) j(); finish(); return; }
    // the outline first (it is the model's, not the sheet's), then the sheet in slices
    this.renderNav();
    const step = (): void => {
      if (gen !== this.renderGen) return;
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < SLICE_MS) jobs.shift()!();
      if (jobs.length) { this.pending = { gen, run: () => { while (jobs.length) jobs.shift()!(); finish(); } }; setTimeout(step, 0); } else finish();
    };
    step();
  }
  /** Draw what the opening's slices have not drawn yet, now (before anything that reads the sheet: find, go to a section, a live caret). */
  ensureRendered(): void { const p = this.pending; if (p && p.gen === this.renderGen) { this.pending = null; this.renderGen++; p.run(); } }

  private appendix(s: HTMLElement, a: Appendix, ai: number, focus: unknown, setFocus: (e: HTMLElement) => void): void {
    const h = this.el('div', 'jsg-app'); h.id = `jsg-app-${ai}`;
    h.append(document.createTextNode('APPENDIX ‘')); h.append(this.titleEl(a, 'label', 'A1')); h.append(document.createTextNode('’')); h.append(document.createElement('br')); h.append(this.titleEl(a, 'title', 'Appendix title'));
    const code = this.codeEl({ id: a.id, title: `${a.label ? `${a.label} ` : ''}${a.title}`.trim() }, this.doc.chapters.length + ai + 1); if (code) h.append(code);
    s.appendChild(h);
    a.children.forEach((x, i) => { const e = this.blockEl(x, { list: a.children, index: i }); s.appendChild(e); if (focus === x) setFocus(e); });
  }

  private el(tag: string, cls = '', txt = ''): HTMLElement { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }

  /** A plain-text title that edits one string property of the model. */
  private titleEl<T extends Record<string, any>>(obj: T, key: keyof T & string, ph: string): HTMLElement {
    const e = this.el('span', 't'); e.dataset.ph = ph; e.textContent = String(obj[key] ?? '');
    this.slotList.push({ el: e, owner: obj, key, kind: 'title', show: () => { e.textContent = String(obj[key] ?? ''); } });
    if (!this.readOnly) { e.setAttribute('contenteditable', 'plaintext-only'); e.addEventListener('input', () => { (obj as any)[key] = (e.textContent ?? '').replace(/\s+/g, ' '); this.touch(); }); e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); }); }
    return e;
  }

  /** A run of rich text that edits an Inline[] of the model. */
  private richEl(tag: string, cls: string, get: () => Inline[], set: (i: Inline[]) => void, onEnter?: () => void, ph = '', owner?: object): HTMLElement {
    const e = this.el(tag, cls); e.innerHTML = inlineHtml(get()); if (ph) e.dataset.ph = ph;
    if (owner) this.slotList.push({ el: e, owner, key: 'inline', kind: 'rich', show: () => { e.innerHTML = inlineHtml(get()); } });
    if (!this.readOnly) {
      e.setAttribute('contenteditable', 'true');
      e.addEventListener('input', () => { set(readInline(e)); this.touch(); });
      e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && onEnter) { ev.preventDefault(); onEnter(); } else if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); document.execCommand('insertLineBreak'); e.dispatchEvent(new Event('input', { bubbles: true })); } });
      e.addEventListener('paste', (ev) => this.paste(ev, e));
    }
    return e;
  }

  private select(e: HTMLElement): void {
    const slot = this.slots.get(e); if (!slot) return;
    this.selected = slot; this.selectedEl?.classList.remove('jsg-sel'); this.selectedEl = e; e.classList.add('jsg-sel');
  }

  private blockEl(b: Block, slot: Slot): HTMLElement {
    let e: HTMLElement;
    switch (b.k) {
      case 'para': e = this.paraEl(b, slot); break;
      case 'list': e = this.listEl(b); break;
      case 'table': e = this.tableEl(b); break;
      case 'figure': e = this.figureEl(b); break;
      case 'pageBreak': e = this.el('div', 'jsg-break', 'page break'); break;
      default: e = this.noticeEl(b);
    }
    this.slots.set(e, slot); this.slotEls.push(e);
    e.addEventListener('focusin', (ev) => { ev.stopPropagation(); this.select(e); });
    e.addEventListener('click', () => this.select(e));
    return e;
  }

  private paraEl(p: Para, slot: Slot): HTMLElement {
    const e = this.richEl('div', 'jsg-p', () => p.inline, (i) => { p.inline = i; }, () => this.insert2(slot, newPara('', p.indent), p), 'Paragraph', p);
    e.style.marginLeft = `${[0, 0, 22.7, 58.7, 65.2, 73.7][p.indent] ?? 22.7}pt`; if (p.align) e.style.textAlign = p.align;
    return e;
  }
  private insert2(slot: Slot, block: Block, after: unknown): void { const i = slot.list.indexOf(after); slot.list.splice(i + 1, 0, block); this.afterEdit(block); }

  private partEl(p: Part): HTMLElement {
    if (p.k === 'text') return this.richEl('div', '', () => p.inline, (i) => { p.inline = i; }, undefined, '', p);
    if (p.k === 'para') return this.richEl('div', '', () => p.inline, (i) => { p.inline = i; }, undefined, '', p);
    if (p.k === 'graphic') return this.imgEl(p.graphic);
    return this.listEl(p);
  }

  private listEl(l: List): HTMLElement {
    const e = this.el('div', 'jsg-list'); e.style.marginLeft = `${[0, 0, 22.7, 58.7, 65.2, 73.7][l.indent] ?? 22.7}pt`;
    l.items.forEach((it, i) => {
      const li = this.el('div', 'jsg-li'); li.append(this.el('span', 'm', this.marker(l.type, i)));
      const body = this.el('div', 'b'); for (const part of it.parts) body.appendChild(this.partEl(part));
      if (!it.parts.length) { it.parts.push({ k: 'text', inline: [] }); body.appendChild(this.partEl(it.parts[0])); }
      li.appendChild(body); e.appendChild(li);
    });
    if (!this.readOnly) {
      const add = this.el('button', '', '+ item'); (add as HTMLButtonElement).type = 'button'; add.style.cssText = 'font:11px system-ui;margin-left:48px;border:1px dashed var(--sheet-jsg-placeholder);background:var(--sheet);color:var(--sheet-ink);border-radius:3px;cursor:pointer';
      add.addEventListener('mousedown', (ev) => ev.preventDefault());
      add.addEventListener('click', () => { l.items.push({ parts: [{ k: 'text', inline: [] }] }); this.afterEdit(l); });
      e.appendChild(add);
      const del = this.el('button', '', '− item'); (del as HTMLButtonElement).type = 'button'; del.style.cssText = add.style.cssText + ';margin-left:4px';
      del.addEventListener('mousedown', (ev) => ev.preventDefault());
      del.addEventListener('click', () => { if (l.items.length > 1) { l.items.pop(); this.afterEdit(l); } });
      e.appendChild(del);
    }
    return e;
  }
  private marker(t: ListType, i: number): string {
    if (t === 'alpha') return `(${String.fromCharCode(97 + (i % 26))})`;
    if (t === 'roman') return `(${toRoman(i + 1)})`;
    if (t === 'step') return `Step ${i + 1})`;
    if (t === 'bullet') return '•'; if (t === 'dash') return '-';
    return `${i + 1}.`;
  }

  private noticeEl(n: Notice): HTMLElement {
    const e = this.el('div', 'jsg-notice'); e.append(this.el('b', '', n.k));
    n.paras.forEach((p) => e.appendChild(this.richEl('div', 'jsg-p', () => p.inline, (i) => { p.inline = i; }, undefined, 'Text', p)));
    return e;
  }

  private imgEl(g: Graphic): HTMLElement {
    const img = document.createElement('img'); img.src = this.host.imageUrl(g.src); img.alt = g.src; img.onerror = () => { img.alt = `(missing picture: ${g.src})`; };
    return img;
  }

  private figureEl(f: Figure): HTMLElement {
    const n = ++this.figures; const e = this.el('div', 'jsg-fig');
    if (!f.graphics.length) e.append(this.el('div', 'empty', 'No picture yet'));
    for (const g of f.graphics) e.appendChild(this.imgEl(g));
    if (!this.readOnly) {
      const pick = this.el('button', '', f.graphics.length ? 'Change picture' : 'Choose picture'); (pick as HTMLButtonElement).type = 'button'; pick.style.cssText = 'font:12px system-ui;margin:4px';
      pick.addEventListener('mousedown', (ev) => ev.preventDefault());
      pick.addEventListener('click', () => void this.pickGraphic().then((g) => { if (g) { f.graphics = [{ src: g.src }]; this.afterEdit(f); } }));
      e.appendChild(pick);
    }
    const cap = this.el('div', 'jsg-cap'); cap.append(document.createTextNode(`Figure ${n}: `)); cap.append(this.titleEl(f, 'title', 'FIGURE NAME')); e.appendChild(cap);
    return e;
  }

  private pickGraphic(): Promise<GraphicInfo | null> { return pickGraphic(this.host); }

  private tableEl(t: Table): HTMLElement {
    const wrap = this.el('div', '');
    if (t.title !== undefined) { const n = ++this.tables; const cap = this.el('div', 'jsg-cap'); cap.append(document.createTextNode(`Table ${n}: `)); cap.append(this.titleEl(t, 'title', 'TABLE NAME')); wrap.appendChild(cap); }
    const tb = document.createElement('table'); tb.className = 'jsg-table'; (tb as any)._jsg = t;
    let r = 0;
    const rows = (rs: typeof t.head, tag: 'th' | 'td'): void => { for (const row of rs) { const tr = document.createElement('tr'); row.cells.forEach((c, ci) => { tr.appendChild(this.cellEl(c, tag, r, ci)); }); tb.appendChild(tr); r++; } };
    rows(t.head, 'th'); rows(t.body, 'td');
    wrap.appendChild(tb); return wrap;
  }
  private cellEl(c: Cell, tag: 'th' | 'td', r: number, ci: number): HTMLElement {
    const td = document.createElement(tag); td.dataset.r = String(r); td.dataset.c = String(ci);
    if (c.colspan) td.colSpan = c.colspan; if (c.rowspan) td.rowSpan = c.rowspan; if (c.align) td.style.textAlign = c.align;
    if (!c.parts.length) c.parts.push({ k: 'text', inline: [] });
    for (const p of c.parts) td.appendChild(this.partEl(p));
    return td;
  }

  private card(title: string): HTMLElement { const c = this.el('div', 'jsg-card'); c.append(this.el('h3', '', title)); this.sheet.appendChild(c); return c; }

  // The cover and the other ancillary pages are edited in the project's "Ancillary pages" dashboard, not here.
  private ancillaryNote(): void {
    const c = this.card('Cover and ancillary pages');
    c.append(this.el('div', 'jsg-tag', 'The cover, certificate, warning, preface, abbreviations and the other pages before the body are edited under "Ancillary pages" in the project menu on the left. This editor holds the chapters, sections and appendices.'));
  }

  // ── the outline (left) and the findings ─────────────────────────────────────────────────────────────────────────────────────
  private renderNav(): void {
    this.nav.innerHTML = '';
    const link = (label: string, cls: string, target: string): void => { const a = document.createElement('a'); a.className = cls; a.textContent = label; a.title = label; a.onclick = () => document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); this.nav.appendChild(a); };
    this.nav.append(this.el('h4', '', 'Outline'));
    this.doc.chapters.forEach((c, ci) => { link(`CHAPTER ${ci + 1}  ${c.title}`, 'l1', `jsg-ch-${ci}`); c.sections.forEach((s, si) => link(`SECTION ${si + 1}  ${s.title}`, 'l2', `jsg-sec-${ci}-${si}`)); });
    if (this.doc.appendices.length) { this.nav.append(this.el('h4', '', 'Appendices')); this.doc.appendices.forEach((a, i) => link(`${a.label}  ${a.title}`, 'l2', `jsg-app-${i}`)); }
    if (!this.readOnly) {
      const mk = (label: string, fn: () => void): void => { const b = this.el('button', '', label); (b as HTMLButtonElement).type = 'button'; b.style.cssText = 'font:11px system-ui;margin:4px 2px 0;border:1px solid var(--border);background:var(--bg-elev);border-radius:3px;cursor:pointer;color:var(--text)'; b.onclick = fn; this.nav.appendChild(b); };
      this.nav.append(this.el('h4', '', 'Structure'));
      mk('+ Chapter', () => { this.doc.chapters.push({ k: 'chapter', title: 'NEW CHAPTER', sections: [{ k: 'section', title: 'New section', orientation: 'portrait', children: [newPara('')] }] }); this.afterEdit(null); });
      mk('+ Section', () => { const c = this.doc.chapters[this.doc.chapters.length - 1]; if (c) { c.sections.push({ k: 'section', title: 'New section', orientation: 'portrait', children: [newPara('')] }); this.afterEdit(null); } });
      mk('+ Appendix', () => { this.doc.appendices.push({ k: 'appendix', label: 'X', title: 'New appendix', orientation: 'portrait', children: [newPara('')] }); this.afterEdit(null); });
      mk('− Last chapter', () => {
        const last = this.doc.chapters[this.doc.chapters.length - 1]; if (!last) return;
        // WP-35 (GAP-002): the application's dialog, naming what goes
        void confirmDialog({ title: 'Remove the last chapter?', message: `This removes the last chapter "${last.title}" and everything in it.`, confirmLabel: 'Remove', danger: true })
          .then((ok) => { const i = this.doc.chapters.indexOf(last); if (ok && i >= 0) { this.doc.chapters.splice(i, 1); this.afterEdit(null); } });
      });
    }
    if (this.findings.length) {
      this.nav.append(this.el('h4', '', `Problems (${this.findings.length})`));
      for (const f of this.findings) { const d = this.el('div', `jsg-find ${f.severity}`, f.message); d.title = `${f.rule}, line ${f.line}`; this.nav.appendChild(d); }
    }
  }
}

// kept for tests and callers that build documents without the editor
export { newClause, newFigure, newList, newNotice, newPara, newTable, plain, text };
export type { Chapter, Section, Appendix };

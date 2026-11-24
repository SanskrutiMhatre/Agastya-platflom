// The JSG editor: a WYSIWYG editor for a Joint Services Guide document (User Handbook).
//
// It shows the document the way the JSG stencil sets it - Times New Roman 12 pt, blue capital headings numbered CHAPTER n / SECTION n / n.n, captions numbered
// Figure n / Table n - and edits the model (./model.ts) directly. Pagination (mirrored margins, the blank versos, the contents with page numbers) is the PDF
// engine's job: the page beside this editor is the server-built PDF.
//
// Independent of the JSS editor (src/jss) and the S1000D Studio (src/studio): it imports only its own model and XML code.

import { isClause, newClause, newFigure, newList, newNotice, newPara, newTable, META_FIELDS, plain, text,
  type Appendix, type Block, type Cell, type Chapter, type Clause, type Figure, type Graphic, type Inline, type JsgDoc, type List, type ListType, type Mark, type Notice, type Para, type Part, type Section, type Table } from './model';
import { serializeJsg } from './xml';
import { BASE_CSS, coverCard, escH, injectCss, mk, pickGraphic, type GraphicInfo, type JsgEditorLike, type JsgEditorOptions, type JsgFinding, type JsgHost } from './shared';

export type { GraphicInfo, JsgFinding, JsgHost, JsgEditorOptions } from './shared';

type Container = Array<Block | Clause>;
interface Slot { list: Array<any>; index: number }

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

export class JsgEditor implements JsgEditorLike {
  private readonly root: HTMLElement;
  private readonly doc: JsgDoc;
  private readonly host: JsgHost;
  private readonly readOnly: boolean;
  private dirty = false;
  private findings: JsgFinding[] = [];
  private selected: Slot | null = null;
  private selectedEl: HTMLElement | null = null;
  private slots = new WeakMap<HTMLElement, Slot>();
  private sheet!: HTMLElement; private nav!: HTMLElement; private bar!: HTMLElement;
  private figures = 0; private tables = 0;
  private onKey = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.host.onSaveRequested(); }
  };

  constructor(host: HTMLElement, opts: JsgEditorOptions) {
    this.root = host; this.doc = opts.doc; this.host = opts.host; this.readOnly = opts.readOnly;
    injectCss('jsg-editor-css', BASE_CSS);
    this.root.innerHTML = '';
    this.root.classList.add('jsg-ed'); if (this.readOnly) this.root.classList.add('jsg-ro');
    this.nav = document.createElement('aside'); this.nav.className = 'jsg-nav';
    const main = document.createElement('div'); main.className = 'jsg-main';
    this.bar = document.createElement('div'); this.bar.className = 'jsg-bar';
    const scroll = document.createElement('div'); scroll.className = 'jsg-scroll';
    this.sheet = document.createElement('div'); this.sheet.className = 'jsg-sheet'; this.sheet.setAttribute('data-testid', 'jsg-sheet');
    scroll.appendChild(this.sheet); main.append(this.bar, scroll); this.root.append(this.nav, main);
    document.addEventListener('keydown', this.onKey);          // the page, not just the editor: Ctrl+S must save after a dialog closed with focus on the body
    this.buildBar();
    this.render();
  }

  destroy(): void { document.removeEventListener('keydown', this.onKey); this.root.innerHTML = ''; this.root.classList.remove('jsg-ed', 'jsg-ro'); }
  isDirty(): boolean { return this.dirty; }
  markSaved(): void { this.dirty = false; this.host.onDirty(false); }
  getXml(): string { return serializeJsg(this.doc); }
  getDoc(): JsgDoc { return this.doc; }
  setFindings(f: JsgFinding[]): void { this.findings = f; this.renderNav(); }

  private touch(): void { if (!this.dirty) { this.dirty = true; this.host.onDirty(true); } }

  // ── toolbar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private buildBar(): void {
    const b = (label: string, title: string, fn: () => void, edit = true): void => {
      const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.title = title; if (edit) el.className = 'edit';
      el.addEventListener('mousedown', (e) => e.preventDefault());          // keep the text selection
      el.addEventListener('click', () => { if (this.readOnly && edit) return; fn(); });
      this.bar.appendChild(el);
    };
    const sep = (): void => { const s = document.createElement('span'); s.className = 'sep'; this.bar.appendChild(s); };
    b('B', 'Bold (Ctrl+B)', () => this.mark('bold')); b('I', 'Italic (Ctrl+I)', () => this.mark('italic')); b('U', 'Underline (Ctrl+U)', () => this.mark('underline'));
    b('x²', 'Superscript', () => this.mark('superscript')); b('x₂', 'Subscript', () => this.mark('subscript'));
    sep();
    b('+ Paragraph', 'Add a paragraph after the selected block', () => this.insert(newPara('')));
    b('+ Heading', 'Add a numbered heading (1.1, 1.1.1 ...) under the selected one', () => this.addClause());
    b('+ (a) list', 'Add a lettered list', () => this.insert(newList('alpha')));
    b('+ 1. list', 'Add a numbered list', () => this.insert(newList('number')));
    b('+ Step list', 'Add a procedure with "Step 1)"', () => this.insert(newList('step')));
    b('+ Table', 'Add a table (3 x 3)', () => this.insert(newTable(3, 3, 'TABLE NAME')));
    b('+ Figure', 'Add a figure with its caption', () => this.insert(newFigure()));
    b('+ Note', 'Add a note', () => this.insert(newNotice('note'))); b('+ Warning', 'Add a warning', () => this.insert(newNotice('warning'))); b('+ Caution', 'Add a caution', () => this.insert(newNotice('caution')));
    b('Page break', 'Start a new page here', () => this.insert({ k: 'pageBreak' }));
    sep();
    b('↑', 'Move the selected block up', () => this.move(-1)); b('↓', 'Move the selected block down', () => this.move(1)); b('Delete', 'Delete the selected block', () => this.remove());
    sep();
    b('Row +', 'Add a table row below the cursor', () => this.tableOp('row+')); b('Col +', 'Add a table column right of the cursor', () => this.tableOp('col+'));
    b('Row −', 'Delete the table row', () => this.tableOp('row-')); b('Col −', 'Delete the table column', () => this.tableOp('col-'));
    sep();
    b('Check', 'Check the document without saving', () => this.host.onCheckRequested(), false);
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
  private afterEdit(focus: unknown): void { this.touch(); const keep = this.sheet.parentElement?.scrollTop ?? 0; this.render(focus); if (this.sheet.parentElement) this.sheet.parentElement.scrollTop = keep; }

  // ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private render(focus?: unknown): void {
    this.sheet.innerHTML = ''; this.slots = new WeakMap(); this.figures = 0; this.tables = 0;
    const s = this.sheet; let focusEl: HTMLElement | null = null;
    this.cover(s); this.frontMatter(s);
    this.doc.chapters.forEach((ch, ci) => {
      const h = this.el('div', 'jsg-chapter'); h.id = `jsg-ch-${ci}`;
      h.append(this.el('span', 'jsg-num', `CHAPTER ${ci + 1}`)); h.append(this.titleEl(ch, 'title', 'Chapter title')); s.appendChild(h);
      ch.sections.forEach((sec, si) => {
        const sh = this.el('div', 'jsg-sectionh'); sh.id = `jsg-sec-${ci}-${si}`;
        sh.append(this.el('span', 'jsg-num', `SECTION ${si + 1}`)); sh.append(this.titleEl(sec, 'title', 'Section title')); s.appendChild(sh);
        const slot = (list: Array<any>, i: number): Slot => ({ list, index: i });
        const walk = (list: Container, prefix: string): void => list.forEach((x, i) => {
          if (isClause(x)) {
            const n = list.slice(0, i + 1).filter(isClause).length; const num = `${prefix}${n}`;
            const c = this.el('div', 'jsg-clause'); c.append(this.el('span', 'n', num)); c.append(this.titleEl(x, 'title', 'Heading'));
            this.slots.set(c, slot(list, i)); c.addEventListener('focusin', () => this.select(c)); s.appendChild(c); if (focus === x) focusEl = c;
            walk(x.children, `${num}.`);
          } else { const e = this.blockEl(x, slot(list, i)); s.appendChild(e); if (focus === x) focusEl = e; }
        });
        walk(sec.children, `${si + 1}.`);
      });
    });
    this.doc.appendices.forEach((a, ai) => this.appendix(s, a, ai, focus, (e) => { focusEl = e; }));
    this.renderNav();
    if (focusEl) { const f = focusEl as HTMLElement; const first = f.querySelector<HTMLElement>('[contenteditable]'); (first ?? f).focus?.(); this.select(f); }
  }

  private appendix(s: HTMLElement, a: Appendix, ai: number, focus: unknown, setFocus: (e: HTMLElement) => void): void {
    const h = this.el('div', 'jsg-app'); h.id = `jsg-app-${ai}`;
    h.append(document.createTextNode('APPENDIX ‘')); h.append(this.titleEl(a, 'label', 'A1')); h.append(document.createTextNode('’')); h.append(document.createElement('br')); h.append(this.titleEl(a, 'title', 'Appendix title'));
    s.appendChild(h);
    a.children.forEach((x, i) => { const e = this.blockEl(x, { list: a.children, index: i }); s.appendChild(e); if (focus === x) setFocus(e); });
  }

  private el(tag: string, cls = '', txt = ''): HTMLElement { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }

  /** A plain-text title that edits one string property of the model. */
  private titleEl<T extends Record<string, any>>(obj: T, key: keyof T & string, ph: string): HTMLElement {
    const e = this.el('span', 't'); e.dataset.ph = ph; e.textContent = String(obj[key] ?? '');
    if (!this.readOnly) { e.setAttribute('contenteditable', 'plaintext-only'); e.addEventListener('input', () => { (obj as any)[key] = (e.textContent ?? '').replace(/\s+/g, ' '); this.touch(); }); e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); }); }
    return e;
  }

  /** A run of rich text that edits an Inline[] of the model. */
  private richEl(tag: string, cls: string, get: () => Inline[], set: (i: Inline[]) => void, onEnter?: () => void, ph = ''): HTMLElement {
    const e = this.el(tag, cls); e.innerHTML = inlineHtml(get()); if (ph) e.dataset.ph = ph;
    if (!this.readOnly) {
      e.setAttribute('contenteditable', 'true');
      e.addEventListener('input', () => { set(readInline(e)); this.touch(); });
      e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && onEnter) { ev.preventDefault(); onEnter(); } else if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); document.execCommand('insertLineBreak'); e.dispatchEvent(new Event('input', { bubbles: true })); } });
      e.addEventListener('paste', (ev) => { ev.preventDefault(); const t = ev.clipboardData?.getData('text/plain') ?? ''; document.execCommand('insertText', false, t); });
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
    this.slots.set(e, slot);
    e.addEventListener('focusin', (ev) => { ev.stopPropagation(); this.select(e); });
    e.addEventListener('click', () => this.select(e));
    return e;
  }

  private paraEl(p: Para, slot: Slot): HTMLElement {
    const e = this.richEl('div', 'jsg-p', () => p.inline, (i) => { p.inline = i; }, () => this.insert2(slot, newPara('', p.indent), p), 'Paragraph');
    e.style.marginLeft = `${[0, 0, 22.7, 58.7, 65.2, 73.7][p.indent] ?? 22.7}pt`; if (p.align) e.style.textAlign = p.align;
    return e;
  }
  private insert2(slot: Slot, block: Block, after: unknown): void { const i = slot.list.indexOf(after); slot.list.splice(i + 1, 0, block); this.afterEdit(block); }

  private partEl(p: Part): HTMLElement {
    if (p.k === 'text') return this.richEl('div', '', () => p.inline, (i) => { p.inline = i; });
    if (p.k === 'para') return this.richEl('div', '', () => p.inline, (i) => { p.inline = i; });
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
      const add = this.el('button', '', '+ item'); (add as HTMLButtonElement).type = 'button'; add.style.cssText = 'font:11px system-ui;margin-left:48px;border:1px dashed #9aa4ae;background:#fff;border-radius:3px;cursor:pointer';
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
    if (t === 'step') return `Step ${i + 1})`;
    if (t === 'bullet') return '•'; if (t === 'dash') return '-';
    return `${i + 1}.`;
  }

  private noticeEl(n: Notice): HTMLElement {
    const e = this.el('div', 'jsg-notice'); e.append(this.el('b', '', n.k));
    n.paras.forEach((p) => e.appendChild(this.richEl('div', 'jsg-p', () => p.inline, (i) => { p.inline = i; }, undefined, 'Text')));
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

  // ── the cover and the front matter ──────────────────────────────────────────────────────────────────────────────────────────
  private card(title: string): HTMLElement { const c = this.el('div', 'jsg-card'); c.append(this.el('h3', '', title)); this.sheet.appendChild(c); return c; }

  private cover(_s: HTMLElement): void { coverCard(this.sheet, this.doc, this.readOnly, () => this.touch(), ['qtyUnit']); }

  private frontMatter(_s: HTMLElement): void {
    const f = this.doc.front;
    const itemsCard = (title: string, key: 'warning' | 'dos' | 'donts' | 'important'): void => {
      const c = this.card(title); const arr = f[key];
      const draw = (): void => {
        c.querySelectorAll('.jsg-row').forEach((r) => r.remove()); const addBtn = c.querySelector('button.add');
        arr.forEach((it, i) => { const r = this.el('div', 'jsg-row'); r.append(this.el('span', '', `${i + 1}.`)); r.appendChild(this.richEl('div', '', () => it, (v) => { arr[i] = v; f.has[key] = true; }));
          if (!this.readOnly) { const d = this.el('button', '', '×'); (d as HTMLButtonElement).type = 'button'; d.onclick = () => { arr.splice(i, 1); this.touch(); draw(); }; r.appendChild(d); } if (addBtn) c.insertBefore(r, addBtn); else c.appendChild(r); });
      };
      if (!this.readOnly) { const a = this.el('button', 'add', '+ item'); (a as HTMLButtonElement).type = 'button'; a.onclick = () => { arr.push([]); f.has[key] = true; this.touch(); draw(); }; c.appendChild(a); }
      draw();
    };
    itemsCard('Warning page (numbered items)', 'warning');
    const pf = this.card('Preface (numbered paragraphs)');
    { const draw = (): void => { pf.querySelectorAll('.jsg-row').forEach((r) => r.remove()); const addBtn = pf.querySelector('button.add');
        f.preface.forEach((p, i) => { if (p.k !== 'para') return; const r = this.el('div', 'jsg-row'); r.append(this.el('span', '', `${i + 1}.`)); r.appendChild(this.richEl('div', '', () => p.inline, (v) => { p.inline = v; f.has.preface = true; }));
          if (!this.readOnly) { const d = this.el('button', '', '×'); (d as HTMLButtonElement).type = 'button'; d.onclick = () => { f.preface.splice(i, 1); this.touch(); draw(); }; r.appendChild(d); } if (addBtn) pf.insertBefore(r, addBtn); else pf.appendChild(r); }); };
      if (!this.readOnly) { const a = this.el('button', 'add', '+ paragraph'); (a as HTMLButtonElement).type = 'button'; a.onclick = () => { f.preface.push(newPara('')); f.has.preface = true; this.touch(); draw(); }; pf.appendChild(a); }
      draw(); }
    itemsCard("Do's", 'dos'); itemsCard("Dont's", 'donts'); itemsCard('Important points', 'important');
    const ab = this.card('Abbreviations');
    { const draw = (): void => { ab.querySelectorAll('.jsg-row').forEach((r) => r.remove()); const addBtn = ab.querySelector('button.add');
        f.abbreviations.forEach((a, i) => { const r = this.el('div', 'jsg-row'); r.append(this.el('span', '', `${i + 1}`));
          const s = document.createElement('input'); s.value = a.short; s.placeholder = 'Abbreviation'; s.disabled = this.readOnly; s.addEventListener('input', () => { a.short = s.value; f.has.abbreviations = true; this.touch(); });
          const l = document.createElement('input'); l.value = a.long; l.placeholder = 'For'; l.disabled = this.readOnly; l.addEventListener('input', () => { a.long = l.value; f.has.abbreviations = true; this.touch(); });
          r.append(s, l); if (!this.readOnly) { const d = this.el('button', '', '×'); (d as HTMLButtonElement).type = 'button'; d.onclick = () => { f.abbreviations.splice(i, 1); this.touch(); draw(); }; r.appendChild(d); }
          if (addBtn) ab.insertBefore(r, addBtn); else ab.appendChild(r); }); };
      if (!this.readOnly) { const a = this.el('button', 'add', '+ abbreviation'); (a as HTMLButtonElement).type = 'button'; a.onclick = () => { f.abbreviations.push({ short: '', long: '' }); f.has.abbreviations = true; this.touch(); draw(); }; ab.appendChild(a); }
      draw(); }
    const am = this.card('Amendments'); const row = this.el('div', 'jsg-row');
    row.append(document.createTextNode('Blank rows printed in the table: ')); const n = document.createElement('input'); n.type = 'number'; n.min = '0'; n.max = '60'; n.value = String(f.amendmentsMinRows); n.style.maxWidth = '70px'; n.disabled = this.readOnly;
    n.addEventListener('input', () => { f.amendmentsMinRows = Math.max(0, Math.min(60, Number(n.value) || 0)); f.has.amendments = true; this.touch(); }); row.appendChild(n); am.appendChild(row);
    am.append(this.el('div', 'jsg-tag', 'Contents, List of figures and List of tables are produced from the headings, figures and tables below.'));
  }

  // ── the outline (left) and the findings ─────────────────────────────────────────────────────────────────────────────────────
  private renderNav(): void {
    this.nav.innerHTML = '';
    const link = (label: string, cls: string, target: string): void => { const a = document.createElement('a'); a.className = cls; a.textContent = label; a.title = label; a.onclick = () => document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); this.nav.appendChild(a); };
    this.nav.append(this.el('h4', '', 'Outline'));
    this.doc.chapters.forEach((c, ci) => { link(`CHAPTER ${ci + 1}  ${c.title}`, 'l1', `jsg-ch-${ci}`); c.sections.forEach((s, si) => link(`SECTION ${si + 1}  ${s.title}`, 'l2', `jsg-sec-${ci}-${si}`)); });
    if (this.doc.appendices.length) { this.nav.append(this.el('h4', '', 'Appendices')); this.doc.appendices.forEach((a, i) => link(`${a.label}  ${a.title}`, 'l2', `jsg-app-${i}`)); }
    if (!this.readOnly) {
      const mk = (label: string, fn: () => void): void => { const b = this.el('button', '', label); (b as HTMLButtonElement).type = 'button'; b.style.cssText = 'font:11px system-ui;margin:4px 2px 0;border:1px solid #cfd4da;background:#fff;border-radius:3px;cursor:pointer;color:#1b1f24'; b.onclick = fn; this.nav.appendChild(b); };
      this.nav.append(this.el('h4', '', 'Structure'));
      mk('+ Chapter', () => { this.doc.chapters.push({ k: 'chapter', title: 'NEW CHAPTER', sections: [{ k: 'section', title: 'New section', orientation: 'portrait', children: [newPara('')] }] }); this.afterEdit(null); });
      mk('+ Section', () => { const c = this.doc.chapters[this.doc.chapters.length - 1]; if (c) { c.sections.push({ k: 'section', title: 'New section', orientation: 'portrait', children: [newPara('')] }); this.afterEdit(null); } });
      mk('+ Appendix', () => { this.doc.appendices.push({ k: 'appendix', label: 'X', title: 'New appendix', orientation: 'portrait', children: [newPara('')] }); this.afterEdit(null); });
      mk('− Last chapter', () => { if (this.doc.chapters.length && window.confirm('Remove the last chapter and everything in it?')) { this.doc.chapters.pop(); this.afterEdit(null); } });
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

// =============================================================================
// The Y document schema of a JSS document under live co-editing (Phase 3, P3-1) - ONE definition for the server (which loads a room from
// publication.xml and writes it back, services/jss/collab.ts) and for the browser binding (frontend/src/jss/live.ts). The contract is
// docs/phase3/COLLAB-CONTRACT.md; the reasons are in docs/phase3/collab-jss.md.
//
// The tree is the editor's model (shared/jss/model.ts) in the generic XML form of shared/collab/ydom.ts (Y.XmlElement per element, text in
// Y.XmlText, attributes as Y attributes), in the fragment 'xml', with no whitespace between elements:
//
//   jssbook{docType,schemaVersion} > bookmeta > <field>text          body > chapter{number,id?,orientation?} > title(text), blocks..., section...
//   section{id?,orientation?} > title(text), blocks..., section...    para{align?,indent?} > inline        pageBreak
//   list{type?} > item > part...      part = run > inline | para | list   (a run is an item's or a cell's text between its paragraphs and lists)
//   table{id?,widths?} > title(text), thead > row..., tbody > row...    row > cell{colspan?,rowspan?,align?} > part...
//   figure{id?} > title(text), graphics > graphic{src,width?,height?}..., legend > keyitem{num}(text)...
//   note | warning | caution > (para | list)...                          inline = text | b | i | u | sup | sub (> inline) | br | xref{to?,href?} (> inline)
//
// So concurrent typing in one paragraph, title or cell merges character by character (Y.XmlText), and structural edits (sections, blocks,
// list items, rows, cells, key items) are insertions and deletions of whole elements, which Yjs merges deterministically. The file is never
// this tree's XML: it is serializeJss(readDoc(tree)), the editor's own serializer, so a write-back is byte for byte a normal JSS save.
//
// Three ways to bring a tree to a model:
//   loadDoc       an empty Y document from a model (a room's first load)
//   reconcileDoc  a positional, minimal merge (an external change: an import, a restore, a save by version, a GitLab pull)
//   syncDoc       a keyed merge by the model objects' identity (the browser: the editor changed its model in place; a moved section is
//                 removed and inserted, everything else is changed where it is)
// =============================================================================

import * as Y from 'yjs';
import * as ydom from '../collab/ydom';
import type { XNode } from '../collab/xmlForm';
import {
  META_FIELDS, type Block, type Cell, type Chapter, type Figure, type Graphic, type Inline, type JssDoc, type KeyItem, type List, type ListItem, type Mark, type Notice,
  type Para, type Part, type Row, type Section, type Table,
} from './model';

export const ROOT = ydom.ROOT;
/** The element of an item's or a cell's inline text (it has no element of its own in the file). */
export const RUN = 'run';
export const SCHEMA = 'jss-1';

// ---------------------------------------------------------------- the model as a light DOM (the input of ydom's builders)

interface VAttr { name: string; value: string }
export interface VNode {
  nodeType: number; nodeName: string; nodeValue: string | null; attributes: VAttr[]; childNodes: VNode[];
  /** the model object this element stands for (keyed elements only) */
  model?: object;
}
const asX = (v: VNode): XNode => v as unknown as XNode;

const el = (name: string, attrs: Record<string, string | number | undefined>, kids: VNode[] = [], model?: object): VNode => {
  const attributes: VAttr[] = [];
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== '') attributes.push({ name: k, value: String(v) });
  return { nodeType: 1, nodeName: name, nodeValue: null, attributes, childNodes: kids, ...(model ? { model } : {}) };
};
const tx = (s: string): VNode => ({ nodeType: 3, nodeName: '#text', nodeValue: s, attributes: [], childNodes: [] });
const MARKS = new Set(['b', 'i', 'u', 'sup', 'sub']);
const NOTICES = new Set(['note', 'warning', 'caution']);

export const inlineV = (runs: Inline[]): VNode[] => runs.map((r): VNode => {
  if (r.t === 'text') return tx(r.text);
  if (r.t === 'br') return el('br', {});
  if (r.t === 'mark') return el(r.mark, {}, inlineV(r.children));
  return el('xref', { to: r.to, href: r.href }, inlineV(r.children));
}).filter((n) => n.nodeType !== 3 || n.nodeValue !== '');
export const paraV = (p: Para): VNode => el('para', { align: p.align, indent: p.indentNone ? 'none' : undefined }, inlineV(p.inline), p);
export const partV = (p: Part): VNode => (p.k === 'inline' ? el(RUN, {}, inlineV(p.inline), p) : p.k === 'para' ? paraV(p) : listV(p));
export const listV = (l: List): VNode => el('list', { type: l.type }, l.items.map((it) => el('item', {}, it.parts.map(partV), it)), l);
const cellV = (c: Cell): VNode => el('cell', { colspan: c.colspan, rowspan: c.rowspan, align: c.align }, c.parts.map(partV), c);
const rowV = (r: Row): VNode => el('row', {}, r.cells.map(cellV), r);
export const titleV = (s: string | undefined): VNode => el('title', {}, [tx(s ?? '')]);
const tableV = (t: Table): VNode => el('table', { id: t.id, widths: t.widths }, [titleV(t.title), el('thead', {}, t.head.map(rowV)), el('tbody', {}, t.body.map(rowV))], t);
export const keyitemV = (k: KeyItem): VNode => el('keyitem', { num: k.num }, [tx(k.text)], k);
const graphicV = (g: Graphic): VNode => el('graphic', { src: g.src, width: g.width, height: g.height }, [], g);
const figureV = (f: Figure): VNode => el('figure', { id: f.id }, [titleV(f.title), el('graphics', {}, f.graphics.map(graphicV)), el('legend', {}, f.legend.map(keyitemV))], f);
const noticeV = (n: Notice): VNode => el(n.k, {}, n.parts.map((p) => (p.k === 'para' ? paraV(p) : listV(p))), n);
export function blockV(b: Block | Section): VNode {
  switch (b.k) {
    case 'section': return el('section', { id: b.id, orientation: b.orientation }, [titleV(b.title), ...b.children.map(blockV)], b);
    case 'para': return paraV(b);
    case 'list': return listV(b);
    case 'table': return tableV(b);
    case 'figure': return figureV(b);
    case 'pageBreak': return el('pageBreak', {}, [], b);
    default: return noticeV(b);
  }
}
export const chapterV = (c: Chapter): VNode => el('chapter', { number: c.number, id: c.id, orientation: c.orientation }, [titleV(c.title), ...c.children.map(blockV)], c);
export const metaV = (meta: Record<string, string>): VNode => el('bookmeta', {}, META_FIELDS.filter((f) => typeof meta[f.key] === 'string').map((f) => el(f.key, {}, [tx(meta[f.key])])));
export const bookV = (d: JssDoc): VNode => el('jssbook', { docType: d.docType, schemaVersion: '1.0' }, [metaV(d.meta), el('body', {}, d.chapters.map(chapterV))], d);
const docV = (d: JssDoc): VNode => ({ nodeType: 9, nodeName: '#document', nodeValue: null, attributes: [], childNodes: [bookV(d)] });

// ---------------------------------------------------------------- loading and the external merge

/** Fill an empty Y document from a model. */
export function loadDoc(ydoc: Y.Doc, d: JssDoc, origin?: unknown): void {
  ydom.loadInto(ydoc, { doc: asX(docV(d)), doctype: null, xmlDecl: null }, origin);
  ydoc.transact(() => { if (ydoc.getMap(ydom.META).get('jss') !== SCHEMA) ydoc.getMap(ydom.META).set('jss', SCHEMA); }, origin);
}

/** Bring a Y document to a model with the fewest changes, by position (an external change: the people's unwritten edits stay). */
export function reconcileDoc(ydoc: Y.Doc, d: JssDoc, origin?: unknown): void {
  ydom.reconcileDocument(ydoc, { doc: asX(docV(d)), doctype: null, xmlDecl: null }, origin);
}

// ---------------------------------------------------------------- reading (Y -> model)

/** Object identity kept between the model and the tree (the browser binding); the server reads without it. */
export interface Maps { yToModel: WeakMap<Y.XmlElement, object>; modelToY: WeakMap<object, Y.XmlElement> }
export const newMaps = (): Maps => ({ yToModel: new WeakMap(), modelToY: new WeakMap() });

const kids = (y: Y.XmlElement | Y.XmlFragment): Array<Y.XmlElement | Y.XmlText> => y.toArray().filter((c): c is Y.XmlElement | Y.XmlText => c instanceof Y.XmlElement || c instanceof Y.XmlText);
const elems = (y: Y.XmlElement | Y.XmlFragment): Y.XmlElement[] => y.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
const attr = (y: Y.XmlElement, name: string): string | undefined => { const v = y.getAttribute(name) as unknown; return typeof v === 'string' && v !== '' ? v : undefined; };
/** The characters under an element (its text nodes, in order). */
export const textIn = (y: Y.XmlElement): string => kids(y).map((c) => (c instanceof Y.XmlText ? ydom.textValue(c) : '')).join('');
const childNamed = (y: Y.XmlElement, name: string): Y.XmlElement | null => elems(y).find((c) => c.nodeName === name) ?? null;
const oneOf = <T extends string>(v: string | undefined, list: readonly string[]): T | undefined => (v !== undefined && list.includes(v) ? (v as T) : undefined);
const posInt = (v: string | undefined): number | undefined => (v && /^[1-9]\d*$/.test(v) ? Number(v) : undefined);
const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
const ORIENTATIONS = ['portrait', 'landscape', 'a3-landscape'] as const;
const LIST_TYPES = ['alpha', 'roman', 'number', 'bullet', 'dash'] as const;

export function readInline(y: Y.XmlElement): Inline[] {
  const out: Inline[] = [];
  for (const c of kids(y)) {
    if (c instanceof Y.XmlText) { const t = ydom.textValue(c); if (t) out.push({ t: 'text', text: t }); continue; }
    const n = c.nodeName;
    if (MARKS.has(n)) out.push({ t: 'mark', mark: n as Mark, children: readInline(c) });
    else if (n === 'br') out.push({ t: 'br' });
    else if (n === 'xref') out.push({ t: 'xref', to: attr(c, 'to'), href: attr(c, 'href'), children: readInline(c) });
  }
  return out;
}

/** A reader; with `maps`, an element already paired with a model object fills that same object (the editor keeps its references). */
export class Reader {
  constructor(private readonly maps: Maps | null = null) {}

  private take<T extends object>(y: Y.XmlElement, ok: (o: object) => boolean, fresh: () => T): T {
    const had = this.maps?.yToModel.get(y);
    const o = (had && ok(had) ? had : fresh()) as T;
    if (this.maps) { this.maps.yToModel.set(y, o); this.maps.modelToY.set(o, y); }
    return o;
  }
  private kOf = (k: string) => (o: object): boolean => (o as { k?: string }).k === k;

  para(y: Y.XmlElement): Para {
    const p = this.take<Para>(y, this.kOf('para'), () => ({ k: 'para', inline: [] }));
    p.align = oneOf(attr(y, 'align'), ALIGNS); p.indentNone = attr(y, 'indent') === 'none' || undefined; p.inline = readInline(y);
    return p;
  }
  part(y: Y.XmlElement): Part | null {
    if (y.nodeName === RUN) { const r = this.take<Part & { k: 'inline' }>(y, this.kOf('inline'), () => ({ k: 'inline', inline: [] })); r.inline = readInline(y); return r; }
    if (y.nodeName === 'para') return this.para(y);
    if (y.nodeName === 'list') return this.list(y);
    return null;
  }
  list(y: Y.XmlElement): List {
    const l = this.take<List>(y, this.kOf('list'), () => ({ k: 'list', items: [] }));
    l.type = oneOf(attr(y, 'type'), LIST_TYPES);
    l.items = elems(y).filter((c) => c.nodeName === 'item').map((c) => {
      const it = this.take<ListItem>(c, (o) => Array.isArray((o as ListItem).parts) && !(o as { k?: string }).k, () => ({ parts: [] }));
      it.parts = this.parts(c);
      return it;
    });
    if (!l.items.length) l.items = [{ parts: [{ k: 'inline', inline: [] }] }];   // a list has at least one item (two removals of the last two at once)
    return l;
  }
  private parts(y: Y.XmlElement): Part[] {
    const parts = elems(y).map((c) => this.part(c)).filter((p): p is Part => !!p);
    return parts.length ? parts : [{ k: 'inline', inline: [] }];
  }
  private rows(y: Y.XmlElement | null): Row[] {
    if (!y) return [];
    return elems(y).filter((c) => c.nodeName === 'row').map((r) => {
      const row = this.take<Row>(r, (o) => Array.isArray((o as Row).cells), () => ({ cells: [] }));
      row.cells = elems(r).filter((c) => c.nodeName === 'cell').map((c) => {
        const cell = this.take<Cell>(c, (o) => Array.isArray((o as Cell).parts) && !(o as { k?: string }).k, () => ({ parts: [] }));
        cell.colspan = posInt(attr(c, 'colspan')); cell.rowspan = posInt(attr(c, 'rowspan')); cell.align = oneOf(attr(c, 'align'), ALIGNS);
        cell.parts = this.parts(c);
        return cell;
      });
      return row;
    });
  }
  table(y: Y.XmlElement): Table {
    const t = this.take<Table>(y, this.kOf('table'), () => ({ k: 'table', head: [], body: [] }));
    const title = childNamed(y, 'title');
    t.id = attr(y, 'id'); t.widths = attr(y, 'widths'); t.title = title ? textIn(title) : undefined;
    t.head = this.rows(childNamed(y, 'thead')); t.body = this.rows(childNamed(y, 'tbody'));
    return t;
  }
  figure(y: Y.XmlElement): Figure {
    const f = this.take<Figure>(y, this.kOf('figure'), () => ({ k: 'figure', graphics: [], legend: [] }));
    const title = childNamed(y, 'title'); const g = childNamed(y, 'graphics'); const lg = childNamed(y, 'legend');
    f.id = attr(y, 'id'); f.title = title ? textIn(title) : undefined;
    f.graphics = g ? elems(g).filter((c) => c.nodeName === 'graphic' && attr(c, 'src')).map((c) => {
      const gr = this.take<Graphic>(c, (o) => typeof (o as Graphic).src === 'string', () => ({ src: '' }));
      gr.src = attr(c, 'src') ?? ''; gr.width = attr(c, 'width'); gr.height = attr(c, 'height');
      return gr;
    }) : [];
    f.legend = lg ? elems(lg).filter((c) => c.nodeName === 'keyitem').map((c) => this.keyitem(c)) : [];
    return f;
  }
  keyitem(y: Y.XmlElement): KeyItem {
    const k = this.take<KeyItem>(y, (o) => typeof (o as KeyItem).num === 'string' && typeof (o as KeyItem).text === 'string', () => ({ num: '', text: '' }));
    const n = y.getAttribute('num') as unknown;
    k.num = typeof n === 'string' ? n : ''; k.text = textIn(y);
    return k;
  }
  private notice(y: Y.XmlElement): Notice {
    const n = this.take<Notice>(y, this.kOf(y.nodeName), () => ({ k: y.nodeName as Notice['k'], parts: [] }));
    n.parts = elems(y).map((c) => (c.nodeName === 'para' ? this.para(c) : c.nodeName === 'list' ? this.list(c) : null)).filter((p): p is Para | List => !!p);
    return n;
  }
  block(y: Y.XmlElement): Block | Section | null {
    switch (y.nodeName) {
      case 'section': return this.section(y);
      case 'para': return this.para(y);
      case 'list': return this.list(y);
      case 'table': return this.table(y);
      case 'figure': return this.figure(y);
      case 'pageBreak': return this.take<Block>(y, this.kOf('pageBreak'), () => ({ k: 'pageBreak' }));
      default: return NOTICES.has(y.nodeName) ? this.notice(y) : null;
    }
  }
  /** A section's or chapter's children: its own blocks first, then its sub-sections (the order the PDF prints, the order parseJss keeps). */
  private children(y: Y.XmlElement): Array<Block | Section> {
    const all = elems(y).filter((c) => c.nodeName !== 'title').map((c) => this.block(c)).filter((b): b is Block | Section => !!b);
    return [...all.filter((c) => c.k !== 'section'), ...all.filter((c) => c.k === 'section')];
  }
  section(y: Y.XmlElement): Section {
    const s = this.take<Section>(y, this.kOf('section'), () => ({ k: 'section', title: '', children: [] }));
    const title = childNamed(y, 'title');
    s.id = attr(y, 'id'); s.orientation = oneOf(attr(y, 'orientation'), ORIENTATIONS); s.title = title ? textIn(title) : ''; s.children = this.children(y);
    return s;
  }
  chapter(y: Y.XmlElement, i: number): Chapter {
    const c = this.take<Chapter>(y, this.kOf('chapter'), () => ({ k: 'chapter', number: i + 1, title: '', children: [] }));
    const title = childNamed(y, 'title');
    c.number = posInt(attr(y, 'number')) ?? i + 1; c.id = attr(y, 'id'); c.orientation = oneOf(attr(y, 'orientation'), ORIENTATIONS);
    c.title = title ? textIn(title) : ''; c.children = this.children(y);
    return c;
  }
  /** The document (null: the tree holds no <jssbook>). `into`: the model object to fill (the editor's). */
  doc(frag: Y.XmlFragment, into?: JssDoc): JssDoc | null {
    const book = elems(frag).find((c) => c.nodeName === 'jssbook');
    if (!book) return null;
    const d: JssDoc = into ?? { docType: '', meta: {}, chapters: [] };
    if (this.maps) { this.maps.yToModel.set(book, d); this.maps.modelToY.set(d, book); }
    d.docType = String(book.getAttribute('docType') ?? '');
    const meta: Record<string, string> = {};
    const bm = childNamed(book, 'bookmeta');
    const known = new Set(META_FIELDS.map((f) => f.key));
    if (bm) for (const f of elems(bm)) if (known.has(f.nodeName)) meta[f.nodeName] = textIn(f);
    d.meta = meta;
    const body = childNamed(book, 'body');
    d.chapters = body ? elems(body).filter((c) => c.nodeName === 'chapter').map((c, i) => this.chapter(c, i)) : [];
    delete d.reordered;
    return d;
  }
}

/** The model a Y document holds (null: no document in it). */
export const readDoc = (ydoc: Y.Doc): JssDoc | null => new Reader().doc(ydoc.getXmlFragment(ROOT));

// ---------------------------------------------------------------- the keyed merge (model -> Y, the browser binding)

/** Elements whose children are reconciled by position (text and inline markup, no model objects among them). */
const LEAF = new Set(['para', RUN, 'title', 'keyitem', 'graphic', 'pageBreak', 'bookmeta']);

const live = (y: Y.XmlElement): boolean => !!y.doc && !(y as unknown as { _item: { deleted: boolean } | null })._item?.deleted;

export class Sync {
  constructor(private readonly maps: Maps) {}

  private bind = (d: XNode, y: ydom.YNode): void => {
    const m = (d as unknown as VNode).model;
    if (m && y instanceof Y.XmlElement) { this.maps.yToModel.set(y, m); this.maps.modelToY.set(m, y); }
  };

  private keyOfY(y: Y.XmlElement | Y.XmlText): unknown {
    if (y instanceof Y.XmlText) return null;
    return this.maps.yToModel.get(y) ?? `#${y.nodeName}`;
  }
  private keyOfV(v: VNode): unknown { return v.model ?? `#${v.nodeName}`; }

  /** Make the element `y` what `v` describes. */
  el(y: Y.XmlElement, v: VNode): void {
    if (LEAF.has(v.nodeName)) { ydom.reconcile(y, asX(v), this.bind); return; }
    ydom.syncAttributes(y, asX(v));
    if (v.model) { this.maps.yToModel.set(y, v.model); this.maps.modelToY.set(v.model, y); }
    this.children(y, v.childNodes);
  }

  /** The children of `y` made `want`: a child is kept (and merged) when it stands for the same model object or is the same fixed element. */
  children(y: Y.XmlElement | Y.XmlFragment, want: VNode[]): void {
    const cur = kids(y);
    const at = new Map<unknown, number>();
    cur.forEach((c, i) => { const k = this.keyOfY(c); if (k !== null && !at.has(k)) at.set(k, i); });
    const idx = want.map((v) => { const i = at.get(this.keyOfV(v)); return i === undefined || (cur[i] instanceof Y.XmlElement && (cur[i] as Y.XmlElement).nodeName !== v.nodeName) ? -1 : i; });
    const keep = lis(idx);
    const kept = new Set<number>(); idx.forEach((i, j) => { if (keep.has(j)) kept.add(i); });
    for (let i = cur.length - 1; i >= 0; i--) if (!kept.has(i)) y.delete(i, 1);
    let pos = 0;
    for (let j = 0; j < want.length; j++) {
      if (keep.has(j)) { const c = cur[idx[j]]; if (c instanceof Y.XmlElement) this.el(c, want[j]); pos++; continue; }
      const fresh = ydom.yFromDom(asX(want[j]), this.bind);
      if (fresh) { y.insert(pos, [fresh]); pos++; }
    }
  }

  /** The whole document (inside a transaction). */
  doc(ydoc: Y.Doc, d: JssDoc): void {
    const frag = ydoc.getXmlFragment(ROOT);
    const book = elems(frag).find((c) => c.nodeName === 'jssbook');
    if (!book) { if (frag.length) frag.delete(0, frag.length); const y = ydom.yFromDom(asX(bookV(d)), this.bind); if (y) frag.insert(0, [y]); return; }
    this.el(book, bookV(d));
  }

  /** One model node and what is inside it; false when it is not in the tree (the caller merges the whole document). */
  node(n: object, v: VNode): boolean {
    const y = this.maps.modelToY.get(n);
    if (!y || !live(y) || y.nodeName !== v.nodeName) return false;
    this.el(y, v);
    return true;
  }

  /** The title of a chapter, section, table or figure only (a heading typed into). */
  title(n: object, text: string): boolean {
    const y = this.maps.modelToY.get(n);
    if (!y || !live(y)) return false;
    const t = childNamed(y, 'title');
    if (!t) return false;
    ydom.reconcile(t, asX(titleV(text)));
    return true;
  }
}

/** The positions j of `a` (values >= 0) forming a longest strictly increasing run of values: the children that keep their place. */
function lis(a: number[]): Set<number> {
  const tails: number[] = []; const tailAt: number[] = []; const prev = new Array<number>(a.length).fill(-1);
  for (let j = 0; j < a.length; j++) {
    const v = a[j]; if (v < 0) continue;
    let lo = 0; let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    tails[lo] = v; tailAt[lo] = j; prev[j] = lo > 0 ? tailAt[lo - 1] : -1;
  }
  const out = new Set<number>();
  for (let j = tails.length ? tailAt[tails.length - 1] : -1; j >= 0; j = prev[j]) out.add(j);
  return out;
}

/** The model element that holds a Y node (the node itself or its nearest paired ancestor). */
export function ownerOf(maps: Maps, y: Y.AbstractType<unknown> | null): { y: Y.XmlElement; model: object } | null {
  for (let n: Y.AbstractType<unknown> | null = y; n; n = (n as unknown as { parent: Y.AbstractType<unknown> | null }).parent) {
    if (n instanceof Y.XmlElement) { const m = maps.yToModel.get(n); if (m) return { y: n, model: m }; }
  }
  return null;
}

/** The text nodes under an element, in order (the editor's characters, xref labels aside). */
export function textsIn(y: Y.XmlElement): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  const walk = (n: Y.XmlElement) => { for (const c of kids(n)) { if (c instanceof Y.XmlText) out.push(c); else walk(c); } };
  walk(y);
  return out;
}
export { childNamed };

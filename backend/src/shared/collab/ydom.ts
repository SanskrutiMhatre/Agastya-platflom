// =============================================================================
// The Y document schema of an XML document under live co-editing (Phase 3, P3-1) - ONE definition for the server (which loads a room
// from the project file and writes it back) and for every browser binding (the S1000D Studio today; JSS and JSG through the same
// contract, docs/phase3/COLLAB-CONTRACT.md).
//
//   ydoc.getXmlFragment('xml')   the document's top-level nodes in order: prolog comments and processing instructions, the root element
//   ydoc.getMap('meta')          xmlDecl (the XML declaration text, '' for none), doctype (JSON {rootName, publicId?, systemId?}, '' for
//                                no DOCTYPE), schema (SCHEMA_VERSION), epoch (the room's identity, see services/collab/rooms.ts)
//   ydoc.getArray('decls')       the DOCTYPE's internal-subset declarations, one raw string each (ICN entities, notations): an array, so
//                                two authors adding a figure each both keep their entity declaration
//
// One DOM node is one Y node, in the same order, so a child index in the DOM is the same index in Y (positions, selections and the
// relative positions of comments and cursors translate one to one):
//   element                      Y.XmlElement(nodeName), every attribute by its qualified name ("xlink:href", "xmlns:xlink")
//   text                         Y.XmlText (plain characters; no formatting attributes are used)
//   comment / PI / CDATA         Y.XmlElement('#comment' | '#pi' | '#cdata') with the content in attribute `data` (and `target` for a PI)
//
// Blocks (schema 2, Phase 8): Yjs 13.6 cannot move a node, so a moved element used to be a deletion and a new copy, and another person's
// typing inside it at that moment went into the deleted copy. An element of an element-only container (a paragraph, a section, a list
// item, a row, a plate...) is therefore held as a BLOCK, whose content never moves:
//   ydoc.getMap('blocks')        block id -> Y.XmlElement: the element itself (its real name, attributes and children)
//   ydoc.getMap('place')         block id -> the token of the one placeholder that puts the block in the tree now
//   Y.XmlElement('#ref', {id, tok})  the placeholder, where the element stands among its siblings (tok: new for every placement, so an
//                                undo that puts an old placeholder back puts its token back with it, and `place` follows by the same undo)
// A move deletes the old placeholder and inserts a new one for the same id (and points `place` at it): the content, and every edit made
// in it concurrently, stays where it is. Two people moving the same block at once leave two placeholders; `place` (last writer wins) says
// which one is live, so every screen and the server show it once, at the same place. A deleted block loses its entry (and those of the
// blocks inside it). Every reader goes through liveKids() / domFromY(), which put the block where its live placeholder is; a document with
// no placeholders (a room stored before schema 2) is read exactly as before, and its elements become blocks when they are next moved.
//
// Works on any W3C-style DOM through the structural types of xmlForm.ts (the browser's or @xmldom/xmldom's). No Node or browser
// dependency here.
// =============================================================================

import * as Y from 'yjs';
import type { Doctype, XNode, XElement } from './xmlForm';
import { parseDoctype } from './xmlForm';

export const ROOT = 'xml';
export const META = 'meta';
export const DECLS = 'decls';
export const BLOCKS = 'blocks';
export const PLACE = 'place';
export const REF = '#ref';
export const SCHEMA_VERSION = 2;
export const COMMENT = '#comment';
export const PI = '#pi';
export const CDATA = '#cdata';

export type YNode = Y.XmlElement | Y.XmlText;
export type YParent = Y.XmlElement | Y.XmlFragment;

/** What building a DOM from Y needs of the document object (the browser's Document and xmldom's both have it). */
export interface XFactory {
  createElementNS(ns: string | null, qualifiedName: string): XBuildElement;
  createTextNode(data: string): XNode;
  createComment(data: string): XNode;
  createProcessingInstruction(target: string, data: string): XNode;
  createCDATASection(data: string): XNode;
}
export interface XBuildElement extends XElement {
  setAttribute(name: string, value: string): void;
  setAttributeNS(ns: string | null, name: string, value: string): void;
  removeAttribute(name: string): void;
  removeAttributeNS(ns: string | null, localName: string): void;
  appendChild(child: XNode): XNode;
  insertBefore(child: XNode, ref: XNode | null): XNode;
}
export interface XBuildParent extends XNode {
  appendChild(child: XNode): XNode;
  insertBefore(child: XNode, ref: XNode | null): XNode;
}

export const KNOWN_NS: Record<string, string> = {
  xlink: 'http://www.w3.org/1999/xlink',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  dc: 'http://www.purl.org/dc/elements/1.1/',
  xml: 'http://www.w3.org/XML/1998/namespace',
};
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** The characters of a Y.XmlText (toString() would write formatting as tags; this binding never formats). */
export function textValue(t: Y.XmlText): string {
  let s = '';
  for (const d of t.toDelta() as Array<{ insert?: unknown }>) if (typeof d.insert === 'string') s += d.insert;
  return s;
}

/** The kind a node is paired by: '#text', '#comment', '#pi', '#cdata' or the element's name. */
export function kindOfY(y: unknown): string {
  if (y instanceof Y.XmlText) return '#text';
  if (y instanceof Y.XmlElement) return y.nodeName;
  return '#other';
}
export function kindOfDom(n: XNode): string {
  switch (n.nodeType) {
    case 1: return n.nodeName;
    case 3: return '#text';
    case 4: return CDATA;
    case 7: return PI;
    case 8: return COMMENT;
    default: return '#other';
  }
}

// ---------------------------------------------------------------- blocks (stable identity across moves)

type ItemLike = { deleted: boolean; parentSub: string | null; parent: unknown };
const itemOf = (t: unknown): ItemLike | null => ((t as { _item?: ItemLike | null })._item ?? null);
/** Is this Y type deleted? */
export const isDeleted = (t: unknown): boolean => { const it = itemOf(t); return !!it && it.deleted; };

export const isRef = (y: unknown): y is Y.XmlElement => y instanceof Y.XmlElement && y.nodeName === REF;

/** The live placeholder last seen for each block (filled by every read; checked before use, so a stale entry only costs a search). */
const seen = new WeakMap<Y.XmlElement, Y.XmlElement>();

/** The block a placeholder stands for, when the placeholder is the live one (null: a stale placeholder, or a block that was deleted). */
export function blockOf(ph: Y.XmlElement): Y.XmlElement | null {
  const doc = ph.doc;
  if (!doc || isDeleted(ph)) return null;
  const id = ph.getAttribute('id'); const tok = ph.getAttribute('tok');
  if (typeof id !== 'string' || typeof tok !== 'string' || doc.getMap(PLACE).get(id) !== tok) return null;
  const b = doc.getMap(BLOCKS).get(id);
  if (!(b instanceof Y.XmlElement) || isDeleted(b)) return null;
  seen.set(b, ph);
  return b;
}

/** The placeholder that puts block `id` in the tree now (null: none, the block is not shown). */
export function placeholderOf(ydoc: Y.Doc, id: string): Y.XmlElement | null {
  const b = ydoc.getMap(BLOCKS).get(id);
  if (!(b instanceof Y.XmlElement) || isDeleted(b)) return null;
  const c = seen.get(b);
  if (c && blockOf(c) === b) return c;
  // not read since it moved: look for it
  let hit: Y.XmlElement | null = null;
  const walk = (y: YParent): void => {
    for (const k of y.toArray()) {
      if (hit) return;
      if (isRef(k)) { if (k.getAttribute('id') === id && blockOf(k) === b) hit = k; continue; }
      if (k instanceof Y.XmlElement) walk(k);
    }
  };
  walk(ydoc.getXmlFragment(ROOT));
  if (!hit) ydoc.getMap(BLOCKS).forEach((x) => { if (!hit && x instanceof Y.XmlElement && !isDeleted(x)) walk(x); });
  return hit;
}

/** The tree parent of the placeholder last seen for block `id`, live or not (a placement changed: where the block was shown). */
export function lastPlacementParent(ydoc: Y.Doc, id: string): Y.XmlElement | Y.XmlFragment | null {
  const b = ydoc.getMap(BLOCKS).get(id);
  const c = b instanceof Y.XmlElement ? seen.get(b) : undefined;
  const p = c ? itemOf(c)?.parent : null;
  return (p instanceof Y.XmlElement || p instanceof Y.XmlFragment) && !isDeleted(p) ? p : null;
}

/** The id of a block element (null: an element held in the tree itself). */
export function blockId(y: unknown): string | null {
  if (!(y instanceof Y.XmlElement)) return null;
  const it = itemOf(y);
  const doc = y.doc;
  return it && doc && it.parent === doc.getMap(BLOCKS) && typeof it.parentSub === 'string' ? it.parentSub : null;
}
/** A live child of a tree node: the node (a block's element in place of its placeholder) and where it is in the raw Y children. */
export interface LiveKid { y: YNode; raw: number }

/** The children of a Y parent as the document has them: placeholders replaced by their blocks, stale placeholders left out. */
export function liveKids(y: YParent | Y.XmlText): LiveKid[] {
  if (y instanceof Y.XmlText) return [];
  const out: LiveKid[] = [];
  const raw = y.toArray();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (isRef(c)) { const b = blockOf(c); if (b) out.push({ y: b, raw: i }); continue; }
    if (c instanceof Y.XmlElement || c instanceof Y.XmlText) out.push({ y: c, raw: i });
  }
  return out;
}
/** The children of a Y parent as the document has them (see liveKids). */
export const ychildren = (y: YParent | Y.XmlText): YNode[] => liveKids(y).map((k) => k.y);

/** The parent of a Y node in the document's tree (a block's: where its live placeholder is). Null: the root, or not in the tree. */
export function treeParent(y: unknown): YParent | null {
  const it = itemOf(y);
  if (!it) return null;
  const p = it.parent;
  const id = blockId(y);
  if (id !== null) {
    const doc = (y as Y.XmlElement).doc;
    const ph = doc ? placeholderOf(doc, id) : null;
    return ph ? treeParent(ph) : null;
  }
  return p instanceof Y.XmlElement || p instanceof Y.XmlFragment ? p : null;
}

/** The raw Y index (in toArray()) that a live child index of `y` stands at, for a relative position (the end: y.length). */
export function rawIndex(y: YParent, live: number): number {
  const ks = liveKids(y);
  return live < ks.length ? ks[live].raw : y.length;
}
/** The live child index a raw Y index of `y` stands at. */
export function liveIndex(y: YParent, raw: number): number {
  let n = 0;
  for (const k of liveKids(y)) { if (k.raw >= raw) break; n++; }
  return n;
}
/** The live node at a raw Y index of `y` (a placeholder there: its block). */
export function liveAt(y: YParent, raw: number): YNode | null {
  const c = y.toArray()[raw];
  if (isRef(c)) return blockOf(c);
  return c instanceof Y.XmlElement || c instanceof Y.XmlText ? c : null;
}

/**
 * Everything that creates, moves or removes tree children within one transaction goes through one Blocks: it makes new elements of
 * element-only containers into blocks, re-places a moved block, and at commit() points `place` at the new placeholders and drops the blocks
 * whose placeholder went and did not come back elsewhere (a deletion, not a move).
 */
export class Blocks {
  readonly blocks: Y.Map<unknown>;
  readonly place: Y.Map<unknown>;
  private pending: Array<[Y.XmlElement, string, string]> = [];
  private removed = new Set<string>();
  private static seq = 0;

  constructor(readonly ydoc: Y.Doc) {
    this.blocks = ydoc.getMap(BLOCKS);
    this.place = ydoc.getMap(PLACE);
  }

  private newId(): string {
    Blocks.seq = (Blocks.seq + 1) % 0x7fffffff;
    return `${this.ydoc.clientID.toString(36)}.${Blocks.seq.toString(36)}.${Math.floor(Math.random() * 0x7fffffff).toString(36)}`;
  }

  /** A placeholder for block `id` with a new token (to insert; `place` points at it at commit). */
  private placeholder(id: string): Y.XmlElement {
    const tok = this.newId();
    const ph = new Y.XmlElement(REF);
    ph.setAttribute('id', id);
    ph.setAttribute('tok', tok);
    this.pending.push([ph, id, tok]);
    return ph;
  }

  /** Is `n` (a child of `parent`) held as a block? An element whose container holds no character data. */
  static isBlock(n: XNode, parent: XNode | null): boolean {
    if (n.nodeType !== 1 || !parent || parent.nodeType !== 1) return false;
    for (const c of Array.from(parent.childNodes)) if ((c.nodeType === 3 || c.nodeType === 4) && /\S/.test(c.nodeValue ?? '')) return false;
    return true;
  }

  /** A placeholder (to insert) for the block `el`, which gets a new id. */
  private wrap(el: Y.XmlElement): Y.XmlElement {
    const id = this.newId();
    this.blocks.set(id, el);
    return this.placeholder(id);
  }

  /** A placeholder (to insert) that moves the existing block `block` there. */
  replace(block: Y.XmlElement): Y.XmlElement | null {
    const id = blockId(block);
    if (id === null || isDeleted(block)) return null;
    this.removed.delete(id);
    return this.placeholder(id);
  }

  /**
   * A new (not yet integrated) Y node holding a copy of `n` and everything inside it, its block elements as blocks. `parent` is the DOM
   * node `n` is (or will be) a child of. `bind` is told every pair made (a block: its element, not the placeholder). `reuse(d)` may name
   * an existing block for a DOM node (a moved element): it is re-placed instead of copied (the caller then brings its content up to date).
   */
  make(n: XNode, parent: XNode | null, bind?: (d: XNode, y: YNode) => void, reuse?: (d: XNode) => Y.XmlElement | null): YNode | null {
    if (reuse && n.nodeType === 1) {
      const b = reuse(n);
      if (b) { const ph = this.replace(b); if (ph) return ph; }
    }
    const y = yFromDom(n, bind, (c, p) => this.make(c, p, bind, reuse));
    if (!y) return null;
    return y instanceof Y.XmlElement && Blocks.isBlock(n, parent) ? this.wrap(y) : y;
  }

  /** Delete the raw children [index, index+length) of `y`, noting the blocks whose placeholders go. */
  del(y: YParent, index: number, length: number): void {
    if (length <= 0) return;
    const raw = y.toArray().slice(index, index + length);
    for (const c of raw) this.noteRemoved(c);
    y.delete(index, length);
  }

  /** The placeholders inside `c` (and `c` itself) are going: their blocks are dropped at commit unless re-placed. */
  private noteRemoved(c: unknown): void {
    if (isRef(c)) {
      const b = blockOf(c);
      const id = c.getAttribute('id');
      if (b && typeof id === 'string') { this.removed.add(id); this.noteRemoved(b); }
      return;
    }
    if (c instanceof Y.XmlElement) for (const k of c.toArray()) this.noteRemoved(k);
  }

  /** Point `place` at the placeholders made, drop the blocks that went (with the blocks inside them). Call once, before the transaction ends. */
  commit(): void {
    for (const [ph, id, tok] of this.pending) {
      const it = itemOf(ph);
      if (it && !it.deleted && ph.doc === this.ydoc) { if (this.place.get(id) !== tok) this.place.set(id, tok); this.removed.delete(id); }
      else if (!placeholderOf(this.ydoc, id)) this.removed.add(id);       // made but never inserted
    }
    this.pending = [];
    for (const id of this.removed) {
      if (placeholderOf(this.ydoc, id)) continue;                          // it is still (or again) in the tree: a move
      if (this.blocks.has(id)) this.blocks.delete(id);
      if (this.place.has(id)) this.place.delete(id);
    }
    this.removed.clear();
  }
}

/**
 * Make the children of `y` the sequence `seq`: an entry `{ keep }` is a live child of `y` that stays (the kept ones in their order), an
 * entry `{ add }` a new Y node (from Blocks.make / replace) inserted there. Every other child is deleted. Call inside a transaction.
 */
export function setChildren(y: YParent, seq: Array<{ keep: YNode } | { add: YNode }>, blocks: Blocks): void {
  const kids = liveKids(y);
  const rawOfLive = new Map<YNode, number>(); for (const k of kids) rawOfLive.set(k.y, k.raw);
  const keptRaw = new Set<number>();
  for (const s of seq) if ('keep' in s) { const r = rawOfLive.get(s.keep); if (r !== undefined) keptRaw.add(r); }
  // delete what is not kept (stale placeholders and other raw children included), in runs from the end
  const total = y.length;
  for (let i = total - 1; i >= 0;) {
    if (keptRaw.has(i)) { i--; continue; }
    let j = i; while (j - 1 >= 0 && !keptRaw.has(j - 1)) j--;
    blocks.del(y, j, i - j + 1);
    i = j - 1;
  }
  // the kept children are now at 0..k-1 in their order; insert the new ones between them
  let at = 0; let run: YNode[] = []; let runAt = 0;
  const flush = (): void => { if (run.length) { y.insert(runAt, run); at = runAt + run.length; run = []; } };
  for (const s of seq) {
    if ('keep' in s) {
      if (!rawOfLive.has(s.keep)) continue;
      flush(); at++; continue;
    }
    if (!run.length) runAt = at;
    run.push(s.add);
  }
  flush();
}

/** Observe every change of a document's tree (the fragment, the blocks and the placements): `cb` once per transaction, with all its events. */
export function observeTree(ydoc: Y.Doc, cb: (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction) => void): () => void {
  const frag = ydoc.getXmlFragment(ROOT);
  const blocks = ydoc.getMap(BLOCKS);
  const place = ydoc.getMap(PLACE);
  let pending: { tr: Y.Transaction; events: Array<Y.YEvent<Y.AbstractType<unknown>>> } | null = null;
  const take = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction): void => {
    if (!pending || pending.tr !== tr) pending = { tr, events: [] };
    pending.events.push(...events);
  };
  const deep = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, tr: Y.Transaction): void => take(events, tr);
  const flat = (ev: Y.YEvent<Y.AbstractType<unknown>>, tr: Y.Transaction): void => take([ev], tr);
  const after = (tr: Y.Transaction): void => {
    if (!pending || pending.tr !== tr) return;
    const p = pending; pending = null;
    cb(p.events, p.tr);
  };
  const flatMap = flat as unknown as (ev: Y.YMapEvent<unknown>, tr: Y.Transaction) => void;
  frag.observeDeep(deep);
  blocks.observeDeep(deep);
  place.observe(flatMap);
  ydoc.on('afterTransaction', after);
  return () => {
    frag.unobserveDeep(deep); blocks.unobserveDeep(deep); place.unobserve(flatMap);
    ydoc.off('afterTransaction', after);
  };
}

type UndoScope = ConstructorParameters<typeof Y.UndoManager>[0];
/** The types a person's undo covers (the tree, its blocks and placements, and the given extras). */
export function undoScope(ydoc: Y.Doc, ...extra: Array<Y.Map<unknown> | Y.Array<unknown>>): UndoScope {
  return [ydoc.getXmlFragment(ROOT), ydoc.getMap(BLOCKS), ydoc.getMap(PLACE), ...extra] as unknown as UndoScope;
}

/** The children of a DOM node that have a Y counterpart (a DOCTYPE node and xmldom's XML-declaration node do not). */
export function domChildren(n: XNode): XNode[] {
  const out: XNode[] = [];
  // text directly under the document (whitespace of the prolog in some parsers) is not a node a browser keeps
  for (const c of Array.from(n.childNodes)) if (mapped(c) && !(n.nodeType === 9 && c.nodeType === 3)) out.push(c);
  return out;
}
export const mapped = (c: XNode): boolean =>
  c.nodeType === 1 || c.nodeType === 3 || c.nodeType === 4 || c.nodeType === 8 || (c.nodeType === 7 && c.nodeName.toLowerCase() !== 'xml');

const piOf = (n: XNode): { target: string; data: string } => n as unknown as { target: string; data: string };

/**
 * A new (not yet integrated) Y node holding a copy of `n` and everything inside it. `bind` is told every pair made. `child` makes the
 * children (Blocks.make: element children of element-only containers as blocks); without it they are plain copies (schema 1).
 */
export function yFromDom(n: XNode, bind?: (d: XNode, y: YNode) => void, child?: (c: XNode, parent: XNode) => YNode | null): YNode | null {
  let y: YNode | null = null;
  switch (n.nodeType) {
    case 1: {
      const el = new Y.XmlElement(n.nodeName);
      for (const a of Array.from((n as XElement).attributes)) el.setAttribute(a.name, a.value);
      const kids: YNode[] = [];
      for (const c of Array.from(n.childNodes)) { const k = child ? child(c, n) : yFromDom(c, bind); if (k) kids.push(k); }
      if (kids.length) el.insert(0, kids);
      y = el;
      break;
    }
    case 3: y = new Y.XmlText(n.nodeValue ?? ''); break;
    case 4: { const el = new Y.XmlElement(CDATA); el.setAttribute('data', n.nodeValue ?? ''); y = el; break; }
    case 8: { const el = new Y.XmlElement(COMMENT); el.setAttribute('data', n.nodeValue ?? ''); y = el; break; }
    case 7: {
      if (n.nodeName.toLowerCase() === 'xml') return null;
      const el = new Y.XmlElement(PI); el.setAttribute('target', piOf(n).target); el.setAttribute('data', piOf(n).data ?? ''); y = el; break;
    }
    default: return null;
  }
  if (bind) bind(n, y);
  return y;
}

/** Namespace lookup by prefix ('' = the default namespace), along the element being built and its ancestors. */
export type NsLookup = (prefix: string) => string | null;
export const rootLookup: NsLookup = (p) => (p ? KNOWN_NS[p] ?? null : null);

function attrNs(name: string, lookup: NsLookup): string | null {
  if (name === 'xmlns' || name.startsWith('xmlns:')) return XMLNS_NS;
  const i = name.indexOf(':');
  return i > 0 ? lookup(name.slice(0, i)) : null;
}

/** Set (or, with value undefined, remove) one attribute of a DOM element the way a parser would have created it. */
export function setDomAttr(el: XBuildElement, name: string, value: string | undefined, lookup: NsLookup): void {
  const ns = attrNs(name, lookup);
  if (value === undefined) {
    if (ns) el.removeAttributeNS(ns, name.includes(':') ? name.slice(name.indexOf(':') + 1) : name);
    else el.removeAttribute(name);
    return;
  }
  if (ns) el.setAttributeNS(ns, name, value);
  else el.setAttribute(name, value);
}

function childLookup(attrs: Record<string, string>, parent: NsLookup): NsLookup {
  const own: Record<string, string> = {};
  let any = false;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'xmlns') { own[''] = v; any = true; } else if (k.startsWith('xmlns:')) { own[k.slice(6)] = v; any = true; }
  }
  return any ? (p) => (p in own ? own[p] : parent(p)) : parent;
}

/** A lookup for an element already in a DOM: its own and its ancestors' xmlns attributes, then the well-known prefixes. */
export function lookupFor(el: XNode | null): NsLookup {
  return (prefix) => {
    for (let n: XNode | null = el; n && n.nodeType === 1; n = n.parentNode) {
      const v = (n as XElement).getAttribute(prefix ? `xmlns:${prefix}` : 'xmlns');
      if (v !== null && v !== undefined) return v;
    }
    return prefix ? KNOWN_NS[prefix] ?? null : null;
  };
}

/** A DOM copy of a Y node and everything inside it. `bind` is told every pair made. */
export function domFromY(y: YNode, f: XFactory, lookup: NsLookup, bind?: (d: XNode, y: YNode) => void): XNode | null {
  let d: XNode | null = null;
  if (y instanceof Y.XmlText) d = f.createTextNode(textValue(y));
  else if (y instanceof Y.XmlElement) {
    const attrs = y.getAttributes() as Record<string, string>;
    switch (y.nodeName) {
      case COMMENT: d = f.createComment(String(attrs.data ?? '')); break;
      case CDATA: d = f.createCDATASection(String(attrs.data ?? '')); break;
      case PI: d = f.createProcessingInstruction(String(attrs.target ?? 'pi'), String(attrs.data ?? '')); break;
      default: {
        const look = childLookup(attrs, lookup);
        const name = y.nodeName;
        const i = name.indexOf(':');
        const el = f.createElementNS(i > 0 ? look(name.slice(0, i)) : look(''), name);
        for (const [k, v] of Object.entries(attrs)) if (typeof v === 'string') setDomAttr(el, k, v, look);
        for (const c of ychildren(y)) {
          const k = domFromY(c, f, look, bind);
          if (k) el.appendChild(k);
        }
        d = el;
      }
    }
  }
  if (d && bind) bind(d, y);
  return d;
}

// ---------------------------------------------------------------- the DOCTYPE and the declaration in Y

/** The DOCTYPE the Y document describes (null: none). */
export function readDoctype(ydoc: Y.Doc): Doctype | null {
  const head = ydoc.getMap(META).get('doctype');
  if (typeof head !== 'string' || !head) return null;
  let h: { rootName?: string; publicId?: string; systemId?: string };
  try { h = JSON.parse(head); } catch { return null; }
  const decls = ydoc.getArray<string>(DECLS).toArray().filter((s) => typeof s === 'string');
  // the declarations are kept as their raw text; parseDoctype classifies them exactly as it did when the file was read
  const parsed = decls.length ? parseDoctype(`<!DOCTYPE ${h.rootName ?? 'dmodule'} [\n${decls.join('\n')}\n]>`).decls : [];
  const dt: Doctype = { rootName: h.rootName ?? 'dmodule', decls: parsed };
  if (h.publicId !== undefined) dt.publicId = h.publicId;
  if (h.systemId !== undefined) dt.systemId = h.systemId;
  return dt;
}

/** Make the Y document describe `dt` with the fewest changes (a declaration added by one author survives another's addition). */
export function writeDoctype(ydoc: Y.Doc, dt: Doctype | null): void {
  const meta = ydoc.getMap(META);
  const head = dt ? JSON.stringify({ rootName: dt.rootName, ...(dt.publicId !== undefined ? { publicId: dt.publicId } : {}), ...(dt.systemId !== undefined ? { systemId: dt.systemId } : {}) }) : '';
  if (meta.get('doctype') !== head) meta.set('doctype', head);
  const arr = ydoc.getArray<string>(DECLS);
  const cur = arr.toArray();
  const next = dt ? dt.decls.map((d) => d.raw) : [];
  let p = 0; while (p < cur.length && p < next.length && cur[p] === next[p]) p++;
  let s = 0; while (s < cur.length - p && s < next.length - p && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s++;
  if (cur.length - p - s > 0) arr.delete(p, cur.length - p - s);
  if (next.length - p - s > 0) arr.insert(p, next.slice(p, next.length - s));
}

export function readXmlDecl(ydoc: Y.Doc): string | null {
  const v = ydoc.getMap(META).get('xmlDecl');
  return typeof v === 'string' && v ? v : null;
}
export function writeXmlDecl(ydoc: Y.Doc, decl: string | null): void {
  const meta = ydoc.getMap(META);
  if (meta.get('xmlDecl') !== (decl ?? '')) meta.set('xmlDecl', decl ?? '');
}

// ---------------------------------------------------------------- whole documents

export interface ParsedLike { doc: XNode; doctype: Doctype | null; xmlDecl: string | null }

/** Fill an empty Y document from a parsed document (whitespace already normalised by the caller). */
export function loadInto(ydoc: Y.Doc, parsed: ParsedLike, origin?: unknown): void {
  ydoc.transact(() => {
    const frag = ydoc.getXmlFragment(ROOT);
    const blocks = new Blocks(ydoc);
    blocks.del(frag, 0, frag.length);
    const kids: YNode[] = [];
    for (const c of domChildren(parsed.doc)) { const y = blocks.make(c, parsed.doc); if (y) kids.push(y); }
    if (kids.length) frag.insert(0, kids);
    blocks.commit();
    writeXmlDecl(ydoc, parsed.xmlDecl);
    writeDoctype(ydoc, parsed.doctype);
    ydoc.getMap(META).set('schema', SCHEMA_VERSION);
  }, origin);
}

/** Build the document the Y document describes into an empty DOM document `target` (the caller then serialises it). */
export function buildInto(ydoc: Y.Doc, target: XBuildParent & XFactory, bind?: (d: XNode, y: YNode) => void): { doctype: Doctype | null; xmlDecl: string | null } {
  const frag = ydoc.getXmlFragment(ROOT);
  for (const c of ychildren(frag)) {
    if (c instanceof Y.XmlText && !/\S/.test(textValue(c))) continue;      // whitespace between top-level nodes is not content
    const d = domFromY(c, target, rootLookup, bind);
    if (d) target.appendChild(d);
  }
  return { doctype: readDoctype(ydoc), xmlDecl: readXmlDecl(ydoc) };
}

// ---------------------------------------------------------------- minimal-change reconciliation (DOM -> Y)

/** Replace the characters of `t` by `next` with one delete and one insert around the common prefix and suffix. */
export function diffText(t: Y.XmlText, next: string): boolean {
  const cur = textValue(t);
  if (cur === next) return false;
  let p = 0; const max = Math.min(cur.length, next.length);
  while (p < max && cur.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  while (s < cur.length - p && s < next.length - p && cur.charCodeAt(cur.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  // never split a surrogate pair
  if (p > 0 && isHigh(cur.charCodeAt(p - 1))) p--;
  if (s > 0 && isLow(cur.charCodeAt(cur.length - s))) s--;
  if (cur.length - p - s > 0) t.delete(p, cur.length - p - s);
  if (next.length - p - s > 0) t.insert(p, next.slice(p, next.length - s));
  return true;
}
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** Make the attributes of `y` those of `d` (a comment / PI / CDATA: its content). Returns whether anything changed. */
export function syncAttributes(y: Y.XmlElement, d: XNode): boolean {
  let changed = false;
  const want: Record<string, string> = {};
  if (d.nodeType === 1) for (const a of Array.from((d as XElement).attributes)) want[a.name] = a.value;
  else if (d.nodeType === 7) { want.target = piOf(d).target; want.data = piOf(d).data ?? ''; } else want.data = d.nodeValue ?? '';
  const have = y.getAttributes() as Record<string, string>;
  for (const k of Object.keys(have)) if (!(k in want)) { y.removeAttribute(k); changed = true; }
  for (const [k, v] of Object.entries(want)) if (have[k] !== v) { y.setAttribute(k, v); changed = true; }
  return changed;
}

/**
 * Make the children of the Y node `y` equal to those of the DOM node `d`, changing as little as possible: nodes of the same kind at the
 * start and at the end are paired and reconciled in place (text by its common prefix and suffix), a middle run of the same kinds and
 * length is paired position by position, anything else in the middle is replaced. Used by the server to bring a live room to a changed
 * file (an import, a restore, a git pull) without clobbering the people in it, and by a binding to pair its DOM with the room at open.
 * `bind` is told every DOM/Y pair (kept or new). Call inside a transaction.
 */
export function reconcile(y: YParent, d: XNode, bind?: (d: XNode, y: YNode) => void, blocks?: Blocks): void {
  const b = blocks ?? new Blocks(y.doc as Y.Doc);
  reconcileWith(y, d, b, bind);
  if (!blocks) b.commit();
}

function reconcileWith(y: YParent, d: XNode, blocks: Blocks, bind?: (d: XNode, y: YNode) => void): void {
  if (y instanceof Y.XmlElement && d.nodeType === 1) syncAttributes(y, d);
  const ck = ychildren(y);
  const nk = domChildren(d);
  const same = (a: YNode, b: XNode) => kindOfY(a) === kindOfDom(b);
  let s = 0;
  while (s < ck.length && s < nk.length && same(ck[s], nk[s])) s++;
  let e = 0;
  while (e < ck.length - s && e < nk.length - s && same(ck[ck.length - 1 - e], nk[nk.length - 1 - e])) e++;
  const pairs: Array<[YNode, XNode]> = [];
  const seq: Array<{ keep: YNode } | { add: YNode }> = [];
  for (let i = 0; i < s; i++) { pairs.push([ck[i], nk[i]]); seq.push({ keep: ck[i] }); }
  const midCur = ck.slice(s, ck.length - e);
  const midNext = nk.slice(s, nk.length - e);
  let changed = y.length !== ck.length;                 // stale placeholders (two moves of one block at once) go as well
  if (midCur.length === midNext.length && midCur.every((n, i) => same(n, midNext[i]))) {
    midCur.forEach((n, i) => { pairs.push([n, midNext[i]]); seq.push({ keep: n }); });
  } else {
    changed = true;
    for (const n of midNext) { const k = blocks.make(n, d, bind); if (k) seq.push({ add: k }); }
  }
  for (let i = ck.length - e; i < ck.length; i++) { pairs.push([ck[i], nk[nk.length - (ck.length - i)]]); seq.push({ keep: ck[i] }); }
  if (changed) setChildren(y, seq, blocks);
  for (const [a, b] of pairs) {
    if (a instanceof Y.XmlText) diffText(a, b.nodeValue ?? '');
    else if (b.nodeType === 1) reconcileWith(a, b, blocks, bind);
    else syncAttributes(a, b);
    if (bind) bind(b, a);
  }
}

/** Bring a whole Y document to a parsed document with the fewest changes (see reconcile). */
export function reconcileDocument(ydoc: Y.Doc, parsed: ParsedLike, origin?: unknown, bind?: (d: XNode, y: YNode) => void): void {
  ydoc.transact(() => {
    reconcile(ydoc.getXmlFragment(ROOT), parsed.doc, bind);
    writeXmlDecl(ydoc, parsed.xmlDecl);
    writeDoctype(ydoc, parsed.doctype);
    if (ydoc.getMap(META).get('schema') !== SCHEMA_VERSION) ydoc.getMap(META).set('schema', SCHEMA_VERSION);
  }, origin);
}

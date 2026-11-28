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
// Works on any W3C-style DOM through the structural types of xmlForm.ts (the browser's or @xmldom/xmldom's). No Node or browser
// dependency here.
// =============================================================================

import * as Y from 'yjs';
import type { Doctype, XNode, XElement } from './xmlForm';
import { parseDoctype } from './xmlForm';

export const ROOT = 'xml';
export const META = 'meta';
export const DECLS = 'decls';
export const SCHEMA_VERSION = 1;
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

/** A new (not yet integrated) Y node holding a copy of `n` and everything inside it. `bind` is told every pair made. */
export function yFromDom(n: XNode, bind?: (d: XNode, y: YNode) => void): YNode | null {
  let y: YNode | null = null;
  switch (n.nodeType) {
    case 1: {
      const el = new Y.XmlElement(n.nodeName);
      for (const a of Array.from((n as XElement).attributes)) el.setAttribute(a.name, a.value);
      const kids: YNode[] = [];
      for (const c of Array.from(n.childNodes)) { const k = yFromDom(c, bind); if (k) kids.push(k); }
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
        for (const c of y.toArray()) {
          if (!(c instanceof Y.XmlElement || c instanceof Y.XmlText)) continue;
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
    if (frag.length) frag.delete(0, frag.length);
    const kids: YNode[] = [];
    for (const c of domChildren(parsed.doc)) { const y = yFromDom(c); if (y) kids.push(y); }
    if (kids.length) frag.insert(0, kids);
    writeXmlDecl(ydoc, parsed.xmlDecl);
    writeDoctype(ydoc, parsed.doctype);
    ydoc.getMap(META).set('schema', SCHEMA_VERSION);
  }, origin);
}

/** Build the document the Y document describes into an empty DOM document `target` (the caller then serialises it). */
export function buildInto(ydoc: Y.Doc, target: XBuildParent & XFactory, bind?: (d: XNode, y: YNode) => void): { doctype: Doctype | null; xmlDecl: string | null } {
  const frag = ydoc.getXmlFragment(ROOT);
  for (const c of frag.toArray()) {
    if (!(c instanceof Y.XmlElement || c instanceof Y.XmlText)) continue;
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
export function reconcile(y: YParent, d: XNode, bind?: (d: XNode, y: YNode) => void): void {
  if (y instanceof Y.XmlElement && d.nodeType === 1) syncAttributes(y, d);
  const ck = y.toArray().filter((c): c is YNode => c instanceof Y.XmlElement || c instanceof Y.XmlText);
  const nk = domChildren(d);
  const same = (a: YNode, b: XNode) => kindOfY(a) === kindOfDom(b);
  let s = 0;
  while (s < ck.length && s < nk.length && same(ck[s], nk[s])) s++;
  let e = 0;
  while (e < ck.length - s && e < nk.length - s && same(ck[ck.length - 1 - e], nk[nk.length - 1 - e])) e++;
  const pairs: Array<[YNode, XNode]> = [];
  for (let i = 0; i < s; i++) pairs.push([ck[i], nk[i]]);
  for (let i = 0; i < e; i++) pairs.push([ck[ck.length - 1 - i], nk[nk.length - 1 - i]]);
  const midCur = ck.slice(s, ck.length - e);
  const midNext = nk.slice(s, nk.length - e);
  if (midCur.length === midNext.length && midCur.every((n, i) => same(n, midNext[i]))) {
    midCur.forEach((n, i) => pairs.push([n, midNext[i]]));
  } else {
    if (midCur.length) y.delete(s, midCur.length);
    const fresh: YNode[] = [];
    for (const n of midNext) { const k = yFromDom(n, bind); if (k) fresh.push(k); }
    if (fresh.length) y.insert(s, fresh);
  }
  for (const [a, b] of pairs) {
    if (a instanceof Y.XmlText) diffText(a, b.nodeValue ?? '');
    else if (b.nodeType === 1) reconcile(a, b, bind);
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

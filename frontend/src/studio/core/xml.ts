/**
 * XML I/O: parsing (with DOCTYPE internal-subset preservation), whitespace
 * normalisation for editing, and a deterministic pretty-printer that records
 * source offsets for every node (used to synchronise Design and XML views).
 */
import type { Grammar } from './grammar';
import * as form from '../../../../backend/src/shared/collab/xmlForm';
import type { Doctype, DoctypeDecl } from '../../../../backend/src/shared/collab/xmlForm';
import { findDoctype, parseDoctype } from '../../../../backend/src/shared/collab/xmlForm';

export const NS = {
  xlink: 'http://www.w3.org/1999/xlink',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  dc: 'http://www.purl.org/dc/elements/1.1/',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
} as const;

export interface ParseError {
  message: string;
  line: number;
  column: number;
}

// ------------------------------------------------------------------ doctype
// Phase 3 (collaboration): the DOCTYPE reader and writer, the whitespace normaliser and the serializer are shared with the collaboration
// server, which writes a live document back to its file in exactly the Studio's form (backend/src/shared/collab/xmlForm.ts, moved verbatim).
export type { Doctype, DoctypeDecl } from '../../../../backend/src/shared/collab/xmlForm';
export { findDoctype, parseDoctype, exactText, exactAttr } from '../../../../backend/src/shared/collab/xmlForm';

/**
 * Names of the internal general entities (`<!ENTITY name "text">`) that the document body uses as `&name;`. A parser expands
 * them, so the editor holds (and saves) their text instead of the references: the author deserves to be told.
 */
export function internalEntityRefs(text: string, doctype: Doctype | null): string[] {
  if (!doctype) return [];
  const names = doctype.decls.filter((d) => d.kind === 'entity' && d.name && !d.systemId && !d.publicId && !d.notation).map((d) => d.name!);
  if (!names.length) return [];
  const loc = findDoctype(text);
  const body = loc ? text.slice(loc.end) : text;
  return names.filter((n) => body.includes('&' + n + ';'));
}

/** Well-known S1000D graphic notations. */
export const NOTATIONS: Record<string, string> = {
  cgm: '<!NOTATION cgm PUBLIC "-//USA-DOD//NOTATION Computer Graphics Metafile//EN">',
  png: '<!NOTATION png PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN">',
  jpeg: '<!NOTATION jpeg PUBLIC "+//ISBN 0-7923-9432-1::Graphic Notation//NOTATION Joint Photographic Experts Group Raster//EN">',
  jpg: '<!NOTATION jpg PUBLIC "+//ISBN 0-7923-9432-1::Graphic Notation//NOTATION Joint Photographic Experts Group Raster//EN">',
  gif: '<!NOTATION gif PUBLIC "-//CompuServe//NOTATION Graphics Interchange Format 89a//EN">',
  svg: '<!NOTATION svg PUBLIC "-//W3C//NOTATION Scalable Vector Graphics//EN">',
  tiff: '<!NOTATION tiff PUBLIC "-//Aldus//NOTATION Tagged Image File Format//EN">',
  tif: '<!NOTATION tif PUBLIC "-//Aldus//NOTATION Tagged Image File Format//EN">',
  pdf: '<!NOTATION pdf PUBLIC "-//Adobe//NOTATION Portable Document Format//EN">',
  mp4: '<!NOTATION mp4 SYSTEM "video/mp4">',
  swf: '<!NOTATION swf PUBLIC "-//S1000D//NOTATION X-SHOCKWAVE-FLASH 3D Models Encoding//EN">',
};

/** An XML name as used for entity and notation names (the ASCII subset covers every ICN). */
export const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

export function withEntity(dt: Doctype | null, rootName: string, name: string, systemId: string, notation: string): Doctype {
  // These end up unquoted-ish in the DOCTYPE: a name or file name with markup characters would corrupt the whole document.
  if (!XML_NAME.test(name)) throw new Error(`"${name}" is not a valid entity name (an ICN is an XML name such as ICN-…)`);
  if (!XML_NAME.test(notation)) throw new Error(`"${notation}" is not a valid notation name`);
  systemId = systemId.replace(/["<>&\u0000-\u001F]/g, '_');
  const out: Doctype = dt ? { ...dt, decls: [...dt.decls] } : { rootName, decls: [] };
  if (!out.decls.some((d) => d.kind === 'notation' && d.name === notation)) {
    const raw = NOTATIONS[notation] ?? `<!NOTATION ${notation} SYSTEM "${notation}">`;
    out.decls.push({ kind: 'notation', name: notation, raw });
  }
  const idx = out.decls.findIndex((d) => d.kind === 'entity' && d.name === name);
  const decl: DoctypeDecl = { kind: 'entity', name, systemId, notation, raw: `<!ENTITY ${name} SYSTEM "${systemId}" NDATA ${notation}>` };
  if (idx >= 0) out.decls[idx] = decl;
  else {
    // keep entities before notations, as conventional in S1000D samples
    const firstNotation = out.decls.findIndex((d) => d.kind === 'notation');
    if (firstNotation >= 0) out.decls.splice(firstNotation, 0, decl);
    else out.decls.push(decl);
  }
  return out;
}

// ------------------------------------------------------------------ parsing
export interface ParsedXml {
  doc: XMLDocument;
  doctype: Doctype | null;
  xmlDecl: string | null;
}

export class XmlParseError extends Error {
  constructor(public readonly errors: ParseError[]) {
    super(errors[0]?.message ?? 'XML is not well-formed');
  }
}

function extractParserError(doc: Document): ParseError | null {
  const pe = doc.getElementsByTagName('parsererror')[0] ?? doc.getElementsByTagNameNS('*', 'parsererror')[0];
  if (!pe) return null;
  const text = (pe.textContent || '').replace(/\s+/g, ' ').trim();
  let line = 1;
  let column = 1;
  const m = text.match(/line (\d+) at column (\d+)/i) || text.match(/(\d+):(\d+)/);
  if (m) {
    line = parseInt(m[1], 10);
    column = parseInt(m[2], 10);
  }
  let message = text
    .replace(/^This page contains the following errors:\s*/i, '')
    .replace(/Below is a rendering of the page up to the first error\.?/i, '')
    .replace(/^error on line \d+ at column \d+:\s*/i, '')
    .trim();
  if (!message) message = 'XML is not well-formed';
  return { message, line, column };
}

/** Additional well-formedness diagnostics the browser parser may only report vaguely. */
export function quickWellFormedCheck(text: string): ParseError | null {
  if (!text.trim()) return { message: 'Document is empty', line: 1, column: 1 };
  return null;
}

export function parseXml(text: string): ParsedXml {
  const quick = quickWellFormedCheck(text);
  if (quick) throw new XmlParseError([quick]);
  const declMatch = text.match(/^﻿?\s*(<\?xml\s[^?]*\?>)/);
  const dtLoc = findDoctype(text);
  const doc = new DOMParser().parseFromString(text, 'application/xml') as XMLDocument;
  const err = extractParserError(doc);
  if (err) throw new XmlParseError([err]);
  // Remove DocumentType node: the doctype is managed separately (browsers drop internal subsets).
  for (const n of Array.from(doc.childNodes)) if (n.nodeType === 10) doc.removeChild(n);
  // The text is always written back as UTF-8, so a declaration of another encoding would make the saved file unreadable.
  const xmlDecl = declMatch ? declMatch[1].replace(/encoding\s*=\s*(["'])(?!utf-8\1)[^"']*\1/i, 'encoding="UTF-8"') : null;
  return { doc, doctype: dtLoc ? parseDoctype(dtLoc.raw) : null, xmlDecl };
}

/**
 * Decodes the bytes of an XML file by its byte-order mark or, without one, by the encoding its XML declaration names (UTF-8 when
 * there is none or the label is unknown). Reading everything as UTF-8 would turn ISO-8859-1 or UTF-16 files into garbage.
 */
export function decodeXmlBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  const decode = (label: string) => {
    try {
      return new TextDecoder(label).decode(b);
    } catch {
      return new TextDecoder('utf-8').decode(b);
    }
  };
  if (b[0] === 0xff && b[1] === 0xfe) return decode('utf-16le');
  if (b[0] === 0xfe && b[1] === 0xff) return decode('utf-16be');
  if (b[0] === 0x3c && b[1] === 0x00) return decode('utf-16le');
  if (b[0] === 0x00 && b[1] === 0x3c) return decode('utf-16be');
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return decode('utf-8');
  const head = new TextDecoder('latin1').decode(b.subarray(0, 200));
  const m = head.match(/^\s*<\?xml\s[^?]*?encoding\s*=\s*(["'])([A-Za-z0-9._-]+)\1/);
  return decode(m ? m[2] : 'utf-8');
}

/** Reads a user-supplied XML file as text, honouring its encoding. */
export async function readXmlFile(f: Blob): Promise<string> {
  return decodeXmlBytes(await f.arrayBuffer());
}

/** Returns the first parse error, or null when the text is well-formed. */
export function checkWellFormed(text: string): ParseError | null {
  try {
    parseXml(text);
    return null;
  } catch (e) {
    if (e instanceof XmlParseError) return e.errors[0];
    return { message: String(e), line: 1, column: 1 };
  }
}

// ------------------------------------------------------- whitespace handling and serialising (shared, see above)
export interface SerializeOptions {
  grammar?: Grammar | null;
  indent?: string;
  doctype?: Doctype | null;
  xmlDecl?: string | null;
  /** Record offsets for nodes. */
  map?: boolean;
}

export interface SerializeResult {
  text: string;
  spans: Map<Node, [number, number]> | null;
}

/**
 * Normalises whitespace for editing:
 *  - removes whitespace-only text in element-only content;
 *  - collapses whitespace runs in mixed content (except preserved elements);
 *  - trims text at block boundaries.
 */
export function normalizeWhitespace(root: Node, grammar: Grammar | null): void {
  form.normalizeWhitespace(root as unknown as form.XNode, grammar);
}

export function serialize(node: Node, opts: SerializeOptions = {}): SerializeResult {
  return form.serialize(node as unknown as form.XNode, opts) as unknown as SerializeResult;
}

// ---------------------------------------------------------------- utilities
export function elementChildren(el: Node): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

export function childNames(el: Node): string[] {
  return elementChildren(el).map((e) => e.nodeName);
}

/** Index of `child` among its parent's element children. */
export function elementIndex(child: Element): number {
  let i = 0;
  for (let c = child.previousSibling; c; c = c.previousSibling) if (c.nodeType === 1) i++;
  return i;
}

export function nodeIndex(n: Node): number {
  let i = 0;
  for (let c = n.previousSibling; c; c = c.previousSibling) i++;
  return i;
}

export function ancestors(n: Node | null, includeSelf = true): Element[] {
  const out: Element[] = [];
  let c: Node | null = includeSelf ? n : n?.parentNode ?? null;
  while (c && c.nodeType === 1) {
    out.push(c as Element);
    c = c.parentNode;
  }
  return out;
}

export function closest(n: Node | null, pred: (e: Element) => boolean): Element | null {
  for (const a of ancestors(n)) if (pred(a)) return a;
  return null;
}

export function closestName(n: Node | null, ...names: string[]): Element | null {
  return closest(n, (e) => names.includes(e.nodeName));
}

/** Simple XPath-like location used in messages: /dmodule/content/description/levelledPara[2] */
export function nodePath(n: Node): string {
  const segs: string[] = [];
  let c: Node | null = n.nodeType === 1 ? n : n.parentNode;
  while (c && c.nodeType === 1) {
    const el = c as Element;
    let idx = 1;
    let same = 0;
    for (let s = el.parentNode?.firstChild; s; s = s.nextSibling) {
      if (s.nodeType === 1 && s.nodeName === el.nodeName) {
        same++;
        if (s === el) idx = same;
      }
    }
    segs.unshift(same > 1 ? `${el.nodeName}[${idx}]` : el.nodeName);
    c = el.parentNode;
  }
  return '/' + segs.join('/');
}

export function textOf(n: Node | null): string {
  return (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Creates an element in no namespace (or a known prefixed namespace). */
export function createEl(doc: Document, name: string): Element {
  const i = name.indexOf(':');
  if (i > 0) {
    const pfx = name.slice(0, i) as keyof typeof NS;
    if (NS[pfx]) return doc.createElementNS(NS[pfx], name);
  }
  return doc.createElementNS(null, name);
}

/** Sets an attribute, handling xlink/xml prefixes and declaring namespaces on the root as needed. */
export function setAttr(el: Element, name: string, value: string): void {
  const i = name.indexOf(':');
  if (i > 0) {
    const pfx = name.slice(0, i);
    if (pfx === 'xmlns') {
      el.setAttributeNS(NS.xmlns, name, value);
      return;
    }
    const ns = (NS as Record<string, string>)[pfx];
    if (ns) {
      if (pfx !== 'xml') ensureNsDecl(el.ownerDocument, pfx, ns);
      el.setAttributeNS(ns, name, value);
      return;
    }
  }
  el.setAttribute(name, value);
}

export function removeAttr(el: Element, name: string): void {
  const a = Array.from(el.attributes).find((x) => x.name === name);
  if (a) el.removeAttributeNode(a);
}

export function ensureNsDecl(doc: Document, prefix: string, ns: string): void {
  const root = doc.documentElement;
  if (!root) return;
  if (root.getAttribute('xmlns:' + prefix) == null) root.setAttributeNS(NS.xmlns, 'xmlns:' + prefix, ns);
}

/**
 * XML 1.0 does not allow most C0 control characters (not even as character references). One of them typed or pasted into a text node
 * would make the saved file unparseable, so they are removed before text enters the model.
 */
export function stripInvalidXmlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

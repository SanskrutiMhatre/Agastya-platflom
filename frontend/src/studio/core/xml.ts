/**
 * XML I/O: parsing (with DOCTYPE internal-subset preservation), whitespace
 * normalisation for editing, and a deterministic pretty-printer that records
 * source offsets for every node (used to synchronise Design and XML views).
 */
import type { Grammar } from './grammar';
import { isBlockName, isElementOnly, isPreserved } from './display';

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
export interface DoctypeDecl {
  kind: 'entity' | 'notation' | 'other';
  name?: string;
  systemId?: string;
  publicId?: string;
  notation?: string;
  raw: string;
}

export interface Doctype {
  rootName: string;
  publicId?: string;
  systemId?: string;
  decls: DoctypeDecl[];
}

/** Locates the DOCTYPE declaration in raw XML text (handles internal subsets, quotes and comments). */
export function findDoctype(text: string): { start: number; end: number; raw: string } | null {
  // Walk the prolog the way a parser does: the XML declaration, processing instructions, comments and white space may come first
  // (a comment that merely mentions "<!DOCTYPE" or "<root" is neither the DOCTYPE nor the root element).
  let p = 0;
  for (;;) {
    while (p < text.length && /[\s﻿]/.test(text[p])) p++;
    if (text.startsWith('<?', p)) {
      const e = text.indexOf('?>', p + 2);
      if (e < 0) return null;
      p = e + 2;
    } else if (text.startsWith('<!--', p)) {
      const e = text.indexOf('-->', p + 4);
      if (e < 0) return null;
      p = e + 3;
    } else break;
  }
  if (!text.startsWith('<!DOCTYPE', p) || !/\s/.test(text[p + 9] ?? '')) return null;
  const start = p;
  let i = start + 9;
  let depth = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return { start, end: i + 1, raw: text.slice(start, i + 1) };
    i++;
  }
  return null;
}

export function parseDoctype(raw: string): Doctype {
  const head = raw.match(/^<!DOCTYPE\s+([^\s[>]+)\s*(?:(PUBLIC)\s+("[^"]*"|'[^']*')\s*("[^"]*"|'[^']*')?|(SYSTEM)\s+("[^"]*"|'[^']*'))?/);
  const dt: Doctype = { rootName: head?.[1] ?? 'dmodule', decls: [] };
  const unq = (s?: string) => (s ? s.slice(1, -1) : undefined);
  if (head?.[2]) {
    dt.publicId = unq(head[3]);
    dt.systemId = unq(head[4]);
  } else if (head?.[5]) dt.systemId = unq(head[6]);
  const lb = raw.indexOf('[');
  const rb = raw.lastIndexOf(']');
  if (lb >= 0 && rb > lb) {
    const subset = raw.slice(lb + 1, rb);
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(ENTITY|NOTATION|ELEMENT|ATTLIST)\b(?:[^>"']|"[^"]*"|'[^']*')*>|%[\w.-]+;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(subset))) {
      const text = m[0];
      if (m[1] === 'ENTITY') {
        const em = text.match(/^<!ENTITY\s+(%\s+)?([^\s]+)\s+(?:SYSTEM\s+("[^"]*"|'[^']*')|PUBLIC\s+("[^"]*"|'[^']*')\s+("[^"]*"|'[^']*'))?(?:\s*NDATA\s+([^\s>]+))?/);
        if (em && !em[1]) {
          dt.decls.push({ kind: 'entity', name: em[2], systemId: unq(em[3] ?? em[5]), publicId: unq(em[4]), notation: em[6], raw: text });
          continue;
        }
      } else if (m[1] === 'NOTATION') {
        const nm = text.match(/^<!NOTATION\s+([^\s]+)/);
        if (nm) {
          dt.decls.push({ kind: 'notation', name: nm[1], raw: text });
          continue;
        }
      }
      dt.decls.push({ kind: 'other', raw: text });
    }
  }
  return dt;
}

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

export function serializeDoctype(dt: Doctype): string {
  let s = '<!DOCTYPE ' + dt.rootName;
  if (dt.publicId != null) s += ` PUBLIC "${dt.publicId}"` + (dt.systemId != null ? ` "${dt.systemId}"` : '');
  else if (dt.systemId != null) s += ` SYSTEM "${dt.systemId}"`;
  if (dt.decls.length) {
    s += ' [\n';
    for (const d of dt.decls) s += '  ' + d.raw + '\n';
    s += ']';
  }
  return s + '>';
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

// ------------------------------------------------------- whitespace handling
const WS = /[ \t\r\n]+/g;

function isBlockNode(n: Node | null): boolean {
  return !!n && n.nodeType === 1 && isBlockName(n.nodeName);
}

/**
 * Normalises whitespace for editing:
 *  - removes whitespace-only text in element-only content;
 *  - collapses whitespace runs in mixed content (except preserved elements);
 *  - trims text at block boundaries.
 */
export function normalizeWhitespace(root: Node, grammar: Grammar | null): void {
  const walk = (el: Element) => {
    if (isPreserved(el)) return;
    const elementOnly = isElementOnly(el, grammar);
    const kids = Array.from(el.childNodes);
    if (elementOnly) {
      for (const c of kids) {
        if (c.nodeType === 3 && !/\S/.test(c.nodeValue || '')) el.removeChild(c);
      }
    } else {
      for (const c of kids) if (c.nodeType === 3) c.nodeValue = (c.nodeValue || '').replace(WS, ' ');
      // merge adjacent text nodes
      el.normalize();
      const blockParent = isBlockName(el.nodeName) || !grammar?.has(el.nodeName);
      const list = Array.from(el.childNodes);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.nodeType !== 3) continue;
        let v = c.nodeValue || '';
        const prev = c.previousSibling;
        const next = c.nextSibling;
        const atStart = !prev || isBlockNode(prev);
        const atEnd = !next || isBlockNode(next);
        if ((atStart && (prev ? true : blockParent)) || (prev && isBlockNode(prev))) v = v.replace(/^ /, '');
        if ((atEnd && (next ? true : blockParent)) || (next && isBlockNode(next))) v = v.replace(/ $/, '');
        if (!v) el.removeChild(c);
        else if (v !== c.nodeValue) c.nodeValue = v;
      }
    }
    for (const c of Array.from(el.childNodes)) if (c.nodeType === 1) walk(c as Element);
  };
  if (root.nodeType === 9) {
    const de = (root as Document).documentElement;
    if (de) walk(de);
  } else if (root.nodeType === 1) walk(root as Element);
}

// ---------------------------------------------------------------- serialising
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

// Characters XML 1.0 cannot carry (not even as references) are dropped on output, so a document can always be read back; a bare
// carriage return is written as a reference, because a parser would turn it into a line feed.
const TEXT_SPECIAL = /[&<\r\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|\]\]>/g;
const ATTR_SPECIAL = /[&<"\t\n\r\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeText(s: string): string {
  return s.replace(TEXT_SPECIAL, (m) => (m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '\r' ? '&#13;' : m === ']]>' ? ']]&gt;' : ''));
}

export function escapeAttr(s: string): string {
  return s.replace(ATTR_SPECIAL, (m) => (m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '"' ? '&quot;' : m === '\t' ? '&#9;' : m === '\n' ? '&#10;' : m === '\r' ? '&#13;' : ''));
}

/** Decides whether element children should be laid out on indented lines. */
function indentChildren(el: Element, grammar: Grammar | null): boolean {
  if (isPreserved(el)) return false;
  if (isElementOnly(el, grammar)) return true;
  // mixed element containing only block children (e.g. an entry with paras)
  let hasEl = false;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      if (/\S/.test(c.nodeValue || '')) return false;
    } else if (c.nodeType === 4) return false;
    else if (c.nodeType === 1) {
      if (!isBlockName(c.nodeName)) return false;
      hasEl = true;
    }
  }
  return hasEl;
}

const ODD_WS = /^[ \t\r\n]|[ \t\r\n]$|[ \t\r\n]{2}|[\t\r\n]/;

/**
 * The text a text node is written as. Mixed-content whitespace is written the way loading reads it (normalizeWhitespace): a run of
 * whitespace is one space, and whitespace at the very start or end of a text block is dropped. A space left behind by Enter, a deleted
 * word or a join, or a double space typed before saving, therefore reads back unchanged and a second save does not differ. Inside
 * preserved elements (`pretty` false) nothing is touched.
 */
function textAsWritten(t: Node, pretty: boolean, grammar: Grammar | null): string {
  const v = t.nodeValue || '';
  const el = t.parentNode;
  if (!pretty || !el || el.nodeType !== 1 || !ODD_WS.test(v)) return v;
  // a neighbouring empty text node is nothing (a parser would not create it); a neighbouring text node makes this one a middle part
  const sibling = (dir: 'previousSibling' | 'nextSibling') => {
    let s = t[dir];
    while (s && s.nodeType === 3 && !s.nodeValue) s = s[dir];
    return s;
  };
  const prev = sibling('previousSibling');
  const next = sibling('nextSibling');
  const blockParent = isBlockName(el.nodeName) || !grammar?.has(el.nodeName);
  let s = v.replace(/[ \t\r\n]+/g, ' ');
  if (prev ? isBlockNode(prev) || (prev.nodeType === 3 && /[ \t\r\n]$/.test(prev.nodeValue || '')) : blockParent) s = s.replace(/^ /, '');
  if (next ? isBlockNode(next) : blockParent) s = s.replace(/ $/, '');
  return s;
}

export function serialize(node: Node, opts: SerializeOptions = {}): SerializeResult {
  const grammar = opts.grammar ?? null;
  const ind = opts.indent ?? '  ';
  const parts: string[] = [];
  let len = 0;
  const spans = opts.map ? new Map<Node, [number, number]>() : null;
  const out = (s: string) => {
    parts.push(s);
    len += s.length;
  };

  const writeAttrs = (el: Element) => {
    for (const a of Array.from(el.attributes)) out(' ' + a.name + '="' + escapeAttr(a.value) + '"');
  };

  const writeNode = (n: Node, depth: number, pretty: boolean) => {
    const start = len;
    switch (n.nodeType) {
      case 1: {
        const el = n as Element;
        out('<' + el.nodeName);
        writeAttrs(el);
        const kids = Array.from(el.childNodes);
        const indent = pretty && indentChildren(el, grammar);
        const childPretty = pretty && !isPreserved(el);
        const visible = indent
          ? kids.filter((k) => !(k.nodeType === 3 && !/\S/.test(k.nodeValue || '')))
          : kids.filter((k) => k.nodeType !== 3 || textAsWritten(k, childPretty, grammar) !== '');
        if (visible.length === 0) {
          out('/>');
        } else {
          out('>');
          if (indent) {
            for (const k of visible) {
              out('\n' + ind.repeat(depth + 1));
              writeNode(k, depth + 1, true);
            }
            out('\n' + ind.repeat(depth));
          } else {
            for (const k of visible) writeNode(k, depth, childPretty);
          }
          out('</' + el.nodeName + '>');
        }
        break;
      }
      case 3:
        out(escapeText(textAsWritten(n, pretty, grammar)));
        break;
      case 4:
        out('<![CDATA[' + (n.nodeValue || '') + ']]>');
        break;
      case 7: {
        const pi = n as ProcessingInstruction;
        out('<?' + pi.target + (pi.data ? ' ' + pi.data : '') + '?>');
        break;
      }
      case 8:
        out('<!--' + (n.nodeValue || '') + '-->');
        break;
      case 9: {
        const d = n as Document;
        out(opts.xmlDecl ?? '<?xml version="1.0" encoding="UTF-8"?>');
        let doctypeWritten = false;
        for (const k of Array.from(d.childNodes)) {
          if (k.nodeType === 10) continue;
          if (k.nodeType === 1 && !doctypeWritten) {
            if (opts.doctype) {
              out('\n' + serializeDoctype(opts.doctype));
            }
            doctypeWritten = true;
          }
          out('\n');
          writeNode(k, 0, true);
        }
        out('\n');
        break;
      }
      case 11:
        for (const k of Array.from(n.childNodes)) writeNode(k, depth, pretty);
        break;
    }
    if (spans) spans.set(n, [start, len]);
  };

  writeNode(node, 0, true);
  return { text: parts.join(''), spans };
}

/** Serialises a node without pretty printing (exact content), for clipboard and fragments. */
export function serializeRaw(node: Node): string {
  const s = new XMLSerializer().serializeToString(node);
  return s;
}

/** Pretty-prints arbitrary XML text (keeps mixed content intact). */
export function formatXmlText(text: string, grammar: Grammar | null): string {
  const p = parseXml(text);
  normalizeWhitespace(p.doc, grammar);
  return serialize(p.doc, { grammar, doctype: p.doctype, xmlDecl: p.xmlDecl }).text;
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

/** Converts a childNodes offset into an element-children index. */
export function elementIndexAtOffset(parent: Node, offset: number): number {
  let i = 0;
  const kids = parent.childNodes;
  for (let k = 0; k < Math.min(offset, kids.length); k++) if (kids[k].nodeType === 1) i++;
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

/** Resolves a path produced by nodePath. */
export function resolvePath(doc: Document, path: string): Element | null {
  const segs = path.split('/').filter(Boolean);
  let cur: Element | null = null;
  for (const seg of segs) {
    const m = seg.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!m) return null;
    const name = m[1];
    const idx = m[2] ? parseInt(m[2], 10) : 1;
    const pool: Element[] = cur ? elementChildren(cur) : doc.documentElement ? [doc.documentElement] : [];
    const matches = pool.filter((e) => e.nodeName === name);
    cur = matches[idx - 1] ?? null;
    if (!cur) return null;
  }
  return cur;
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

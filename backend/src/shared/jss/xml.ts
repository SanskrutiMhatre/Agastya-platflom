// Reading and writing the JSS document (backend/schemas/jss/jss-1.0.xsd).
//
// parseJss(serializeJss(doc)) is the document again, and serializeJss(parseJss(xml)) is the same document in a fixed layout, so saving never reorders or
// reformats what an author did not touch. The XML is the project's source of truth: this file is the only place the editor produces it.
//
// Reading is strict. An element or attribute the schema does not have is an error that names it - never dropped - because a silent drop would be a
// document that saves "fine" and has lost content.
//
// Phase 3 (P3-1, live co-editing of JSS): moved here from frontend/src/jss/xml.ts, unchanged in what it reads and writes, so that the server writes a
// live document back with the editor's own serializer (a write-back is byte for byte a normal save). It runs on any W3C-style DOM: the browser's
// (DOMParser, the default) or @xmldom/xmldom's on the server (parseJss(xml, parser)); the DOM types below are structural for that reason.

import {
  META_FIELDS, type Align, type Block, type Cell, type Chapter, type Figure, type Graphic, type Inline, type JssDoc, type List, type ListItem, type ListType,
  type Mark, type Notice, type NoticeKind, type Orientation, type Para, type Part, type Row, type Section, type Table,
} from './model';

/** The part of a W3C DOM the reader uses (the browser's and @xmldom/xmldom's both have it). */
interface Node { nodeType: number; nodeValue: string | null; childNodes: ArrayLike<Node>; cloneNode(deep: boolean): Node; textContent: string | null }
interface Element extends Node {
  localName: string; attributes: ArrayLike<{ name: string; value: string }>; getAttribute(name: string): string | null;
  appendChild(n: Node): Node; ownerDocument: { createElement(name: string): Element };
}
/** What parses a text into a DOM document (the browser's DOMParser by default). */
export interface JssDomParser { parseFromString(xml: string, type: string): { documentElement: Element | null; getElementsByTagName(name: string): ArrayLike<{ textContent: string | null }> } }

export class JssParseError extends Error { constructor(message: string) { super(message); this.name = 'JssParseError'; } }

const ALIGNS = ['left', 'center', 'right', 'justify'];
const LIST_TYPES = ['alpha', 'roman', 'number', 'bullet', 'dash'];
const ORIENTATIONS = ['portrait', 'landscape', 'a3-landscape'];
const MARKS = ['b', 'i', 'u', 'sup', 'sub'];
const NOTICES = ['note', 'warning', 'caution'];
const META_KEYS = new Set(META_FIELDS.map((f) => f.key));

// ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const els = (n: Element): Element[] => Array.from(n.childNodes).filter((c): c is Element => c.nodeType === 1);
const attrs = (n: Element, allowed: string[]): void => {
  for (const a of Array.from(n.attributes)) if (!allowed.includes(a.name)) throw new JssParseError(`<${n.localName}> has an attribute the JSS schema does not have: ${a.name}`);
};
const oneOf = <T extends string>(v: string | null, list: string[], what: string): T | undefined => {
  if (v === null) return undefined;
  if (!list.includes(v)) throw new JssParseError(`${what} "${v}" is not one of ${list.join(', ')}`);
  return v as T;
};
const posInt = (v: string | null, what: string): number | undefined => {
  if (v === null) return undefined;
  if (!/^[1-9]\d*$/.test(v)) throw new JssParseError(`${what} must be a positive whole number, not "${v}"`);
  return Number(v);
};

function inlineOf(parent: Node): Inline[] {
  const out: Inline[] = [];
  for (const n of Array.from(parent.childNodes)) {
    if (n.nodeType === 3 || n.nodeType === 4) { if (n.nodeValue) out.push({ t: 'text', text: n.nodeValue }); continue; }
    if (n.nodeType !== 1) continue;
    const e = n as Element; const name = e.localName;
    if (MARKS.includes(name)) { attrs(e, []); out.push({ t: 'mark', mark: name as Mark, children: inlineOf(e) }); }
    else if (name === 'br') { attrs(e, []); out.push({ t: 'br' }); }
    else if (name === 'xref') { attrs(e, ['to', 'href']); out.push({ t: 'xref', to: e.getAttribute('to') ?? undefined, href: e.getAttribute('href') ?? undefined, children: inlineOf(e) }); }
    else throw new JssParseError(`<${name}> is not allowed inside text`);
  }
  return out;
}

function paraOf(e: Element): Para {
  attrs(e, ['align', 'indent']);
  const indent = e.getAttribute('indent');
  if (indent !== null && indent !== 'none') throw new JssParseError(`indent must be "none", not "${indent}"`);
  return { k: 'para', align: oneOf<Align>(e.getAttribute('align'), ALIGNS, 'align'), indentNone: indent === 'none' || undefined, inline: inlineOf(e) };
}

/** The parts of a list item or a table cell: runs of text, paragraphs and nested lists. */
function partsOf(parent: Element): Part[] {
  const parts: Part[] = []; let run: Node[] = [];
  const flush = (nextIsBlock: boolean) => {
    if (!run.length) return;
    const holder = parent.ownerDocument.createElement('x'); for (const n of run) holder.appendChild(n.cloneNode(true));
    let inline = inlineOf(holder);
    // whitespace that only separates a text run from a neighbouring paragraph or list is layout, not content
    const blank = (r: Inline) => r.t === 'text' && !r.text.trim();
    if (parts.length || nextIsBlock) { if (parts.length && inline.length && blank(inline[0])) inline = inline.slice(1); if (nextIsBlock && inline.length && blank(inline[inline.length - 1])) inline = inline.slice(0, -1); }
    if (inline.length) parts.push({ k: 'inline', inline });
    run = [];
  };
  for (const n of Array.from(parent.childNodes)) {
    if (n.nodeType === 1 && ((n as Element).localName === 'para' || (n as Element).localName === 'list')) {
      flush(true);
      const e = n as Element;
      parts.push(e.localName === 'para' ? paraOf(e) : listOf(e));
    } else run.push(n);
  }
  flush(false);
  return parts.length ? parts : [{ k: 'inline', inline: [] }];
}

function listOf(e: Element): List {
  attrs(e, ['type']);
  const items: ListItem[] = [];
  for (const i of els(e)) { if (i.localName !== 'item') throw new JssParseError(`<${i.localName}> is not allowed in a list`); attrs(i, []); items.push({ parts: partsOf(i) }); }
  if (!items.length) throw new JssParseError('A list needs at least one item');
  return { k: 'list', type: oneOf<ListType>(e.getAttribute('type'), LIST_TYPES, 'list type'), items };
}

function rowsOf(group: Element | undefined): Row[] {
  if (!group) return [];
  return els(group).map((r) => {
    if (r.localName !== 'row') throw new JssParseError(`<${r.localName}> is not allowed in a table`);
    attrs(r, []);
    return { cells: els(r).map((c): Cell => {
      if (c.localName !== 'cell') throw new JssParseError(`<${c.localName}> is not allowed in a row`);
      attrs(c, ['colspan', 'rowspan', 'align']);
      return { colspan: posInt(c.getAttribute('colspan'), 'colspan'), rowspan: posInt(c.getAttribute('rowspan'), 'rowspan'), align: oneOf<Align>(c.getAttribute('align'), ALIGNS, 'align'), parts: partsOf(c) };
    }) };
  });
}

function tableOf(e: Element): Table {
  attrs(e, ['id', 'widths']);
  let title: string | undefined; let head: Element | undefined; let body: Element | undefined;
  for (const c of els(e)) {
    if (c.localName === 'title') title = c.textContent ?? '';
    else if (c.localName === 'thead') head = c; else if (c.localName === 'tbody') body = c;
    else throw new JssParseError(`<${c.localName}> is not allowed in a table`);
  }
  return { k: 'table', id: e.getAttribute('id') ?? undefined, widths: e.getAttribute('widths') ?? undefined, title, head: rowsOf(head), body: rowsOf(body) };
}

function figureOf(e: Element): Figure {
  attrs(e, ['id']);
  const f: Figure = { k: 'figure', id: e.getAttribute('id') ?? undefined, title: undefined, graphics: [], legend: [] };
  for (const c of els(e)) {
    if (c.localName === 'title') f.title = c.textContent ?? '';
    else if (c.localName === 'graphic') {
      attrs(c, ['src', 'width', 'height']);
      const src = c.getAttribute('src'); if (!src) throw new JssParseError('A graphic needs a src');
      const g: Graphic = { src }; if (c.getAttribute('width')) g.width = c.getAttribute('width')!; if (c.getAttribute('height')) g.height = c.getAttribute('height')!;
      f.graphics.push(g);
    } else if (c.localName === 'legend') {
      for (const k of els(c)) { if (k.localName !== 'keyitem') throw new JssParseError(`<${k.localName}> is not allowed in a legend`); attrs(k, ['num']); f.legend.push({ num: k.getAttribute('num') ?? '', text: k.textContent ?? '' }); }
    } else throw new JssParseError(`<${c.localName}> is not allowed in a figure`);
  }
  return f;
}

function noticeOf(e: Element): Notice {
  attrs(e, []);
  return { k: e.localName as NoticeKind, parts: els(e).map((p) => { if (p.localName === 'para') return paraOf(p); if (p.localName === 'list') return listOf(p); throw new JssParseError(`<${p.localName}> is not allowed in a ${e.localName}`); }) };
}

let reorderedSeen = false;

function childrenOf(e: Element): { title: string; children: Array<Block | Section> } {
  let title = ''; const children: Array<Block | Section> = []; let seenTitle = false;
  for (const c of els(e)) {
    const name = c.localName;
    if (name === 'title' && !seenTitle) { title = c.textContent ?? ''; seenTitle = true; continue; }
    if (!seenTitle) throw new JssParseError(`<${e.localName}> must start with its <title>`);
    if (name === 'para') children.push(paraOf(c));
    else if (name === 'list') children.push(listOf(c));
    else if (name === 'table') children.push(tableOf(c));
    else if (name === 'figure') children.push(figureOf(c));
    else if (NOTICES.includes(name)) children.push(noticeOf(c));
    else if (name === 'pageBreak') { attrs(c, []); children.push({ k: 'pageBreak' }); }
    else if (name === 'section') children.push(sectionOf(c));
    else throw new JssParseError(`<${name}> is not allowed in a ${e.localName}`);
  }
  if (!seenTitle) throw new JssParseError(`<${e.localName}> has no <title>`);
  // A section's own content is printed before its sub-sections whatever order the file lists them in, so that is the order the model keeps; the document is told it was out of order
  const firstSub = children.findIndex((c) => c.k === 'section');
  if (firstSub >= 0 && children.slice(firstSub).some((c) => c.k !== 'section')) {
    reorderedSeen = true;
    return { title, children: [...children.filter((c) => c.k !== 'section'), ...children.filter((c) => c.k === 'section')] };
  }
  return { title, children };
}

function sectionOf(e: Element): Section {
  attrs(e, ['id', 'orientation']);
  return { k: 'section', id: e.getAttribute('id') ?? undefined, orientation: oneOf<Orientation>(e.getAttribute('orientation'), ORIENTATIONS, 'orientation'), ...childrenOf(e) };
}

export function parseJss(xml: string, parser?: JssDomParser): JssDoc {
  const dom = (parser ?? new (globalThis as unknown as { DOMParser: new () => JssDomParser }).DOMParser()).parseFromString(xml, 'application/xml');
  const bad = dom.getElementsByTagName('parsererror')[0];
  if (bad) throw new JssParseError(`The document is not well-formed XML: ${(bad.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  if (!dom.documentElement) throw new JssParseError('The document is not well-formed XML: it has no root element');
  return parseJssElement(dom.documentElement);
}

/** The document a parsed <jssbook> element holds (parseJss after the parsing). */
export function parseJssElement(root: Element): JssDoc {
  reorderedSeen = false;
  if (root.localName !== 'jssbook') throw new JssParseError(`The root element is <${root.localName}>, not <jssbook>`);
  attrs(root, ['docType', 'schemaVersion']);
  const docType = root.getAttribute('docType'); if (!docType) throw new JssParseError('<jssbook> has no docType');
  const meta: Record<string, string> = {}; const chapters: Chapter[] = [];
  for (const c of els(root)) {
    if (c.localName === 'bookmeta') {
      for (const f of els(c)) { if (!META_KEYS.has(f.localName)) throw new JssParseError(`<${f.localName}> is not part of the publication's identity`); meta[f.localName] = (f.textContent ?? '').trim(); }
    } else if (c.localName === 'body') {
      for (const ch of els(c)) {
        if (ch.localName !== 'chapter') throw new JssParseError(`<${ch.localName}> is not allowed in <body>`);
        attrs(ch, ['number', 'id', 'orientation']);
        chapters.push({ k: 'chapter', number: posInt(ch.getAttribute('number'), 'chapter number') ?? chapters.length + 1, id: ch.getAttribute('id') ?? undefined, orientation: oneOf<Orientation>(ch.getAttribute('orientation'), ORIENTATIONS, 'orientation'), ...childrenOf(ch) });
      }
    } else throw new JssParseError(`<${c.localName}> is not allowed in <jssbook>`);
  }
  return { docType, meta, chapters, ...(reorderedSeen ? { reordered: true } : {}) };
}

// ── Writing ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');
const at = (name: string, v: string | number | undefined): string => (v === undefined || v === '' ? '' : ` ${name}="${escAttr(String(v))}"`);

function inlineXml(runs: Inline[]): string {
  return runs.map((r) => {
    if (r.t === 'text') return esc(r.text);
    if (r.t === 'br') return '<br/>';
    if (r.t === 'mark') { const inner = inlineXml(r.children); return inner ? `<${r.mark}>${inner}</${r.mark}>` : ''; }
    const inner = inlineXml(r.children);
    return `<xref${at('to', r.to)}${at('href', r.href)}${inner ? `>${inner}</xref>` : '/>'}`;
  }).join('');
}

const paraXml = (p: Para): string => `<para${at('align', p.align)}${p.indentNone ? ' indent="none"' : ''}>${inlineXml(p.inline)}</para>`;

/** Mixed content (list items, cells): nothing is added between the parts, because whitespace there is content. */
function partsXml(parts: Part[], pad: string): string {
  return parts.map((p) => (p.k === 'inline' ? inlineXml(p.inline) : p.k === 'para' ? paraXml(p) : listXml(p, pad))).join('');
}

function listXml(l: List, pad: string): string {
  const inner = l.items.map((i) => `${pad}  <item>${partsXml(i.parts, pad + '    ')}</item>`).join('\n');
  return `<list${at('type', l.type)}>\n${inner}\n${pad}</list>`;
}

function rowsXml(rows: Row[], pad: string): string {
  return rows.map((r) => `${pad}<row>\n${r.cells.map((c) => `${pad}  <cell${at('colspan', c.colspan)}${at('rowspan', c.rowspan)}${at('align', c.align)}>${partsXml(c.parts, pad + '    ')}</cell>`).join('\n')}\n${pad}</row>`).join('\n');
}

function blockXml(b: Block, pad: string): string {
  switch (b.k) {
    case 'para': return `${pad}${paraXml(b)}`;
    case 'list': return `${pad}${listXml(b, pad)}`;
    case 'pageBreak': return `${pad}<pageBreak/>`;
    case 'note': case 'warning': case 'caution': return `${pad}<${b.k}>\n${b.parts.map((p) => (p.k === 'para' ? `${pad}  ${paraXml(p)}` : `${pad}  ${listXml(p, pad + '  ')}`)).join('\n')}\n${pad}</${b.k}>`;
    case 'table': {
      const parts = [b.title !== undefined && b.title !== '' ? `${pad}  <title>${esc(b.title)}</title>` : '', b.head.length ? `${pad}  <thead>\n${rowsXml(b.head, pad + '    ')}\n${pad}  </thead>` : '', `${pad}  <tbody>\n${rowsXml(b.body, pad + '    ')}\n${pad}  </tbody>`].filter(Boolean);
      return `${pad}<table${at('id', b.id)}${at('widths', b.widths)}>\n${parts.join('\n')}\n${pad}</table>`;
    }
    case 'figure': {
      const parts = [b.title ? `${pad}  <title>${esc(b.title)}</title>` : '', ...b.graphics.map((g) => `${pad}  <graphic${at('src', g.src)}${at('width', g.width)}${at('height', g.height)}/>`),
        b.legend.length ? `${pad}  <legend>\n${b.legend.map((k) => `${pad}    <keyitem num="${escAttr(k.num)}">${esc(k.text)}</keyitem>`).join('\n')}\n${pad}  </legend>` : ''].filter(Boolean);
      return `${pad}<figure${at('id', b.id)}>\n${parts.join('\n')}\n${pad}</figure>`;
    }
  }
}

function childrenXml(children: Array<Block | Section>, pad: string): string {
  return children.map((c) => (c.k === 'section' ? sectionXml(c, pad) : blockXml(c, pad))).join('\n');
}

function sectionXml(s: Section, pad: string): string {
  const body = childrenXml(s.children, pad + '  ');
  return `${pad}<section${at('id', s.id)}${at('orientation', s.orientation)}><title>${esc(s.title)}</title>${body ? `\n${body}\n${pad}` : ''}</section>`;
}

export function serializeJss(doc: JssDoc): string {
  const meta = META_FIELDS.filter((f) => f.key === 'bookName' || (doc.meta[f.key] ?? '').trim() !== '').map((f) => `    <${f.key}>${esc((doc.meta[f.key] ?? '').trim())}</${f.key}>`).join('\n');
  const chapters = doc.chapters.map((c) => {
    const body = childrenXml(c.children, '      ');
    return `    <chapter number="${c.number}"${at('id', c.id)}${at('orientation', c.orientation)}><title>${esc(c.title)}</title>${body ? `\n${body}\n    ` : ''}</chapter>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jssbook docType="${escAttr(doc.docType)}" schemaVersion="1.0">\n  <bookmeta>\n${meta}\n  </bookmeta>\n  <body>\n${chapters}\n  </body>\n</jssbook>\n`;
}

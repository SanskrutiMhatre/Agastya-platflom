// The canonical JSS document model, as the backend sees it.
//
// This mirrors the editor's own model (frontend/src/jss/model.ts) and writes exactly the XML the editor writes and the JSS schema (schemas/jss/jss-1.0.xsd) allows. The RWI import
// adapter maps INTO it and the export serializers read FROM it; neither the schema nor the JSS editor is touched. Everything here is pure (text in, text out), so it is tested without a server.

import { DOMParser } from '@xmldom/xmldom';
import { escText as esc } from '../../../lib/xml';

export type Mark = 'b' | 'i' | 'u' | 'sup' | 'sub';
export type Inline =
  | { t: 'text'; text: string }
  | { t: 'mark'; mark: Mark; children: Inline[] }
  | { t: 'br' }
  | { t: 'xref'; to?: string; href?: string; children: Inline[] };

export type ListType = 'alpha' | 'roman' | 'number' | 'bullet' | 'dash';
export type Align = 'left' | 'center' | 'right' | 'justify';

export interface Para { k: 'para'; align?: Align; inline: Inline[] }
/** What a list item or a table cell holds: a run of text, a paragraph, or a nested list. */
export type Part = { k: 'inline'; inline: Inline[] } | Para | List;
export interface ListItem { parts: Part[] }
export interface List { k: 'list'; type?: ListType; items: ListItem[] }
export interface Cell { colspan?: number; rowspan?: number; align?: Align; parts: Part[] }
export interface Row { cells: Cell[] }
export interface Table { k: 'table'; id?: string; widths?: string; title?: string; head: Row[]; body: Row[] }
export interface Graphic { src: string; width?: string; height?: string }
export interface KeyItem { num: string; text: string }
export interface Figure { k: 'figure'; id?: string; title?: string; graphics: Graphic[]; legend: KeyItem[] }
export interface Notice { k: 'note' | 'warning' | 'caution'; blocks: Array<Para | List> }
export interface PageBreak { k: 'pageBreak' }
export type Block = Para | List | Table | Figure | Notice | PageBreak;
export interface Section { k: 'section'; id?: string; title: string; orientation?: string; children: Array<Block | Section> }
export interface Chapter { k: 'chapter'; number: number; id?: string; title: string; children: Array<Block | Section> }
export interface JssDocument { docType: string; schemaVersion: string; meta: Record<string, string>; chapters: Chapter[] }

export const META_ORDER = ['bookName', 'systemName', 'security', 'publicationNo', 'codeNo', 'revNo', 'inbrNo', 'nsn', 'contractNo', 'projectCode', 'ltDocumentNo', 'month', 'year'];

export const isSection = (n: Block | Section): n is Section => n.k === 'section';
export const text = (s: string): Inline[] => (s ? [{ t: 'text', text: s }] : []);
export const plain = (inl: Inline[]): string => inl.map((i) => (i.t === 'text' ? i.text : i.t === 'br' ? ' ' : plain(i.children))).join('');

// ── writing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export { esc };
const escA = (s: string): string => esc(s).replace(/"/g, '&quot;');
const at = (name: string, v: string | number | undefined): string => (v === undefined || v === '' ? '' : ` ${name}="${escA(String(v))}"`);

export function inlineXml(inl: Inline[]): string {
  return inl.map((i) => {
    if (i.t === 'text') return esc(i.text);
    if (i.t === 'br') return '<br/>';
    if (i.t === 'xref') return `<xref${at('to', i.to)}${at('href', i.href)}>${inlineXml(i.children)}</xref>`;
    return `<${i.mark}>${inlineXml(i.children)}</${i.mark}>`;
  }).join('');
}

const paraXml = (p: Para): string => `<para${at('align', p.align)}>${inlineXml(p.inline)}</para>`;

function partsXml(parts: Part[], pad: string): string {
  return parts.map((p) => (p.k === 'inline' ? inlineXml(p.inline) : p.k === 'para' ? paraXml(p) : `\n${listXml(p, pad)}\n${pad.slice(2)}`)).join('');
}

function listXml(l: List, pad: string): string {
  const items = l.items.map((it) => `${pad}  <item>${partsXml(it.parts, pad + '    ')}</item>`).join('\n');
  return `${pad}<list${at('type', l.type)}>\n${items}\n${pad}</list>`;
}

function rowsXml(rows: Row[], pad: string): string {
  return rows.map((r) => `${pad}<row>\n${r.cells.map((c) => `${pad}  <cell${at('colspan', c.colspan)}${at('rowspan', c.rowspan)}${at('align', c.align)}>${partsXml(c.parts, pad + '      ')}</cell>`).join('\n')}\n${pad}</row>`).join('\n');
}

export function blockXml(b: Block, pad: string): string {
  switch (b.k) {
    case 'para': return pad + paraXml(b);
    case 'list': return listXml(b, pad);
    case 'pageBreak': return `${pad}<pageBreak/>`;
    case 'table': {
      const out: string[] = [];
      if (b.title) out.push(`${pad}  <title>${esc(b.title)}</title>`);
      if (b.head.length) out.push(`${pad}  <thead>\n${rowsXml(b.head, pad + '    ')}\n${pad}  </thead>`);
      out.push(`${pad}  <tbody>\n${rowsXml(b.body, pad + '    ')}\n${pad}  </tbody>`);
      return `${pad}<table${at('id', b.id)}${at('widths', b.widths)}>\n${out.join('\n')}\n${pad}</table>`;
    }
    case 'figure': {
      const out: string[] = [];
      if (b.title) out.push(`${pad}  <title>${esc(b.title)}</title>`);
      for (const g of b.graphics) out.push(`${pad}  <graphic${at('src', g.src)}${at('width', g.width)}${at('height', g.height)}/>`);
      if (b.legend.length) out.push(`${pad}  <legend>\n${b.legend.map((k) => `${pad}    <keyitem num="${escA(k.num)}">${esc(k.text)}</keyitem>`).join('\n')}\n${pad}  </legend>`);
      return `${pad}<figure${at('id', b.id)}>\n${out.join('\n')}\n${pad}</figure>`;
    }
    default: return `${pad}<${b.k}>\n${b.blocks.map((x) => (x.k === 'para' ? `${pad}  ${paraXml(x)}` : listXml(x, pad + '  '))).join('\n')}\n${pad}</${b.k}>`;
  }
}

export function sectionXml(s: Section, pad: string): string {
  const body = s.children.map((c) => (isSection(c) ? sectionXml(c, pad + '  ') : blockXml(c, pad + '  '))).join('\n');
  return `${pad}<section${at('id', s.id)}${at('orientation', s.orientation)}>\n${pad}  <title>${esc(s.title)}</title>${body ? '\n' + body : ''}\n${pad}</section>`;
}

export function serializeJss(d: JssDocument): string {
  const meta = META_ORDER.filter((k) => d.meta[k] !== undefined && d.meta[k] !== '').map((k) => `    <${k}>${esc(d.meta[k])}</${k}>`).join('\n');
  const chapters = d.chapters.map((c) => {
    const body = c.children.map((x) => (isSection(x) ? sectionXml(x, '      ') : blockXml(x, '      '))).join('\n');
    return `    <chapter number="${c.number}"${at('id', c.id)}>\n      <title>${esc(c.title)}</title>${body ? '\n' + body : ''}\n    </chapter>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jssbook docType="${escA(d.docType)}" schemaVersion="${escA(d.schemaVersion)}">\n  <bookmeta>\n${meta}\n  </bookmeta>\n  <body>\n${chapters}\n  </body>\n</jssbook>\n`;
}

// ── reading (the export serializers read the document the author edited) ──────────────────────────────────────────────────────

class JssReadError extends Error {}
const kids = (e: Element): Element[] => { const out: Element[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element); return out; };
const attr = (e: Element, n: string): string | undefined => (e.hasAttribute(n) ? e.getAttribute(n) ?? '' : undefined);
const MARKS = new Set(['b', 'i', 'u', 'sup', 'sub']);

function inlineOf(e: Element, stopAt: Set<string> = new Set()): Inline[] {
  const out: Inline[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) { const t = n.nodeValue ?? ''; if (t) out.push({ t: 'text', text: t }); continue; }
    if (n.nodeType !== 1) continue;
    const c = n as Element; const name = c.tagName;
    if (stopAt.has(name)) continue;
    if (MARKS.has(name)) out.push({ t: 'mark', mark: name as Mark, children: inlineOf(c) });
    else if (name === 'br') out.push({ t: 'br' });
    else if (name === 'xref') out.push({ t: 'xref', ...(attr(c, 'to') !== undefined ? { to: attr(c, 'to') } : {}), ...(attr(c, 'href') !== undefined ? { href: attr(c, 'href') } : {}), children: inlineOf(c) });
  }
  return out;
}

function partsOf(e: Element): Part[] {
  const parts: Part[] = []; let run: Inline[] = [];
  const flush = (): void => { if (run.some((i) => i.t !== 'text' || i.text.trim())) parts.push({ k: 'inline', inline: run }); run = []; };
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) { const t = n.nodeValue ?? ''; if (t) run.push({ t: 'text', text: t }); continue; }
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (c.tagName === 'para') { flush(); parts.push(paraOf(c)); }
    else if (c.tagName === 'list') { flush(); parts.push(listOf(c)); }
    else if (MARKS.has(c.tagName)) run.push({ t: 'mark', mark: c.tagName as Mark, children: inlineOf(c) });
    else if (c.tagName === 'br') run.push({ t: 'br' });
    else if (c.tagName === 'xref') run.push({ t: 'xref', ...(attr(c, 'to') !== undefined ? { to: attr(c, 'to') } : {}), ...(attr(c, 'href') !== undefined ? { href: attr(c, 'href') } : {}), children: inlineOf(c) });
  }
  flush();
  return parts;
}

const paraOf = (e: Element): Para => ({ k: 'para', ...(attr(e, 'align') ? { align: attr(e, 'align') as Align } : {}), inline: inlineOf(e) });
function listOf(e: Element): List { return { k: 'list', ...(attr(e, 'type') ? { type: attr(e, 'type') as ListType } : {}), items: kids(e).filter((i) => i.tagName === 'item').map((i) => ({ parts: partsOf(i) })) }; }
const rowsOf = (g: Element | undefined): Row[] => (g ? kids(g).filter((r) => r.tagName === 'row').map((r) => ({ cells: kids(r).filter((c) => c.tagName === 'cell').map((c): Cell => ({
  ...(attr(c, 'colspan') ? { colspan: Number(attr(c, 'colspan')) } : {}), ...(attr(c, 'rowspan') ? { rowspan: Number(attr(c, 'rowspan')) } : {}), ...(attr(c, 'align') ? { align: attr(c, 'align') as Align } : {}), parts: partsOf(c) })) })) : []);

function blockOf(e: Element): Block | null {
  switch (e.tagName) {
    case 'para': return paraOf(e);
    case 'list': return listOf(e);
    case 'pageBreak': return { k: 'pageBreak' };
    case 'table': {
      const title = kids(e).find((c) => c.tagName === 'title');
      return { k: 'table', ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ...(attr(e, 'widths') ? { widths: attr(e, 'widths') } : {}), ...(title ? { title: (title.textContent ?? '').trim() } : {}),
        head: rowsOf(kids(e).find((c) => c.tagName === 'thead')), body: rowsOf(kids(e).find((c) => c.tagName === 'tbody')) };
    }
    case 'figure': {
      const title = kids(e).find((c) => c.tagName === 'title'); const legend = kids(e).find((c) => c.tagName === 'legend');
      return { k: 'figure', ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ...(title ? { title: (title.textContent ?? '').trim() } : {}),
        graphics: kids(e).filter((c) => c.tagName === 'graphic').map((g) => ({ src: attr(g, 'src') ?? '', ...(attr(g, 'width') ? { width: attr(g, 'width') } : {}), ...(attr(g, 'height') ? { height: attr(g, 'height') } : {}) })),
        legend: legend ? kids(legend).filter((k) => k.tagName === 'keyitem').map((k) => ({ num: attr(k, 'num') ?? '', text: (k.textContent ?? '').trim() })) : [] };
    }
    case 'note': case 'warning': case 'caution':
      return { k: e.tagName, blocks: kids(e).map((c) => (c.tagName === 'list' ? listOf(c) : paraOf(c))) };
    default: return null;
  }
}

function sectionOf(e: Element): Section {
  const title = kids(e).find((c) => c.tagName === 'title');
  return { k: 'section', ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ...(attr(e, 'orientation') ? { orientation: attr(e, 'orientation') } : {}), title: (title?.textContent ?? '').trim(),
    children: kids(e).filter((c) => c.tagName !== 'title').map((c) => (c.tagName === 'section' ? sectionOf(c) : blockOf(c))).filter((x): x is Block | Section => !!x) };
}

export function parseJss(xml: string): JssDocument {
  // xmldom's own node types are not the DOM library's: the parsed document is used through the standard DOM types
  const dom = new DOMParser({ onError: (level: string, m: string) => { if (level === 'fatalError') throw new JssReadError(m); } }).parseFromString(xml, 'text/xml') as unknown as Document;
  const root = dom.documentElement;
  if (!root || root.tagName !== 'jssbook') throw new JssReadError('This is not a JSS document.');
  const meta: Record<string, string> = {};
  const bm = kids(root).find((c) => c.tagName === 'bookmeta');
  for (const m of bm ? kids(bm) : []) meta[m.tagName] = (m.textContent ?? '').trim();
  const body = kids(root).find((c) => c.tagName === 'body');
  const chapters = (body ? kids(body) : []).filter((c) => c.tagName === 'chapter').map((c): Chapter => {
    const title = kids(c).find((x) => x.tagName === 'title');
    return { k: 'chapter', number: Number(attr(c, 'number') ?? 0), ...(attr(c, 'id') ? { id: attr(c, 'id') } : {}), title: (title?.textContent ?? '').trim(),
      children: kids(c).filter((x) => x.tagName !== 'title').map((x) => (x.tagName === 'section' ? sectionOf(x) : blockOf(x))).filter((x): x is Block | Section => !!x) };
  });
  return { docType: attr(root, 'docType') ?? '', schemaVersion: attr(root, 'schemaVersion') ?? '1.0', meta, chapters };
}

/** A canonical, whitespace-insensitive text form of a section: used to tell "unchanged since import" from "edited". */
export function fingerprintSection(s: Section): string {
  return JSON.stringify(s, (k, v) => (k === 'text' && typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v));
}

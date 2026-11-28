// Reading and writing a JSG document: <jsgdoc> XML <-> the model (./model.ts).
//
// Reading refuses anything the schema does not allow instead of silently dropping it, so a document written by hand or by another tool is never damaged by
// opening and saving it. Writing is deterministic: the same model always gives the same text.
//
// Phase 3 (P3-1, live co-editing of JSG): this file moved from frontend/src/jsg/xml.ts to backend/src/shared/jsg/ so that the server writes a live
// document back with exactly the editor's serializer (a write-back is byte-identical to a save from the editor). It is DOM-free: readJsg() takes any
// W3C-style element (the browser's, or @xmldom/xmldom's on the server); the browser's parseJsg(xml) is in frontend/src/jsg/xml.ts. The optional
// origin hook (readJsgWith) tells the live binding which element each model object was read from (carets and comments map through it).

// the one escaper (shared/xmlEscape.ts, re-exported by lib/xml.ts: WP-16): text & < >, attributes also "; the same bytes as the copies this file had
import { escText as esc, escAttr as escA } from '../xmlEscape';
import { emptyFront, isClause, newPart, type Align, type Appendix, type Block, type Cell, type Chapter, type Clause, type Figure, type Front, type Graphic, type Inline, type JsgDoc, type List, type ListItem,
  type ListType, type Mark, type Notice, type Orientation, type Para, type Part, type PartRow, type Plate, type Row, type Section, type Table } from './model';

export class JsgParseError extends Error {}

/** What reading needs of an element: the browser's Element and @xmldom/xmldom's both have it. */
export interface JsgNode { nodeType: number; nodeValue: string | null; childNodes: ArrayLike<JsgNode> }
export interface JsgElement extends JsgNode { tagName: string; textContent: string | null; hasAttribute(name: string): boolean; getAttribute(name: string): string | null }
type Element = JsgElement;

/** Told, while reading, which element each model object came from (the live binding's map; null when nobody asks). */
let origin: ((obj: object, el: JsgElement) => void) | null = null;
const R = <T extends object>(obj: T, e: Element): T => { if (origin) origin(obj, e); return obj; };

const MARKS: Mark[] = ['b', 'i', 'u', 'sup', 'sub'];
const ALIGNS: Align[] = ['left', 'center', 'right', 'justify'];
const LISTS: ListType[] = ['alpha', 'roman', 'number', 'step', 'bullet', 'dash'];
const ORIENT: Orientation[] = ['portrait', 'landscape', 'a3-landscape'];
const META_TEXT = ['docNo', 'title', 'subtitle', 'projectName', 'atNo', 'dated', 'nsn', 'issueDate', 'equipmentLife', 'qtyUnit', 'classification', 'emblem', 'logo'];

const kids = (e: Element): Element[] => Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1);
const attr = (e: Element, n: string): string | undefined => (e.hasAttribute(n) ? e.getAttribute(n) ?? '' : undefined);
const fail = (e: Element, why: string): never => { throw new JsgParseError(`<${e.tagName}>: ${why}`); };

// ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function inline(e: Element): Inline[] {
  const out: Inline[] = [];
  for (const n of Array.from(e.childNodes)) {
    if (n.nodeType === 3) { const t = n.nodeValue ?? ''; if (t) out.push({ t: 'text', text: t }); continue; }
    if (n.nodeType !== 1) continue;
    const c = n as Element; const name = c.tagName;
    if ((MARKS as string[]).includes(name)) out.push({ t: 'mark', mark: name as Mark, children: inline(c) });
    else if (name === 'br') out.push({ t: 'br' });
    else if (name === 'xref') out.push({ t: 'xref', to: attr(c, 'to') ?? '', children: inline(c) });
    else fail(c, 'is not allowed inside text');
  }
  return out;
}

function para(e: Element): Para {
  const a = attr(e, 'align') as Align | undefined;
  if (a && !ALIGNS.includes(a)) fail(e, `unknown alignment "${a}"`);
  return R({ k: 'para', indent: Number(attr(e, 'indent') ?? 2) || 2, ...(a ? { align: a } : {}), inline: inline(e) }, e);
}

function part(e: Element): Part {
  if (e.tagName === 'text') return R({ k: 'text', inline: inline(e) }, e);
  if (e.tagName === 'para') return para(e);
  if (e.tagName === 'list') return list(e);
  if (e.tagName === 'graphic') return R({ k: 'graphic', graphic: graphic(e) }, e);
  return fail(e, 'is not allowed here');
}

function list(e: Element): List {
  const type = (attr(e, 'type') ?? 'number') as ListType;
  if (!LISTS.includes(type)) fail(e, `unknown list type "${type}"`);
  const items: ListItem[] = kids(e).map((it) => { if (it.tagName !== 'item') fail(it, 'a list holds <item> only'); return R({ parts: kids(it).map(part) }, it); });
  return R({ k: 'list', type, indent: Number(attr(e, 'indent') ?? 2) || 2, items }, e);
}

function graphic(e: Element): Graphic {
  const src = attr(e, 'src'); if (!src) fail(e, 'needs a src');
  return R({ src: src!, ...(attr(e, 'width') ? { width: attr(e, 'width') } : {}), ...(attr(e, 'height') ? { height: attr(e, 'height') } : {}), ...(attr(e, 'label') ? { label: attr(e, 'label') } : {}) }, e);
}

const PART_KEYS: Array<keyof PartRow> = ['item', 'plateRef', 'provide', 'nsn', 'designation', 'qty', 'qtySet', 'drg', 'firmPart', 'price', 'remark'];
function plate(e: Element): Plate {
  const p: Plate = R({ ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ref: attr(e, 'ref') ?? '', title: attr(e, 'title') ?? '', caption: attr(e, 'caption') ?? '', divider: attr(e, 'divider') === 'true', setColumn: attr(e, 'setColumn') === 'true', views: [] as Plate['views'] }, e);
  for (const v of kids(e)) {
    if (v.tagName !== 'view') fail(v, 'a plate holds <view> only');
    const view = R({ caption: attr(v, 'caption') ?? '', graphics: [] as Graphic[], parts: [] as PartRow[], notes: [] as Inline[][] }, v);
    for (const c of kids(v)) {
      if (c.tagName === 'graphic') view.graphics.push(graphic(c));
      else if (c.tagName === 'part') { const row = R(newPart(), c); for (const k of PART_KEYS) row[k] = attr(c, k) ?? ''; view.parts.push(row); }
      else if (c.tagName === 'note') view.notes.push(R(inline(c), c));
      else fail(c, 'is not allowed in a view');
    }
    p.views.push(view);
  }
  return p;
}

function row(e: Element): Row {
  return R({ cells: kids(e).map((c): Cell => {
    if (c.tagName !== 'cell') fail(c, 'a row holds <cell> only');
    const align = attr(c, 'align') as Align | undefined;
    return R({ ...(attr(c, 'colspan') ? { colspan: Number(attr(c, 'colspan')) } : {}), ...(attr(c, 'rowspan') ? { rowspan: Number(attr(c, 'rowspan')) } : {}), ...(align ? { align } : {}), ...(attr(c, 'bold') === 'true' ? { bold: true } : {}), parts: kids(c).map(part) }, c);
  }) }, e);
}

function table(e: Element): Table {
  const t: Table = R({ k: 'table', ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ...(attr(e, 'title') !== undefined ? { title: attr(e, 'title') } : {}), ...(attr(e, 'widths') ? { widths: attr(e, 'widths') } : {}), head: [] as Row[], body: [] as Row[] }, e);
  for (const s of kids(e)) {
    if (s.tagName === 'head') t.head = kids(s).map(row); else if (s.tagName === 'body') t.body = kids(s).map(row); else fail(s, 'a table holds <head> and <body>');
  }
  return t;
}

function notice(e: Element): Notice { return R({ k: e.tagName as Notice['k'], paras: kids(e).map((p) => { if (p.tagName !== 'para') fail(p, 'a notice holds <para> only'); return para(p); }) }, e); }

function block(e: Element): Block | null {
  switch (e.tagName) {
    case 'para': return para(e);
    case 'list': return list(e);
    case 'table': return table(e);
    case 'figure': { const f: Figure = R({ k: 'figure' as const, ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), title: attr(e, 'title') ?? '', graphics: kids(e).map(graphic) }, e); return f; }
    case 'note': case 'warning': case 'caution': return notice(e);
    case 'pageBreak': return R({ k: 'pageBreak' as const }, e);
    default: return null;
  }
}

function clause(e: Element): Clause {
  return R({ k: 'clause' as const, ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), title: attr(e, 'title') ?? '', ...(attr(e, 'orientation') && orientation(e) !== 'portrait' ? { orientation: orientation(e) } : {}), children: kids(e).map((c) => (c.tagName === 'clause' ? clause(c) : block(c) ?? fail(c, 'is not allowed in a clause'))) }, e);
}

function orientation(e: Element): Orientation {
  const o = (attr(e, 'orientation') ?? 'portrait') as Orientation;
  if (!ORIENT.includes(o)) fail(e, `unknown orientation "${o}"`);
  return o;
}

function items(e: Element): Inline[][] { return kids(e).map((i) => { if (i.tagName !== 'item') fail(i, 'holds <item> only'); return inline(i); }); }
const lines = (e: Element): string[] => kids(e).map((l) => l.textContent ?? '');

function front(e: Element | undefined): Front {
  const f = emptyFront();
  if (!e) return f;
  f.omit = (attr(e, 'omit') ?? '').split(/\s+/).filter(Boolean);
  for (const c of kids(e)) {
    switch (c.tagName) {
      case 'amendments': f.has.amendments = true; f.amendmentsMinRows = Number(attr(c, 'minRows') ?? 20); f.amendments = kids(c).map((r) => ({ no: attr(r, 'no') ?? '', page: attr(r, 'page') ?? '', para: attr(r, 'para') ?? '', required: attr(r, 'required') ?? '', authority: attr(r, 'authority') ?? '', date: attr(r, 'date') ?? '', by: attr(r, 'by') ?? '' })); break;
      case 'warning': f.has.warning = true; f.warning = items(c); break;
      case 'associated': f.has.associated = true; f.associatedIntro = attr(c, 'intro') ?? ''; f.associated = kids(c).map((r) => ({ title: attr(r, 'title') ?? '', docNo: attr(r, 'docNo') ?? '', remark: attr(r, 'remark') ?? '' })); break;
      case 'abbreviations': f.has.abbreviations = true; f.abbreviationsMinRows = Number(attr(c, 'minRows') ?? 0); f.abbreviations = kids(c).map((r) => ({ short: attr(r, 'short') ?? '', long: attr(r, 'long') ?? '' })); break;
      case 'preface': f.has.preface = true; f.preface = kids(c).map((p) => (p.tagName === 'list' ? list(p) : p.tagName === 'para' ? para(p) : fail(p, 'is not allowed in the preface'))); break;
      case 'dos': f.has.dos = true; f.dos = items(c); break;
      case 'donts': f.has.donts = true; f.donts = items(c); break;
      case 'important': f.has.important = true; f.important = items(c); break;
      case 'demolition': f.has.demolition = true; f.demolition = kids(c).map((p) => (p.tagName === 'para' ? para(p) : fail(p, 'is not allowed in the demolition notice'))); break;
      case 'firstAid': f.has.firstAid = true; f.firstAid = items(c); break;
      case 'photos': f.has.photos = true; f.photos = kids(c).map(graphic); break;
      case 'certificate': f.has.certificate = true; f.certificate = inline(c); break;
      case 'supplied': f.has.supplied = true; f.supplied = { equipment: attr(c, 'equipment') ?? '', rows: kids(c).map((r) => ({ no: attr(r, 'no') ?? '', dcan: attr(r, 'dcan') ?? '', name: attr(r, 'name') ?? '', order: attr(r, 'order') ?? '' })) }; break;
      default: fail(c, 'is not a front-matter part');
    }
  }
  return f;
}

/** Read a parsed <jsgdoc> (the document element of a browser or @xmldom/xmldom document) into the model. */
export function readJsg(root: JsgElement): JsgDoc {
  if (root.tagName !== 'jsgdoc') throw new JsgParseError(`the root is <${root.tagName}>, not <jsgdoc>: this is not a JSG document`);
  const type = attr(root, 'type');
  if (type !== 'uhb' && type !== 'ispl') throw new JsgParseError(`unknown document type "${type}"`);
  const doc: JsgDoc = { version: attr(root, 'version') ?? '1.0', type, meta: {}, supplier: [], issuedBy: [], front: emptyFront(), chapters: [], appendices: [], plates: [] };
  for (const c of kids(root)) {
    if (c.tagName === 'meta') {
      for (const m of kids(c)) {
        if (m.tagName === 'supplier') doc.supplier = lines(m); else if (m.tagName === 'issuedBy') doc.issuedBy = lines(m);
        else if (META_TEXT.includes(m.tagName)) doc.meta[m.tagName] = m.textContent ?? ''; else fail(m, 'is not a cover field');
      }
    } else if (c.tagName === 'front') doc.front = front(c);
    else if (c.tagName === 'chapter') {
      const ch: Chapter = R({ k: 'chapter' as const, ...(attr(c, 'id') ? { id: attr(c, 'id') } : {}), title: attr(c, 'title') ?? '', sections: [] as Section[] }, c);
      for (const s of kids(c)) {
        if (s.tagName !== 'section') fail(s, 'a chapter holds <section> only');
        const sec: Section = R({ k: 'section' as const, ...(attr(s, 'id') ? { id: attr(s, 'id') } : {}), title: attr(s, 'title') ?? '', orientation: orientation(s), children: kids(s).map((x) => (x.tagName === 'clause' ? clause(x) : block(x) ?? fail(x, 'is not allowed in a section'))) }, s);
        ch.sections.push(sec);
      }
      doc.chapters.push(ch);
    } else if (c.tagName === 'plates') {
      for (const p of kids(c)) { if (p.tagName !== 'plate') fail(p, 'holds <plate> only'); doc.plates.push(plate(p)); }
    } else if (c.tagName === 'appendices') {
      for (const a of kids(c)) {
        if (a.tagName !== 'appendix') fail(a, 'holds <appendix> only');
        doc.appendices.push(R({ k: 'appendix' as const, ...(attr(a, 'id') ? { id: attr(a, 'id') } : {}), label: attr(a, 'label') ?? '', title: attr(a, 'title') ?? '', orientation: orientation(a), children: kids(a).map((x) => block(x) ?? fail(x, 'is not allowed in an appendix')) }, a));
      }
    } else fail(c, 'is not allowed in a document');
  }
  return doc;
}

/** readJsg, telling `onOrigin` the element each model object was read from (the live binding's map from the model to the room's document). */
export function readJsgWith(root: JsgElement, onOrigin: (obj: object, el: JsgElement) => void): JsgDoc {
  const prev = origin; origin = onOrigin;
  try { return readJsg(root); } finally { origin = prev; }
}

// ── writing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export { esc };
const at = (name: string, v: string | number | undefined | boolean): string => (v === undefined || v === '' || v === false ? '' : ` ${name}="${escA(String(v))}"`);

export function inlineXml(inl: Inline[]): string {
  return inl.map((i) => {
    if (i.t === 'text') return esc(i.text);
    if (i.t === 'br') return '<br/>';
    if (i.t === 'xref') return `<xref to="${escA(i.to)}">${inlineXml(i.children)}</xref>`;
    return `<${i.mark}>${inlineXml(i.children)}</${i.mark}>`;
  }).join('');
}

const GRAPHIC = (g: Graphic, pad: string): string => `${pad}<graphic${at('src', g.src)}${at('width', g.width)}${at('height', g.height)}${at('label', g.label)}/>`;

function plateXml(p: Plate, pad: string): string {
  const views = p.views.map((v) => {
    const inner = [...v.graphics.map((g) => GRAPHIC(g, pad + '    ')), ...v.parts.map((r) => `${pad}    <part${PART_KEYS.map((k) => (k === 'item' || k === 'designation' ? ` ${k}="${escA(r[k])}"` : at(k, r[k]))).join('')}/>`), ...(v.notes ?? []).map((n) => `${pad}    <note>${inlineXml(n)}</note>`)].join('\n');
    return `${pad}  <view${at('caption', v.caption)}>${inner ? `\n${inner}\n${pad}  ` : ''}</view>`;
  }).join('\n');
  return `${pad}<plate${at('id', p.id)} ref="${escA(p.ref)}" title="${escA(p.title)}"${p.divider ? ' divider="true"' : ''}${p.setColumn ? ' setColumn="true"' : ''}${at('caption', p.caption)}>${views ? `\n${views}\n${pad}` : ''}</plate>`;
}

const paraXml = (p: Para, tag = 'para'): string => `<${tag}${p.indent !== 2 ? at('indent', p.indent) : ''}${at('align', p.align)}>${inlineXml(p.inline)}</${tag}>`;

function partXml(p: Part, pad: string): string {
  if (p.k === 'text') return `${pad}<text>${inlineXml(p.inline)}</text>`;
  if (p.k === 'para') return pad + paraXml(p);
  if (p.k === 'graphic') return `${pad}<graphic${at('src', p.graphic.src)}${at('width', p.graphic.width)}${at('height', p.graphic.height)}/>`;
  return listXml(p, pad);
}

function listXml(l: List, pad: string): string {
  const items = l.items.map((it) => `${pad}  <item>\n${it.parts.map((p) => partXml(p, pad + '    ')).join('\n')}\n${pad}  </item>`).join('\n');
  return `${pad}<list${l.type !== 'number' ? at('type', l.type) : ''}${l.indent !== 2 ? at('indent', l.indent) : ''}>\n${items}\n${pad}</list>`;
}

function tableXml(t: Table, pad: string): string {
  const rows = (rs: Row[], p: string): string => rs.map((r) => `${p}<row>\n${r.cells.map((c) => `${p}  <cell${at('colspan', c.colspan)}${at('rowspan', c.rowspan)}${at('align', c.align)}${c.bold ? ' bold="true"' : ''}>\n${c.parts.map((x) => partXml(x, p + '    ')).join('\n')}\n${p}  </cell>`).join('\n')}\n${p}</row>`).join('\n');
  return `${pad}<table${at('id', t.id)}${t.title !== undefined ? ` title="${escA(t.title)}"` : ''}${at('widths', t.widths)}>\n${t.head.length ? `${pad}  <head>\n${rows(t.head, pad + '    ')}\n${pad}  </head>\n` : ''}${pad}  <body>\n${rows(t.body, pad + '    ')}\n${pad}  </body>\n${pad}</table>`;
}

export function blockXml(b: Block, pad: string): string {
  switch (b.k) {
    case 'para': return pad + paraXml(b);
    case 'list': return listXml(b, pad);
    case 'table': return tableXml(b, pad);
    case 'figure': return `${pad}<figure${at('id', b.id)} title="${escA(b.title)}">\n${b.graphics.map((g) => GRAPHIC(g, pad + '  ')).join('\n')}\n${pad}</figure>`;
    case 'pageBreak': return `${pad}<pageBreak/>`;
    default: return `${pad}<${b.k}>\n${b.paras.map((p) => `${pad}  ${paraXml(p)}`).join('\n')}\n${pad}</${b.k}>`;
  }
}

function clauseXml(c: Clause, pad: string): string {
  const inner = c.children.map((x) => (isClause(x) ? clauseXml(x, pad + '  ') : blockXml(x, pad + '  '))).join('\n');
  return `${pad}<clause${at('id', c.id)} title="${escA(c.title)}"${c.orientation && c.orientation !== 'portrait' ? at('orientation', c.orientation) : ''}>${inner ? `\n${inner}\n${pad}` : ''}</clause>`;
}

const itemsXml = (name: string, it: Inline[][], pad: string): string => `${pad}<${name}>${it.length ? '\n' + it.map((i) => `${pad}  <item>${inlineXml(i)}</item>`).join('\n') + '\n' + pad : ''}</${name}>`;

function frontXml(f: Front, pad: string): string {
  const out: string[] = [];
  if (f.has.amendments) out.push(`${pad}<amendments minRows="${f.amendmentsMinRows}">${f.amendments.length ? '\n' + f.amendments.map((r) => `${pad}  <row${at('no', r.no)}${at('page', r.page)}${at('para', r.para)}${at('required', r.required)}${at('authority', r.authority)}${at('date', r.date)}${at('by', r.by)}/>`).join('\n') + '\n' + pad : ''}</amendments>`);
  if (f.has.demolition) out.push(`${pad}<demolition>${f.demolition.length ? '\n' + f.demolition.map((p) => `${pad}  ${paraXml(p)}`).join('\n') + '\n' + pad : ''}</demolition>`);
  if (f.has.firstAid) out.push(itemsXml('firstAid', f.firstAid, pad));
  if (f.has.certificate && f.certificate) out.push(`${pad}<certificate>${inlineXml(f.certificate)}</certificate>`);
  if (f.has.warning) out.push(itemsXml('warning', f.warning, pad));
  if (f.has.associated) out.push(`${pad}<associated${at('intro', f.associatedIntro)}>${f.associated.length ? '\n' + f.associated.map((r) => `${pad}  <doc title="${escA(r.title)}"${at('docNo', r.docNo)}${at('remark', r.remark)}/>`).join('\n') + '\n' + pad : ''}</associated>`);
  if (f.has.abbreviations) out.push(`${pad}<abbreviations${f.abbreviationsMinRows ? ` minRows="${f.abbreviationsMinRows}"` : ''}>${f.abbreviations.length ? '\n' + f.abbreviations.map((r) => `${pad}  <abbr short="${escA(r.short)}" long="${escA(r.long)}"/>`).join('\n') + '\n' + pad : ''}</abbreviations>`);
  if (f.has.preface) out.push(`${pad}<preface>${f.preface.length ? '\n' + f.preface.map((p) => (p.k === 'list' ? listXml(p, pad + '  ') : `${pad}  ${paraXml(p)}`)).join('\n') + '\n' + pad : ''}</preface>`);
  if (f.has.dos) out.push(itemsXml('dos', f.dos, pad));
  if (f.has.donts) out.push(itemsXml('donts', f.donts, pad));
  if (f.has.important) out.push(itemsXml('important', f.important, pad));
  if (f.has.photos) out.push(`${pad}<photos>${f.photos.length ? '\n' + f.photos.map((g) => GRAPHIC(g, pad + '  ')).join('\n') + '\n' + pad : ''}</photos>`);
  if (f.has.supplied && f.supplied) out.push(`${pad}<supplied${at('equipment', f.supplied.equipment)}>${f.supplied.rows.length ? '\n' + f.supplied.rows.map((r) => `${pad}  <row${at('no', r.no)}${at('dcan', r.dcan)}${at('name', r.name)}${at('order', r.order)}/>`).join('\n') + '\n' + pad : ''}</supplied>`);
  return out.join('\n');
}

export function serializeJsg(d: JsgDoc): string {
  // GAP-005 (WP-15): the cover fields in the order of the schema and of the server's documents (supplier and issuer after the NSN), so that
  // saving an unchanged document gives the same bytes (frontend/src/lib/roundtrip-bytes.test.ts)
  const field = (k: string): string[] => (d.meta[k] !== undefined ? [`    <${k}>${esc(d.meta[k])}</${k}>`] : []);
  const cut = META_TEXT.indexOf('issueDate');
  const l = (name: string, ls: string[]): string => `    <${name}>${ls.length ? ls.map((x) => `<line>${esc(x)}</line>`).join('') : ''}</${name}>`;
  const chapters = d.chapters.map((c) => `  <chapter${at('id', c.id)} title="${escA(c.title)}">\n${c.sections.map((s) => {
    const inner = s.children.map((x) => (isClause(x) ? clauseXml(x, '      ') : blockXml(x, '      '))).join('\n');
    return `    <section${at('id', s.id)} title="${escA(s.title)}"${s.orientation !== 'portrait' ? at('orientation', s.orientation) : ''}>${inner ? `\n${inner}\n    ` : ''}</section>`;
  }).join('\n')}\n  </chapter>`).join('\n');
  const apps = d.appendices.map((a: Appendix) => `    <appendix${at('id', a.id)} label="${escA(a.label)}" title="${escA(a.title)}"${a.orientation !== 'portrait' ? at('orientation', a.orientation) : ''}>${a.children.length ? '\n' + a.children.map((b) => blockXml(b, '      ')).join('\n') + '\n    ' : ''}</appendix>`).join('\n');
  const fx = frontXml(d.front, '    ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="${escA(d.version)}" type="${d.type}">
  <meta>
${[...META_TEXT.slice(0, cut).flatMap(field), l('supplier', d.supplier), l('issuedBy', d.issuedBy), ...META_TEXT.slice(cut).flatMap(field)].join('\n')}
  </meta>
${fx || d.front.omit.length ? `  <front${d.front.omit.length ? ` omit="${escA(d.front.omit.join(' '))}"` : ''}>${fx ? `\n${fx}\n  ` : ''}</front>\n` : ''}${chapters ? chapters + '\n' : ''}${d.type === 'ispl' ? `  <plates>${d.plates.length ? '\n' + d.plates.map((p) => plateXml(p, '    ')).join('\n') + '\n  ' : ''}</plates>\n` : ''}${d.appendices.length ? `  <appendices>\n${apps}\n  </appendices>\n` : ''}</jsgdoc>
`;
}

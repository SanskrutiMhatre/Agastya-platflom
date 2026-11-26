// JSG document XML <-> the canonical document model (the one JSS uses, services/jss/rwi/canonical.ts).
//
// JSS and JSG write the same kinds of block (paragraph, list, table, figure, note / warning / caution, page break) and the same inline marks, so a document can be carried from one to the
// other without a loss in the text itself. What differs is the frame, and every difference is returned as a finding the person converting is shown:
//   * a JSG chapter holds sections only (its text sits in a section), a JSS chapter may hold text of its own;
//   * a JSG section holds clauses (to a depth), a JSS section holds sections;
//   * a JSG appendix is a lettered block of text; JSS has no appendices (they become sections of the last chapter);
//   * JSG has an ISPL kind (plates, parts), the front pages, and notice paragraphs only; JSS has figure legends, links to outside, notices that hold lists.
// Pure: text in, text out.

import { DOMParser } from '@xmldom/xmldom';
import { esc, isSection, plain, type Align, type Block, type Chapter, type Figure, type Inline, type JssDocument, type List, type ListItem, type ListType, type Mark, type Notice, type Para, type Part, type Row, type Section, type Table } from '../jss/rwi/canonical';
import { Findings } from '../jss/rwi/report';

export interface JsgAppendix { label: string; title: string; blocks: Block[] }
export interface ParsedJsg { doc: JssDocument; appendices: JsgAppendix[]; plates: number; type: string; front: boolean }

const kids = (e: Element): Element[] => { const o: Element[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };
const attr = (e: Element, n: string): string => (e.hasAttribute(n) ? (e.getAttribute(n) ?? '') : '');
const ALIGN = new Set(['left', 'center', 'right', 'justify']);
const LIST = new Set(['alpha', 'roman', 'number', 'bullet', 'dash']);
const MARKS = new Set(['b', 'i', 'u', 'sup', 'sub']);

// ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────────

function inlineOf(e: Element): Inline[] {
  const out: Inline[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) { const s = n.nodeValue ?? ''; if (s) out.push({ t: 'text', text: s }); continue; }
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (MARKS.has(c.tagName)) out.push({ t: 'mark', mark: c.tagName as Mark, children: inlineOf(c) });
    else if (c.tagName === 'br') out.push({ t: 'br' });
    else if (c.tagName === 'xref') out.push({ t: 'xref', ...(attr(c, 'to') ? { to: attr(c, 'to') } : {}), children: inlineOf(c) });
    else out.push(...inlineOf(c));
  }
  return out;
}
const paraOf = (e: Element): Para => { const a = attr(e, 'align'); return { k: 'para', ...(ALIGN.has(a) ? { align: a as Align } : {}), inline: inlineOf(e) }; };
const listType = (e: Element): ListType | undefined => { const t = attr(e, 'type'); return t === 'step' ? 'number' : LIST.has(t) ? (t as ListType) : undefined; };

function listOf(e: Element): List {
  const items: ListItem[] = kids(e).filter((c) => c.tagName === 'item').map((it) => {
    const parts: Part[] = [];
    // an item's own text, a paragraph, or a nested list - in the order written
    let text = false;
    for (let n = it.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1) { const c = n as Element; if (c.tagName === 'para') parts.push(paraOf(c)); else if (c.tagName === 'list') parts.push(listOf(c)); else if (c.tagName === 'text') { parts.push({ k: 'inline', inline: inlineOf(c) }); text = true; } }
    }
    if (!parts.length && !text) { const inl = inlineOf(it); if (inl.length) parts.push({ k: 'inline', inline: inl }); }
    return { parts };
  });
  return { k: 'list', ...(listType(e) ? { type: listType(e) } : {}), items };
}

function rowsOf(host: Element | undefined, findings: Findings, where: string): Row[] {
  if (!host) return [];
  return kids(host).filter((r) => r.tagName === 'row').map((r) => ({
    cells: kids(r).filter((c) => c.tagName === 'cell').map((c) => {
      const parts: Part[] = [];
      for (const x of kids(c)) {
        if (x.tagName === 'para') parts.push(paraOf(x)); else if (x.tagName === 'list') parts.push(listOf(x)); else if (x.tagName === 'text') parts.push({ k: 'inline', inline: inlineOf(x) });
        else if (x.tagName === 'graphic') findings.add('warning', 'cell-picture', 'A picture inside a table cell cannot be carried to JSS and was left out.', where);
      }
      if (!parts.length) { const inl = inlineOf(c); if (inl.length) parts.push({ k: 'inline', inline: inl }); }
      const num = (n: string): number | undefined => { const v = Number(attr(c, n)); return Number.isInteger(v) && v > 1 ? v : undefined; };
      const al = attr(c, 'align');
      return { ...(num('colspan') ? { colspan: num('colspan') } : {}), ...(num('rowspan') ? { rowspan: num('rowspan') } : {}), ...(ALIGN.has(al) ? { align: al as Align } : {}), parts };
    }),
  }));
}

function blockOf(e: Element, findings: Findings, where: string): Block | null {
  switch (e.tagName) {
    case 'para': return paraOf(e);
    case 'list': return listOf(e);
    case 'pageBreak': return { k: 'pageBreak' };
    case 'table': {
      const head = kids(e).find((c) => c.tagName === 'head'); const body = kids(e).find((c) => c.tagName === 'body');
      return { k: 'table', ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ...(attr(e, 'widths') ? { widths: attr(e, 'widths') } : {}), ...(attr(e, 'title') ? { title: attr(e, 'title') } : {}), head: rowsOf(head, findings, where), body: rowsOf(body, findings, where) };
    }
    case 'figure': return { k: 'figure', ...(attr(e, 'id') ? { id: attr(e, 'id') } : {}), ...(attr(e, 'title') ? { title: attr(e, 'title') } : {}), graphics: kids(e).filter((c) => c.tagName === 'graphic').map((g) => ({ src: attr(g, 'src'), ...(attr(g, 'width') ? { width: attr(g, 'width') } : {}), ...(attr(g, 'height') ? { height: attr(g, 'height') } : {}) })), legend: [] };
    case 'note': case 'warning': case 'caution': return { k: e.tagName, blocks: kids(e).filter((c) => c.tagName === 'para').map(paraOf) } as Notice;
    default: return null;
  }
}

/** The body of a section or clause: its blocks, and its clauses as sub-sections (the clause's own title is the sub-section's heading). */
function bodyOf(e: Element, findings: Findings, where: string, depth: number): Array<Block | Section> {
  const out: Array<Block | Section> = [];
  for (const c of kids(e)) {
    if (c.tagName === 'clause') {
      const t = attr(c, 'title');
      out.push({ k: 'section', ...(attr(c, 'id') ? { id: attr(c, 'id') } : {}), title: t, ...(attr(c, 'orientation') && attr(c, 'orientation') !== 'portrait' ? { orientation: attr(c, 'orientation') } : {}), children: bodyOf(c, findings, `${where} > ${t}`, depth + 1) });
    } else { const b = blockOf(c, findings, where); if (b) out.push(b); }
  }
  return out;
}

export function parseJsg(xml: string, findings: Findings = new Findings()): ParsedJsg {
  let fatal = '';
  const dom = new DOMParser({ onError: (level: string, m: string) => { if (level === 'fatalError' && !fatal) fatal = m; } }).parseFromString(xml, 'text/xml') as unknown as Document;
  const root = dom.documentElement;
  if (fatal || !root || root.tagName !== 'jsgdoc') throw new Error(fatal || 'This is not a JSG document.');
  const meta: Record<string, string> = {};
  const m = kids(root).find((c) => c.tagName === 'meta');
  for (const c of m ? kids(m) : []) if (!kids(c).length) meta[c.tagName] = (c.textContent ?? '').trim();
  const chapters: Chapter[] = kids(root).filter((c) => c.tagName === 'chapter').map((ch, i) => ({
    k: 'chapter' as const, number: i + 1, ...(attr(ch, 'id') ? { id: attr(ch, 'id') } : {}), title: attr(ch, 'title'),
    children: kids(ch).filter((s) => s.tagName === 'section').map((s) => ({ k: 'section' as const, ...(attr(s, 'id') ? { id: attr(s, 'id') } : {}), title: attr(s, 'title'), ...(attr(s, 'orientation') && attr(s, 'orientation') !== 'portrait' ? { orientation: attr(s, 'orientation') } : {}), children: bodyOf(s, findings, `${attr(ch, 'title')} > ${attr(s, 'title')}`, 1) })),
  }));
  const apps = kids(root).find((c) => c.tagName === 'appendices');
  const appendices: JsgAppendix[] = (apps ? kids(apps).filter((c) => c.tagName === 'appendix') : []).map((a) => ({
    label: attr(a, 'label'), title: attr(a, 'title'), blocks: kids(a).map((b) => blockOf(b, findings, `Appendix ${attr(a, 'label')}`)).filter((b): b is Block => !!b),
  }));
  const plates = kids(kids(root).find((c) => c.tagName === 'plates') ?? root).filter((c) => c.tagName === 'plate').length;
  const docMeta: Record<string, string> = {};
  if (meta.docNo) docMeta.publicationNo = meta.docNo;
  if (meta.projectName) docMeta.systemName = meta.projectName;
  if (meta.nsn) docMeta.nsn = meta.nsn;
  docMeta.bookName = meta.subtitle ? meta.subtitle.replace(/^\(|\)$/g, '').trim() || 'User Handbook' : 'User Handbook';
  return { doc: { docType: attr(root, 'type'), schemaVersion: '1.0', meta: docMeta, chapters }, appendices, plates, type: attr(root, 'type'), front: kids(root).some((c) => c.tagName === 'front') };
}

// ── writing ─────────────────────────────────────────────────────────────────────────────────────────────────────

const at = (n: string, v: string | number | undefined): string => (v === undefined || v === '' ? '' : ` ${n}="${esc(String(v)).replace(/"/g, '&quot;')}"`);
const idOk = (s: string | undefined): string | undefined => (s && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s) ? s : undefined);

interface Ctx { findings: Findings; ids: Set<string>; where: string }

function inlineXml(inl: Inline[], ctx: Ctx): string {
  return inl.map((i) => {
    if (i.t === 'text') return esc(i.text);
    if (i.t === 'br') return '<br/>';
    if (i.t === 'xref') {
      if (i.to && ctx.ids.has(i.to)) return `<xref to="${esc(i.to)}">${inlineXml(i.children, ctx)}</xref>`;
      ctx.findings.add('info', 'link-dropped', `A link ${i.href ? 'to an outside address' : 'to a part of the document that is not in JSG'} was kept as plain text.`, ctx.where);
      return inlineXml(i.children, ctx);
    }
    return `<${i.mark}>${inlineXml(i.children, ctx)}</${i.mark}>`;
  }).join('');
}
const paraXml = (p: Para, ctx: Ctx, pad: string): string => `${pad}<para${at('align', p.align)}>${inlineXml(p.inline, ctx)}</para>`;

/** The words of a run of parts, whatever they are (a nested list gives its items' words). */
const partInline = (p: Part): Inline[] => (p.k === 'inline' || p.k === 'para' ? p.inline : p.items.flatMap((it) => it.parts.flatMap(partInline)));

function partsXml(parts: Part[], ctx: Ctx, pad: string): string {
  return parts.map((p) => (p.k === 'inline' ? `<text>${inlineXml(p.inline, ctx)}</text>` : p.k === 'para' ? paraXml(p, ctx, '') : `\n${listXml(p, ctx, pad)}\n${pad.slice(2)}`)).join('');
}
function listXml(l: List, ctx: Ctx, pad: string): string {
  return `${pad}<list${at('type', l.type)}>\n${l.items.map((it) => `${pad}  <item>${partsXml(it.parts, ctx, pad + "    ")}</item>`).join('\n')}\n${pad}</list>`;
}
function rowsXml(rows: Row[], ctx: Ctx, pad: string): string {
  return rows.map((r) => `${pad}<row>\n${r.cells.map((c) => `${pad}  <cell${at('colspan', c.colspan)}${at('rowspan', c.rowspan)}${at('align', c.align)}>${partsXml(c.parts, ctx, pad + "      ")}</cell>`).join('\n')}\n${pad}</row>`).join('\n');
}

function blockXml(b: Block, ctx: Ctx, pad: string): string {
  switch (b.k) {
    case 'para': return paraXml(b, ctx, pad);
    case 'list': return listXml(b, ctx, pad);
    case 'pageBreak': return `${pad}<pageBreak/>`;
    case 'table': {
      const body = b.body.length ? b.body : [{ cells: [{ parts: [] }] }];
      return `${pad}<table${at('id', idOk(b.id))}${at('title', b.title)}${at('widths', b.widths)}>\n${b.head.length ? `${pad}  <head>\n${rowsXml(b.head, ctx, pad + '    ')}\n${pad}  </head>\n` : ''}${pad}  <body>\n${rowsXml(body, ctx, pad + '    ')}\n${pad}  </body>\n${pad}</table>`;
    }
    case 'figure': {
      const f: Figure = b;
      if (f.legend.length) ctx.findings.add('info', 'figure-legend', 'A figure\'s numbered key was not carried (JSG has no place for it).', ctx.where);
      return `${pad}<figure${at('id', idOk(f.id))} title="${esc(f.title || 'Figure')}">${f.graphics.map((g) => `<graphic${at('src', g.src)}${at('width', g.width)}${at('height', g.height)}/>`).join('')}</figure>`;
    }
    default: {
      // note / warning / caution: JSG notices hold paragraphs only
      const n = b as Notice; const paras: Para[] = [];
      for (const x of n.blocks) {
        if (x.k === 'para') paras.push(x);
        else { ctx.findings.add('info', 'notice-list', 'A list inside a note, warning or caution was written as plain paragraphs.', ctx.where); for (const it of x.items) paras.push({ k: 'para', inline: it.parts.flatMap(partInline) }); }
      }
      if (!paras.length) paras.push({ k: 'para', inline: [] });
      return `${pad}<${n.k}>\n${paras.map((p) => paraXml(p, ctx, pad + '  ')).join('\n')}\n${pad}</${n.k}>`;
    }
  }
}

/** Sub-sections of a JSS section become clauses of the JSG section; the depth JSG prints is limited, so deeper headings are written as bold paragraphs. */
function clauseXml(s: Section, ctx: Ctx, pad: string, depth: number, maxDepth: number): string {
  const here = { ...ctx, where: `${ctx.where} > ${s.title}` };
  if (depth > maxDepth) {
    ctx.findings.add('warning', 'depth-flattened', `The heading "${s.title}" is deeper than JSG prints; it was written as a bold line in its parent clause.`, ctx.where);
    return [paraXml({ k: 'para', inline: [{ t: 'mark', mark: 'b', children: [{ t: 'text', text: s.title }] }] }, here, pad), ...s.children.map((c) => (isSection(c) ? clauseXml(c, here, pad, depth + 1, maxDepth) : blockXml(c, here, pad)))].join('\n');
  }
  return `${pad}<clause${at('id', idOk(s.id))} title="${esc(s.title)}"${s.orientation && s.orientation !== 'portrait' ? at('orientation', s.orientation) : ''}>\n${s.children.map((c) => (isSection(c) ? clauseXml(c, here, pad + '  ', depth + 1, maxDepth) : blockXml(c, here, pad + '  '))).join('\n')}\n${pad}</clause>`;
}

function collectIds(doc: JssDocument): Set<string> {
  const ids = new Set<string>();
  const walk = (n: Block | Section | Chapter): void => {
    const id = (n as { id?: string }).id; if (id) ids.add(id);
    if (n.k === 'section' || n.k === 'chapter') for (const c of n.children) walk(c);
  };
  for (const c of doc.chapters) walk(c);
  return ids;
}

/**
 * The chapters (and appendices) of a JSG document, as XML text, for the canonical document. A JSS chapter's own text is written as a first section named like the chapter.
 * Empty chapters are left out. Returns what goes between `</front>` and `</jsgdoc>`.
 */
export function jsgBodyXml(doc: JssDocument, appendices: JsgAppendix[], findings: Findings): string {
  const ids = collectIds(doc); const out: string[] = [];
  for (const ch of doc.chapters) {
    const own = ch.children.filter((c): c is Block => !isSection(c)); const subs = ch.children.filter(isSection);
    if (!own.length && !subs.length) { findings.add('info', 'chapter-empty', `The chapter "${ch.title}" has no text and was left out.`, ch.title); continue; }
    const ctx: Ctx = { findings, ids, where: ch.title };
    const sections: string[] = [];
    if (own.length) { findings.add('info', 'chapter-text-moved', `The text at the start of the chapter "${ch.title}" was written as a first section of the same name (a JSG chapter holds sections).`, ch.title); sections.push(`    <section title="${esc(ch.title)}">\n${own.map((b) => blockXml(b, ctx, '      ')).join('\n')}\n    </section>`); }
    for (const s of subs) {
      const sc = { ...ctx, where: `${ch.title} > ${s.title}` };
      sections.push(`    <section${at('id', idOk(s.id))} title="${esc(s.title)}"${s.orientation && s.orientation !== 'portrait' ? at('orientation', s.orientation) : ''}>\n${s.children.map((c) => (isSection(c) ? clauseXml(c, sc, '      ', 1, 4) : blockXml(c, sc, '      '))).join('\n')}\n    </section>`);
    }
    out.push(`  <chapter${at('id', idOk(ch.id))} title="${esc(ch.title)}">\n${sections.join('\n')}\n  </chapter>`);
  }
  if (appendices.length) {
    const ctx: Ctx = { findings, ids, where: 'Appendices' };
    out.push(`  <appendices>\n${appendices.map((a) => `    <appendix label="${esc(a.label)}" title="${esc(a.title)}">\n${a.blocks.map((b) => blockXml(b, { ...ctx, where: `Appendix ${a.label}` }, '      ')).join('\n')}\n    </appendix>`).join('\n')}\n  </appendices>`);
  }
  return out.join('\n');
}

/** A blank JSG document (the project's own, with its front matter) with the chapters and appendices replaced. */
export function withJsgBody(blank: string, body: string, meta: Record<string, string> = {}): string {
  let t = blank.replace(/<chapter\b[^]*?<\/chapter>[ \t]*\r?\n?/g, '').replace(/<appendices\b[^]*?<\/appendices>[ \t]*\r?\n?/g, '').replace(/<chapter\b[^>]*\/>[ \t]*\r?\n?/g, '').replace(/<appendices\b[^>]*\/>[ \t]*\r?\n?/g, '');
  const put = (tag: string, v: string | undefined): void => { if (!v) return; if (new RegExp(`<${tag}>[^<]*</${tag}>`).test(t)) t = t.replace(new RegExp(`<${tag}>[^<]*</${tag}>`), () => `<${tag}>${esc(v)}</${tag}>`); else t = t.replace('</meta>', () => `  <${tag}>${esc(v)}</${tag}>\n</meta>`); };
  put('projectName', meta.systemName); put('docNo', meta.publicationNo); put('nsn', meta.nsn);
  return t.replace('</jsgdoc>', () => `${body}\n</jsgdoc>`);
}

// Mapping a parsed RWI package into the canonical JSS model.
//
// Rules (see docs/RWI_IMPORT_EXPORT_ARCHITECTURE.md section 4/5):
//   publication entry (titled)            -> chapter   (matched, by title, to the chapters of the project's stencil)
//   document                              -> one top-level section of its chapter; its title is the first heading of its content (never the placeholder document title)
//   nested heading                        -> nested section (deeper than the stencil allows: a bold lead-in line, content kept)
//   paragraph / list / table / figure / note / warning -> the JSS block of the same name
//   a list inside a paragraph             -> a list block after the paragraph's text
//   a picture in a table cell             -> kept in the source record (a JSS cell cannot hold one)
//   anything unknown                      -> its text, and a finding
// Every repair is reported in plain words. Nothing here touches the JSS schema or the S1000D code.

import path from 'path';
import { createHash } from 'crypto';
import type { Block, Cell, Figure, Inline, List, ListItem, Notice, Para, Part, Row, Section, Table, Chapter, JssDocument } from './canonical';
import { fingerprintSection, isSection, plain } from './canonical';
import type { Findings } from './report';
import type { RwiPackage, SourceModule, SourcePicture, SourcePublication, PmEntrySource } from './source';

export interface PictureUse { entity: string; file: string | null; media: string; missing: boolean; role: 'figure' | 'symbol' }
export interface Attachment { tableId: string; group: 'thead' | 'tbody'; row: number; col: number; entity: string; media: string; xml: string }
export interface ModuleOut {
  module: SourceModule; sectionId: string; chapter: number; listed: boolean; placedBy: 'publication' | 'number'; pmTitle: string;
  pictures: PictureUse[]; attachments: Attachment[]; flattened: number; fingerprint: string; tables: Array<{ id: string; original: string }>; figures: Array<{ id: string; original: string }>;
}
export interface MapResult {
  doc: JssDocument; modules: ModuleOut[];
  chapters: Array<{ number: number; stencilTitle: string; sourceTitle: string | null; unmatched: boolean }>;
  droppedEntries: number;
  /** the keys of the chapters' own heading pages (they only introduce the chapter, so they are not sections) */
  headings: string[];
  /** the chapter (1-based) each heading page introduces */
  headingChapter: Record<string, number>;
  /** every picture file that has to be in Media: the package's own, and a placeholder for each missing one */
  mediaFiles: Array<{ media: string; from?: SourcePicture; placeholderFor?: string; used: boolean }>;
  counts: { paragraphs: number; lists: number; tables: number; figures: number; sections: number };
}

const norm = (s: string): string => s.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const squash = (s: string): string => s.replace(/\s+/g, ' ');
const kids = (e: Element): Element[] => { const o: Element[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };
const LISTS = new Set(['sequentialList', 'randomList']);
const NOTICES: Record<string, Notice['k']> = { note: 'note', warning: 'warning', danger: 'warning', caution: 'caution' };
const NOTICE_PARAS = new Set(['notePara', 'warningAndCautionPara', 'attentionSequentialList', 'attentionRandomList']);

interface Ctx { maxDepth: number; m: SourceModule; pkg: RwiPackage; findings: Findings; where: string; ids: Set<string>; prefix: string; out: ModuleOut; counts: MapResult['counts']; warned: Set<string>; iso: number }

function uniqueId(ctx: Ctx, original: string, kind: 'fig' | 'tbl'): string {
  const clean = (original || kind).replace(/[^A-Za-z0-9_.-]/g, '-');
  let id = `${ctx.prefix}-${/^[A-Za-z_]/.test(clean) ? clean : `${kind}-${clean}`}`; let n = 2;
  while (ctx.ids.has(id)) id = `${ctx.prefix}-${clean}-${n++}`;
  ctx.ids.add(id);
  return id;
}

function picture(ent: string, role: PictureUse['role'], ctx: Ctx): PictureUse {
  const declared = ctx.m.entities.get(ent);
  const candidates = [declared ? path.posix.basename(declared.replace(/\\/g, '/')) : '', `${ent}.png`, `${ent}.jpg`, `${ent}.jpeg`, `${ent}.svg`].filter(Boolean);
  for (const c of candidates) {
    const p = ctx.pkg.pictures.get(c.toLowerCase());
    if (p) { const use: PictureUse = { entity: ent, file: p.name, media: p.name, missing: false, role }; ctx.out.pictures.push(use); return use; }
  }
  const use: PictureUse = { entity: ent, file: null, media: `${ent}.png`, missing: true, role }; ctx.out.pictures.push(use);
  ctx.findings.add('warning', 'picture-missing', `A picture is missing from the package (${ent}); a marked placeholder was put in its place.`, ctx.where, `${ent}`);
  return use;
}

const warnOnce = (ctx: Ctx, code: string, message: string): void => { if (!ctx.warned.has(code)) { ctx.warned.add(code); ctx.findings.add('warning', code, message, ctx.where); } };

// ── inline text ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function inlineNode(n: Node, ctx: Ctx): Inline[] {
  if (n.nodeType === 3 || n.nodeType === 4) { const t = squash(n.nodeValue ?? ''); return t ? [{ t: 'text', text: t }] : []; }
  if (n.nodeType !== 1) return [];
  const e = n as Element; const inner = (): Inline[] => inlineChildren(e, ctx);
  switch (e.tagName) {
    case 'emphasis': { const t = e.getAttribute('emphasisType'); return [{ t: 'mark', mark: t === 'em02' ? 'i' : t === 'em03' ? 'u' : 'b', children: inner() }]; }
    case 'subScript': return [{ t: 'mark', mark: 'sub', children: inner() }];
    case 'superScript': return [{ t: 'mark', mark: 'sup', children: inner() }];
    case 'internalRef': case 'acronym': case 'acronymTerm': case 'acronymDefinition': case 'name': case 'shortName': case 'verbatimText': case 'inlineSignificantData': case 'quantity': case 'quantityValue': case 'quantityUnitOfMeasure': case 'changeInline': case 'notePara': case 'warningAndCautionPara': return inner();
    // a note, warning or caution inside a table cell or a paragraph: JSS has them only as blocks, so its words stay, led by its kind
    case 'note': case 'warning': case 'caution': case 'danger': return [{ t: 'mark', mark: 'b', children: [{ t: 'text', text: `${e.tagName === 'note' ? 'NOTE' : e.tagName === 'caution' ? 'CAUTION' : 'WARNING'}: ` }] }, ...inner()];
    // a reference to another document: its title, not its code
    case 'dmRef': { const tt = e.getElementsByTagName('techName')[0]?.textContent?.trim(); const ii = e.getElementsByTagName('infoName')[0]?.textContent?.trim(); const s = [tt, ii].filter(Boolean).join(' - '); return s ? [{ t: 'text', text: s }] : []; }
    case 'title': return [];
    default: warnOnce(ctx, `unsupported-${e.tagName}`, `The source contains an element this editor does not have ("${e.tagName}"); only its text was kept.`); return inner();
  }
}
function inlineChildren(e: Element, ctx: Ctx): Inline[] { const out: Inline[] = []; for (let n = e.firstChild; n; n = n.nextSibling) out.push(...inlineNode(n, ctx)); return out; }

/** Merge neighbouring text, trim the ends. */
function tidy(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (r.t === 'text') { if (last?.t === 'text') last.text += r.text; else out.push({ ...r }); } else out.push(r);
  }
  const first = out[0]; if (first?.t === 'text') first.text = first.text.replace(/^\s+/, '');
  const end = out[out.length - 1]; if (end?.t === 'text') end.text = end.text.replace(/\s+$/, '');
  return out.filter((r) => r.t !== 'text' || r.text !== '');
}
const hasContent = (runs: Inline[]): boolean => plain(runs).trim() !== '';

// ── blocks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A paragraph element becomes paragraphs, lists and (rarely) pictures, in the order they occur inside it. */
function paraBlocks(e: Element, ctx: Ctx, level: number, inCell = false): Block[] {
  const blocks: Block[] = []; let run: Inline[] = [];
  const flush = (): void => { const t = tidy(run); run = []; if (hasContent(t)) { blocks.push({ k: 'para', inline: t }); ctx.counts.paragraphs++; } };
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && LISTS.has((n as Element).tagName)) { flush(); blocks.push(mapList(n as Element, ctx, level)); continue; }
    if (n.nodeType === 1 && (n as Element).tagName === 'symbol') {
      flush();
      if (!inCell) { const f = symbolFigure(n as Element, ctx); if (f) blocks.push(f); }      // in a table cell the cell mapper records the symbol instead
      continue;
    }
    run.push(...inlineNode(n, ctx));
  }
  flush();
  return blocks;
}

function symbolFigure(e: Element, ctx: Ctx): Figure | null {
  const ent = (e.getAttribute('infoEntityIdent') ?? '').trim(); if (!ent) return null;
  const use = picture(ent, 'symbol', ctx); ctx.counts.figures++;
  return { k: 'figure', graphics: [{ src: `Media/${use.media}`, width: '6mm' }], legend: [] };
}

function mapList(e: Element, ctx: Ctx, level: number): List {
  ctx.counts.lists++;
  const ordered = e.tagName === 'sequentialList';
  const type: List['type'] = ordered ? (['number', 'alpha', 'roman', 'number'][level] as List['type']) : (level === 0 ? 'bullet' : 'dash');
  const items: ListItem[] = [];
  for (const li of kids(e)) {
    if (li.tagName !== 'listItem') continue;
    const parts: Part[] = []; let first = true;
    for (const c of kids(li)) {
      if (c.tagName === 'para') {
        for (const b of paraBlocks(c, ctx, level + 1)) {
          if (b.k === 'para') { if (first) parts.push({ k: 'inline', inline: b.inline }); else parts.push(b); first = false; ctx.counts.paragraphs--; }
          else if (b.k === 'list') { parts.push(b); first = false; }
        }
      } else if (LISTS.has(c.tagName)) { parts.push(mapList(c, ctx, level + 1)); first = false; }
      else { const inl = tidy(inlineNode(c, ctx)); if (hasContent(inl)) { parts.push({ k: 'inline', inline: inl }); first = false; } }
    }
    items.push({ parts });
  }
  return { k: 'list', type, items };
}

function cellParts(entry: Element, ctx: Ctx): { parts: Part[]; symbols: Element[] } {
  const parts: Part[] = []; const symbols: Element[] = []; let first = true;
  for (const c of kids(entry)) {
    if (c.tagName !== 'para') { const inl = tidy(inlineNode(c, ctx)); if (hasContent(inl)) { parts.push({ k: 'inline', inline: inl }); first = false; } continue; }
    for (const sym of kids(c).filter((x) => x.tagName === 'symbol')) symbols.push(sym);
    for (const b of paraBlocks(c, ctx, 0, true)) {
      if (b.k === 'para') { if (first) parts.push({ k: 'inline', inline: b.inline }); else parts.push(b); first = false; ctx.counts.paragraphs--; }
      else if (b.k === 'list') { parts.push(b); first = false; }
    }
  }
  return { parts, symbols };
}

function mapTable(e: Element, ctx: Ctx): Table | null {
  const tg = kids(e).find((c) => c.tagName === 'tgroup'); if (!tg) return null;
  ctx.counts.tables++;
  const original = e.getAttribute('id') ?? ''; const id = uniqueId(ctx, original, 'tbl'); ctx.out.tables.push({ id, original });
  const specs = kids(tg).filter((c) => c.tagName === 'colspec').map((c) => c.getAttribute('colname') ?? '');
  const title = squash(kids(e).find((c) => c.tagName === 'title')?.textContent ?? '').trim();
  const rowsOf = (group: Element | undefined, name: 'thead' | 'tbody'): Row[] => (group ? kids(group).filter((r) => r.tagName === 'row') : []).map((r, ri) => ({
    cells: kids(r).filter((c) => c.tagName === 'entry').map((en, ci): Cell => {
      const { parts, symbols } = cellParts(en, ctx);
      const cell: Cell = { parts };
      const a = en.getAttribute('namest'); const b = en.getAttribute('nameend');
      if (a && b && specs.includes(a) && specs.includes(b)) { const span = specs.indexOf(b) - specs.indexOf(a) + 1; if (span > 1) cell.colspan = span; }
      const more = Number(en.getAttribute('morerows') ?? 0); if (more > 0) cell.rowspan = more + 1;
      const al = en.getAttribute('align'); if (al && ['left', 'center', 'right', 'justify'].includes(al)) cell.align = al as Cell['align'];
      for (const s of symbols) {
        const ent = (s.getAttribute('infoEntityIdent') ?? '').trim(); if (!ent) continue;
        const use = picture(ent, 'symbol', ctx);
        ctx.out.attachments.push({ tableId: id, group: name, row: ri, col: ci, entity: ent, media: use.media, xml: `<symbol infoEntityIdent="${ent}"${s.getAttribute('reproductionScale') ? ` reproductionScale="${s.getAttribute('reproductionScale')}"` : ''}/>` });
        ctx.findings.add('info', 'symbol-in-cell', 'A small picture inside a table cell is kept with the document but cannot be edited here; it is put back when the project is exported.', title || ctx.where, ent);
      }
      return cell;
    }),
  }));
  const head = rowsOf(kids(tg).find((c) => c.tagName === 'thead'), 'thead'); const body = rowsOf(kids(tg).find((c) => c.tagName === 'tbody'), 'tbody');
  const widths = kids(tg).filter((c) => c.tagName === 'colspec').map((c) => c.getAttribute('colwidth') ?? '').every((w) => /^\s*\d+(\.\d+)?(mm|\*)\s*$/.test(w)) && specs.length ? kids(tg).filter((c) => c.tagName === 'colspec').map((c) => c.getAttribute('colwidth')!.trim()).join(' ') : '';
  const table: Table = { k: 'table', id, ...(widths ? { widths } : {}), ...(title ? { title } : {}), head, body: body.length ? body : [{ cells: [{ parts: [] }] }] };
  repairTable(table, ctx, title);
  return table;
}

/** The columns a row group takes up once spans are counted, and whether every row agrees; if not, pad every row to the widest. */
function widthOf(rows: Row[]): number[] {
  const occ: number[] = []; const widths: number[] = [];
  rows.forEach((r, ri) => {
    let col = 0;
    for (const c of r.cells) { while ((occ[col] ?? 0) > 0) col++; const cs = c.colspan ?? 1; const rs = c.rowspan ?? 1; for (let k = 0; k < cs; k++) occ[col + k] = rs; col += cs; }
    while ((occ[col] ?? 0) > 0) col++;
    widths[ri] = col;
    for (let k = 0; k < occ.length; k++) if ((occ[k] ?? 0) > 0) occ[k]--;
  });
  return widths;
}
function repairTable(t: Table, ctx: Ctx, title: string): void {
  const all = [...t.head, ...t.body]; const w = [...widthOf(t.head), ...widthOf(t.body)];
  const max = Math.max(1, ...w); if (w.every((x) => x === max)) return;
  let padded = 0;
  for (const group of [t.head, t.body]) {
    const gw = widthOf(group);
    group.forEach((r, i) => { for (let k = gw[i]; k < max; k++) { r.cells.push({ parts: [] }); padded++; } });
  }
  void all;
  ctx.findings.add('warning', 'table-repaired', `A table's rows did not have the same number of columns in the source; ${padded} empty cell${padded === 1 ? ' was' : 's were'} added so it can be edited and printed.`, title || ctx.where);
}

function mapFigure(e: Element, ctx: Ctx): Figure {
  ctx.counts.figures++;
  const original = e.getAttribute('id') ?? ''; const id = uniqueId(ctx, original, 'fig'); ctx.out.figures.push({ id, original });
  const title = squash(kids(e).find((c) => c.tagName === 'title')?.textContent ?? '').trim();
  const graphics: Figure['graphics'] = [];
  for (const g of kids(e).filter((c) => c.tagName === 'graphic')) {
    const ent = (g.getAttribute('infoEntityIdent') ?? '').trim(); if (!ent) continue;
    const use = picture(ent, 'figure', ctx); const gr: Figure['graphics'][number] = { src: `Media/${use.media}` };
    for (const [from, to] of [['reproductionWidth', 'width'], ['reproductionHeight', 'height']] as const) { const v = (g.getAttribute(from) ?? '').trim(); if (/^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(v)) gr[to] = v; }
    graphics.push(gr);
  }
  return { k: 'figure', id, ...(title ? { title } : {}), graphics, legend: [] };
}

function mapNotice(e: Element, ctx: Ctx): Notice {
  const blocks: Notice['blocks'] = [];
  for (const c of kids(e)) {
    if (NOTICE_PARAS.has(c.tagName) || c.tagName === 'para') for (const b of paraBlocks(c, ctx, 0)) { if (b.k === 'para' || b.k === 'list') blocks.push(b); }
    else if (LISTS.has(c.tagName)) blocks.push(mapList(c, ctx, 0));
  }
  if (!blocks.length) blocks.push({ k: 'para', inline: [] });
  return { k: NOTICES[e.tagName], blocks };
}

// ── sections ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A block that came AFTER a sub-section in the source goes to the end of the last sub-section (the JSS rule is: own content first), so reading order is kept. */
function orderFix(nodes: Array<Block | Section>, ctx: Ctx): Array<Block | Section> {
  const firstSub = nodes.findIndex(isSection); if (firstSub < 0) return nodes;
  const late = nodes.slice(firstSub).filter((n) => !isSection(n)) as Block[];
  if (!late.length) return nodes;
  const subs = nodes.filter(isSection) as Section[]; const own = nodes.slice(0, firstSub);
  let tail: Section = subs[subs.length - 1];
  for (;;) { const inner = [...tail.children].reverse().find(isSection) as Section | undefined; if (!inner) break; tail = inner; }
  tail.children.push(...late);
  ctx.findings.add('info', 'order-kept', `Some text that followed a sub-heading in the source was placed at the end of "${tail.title}" so the reading order is unchanged.`, ctx.where);
  return [...own, ...subs];
}

function lead(title: string): Para { return { k: 'para', inline: [{ t: 'mark', mark: 'b', children: [{ t: 'text', text: title }] }] }; }

function mapBody(children: Element[], depth: number, ctx: Ctx): Array<Block | Section> {
  const out: Array<Block | Section> = [];
  for (const c of children) {
    switch (c.tagName) {
      case 'title': break;
      case 'para': case 'simplePara': case 'commonInfoDescrPara': out.push(...paraBlocks(c, ctx, 0)); break;
      case 'levelledPara': {
        const title = squash(kids(c).find((x) => x.tagName === 'title')?.textContent ?? '').trim();
        const inner = kids(c).filter((x) => x.tagName !== 'title');
        if (!title) { out.push(...mapBody(inner, depth, ctx)); break; }
        if (depth > ctx.maxDepth) {
          ctx.out.flattened++;
          out.push(lead(title), ...mapBody(inner, depth, ctx).flatMap((n) => (isSection(n) ? flatten(n) : [n])));
          warnOnce(ctx, 'heading-flattened', 'Some headings were nested deeper than this handbook allows; each was turned into a bold line above its text, and nothing was removed.');
          break;
        }
        ctx.counts.sections++;
        out.push({ k: 'section', title, children: orderFix(mapBody(inner, depth + 1, ctx), ctx) });
        break;
      }
      case 'figure': out.push(mapFigure(c, ctx)); break;
      case 'table': { const t = mapTable(c, ctx); if (t) out.push(t); break; }
      case 'sequentialList': case 'randomList': out.push(mapList(c, ctx, 0)); break;
      case 'symbol': { const f = symbolFigure(c, ctx); if (f) out.push(f); break; }
      default:
        if (NOTICES[c.tagName]) { out.push(mapNotice(c, ctx)); break; }
        warnOnce(ctx, `unsupported-${c.tagName}`, `The source contains something this editor does not have ("${c.tagName}"); its text was kept.`);
        for (const b of paraBlocks(c, ctx, 0)) out.push(b);
    }
  }
  return out;
}
function flatten(s: Section): Array<Block | Section> { return [lead(s.title), ...s.children.flatMap((n) => (isSection(n) ? flatten(n) : [n]))]; }

// ── procedures, fault isolation, crew drills and parts lists ─────────────────────────────────────────────────────────────────
// What the older publishing tool maps (vendor/pipeline/s1000dtojss/schemas.xsl), carried into JSS blocks the same way: preliminary and close-up requirements are a section of tables
// (conditions, personnel, equipment, consumables, spares) and the safety notices; a titled step is a section; untitled steps are one numbered list (lettered inside, roman inside that);
// an isolation step is a section with its action, its question and its Yes / No answers; a crew drill is a section, its steps a list, its challenge / response pairs a table;
// an illustrated parts catalogue is its figures and one table (figure-item, part number, CAGE, nomenclature with indenture dots, quantity, unit).

/** The content roots (the first element of a document's content) that are mapped. Anything else keeps only its text, and is reported. */
export const MAPPED_CONTENT = new Set(['description', 'procedure', 'faultReporting', 'faultIsolation', 'crew', 'illustratedPartsCatalog']);

const STEPS = new Set(['proceduralStep', 'crewDrillStep']);
const CHALLENGES = new Set(['challengeAndResponse', 'challengeResponse']);
const WRAPPERS = new Set(['mainProcedure', 'faultIsolationProcedure', 'isolationProcedure', 'isolationMainProcedure', 'isolationStepAnswer', 'operatorInstructions', 'descrCrew', 'faultReporting', 'faultIsolation', 'crew', 'procedure']);
const LEAVES = new Set(['faultDescr', 'isolatedFaultDescr', 'correctiveActionDescr', 'symptomDescr', 'action']);
const textOf = (e: Element | undefined | null): string => squash(e?.textContent ?? '').trim();
const titleOf = (e: Element): string => textOf(kids(e).find((x) => x.tagName === 'title'));
const firstOf = (e: Element, tag: string): Element | undefined => e.getElementsByTagName(tag)[0];

function boldLead(label: string, text: string): Para { return { k: 'para', inline: [{ t: 'mark', mark: 'b', children: [{ t: 'text', text: label }] }, ...(text ? [{ t: 'text' as const, text }] : [])] }; }

function simpleTable(title: string, head: string[], rows: string[][], ctx: Ctx, widths = '', center: number[] = []): Table {
  ctx.counts.tables++;
  const id = uniqueId(ctx, '', 'tbl'); ctx.out.tables.push({ id, original: '' });
  const cell = (s: string, i: number): Cell => ({ parts: s ? [{ k: 'inline', inline: [{ t: 'text', text: s }] }] : [], ...(center.includes(i) ? { align: 'center' as const } : {}) });
  const body = rows.length ? rows : [head.map((_, i) => (i === 0 ? 'None' : ''))];
  return { k: 'table', id, ...(widths ? { widths } : {}), ...(title ? { title } : {}), head: [{ cells: head.map((h, i) => ({ parts: [{ k: 'inline', inline: [{ t: 'text', text: h }] }], ...(center.includes(i) ? { align: 'center' as const } : {}) })) }], body: body.map((r) => ({ cells: r.map(cell) })) };
}

/** A paragraph of everything an element says (its own paragraphs run together), led in bold when it has a label. Nothing when it says nothing. */
function leafPara(e: Element, ctx: Ctx, label = ''): Para | null {
  const body: Inline[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && ['para', 'simplePara'].includes((n as Element).tagName)) { if (body.length) body.push({ t: 'text', text: ' ' }); body.push(...inlineChildren(n as Element, ctx)); }
    else body.push(...inlineNode(n, ctx));
  }
  const t = tidy(body); if (!hasContent(t)) return null;
  ctx.counts.paragraphs++;
  return { k: 'para', inline: label ? [{ t: 'mark', mark: 'b', children: [{ t: 'text', text: label }] }, ...t] : t };
}

/** The tables and notices a requirements group holds, the way the older tool prints them (a table that is declared but empty prints one "None" row). */
function mapRequirements(e: Element, depth: number, ctx: Ctx, heading: string): Array<Block | Section> {
  const body: Array<Block | Section> = []; const has = (tag: string): Element | undefined => kids(e).find((c) => c.tagName === tag);
  const dur = has('productionMaintData') ? firstOf(has('productionMaintData')!, 'taskDuration') : undefined;
  const pd = dur?.getAttribute('procedureDuration') ?? ''; if (pd && pd !== '-') body.push(boldLead('Estimated task time: ', `${pd} ${dur?.getAttribute('unitOfMeasure') ?? ''}`.trim()));
  const conds = has('reqCondGroup');
  if (conds) {
    const rows = kids(conds).filter((c) => ['reqCondNoRef', 'reqCondDm', 'reqCondExternalPub'].includes(c.tagName)).map((c) => {
      const refs = [...Array.from(c.getElementsByTagName('dmRef')).map((d) => tidy(inlineNode(d, ctx)).map((r) => (r.t === 'text' ? r.text : '')).join('')), ...Array.from(c.getElementsByTagName('externalPubRef')).map((x) => textOf(firstOf(x, 'externalPubTitle') ?? firstOf(x, 'externalPubCode')))].filter(Boolean);
      return [textOf(firstOf(c, 'reqCond')), refs.join('; ') || '-'];
    });
    body.push(simpleTable('Required conditions', ['Action/Condition', 'Data module/Technical publication'], rows, ctx, '1* 70mm'));
  }
  const persons = has('reqPersons');
  if (persons) {
    const rows = Array.from(persons.getElementsByTagName('person')).map((p) => [firstOf(p, 'personCategory')?.getAttribute('personCategoryCode') ?? '', firstOf(p, 'personSkill')?.getAttribute('skillLevelCode') ?? '', `${textOf(firstOf(p, 'estimatedTime'))} ${firstOf(p, 'estimatedTime')?.getAttribute('unitOfMeasure') ?? ''}`.trim()]);
    body.push(simpleTable('Required personnel', ['Category', 'Skill level', 'Estimated time'], rows, ctx, '1* 30mm 32mm'));
  }
  for (const [tag, label, item] of [['reqSupportEquips', 'Support equipment', 'supportEquipDescr'], ['reqSupplies', 'Consumables, materials and expendables', 'supplyDescr'], ['reqSpares', 'Spares', 'spareDescr']] as const) {
    const g = has(tag); if (!g) continue;
    const rows = Array.from(g.getElementsByTagName(item)).map((d) => {
      const ident = firstOf(d, 'identNumber'); const id = ident ? `${textOf(firstOf(ident, 'manufacturerCode'))} ${textOf(firstOf(ident, 'partNumber'))}`.trim() : '';
      const q = firstOf(d, 'reqQuantity'); const unit = q?.getAttribute('unitOfMeasure') ?? '';
      return [textOf(firstOf(d, 'name') ?? firstOf(d, 'descrForPart')), id || '-', `${textOf(q)}${unit && unit !== 'EA' ? ` ${unit}` : ''}`.trim(), textOf(firstOf(d, 'remarks'))];
    });
    body.push(simpleTable(label, ['Name', 'Identification', 'Quantity', 'Remark'], rows, ctx, '1* 45mm 22mm 28mm'));
  }
  const safety = has('reqSafety');
  if (safety) {
    body.push(boldLead('Safety conditions', ''));
    const notes = [...Array.from(safety.getElementsByTagName('warning')), ...Array.from(safety.getElementsByTagName('caution'))];
    if (notes.length) for (const n of notes) body.push(mapNotice(n, ctx)); else { ctx.counts.paragraphs++; body.push({ k: 'para', inline: [{ t: 'text', text: 'None' }] }); }
  }
  if (!body.length) return [];
  if (depth > ctx.maxDepth) { ctx.out.flattened++; warnOnce(ctx, 'heading-flattened', 'Some headings were nested deeper than this handbook allows; each was turned into a bold line above its text, and nothing was removed.'); return [lead(heading), ...body]; }
  ctx.counts.sections++;
  return [{ k: 'section', title: heading, children: body }];
}

/** A titled part of a procedure: a section, or - too deep for the handbook - a bold line above its content. */
function sectionOf(title: string, inner: Element[], depth: number, ctx: Ctx, level: number): Array<Block | Section> {
  if (depth > ctx.maxDepth) {
    ctx.out.flattened++; warnOnce(ctx, 'heading-flattened', 'Some headings were nested deeper than this handbook allows; each was turned into a bold line above its text, and nothing was removed.');
    return [lead(title), ...mapContainer(inner, depth, ctx, level).flatMap((n) => (isSection(n) ? flatten(n) : [n]))];
  }
  ctx.counts.sections++;
  return [{ k: 'section', title, children: orderFix(mapContainer(inner, depth + 1, ctx, level), ctx) }];
}

/** A run of sibling steps: titled procedural steps are sections, the rest one numbered list (it ends where a picture or table stands between steps; a notice stays inside its step). */
function mapSteps(steps: Element[], depth: number, ctx: Ctx, level: number): Array<Block | Section> {
  const out: Array<Block | Section> = []; let list: List | null = null; let split = false;
  const newList = (): List => { ctx.counts.lists++; const l: List = { k: 'list', type: (['number', 'alpha', 'roman'][Math.min(level, 2)]) as List['type'], items: [] }; out.push(l); return l; };
  for (const s of steps) {
    const title = titleOf(s);
    if (title && s.tagName === 'proceduralStep') { list = null; out.push(...sectionOf(title, kids(s).filter((x) => x.tagName !== 'title'), depth, ctx, level)); continue; }
    const before: Array<Block | Section> = []; const after: Array<Block | Section> = []; const parts: Part[] = []; const nested: Element[] = []; let first = true; let sawText = false;
    const addText = (inl: Inline[]): void => { if (!hasContent(inl)) return; parts.push(first ? { k: 'inline', inline: inl } : { k: 'para', inline: inl }); first = false; sawText = true; };
    if (title) addText([{ t: 'mark', mark: 'b', children: [{ t: 'text', text: title }] }]);
    for (const c of kids(s)) {
      if (c.tagName === 'title') continue;
      if (c.tagName === 'para' || c.tagName === 'simplePara') {
        for (const b of paraBlocks(c, ctx, level + 1)) {
          if (b.k === 'para') { addText(b.inline); ctx.counts.paragraphs--; }
          else if (b.k === 'list') { parts.push(b); first = false; sawText = true; } else after.push(b);
        }
      } else if (STEPS.has(c.tagName)) nested.push(c);
      else if (LISTS.has(c.tagName)) { parts.push(mapList(c, ctx, level + 1)); first = false; sawText = true; }
      else if (NOTICES[c.tagName]) addText(tidy(inlineNode(c, ctx)));
      else (sawText || nested.length ? after : before).push(...mapContainer([c], depth, ctx, level));
    }
    if (nested.length) for (const b of mapSteps(nested, depth, ctx, level + 1)) { if (b.k === 'list') { parts.push(b); first = false; } else after.push(b); }
    if (before.length) { list = null; out.push(...before); split = true; }
    if (!list) list = newList();
    list.items.push({ parts: parts.length ? parts : [{ k: 'inline', inline: [] }] });
    if (after.length) { out.push(...after); list = null; split = true; }
  }
  if (split) warnOnce(ctx, 'steps-split', 'A picture or table between steps ends the numbered list: a list in this editor cannot hold one. The steps after it are a new list that begins again at 1.');
  return out;
}

/** The content of a procedure, a fault isolation, a crew document: its parts in the order they stand. */
function mapContainer(children: Element[], depth: number, ctx: Ctx, level = 0): Array<Block | Section> {
  const out: Array<Block | Section> = []; let i = 0;
  const run = (set: Set<string>): Element[] => { const r: Element[] = []; while (i < children.length && set.has(children[i].tagName)) r.push(children[i++]); return r; };
  while (i < children.length) {
    const c = children[i];
    if (STEPS.has(c.tagName)) { out.push(...mapSteps(run(STEPS), depth, ctx, level)); continue; }
    if (CHALLENGES.has(c.tagName)) {
      const rows = run(CHALLENGES).map((e) => [textOf(firstOf(e, 'challenge')), textOf(firstOf(e, 'response'))]);
      out.push(simpleTable('', ['Challenge', 'Response'], rows, ctx, '1* 1*')); continue;
    }
    i++;
    const inner = kids(c).filter((x) => x.tagName !== 'title');
    switch (c.tagName) {
      case 'title': break;
      case 'preliminaryRqmts': out.push(...mapRequirements(c, depth, ctx, 'Preliminary Requirements')); break;
      case 'closeRqmts': out.push(...mapRequirements(c, depth, ctx, 'Requirements After Job Completion')); break;
      case 'crewDrill': case 'subCrewDrill': out.push(...sectionOf(titleOf(c) || textOf(kids(c).find((x) => x.tagName === 'crewProcedureName')) || 'Crew Drill', inner.filter((x) => x.tagName !== 'crewProcedureName'), depth, ctx, level)); break;
      case 'crewRefCard': out.push(...sectionOf(titleOf(c) || 'Quick Reference Card', inner, depth, ctx, level)); break;
      case 'isolationStep': out.push(...sectionOf(titleOf(c) || `Isolation Step ${++ctx.iso}`, inner, depth, ctx, level)); break;
      case 'isolationProcedureEnd': out.push(...sectionOf(titleOf(c) || 'Isolation procedure end', inner, depth, ctx, level)); break;
      case 'isolationStepQuestion': { const p = leafPara(c, ctx, 'Question: '); if (p) out.push(p); break; }
      case 'yesAnswer': { const p = leafPara(c, ctx, 'Yes: '); if (p) out.push(p); break; }
      case 'noAnswer': { const p = leafPara(c, ctx, 'No: '); if (p) out.push(p); break; }
      case 'listOfChoices': {
        const items = kids(c).filter((x) => x.tagName === 'choice').map((x): ListItem => ({ parts: [{ k: 'inline', inline: leafPara(x, ctx)?.inline ?? [] }] })).filter((x) => x.parts.some((p) => p.k === 'inline' && hasContent(p.inline)));
        if (items.length) { ctx.counts.lists++; out.push({ k: 'list', type: 'bullet', items }); }
        break;
      }
      default:
        if (WRAPPERS.has(c.tagName)) out.push(...mapContainer(inner, depth, ctx, level));
        else if (LEAVES.has(c.tagName)) { const p = leafPara(c, ctx); if (p) out.push(p); }
        else out.push(...mapBody([c], depth, ctx));
    }
  }
  return out;
}

/** An illustrated parts catalogue: its figures, then one table of its parts, the way the older tool prints it. */
function mapCatalog(top: Element, ctx: Ctx): Array<Block | Section> {
  const out: Array<Block | Section> = mapBody(kids(top).filter((c) => c.tagName === 'figure'), 3, ctx);
  const rows: string[][] = [];
  for (const s of kids(top).filter((c) => c.tagName === 'catalogSeqNumber')) {
    const fig = s.getAttribute('figureNumber') ?? ''; const item = s.getAttribute('item') ?? ''; const n = Number(s.getAttribute('indenture'));
    const dots = n > 1 ? '. '.repeat(n - 1) : '';
    for (const it of kids(s).filter((c) => c.tagName === 'itemSeqNumber')) {
      const t = (tag: string): string => textOf(firstOf(it, tag));
      rows.push([fig || item ? `${fig}-${item}` : '', t('partNumber'), t('manufacturerCode'), dots + t('descrForPart'), t('quantityPerNextHigherAssy'), t('unitOfIssue')]);
    }
  }
  if (rows.length) out.push(simpleTable('Illustrated Parts List', ['Fig. Item', 'Part Number', 'CAGE', 'Nomenclature', 'Qty', 'Unit'], rows, ctx, '18mm 22mm 32mm 1* 18mm 14mm', [0, 4, 5]));
  return out;
}

/** One document -> its section. */
function mapModule(m: SourceModule, out: ModuleOut, pkg: RwiPackage, findings: Findings, ids: Set<string>, counts: MapResult['counts'], title: string, maxDepth: number): Section {
  const ctx: Ctx = { maxDepth, m, pkg, findings, where: m.heading || title || m.file, ids, prefix: `dm${m.code.disassyCode ?? ''}${m.code.disassyCodeVariant ?? ''}`.replace(/[^A-Za-z0-9]/g, '') || 'dm', out, counts, warned: new Set(), iso: 0 };
  const top = kids(m.content).find((c) => c.tagName === 'description') ?? kids(m.content)[0];
  const parts = top ? kids(top) : [];
  const levelled = parts.filter((c) => c.tagName === 'levelledPara');
  let section: Section;
  if (top && top.tagName !== 'description' && MAPPED_CONTENT.has(top.tagName)) {
    // a procedure, a fault isolation, a crew document or a parts catalogue: its parts in order, named by the document's own title (it has no first heading)
    const name = m.heading || title || [m.techName, m.infoName].filter(Boolean).join(' - ') || m.file;
    section = { k: 'section', title: name, children: orderFix(top.tagName === 'illustratedPartsCatalog' ? mapCatalog(top, ctx) : mapContainer(parts, 3, ctx), ctx) };
    findings.add('info', 'content-mapped', `A ${top.tagName} document was written as sections, numbered lists and tables; links, applicability and other S1000D-only details are not carried (the original stays with the package).`, name);
  } else if (levelled.length === 1 && kids(levelled[0]).some((c) => c.tagName === 'title')) {
    const lp = levelled[0]; const rest = parts.filter((c) => c !== lp);
    const own = mapBody(kids(lp).filter((c) => c.tagName !== 'title'), 3, ctx);
    const after = mapBody(rest, 3, ctx);
    section = { k: 'section', title: squash(kids(lp).find((c) => c.tagName === 'title')?.textContent ?? '').trim() || title || m.file, children: orderFix([...own, ...after], ctx) };
  } else {
    // no single heading: the document's own title names the section, its content follows
    section = { k: 'section', title: m.heading || title || m.file, children: orderFix(mapBody(parts, 3, ctx), ctx) };
    if (levelled.length > 1) findings.add('info', 'several-headings', 'A document had several top-level headings; they were kept as sub-sections of one section.', section.title);
  }
  counts.sections++;
  return section;
}

// ── the whole package ────────────────────────────────────────────────────────────────────────────────────────────────────────

const collectRefs = (e: PmEntrySource, into: string[]): void => { for (const o of e.order) { if ('ref' in o) into.push(o.ref.key); else collectRefs(o.entry, into); } };
const anyRef = (e: PmEntrySource): boolean => e.refs.length > 0 || e.children.some(anyRef);
const isNumber = (s: string | null): boolean => !!s && /^[ \t]*[0-9]{1,3}[ \t]*$/.test(s);
function walkEntries(entries: PmEntrySource[], parent: PmEntrySource | null, into: Array<{ entry: PmEntrySource; parent: PmEntrySource | null }>): void { for (const e of entries) { into.push({ entry: e, parent }); walkEntries(e.children, e, into); } }

/** `maxDepth`: the deepest heading level the project's stencil allows (the chapter is level 1). */
export function mapPackage(pkg: RwiPackage, modules: SourceModule[], pub: SourcePublication, chapterTitles: string[], findings: Findings, maxDepth: number): MapResult {
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const bodyKeys = new Set(modules.map((m) => m.key));            // front-matter pages and chapter heading pages are not in this list (they are read elsewhere); a reference to one is skipped
  const counts = { paragraphs: 0, lists: 0, tables: 0, figures: 0, sections: 0 };
  // 1. which publication entry is which chapter. The entry may be anywhere in the contents list (a publication-titled entry and a "Chapter" folder around the chapters is the
  //    older publishing tool's layout), and a folder named by a number ("1", "3") around it holds the chapter's documents, the titled entry holding only its heading page.
  const taken = new Set<PmEntrySource>(); const chapters: MapResult['chapters'] = []; const keysByChapter: string[][] = chapterTitles.map(() => []); const assigned = new Set<string>();
  const all: Array<{ entry: PmEntrySource; parent: PmEntrySource | null }> = []; walkEntries(pub.entries, null, all);
  const headingChapter: Record<string, number> = {};
  const headingKeys = new Set<string>();                           // a chapter's heading page ("Chapter 1 - ...", the page that only introduces the chapter): not a section
  const bodyOf = (e: PmEntrySource, heading: PmEntrySource | null = null): string[] => { const k: string[] = []; collectRefs(e, k); const h: string[] = []; if (heading && heading !== e) collectRefs(heading, h); return k.filter((x) => bodyKeys.has(x) && !assigned.has(x) && !h.includes(x)); };
  const scopes: PmEntrySource[] = [];
  chapterTitles.forEach((t, i) => {
    let scope: PmEntrySource | null = null; let hit: PmEntrySource | null = null;
    for (const { entry, parent } of all) {
      if (!entry.title || norm(entry.title) !== norm(t) || taken.has(entry)) continue;
      const s = parent && isNumber(parent.title) && !taken.has(parent) ? parent : entry;
      if (bodyOf(s, entry).length) { scope = s; hit = entry; break; }
    }
    chapters.push({ number: i + 1, stencilTitle: t, sourceTitle: hit?.title ?? null, unmatched: !hit });
    if (hit && scope) {
      taken.add(hit); taken.add(scope); scopes.push(scope); const keys = bodyOf(scope, hit); keysByChapter[i].push(...keys); keys.forEach((k) => assigned.add(k));
      if (scope !== hit) { const h: string[] = []; collectRefs(hit, h); h.filter((k) => bodyKeys.has(k)).forEach((k) => { headingKeys.add(k); headingChapter[k] = i + 1; }); }
    }
    else findings.add('warning', 'chapter-absent', `The package has no chapter called "${t}"; the chapter was left empty.`, t);
  });
  let dropped = 0;
  // documents under headings that are not one of this handbook's chapters go to the last chapter, said so (a heading that holds only front-matter pages is not a chapter and not a problem)
  const leftover = (e: PmEntrySource, heading: string | null): void => {
    if (taken.has(e)) return;
    const own = e.refs.map((r) => r.key).filter((k) => bodyKeys.has(k) && !assigned.has(k)); const title = e.title ?? heading;
    if (own.length) {
      keysByChapter[keysByChapter.length - 1].push(...own); own.forEach((k) => assigned.add(k));
      findings.add('warning', 'chapter-unknown', `The package has a heading "${title ?? '(untitled)'}" that is not a chapter of this handbook; its ${own.length} section${own.length === 1 ? '' : 's'} were added to the last chapter.`, title ?? undefined);
    }
    for (const c of e.children) leftover(c, title);
    if (!anyRef(e) && !e.children.length) { dropped++; findings.add('warning', 'entry-dropped', `An empty heading${e.title ? ` "${e.title}"` : ''} in the package's contents list was left out.`, e.title ?? undefined); }
  };
  for (const e of pub.entries) leftover(e, null);
  // a titled heading INSIDE a chapter that groups documents has no counterpart in JSS (a section needs content): its documents are listed directly, said so
  const chapterNames = new Set(chapterTitles.map(norm));
  const groupings = (es: PmEntrySource[]): void => { for (const e of es) { if (e.title && !isNumber(e.title) && !chapterNames.has(norm(e.title)) && bodyOf2(e)) findings.add('info', 'grouping-flattened', `The package groups some sections under the heading "${e.title}"; the sections were kept in order without that extra level.`, e.title); groupings(e.children); } };
  const bodyOf2 = (e: PmEntrySource): boolean => { const k: string[] = []; collectRefs(e, k); return k.some((x) => bodyKeys.has(x)); };
  for (const s of scopes) groupings(s.children);
  // 2. documents the contents list does not name: placed by their number
  const listed = new Set(keysByChapter.flat());
  const placedByNumber = new Set<string>();
  const sorted = [...modules].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  for (const m of sorted) {
    if (listed.has(m.key) || headingKeys.has(m.key)) continue;
    let prev: SourceModule | undefined; for (const o of sorted) { if (o === m) break; if (listed.has(o.key) || placedByNumber.has(o.key)) prev = o; }
    let ci = -1; let pos = 0;
    const lookFor = prev ?? sorted.find((o) => o !== m && listed.has(o.key));
    if (lookFor) for (let i = 0; i < keysByChapter.length; i++) { const at = keysByChapter[i].indexOf(lookFor.key); if (at >= 0) { ci = i; pos = prev ? at + 1 : at; break; } }
    if (ci < 0) { ci = keysByChapter.length - 1; pos = keysByChapter[ci].length; }
    keysByChapter[ci].splice(pos, 0, m.key); placedByNumber.add(m.key);
    findings.add('warning', 'placed-by-number', `"${m.heading || m.file}" was not in the package's contents list; it was placed in "${chapterTitles[ci]}" after the section with the next lower number. Move it if it belongs elsewhere.`, m.heading || m.file);
  }
  // 3. build the chapters
  const ids = new Set<string>(); const outModules: ModuleOut[] = [];
  const pmTitleOf = new Map<string, string>(); const walk = (es: PmEntrySource[]): void => { for (const e of es) { for (const r of e.refs) pmTitleOf.set(r.key, r.techName); walk(e.children); } }; walk(pub.entries);
  const docChapters: Chapter[] = chapterTitles.map((title, i) => {
    const children: Array<Block | Section> = [];
    for (const key of keysByChapter[i]) {
      const m = byKey.get(key); if (!m) continue;
      const out: ModuleOut = { module: m, sectionId: '', chapter: i + 1, listed: !placedByNumber.has(key), placedBy: placedByNumber.has(key) ? 'number' : 'publication', pmTitle: pmTitleOf.get(key) ?? '', pictures: [], attachments: [], flattened: 0, fingerprint: '', tables: [], figures: [] };
      const sec = mapModule(m, out, pkg, findings, ids, counts, out.pmTitle, maxDepth);
      sec.id = `dm-${m.key}`.replace(/[^A-Za-z0-9_.-]/g, '-'); ids.add(sec.id); out.sectionId = sec.id; out.fingerprint = createHash('sha256').update(fingerprintSection(sec)).digest('hex');
      children.push(sec); outModules.push(out);
    }
    return { k: 'chapter', number: i + 1, title, children };
  });
  // 4. which package pictures are used
  const usedNames = new Set<string>(); const mediaFiles: MapResult['mediaFiles'] = []; const placeholders = new Set<string>();
  for (const o of outModules) for (const p of o.pictures) { if (p.missing) { if (!placeholders.has(p.media)) { placeholders.add(p.media); mediaFiles.push({ media: p.media, placeholderFor: p.entity, used: true }); } } else usedNames.add(p.media.toLowerCase()); }
  for (const p of pkg.pictures.values()) mediaFiles.push({ media: p.name, from: p, used: usedNames.has(p.name.toLowerCase()) });
  for (const p of pkg.pictures.values()) if (!usedNames.has(p.name.toLowerCase())) findings.add('info', 'picture-unused', `The picture "${p.name}" is in the package but no section uses it; it was kept in the project's pictures.`, p.name);
  const meta: Record<string, string> = { bookName: 'User Handbook' };
  return { doc: { docType: 'uhb', schemaVersion: '1.0', meta, chapters: docChapters }, modules: outModules, chapters, droppedEntries: dropped, headings: [...headingKeys], headingChapter, mediaFiles, counts };
}

// Import a Word document (.docx) written in the JSG User Handbook format into a <jsgdoc>.
//
// The JSG stencil is a set of Word styles: "Section" (a chapter's divider), "Heading1" (a SECTION), "Heading2".."Heading-5" (the numbered clauses 1.1 .. 1.1.1.1.1), the L2..L5 paragraph
// levels, lettered / roman / "Step n)" lists, "Caption" for figures and tables. This reads those styles (never the Word look: the JSG engine sets the look), the cover, and each
// ancillary page by its title (CERTIFICATE, ASSOCIATED HANDBOOKS, AMENDMENTS, WARNING ...). Pictures are copied to the project's Media folder.
//
// What it does not read, and says so in the report: text boxes, shapes, equations, comments, tracked changes (the text as it stands is read), pictures in formats FOP cannot print (EMF, WMF).

import fs from 'fs';
import path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { ZipFileReader } from '../zipio';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PRINTABLE = /\.(png|jpe?g|gif|bmp|svg|tiff?)$/i;

// ── inline text ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Mark = 'b' | 'i' | 'u' | 'sup' | 'sub';
export type Inline = { t: 'text'; text: string } | { t: 'mark'; mark: Mark; children: Inline[] } | { t: 'br' };
const MARK_ORDER: Mark[] = ['b', 'i', 'u', 'sup', 'sub'];

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escA = (s: string): string => esc(s).replace(/"/g, '&quot;');

export const inlineXml = (runs: Inline[]): string => runs.map((r) => (r.t === 'text' ? esc(r.text) : r.t === 'br' ? '<br/>' : `<${r.mark}>${inlineXml(r.children)}</${r.mark}>`)).join('');
export const plain = (runs: Inline[]): string => runs.map((r) => (r.t === 'text' ? r.text : r.t === 'br' ? ' ' : plain(r.children))).join('');
export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Merge neighbouring runs that carry the same mark, so "<b>a</b><b>b</b>" becomes "<b>ab</b>". */
function normalise(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (r.t === 'text') { if (!r.text) continue; if (last?.t === 'text') last.text += r.text; else out.push({ ...r }); }
    else if (r.t === 'mark') { const kids = normalise(r.children); if (!kids.length) continue; if (last?.t === 'mark' && last.mark === r.mark) last.children = normalise([...last.children, ...kids]); else out.push({ t: 'mark', mark: r.mark, children: kids }); }
    else out.push(r);
  }
  return out;
}
/** Trim the whitespace at both ends of a run list (Word keeps trailing spaces and line breaks the JSG text does not need). */
export function trimInline(runs: Inline[]): Inline[] {
  const r = normalise(runs);
  const trim = (list: Inline[], front: boolean): void => {
    while (list.length) {
      const x = front ? list[0] : list[list.length - 1];
      if (x.t === 'br') { front ? list.shift() : list.pop(); continue; }
      if (x.t === 'text') { x.text = front ? x.text.replace(/^\s+/, '') : x.text.replace(/\s+$/, ''); if (!x.text) { front ? list.shift() : list.pop(); continue; } return; }
      trim(x.children, front); if (!x.children.length) { front ? list.shift() : list.pop(); continue; } return;
    }
  };
  trim(r, true); trim(r, false);
  return r;
}

// ── reading the Word XML ────────────────────────────────────────────────────────────────────────────────────────────────────────

type El = Element;
const els = (l: unknown): El[] => Array.from(l as ArrayLike<El>);
export const kids = (e: El): El[] => { const out: El[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El); return out; };
const child = (e: El, name: string): El | undefined => kids(e).find((k) => k.localName === name);
const wattr = (e: El | undefined, name: string): string | undefined => { if (!e) return undefined; const v = e.getAttributeNS(W, name) || e.getAttribute(`w:${name}`); return v === '' || v == null ? undefined : v; };

export interface Picture { src: string; widthMm?: number }
export interface Para {
  k: 'p'; style: string; jc?: string; left: number; numId?: string; ilvl?: number;
  inline: Inline[]; pictures: Picture[]; text: string; pageBreak: boolean; sect?: 'portrait' | 'landscape' | 'a3-landscape';
  color?: string; size?: number; bold: boolean; underline: boolean; empty: boolean;
}
export interface Cell { span: number; vmerge?: 'restart' | 'continue'; paras: Para[]; jc?: string }
export interface Tbl { k: 't'; rows: Array<{ header: boolean; cells: Cell[] }>; grid: number[] }
export type Token = Para | Tbl;

export interface ImportReport {
  chapters: number; sections: number; clauses: number; paragraphs: number; lists: number; tables: number; figures: number; pictures: number;
  frontPages: string[]; skipped: string[]; warnings: string[];
}
export interface ImportResult { xml: string; media: string[]; report: ImportReport }

export class Reader {
  rels = new Map<string, string>();
  numFmt = new Map<string, string>();             // numId -> "decimal" | "lowerLetter" | "lowerRoman" | "bullet" ... (level 0)
  warnings: string[] = [];
  constructor(private readonly zip: ZipFileReader) {}

  async entry(name: string): Promise<Buffer | null> {
    const e = this.zip.entries.find((x) => x.name === name); if (!e) return null;
    return new Promise((resolve, reject) => { const parts: Buffer[] = []; this.zip.open(e).on('data', (d: Buffer) => parts.push(d)).on('end', () => resolve(Buffer.concat(parts))).on('error', reject); });
  }
  parse(buf: Buffer): any { return new DOMParser({ onError: () => undefined } as never).parseFromString(buf.toString('utf8'), 'text/xml'); }

  async loadRelationships(): Promise<void> {
    const b = await this.entry('word/_rels/document.xml.rels'); if (!b) return;
    for (const r of els(this.parse(b).getElementsByTagName('Relationship'))) { const id = r.getAttribute('Id'); const t = r.getAttribute('Target'); if (id && t) this.rels.set(id, t.replace(/^\/?(word\/)?/, '')); }
  }
  async loadNumbering(): Promise<void> {
    const b = await this.entry('word/numbering.xml'); if (!b) return;
    const doc = this.parse(b); const abstract = new Map<string, string>();
    for (const a of els(doc.getElementsByTagNameNS(W, 'abstractNum'))) {
      const lvl = kids(a).find((k) => k.localName === 'lvl' && (wattr(k, 'ilvl') ?? '0') === '0'); const f = wattr(lvl && child(lvl, 'numFmt'), 'val'); if (f) abstract.set(wattr(a, 'abstractNumId') ?? '', f);
    }
    for (const n of els(doc.getElementsByTagNameNS(W, 'num'))) { const id = wattr(n, 'numId'); const abs = wattr(child(n, 'abstractNumId'), 'val'); if (id && abs && abstract.has(abs)) this.numFmt.set(id, abstract.get(abs) as string); }
  }

  /** The text and marks of a run list, and the pictures in it. */
  runs(p: El, into: { inline: Inline[]; pictures: Picture[]; pageBreak: boolean; instr: { depth: number; skipping: boolean } }): void {
    for (const c of kids(p)) {
      const n = c.localName;
      if (n === 'r') this.run(c, into);
      else if (n === 'hyperlink' || n === 'ins' || n === 'smartTag' || n === 'sdt' || n === 'sdtContent' || n === 'fldSimple') this.runs(c, into);
    }
  }
  private run(r: El, into: { inline: Inline[]; pictures: Picture[]; pageBreak: boolean; instr: { depth: number; skipping: boolean } }): void {
    const rpr = child(r, 'rPr'); const marks = new Set<Mark>();
    if (rpr) {
      const on = (name: string): boolean => { const e = child(rpr, name); return !!e && !['0', 'false', 'off', 'none'].includes((wattr(e, 'val') ?? '1').toLowerCase()); };
      if (on('b')) marks.add('b'); if (on('i')) marks.add('i');
      const u = child(rpr, 'u'); if (u && (wattr(u, 'val') ?? 'single') !== 'none') marks.add('u');
      const va = wattr(child(rpr, 'vertAlign'), 'val'); if (va === 'superscript') marks.add('sup'); else if (va === 'subscript') marks.add('sub');
    }
    const wrap = (inner: Inline): Inline => { let x = inner; for (const m of [...MARK_ORDER].reverse()) if (marks.has(m)) x = { t: 'mark', mark: m, children: [x] }; return x; };
    for (const c of kids(r)) {
      const n = c.localName;
      if (n === 'fldChar') {
        const t = wattr(c, 'fldCharType');
        if (t === 'begin') { into.instr.depth++; into.instr.skipping = true; } else if (t === 'separate') into.instr.skipping = false; else if (t === 'end') { into.instr.depth = Math.max(0, into.instr.depth - 1); into.instr.skipping = false; }
        continue;
      }
      if (n === 'instrText') continue;
      if (into.instr.skipping) continue;
      if (n === 't') into.inline.push(wrap({ t: 'text', text: c.textContent ?? '' }));
      else if (n === 'tab') into.inline.push({ t: 'text', text: ' ' });
      else if (n === 'noBreakHyphen') into.inline.push({ t: 'text', text: '-' });
      else if (n === 'br' || n === 'cr') { if (wattr(c, 'type') === 'page') into.pageBreak = true; else into.inline.push({ t: 'br' }); }
      else if (n === 'drawing' || n === 'pict' || n === 'object') this.pictures(c, into.pictures);
    }
  }
  private pictures(d: El, out: Picture[]): void {
    const blips = els(d.getElementsByTagNameNS(A, 'blip')); const vml = els(d.getElementsByTagName('v:imagedata'));
    const ext = d.getElementsByTagNameNS(WP, 'extent')[0]; const cx = ext ? Number(ext.getAttribute('cx')) : 0;
    for (const b of blips) { const id = b.getAttributeNS(R, 'embed') || b.getAttribute('r:embed'); const t = id ? this.rels.get(id) : undefined; if (t) out.push({ src: t, ...(cx ? { widthMm: cx / 36000 } : {}) }); }
    for (const v of vml) { const id = v.getAttributeNS(R, 'id') || v.getAttribute('r:id'); const t = id ? this.rels.get(id) : undefined; if (t) out.push({ src: t }); }
  }

  paragraph(p: El): Para {
    const ppr = child(p, 'pPr');
    const into = { inline: [] as Inline[], pictures: [] as Picture[], pageBreak: false, instr: { depth: 0, skipping: false } };
    this.runs(p, into);
    let style = ''; let jc: string | undefined; let left = 0; let numId: string | undefined; let ilvl: number | undefined; let sect: Para['sect'];
    if (ppr) {
      style = wattr(child(ppr, 'pStyle'), 'val') ?? ''; jc = wattr(child(ppr, 'jc'), 'val'); left = Number(wattr(child(ppr, 'ind'), 'left') ?? 0) || 0;
      const num = child(ppr, 'numPr'); if (num) { numId = wattr(child(num, 'numId'), 'val'); ilvl = Number(wattr(child(num, 'ilvl'), 'val') ?? 0); }
      if (child(ppr, 'pageBreakBefore')) into.pageBreak = true;
      const sp = child(ppr, 'sectPr');
      if (sp) { const sz = child(sp, 'pgSz'); const w = Number(wattr(sz, 'w') ?? 0); const h = Number(wattr(sz, 'h') ?? 0); const land = wattr(sz, 'orient') === 'landscape' || w > h; sect = !land ? 'portrait' : Math.max(w, h) > 20000 ? 'a3-landscape' : 'landscape'; }
    }
    // the look of the first text run: the front matter is found by its blue bold titles
    let color: string | undefined; let size: number | undefined; let bold = false; let underline = false;
    for (const r of els(p.getElementsByTagNameNS(W, 'r'))) {
      if (!(r.textContent ?? '').trim()) continue; const rpr = child(r, 'rPr'); if (!rpr) break;
      color = wattr(child(rpr, 'color'), 'val'); const sz = wattr(child(rpr, 'sz'), 'val'); size = sz ? Number(sz) / 2 : undefined; bold = !!child(rpr, 'b'); underline = !!child(rpr, 'u'); break;
    }
    const inline = trimInline(into.inline); const text = squash(plain(inline));
    return { k: 'p', style, jc, left, numId, ilvl, inline, pictures: into.pictures, text, pageBreak: into.pageBreak, sect, color, size, bold, underline, empty: !text && !into.pictures.length };
  }

  table(t: El): Tbl {
    const grid = child(t, 'tblGrid'); const cols = grid ? kids(grid).filter((g) => g.localName === 'gridCol').map((g) => Number(wattr(g, 'w') ?? 0)) : [];
    const rows: Tbl['rows'] = [];
    for (const tr of kids(t).filter((k) => k.localName === 'tr')) {
      const trPr = child(tr, 'trPr'); const header = !!(trPr && child(trPr, 'tblHeader'));
      const cells: Cell[] = [];
      for (const tc of kids(tr).filter((k) => k.localName === 'tc')) {
        const pr = child(tc, 'tcPr'); const span = Number(wattr(pr && child(pr, 'gridSpan'), 'val') ?? 1) || 1; const vm = pr && child(pr, 'vMerge');
        const paras: Para[] = []; let jc: string | undefined;
        for (const c of kids(tc)) {
          if (c.localName === 'p') { const p = this.paragraph(c); paras.push(p); jc = jc ?? p.jc; }
          else if (c.localName === 'tbl') for (const inner of this.table(c).rows) for (const ic of inner.cells) paras.push(...ic.paras);       // a table inside a cell: its text is kept, flat
        }
        cells.push({ span, vmerge: vm ? (wattr(vm, 'val') === 'restart' ? 'restart' : 'continue') : undefined, paras, jc });
      }
      rows.push({ header, cells });
    }
    return { k: 't', rows, grid: cols };
  }
}

// ── the model the XML is written from ─────────────────────────────────────────────────────────────────────────────────────────

type Part = { k: 'text'; inline: Inline[] } | { k: 'graphic'; src: string; widthMm?: number } | { k: 'list'; list: List };
interface ListItem { parts: Part[] }
interface List { k: 'list'; type: 'alpha' | 'roman' | 'number' | 'step' | 'bullet' | 'dash'; indent: number; items: ListItem[] }
interface TCell { colspan?: number; rowspan?: number; align?: string; bold?: boolean; parts: Part[] }
interface Table { k: 'table'; title?: string; widths?: string; head: TCell[][]; body: TCell[][] }
interface PlainPara { k: 'para'; indent: number; align?: string; inline: Inline[] }
interface Figure { k: 'figure'; title: string; graphics: Array<{ src: string; widthMm?: number }> }
type Block = PlainPara | List | Table | Figure;
interface Clause { k: 'clause'; title: string; orientation?: string; children: Array<Block | Clause> }
interface Section { k: 'section'; title: string; orientation?: string; children: Array<Block | Clause> }
interface Chapter { k: 'chapter'; title: string; sections: Section[] }
interface Appendix { k: 'appendix'; label: string; title: string; orientation?: string; children: Block[] }

const PARA_STYLES: Record<string, number> = { 'L2-Para': 2, 'L3-Para': 3, 'L4-Para': 4, L5Para0: 5, L5AlphaPara: 5, L3Para: 3, L3Parag: 3, L5Para: 5 };
const LIST_STYLES: Record<string, { type: List['type']; indent: number; nested?: boolean }> = {
  'L2-alphanumbering': { type: 'alpha', indent: 2 }, 'L3-alphanumeric': { type: 'alpha', indent: 3 }, L4Alpha: { type: 'alpha', indent: 4 }, 'L5-alphanumeric': { type: 'alpha', indent: 5 },
  'L2-romanlist': { type: 'roman', indent: 2 }, 'L3-romanlist': { type: 'roman', indent: 3 }, L4Roman: { type: 'roman', indent: 4 }, L5Roman: { type: 'roman', indent: 5 },
  Step1: { type: 'step', indent: 2 }, StepAlpha: { type: 'alpha', indent: 3, nested: true }, ListParagraph: { type: 'number', indent: 2 },
};
const HEADING_DEPTH: Record<string, number> = { Heading2: 1, Heading3: 2, Heading4: 3, 'Heading-5': 4, Heading5: 4 };
const SKIP_STYLES = new Set(['TableofFigures', 'TOC1', 'TOC2', 'TOC3', 'TOCHeading', 'Thgispageisintentionallyleftblank']);
const BLANK_LEGEND = /^this page is intentionally left blank\.?$/i;
/** A heading typed in capitals ("PREPARATION FOR USE") is stored as words ("Preparation for Use"): the stencil's styles print it in capitals, and the contents lists it as words. */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'per']);
export const titleCase = (t: string): string => (/[a-z]/.test(t) || !/[A-Z]{3}/.test(t) ? t : t.toLowerCase().replace(/(^|[\s(\/-])([a-z])([a-z']*)/g, (m, pre: string, c: string, rest: string, off: number) => (off > 0 && SMALL.has(c + rest) ? m : pre + c.toUpperCase() + rest)));
export const indentOf = (left: number): number => (left >= 1474 ? 5 : left >= 1304 ? 4 : left >= 1174 ? 3 : 2);
const ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right', both: 'justify', justify: 'justify' };

const FRONT_TITLES: Array<[string, RegExp]> = [
  ['certificate', /^C ?E ?R ?T ?I ?F ?I ?C ?A ?T ?E$/], ['associated', /^ASSOCIATED (HANDBOOKS|DOCUMENTS)$/], ['amendments', /^AMENDMENTS$/], ['warning', /^WARNING$/],
  ['demolition', /^DEMOLITION OF EQUIPMENT/], ['firstAid1', /^FIRST AID IN CASE OF ELECTRICAL SHOCK$/], ['firstAid2', /^FIRST AID IN CASE OF ELECTRIC SHOCK$/],
  ['abbreviations', /^ABBREVIATIONS$/], ['preface', /^PREFACE$/], ['dos', /^DO.?S$/], ['donts', /^DON.?T.?S$/], ['important', /^IMPORTANT POINTS$/],
  ['contents', /^CONTENTS$/], ['lof', /^LIST OF FIGURES$/], ['lot', /^LIST OF TABLES$/],
];
const frontKey = (p: Para): string | null => {
  if (p.style === 'Section' || !p.text || p.text.length > 70) return null;
  const t = p.text.toUpperCase().replace(/[’‘`]/g, "'");
  for (const [k, re] of FRONT_TITLES) if (re.test(t)) return k;
  return null;
};

export async function importDocx(docxPath: string, opts: { projectDir: string; copyMedia?: boolean }): Promise<ImportResult> {
  const zip = ZipFileReader.open(docxPath);
  const warnings: string[] = []; const skipped: string[] = [];
  try {
    const rd = new Reader(zip);
    await rd.loadRelationships(); await rd.loadNumbering();
    const docBuf = await rd.entry('word/document.xml'); if (!docBuf) throw new Error('This is not a Word document: word/document.xml is missing.');
    const doc = rd.parse(docBuf);
    const body = doc.getElementsByTagNameNS(W, 'body')[0]; if (!body) throw new Error('The Word document has no body.');

    // 1. tokens
    const tokens: Token[] = [];
    for (const e of kids(body)) { if (e.localName === 'p') tokens.push(rd.paragraph(e)); else if (e.localName === 'tbl') tokens.push(rd.table(e)); }

    const report: ImportReport = { chapters: 0, sections: 0, clauses: 0, paragraphs: 0, lists: 0, tables: 0, figures: 0, pictures: 0, frontPages: [], skipped, warnings };
    const media = new Set<string>();
    const usePicture = (pic: Picture): { src: string; widthMm?: number } | null => {
      if (!PRINTABLE.test(pic.src)) { skipped.push(`picture ${path.basename(pic.src)} (${path.extname(pic.src) || 'unknown'} cannot be printed)`); return null; }
      media.add(pic.src); report.pictures++; return { src: `Media/${path.basename(pic.src)}`, widthMm: pic.widthMm };
    };

    // 2. where the body starts: the first chapter divider
    const firstChapter = tokens.findIndex((t) => t.k === 'p' && t.style === 'Section' && t.text);
    const frontTokens = firstChapter < 0 ? tokens : tokens.slice(0, firstChapter);
    const bodyTokens = firstChapter < 0 ? [] : tokens.slice(firstChapter);

    // 3. the cover and the ancillary pages
    const meta: Record<string, string> = {}; const supplier: string[] = []; const issuedBy: string[] = [];
    const front = {
      certificate: null as Inline[] | null, associated: [] as Array<{ title: string; docNo: string; remark: string }>, associatedIntro: '', hasAssociated: false,
      amendments: [] as Array<Record<string, string>>, amendRows: 0, hasAmend: false, warning: [] as Inline[][], hasWarning: false, demolition: [] as Inline[][], firstAid: [] as Inline[][],
      abbreviations: [] as Array<{ short: string; long: string }>, hasAbbr: false, preface: [] as Inline[][], dos: [] as Inline[][], donts: [] as Inline[][], important: [] as Inline[][],
      photos: [] as Array<{ src: string; widthMm?: number; label: string }>, hasPhotos: false,
    };
    const cellText = (c: Cell): string => squash(c.paras.map((p) => p.text).join(' '));
    const listText = (p: Para): Inline[] => trimInline(p.inline.length && p.inline[0].t === 'text' ? [{ ...p.inline[0], text: (p.inline[0] as { text: string }).text.replace(/^\s*\(?\d+[.)]\s*/, '') }, ...p.inline.slice(1)] : p.inline);

    let page: string | null = null; let coverDone = false;
    const coverLines: Para[] = [];
    for (const tok of frontTokens) {
      if (tok.k === 'p') {
        const key = frontKey(tok);
        if (key) { page = key; coverDone = true; report.frontPages.push(key); if (key === 'certificate') { /* its sentence follows */ } continue; }
      }
      if (!coverDone) {
        if (tok.k === 't') { const t = squash(tok.rows.flatMap((r) => r.cells.map(cellText)).join(' ')); const m = /^EQUIPMENT LIFE:?\s*(.*)$/i.exec(t); if (m) meta.equipmentLife = m[1]; continue; }
        if (!tok.empty) coverLines.push(tok);
        continue;
      }
      if (tok.k === 't') {
        const rows = tok.rows;
        if (page === 'associated') {
          front.hasAssociated = true;
          for (const r of rows) { const c = r.cells.map(cellText); if (/^sr\.?\s*no/i.test(c[0] ?? '') || !c[1]) continue; front.associated.push({ title: c[1], docNo: c[2] ?? '', remark: c[3] ?? '' }); }
        } else if (page === 'amendments') {
          front.hasAmend = true; front.amendRows = Math.max(front.amendRows, rows.length - 1);
          for (const r of rows.slice(1)) { const c = r.cells.map(cellText); if (c.some(Boolean)) front.amendments.push({ no: c[0] ?? '', page: c[1] ?? '', para: c[2] ?? '', required: c[3] ?? '', authority: c[4] ?? '' }); }
        } else if (page === 'abbreviations') {
          front.hasAbbr = true;
          for (const r of rows) { const c = r.cells.map(cellText); if (/^sr\.?\s*no/i.test(c[0] ?? '')) continue; if (c[1] || c[2]) front.abbreviations.push({ short: c[1] ?? '', long: c[2] ?? '' }); }
        } else if (page === 'firstAid1') {
          for (const r of rows) { const cell = r.cells[r.cells.length - 1]; if (!cell) continue; const runs: Inline[] = []; cell.paras.filter((p) => !p.empty).forEach((p, i) => { if (i) runs.push({ t: 'br' }); runs.push(...p.inline); }); const t = trimInline(runs); if (t.length) front.firstAid.push(t); }
        }
        continue;
      }
      // paragraphs
      if (tok.empty && !tok.pictures.length) continue;
      if (BLANK_LEGEND.test(tok.text) || SKIP_STYLES.has(tok.style)) continue;
      switch (page) {
        case 'certificate': front.certificate = [...(front.certificate ?? []), ...(front.certificate ? [{ t: 'text', text: ' ' } as Inline] : []), ...tok.inline]; break;
        case 'associated': if (!front.associatedIntro) front.associatedIntro = tok.text; break;
        case 'warning': front.hasWarning = true; front.warning.push(listText(tok)); break;
        case 'demolition': front.demolition.push(tok.inline); break;
        case 'preface': front.preface.push(tok.inline); break;
        case 'dos': front.dos.push(tok.inline); break;
        case 'donts': front.donts.push(tok.inline); break;
        case 'important':
        case 'photos': {
          // IMPORTANT POINTS are numbered lines; the pictures that follow them (each with a blue bold caption under it) are the SYSTEM PHOTOS page
          if (tok.pictures.length) { page = 'photos'; front.hasPhotos = true; for (const pic of tok.pictures) { const u = usePicture(pic); if (u) front.photos.push({ ...u, label: '' }); } }
          else if (tok.color?.toUpperCase() === '0000FF' && tok.bold && front.photos.length) { const last = front.photos[front.photos.length - 1]; if (!last.label) last.label = tok.text; }
          else if (page === 'important') front.important.push(tok.inline);
          break;
        }
      }
    }

    // the cover, line by line
    {
      let i = 0; const L = coverLines;
      const first = L.find((p) => p.jc === 'right' && p.bold); if (first) meta.docNo = first.text;
      const blue = L.filter((p) => p.color?.toUpperCase() === '3333FF');
      if (blue[0]) {
        const lines: Inline[][] = [[]]; for (const r of blue[0].inline) { if (r.t === 'br') lines.push([]); else lines[lines.length - 1].push(r); }
        const ls = lines.map((x) => squash(plain(x))).filter(Boolean).filter((x) => x.toUpperCase() !== 'FOR');
        if (ls.length) { meta.title = ls[0]; if (ls.length > 1) meta.subtitle = ls.slice(1).join(' '); }
      }
      const projectLine = blue.find((p, idx) => idx > 0 && p.text.toUpperCase() !== 'FOR'); if (projectLine) meta.projectName = projectLine.text;
      for (; i < L.length; i++) {
        const t = L[i].text;
        let m = /^A\/T or S\/O No\.?:?\s*(.*)$/i.exec(t); if (m) { meta.atNo = m[1]; continue; }
        m = /^DATED:?\s*(.*)$/i.exec(t); if (m) { meta.dated = m[1]; continue; }
        m = /^NSN:?\s*(.*)$/i.exec(t); if (m) { meta.nsn = m[1]; continue; }
      }
      const iSup = L.findIndex((p) => /^SUPPLIED BY:?$/i.test(p.text)); const iIss = L.findIndex((p) => /^ISSUED BY:?$/i.test(p.text));
      // a paragraph may hold several lines (a soft line break between them)
      const linesOf = (p: Para): string[] => { const out: string[][] = [[]]; for (const r of p.inline) { if (r.t === 'br') out.push([]); else out[out.length - 1].push(plain([r])); } return out.map((x) => squash(x.join(''))).filter(Boolean); };
      if (iSup >= 0 && iIss > iSup) for (const p of L.slice(iSup + 1, iIss)) supplier.push(...linesOf(p));
      if (iIss >= 0) {
        const rest = L.slice(iIss + 1);
        const dateAt = rest.findIndex((p) => p.jc === 'left' && /\b(19|20)\d\d\b/.test(p.text));
        for (const p of rest.slice(0, dateAt >= 0 ? dateAt : rest.length)) if (p.text && !/^EQUIPMENT LIFE/i.test(p.text)) issuedBy.push(...linesOf(p));
        if (dateAt >= 0) meta.issueDate = rest[dateAt].text.replace(/\s+/g, '').replace(/,/, ', ');
      }
    }

    // 4. the body
    const chapters: Chapter[] = []; const appendices: Appendix[] = [];
    let chapter: Chapter | null = null; let section: Section | null = null; const clauseStack: Clause[] = []; let appendix: Appendix | null = null; let inAppendices = false;
    let pendingPics: Array<{ src: string; widthMm?: number }> = []; let pendingTableTitle: string | undefined; let curList: List | null = null; let lastStepItem: ListItem | null = null;
    const created: Array<Section | Clause | Appendix> = []; let rangeStart = 0;                 // nodes made since the last Word section break, for the landscape pages

    const container = (): Array<Block | Clause> => (appendix ? (appendix.children as Array<Block | Clause>) : clauseStack.length ? clauseStack[clauseStack.length - 1].children : section ? section.children : []);
    const ensureSection = (): void => {
      if (appendix || section) return;
      if (!chapter) { chapter = { k: 'chapter', title: 'Chapter', sections: [] }; chapters.push(chapter); }
      section = { k: 'section', title: 'Section', children: [] }; chapter.sections.push(section); created.push(section);
    };
    const flushList = (): void => { curList = null; lastStepItem = null; };
    const flushPics = (): void => {
      if (!pendingPics.length) return;
      ensureSection(); container().push({ k: 'figure', title: '', graphics: pendingPics } as Figure); report.figures++; pendingPics = [];
    };
    const push = (b: Block): void => { ensureSection(); container().push(b); };

    const tableBlock = (t: Tbl): Table => {
      report.tables++;
      // vertically merged cells: a "continue" cell lengthens the "restart" cell above it
      const open: Array<TCell | undefined> = []; const rows: Array<{ header: boolean; cells: TCell[] }> = [];
      for (const r of t.rows) {
        const cells: TCell[] = []; let col = 0;
        for (const c of r.cells) {
          if (c.vmerge === 'continue') { const up = open[col]; if (up) up.rowspan = (up.rowspan ?? 1) + 1; col += c.span; continue; }
          const parts: Part[] = []; let list: List | null = null;
          for (const p of c.paras) {
            if (p.pictures.length) for (const pic of p.pictures) { const u = usePicture(pic); if (u) parts.push({ k: 'graphic', ...u }); }
            if (p.empty || SKIP_STYLES.has(p.style)) continue;
            const ls = LIST_STYLES[p.style];
            if (ls) { if (!list || list.type !== ls.type) { list = { k: 'list', type: ls.type, indent: 2, items: [] }; parts.push({ k: 'list', list }); } list.items.push({ parts: [{ k: 'text', inline: p.inline }] }); continue; }
            list = null; parts.push({ k: 'text', inline: p.inline });
          }
          const cell: TCell = { parts: parts.length ? parts : [{ k: 'text', inline: [] }] };
          if (c.span > 1) cell.colspan = c.span;
          const al = c.jc ? ALIGN[c.jc] : undefined; if (al && al !== 'justify') cell.align = al;
          if (c.paras.length && c.paras.filter((p) => !p.empty).every((p) => p.bold)) cell.bold = true;
          cells.push(cell); if (c.vmerge === 'restart') for (let k = 0; k < c.span; k++) open[col + k] = cell; else for (let k = 0; k < c.span; k++) open[col + k] = undefined;
          col += c.span;
        }
        rows.push({ header: r.header, cells });
      }
      const headCount = rows.findIndex((r) => !r.header); let nHead = headCount < 0 ? rows.length : headCount;
      // a merged cell that runs from the header into the body cannot be split between <head> and <body>: such a table is all body
      let crossed = false;
      if (rows.slice(0, nHead).some((r, ri) => r.cells.some((c) => (c.rowspan ?? 1) > nHead - ri))) { nHead = 0; crossed = true; }
      const head = rows.slice(0, nHead).map((r) => r.cells); let bodyRows = rows.slice(nHead).map((r) => r.cells);
      // and no merged cell may run past the last row
      for (const group of [head, bodyRows]) group.forEach((r, ri) => r.forEach((c) => { if ((c.rowspan ?? 1) > group.length - ri) { c.rowspan = group.length - ri; if (c.rowspan <= 1) delete c.rowspan; } }));
      if (!crossed && !head.length && bodyRows.length > 1 && bodyRows[0].every((c) => c.bold) && !bodyRows[0].some((c) => (c.rowspan ?? 1) > 1)) { head.push(bodyRows[0]); bodyRows = bodyRows.slice(1); }
      const tbl: Table = { k: 'table', head, body: bodyRows.length ? bodyRows : head.splice(0) };
      if (pendingTableTitle !== undefined) tbl.title = pendingTableTitle; pendingTableTitle = undefined;
      const widthsOk = t.grid.length > 1 && t.grid.every((g) => g > 0) && Math.max(...rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0))) === t.grid.length;
      if (widthsOk) tbl.widths = t.grid.join(' ');
      return tbl;
    };

    const applySectionBreak = (orient: Para['sect']): void => {
      if (orient && orient !== 'portrait') {
        const target = created.slice(rangeStart).find((n) => n.k === 'section') ?? created.slice(rangeStart).find((n) => n.k === 'appendix') ?? created.slice(rangeStart).find((n) => n.k === 'clause');
        const holder = target ?? (appendix ?? (clauseStack[0] ?? section));
        if (holder) (holder as { orientation?: string }).orientation = orient;
      }
      rangeStart = created.length;
    };

    for (const tok of bodyTokens) {
      if (tok.k === 't') { flushPics(); flushList(); push(tableBlock(tok)); continue; }
      if (tok.sect) { /* applied after the paragraph's own content */ }
      const style = tok.style;
      if (style === 'Section' && tok.text) {
        flushPics(); flushList(); chapter = { k: 'chapter', title: titleCase(tok.text), sections: [] }; chapters.push(chapter); section = null; clauseStack.length = 0; appendix = null; inAppendices = false; report.chapters++;
        if (tok.sect) applySectionBreak(tok.sect); continue;
      }
      if (style === 'Heading1' && tok.text) {
        flushPics(); flushList();
        if (/^APPENDICES$/i.test(tok.text)) { inAppendices = true; section = null; clauseStack.length = 0; appendix = null; if (tok.sect) applySectionBreak(tok.sect); continue; }
        if (!chapter) { chapter = { k: 'chapter', title: 'Chapter', sections: [] }; chapters.push(chapter); }
        section = { k: 'section', title: titleCase(tok.text), children: [] }; chapter.sections.push(section); clauseStack.length = 0; appendix = null; created.push(section); report.sections++;
        if (tok.sect) applySectionBreak(tok.sect); continue;
      }
      if (HEADING_DEPTH[style] && tok.text) {
        flushPics(); flushList();
        if (appendix) { appendix.children.push({ k: 'para', indent: 2, inline: [{ t: 'mark', mark: 'b', children: tok.inline }] }); continue; }
        ensureSection(); const depth = HEADING_DEPTH[style];
        while (clauseStack.length >= depth) clauseStack.pop();
        const c: Clause = { k: 'clause', title: tok.text, children: [] }; (clauseStack.length ? clauseStack[clauseStack.length - 1].children : (section as Section).children).push(c); clauseStack.push(c); created.push(c); report.clauses++;
        if (tok.sect) applySectionBreak(tok.sect); continue;
      }
      if (inAppendices || appendix || /^APPENDIX\s*[‘'’]?[A-Z0-9]+[’']?$/i.test(tok.text)) {
        const m = /^APPENDIX\s*[‘'’]?([A-Z0-9]+)[’']?$/i.exec(tok.text);
        if (m && tok.jc === 'right') { flushPics(); flushList(); appendix = { k: 'appendix', label: m[1].toUpperCase(), title: '', children: [] }; appendices.push(appendix); created.push(appendix); section = null; clauseStack.length = 0; inAppendices = true; continue; }
        if (appendix && !appendix.title && tok.text && tok.jc === 'center') { appendix.title = titleCase(tok.text); continue; }
      }
      if (SKIP_STYLES.has(style) || BLANK_LEGEND.test(tok.text)) { if (tok.sect) applySectionBreak(tok.sect); continue; }

      // pictures and captions
      if (tok.pictures.length) { flushList(); for (const pic of tok.pictures) { const u = usePicture(pic); if (u) pendingPics.push(u); } if (tok.text && style !== 'Caption') { /* text beside a picture is read below */ } else { if (tok.sect) applySectionBreak(tok.sect); continue; } }
      if (style === 'Caption' && tok.text) {
        const m = /^(Figure|Fig\.?|Table)\s*\d*\s*[:.\-–—]?\s*(.*)$/i.exec(tok.text);
        if (m && /^t/i.test(m[1])) { flushPics(); flushList(); pendingTableTitle = m[2]; }
        else { flushList(); ensureSection(); container().push({ k: 'figure', title: m ? m[2] : tok.text, graphics: pendingPics } as Figure); report.figures++; pendingPics = []; }
        if (tok.sect) applySectionBreak(tok.sect); continue;
      }
      if (tok.empty) { if (tok.sect) applySectionBreak(tok.sect); continue; }
      flushPics();

      // lists
      const ls = LIST_STYLES[style] ?? (tok.numId && !PARA_STYLES[style] && /^(?:|Normal)$/.test(style) ? { type: ((): List['type'] => { const f = rd.numFmt.get(tok.numId as string); return f === 'bullet' ? 'bullet' : f === 'lowerLetter' || f === 'upperLetter' ? 'alpha' : f === 'lowerRoman' || f === 'upperRoman' ? 'roman' : 'number'; })(), indent: indentOf(tok.left) } : undefined);
      if (ls) {
        const item: ListItem = { parts: [{ k: 'text', inline: tok.inline }] };
        if (ls.nested && curList && lastStepItem) {
          let sub = lastStepItem.parts.find((p): p is { k: 'list'; list: List } => p.k === 'list')?.list;
          if (!sub) { sub = { k: 'list', type: ls.type, indent: ls.indent, items: [] }; lastStepItem.parts.push({ k: 'list', list: sub }); }
          sub.items.push(item);
        } else {
          if (!curList || curList.type !== ls.type || curList.indent !== ls.indent) { curList = { k: 'list', type: ls.type, indent: ls.indent, items: [] }; push(curList); report.lists++; }
          curList.items.push(item); lastStepItem = item;
        }
        if (tok.sect) applySectionBreak(tok.sect); continue;
      }
      flushList();
      const para: PlainPara = { k: 'para', indent: PARA_STYLES[style] ?? indentOf(tok.left), inline: tok.inline };
      const al = tok.jc ? ALIGN[tok.jc] : undefined; if (al && al !== 'justify') para.align = al;
      push(para); report.paragraphs++;
      if (tok.sect) applySectionBreak(tok.sect);
    }
    flushPics();

    // 5. the XML
    const partXml = (p: Part, pad: string): string => (p.k === 'text' ? `${pad}<text>${inlineXml(p.inline)}</text>` : p.k === 'graphic' ? `${pad}<graphic src="${escA(p.src)}"${p.widthMm ? ` width="${Math.round(Math.min(p.widthMm, 160))}mm"` : ''}/>` : listXml(p.list, pad));
    const listXml = (l: List, pad: string): string => `${pad}<list${l.type !== 'number' ? ` type="${l.type}"` : ''}${l.indent !== 2 ? ` indent="${l.indent}"` : ''}>\n${l.items.map((it) => `${pad}  <item>\n${it.parts.map((p) => partXml(p, pad + '    ')).join('\n')}\n${pad}  </item>`).join('\n')}\n${pad}</list>`;
    const cellXml = (c: TCell, pad: string): string => `${pad}<cell${c.colspan ? ` colspan="${c.colspan}"` : ''}${c.rowspan ? ` rowspan="${c.rowspan}"` : ''}${c.align ? ` align="${c.align}"` : ''}${c.bold ? ' bold="true"' : ''}>\n${c.parts.map((p) => partXml(p, pad + '  ')).join('\n')}\n${pad}</cell>`;
    const rowsXml = (rs: TCell[][], pad: string): string => rs.map((r) => `${pad}<row>\n${r.map((c) => cellXml(c, pad + '  ')).join('\n')}\n${pad}</row>`).join('\n');
    const tableXml = (t: Table, pad: string): string => `${pad}<table${t.title !== undefined ? ` title="${escA(t.title)}"` : ''}${t.widths ? ` widths="${escA(t.widths)}"` : ''}>\n${t.head.length ? `${pad}  <head>\n${rowsXml(t.head, pad + '    ')}\n${pad}  </head>\n` : ''}${pad}  <body>\n${rowsXml(t.body, pad + '    ')}\n${pad}  </body>\n${pad}</table>`;
    const figXml = (f: Figure, pad: string): string => `${pad}<figure title="${escA(f.title)}">${f.graphics.length ? '\n' + f.graphics.map((g) => `${pad}  <graphic src="${escA(g.src)}"${g.widthMm ? ` width="${Math.round(Math.min(g.widthMm, 160))}mm"` : ''}/>`).join('\n') + '\n' + pad : ''}</figure>`;
    const blockXml = (b: Block, pad: string): string => (b.k === 'para' ? `${pad}<para${b.indent !== 2 ? ` indent="${b.indent}"` : ''}${b.align ? ` align="${b.align}"` : ''}>${inlineXml(b.inline)}</para>` : b.k === 'list' ? listXml(b, pad) : b.k === 'table' ? tableXml(b, pad) : figXml(b, pad));
    const clauseXml = (c: Clause, pad: string): string => {
      const inner = c.children.map((x) => (x.k === 'clause' ? clauseXml(x, pad + '  ') : blockXml(x as Block, pad + '  '))).join('\n');
      return `${pad}<clause title="${escA(c.title)}"${c.orientation ? ` orientation="${c.orientation}"` : ''}>${inner ? `\n${inner}\n${pad}` : ''}</clause>`;
    };
    const items = (name: string, list: Inline[][], pad: string): string => `${pad}<${name}>${list.length ? '\n' + list.map((i) => `${pad}  <item>${inlineXml(i)}</item>`).join('\n') + '\n' + pad : ''}</${name}>`;

    const lines = (name: string, ls: string[]): string => (ls.length ? `    <${name}>${ls.map((x) => `<line>${esc(x)}</line>`).join('')}</${name}>\n` : '');
    const m = (k: string, v: string | undefined): string => (v ? `    <${k}>${esc(v)}</${k}>\n` : '');
    const metaXml = `  <meta>\n${m('docNo', meta.docNo)}${m('title', meta.title ?? 'USER HANDBOOK')}${m('subtitle', meta.subtitle)}${m('projectName', meta.projectName)}${m('atNo', meta.atNo)}${m('dated', meta.dated)}${m('nsn', meta.nsn)}${lines('supplier', supplier)}${lines('issuedBy', issuedBy)}${m('issueDate', meta.issueDate)}${m('equipmentLife', meta.equipmentLife)}    <classification>RESTRICTED</classification>\n  </meta>\n`;

    // certificate: the document number and the page counts become the placeholders the build fills in
    let certXml: string | null = null;
    if (front.certificate) {
      let c = inlineXml(front.certificate);
      if (meta.docNo) c = c.split(esc(meta.docNo)).join('{docNo}');
      certXml = c.replace(/contains\s+\d+\s+pages/i, 'contains {total} pages').replace(/from\s*\(i\)\s*to\s*\(([ivxlcdm]+)\)/i, 'from (i) to ({frontLast})').replace(/from\s+1\s+to\s+\d+\s+as\s+main/i, 'from 1 to {mainLast} as main');
    }
    const demolition = front.demolition.length ? `    <demolition>\n${front.demolition.map((i) => `      <para>${inlineXml(i)}</para>`).join('\n')}\n    </demolition>\n` : '';
    const frontParts: string[] = [];
    if (certXml) frontParts.push(`    <certificate>${certXml}</certificate>`);
    if (front.hasAssociated) frontParts.push(`    <associated${front.associatedIntro ? ` intro="${escA(front.associatedIntro)}"` : ''}>${front.associated.length ? '\n' + front.associated.map((d) => `      <doc title="${escA(d.title)}"${d.docNo ? ` docNo="${escA(d.docNo)}"` : ''}${d.remark ? ` remark="${escA(d.remark)}"` : ''}/>`).join('\n') + '\n    ' : ''}</associated>`);
    frontParts.push(`    <amendments minRows="${Math.max(20, front.amendRows || 20)}">${front.amendments.length ? '\n' + front.amendments.map((r) => `      <row${Object.entries(r).filter(([, v]) => v).map(([k, v]) => ` ${k}="${escA(v)}"`).join('')}/>`).join('\n') + '\n    ' : ''}</amendments>`);
    frontParts.push(items('warning', front.warning, '    '));
    if (demolition) frontParts.push(demolition.replace(/\n$/, ''));
    if (front.firstAid.length) frontParts.push(items('firstAid', front.firstAid, '    '));
    frontParts.push(`    <abbreviations minRows="${Math.max(37, front.abbreviations.length)}">${front.abbreviations.length ? '\n' + front.abbreviations.map((a) => `      <abbr short="${escA(a.short)}" long="${escA(a.long)}"/>`).join('\n') + '\n    ' : ''}</abbreviations>`);
    if (front.preface.length) frontParts.push(`    <preface>\n${front.preface.map((i) => `      <para>${inlineXml(i)}</para>`).join('\n')}\n    </preface>`);
    if (front.dos.length) frontParts.push(items('dos', front.dos, '    '));
    if (front.donts.length) frontParts.push(items('donts', front.donts, '    '));
    if (front.important.length) frontParts.push(items('important', front.important, '    '));
    if (front.hasPhotos) frontParts.push(`    <photos>\n${front.photos.map((g) => `      <graphic src="${escA(g.src)}"${g.widthMm ? ` width="${Math.round(Math.min(g.widthMm, 160))}mm"` : ''}${g.label ? ` label="${escA(g.label)}"` : ''}/>`).join('\n')}\n    </photos>`);

    const chaptersXml = chapters.map((c) => `  <chapter title="${escA(c.title)}">\n${c.sections.map((s) => {
      const inner = s.children.map((x) => (x.k === 'clause' ? clauseXml(x, '      ') : blockXml(x as Block, '      '))).join('\n');
      return `    <section title="${escA(s.title)}"${s.orientation ? ` orientation="${s.orientation}"` : ''}>${inner ? `\n${inner}\n    ` : ''}</section>`;
    }).join('\n')}\n  </chapter>`).join('\n');
    const appXml = appendices.map((a) => `    <appendix label="${escA(a.label)}" title="${escA(a.title)}"${a.orientation ? ` orientation="${a.orientation}"` : ''}>${a.children.length ? '\n' + a.children.map((b) => blockXml(b, '      ')).join('\n') + '\n    ' : ''}</appendix>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<jsgdoc version="1.0" type="uhb">\n${metaXml}  <front>\n${frontParts.join('\n')}\n  </front>\n${chaptersXml}\n${appendices.length ? `  <appendices>\n${appXml}\n  </appendices>\n` : ''}</jsgdoc>\n`;
    void issuedBy;

    // 6. pictures
    const written: string[] = [];
    if (opts.copyMedia !== false) {
      const dest = path.join(opts.projectDir, 'Media'); fs.mkdirSync(dest, { recursive: true });
      for (const rel of media) {
        const e = zip.entries.find((x) => x.name === `word/${rel}`); if (!e) { warnings.push(`The picture ${rel} is not in the file.`); continue; }
        await new Promise<void>((resolve, reject) => { const out = fs.createWriteStream(path.join(dest, path.basename(rel))); zip.open(e).on('error', reject).pipe(out).on('finish', () => resolve()).on('error', reject); });
        written.push(`Media/${path.basename(rel)}`);
      }
    }
    return { xml, media: written, report };
  } finally { zip.close(); }
}

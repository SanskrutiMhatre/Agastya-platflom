/**
 * Publication assembly: turns the extracted data modules (`PublicationInput`) into the paginated, double-sided
 * publication the reference shows, and renders it to PDF. It needs no DOM, so it runs in a Web Worker (`pdf-worker.ts`)
 * for the editor and on the calling thread in the tests.
 *
 * Structure of a full publication ("Generate"):
 *   title page · blank · table of contents (documents) · blank · list of illustrations · list of abbreviations ·
 *   then every data module, each starting on a right-hand page (blank pages are inserted as needed).
 * A quick preview is the same data module pages without any front matter.
 *
 * Every page has a running header and footer that depend on the page's parity and on the section it belongs to
 * (classification, "<MIC> PUBLICATION", data module code, issue date, page number, "End of data module" on the last
 * page of a section). Which page a section starts and ends on is only known after layout, so the document is laid
 * out twice (or more, until stable): the first pass records the page of every section marker and every table-of-
 * contents target, the second uses those numbers for page references, headers, footers and blank-page text. The
 * result is then post-processed (`pdf-mirror.ts`) into the real inside/outside margins.
 *
 * A data module with landscape content (`pdf-landscape.ts`) is a section of several runs: every run starts on a right-
 * hand page in its own orientation, and the blank pages in between belong to no run.
 */
import { FONT_TEXT, leaderDots, textWidth, withFallbackFonts, type PNode } from './pdf-metrics';
import {
  COLOR, CONTENT_W, FOOTER, FS, GAP, HEADER, LH, MARGIN_BOTTOM, MARGIN_TOP, NOMINAL_MARGIN, PAGE_H, SHIFT, WATERMARK_OPACITY, WATERMARK_SIZE,
} from './pdf-theme';
import { captionNode, heading, HEAD_PART, imageNode, tableNode, TOP_ST, type ResolvedImage } from './pdf-content';
import { mirrorPages } from './pdf-mirror';
import { splitRuns, type Run } from './pdf-landscape';
import { loadPdfMake } from './fonts';
import type { PublicationSettings } from './pdf-settings';
import type { AssembleHooks, AssembleResult, DmInput, PdfMode, PublicationInput } from './pdf-input';

// ------------------------------------------------------------------ data
type SegKind = 'title' | 'toc' | 'loi' | 'abbr' | 'dm';
interface SegMeta {
  id: string;
  kind: SegKind;
  dmc: string;
  date: string;
  classification: string;
  header: string;
  notReleased: boolean;
  /** "Applicable to:" text of the footer. */
  applic: string;
}

/** Page of every recorded node id, as measured by a layout pass. */
export interface LayoutInfo {
  pageOf: Map<string, number>;
  pageCount: number;
}

const sameInfo = (a: LayoutInfo, b: LayoutInfo): boolean => {
  if (a.pageCount !== b.pageCount || a.pageOf.size !== b.pageOf.size) return false;
  for (const [k, v] of a.pageOf) if (b.pageOf.get(k) !== v) return false;
  return true;
};

// ------------------------------------------------------------------ small builders
const m4 = (l: number, t: number, r: number, b: number) => [l, t, r, b];

/** Ids of the markers that record where a run of a section starts and ends (the section's own ids for its first and last run). */
const runStart = (id: string, k: number): string => (k === 0 ? `start:${id}` : `run:${id}:${k}:start`);
const runEnd = (id: string, k: number, n: number): string => (k === n - 1 ? `end:${id}` : `run:${id}:${k}:end`);

/** Zero-size node that records the page it lands on (pdfmake reports every node carrying an id). */
const marker = (id: string): PNode => ({ text: ' ', fontSize: 0.1, lineHeight: 1, id, margin: m4(0, 0, 0, 0) });

const bold = (text: string, extra: PNode = {}): PNode => ({ text, bold: true, ...extra });

function pageRef(info: LayoutInfo | null, id: string): string {
  return String(info?.pageOf.get(id) ?? 0);
}

function widthsOf(fr: number[], total = CONTENT_W): number[] {
  const s = fr.reduce((a, b) => a + b, 0);
  return fr.map((f) => Math.round((f / s) * total * 100) / 100);
}

const LOOK_NONE = { frame: 'none', colsep: false, rowsep: false };

/** A borderless list table (front matter) with 10 pt text, the reference's 22.4 pt single-line row pitch and a repeated header. */
function listTable(header: PNode[], rows: PNode[][], widths: number[]): PNode {
  const t = tableNode([header, ...rows], widths, 1, 0, LOOK_NONE, true);
  t.fontSize = FS.toc;
  return t;
}

function cellP(text: string, extra: PNode = {}): PNode {
  return { stack: [{ text: withFallbackFonts([{ text }]), ...extra }] };
}

// ------------------------------------------------------------------ title page
/** Issue number of the publication: the configured one, else the data modules' own when they all agree, else 000. */
function publicationIssue(S: PublicationSettings, dms: DmInput[]): string {
  if (S.issueNumber) return S.issueNumber;
  const issues = new Set(dms.map((d) => d.issueNumber));
  return issues.size === 1 && [...issues][0] ? [...issues][0] : '000';
}

function titlePage(S: PublicationSettings, dms: DmInput[], images: { cover?: ResolvedImage }, lite: boolean): PNode[] {
  const out: PNode[] = [];
  const single = dms.length === 1 ? dms[0] : null;
  const title = S.title || (single ? single.techName : 'Technical publication');
  const short = S.shortTitle || (single ? single.infoName : `${dms.length} data modules`);
  const issue = publicationIssue(S, dms);
  const date = S.issueDate || dms.map((d) => d.date).sort().pop() || '';
  out.push({ text: withFallbackFonts([{ text: title }]), bold: true, fontSize: FS.title, margin: m4(0, 1, 0, 4.8) });
  if (short) out.push({ text: withFallbackFonts([{ text: short }]), bold: true, fontSize: FS.h2, margin: m4(0, 0, 0, 22.5) });
  else out.push({ text: ' ', margin: m4(0, 0, 0, 10) });
  if (S.pmCode) out.push(bold(S.pmCode, { margin: m4(0, 0, 0, 4.25) }));
  out.push(bold(`Issue No. ${issue}${date ? ', ' + date : ''}`, { margin: m4(0, 0, 0, 30.9) }));
  if (images.cover) {
    // the reference prints the cover picture left-aligned, 440 pt wide at most
    out.push({ ...imageNode('cover', null, { images: new Map([['cover', images.cover]]), lite, warnings: new Set<string>() }, { ...TOP_ST, maxW: CONTENT_W }, false, { w: 440, h: 420 }), alignment: 'left', margin: m4(0, 0, 0, 0) });
  }
  if (S.publisher) {
    out.push({ text: 'Publisher:', margin: m4(0, images.cover ? 59 : 30, 0, 0) });
    out.push({ text: withFallbackFonts([{ text: S.publisher }]), fontSize: 10 });
  }
  return out;
}

// ------------------------------------------------------------------ document table of contents
function documentToc(dms: DmInput[], S: PublicationSettings, info: LayoutInfo | null): PNode[] {
  const issue = publicationIssue(S, dms);
  const date = S.issueDate || dms.map((d) => d.date).sort().pop() || '';
  const w = widthsOf([146.7, 132.5, 71, 42.6, 80.6]);
  const head: PNode[] = [
    bold('Document title'),
    { stack: [bold('Data module code'), bold('Publication module code')] },
    bold('Issue date'), bold('Page'), bold('Applicable to'),
  ];
  const rows = dms.map((d): PNode[] => [
    cellP(d.title),
    { stack: [{ text: d.dmc, color: COLOR.link, linkToDestination: `start:${d.id}` }] },
    cellP(d.date),
    { stack: [{ text: pageRef(info, `start:${d.id}`), color: COLOR.link, linkToDestination: `start:${d.id}` }] },
    cellP(d.applic),
  ]);
  return [
    heading('Table of contents', 'center', { id: 'toc-heading', margin: m4(0, 0, 0, 16.5) }),
    { text: `The listed documents are included in issue ${issue}${date ? `, dated ${date},` : ''} of this publication.`, alignment: 'center', fontSize: FS.toc, margin: m4(0, 0, 0, 17.2) },
    listTable(head, rows, w),
  ];
}

function illustrationList(dms: DmInput[], info: LayoutInfo | null): PNode[] {
  const w = widthsOf([179.8, 56.8, 236.8]);
  const rows: PNode[][] = [];
  for (const d of dms) {
    for (const f of d.collected.figures) {
      rows.push([
        cellP(d.dmc),
        { stack: [{ text: `Fig ${f.no}`, color: COLOR.link, linkToDestination: f.id }] },
        { stack: [{ text: withFallbackFonts([{ text: f.title }]), color: COLOR.link, linkToDestination: f.id }] },
      ]);
    }
  }
  void info;
  if (!rows.length) return [];
  return [
    heading('List of illustrations', 'center', { margin: m4(0, 0, 0, 16.5) }),
    listTable([bold('Data module code'), bold('Figure'), bold('Title')], rows, w),
  ];
}

function abbreviationList(dms: DmInput[]): PNode[] {
  const all = new Map<string, string>();
  for (const d of dms) for (const [t, def] of d.collected.acronyms) if (!all.has(t)) all.set(t, def);
  if (!all.size) return [];
  const rows = [...all].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })).map(([t, def]): PNode[] => [cellP(t), cellP(def)]);
  return [
    heading('List of abbreviations', 'center', { margin: m4(0, 0, 0, 16.5) }),
    listTable([bold('Abbreviation'), bold('Definition')], rows, widthsOf([118.3, 355.1])),
  ];
}

// ------------------------------------------------------------------ data module opening
/** "label . . . . . . 39" on one line: dot leader up to a right-aligned page number. */
function leaderLine(label: string, page: string, indent: number, num: string | null, id: string): PNode {
  const size = FS.body;
  const pageW = Math.ceil(textWidth(page, size) + 1);
  const numW = num ? 16.7 : 0;
  const colW = CONTENT_W - indent - numW - pageW;
  const dots = leaderDots(label, '', colW, size);
  const cols: PNode[] = [];
  if (num) cols.push({ width: numW, text: num, linkToDestination: id });
  cols.push({ width: '*', text: withFallbackFonts([{ text: label + dots }]), linkToDestination: id });
  cols.push({ width: pageW, text: page, alignment: 'right', linkToDestination: id });
  return { columns: cols, columnGap: 0, margin: m4(indent, 0, 0, 1.95), fontSize: size };
}

function dmOpening(d: DmInput, info: LayoutInfo | null): PNode[] {
  const out: PNode[] = [];
  out.push({ text: withFallbackFonts([{ text: d.techName }]), bold: true, fontSize: FS.title, alignment: 'center', margin: m4(0, 13, 0, d.infoName ? 17.1 : 24) });
  if (d.infoName) out.push({ text: withFallbackFonts([{ text: d.infoName }]), bold: true, fontSize: FS.h2, alignment: 'center', margin: m4(0, 0, 0, 6.35) });
  const col = d.collected;
  const indent = 56.69;
  if (col.headings.length) {
    out.push({ columns: [{ text: 'Table of contents', bold: true, fontSize: FS.h1 }, { width: 'auto', text: 'Page', italics: true, fontSize: FS.toc, margin: m4(0, 0.6, 0, 0) }], margin: m4(0, 0, 0, 3.35) });
    for (const h of col.headings) out.push(leaderLine(h.text, pageRef(info, h.id), indent, null, h.id));
  }
  if (col.tables.length) {
    out.push({ text: 'List of tables', bold: true, fontSize: FS.h1, margin: m4(0, 14.75, 0, 5.35) });
    for (const t of col.tables) out.push(leaderLine(t.title || `Table ${t.no}`, pageRef(info, t.id), indent, String(t.no), t.id));
  }
  if (col.figures.length) {
    out.push({ text: 'List of figures', bold: true, fontSize: FS.h1, margin: m4(0, 14.75, 0, 5.35) });
    for (const f of col.figures) out.push(leaderLine(f.title || `Fig ${f.no}`, pageRef(info, f.id), indent, String(f.no), f.id));
  }
  // References table: Table 1 of every data module
  const refs = d.refs;
  out.push(heading('References', 'center', { margin: m4(0, 24.25, 0, 13.8) }));
  out.push(captionNode(1, 'References', { ...TOP_ST, tableIndent: 0 }));
  const half = widthsOf([1, 1]);
  const rrows: PNode[][] = refs.length
    ? refs.map((r) => [{ text: withFallbackFonts([{ text: r.code }]) }, { text: withFallbackFonts([{ text: r.title }]) }])
    : [[{ text: 'None' }, { text: '' }]];
  out.push(tableNode([[bold('Chap No./Document No.'), bold('Title')], ...rrows], half, 1, 0, { frame: 'all', colsep: true, rowsep: true }));
  out.push({ text: ' ', fontSize: 0.1, lineHeight: 1, margin: m4(0, 0, 0, GAP.afterTable - 0.1) });
  return out;
}

// ------------------------------------------------------------------ running headers and footers
/** Style name given to every node of a header, footer or background, so the page-break pass can ignore them. */
const RUNNING_PART = 'runningPart';

function tagRunning(n: PNode): PNode {
  const out: PNode = { ...n, style: RUNNING_PART };
  if (Array.isArray(n.stack)) out.stack = (n.stack as PNode[]).map(tagRunning);
  if (Array.isArray(n.columns)) out.columns = (n.columns as PNode[]).map(tagRunning);
  return out;
}

interface Logo { data: string; w: number; h: number }

function headerNode(meta: SegMeta, page: number, frameW: number, S: PublicationSettings, logo: Logo | null): PNode {
  const recto = page % 2 === 1;
  const cls = S.classification || meta.classification;
  const right = S.headerText || meta.header;
  const text = (t: string, extra: PNode = {}): PNode => ({ text: withFallbackFonts([{ text: t }]), bold: true, fontSize: HEADER.size, lineHeight: 1, ...extra });
  // wrapped in a stack: an image's own `width` would otherwise override the width of the column it sits in
  const logoNode: PNode | null = logo
    ? { stack: [{ ...(/^data:image\/svg/i.test(logo.data) ? { svg: logo.data } : { image: logo.data }), width: logo.w, height: logo.h, alignment: recto ? 'left' : 'right' }] }
    : null;
  const blank: PNode = text('');
  const columns = [
    { width: '*', ...(recto ? logoNode ?? blank : text(right)) },
    { width: 'auto', ...text(cls, { alignment: 'center' }) },
    { width: '*', ...(recto ? text(right, { alignment: 'right' }) : logoNode ?? blank) },
  ];
  // pdfmake lays headers/footers out in a block that starts at the page's left margin (and, for the footer, at the
  // bottom margin), and shifts `absolutePosition` nodes by that origin too: plain flow with margins is the only
  // way to hit exact page coordinates, so every offset below is measured from the block's top.
  const top = HEADER.baseline - 0.718 * HEADER.size;
  const lineH = Math.max(0.925 * HEADER.size, logo ? HEADER.logoH : 0);
  return {
    stack: [
      { columns, columnGap: 0, margin: m4(0, top, 0, 0) },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: frameW, y2: 0, lineWidth: 0.5, lineColor: COLOR.rule }], margin: m4(0, HEADER.ruleY - top - lineH, 0, 0) },
    ],
    margin: m4(NOMINAL_MARGIN, 0, NOMINAL_MARGIN, 0),
  };
}

/**
 * "Applicable to: <text>" cut to what fits beside the data module code on the footer's first line. The text of a data
 * module with many configurations can be long; the full text stays in the document contents table.
 */
function applicLabel(applic: string, dmc: string, frameW: number, size: number): string {
  const head = 'Applicable to:';
  if (!applic) return head;
  const room = frameW - textWidth(dmc, size, true) - 12;
  const full = `${head} ${applic}`;
  if (textWidth(full, size) <= room) return full;
  const chars = Array.from(applic);
  while (chars.length > 1 && textWidth(`${head} ${chars.join('')}...`, size) > room) chars.pop();
  return `${head} ${chars.join('').trimEnd()}...`;
}

function footerNode(meta: SegMeta, page: number, frameW: number, pageH: number, S: PublicationSettings, lastPage: boolean): PNode {
  const recto = page % 2 === 1;
  const cls = S.classification || meta.classification;
  const base1 = lastPage ? FOOTER.base3 : FOOTER.base2;
  const lh = FOOTER.step / (0.925 * FOOTER.size);
  const t = (s: string, extra: PNode = {}): PNode => ({ text: withFallbackFonts([{ text: s }]), fontSize: FOOTER.size, lineHeight: lh, ...extra });
  const dmc = meta.dmc ? t(meta.dmc, { bold: true }) : t('');
  const pn = t(recto ? `${meta.date ? meta.date + ' ' : ''}Page ${page}` : `Page ${page}${meta.date ? ' ' + meta.date : ''}`, { bold: true });
  const appl = t(applicLabel(meta.applic, meta.dmc, frameW, FOOTER.size));
  const line1 = recto
    ? { columns: [{ width: '*', ...appl }, { width: 'auto', ...dmc, alignment: 'right' }], columnGap: 0 }
    : { columns: [{ width: 'auto', ...dmc }, { width: '*', ...appl, alignment: 'right', margin: m4(0, 0, 2.5, 0) }], columnGap: 0 };
  const mid = t(cls, { bold: true, alignment: 'center' });
  const line2 = recto
    ? { columns: [{ width: '*', ...t('') }, { width: 'auto', ...mid }, { width: '*', ...pn, alignment: 'right' }], columnGap: 0 }
    : { columns: [{ width: '*', ...pn }, { width: 'auto', ...mid }, { width: '*', ...t('') }], columnGap: 0 };
  const stack: PNode[] = [line1, line2];
  if (lastPage) stack.push(t('End of data module', { bold: true, alignment: 'center' }));
  // the footer is measured from the bottom of the sheet, so a landscape page (shorter) carries it as far from the edge
  const bottom = (y: number) => y - (PAGE_H - pageH);
  const blockTop = pageH - MARGIN_BOTTOM; // where pdfmake starts the footer block
  const ruleY = bottom(base1 - FOOTER.ruleGap) - blockTop;
  const textTop = bottom(base1 - 0.718 * FOOTER.size) - blockTop;
  return {
    stack: [
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: frameW, y2: 0, lineWidth: 0.5, lineColor: COLOR.rule }], margin: m4(0, ruleY, 0, 0) },
      { stack, margin: m4(0, textTop - ruleY, 0, 0) },
    ],
    margin: m4(NOMINAL_MARGIN, 0, NOMINAL_MARGIN, 0),
  };
}

function watermarkNode(text: string, w: number, h: number): PNode {
  const cx = w / 2;
  const cy = h / 2 + 4.3;
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text x="${cx}" y="${cy}" text-anchor="middle" transform="rotate(-45 ${cx} ${cy})" font-family="Helvetica" font-weight="bold" font-size="${WATERMARK_SIZE}" fill="${COLOR.watermark}" fill-opacity="${WATERMARK_OPACITY}">${esc}</text></svg>`,
    absolutePosition: { x: 0, y: 0 },
  };
}

// ------------------------------------------------------------------ document definition
interface Plan {
  dms: DmInput[];
  /** Every section of the publication as one or more runs of one page orientation (only data modules with landscape content have several). */
  segs: { meta: SegMeta; runs: Run[] }[];
}

function planPublication(dms: DmInput[], S: PublicationSettings, mode: PdfMode, info: LayoutInfo | null, imgs: { cover?: ResolvedImage }, lite: boolean): Plan {
  const segs: Plan['segs'] = [];
  const pubClass = S.classification || dms.map((d) => d.classification).find(Boolean) || '';
  const pubHeader = S.headerText || (dms[0].mic ? `${dms[0].mic} PUBLICATION` : '');
  const anyNotReleased = dms.some((d) => d.notReleased);
  const frontMeta = (id: string, kind: SegKind): SegMeta => ({
    id, kind, dmc: '', date: S.issueDate || dms.map((d) => d.date).sort().pop() || '', classification: pubClass, header: pubHeader, notReleased: anyNotReleased, applic: '',
  });
  if (mode === 'publication') {
    const portrait = (nodes: PNode[]): Run[] => [{ land: false, nodes }];
    segs.push({ meta: frontMeta('title', 'title'), runs: portrait(titlePage(S, dms, imgs, lite)) });
    segs.push({ meta: frontMeta('toc', 'toc'), runs: portrait(documentToc(dms, S, info)) });
    const loi = illustrationList(dms, info);
    if (loi.length) segs.push({ meta: frontMeta('loi', 'loi'), runs: portrait(loi) });
    const abbr = abbreviationList(dms);
    if (abbr.length) segs.push({ meta: frontMeta('abbr', 'abbr'), runs: portrait(abbr) });
  }
  for (const d of dms) {
    const runs = splitRuns([...dmOpening(d, info), ...d.body]);
    const notes = d.footnotes;
    if (notes.length) {
      const last = runs[runs.length - 1];
      if (last.land) runs.push({ land: false, nodes: notes });
      else last.nodes.push(...notes);
    }
    segs.push({
      meta: { id: d.id, kind: 'dm', dmc: d.dmc, date: d.date, classification: d.classification || pubClass, header: S.headerText || (d.mic ? `${d.mic} PUBLICATION` : pubHeader), notReleased: d.notReleased, applic: d.applic },
      runs,
    });
  }
  return { dms, segs };
}

function buildDefinition(plan: Plan, S: PublicationSettings, mode: PdfMode, info: LayoutInfo | null, lite: boolean, doc0: DmInput): PNode {
  const { segs } = plan;
  // page -> run of a section, from the previous pass. A page that belongs to no run is a blank page that lets the next one start
  // on a right-hand page (also between the portrait and the landscape runs of one data module).
  const ranges = segs.flatMap((s) => s.runs.map((_, k) => ({
    s, k, lastRun: k === s.runs.length - 1,
    first: info?.pageOf.get(runStart(s.meta.id, k)) ?? 0,
    last: info?.pageOf.get(runEnd(s.meta.id, k, s.runs.length)) ?? 0,
  })));
  const segOf = (page: number) => ranges.find((r) => r.first && page >= r.first && page <= r.last) ?? null;
  const logo: Logo | null = S.logo && !lite ? { data: S.logo, w: Math.round(HEADER.logoH * logoAspect(S.logo) * 100) / 100, h: HEADER.logoH } : null;
  const watermarkOn = (meta: SegMeta | null) => S.watermark === 'on' || (S.watermark === 'auto' && !!meta?.notReleased);

  const content: PNode[] = segs.flatMap((s, i) => s.runs.map((r, k): PNode => ({
    stack: [marker(runStart(s.meta.id, k)), ...r.nodes, marker(runEnd(s.meta.id, k, s.runs.length))],
    ...(i === 0 && k === 0 ? {} : { pageBreak: 'beforeEven', pageOrientation: r.land ? 'landscape' : 'portrait' }),
  })));

  const title = S.title || doc0.techName;
  return {
    pageSize: 'A4',
    pageMargins: [NOMINAL_MARGIN, MARGIN_TOP, NOMINAL_MARGIN, MARGIN_BOTTOM],
    info: { title, author: S.publisher || undefined, subject: `DMC-${doc0.dmc}`, creator: 'S1000D Studio', producer: 'S1000D Studio (pdfmake)' },
    styles: { [HEAD_PART]: {}, [RUNNING_PART]: {} },
    defaultStyle: { font: FONT_TEXT, fontSize: FS.body, lineHeight: LH, color: COLOR.text },
    background: (page: number, size: { width: number; height: number }) => {
      const r = segOf(page);
      if (info && !r) {
        return { style: RUNNING_PART, text: 'This page is intentionally left blank.', alignment: 'center', fontSize: 11.34, lineHeight: 1, absolutePosition: { x: 0, y: size.height / 2 + 8.8 - 0.718 * 11.34 } };
      }
      if (lite || !watermarkOn(r?.s.meta ?? null)) return null;
      return { ...watermarkNode(S.watermarkText || 'NOT RELEASED', size.width, size.height), style: RUNNING_PART };
    },
    header: (page: number, _count: number, size: { width: number }) => {
      const r = segOf(page);
      if (info && !r) return null;
      const meta = r?.s.meta ?? segs[0].meta;
      return tagRunning(headerNode(meta, page, size.width - 2 * NOMINAL_MARGIN, S, logo));
    },
    footer: (page: number, _count: number, size: { width: number; height: number }) => {
      const r = segOf(page);
      if (info && !r) return null;
      const meta = r?.s.meta ?? segs[0].meta;
      return tagRunning(footerNode(meta, page, size.width - 2 * NOMINAL_MARGIN, size.height, S, !!r && r.lastRun && page === r.last));
    },
    content,
  };
}

/** Intrinsic aspect ratio (w/h) of the header logo, so it is scaled to the header's height without distortion. */
function logoAspect(dataUrl: string): number {
  const m = /^data:image\/png;base64,(.{0,48})/i.exec(dataUrl);
  if (m) {
    try {
      const head = atob(m[1]);
      const be = (o: number) => (head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3);
      const w = be(16);
      const h = be(20);
      if (w > 0 && h > 0) return w / h;
    } catch { /* fall through */ }
  }
  return 4.6;
}

// ------------------------------------------------------------------ rendering
/** Thrown from the layout observer to stop a measuring pass before pdfkit renders anything. */
class LayoutDone extends Error {}

interface NodeInfoLike {
  id?: unknown;
  headlineLevel?: number;
  style?: unknown;
  text?: unknown;
  stack?: unknown;
  columns?: unknown;
  pages?: number;
  startPosition: { pageNumber: number };
}

/**
 * One pdfmake run. With `layoutOnly` the pass stops as soon as the layout is known (no PDF is produced): the first,
 * measuring pass only needs the page of every marker.
 */
async function renderPass(def: PNode, layoutOnly: boolean, hooks: AssembleHooks, knownPages?: number): Promise<{ buffer: Uint8Array | null; info: LayoutInfo }> {
  const pdfMake = await loadPdfMake();
  const batched = pdfMake.patches.applied.includes('page-break-batch');
  const pageOf = new Map<string, number>();
  let pageCount = 0;
  const hdr = def.header as (p: number, c: number, s: { width: number }) => PNode | null;
  def.header = (p: number, c: number, s: { width: number }) => {
    pageCount = Math.max(pageCount, c);
    return hdr(p, c, s);
  };
  // Keeps headings with what follows: a heading (headlineLevel) that would end a page with nothing after it moves to
  // the next page. The pages of all ids are read from the final layout (`onLayout`, patched pdfmake); with a stock
  // pdfmake they are recorded here instead (a node moved this way is offered once, so the page recorded is its new one).
  const isContent = (n: NodeInfoLike) =>
    n.headlineLevel === undefined && n.style !== HEAD_PART && n.style !== RUNNING_PART && n.stack !== true && !n.columns && !(typeof n.text === 'string' && n.text.trim() === '');
  let reported = 0;
  const phase = layoutOnly ? 'measure' : 'layout';
  hooks.onProgress?.({ phase, page: 0, pages: knownPages });
  const pageBreakBefore = (node: NodeInfoLike, api: { getFollowingNodesOnPage(): NodeInfoLike[]; getPreviousNodesOnPage(): unknown[] }) => {
    const at = node.startPosition.pageNumber;
    if (hooks.onProgress && at >= reported + 10) {
      reported = at;
      hooks.onProgress({ phase, page: at, pages: knownPages });
    }
    const orphan = node.headlineLevel !== undefined && !api.getFollowingNodesOnPage().some(isContent) && api.getPreviousNodesOnPage().length > 0;
    if (!batched && typeof node.id === 'string') pageOf.set(node.id, orphan ? node.startPosition.pageNumber + 1 : node.startPosition.pageNumber);
    return orphan;
  };
  pageBreakBefore.onLayout = (infos: NodeInfoLike[]) => {
    pageOf.clear();
    for (const n of infos) {
      if (typeof n.id === 'string') pageOf.set(n.id, n.startPosition.pageNumber);
      if (n.pages) pageCount = Math.max(pageCount, n.pages);
    }
    if (layoutOnly) throw new LayoutDone();
    hooks.onProgress?.({ phase: 'write', pages: pageCount });
  };
  def.pageBreakBefore = pageBreakBefore;
  // SVGtoPDF looks fonts up by raw family name and logs a loud warning for families that are not registered
  // even though the glyphs render fine; keep that internal, harmless warning out of the console.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('SVGElemText')) return;
    originalWarn(...args);
  };
  try {
    const buffer = await pdfMake.createPdf(def).getBuffer();
    return { buffer, info: { pageOf, pageCount } };
  } catch (e) {
    if (e instanceof LayoutDone) return { buffer: null, info: { pageOf, pageCount } };
    throw e;
  } finally {
    console.warn = originalWarn;
  }
}

/** Replaces every picture by an empty box of the same size: the measuring pass needs the geometry, not the pixels. */
function liteify(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(liteify);
  if (!v || typeof v !== 'object') return v;
  const n = v as PNode;
  if ((typeof n.image === 'string' || typeof n.svg === 'string') && typeof n.width === 'number' && typeof n.height === 'number') {
    const { image: _i, svg: _s, width: w, height: h, alignment: _a, ...rest } = n;
    void _i; void _s; void _a;
    return { ...rest, columns: [{ width: '*', text: '' }, { width: w, canvas: [{ type: 'rect', x: 0, y: 0, w, h, lineWidth: 0 }] }, { width: '*', text: '' }], columnGap: 0 };
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(n)) out[k] = liteify(n[k]);
  return out;
}

const coverOf = (S: PublicationSettings): { cover?: ResolvedImage } =>
  ({ cover: S.cover ? { kind: /^data:image\/svg/i.test(S.cover) ? 'svg' : 'raster', data: S.cover } : undefined });

/** Builds the pdfmake definition of one pass from the extracted data (exposed for tests). */
export function assembleDefinition(input: PublicationInput, info: LayoutInfo | null = null, lite = false): { def: PNode; plan: Plan } {
  const { settings: S, mode } = input;
  const dms = lite ? input.dms.map((d) => ({ ...d, body: liteify(d.body) as PNode[] })) : input.dms;
  const plan = planPublication(dms, S, mode, info, coverOf(S), lite);
  return { def: buildDefinition(plan, S, mode, info, lite, dms[0]), plan };
}

/**
 * Renders the publication. Layout passes repeat until the page of every marker is stable (normally two:
 * a measuring pass, then the final one), then the mirrored-margin transform is applied.
 */
export async function assemble(input: PublicationInput, hooks: AssembleHooks = {}): Promise<AssembleResult> {
  if (!input.dms.length) throw new Error('No data modules to export');
  const warnings = new Set<string>(input.warnings);
  let info: LayoutInfo | null = null;
  let buffer: Uint8Array | null = null;
  let passes = 0;
  for (let pass = 0; pass < 4; pass++) {
    const lite = pass === 0;
    const { def } = assembleDefinition(input, info, lite);
    // the measuring pass only needs the page of every marker: no PDF is produced for it
    const res = await renderPass(def, lite, hooks, info?.pageCount);
    passes++;
    if (res.buffer) buffer = res.buffer;
    const stable = info != null && sameInfo(info, res.info);
    info = res.info;
    if (stable && buffer) break;
  }
  if (passes >= 4) warnings.add('Page numbers in the contents lists may be off by a page: the layout did not settle.');
  hooks.onProgress?.({ phase: 'finish', pages: info!.pageCount });
  const mirrored = mirrorPages(buffer!, SHIFT);
  if (!mirrored) warnings.add('Mirrored margins could not be applied; the PDF uses symmetric margins.');
  const dmPages = input.dms.map((_, i) => ({ first: info!.pageOf.get(`start:dm${i}`) ?? 0, last: info!.pageOf.get(`end:dm${i}`) ?? 0 }));
  return { buffer: mirrored ?? buffer!, warnings: [...warnings], pages: info!.pageCount, mirrored: !!mirrored, passes, dmPages };
}

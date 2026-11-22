/**
 * S1000D data module content -> pdfmake nodes, typeset in the publication format.
 *
 * The walker mirrors the Design-view renderer's block/inline classification
 * (`core/display.ts`), so coverage follows the same rules and any S1000D
 * element without bespoke handling still produces sensible output (a stacked
 * block, or flattened inline text) instead of being silently dropped.
 *
 * Per-data-module numbering follows the reference: figures restart at "Fig 1"
 * and tables at "Table 1" in every data module, the References table that
 * opens each data module being Table 1, so a data module's first authored
 * (or generated) table is Table 2.
 */
import type { Grammar } from '../core/grammar';
import { BLOCK, HIDDEN } from '../core/display';
import { allowsText } from '../core/ops';
import { buildGrid, type Cell, type Grid } from '../core/table';
import { lengthToPt, parseColWidth } from '../core/units';
import { elementChildren, textOf } from '../core/xml';
import { dmRefLabel, find, formatDmc, readDmCode } from '../core/s1000d';
import { buildLabels, type LabelIndex } from '../view/labels';
import { applicIndex, dmApplicText } from './pdf-applic';
import { LAND_UNIT, turnUnits } from './pdf-landscape';
import { layoutName, vRuleWidth, type TableLook } from './pdf-layouts';
import { declaredRefs, emptyRepository, referencedIds, usedRefIds, type AttentionRef, type Repository } from './pdf-attention';
import { attachPunctuation, FONT_MONO, fontRuns, glueHyphens, type PNode, withFallbackFonts } from './pdf-metrics';
import {
  ADMON_INSET, COLOR, CONTENT_W, FS, GAP, INDENT, LAND_IMG_H, LAND_W, LH, NUM_COL_1, TABLE,
} from './pdf-theme';

export type { PNode };

// ------------------------------------------------------------------ context
export interface ResolvedImage {
  kind: 'svg' | 'raster';
  data: string;
  /** Natural size in points, when it could be determined. */
  w?: number;
  h?: number;
}

export interface TocEntry { id: string; text: string }
export interface NumberedEntry { id: string; no: number; title: string }
export interface FigureEntry extends NumberedEntry { icn: string }

export interface Collected {
  headings: TocEntry[];
  tables: NumberedEntry[];
  figures: FigureEntry[];
  acronyms: Map<string, string>;
}

export interface Cx {
  g: Grammar | null;
  labels: LabelIndex;
  tableNo: Map<Element, number>;
  images: Map<string, ResolvedImage>;
  prefix: string;
  ids: Map<Element, string>;
  nextId: number;
  footnotes: { n: number; content: PNode[] }[];
  warnings: Set<string>;
  collected: Collected;
  /** Layout-only pass: images become empty boxes of the same size (cheap, geometry-identical). */
  lite: boolean;
  /** `applic/@id` -> display text of this data module's applicability annotations. */
  applic: Map<string, string>;
  /** Applicability text of the whole data module ("" when it has none). */
  dmApplic: string;
  /** Warnings and cautions of every data module in the export, by identification number. */
  repo: Repository;
  /** This data module's `warningRef` / `cautionRef` declarations, by id. */
  attn: Map<string, AttentionRef>;
  /** Elements that are printed as one landscape block (see `pdf-landscape.ts`). */
  turn: Set<Element>;
}

export interface St {
  /** Heading depth of the enclosing levelled paragraph (0 = directly under the data module's section). */
  depth: number;
  /** Left indent of paragraph-level blocks. */
  indent: number;
  /** Left indent of tables (descriptive text indents them, preliminary requirements do not). */
  tableIndent: number;
  /** Inside a table cell. */
  cell: boolean;
  /** Width available to the block, for scaling images. */
  maxW: number;
  /** Inside a block that is printed on a landscape page. */
  land?: boolean;
  /** Tallest picture of a landscape block (what is left of the page after a heading carried onto it). */
  imgH?: number;
  /** Height that a heading carried onto the landscape page of this block takes from it. */
  headroom?: number;
}

/** What a section heading (one or two lines, with its spacing) takes from a landscape page it is carried onto. */
const HEAD_ROOM = 52;

/** Width of the text frame of the page the block is printed on. */
const frameW = (st: St): number => (st.land ? LAND_W : CONTENT_W);

export const TOP_ST: St = { depth: 0, indent: 0, tableIndent: INDENT, cell: false, maxW: CONTENT_W };

export function newCx(partial: Pick<Cx, 'g' | 'labels' | 'tableNo' | 'images' | 'prefix' | 'warnings' | 'lite' | 'applic' | 'dmApplic' | 'repo' | 'attn' | 'turn'>): Cx {
  return {
    ...partial,
    ids: new Map(),
    nextId: 1,
    footnotes: [],
    collected: { headings: [], tables: [], figures: [], acronyms: new Map() },
  };
}

export function idOf(cx: Cx, el: Element): string {
  const existing = cx.ids.get(el);
  if (existing) return existing;
  const id = `${cx.prefix}${el.getAttribute('id') || `n${cx.nextId++}`}`;
  cx.ids.set(el, id);
  return id;
}

// ------------------------------------------------------------------ units & images
function pngSize(b64: string): { w: number; h: number } | null {
  try {
    const head = atob(b64.slice(0, 48));
    if (head.charCodeAt(0) !== 0x89 || head.slice(1, 4) !== 'PNG') return null;
    const be = (o: number) => (head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3);
    return { w: be(16), h: be(20) };
  } catch {
    return null;
  }
}

function jpegSize(b64: string): { w: number; h: number } | null {
  try {
    const bin = atob(b64);
    if (bin.charCodeAt(0) !== 0xff || bin.charCodeAt(1) !== 0xd8) return null;
    let i = 2;
    while (i + 9 < bin.length) {
      if (bin.charCodeAt(i) !== 0xff) { i++; continue; }
      const marker = bin.charCodeAt(i + 1);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6), w: (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8) };
      }
      i += 2 + ((bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3));
    }
  } catch { /* fall through */ }
  return null;
}

function svgSize(svg: string): { w: number; h: number } | null {
  const head = svg.slice(0, 2000);
  const attr = (n: string) => new RegExp(`<svg[^>]*\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(head)?.[1] ?? null;
  const w = lengthToPt(attr('width')?.replace(/%$/, '') ?? null);
  const h = lengthToPt(attr('height')?.replace(/%$/, '') ?? null);
  if (w && h && !/%/.test(attr('width') ?? '') && !/%/.test(attr('height') ?? '')) return { w: w / 0.75, h: h / 0.75 };
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  return null;
}

/** Natural pixel size of an image data URL / SVG text. */
export function naturalSize(kind: 'svg' | 'raster', data: string): { w: number; h: number } | null {
  if (kind === 'svg') return svgSize(data);
  const m = /^data:image\/([a-z+.-]+);base64,(.*)$/is.exec(data);
  if (!m) return null;
  return /png/i.test(m[1]) ? pngSize(m[2]) : /jpe?g/i.test(m[1]) ? jpegSize(m[2]) : null;
}

/**
 * Final size (pt) of a graphic: S1000D reproductionWidth/Height (mm, cm, in, pt, pc, px) when present, else
 * reproductionScale of the natural size, else the natural size at 96 dpi; always scaled down (aspect kept) to fit.
 */
export function graphicSize(g: Element | null, nat: { w: number; h: number } | null, maxW: number, maxH = 560): { w: number; h: number } {
  const rw = lengthToPt(g?.getAttribute('reproductionWidth') ?? null);
  const rh = lengthToPt(g?.getAttribute('reproductionHeight') ?? null);
  const scale = parseFloat(g?.getAttribute('reproductionScale') ?? '') || 100;
  const aspect = nat ? nat.w / nat.h : 4 / 3;
  let w: number;
  let h: number;
  if (rw && rh) { w = rw; h = rh; }
  else if (rw) { w = rw; h = rw / aspect; }
  else if (rh) { h = rh; w = rh * aspect; }
  else if (nat) { w = nat.w * 0.75 * (scale / 100); h = nat.h * 0.75 * (scale / 100); }
  else { w = 360; h = 270; }
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: w * k, h: h * k };
}

function placeholder(label: string, note: string, w: number, h: number): PNode {
  return {
    table: { widths: [w], heights: [h], body: [[{ stack: [
      { text: label || '(no ICN)', alignment: 'center', fontSize: 9, color: COLOR.muted, font: FONT_MONO },
      { text: note, alignment: 'center', fontSize: 8, italics: true, color: COLOR.muted, margin: [0, 2, 0, 0] },
    ], margin: [4, Math.max(2, h / 2 - 16), 4, 2] }]] },
    layout: 'box',
    alignment: 'center',
    margin: [0, 0, 0, 0],
  };
}

/** `box`: fit the image into this box (enlarging it if need be), as the cover picture is; otherwise the S1000D reproduction size applies. */
export function imageNode(icn: string, g: Element | null, cx: Pick<Cx, 'images' | 'lite' | 'warnings'>, st: St, inline = false, box?: { w: number; h: number }): PNode {
  const r = cx.images.get(icn) ?? cx.images.get(icn.toUpperCase());
  if (!r) {
    const sz = graphicSize(g, null, st.maxW, 300);
    return placeholder(icn, 'Image not linked', Math.min(sz.w, st.maxW), Math.min(sz.h, 200));
  }
  const nat = r.w && r.h ? { w: r.w, h: r.h } : naturalSize(r.kind, r.data);
  const aspect = nat ? nat.w / nat.h : 4 / 3;
  const sz = box ? { w: Math.min(box.w, box.h * aspect), h: Math.min(box.h, box.w / aspect) } : graphicSize(inline ? null : g, nat, inline ? 40 : st.maxW, st.land ? st.imgH ?? LAND_IMG_H : undefined);
  const w = Math.round(sz.w * 100) / 100;
  const h = Math.round(sz.h * 100) / 100;
  if (!box && !inline && g && ['reproductionWidth', 'reproductionHeight', 'reproductionScale'].some((a) => g.hasAttribute(a))) {
    // the author asked for a size that the page cannot take: say so, and how to get a bigger picture
    const asked = graphicSize(g, nat, Infinity, Infinity);
    if (sz.w < asked.w * 0.98) {
      const pct = Math.round((sz.w / asked.w) * 100);
      cx.warnings.add(`Graphic "${icn}" is larger than the ${st.land ? 'landscape ' : ''}page allows and was reduced to ${pct} % of its reproduction size${st.land ? '' : ' (mark its figure orient="land", or wrap it in a foldout, to print it on a landscape page)'}.`);
    }
  }
  if (cx.lite) {
    return { columns: [{ width: '*', text: '' }, { width: w, canvas: [{ type: 'rect', x: 0, y: 0, w, h, lineWidth: 0 }] }, { width: '*', text: '' }], columnGap: 0 };
  }
  return r.kind === 'svg' ? { svg: r.data, width: w, height: h, alignment: 'center' } : { image: r.data, width: w, height: h, alignment: 'center' };
}

// ------------------------------------------------------------------ inline
/** Stamps an emphasis style directly onto each already-built inline run. */
function applyEmphasis(type: string, run: PNode): PNode {
  const out: PNode = { ...run };
  switch (type) {
    case 'em02': out.italics = true; break;
    case 'em03': out.decoration = 'underline'; break;
    case 'em04': out.decoration = 'overline'; break;
    case 'em05': out.decoration = 'lineThrough'; break;
    case 'em06': out.bold = true; out.italics = true; break;
    case 'em07': out.decoration = 'underline'; out.bold = true; break;
    default: out.bold = true;
  }
  return out;
}

/** The text a cross-reference prints: "Figure 2", "Table 3", "Step 1.2"; an authored label always wins. */
export function refLabel(ref: Element, cx: Cx): string {
  const own = textOf(ref);
  if (own) return own;
  const id = ref.getAttribute('internalRefId') ?? '';
  const target = id ? cx.labels.byId.get(id) : undefined;
  if (!target) return id ? `[unresolved reference ${id}]` : '[reference without target]';
  const n = cx.labels.numbers.get(target);
  // a no-break space keeps "Figure 1" / "Para 2.1" together at a line end
  switch (target.nodeName) {
    case 'figure': return `Figure\u00A0${n ?? '?'}`;
    case 'graphic': return n ? `Figure\u00A0${n}` : 'Graphic';
    case 'table': return `Table\u00A0${cx.tableNo.get(target) ?? n ?? '?'}`;
    default: return cx.labels.label(target).replace(' ', '\u00A0');
  }
}

function pubText(el: Element): string {
  const code = textOf(find(el, 'externalPubCode'));
  const title = textOf(find(el, 'externalPubTitle'));
  const issue = textOf(find(el, 'externalPubIssue'));
  return [code, title, issue && `Issue ${issue}`].filter(Boolean).join(', ');
}

function pmCodeText(el: Element): string {
  const c = find(el, 'pmCode');
  if (!c) return '';
  return ['modelIdentCode', 'pmIssuer', 'pmNumber', 'pmVolume'].map((a) => c.getAttribute(a) ?? '').filter(Boolean).join('-');
}

function renderInlineChildren(el: Element, cx: Cx, upper = false): PNode[] {
  const out: PNode[] = [];
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      const t = c.nodeValue ?? '';
      if (t) out.push({ text: upper ? t.toUpperCase() : t });
      continue;
    }
    if (c.nodeType !== 1) continue;
    out.push(...renderInline(c as Element, cx, upper));
  }
  return out;
}

function renderInline(el: Element, cx: Cx, upper = false): PNode[] {
  const name = el.nodeName;
  if (HIDDEN.has(name)) return [];
  const U = (s: string) => (upper ? s.toUpperCase() : s);
  switch (name) {
    case 'emphasis': {
      const type = el.getAttribute('emphasisType') ?? 'em01';
      return renderInlineChildren(el, cx, upper).map((r) => applyEmphasis(type, r));
    }
    case 'subScript': return [{ text: textOf(el), sub: true }];
    case 'superScript': return [{ text: textOf(el), sup: true }];
    case 'internalRef': {
      const label = refLabel(el, cx);
      const targetId = el.getAttribute('internalRefId');
      const target = targetId ? cx.labels.byId.get(targetId) : undefined;
      const run: PNode = { text: U(label), color: label.startsWith('[') ? '#c8102e' : COLOR.link };
      if (target) run.linkToDestination = idOf(cx, target);
      return [run];
    }
    case 'dmRef': {
      const l = dmRefLabel(el);
      return [{ text: U(l.title ? `${l.dmc} — ${l.title}` : l.dmc), color: COLOR.link }];
    }
    case 'pmRef': {
      const code = pmCodeText(el);
      const title = textOf(find(el, 'pmTitle'));
      return [{ text: U([code && `PMC-${code}`, title].filter(Boolean).join(' — ') || '[publication module reference]'), color: COLOR.link }];
    }
    case 'externalPubRef':
      return [{ text: U(pubText(el) || textOf(el) || '[external publication reference]'), color: COLOR.link }];
    case 'acronym': {
      const term = elementChildren(el).find((c) => c.nodeName === 'acronymTerm');
      const def = elementChildren(el).find((c) => c.nodeName === 'acronymDefinition');
      const t = textOf(term ?? null);
      const d = textOf(def ?? null);
      if (t && d && !cx.collected.acronyms.has(t)) cx.collected.acronyms.set(t, d);
      const out: PNode[] = [{ text: U(t) }];
      if (d) out.push({ text: U(` (${d})`) });
      return out;
    }
    case 'verbatimText':
      return [{ text: el.textContent ?? '', font: FONT_MONO, fontSize: 9.5, preserveLeadingSpaces: true }];
    case 'footnote': {
      const num = cx.footnotes.length + 1;
      cx.footnotes.push({ n: num, content: renderMixed(el, cx, { ...TOP_ST, cell: true }) });
      return [{ text: `[${num}]`, sup: true, color: COLOR.link }];
    }
    case 'symbol':
      return [{ text: textOf(el) || '' }];
    case 'indexFlag':
      return [];
    case 'quantity':
      return [{ text: U(textOf(el)) }];
    default:
      // Unknown inline element (changeInline, inlineSignificantData, zoneRef, functionalItemRef…): flatten its text.
      return renderInlineChildren(el, cx, upper);
  }
}

// ------------------------------------------------------------------ paragraphs
const margin = (l: number, t: number, r: number, b: number) => [l, t, r, b];

export function paraNode(runs: PNode[], st: St, extra: PNode = {}): PNode {
  const m = st.cell ? margin(0, 0, 0, GAP.cellPara) : margin(st.indent, 0, 0, GAP.para);
  return { text: st.cell ? withFallbackFonts(runs) : glueHyphens(attachPunctuation(withFallbackFonts(runs)), st.maxW), alignment: st.cell ? 'left' : 'justify', lineHeight: LH, margin: m, ...extra };
}

/** Splits an element's mixed content into paragraph(s) interleaved with any true block children. */
export function renderMixed(el: Element, cx: Cx, st: St, upper = false): PNode[] {
  const out: PNode[] = [];
  let buf: PNode[] = [];
  const flush = () => {
    if (buf.length && buf.some((r) => (typeof r.text === 'string' ? r.text.trim() : true))) {
      // trim the paragraph's leading/trailing whitespace so a pretty-printed source does not indent the first line
      const first = buf[0];
      if (typeof first.text === 'string') first.text = first.text.replace(/^\s+/, '');
      const last = buf[buf.length - 1];
      if (typeof last.text === 'string') last.text = last.text.replace(/\s+$/, '');
      out.push(paraNode(buf, st));
    }
    buf = [];
  };
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      const t = c.nodeValue ?? '';
      if (t) buf.push({ text: upper ? t.toUpperCase() : t });
      continue;
    }
    if (c.nodeType !== 1) continue;
    const child = c as Element;
    const name = child.nodeName;
    if (HIDDEN.has(name)) continue;
    if (BLOCK.has(name) && name !== 'title') {
      flush();
      out.push(...renderElement(child, cx, st));
    } else buf.push(...renderInline(child, cx, upper));
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ headings
/** Style name of the cells of a heading row, so the page-break pass can tell them from the content after the heading. */
export const HEAD_PART = 'headPart';

export function heading(text: PNode[] | string, kind: 'center' | 'section' | 'sub', extra: PNode = {}): PNode {
  const runs = typeof text === 'string' ? [{ text }] : text;
  // headlineLevel marks a heading that must not be the last thing on a page (see renderPass in pdf-publication.ts)
  if (kind === 'center') return { text: withFallbackFonts(runs), bold: true, fontSize: FS.h2, alignment: 'center', lineHeight: LH, margin: margin(0, 0, 0, GAP.headAfter), headlineLevel: 1, ...extra };
  if (kind === 'section') return { text: withFallbackFonts(runs), bold: true, fontSize: FS.h1, lineHeight: LH, margin: margin(0, 6.3, 0, 7.35), headlineLevel: 1, ...extra };
  return { text: withFallbackFonts(runs), bold: true, fontSize: FS.body, lineHeight: LH, headlineLevel: 1, ...extra };
}

function renderLevelledPara(el: Element, cx: Cx, st: St): PNode[] {
  const depth = st.depth + 1;
  const titleEl = elementChildren(el).find((c) => c.nodeName === 'title');
  const num = cx.labels.numbers.get(el) ?? '';
  const titleRuns = titleEl ? renderInlineChildren(titleEl, cx) : [{ text: '(untitled)', italics: true }];
  const numW = depth >= 2 ? INDENT : NUM_COL_1;
  const head: PNode = {
    columns: [
      { width: numW, text: num, bold: true, fontSize: FS.body, lineHeight: LH, style: HEAD_PART },
      { width: '*', text: withFallbackFonts(titleRuns), bold: true, fontSize: FS.body, lineHeight: LH, style: HEAD_PART },
    ],
    columnGap: 0,
    margin: margin(0, GAP.headBefore, 0, GAP.headAfter),
    id: idOf(cx, el),
    headlineLevel: 1,
  };
  const childSt: St = { ...st, depth, indent: depth >= 2 ? INDENT : 0, maxW: frameW(st) - (depth >= 2 ? INDENT : 0) };
  const rest = elementChildren(el).filter((c) => c !== titleEl);
  const lead = leadNodes(el, cx, childSt);
  return carryHeading([head], [...lead, ...rest.flatMap((c, i) => renderElement(c, cx, i === 0 && !lead.length ? carried(c, cx, childSt) : childSt))]);
}

/** Style for the first block under a heading: when it turns, the heading comes along and the picture has to leave room for it. */
function carried(c: Element, cx: Cx, st: St): St {
  return cx.turn.has(c) ? { ...st, headroom: HEAD_ROOM } : st;
}

/**
 * A heading directly followed by a landscape block goes onto the landscape page with it: left behind it would print alone
 * on a portrait page of its own (the reference pipeline carries a section title into the next run for the same reason).
 */
function carryHeading(head: PNode[], body: PNode[]): PNode[] {
  const first = body[0];
  if (first && first[LAND_UNIT]) return [{ ...first, stack: [...head, ...(first.stack as PNode[])] }, ...body.slice(1)];
  return [...head, ...body];
}

// ------------------------------------------------------------------ lists
function listMarker(el: Element, kind: 'ul' | 'ol', idx: number, prefixAttr: string | null): string {
  if (kind === 'ol') {
    switch (prefixAttr) {
      case 'pf05': return `${String.fromCharCode(97 + (idx % 26))})`; // lower alpha
      case 'pf06': return `${String.fromCharCode(65 + (idx % 26))})`;
      default: return String(idx + 1);
    }
  }
  void el;
  switch (prefixAttr) {
    case 'pf01': return '';
    case 'pf02': return '•';
    default: return '–';
  }
}

function renderList(el: Element, cx: Cx, st: St, kind: 'ul' | 'ol'): PNode[] {
  const items = elementChildren(el).filter((c) => ['listItem', 'attentionRandomListItem', 'attentionSequentialListItem'].includes(c.nodeName));
  const prefix = el.getAttribute('listItemPrefix');
  const hang = kind === 'ol' ? 21.7 : 14.2;
  const out: PNode[] = items.map((it, i) => {
    const body = renderMixed(it, cx, { ...st, indent: 0, maxW: st.maxW - hang, cell: true });
    const stack = body.length ? body : [{ text: '' }];
    const last = i === items.length - 1;
    return {
      columns: [{ width: hang, text: listMarker(it, kind, i, prefix), fontSize: FS.body, lineHeight: LH }, { width: '*', stack }],
      columnGap: 0,
      margin: margin(st.cell ? 0 : st.indent, 0, 0, last ? GAP.para : GAP.listItem),
    };
  });
  return out;
}

function renderDefinitionList(el: Element, cx: Cx, st: St): PNode[] {
  const items = elementChildren(el).filter((c) => c.nodeName === 'definitionListItem');
  const hdr = elementChildren(el).find((c) => c.nodeName === 'definitionListHeader');
  const w1 = Math.round((st.maxW - st.indent) * 0.3);
  const w2 = st.maxW - st.indent - w1;
  const body: PNode[][] = [];
  if (hdr) {
    body.push([
      { text: withFallbackFonts(renderInlineChildren(find(hdr, 'termTitle') ?? hdr, cx)), bold: true },
      { text: withFallbackFonts(renderInlineChildren(find(hdr, 'definitionTitle') ?? hdr, cx)), bold: true },
    ]);
  }
  for (const it of items) {
    const term = elementChildren(it).find((c) => c.nodeName === 'listItemTerm');
    const def = elementChildren(it).find((c) => c.nodeName === 'listItemDefinition');
    body.push([
      { text: withFallbackFonts(term ? renderInlineChildren(term, cx) : []), bold: true },
      { stack: def ? renderMixed(def, cx, { ...st, indent: 0, cell: true, maxW: w2 }) : [{ text: '' }] },
    ]);
  }
  if (!body.length) return [];
  return [tableNode(body, [w1, w2], hdr ? 1 : 0, st.cell ? 0 : st.indent, { frame: 'all', colsep: true, rowsep: true }), afterTable(st.cell ? 0 : GAP.afterTable)];
}

// ------------------------------------------------------------------ steps
function renderStep(el: Element, cx: Cx, st: St): PNode[] {
  const num = cx.labels.numbers.get(el) ?? '';
  const label = /\./.test(num) ? num : `${num}.`;
  const hang = Math.max(28.35, 8 + label.length * 6.2);
  const kids = elementChildren(el);
  const titleEl = kids.find((k) => k.nodeName === 'title');
  const bodyKids = kids.filter((k) => k !== titleEl);
  const inner: St = { ...st, indent: 0, maxW: st.maxW - hang, cell: false, tableIndent: 0 };
  const stack: PNode[] = [...leadNodes(el, cx, inner)];
  if (titleEl) stack.push({ text: withFallbackFonts(renderInlineChildren(titleEl, cx)), bold: true, lineHeight: LH, margin: margin(0, 0, 0, GAP.cellPara) });
  for (const k of bodyKids) stack.push(...renderElement(k, cx, inner));
  return [{
    columns: [{ width: hang, text: label, fontSize: FS.body, lineHeight: LH, bold: false }, { width: '*', stack: stack.length ? stack : [{ text: '' }] }],
    columnGap: 0,
    margin: margin(st.cell ? 0 : st.indent, 0, 0, 0),
    id: idOf(cx, el),
  }];
}

// ------------------------------------------------------------------ admonitions
const CHAR_SPACING = 0.55;

function admonitionLabel(kind: 'warning' | 'caution' | 'note'): string {
  return kind === 'note' ? 'NOTE' : kind === 'warning' ? 'WARNING' : 'CAUTION';
}

/** The inset of an admonition's text (1 cm; deeper inside indented text) and the style its paragraphs are set in. */
function admonitionSt(st: St): { left: number; right: number; inner: St } {
  const left = st.cell ? 0 : st.indent + (st.indent > 0 ? 19.85 : ADMON_INSET);
  const right = st.cell ? 0 : ADMON_INSET;
  return { left, right, inner: { ...st, indent: 0, cell: true, maxW: st.maxW - left - right } };
}

/** One paragraph of a warning, caution or note: bold capitals with the reference's slightly open letter spacing. */
function admonitionPara(runs: PNode[], inner: St): PNode {
  return {
    text: glueHyphens(withFallbackFonts(runs), inner.maxW), bold: true, characterSpacing: CHAR_SPACING, alignment: 'justify',
    lineHeight: LH, margin: margin(0, 0, 0, GAP.cellPara),
  };
}

/**
 * Pictograms of a warning/caution (`symbol/@infoEntityIdent`), centred above its label when the graphic is linked.
 * An unlinked symbol is left out: unlike a figure it carries no information the text does not.
 */
function symbolNodes(symbols: Element[], cx: Cx, st: St): PNode[] {
  const out: PNode[] = [];
  for (const sym of symbols) {
    const icn = sym.getAttribute('infoEntityIdent') ?? '';
    if (icn && (cx.images.has(icn) || cx.images.has(icn.toUpperCase()))) out.push({ ...imageNode(icn, null, cx, st, false, { w: 34, h: 34 }), margin: margin(0, 0, 0, 3) });
  }
  return out;
}

/** The block of a warning, caution or note: centred label (underlined for warning/caution), then the text. */
function admonition(kind: 'warning' | 'caution' | 'note', symbols: Element[], body: PNode[], cx: Cx, st: St, note: PNode[] = []): PNode[] {
  const { left, right } = admonitionSt(st);
  // label, symbol and text stay together on one page
  return [{
    unbreakable: true,
    stack: [
      ...note,
      ...symbolNodes(symbols, cx, st),
      {
        text: admonitionLabel(kind), bold: true, alignment: 'center', decoration: kind === 'note' ? undefined : 'underline', fontSize: FS.body, lineHeight: LH,
        margin: margin(0, 0, 0, 5), characterSpacing: 0,
      },
      { stack: body, margin: margin(left, 0, right, 8) },
    ],
  }];
}

function renderAdmonition(el: Element, cx: Cx, st: St, kind: 'warning' | 'caution' | 'note'): PNode[] {
  const { inner } = admonitionSt(st);
  const body: PNode[] = [];
  for (const c of elementChildren(el)) {
    if (c.nodeName === 'symbol') continue;
    if (['warningAndCautionPara', 'notePara'].includes(c.nodeName)) body.push(admonitionPara(renderInlineChildren(c, cx, true), inner));
    else body.push(...renderElement(c, cx, inner).map((n) => ({ bold: true, characterSpacing: CHAR_SPACING, ...n })));
  }
  return admonition(kind, elementChildren(el).filter((c) => c.nodeName === 'symbol'), body, cx, st, applicNote(el, cx, st));
}

/**
 * A warning or caution that is only referenced (`warningRef` / `cautionRef`): the repository's text when the data module
 * that holds it is part of the export, else its reference number.
 */
function referencedAdmonition(ref: AttentionRef, cx: Cx, st: St): PNode[] {
  const spec = (ref.kind === 'warning' ? cx.repo.warnings : cx.repo.cautions).get(ref.ident);
  const { inner } = admonitionSt(st);
  if (spec) return admonition(ref.kind, spec.symbols, spec.paras.map((p) => admonitionPara(renderInlineChildren(p, cx, true), inner)), cx, st);
  cx.warnings.add(`The ${ref.kind} "${ref.ident}" is defined in a ${ref.kind}s repository data module that is not part of this export: its reference number is printed instead of its text.`);
  return admonition(ref.kind, [], [admonitionPara([{ text: `Refer to ${ref.kind} ${ref.ident}.` }], inner)], cx, st);
}

/** Warnings and cautions attached to `el` with `warningRefs` / `cautionRefs`, printed before its own content. */
function attachedAttention(el: Element, cx: Cx, st: St): PNode[] {
  const out: PNode[] = [];
  for (const id of referencedIds(el)) {
    const ref = cx.attn.get(id);
    if (!ref) {
      cx.warnings.add(`${el.nodeName} points at the warning or caution "${id}", which warningsAndCautionsRef does not declare: it is not printed.`);
      continue;
    }
    out.push(...referencedAdmonition(ref, cx, st));
  }
  return out;
}

/**
 * "Applicable to: ..." for content that is valid only for part of what the data module covers (`applicRefId`). Nothing
 * is printed when the annotation says the same as the data module's own applicability.
 */
export function applicNote(el: Element, cx: Cx, st: St): PNode[] {
  const id = el.getAttribute('applicRefId');
  const text = id ? cx.applic.get(id) : undefined;
  if (!text || text.toLowerCase() === cx.dmApplic.toLowerCase()) return [];
  return [{
    text: withFallbackFonts([{ text: `Applicable to: ${text}` }]), italics: true, fontSize: FS.small, lineHeight: LH,
    margin: margin(st.cell ? 0 : st.indent, 0, 0, 3), headlineLevel: 1,
  }];
}

/** What is printed ahead of an element's own content: its applicability note and the warnings attached to it. */
function leadNodes(el: Element, cx: Cx, st: St): PNode[] {
  return [...applicNote(el, cx, st), ...attachedAttention(el, cx, st)];
}

// ------------------------------------------------------------------ figures & graphics
function renderFigure(el: Element, cx: Cx, st: St): PNode[] {
  const titleEl = elementChildren(el).find((c) => c.nodeName === 'title');
  const graphics = elementChildren(el).filter((c) => c.nodeName === 'graphic');
  const num = cx.labels.numbers.get(el);
  const maxW = st.cell ? st.maxW : frameW(st);
  const imgSt: St = { ...st, maxW };
  const parts: PNode[] = [];
  const list = graphics.length ? graphics : [null];
  list.forEach((g, i) => {
    const icn = g?.getAttribute('infoEntityIdent') ?? '';
    parts.push({ ...imageNode(icn, g, cx, imgSt), margin: margin(0, 4, 0, 0) });
    if (icn) {
      parts.push({ text: withFallbackFonts([{ text: icn }]), alignment: 'center', fontSize: FS.icn, lineHeight: LH, margin: margin(0, 4, 0, i === list.length - 1 ? 0 : GAP.listItem) });
    }
  });
  const title = titleEl ? renderInlineChildren(titleEl, cx) : [];
  const id = idOf(cx, el);
  const text = `${titleEl ? textOf(titleEl) : ''}`;
  cx.collected.figures.push({ id, no: Number(num) || cx.collected.figures.length + 1, title: text, icn: graphics[0]?.getAttribute('infoEntityIdent') ?? '' });
  parts.push({
    text: withFallbackFonts([{ text: `Fig ${num ?? ''}${title.length ? ' ' : ''}` }, ...title]), italics: true, alignment: 'center', fontSize: FS.body,
    lineHeight: LH, margin: margin(0, 4, 0, GAP.para), id,
  });
  return [{ stack: parts, unbreakable: false, margin: margin(st.cell ? 0 : 0, 0, 0, 0) }];
}

// ------------------------------------------------------------------ tables
/**
 * `widths` are the columns' outer widths (padding and rules included); pdfmake's are content widths, with the padding
 * and the vertical rules added on top, so they are reduced here and the table spans exactly `sum(widths)`.
 */
export function tableNode(body: PNode[][], widths: number[], headerRows: number, indent: number, look: TableLook, borderless = false): PNode {
  // pdfmake throws on a table without rows or columns (an empty CALS tgroup, say): print nothing instead
  if (!body.length || !widths.length || !body[0].length) return { text: '', fontSize: 0.1, lineHeight: 1 };
  const n = widths.length;
  const pad = borderless ? 0 : TABLE.padX;
  const rule = (i: number) => vRuleWidth(look, borderless, n, i);
  const inner = widths.map((w, i) => Math.max(6, w - 2 * pad - rule(i) - (i === n - 1 ? rule(n) : 0)));
  return {
    table: { headerRows: headerRows || undefined, widths: inner, body, dontBreakRows: true },
    layout: layoutName(look, borderless),
    fontSize: FS.table,
    lineHeight: LH,
    margin: margin(indent, 0, 0, 0),
  };
}

/** Column widths in points: fixed lengths first, the rest shared by weight ("2*"); "1*+10pt" is a fixed part plus a weighted part. */
function proportionalWidths(colwidths: (string | null)[], total: number): number[] {
  const n = colwidths.length;
  const parsed = colwidths.map((w) => {
    const p = parseColWidth(w);
    return p && (p.star > 0 || p.pt > 0) ? p : { star: 1, pt: 0 };
  });
  const fixed = parsed.reduce((a, p) => a + p.pt, 0);
  const flexWeight = parsed.reduce((a, p) => a + p.star, 0);
  const remaining = flexWeight ? Math.max(total - fixed, total * 0.1) : 0;
  let out = parsed.map((p) => p.pt + (flexWeight ? (remaining * p.star) / flexWeight : 0));
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum > total || (!flexWeight && n > 0)) out = out.map((w) => (w * total) / (sum || 1));
  return out.map((w) => Math.round(w * 100) / 100);
}

const ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'left', char: 'left' };
const VALIGN: Record<string, string> = { top: 'top', middle: 'middle', bottom: 'bottom' };

function renderTgroup(tg: Element, cx: Cx, st: St, tableEl: Element | null): PNode {
  const grid: Grid = buildGrid(tg);
  const avail = st.cell ? st.maxW : frameW(st) - st.tableIndent;
  const widths = grid.colspecs.length === grid.cols
    ? proportionalWidths(grid.colspecs.map((s) => s.getAttribute('colwidth')), avail)
    : Array<number>(grid.cols).fill(Math.round((avail / Math.max(1, grid.cols)) * 100) / 100);
  const seen = new Set<Cell>();
  const headRows = grid.rows.filter((r) => (r.parentNode as Element)?.nodeName === 'thead').length;
  const isOff = (v: string | null | undefined) => v === '0' || v === 'no';
  const look: TableLook = {
    frame: tableEl?.getAttribute('frame') ?? 'all',
    colsep: !isOff(tg.getAttribute('colsep') ?? tableEl?.getAttribute('colsep')),
    rowsep: !isOff(tg.getAttribute('rowsep') ?? tableEl?.getAttribute('rowsep')),
  };
  const body: PNode[][] = grid.rows.map((row, r) => {
    const out: PNode[] = [];
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.at[r][c];
      if (!cell || seen.has(cell)) { out.push({}); continue; }
      seen.add(cell);
      const colSpec = grid.colspecs[c];
      const align = ALIGN[(cell.entry.getAttribute('align') ?? row.getAttribute('align') ?? colSpec?.getAttribute('align') ?? tg.getAttribute('align') ?? 'left').toLowerCase()] ?? 'left';
      const valign = VALIGN[(cell.entry.getAttribute('valign') ?? row.getAttribute('valign') ?? 'top').toLowerCase()] ?? 'top';
      let cw = 0;
      for (let k = 0; k < cell.colspan; k++) cw += widths[c + k] ?? 0;
      const content = renderMixed(cell.entry, cx, { ...st, indent: 0, cell: true, maxW: cw - 2 * TABLE.padX });
      // cell paragraphs default to left alignment: the entry's / column's `align` replaces it (images, lists keep theirs)
      const aligned = content.map((n) => (n.alignment === 'justify' || n.alignment == null || n.alignment === 'left' ? { ...n, alignment: align } : n));
      const node: PNode = { stack: aligned.length ? aligned : [{ text: '' }], verticalAlignment: valign };
      if (cell.colspan > 1) node.colSpan = cell.colspan;
      if (cell.rowspan > 1) node.rowSpan = cell.rowspan;
      if (headRows && r < headRows) node.bold = true;
      out.push(node);
    }
    return out;
  });
  return tableNode(body, widths, headRows, st.cell ? 0 : st.tableIndent, look);
}

export function captionNode(no: number, title: string, st: St, extra: PNode = {}): PNode {
  return {
    text: withFallbackFonts([{ text: `Table ${no}${title ? ' ' + title : ''}` }]), italics: true, alignment: 'center', fontSize: FS.body, lineHeight: LH,
    margin: margin(st.tableIndent, 0, 0, GAP.caption),
    headlineLevel: 1,
    ...extra,
  };
}

function renderTableElement(el: Element, cx: Cx, st: St): PNode[] {
  const titleEl = elementChildren(el).find((c) => c.nodeName === 'title');
  const tgs = elementChildren(el).filter((c) => c.nodeName === 'tgroup');
  const no = cx.tableNo.get(el) ?? 0;
  const title = titleEl ? textOf(titleEl) : '';
  const id = idOf(cx, el);
  cx.collected.tables.push({ id, no, title });
  const out: PNode[] = [];
  if (!st.cell) out.push(captionNode(no, title, st, { id }));
  for (const tg of tgs) {
    out.push(renderTgroup(tg, cx, st, el));
    out.push(afterTable(st.cell ? 0 : GAP.afterTable));
  }
  return out;
}

/** Spacer after a table: the reference leaves 10.4 pt before whatever follows. */
function afterTable(h: number = GAP.afterTable): PNode {
  return { text: ' ', fontSize: 0.1, lineHeight: 1, margin: margin(0, 0, 0, Math.max(0, h - 0.1)) };
}

/** A generated table (preliminary requirements): numbered and listed like an authored one. */
function generatedTable(cx: Cx, el: Element, title: string, header: string[], widths: number[], rows: PNode[][], st: St, numbered = true): PNode[] {
  const no = numbered ? cx.tableNo.get(el) ?? 0 : 0;
  const out: PNode[] = [];
  if (numbered) {
    const id = idOf(cx, el);
    cx.collected.tables.push({ id, no, title });
    out.push(captionNode(no, title, { ...st, tableIndent: 0 }, { id }));
  }
  const head: PNode[] = header.map((h) => ({ text: h, bold: true }));
  const body = [head, ...(rows.length ? rows : [header.map((_, i) => (i === 0 ? { text: 'None' } : { text: '' }))])];
  out.push(tableNode(body, widths, 1, 0, { frame: 'all', colsep: true, rowsep: true }));
  out.push(afterTable());
  return out;
}

// ------------------------------------------------------------------ preliminary requirements
const FLUSH: St = { depth: 0, indent: 0, tableIndent: 0, cell: false, maxW: CONTENT_W };

function cellText(runs: PNode[]): PNode {
  return { text: withFallbackFonts(runs) };
}

function reqCondRows(group: Element, cx: Cx): PNode[][] {
  const rows: PNode[][] = [];
  for (const c of elementChildren(group)) {
    if (c.nodeName === 'noConds') continue;
    const cond = elementChildren(c).find((k) => k.nodeName === 'reqCond');
    const ref = elementChildren(c).find((k) => ['dmRef', 'pmRef', 'externalPubRef'].includes(k.nodeName));
    rows.push([cond ? cellText(renderInlineChildren(cond, cx)) : { text: '' }, ref ? cellText(renderInline(ref, cx)) : { text: '' }]);
  }
  return rows;
}

function identText(el: Element): { pn: string; ref: string } {
  const pn = textOf(find(el, 'partNumber'));
  const cs = find(el, 'catalogSeqNumberRef');
  const ref = cs ? `Fig ${cs.getAttribute('figureNumber') ?? ''} Item ${cs.getAttribute('item') ?? ''}`.replace(/\s+/g, ' ') : '';
  return { pn, ref };
}

function descrRows(group: Element | null, cx: Cx, descrName: string): PNode[][] {
  if (!group) return [];
  const rows: PNode[][] = [];
  for (const d of Array.from(group.getElementsByTagName(descrName))) {
    const name = textOf(find(d, 'name'));
    const { pn, ref } = identText(d);
    const first = [name, pn && `P/N ${pn}`].filter(Boolean).join(', ');
    const remarks = elementChildren(d).find((k) => k.nodeName === 'remarks');
    const anchor = d.getAttribute('id') ? { id: idOf(cx, d) } : {};
    rows.push([
      { text: first, ...anchor },
      ref ? { text: ref, color: COLOR.link } : { text: '' },
      { text: textOf(find(d, 'reqQuantity')) },
      { text: remarks ? textOf(remarks) : '' },
    ]);
  }
  return rows;
}

function personRows(group: Element): PNode[][] {
  const rows: PNode[][] = [];
  let n = 0;
  for (const p of elementChildren(group)) {
    n++;
    const cat = find(p, 'personCategory')?.getAttribute('personCategoryCode') ?? '';
    const skill = find(p, 'personSkill')?.getAttribute('skillLevelCode') ?? '';
    const trade = textOf(find(p, 'trade'));
    const et = find(p, 'estimatedTime');
    const unit = et?.getAttribute('unitOfMeasure') ?? '';
    const time = et ? `${textOf(et)}${unit ? ' ' + (unit === 'h' ? 'Hour' : unit) : ''}` : '';
    const label = p.nodeName === 'person' ? `Man ${p.getAttribute('man') ?? n}` : `Person ${n}${p.getAttribute('numRequired') ? ` (x${p.getAttribute('numRequired')})` : ''}`;
    rows.push([{ text: label }, { text: cat }, { text: skill }, { text: trade }, { text: time }]);
  }
  return rows;
}

function renderPreliminary(el: Element, cx: Cx): PNode[] {
  const out: PNode[] = [];
  const w4 = [0.3, 0.3, 0.2, 0.2].map((f) => Math.round(f * CONTENT_W * 100) / 100);
  const sectionHead = (t: string): PNode => heading(t, 'section', {});
  for (const c of elementChildren(el)) {
    // a section that only applies to some configurations says so right under its heading
    const noteAfterHead = () => out.push(...applicNote(c, cx, FLUSH));
    switch (c.nodeName) {
      case 'reqCondGroup':
        out.push(sectionHead('Required conditions'));
        noteAfterHead();
        out.push(...generatedTable(cx, c, 'Required conditions', ['Action/Condition', 'Data module/Technical publication'], [Math.round(CONTENT_W * 0.5 * 100) / 100, Math.round(CONTENT_W * 0.5 * 100) / 100], reqCondRows(c, cx), FLUSH));
        break;
      case 'reqPersons': {
        out.push(sectionHead('Required persons'));
        noteAfterHead();
        const pw = [0.2, 0.2, 0.2, 0.2, 0.2].map((f) => Math.round(f * CONTENT_W * 100) / 100);
        out.push(...generatedTable(cx, c, 'Required persons', ['Person', 'Category', 'Skill Level', 'Trade', 'Est. Time'], pw, personRows(c), FLUSH, false));
        break;
      }
      case 'reqTechInfoGroup': {
        out.push(sectionHead('Technical information'));
        noteAfterHead();
        const rows: PNode[][] = [];
        for (const r of Array.from(c.getElementsByTagName('dmRef'))) {
          const l = dmRefLabel(r);
          rows.push([{ text: l.dmc, color: COLOR.link }, { text: l.title }]);
        }
        out.push(...generatedTable(cx, c, 'Technical information', ['Document no.', 'Title'], [Math.round(CONTENT_W * 0.5 * 100) / 100, Math.round(CONTENT_W * 0.5 * 100) / 100], rows, FLUSH, false));
        break;
      }
      case 'reqSupportEquips':
      case 'reqSupplies':
      case 'reqSpares': {
        const info = c.nodeName === 'reqSupportEquips'
          ? { t: 'Support equipment', d: 'supportEquipDescr' }
          : c.nodeName === 'reqSupplies' ? { t: 'Consumables, materials and expendables', d: 'supplyDescr' } : { t: 'Spares', d: 'spareDescr' };
        out.push(sectionHead(info.t));
        noteAfterHead();
        out.push(...generatedTable(cx, c, info.t, ['Name/Alternate name', 'Identification/Reference', 'Quantity', 'Remark'], w4, descrRows(c, cx, info.d), FLUSH));
        break;
      }
      case 'reqSafety': {
        out.push(sectionHead('Safety conditions'));
        const sr = elementChildren(c).find((k) => k.nodeName === 'safetyRqmts');
        const lead = sr ? leadNodes(sr, cx, FLUSH) : [];
        if (!sr || (!lead.length && !elementChildren(sr).length)) out.push({ text: 'None', margin: margin(0, 0, 0, GAP.para), lineHeight: LH });
        else {
          out.push(...lead);
          for (const k of elementChildren(sr)) out.push(...renderElement(k, cx, FLUSH));
        }
        break;
      }
      default:
        out.push(...renderElement(c, cx, FLUSH));
    }
  }
  return out;
}

// ------------------------------------------------------------------ dispatcher
/** Section containers that get a centred, listed heading, in the order the reference prints them. */
const CENTRED: Record<string, string> = {
  description: 'Description', preliminaryRqmts: 'Preliminary requirements', mainProcedure: 'Procedure', closeRqmts: 'Requirements after job completion',
  isolationMainProcedure: 'Fault isolation procedure', faultIsolation: 'Fault isolation', isolationProcedure: 'Fault isolation procedure',
  commonInfo: 'Common information',
};

function sectionHeading(el: Element, cx: Cx, text: string): PNode {
  const id = idOf(cx, el);
  cx.collected.headings.push({ id, text });
  return heading(text, 'center', { id });
}

/** Elements that print their own applicability note and attached warnings (inside their heading / step number). */
const OWN_LEAD = new Set(['warning', 'caution', 'note', 'levelledPara', 'proceduralStep', 'crewDrillStep', 'isolationStep', 'reqCondGroup', 'reqPersons', 'reqTechInfoGroup', 'reqSupportEquips', 'reqSupplies', 'reqSpares', 'safetyRqmts']);

export function renderElement(el: Element, cx: Cx, st: St): PNode[] {
  if (HIDDEN.has(el.nodeName)) return [];
  if (!st.land && cx.turn.has(el)) {
    // a landscape block: laid out for the wide page, and handed up as one node that the publication prints on its own pages
    const wide: St = { ...st, land: true, maxW: LAND_W - (CONTENT_W - st.maxW), imgH: LAND_IMG_H - (st.headroom ?? 0), headroom: undefined };
    return [{ stack: renderPlain(el, cx, wide), [LAND_UNIT]: true }];
  }
  return renderPlain(el, cx, st);
}

function renderPlain(el: Element, cx: Cx, st: St): PNode[] {
  const body = renderElementBody(el, cx, st);
  return OWN_LEAD.has(el.nodeName) ? body : [...leadNodes(el, cx, st), ...body];
}

function renderElementBody(el: Element, cx: Cx, st: St): PNode[] {
  const name = el.nodeName;
  switch (name) {
    case 'levelledPara':
      return renderLevelledPara(el, cx, st);
    case 'figure':
      return renderFigure(el, cx, st);
    case 'graphic': {
      const icn = el.getAttribute('infoEntityIdent') ?? '';
      return [{ ...imageNode(icn, el, cx, st), margin: margin(0, 0, 0, GAP.para), id: idOf(cx, el) }];
    }
    case 'table':
      return renderTableElement(el, cx, st);
    case 'tgroup':
      return [renderTgroup(el, cx, st, null)];
    case 'randomList':
    case 'attentionRandomList':
      return renderList(el, cx, st, 'ul');
    case 'sequentialList':
    case 'attentionSequentialList':
      return renderList(el, cx, st, 'ol');
    case 'definitionList':
      return renderDefinitionList(el, cx, st);
    case 'warning':
    case 'caution':
      return renderAdmonition(el, cx, st, name);
    case 'note':
      return renderAdmonition(el, cx, st, 'note');
    case 'proceduralStep':
    case 'crewDrillStep':
    case 'isolationStep':
      return renderStep(el, cx, st);
    case 'preliminaryRqmts':
      return [sectionHeading(el, cx, CENTRED[name]), ...renderPreliminary(el, cx)];
    case 'closeRqmts': {
      const out: PNode[] = [sectionHeading(el, cx, CENTRED[name])];
      for (const c of elementChildren(el)) {
        if (c.nodeName === 'reqCondGroup') {
          out.push(heading('Required conditions', 'section', {}));
          out.push(...generatedTable(cx, c, 'Required conditions', ['Action/Condition', 'Data module/Technical publication'], [Math.round(CONTENT_W * 0.5 * 100) / 100, Math.round(CONTENT_W * 0.5 * 100) / 100], reqCondRows(c, cx), FLUSH));
        } else out.push(...renderElement(c, cx, FLUSH));
      }
      return out;
    }
    case 'noConds':
    case 'noSupportEquips':
    case 'noSupplies':
    case 'noSpares':
    case 'noSafety':
      return [{ text: 'None', lineHeight: LH, margin: margin(st.indent, 0, 0, GAP.para) }];
    default: {
      const out: PNode[] = [];
      if (CENTRED[name]) {
        const inner: St = name === 'description' || name === 'mainProcedure' ? { ...st, tableIndent: name === 'description' ? INDENT : 0 } : st;
        return carryHeading([sectionHeading(el, cx, CENTRED[name])], elementChildren(el).flatMap((c, i) => renderElement(c, cx, i === 0 ? carried(c, cx, inner) : inner)));
      }
      if (allowsText(el, cx.g)) out.push(...renderMixed(el, cx, st));
      else for (const c of elementChildren(el)) out.push(...renderElement(c, cx, st));
      return out;
    }
  }
}

// ------------------------------------------------------------------ data module assembly
export interface RefRow { code: string; title: string }

export function referencesOf(root: Element): RefRow[] {
  const refs = elementChildren(find(root, 'content') ?? root).find((c) => c.nodeName === 'refs');
  if (!refs) return [];
  const rows: RefRow[] = [];
  for (const r of elementChildren(refs)) {
    if (r.nodeName === 'dmRef') {
      const l = dmRefLabel(r);
      rows.push({ code: l.dmc, title: l.title });
    } else if (r.nodeName === 'pmRef') {
      rows.push({ code: pmCodeText(r) ? `PMC-${pmCodeText(r)}` : 'PMC-?', title: textOf(find(r, 'pmTitle')) });
    } else if (r.nodeName === 'externalPubRef') {
      rows.push({ code: textOf(find(r, 'externalPubCode')), title: textOf(find(r, 'externalPubTitle')) });
    } else rows.push({ code: textOf(r), title: '' });
  }
  return rows;
}

/** Numbers tables of one data module in document order, starting after the References table (Table 1). */
export function numberTables(root: Element): Map<Element, number> {
  const map = new Map<Element, number>();
  const content = find(root, 'content');
  if (!content) return map;
  let n = 1;
  const generated = new Set(['reqCondGroup', 'reqSupportEquips', 'reqSupplies', 'reqSpares']);
  const walk = (el: Element) => {
    for (const c of elementChildren(el)) {
      if (c.nodeName === 'table' || generated.has(c.nodeName)) map.set(c, ++n);
      walk(c);
    }
  };
  walk(content);
  return map;
}

export function buildDmContext(
  doc: Document, g: Grammar | null, images: Map<string, ResolvedImage>, prefix: string, warnings: Set<string>, lite: boolean,
  repo: Repository = emptyRepository(),
): Cx {
  const root = doc.documentElement;
  const labels = buildLabels(doc);
  const tableNo = numberTables(root);
  for (const [el, no] of tableNo) if (el.nodeName === 'table') labels.numbers.set(el, String(no));
  return newCx({ g, labels, tableNo, images, prefix, warnings, lite, applic: applicIndex(doc), dmApplic: dmApplicText(doc), repo, attn: declaredRefs(doc), turn: turnUnits(doc) });
}

/** The data module's own body, without the title block, table of contents or References table. */
export function renderDmBody(root: Element, cx: Cx): PNode[] {
  const content = find(root, 'content');
  if (!content) return [];
  // the References table is part of the opening block; `referencedApplicGroup` / `warningsAndCautionsRef` are indexes that
  // the content points into (applicRefId, warningRefs / cautionRefs), not text of their own
  const skip = new Set(['refs', 'referencedApplicGroup', 'referencedApplicGroupRef', 'warningsAndCautionsRef']);
  // a declared warning or caution that nothing points at would otherwise vanish from the printed copy: it opens the data module
  const used = usedRefIds(root.ownerDocument!);
  const orphans = [...cx.attn.values()].filter((r) => !used.has(r.id)).flatMap((r) => referencedAdmonition(r, cx, TOP_ST));
  return [...orphans, ...elementChildren(content).filter((c) => !skip.has(c.nodeName)).flatMap((c) => renderElement(c, cx, { ...TOP_ST }))];
}

export function footnoteNodes(cx: Cx): PNode[] {
  if (!cx.footnotes.length) return [];
  return [
    heading('Notes', 'center'),
    ...cx.footnotes.map((f) => ({
      text: [{ text: `${f.n}. `, bold: true }, ...f.content.flatMap((n) => (Array.isArray(n.text) ? (n.text as PNode[]) : [n]))], lineHeight: LH, margin: margin(0, 0, 0, GAP.cellPara),
    })),
  ];
}

export { formatDmc, readDmCode, fontRuns, lengthToPt };

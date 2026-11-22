// =============================================================================
// Small DOM helpers for reading S1000D data modules, and the CALS table reader the front-matter pages need.
//
// Text is read the way a person reads the page: whitespace runs collapse, comments and processing instructions are invisible
// (the Xignal list pages carry their examples inside comments, and a comment must never become content), non-breaking
// spaces count as spaces. `lines` keeps the author's line breaks instead.
// =============================================================================

import { DOMParser } from '@xmldom/xmldom';

export type El = Element;

export function parseXml(xml: string): Document {
  return new DOMParser({ onError: () => { /* tolerant: a module with an odd entity still yields its content */ } }).parseFromString(xml, 'text/xml') as unknown as Document;
}

const nodes = (n: Node): Node[] => Array.from(n.childNodes as unknown as ArrayLike<Node>);

/** Child elements, optionally only those with this name. */
export const elems = (n: Node | null | undefined, name?: string): El[] =>
  n ? (nodes(n).filter((c) => c.nodeType === 1 && (!name || (c as El).nodeName === name)) as El[]) : [];
export const first = (n: Node | null | undefined, name: string): El | undefined => elems(n, name)[0];
export const attr = (e: El | null | undefined, name: string): string => (e ? e.getAttribute(name) ?? '' : '');

/** Descendant elements with this name, in document order. */
export function descendants(n: Node, name: string): El[] {
  const out: El[] = [];
  const walk = (x: Node) => { for (const c of nodes(x)) { if (c.nodeType === 1) { if ((c as El).nodeName === name) out.push(c as El); walk(c); } } };
  walk(n);
  return out;
}

const NBSP = / /g;
export const collapse = (s: string): string => s.replace(NBSP, ' ').replace(/\s+/g, ' ').trim();

/** All text under a node, whitespace collapsed; comments are not text. */
export const textOf = (n: Node | null | undefined): string => (n ? collapse(n.textContent ?? '') : '');

/** The author's lines: text split at line breaks, each line collapsed, empty lines dropped. */
export function linesOf(n: Node | null | undefined): string[] {
  if (!n) return [];
  return (n.textContent ?? '').replace(NBSP, ' ').split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

export interface Inline { t: 'text' | 'symbol'; v: string; scale?: string }

/** The inline content of a paragraph in order: text runs, and graphics (<symbol infoEntityIdent>). */
export function inlineOf(para: El): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { const t = collapse(buf); if (t) out.push({ t: 'text', v: t }); buf = ''; };
  const walk = (n: Node) => {
    for (const c of nodes(n)) {
      if (c.nodeType === 3 || c.nodeType === 4) buf += c.nodeValue ?? '';
      else if (c.nodeType === 1) {
        const e = c as El;
        if (e.nodeName === 'symbol') { flush(); out.push({ t: 'symbol', v: attr(e, 'infoEntityIdent'), scale: attr(e, 'reproductionScale') || undefined }); }
        else walk(e);
      }
    }
  };
  walk(para);
  flush();
  return out;
}

/** The ICN entities a data module declares: name -> file it points at (from the DOCTYPE's <!ENTITY ... SYSTEM "file" NDATA ...>). */
export function entityMap(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<!ENTITY\s+([\w.\-]+)\s+SYSTEM\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  const head = xml.slice(0, xml.search(/<dmodule[\s>]/) >= 0 ? xml.search(/<dmodule[\s>]/) : 200000);
  while ((m = re.exec(head))) out.set(m[1], m[2]);
  return out;
}

// ── CALS tables ──────────────────────────────────────────────────────────────

export interface Cell {
  el: El | null;
  /** Text of the cell, whitespace collapsed. '' for a cell that is only covered by a span from another cell. */
  text: string;
  /** The author's lines. */
  lines: string[];
  /** True for the cell that holds the content; false for the grid positions a colspan / rowspan covers. */
  origin: boolean;
  colspan: number;
  rowspan: number;
}
export interface Grid { head: Cell[][]; body: Cell[][]; cols: number }

/**
 * A <table> as a grid with spans resolved: every row has one Cell per column, a spanned position being a non-origin cell with no text.
 * Handles `morerows` (row spans), `namest`/`nameend` (column spans, by colspec name) and explicit `colname` placement.
 */
export function readTable(table: El): Grid {
  const tgroup = first(table, 'tgroup');
  const cols = Number(attr(tgroup, 'cols')) || 0;
  const names = new Map<string, number>();
  elems(tgroup, 'colspec').forEach((c, i) => {
    const num = Number(attr(c, 'colnum'));
    const cn = attr(c, 'colname');
    if (cn) names.set(cn, num ? num - 1 : i);                       // a colspec without a name cannot be referred to (and '' must never match an entry with no namest)
  });
  const width = Math.max(cols, names.size, elems(tgroup, 'colspec').length, 1);

  const readRows = (section: El | undefined): Cell[][] => {
    if (!section) return [];
    const rows: Cell[][] = [];
    const carry: number[] = new Array(width).fill(0);                // rows a morerows span from above still covers, per column
    for (const row of elems(section, 'row')) {
      const covered = carry.map((n) => n > 0);                       // columns covered from above in THIS row
      for (let c = 0; c < width; c++) if (covered[c]) carry[c]--;
      const cells: Cell[] = Array.from({ length: width }, () => ({ el: null, text: '', lines: [], origin: false, colspan: 1, rowspan: 1 }));
      let col = 0;
      for (const entry of elems(row, 'entry')) {
        while (col < width && covered[col]) col++;
        const lookup = (a: string): number | undefined => { const v = attr(entry, a); return v ? names.get(v) : undefined; };
        const st = lookup('namest');
        const en = lookup('nameend');
        const at = lookup('colname');
        const start = st !== undefined ? st : at !== undefined ? at : col;
        const end = en !== undefined && st !== undefined ? Math.max(st, en) : start;
        const more = Number(attr(entry, 'morerows')) || 0;
        if (start < width) {
          cells[start] = { el: entry, text: textOf(entry), lines: linesOf(entry), origin: true, colspan: end - start + 1, rowspan: more + 1 };
          if (more) for (let c = start; c <= Math.min(end, width - 1); c++) carry[c] = Math.max(carry[c], more);
        }
        col = end + 1;
      }
      rows.push(cells);
    }
    return rows;
  };
  return { head: readRows(first(tgroup, 'thead')), body: readRows(first(tgroup, 'tbody')), cols: width };
}

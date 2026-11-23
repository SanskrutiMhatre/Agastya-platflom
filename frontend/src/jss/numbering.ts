// The numbers the publishing pipeline prints, worked out the same way, so the editor shows what the PDF will say.
//
//   headings   chapter number, then the position among sibling sections at each level: 1.3, 1.3.1
//   tables     "Table c-n": c the chapter, n counts the chapter's tables that have a caption, in document order, at any depth
//   figures    "Figure c-n", the same
//   lists      alpha (a) (b) ... skipping i, o and v; roman (i) (ii) ...; number 1. 2. ...; bullet and dash
//   xref       a table or figure by its number; a section by its title
//
// Sources: backend/vendor/pipeline/jsstofo (tables.xsl table-number, figures.xsl figure-number, common.xsl list-item-label and xref-label).

import { isSection, type Block, type Chapter, type Figure, type JssDoc, type List, type ListType, type Section, type Table } from './model';

export const ALPHA = 'abcdefghjklmnpqrstuwxyz';

/** a, b, c ... h, j ... z, then aa, ab ... (the pipeline's own wrapping). */
export function alphaLabel(n: number): string {
  if (n > ALPHA.length) return alphaLabel(Math.floor((n - 1) / ALPHA.length)) + ALPHA[(n - 1) % ALPHA.length];
  return ALPHA[n - 1];
}
export function romanLabel(n: number): string {
  const map: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = ''; for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

/** The type a list is drawn in: its own, else by how deeply lists are nested (alpha, then roman, then bullets). */
export function effectiveListType(list: List, depth: number): ListType {
  return list.type ?? (depth === 1 ? 'alpha' : depth === 2 ? 'roman' : 'bullet');
}
export function itemLabel(type: ListType, n: number): string {
  switch (type) {
    case 'alpha': return `(${alphaLabel(n)})`;
    case 'roman': return `(${romanLabel(n)})`;
    case 'number': return `${n}.`;
    case 'dash': return '•';          // the pipeline draws dash lists with the same bullet glyph
    default: return '•';
  }
}

export interface Numbers {
  /** "1" for a chapter, "1.3.1" for a section */
  heading: Map<Chapter | Section, string>;
  /** "Table 1-2" / "Figure 1-1": captioned ones only, as the pipeline counts them */
  caption: Map<Table | Figure, string>;
  /** what a cross-reference to this id prints */
  label: Map<string, string>;
  /** every target a cross-reference can point at, in document order */
  targets: Array<{ id: string; label: string; kind: 'table' | 'figure' | 'section'; where: string }>;
}

export function numberDocument(doc: JssDoc): Numbers {
  const n: Numbers = { heading: new Map(), caption: new Map(), label: new Map(), targets: [] };
  for (const ch of doc.chapters) {
    n.heading.set(ch, String(ch.number));
    let tables = 0; let figures = 0;
    const walk = (children: Array<Block | Section>, prefix: string) => {
      let sec = 0;
      for (const c of children) {
        if (isSection(c)) {
          sec += 1; const num = `${prefix}.${sec}`; n.heading.set(c, num);
          if (c.id) { n.label.set(c.id, c.title); n.targets.push({ id: c.id, label: c.title || `Section ${num}`, kind: 'section', where: num }); }
          walk(c.children, num);
        } else if (c.k === 'table' && c.title) {
          tables += 1; const lab = `Table ${ch.number}-${tables}`; n.caption.set(c, lab);
          if (c.id) { n.label.set(c.id, lab); n.targets.push({ id: c.id, label: lab, kind: 'table', where: c.title }); }
        } else if (c.k === 'figure' && c.title) {
          figures += 1; const lab = `Figure ${ch.number}-${figures}`; n.caption.set(c, lab);
          if (c.id) { n.label.set(c.id, lab); n.targets.push({ id: c.id, label: lab, kind: 'figure', where: c.title }); }
        }
      }
    };
    walk(ch.children, String(ch.number));
  }
  return n;
}

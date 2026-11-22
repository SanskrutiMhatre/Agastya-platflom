/**
 * Landscape pages for wide content.
 *
 * S1000D marks content that needs a wide page in two ways, and the reference pipeline honours both:
 *  - `orient="land"` on an element: a table or figure, a `graphic` (its figure turns), a `title` (the levelled paragraph,
 *    step, figure or table it heads turns, title included), a paragraph, a whole levelled paragraph or step;
 *  - a `foldout` element, which wraps a figure or table meant to print as an oversized fold-out page.
 *
 * Page geometry is fixed per page sequence in the reference, so a data module that holds such content is printed as
 * several sequences - portrait, landscape, portrait ... - and so it is here: every run of one orientation is a block of
 * the document that starts on a right-hand page (blank pages are inserted as needed) and, like every data module, is
 * followed by whatever blank page lets the next block start on a right-hand page again. Page numbers simply continue.
 *
 * Which element turns:
 *  - a marked element turns whole;
 *  - a block that cannot be split across page sequences (a step, list, table, warning, paragraph...) and merely *holds* a
 *    marked element turns whole with it (the reference does the same for numbered steps);
 *  - a section that can be split (levelled paragraph, description, procedure...) is descended into, so only the marked
 *    block turns and the prose either side of it stays portrait.
 */
import type { PNode } from './pdf-metrics';

/** Property that tags a rendered node as one landscape block. */
export const LAND_UNIT = 'landscapeUnit';

/** Containers whose children are laid out one after the other on the page: a turning block may be taken out of them. */
const SPLITTABLE = new Set([
  'content', 'description', 'procedure', 'mainProcedure', 'levelledPara', 'closeRqmts', 'faultIsolation', 'faultReporting',
  'illustratedPartsCatalog', 'crew',
]);

/** True when the element itself asks for a landscape page. */
export function marksLandscape(el: Element): boolean {
  if (el.nodeName === 'foldout') return true;
  if (el.getAttribute('orient') === 'land' && el.nodeName !== 'graphic' && el.nodeName !== 'title') return true;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if ((c.nodeName === 'title' || c.nodeName === 'graphic') && c.getAttribute('orient') === 'land') return true;
  }
  return false;
}

/** The elements of a data module that turn as one landscape block (the outermost ones). */
export function turnUnits(doc: Document): Set<Element> {
  const units = new Set<Element>();
  const content = doc.getElementsByTagName('content')[0];
  if (!content) return units;
  for (const el of Array.from(content.getElementsByTagName('*'))) {
    if (!marksLandscape(el)) continue;
    let unit: Element = el;
    while (unit.parentElement && unit.parentElement !== content && !SPLITTABLE.has(unit.parentElement.nodeName)) unit = unit.parentElement;
    units.add(unit);
  }
  // a block inside another turning block is part of it
  for (const u of [...units]) {
    for (let p = u.parentElement; p && p !== content; p = p.parentElement) {
      if (units.has(p)) {
        units.delete(u);
        break;
      }
    }
  }
  return units;
}

export interface Run {
  land: boolean;
  nodes: PNode[];
}

/**
 * Cuts the rendered nodes of a data module into runs of one orientation: every landscape block is a run of its own,
 * the nodes between them are portrait runs. The first run is always portrait (it carries the opening of the data module).
 */
export function splitRuns(nodes: PNode[]): Run[] {
  const runs: Run[] = [{ land: false, nodes: [] }];
  for (const n of nodes) {
    if (n[LAND_UNIT]) {
      runs.push({ land: true, nodes: [n] }, { land: false, nodes: [] });
    } else {
      runs[runs.length - 1].nodes.push(n);
    }
  }
  // drop portrait runs that stayed empty, except the first one
  return runs.filter((r, i) => i === 0 || r.nodes.length > 0);
}

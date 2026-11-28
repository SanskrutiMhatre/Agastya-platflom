// =============================================================================
// Live co-editing of JSG documents (Phase 3, P3-1): the JSG document in a Y document - ONE definition for the server (services/collab/jsg.ts) and
// the browser binding (frontend/src/collab/jsg.ts).
//
// The Y schema is the XML one of ydom.ts (XmlFragment 'xml' = the <jsgdoc> element, one Y node per DOM node, text in XmlText, attributes as Y
// attributes), holding the CANONICAL form of the document: the text the JSG editor's serializer writes (shared/jsg/xml.ts serializeJsg), read
// back and with the pretty-printing whitespace of element-only containers removed. So:
//   * two people typing in one paragraph, list item, table cell or note merge character by character (XmlText);
//   * a chapter, section, heading, block, list item, table row, plate, view or parts row added, removed or moved by one person and another
//     person's edit elsewhere merge deterministically (Y arrays of elements);
//   * a field held in an attribute (a heading's title, an ISPL parts-row cell, a plate reference) is one value: two people changing the SAME
//     field at the same moment end with one of the two values (last writer wins, the same on every screen); different fields of one row merge.
//
// Changes are brought into Y by a keyed reconcile: the children of a parent that are equal in the old and the new form are kept (the common
// prefix and suffix, then the longest common subsequence of the middle), and only the rest is deleted, inserted or reconciled in place. A
// paragraph someone is typing in therefore keeps its identity when another person adds a paragraph before it.
// =============================================================================

import * as Y from 'yjs';
import * as ydom from './ydom';
import type { XNode, XElement } from './xmlForm';

/** The one room of a JSG project: `<projectId>/jsg/document`. */
export const JSG_DOC_PATH = 'document';

/** The project file a JSG room writes to (services/jsg/service.ts SOURCE_NAME); comments anchored in it name it. */
export const JSG_FILE = 'jsg-document.xml';

const META_FIELDS = new Set(['docNo', 'title', 'subtitle', 'projectName', 'atNo', 'dated', 'nsn', 'issueDate', 'equipmentLife', 'qtyUnit', 'classification', 'emblem', 'logo']);
const INLINE = new Set(['para', 'text', 'b', 'i', 'u', 'sup', 'sub', 'xref', 'certificate', 'line']);

/** May this element hold character data in the JSG grammar (mixed content)? Depends on the parent for <item> and <note>. */
export function isMixed(name: string, parent: string | null): boolean {
  if (INLINE.has(name)) return true;
  if (name === 'item') return parent !== 'list';            // a front-matter line (warning, dos, donts, important, firstAid) holds text; a list item holds parts
  if (name === 'note') return parent === 'view';             // the line under an ISPL parts table holds text; a notice holds paragraphs
  return parent === 'meta' && META_FIELDS.has(name);         // the cover fields
}

/** Remove the whitespace-only text nodes of element-only containers (pretty-printing, not content), in place. */
export function normalizeJsgDom(el: XNode, parent: string | null = null): void {
  if (el.nodeType !== 1) return;
  const name = el.nodeName;
  const mixed = isMixed(name, parent);
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1) normalizeJsgDom(c, name);
    else if (!mixed && (c.nodeType === 3 || c.nodeType === 8 || c.nodeType === 7)) el.removeChild(c);   // whitespace, and comments / PIs the model drops
  }
}

const isY = (c: unknown): c is ydom.YNode => c instanceof Y.XmlElement || c instanceof Y.XmlText;
export const ykids = (y: ydom.YParent): ydom.YNode[] => y.toArray().filter(isY);

/** The longest common subsequence of a and b under eq (index pairs, increasing). Quadratic: only for the changed middle of one parent. */
function lcs<A, B>(a: A[], b: B[], eq: (x: A, y: B) => boolean): Array<[number, number]> {
  const n = a.length, m = b.length;
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (eq(a[i], b[j]) && L[i][j] === L[i + 1][j + 1] + 1) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return out;
}
const LCS_LIMIT = 40_000;

/**
 * Make the Y parent `y` hold the content of the DOM node `next`, changing as little as possible. `cur` is a DOM form of what `y` holds now, child
 * for child (domChildren(cur)[i] stands for ykids(y)[i]): the browser keeps one (its shadow of the room), the server builds one from Y. `eq` says
 * whether two DOM subtrees are the same (the browser: Node.isEqualNode; the server: their canonical text). Call inside a transaction.
 */
export function reconcileKeyed(y: ydom.YParent, cur: XNode, next: XNode, eq: (a: XNode, b: XNode) => boolean): void {
  if (y instanceof Y.XmlElement && next.nodeType === 1) ydom.syncAttributes(y, next);
  const yk = ykids(y);
  const ck = ydom.domChildren(cur);
  const nk = ydom.domChildren(next);
  if (ck.length !== yk.length) {
    // the form does not stand for Y child for child (should not happen): rebuild this parent's children from scratch
    if (yk.length) y.delete(0, yk.length);
    const fresh = nk.map((n) => ydom.yFromDom(n)).filter((x): x is ydom.YNode => !!x);
    if (fresh.length) y.insert(0, fresh);
    return;
  }
  let s = 0;
  while (s < ck.length && s < nk.length && eq(ck[s], nk[s])) s++;
  let e = 0;
  while (e < ck.length - s && e < nk.length - s && eq(ck[ck.length - 1 - e], nk[nk.length - 1 - e])) e++;
  const midC = ck.slice(s, ck.length - e); const midN = nk.slice(s, nk.length - e);
  if (!midC.length && !midN.length) return;
  const anchors = midC.length && midN.length && midC.length * midN.length <= LCS_LIMIT ? lcs(midC, midN, eq) : [];
  // the gaps between the anchors, last first (so the Y indices of the earlier ones stay where they are)
  const gaps: Array<{ c0: number; c1: number; n0: number; n1: number }> = [];
  let pc = 0, pn = 0;
  for (const [ci, ni] of anchors) { gaps.push({ c0: pc, c1: ci, n0: pn, n1: ni }); pc = ci + 1; pn = ni + 1; }
  gaps.push({ c0: pc, c1: midC.length, n0: pn, n1: midN.length });
  for (let g = gaps.length - 1; g >= 0; g--) {
    const { c0, c1, n0, n1 } = gaps[g];
    const oc = midC.slice(c0, c1); const on = midN.slice(n0, n1);
    if (!oc.length && !on.length) continue;
    const base = s + c0;
    const kind = (d: XNode) => ydom.kindOfDom(d);
    // pair same-kind nodes from both ends of the gap (an edited paragraph is the same paragraph), replace the rest
    let p = 0; while (p < oc.length && p < on.length && kind(oc[p]) === kind(on[p])) p++;
    let q = 0; while (q < oc.length - p && q < on.length - p && kind(oc[oc.length - 1 - q]) === kind(on[on.length - 1 - q])) q++;
    for (let k = q - 1; k >= 0; k--) pairNode(yk[base + oc.length - 1 - k], oc[oc.length - 1 - k], on[on.length - 1 - k], eq);
    const drop = oc.length - p - q;
    if (drop > 0) y.delete(base + p, drop);
    const add = on.slice(p, on.length - q).map((n) => ydom.yFromDom(n)).filter((x): x is ydom.YNode => !!x);
    if (add.length) y.insert(base + p, add);
    for (let k = p - 1; k >= 0; k--) pairNode(yk[base + k], oc[k], on[k], eq);
  }
}

function pairNode(y: ydom.YNode, cur: XNode, next: XNode, eq: (a: XNode, b: XNode) => boolean): void {
  if (y instanceof Y.XmlText) { ydom.diffText(y, next.nodeValue ?? ''); return; }
  if (next.nodeType === 1) reconcileKeyed(y, cur, next, eq);
  else ydom.syncAttributes(y, next);
}

/** A canonical text of a DOM subtree (the server's equality: names, sorted attributes, text). Memoised per call through `memo`. */
export function fingerprint(n: XNode, memo: Map<XNode, string>): string {
  const have = memo.get(n); if (have !== undefined) return have;
  let s: string;
  if (n.nodeType === 3 || n.nodeType === 4) s = `"${n.nodeValue ?? ''}"`;
  else if (n.nodeType !== 1) s = `#${n.nodeType}:${n.nodeValue ?? ''}`;
  else {
    const attrs = Array.from((n as XElement).attributes).map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ');
    s = `<${n.nodeName} ${attrs}>${ydom.domChildren(n).map((c) => fingerprint(c, memo)).join('')}</>`;
  }
  memo.set(n, s);
  return s;
}

/** The server's equality for reconcileKeyed. */
export function fingerprintEq(): (a: XNode, b: XNode) => boolean {
  const memo = new Map<XNode, string>();
  return (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && fingerprint(a, memo) === fingerprint(b, memo);
}

/** The child-index path of a DOM node under `root` (domChildren indices), or null when it is not under it. */
export function pathOf(root: XNode, n: XNode): number[] | null {
  const out: number[] = [];
  for (let c: XNode | null = n; c && c !== root; c = c.parentNode) {
    const p = c.parentNode; if (!p) return null;
    const i = ydom.domChildren(p).indexOf(c); if (i < 0) return null;
    out.unshift(i);
  }
  return out;
}

/** The Y node at a child-index path under `y`. */
export function yAt(y: ydom.YParent, path: number[]): ydom.YNode | ydom.YParent | null {
  let cur: ydom.YNode | ydom.YParent = y;
  for (const i of path) {
    if (cur instanceof Y.XmlText) return null;
    const k: ydom.YNode | undefined = ykids(cur)[i];
    if (!k) return null;
    cur = k;
  }
  return cur;
}

/** The child-index path of a Y node under `root`. */
export function yPathOf(root: ydom.YParent, y: ydom.YNode | ydom.YParent): number[] | null {
  const out: number[] = [];
  for (let c: unknown = y; c && c !== root;) {
    const p = (c as { parent: unknown }).parent as ydom.YParent | null;
    if (!p || !(p instanceof Y.XmlElement || p instanceof Y.XmlFragment)) return null;
    const i = ykids(p).indexOf(c as ydom.YNode); if (i < 0) return null;
    out.unshift(i);
    c = p;
  }
  return out;
}

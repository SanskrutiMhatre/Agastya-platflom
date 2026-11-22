/**
 * `id` handling shared by attribute editing and paste: finding clashes, following an id rename into the attributes that point at it,
 * and giving pasted copies ids of their own.
 */
import type { Grammar } from './grammar';
import { uniqueId } from './ops';

const ID_PREFIX: Record<string, string> = { levelledPara: 'par', figure: 'fig', table: 'tab', proceduralStep: 'stp', warning: 'wrn', caution: 'cau', note: 'not', graphic: 'gra', multimedia: 'mma', supportEquipDescr: 'seq', supplyDescr: 'sup', spareDescr: 'spa' };

/** The prefix of a generated id ("par-0001"): one scheme for every way an id can be generated. */
export function idPrefixFor(elementName: string): string {
  return ID_PREFIX[elementName] ?? (elementName.slice(0, 3).toLowerCase() || 'id');
}

/** Used when there is no grammar: S1000D names its ID references `…RefId`, plus the xref pair. */
const FALLBACK_IDREF = /RefId$|^xrefid$|^internalRefId$/i;

const kindCache = new WeakMap<Grammar, Map<string, boolean>>();

/** Whether `attr` of `<element>` holds one or more ids (IDREF / IDREFS) according to the schema. */
export function isIdRefAttr(g: Grammar | null, element: string, attr: string): boolean {
  if (!g || !g.has(element)) return FALLBACK_IDREF.test(attr);
  let m = kindCache.get(g);
  if (!m) kindCache.set(g, (m = new Map()));
  const key = `${element}@${attr}`;
  let v = m.get(key);
  if (v === undefined) {
    const a = g.attribute(element, attr);
    v = !!a && (a.base === 'IDREF' || a.base === 'IDREFS');
    m.set(key, v);
  }
  return v;
}

/** The element other than `except` that already uses `id`, if any. */
export function idClash(doc: Document, id: string, except?: Element): Element | null {
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i] !== except && all[i].getAttribute('id') === id) return all[i];
  return null;
}

/**
 * After an element's `id` changed from `oldId` to `newId`, repoints every reference to it (`internalRefId`, `applicRefId`, … and
 * IDREFS lists) inside `root`. Returns how many attributes were rewritten.
 */
export function rewriteIdRefs(root: Node, g: Grammar | null, oldId: string, newId: string): number {
  let n = 0;
  const scan = (e: Element) => {
    for (const a of Array.from(e.attributes)) {
      if (a.name === 'id' || !isIdRefAttr(g, e.nodeName, a.name)) continue;
      const parts = a.value.split(/\s+/);
      if (!parts.includes(oldId)) continue;
      a.value = parts.map((p) => (p === oldId ? newId : p)).join(' ');
      n++;
    }
  };
  const tops: Element[] = root.nodeType === 9 ? [(root as Document).documentElement] : root.nodeType === 1 ? [root as Element] : (Array.from(root.childNodes).filter((c) => c.nodeType === 1) as Element[]);
  for (const top of tops) {
    if (!top) continue;
    scan(top);
    for (const e of Array.from(top.getElementsByTagName('*'))) scan(e);
  }
  return n;
}

/**
 * Gives every element of a detached `fragment` whose `id` is already taken in `doc` (or repeated inside the fragment) a new unique
 * id, and repoints references *within the fragment* to the renamed elements. A copy must not share ids with its original: the
 * document would be invalid and cross-references would be ambiguous. Returns the number of ids that were changed.
 */
export function dedupeFragmentIds(doc: Document, fragment: Node, g: Grammar | null): number {
  const els: Element[] = [];
  const collect = (n: Node) => {
    if (n.nodeType === 1) els.push(n as Element);
    for (const c of Array.from(n.childNodes)) collect(c);
  };
  collect(fragment);
  const used = new Set<string>();
  const renamed = new Map<string, string>();
  for (const e of els) {
    const id = e.getAttribute('id');
    if (!id) continue;
    if (idClash(doc, id) || used.has(id)) {
      const fresh = uniqueId(doc, id.replace(/-?\d+$/, '') || e.nodeName.slice(0, 3));
      e.setAttribute('id', fresh);
      if (!renamed.has(id)) renamed.set(id, fresh);
      used.add(fresh);
    } else used.add(id);
  }
  for (const [oldId, newId] of renamed) rewriteIdRefs(fragment, g, oldId, newId);
  return renamed.size;
}

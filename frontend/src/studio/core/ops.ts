/**
 * Structural editing operations on the XML model. All functions mutate the
 * XML DOM and must be called inside EditorDocument.transact(). They return the
 * resulting caret/selection so the views can restore it.
 */
import type { Grammar } from './grammar';
import { ATOMIC, PRESERVE, elementDisplay, isBlockName, isElementOnly } from './display';
import type { ModelPos, ModelSelection } from './document';
import { createEl, elementChildren, childNames, elementIndex, nodeIndex, setAttr, stripInvalidXmlChars } from './xml';

export class OpError extends Error {}

export const FORMATTING = new Set(['emphasis', 'subScript', 'superScript', 'changeInline', 'inlineSignificantData']);
export const SPLIT_CONTAINERS = new Set([
  'listItem', 'proceduralStep', 'attentionRandomListItem', 'attentionSequentialListItem', 'crewDrillStep', 'isolationStep',
  'definitionListItem',
]);
/** Structures that hold their own text blocks: text typed next to one of them gets a paragraph of its own. */
const COMPOUND = new Set(['table', 'figure', 'warning', 'caution', 'note', 'randomList', 'sequentialList', 'definitionList', 'multimedia']);
/** Containers whose text never merges with the text around them (see canJoin). */
const JOIN_ISOLATED = new Set(['warning', 'caution', 'note', 'figure', 'table', 'entry', 'footnote', 'definitionListItem', 'listItemTerm', 'listItemDefinition', 'multimedia']);
export const LIST_NAMES = new Set(['randomList', 'sequentialList', 'attentionRandomList', 'attentionSequentialList']);

// ------------------------------------------------------------------ helpers
export function allowsText(el: Element, g: Grammar | null): boolean {
  if (PRESERVE.has(el.nodeName)) return true;
  if (g && g.has(el.nodeName)) return g.allowsText(el.nodeName);
  return !isElementOnly(el, g);
}

export function isTextBlock(el: Element, g: Grammar | null): boolean {
  if (!allowsText(el, g)) return false;
  if (ATOMIC.has(el.nodeName)) return false;
  const d = elementDisplay(el, g);
  if (d === 'block') return true;
  // inline-classified mixed element directly in element-only content behaves as a block
  const p = el.parentNode as Element | null;
  return !!p && p.nodeType === 1 && !allowsText(p, g);
}

/**
 * A text part of an inline structure: the acronymTerm and acronymDefinition of an acronym, the externalPubTitle of an externalPubRef.
 * The caret can be in it (isTextBlock, so typing and startOf/endOf work), but it is not a block of its own for Enter, Backspace,
 * Delete and selections: those belong to the paragraph around the structure and must not cut the structure apart.
 */
function isInlinePart(el: Element, g: Grammar | null): boolean {
  const p = el.parentNode as Element | null;
  return !!p && p.nodeType === 1 && !allowsText(p, g) && elementDisplay(p, g) === 'inline';
}

export function textBlockOf(n: Node | null, g: Grammar | null): Element | null {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) {
    if (c.nodeType === 1 && isTextBlock(c as Element, g) && !isInlinePart(c as Element, g)) return c as Element;
  }
  return null;
}

export function containerElement(pos: ModelPos): Element {
  return (pos.node.nodeType === 1 ? pos.node : pos.node.parentNode) as Element;
}

/** Can `name` be inserted into `parent` before element-child index `idx` (relaxed)? Unknown structures are permissive. */
export function canInsertAt(g: Grammar | null, parent: Element, idx: number, name: string): boolean {
  if (!g || !g.has(parent.nodeName)) return parent.nodeType === 1;
  return g.canInsert(parent.nodeName, childNames(parent), idx, name);
}

export function isEmptyEl(el: Element): boolean {
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) return false;
    if ((c.nodeType === 3 || c.nodeType === 4) && (c.nodeValue ?? '') !== '') return false;
  }
  return true;
}

export function hasText(el: Element): boolean {
  return /\S/.test(el.textContent ?? '');
}

/** Position immediately before a node. */
export function before(n: Node): ModelPos { return { node: n.parentNode!, offset: nodeIndex(n) }; }
export function after(n: Node): ModelPos { return { node: n.parentNode!, offset: nodeIndex(n) + 1 }; }
export function caret(pos: ModelPos): ModelSelection { return { anchor: pos, focus: pos }; }

/** Prefer a text position over an element-boundary position. */
export function normalizePos(pos: ModelPos): ModelPos {
  if (pos.node.nodeType !== 1) return pos;
  const kids = pos.node.childNodes;
  const prev = kids[pos.offset - 1];
  const next = kids[pos.offset];
  if (prev && prev.nodeType === 3) return { node: prev, offset: prev.nodeValue!.length };
  if (next && next.nodeType === 3) return { node: next, offset: 0 };
  return pos;
}

/** First caret position inside an element (descending to the first text-capable block). */
export function startOf(el: Element, g: Grammar | null): ModelPos {
  const tb = firstTextBlock(el, g) ?? el;
  const first = tb.firstChild;
  if (first && first.nodeType === 3) return { node: first, offset: 0 };
  if (first && first.nodeType === 1 && FORMATTING.has(first.nodeName)) return startOf(first as Element, g);
  return { node: tb, offset: 0 };
}

export function endOf(el: Element, g: Grammar | null): ModelPos {
  const tb = lastTextBlock(el, g) ?? el;
  const last = tb.lastChild;
  if (last && last.nodeType === 3) return { node: last, offset: last.nodeValue!.length };
  if (last && last.nodeType === 1 && FORMATTING.has(last.nodeName)) return endOf(last as Element, g);
  return { node: tb, offset: tb.childNodes.length };
}

export function firstTextBlock(el: Element, g: Grammar | null): Element | null {
  if (isTextBlock(el, g)) return el;
  for (const c of elementChildren(el)) {
    if (ATOMIC.has(c.nodeName)) continue;
    const r = firstTextBlock(c, g);
    if (r) return r;
  }
  return null;
}

export function lastTextBlock(el: Element, g: Grammar | null): Element | null {
  if (isTextBlock(el, g)) return el;
  const kids = elementChildren(el);
  for (let i = kids.length - 1; i >= 0; i--) {
    if (ATOMIC.has(kids[i].nodeName)) continue;
    const r = lastTextBlock(kids[i], g);
    if (r) return r;
  }
  return null;
}

/** Boundary scope: text blocks are only joined within the same scope element. */
function scopeOf(el: Element): Element | null {
  for (let c: Node | null = el; c && c.nodeType === 1; c = c.parentNode) {
    const n = c.nodeName;
    if (n === 'entry' || n === 'identAndStatusSection' || n === 'content' || n === 'dmodule' || n === 'footnote' || n === 'legend') return c as Element;
  }
  return null;
}

function* preorder(root: Node): Generator<Element> {
  const w = root.ownerDocument!.createTreeWalker(root, 1);
  for (let n = w.currentNode as Element | null; n; n = w.nextNode() as Element | null) yield n;
}

/** Previous text block in document order within the same scope. */
export function prevTextBlock(block: Element, g: Grammar | null): Element | null {
  const scope = scopeOf(block);
  const all = Array.from(preorder(scope ?? block.ownerDocument!.documentElement));
  const i = all.indexOf(block);
  for (let k = i - 1; k >= 0; k--) {
    const e = all[k];
    if (e.contains(block)) continue;
    if (isTextBlock(e, g) && !insideAtomic(e) && !isInlinePart(e, g)) return e;
  }
  return null;
}

export function nextTextBlock(block: Element, g: Grammar | null): Element | null {
  const scope = scopeOf(block);
  const all = Array.from(preorder(scope ?? block.ownerDocument!.documentElement));
  const i = all.indexOf(block);
  for (let k = i + 1; k < all.length; k++) {
    const e = all[k];
    if (block.contains(e)) continue;
    if (isTextBlock(e, g) && !insideAtomic(e) && !isInlinePart(e, g)) return e;
  }
  return null;
}

function insideAtomic(e: Element): boolean {
  for (let c: Node | null = e; c && c.nodeType === 1; c = c.parentNode) if (ATOMIC.has(c.nodeName)) return true;
  return false;
}

function stripIds(el: Element) {
  el.removeAttribute('id');
  for (const d of Array.from(el.getElementsByTagName('*'))) d.removeAttribute('id');
}

/**
 * The outermost inline element between `pos` and `upTo` that only holds other elements and so cannot be cut in two: an acronym is
 * exactly one term and one definition, and a second acronym with just the rest of the definition would be invalid.
 */
function wholeInlineAround(pos: ModelPos, upTo: Element, g: Grammar | null): Element | null {
  let found: Element | null = null;
  for (let c: Node | null = pos.node.nodeType === 1 ? pos.node : pos.node.parentNode; c && c !== upTo && c.nodeType === 1; c = c.parentNode) {
    const e = c as Element;
    if (!allowsText(e, g) && elementDisplay(e, g) === 'inline') found = e;
  }
  return found;
}

/**
 * Splits the tree at `pos` up to and including `upTo`. Returns the new right
 * half of `upTo` (inserted directly after it). A position inside an inline structure that cannot be cut in two (see
 * wholeInlineAround) is moved out of it: the break goes before the structure when the caret is at its very start, after it otherwise.
 */
export function splitAt(pos: ModelPos, upTo: Element, g: Grammar | null = null): Element {
  const whole = g ? wholeInlineAround(pos, upTo, g) : null;
  if (whole) {
    const r = whole.ownerDocument!.createRange();
    r.setStart(whole, 0);
    r.setEnd(pos.node, pos.offset);
    pos = r.toString() === '' ? before(whole) : after(whole);
  }
  let parent: Node;
  let index: number;
  if (pos.node.nodeType === 3 || pos.node.nodeType === 4) {
    const t = pos.node as Text;
    parent = t.parentNode!;
    if (pos.offset <= 0) index = nodeIndex(t);
    else if (pos.offset >= t.length) index = nodeIndex(t) + 1;
    else {
      t.splitText(pos.offset);
      index = nodeIndex(t) + 1;
    }
  } else {
    parent = pos.node;
    index = pos.offset;
  }
  if (!upTo.contains(parent)) throw new OpError('split target does not contain position');
  let right: Element | null = null;
  for (;;) {
    const el = parent as Element;
    const clone = el.cloneNode(false) as Element;
    stripIds(clone);
    const kids = Array.from(el.childNodes).slice(index);
    for (const k of kids) clone.appendChild(k);
    el.parentNode!.insertBefore(clone, el.nextSibling);
    right = clone;
    if (el === upTo) break;
    index = nodeIndex(el) + 1;
    parent = el.parentNode!;
  }
  return right!;
}

/** Removes empty formatting elements (e.g. empty emphasis left behind by splits). */
export function pruneEmptyFormatting(el: Element, keep?: Node | null) {
  for (const e of Array.from(el.getElementsByTagName('*')).reverse()) {
    if (FORMATTING.has(e.nodeName) && isEmptyEl(e) && e !== keep && !e.contains(keep ?? null)) e.parentNode?.removeChild(e);
  }
  // merge adjacent text
  el.normalize();
}

/** Removes empty text nodes in an element subtree. */
function dropEmptyText(el: Node) {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3 && c.nodeValue === '') el.removeChild(c);
  }
}

/** After removing content, removes ancestors that became empty structural shells. */
export function cleanupEmptyAncestors(start: Node | null, g: Grammar | null, stopAt?: Element | null) {
  let c: Node | null = start;
  while (c && c.nodeType === 1) {
    const el = c as Element;
    const parent = el.parentNode as Element | null;
    if (!parent || parent.nodeType !== 1) break;
    if (el === stopAt) break;
    const n = el.nodeName;
    const removable = SPLIT_CONTAINERS.has(n) || LIST_NAMES.has(n) || n === 'levelledPara' || n === 'note' || n === 'warning' || n === 'caution' || n === 'definitionList';
    if (removable && elementChildren(el).filter((k) => k.nodeName !== 'title').length === 0 && !hasText(el)) {
      parent.removeChild(el);
      c = parent;
      continue;
    }
    // listItem / para left without blocks
    if (removable) break;
    if (n === 'para' && isEmptyEl(el) && parent && LIST_NAMES.has(parent.nodeName)) {
      parent.removeChild(el);
      c = parent;
      continue;
    }
    break;
  }
  void g;
}

// ------------------------------------------------------------- skeletons
export interface SkeletonOptions {
  idPrefix?: string;
  depth?: number;
}

/** Creates an element with its minimal valid content and required attributes. */
export function createSkeleton(doc: Document, g: Grammar | null, name: string, opts: SkeletonOptions = {}): Element {
  const el = createEl(doc, name);
  const depth = opts.depth ?? 0;
  if (g && g.has(name)) {
    for (const a of g.attributes(name)) {
      if (!a.required || a.name === '*') continue;
      let v = a.fixed ?? a.default ?? a.enumValues?.[0] ?? '';
      if (a.base === 'ID') v = uniqueId(doc, opts.idPrefix ?? name.slice(0, 3));
      if (a.base === 'positiveInteger' || a.base === 'integer' || a.base === 'nonNegativeInteger') v = v || '1';
      setAttr(el, a.name, v);
    }
    if (depth < 8) {
      for (const c of g.requiredChildren(name)) {
        if (c.includes(':')) continue;
        el.appendChild(createSkeleton(doc, g, c, { ...opts, depth: depth + 1 }));
      }
    }
  }
  return el;
}

let idCounter = 0;
export function uniqueId(doc: Document, prefix: string): string {
  const p = prefix.replace(/[^A-Za-z0-9_.-]/g, '') || 'id';
  for (;;) {
    idCounter++;
    const id = `${p}-${String(idCounter).padStart(4, '0')}`;
    if (!findById(doc, id)) return id;
  }
}

export function findById(doc: Document, id: string): Element | null {
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i].getAttribute('id') === id) return all[i];
  return null;
}

// ------------------------------------------------------------------ text
export function insertText(pos: ModelPos, text: string, g: Grammar | null): ModelPos {
  pos = normalizePos(pos);
  text = stripInvalidXmlChars(text);
  if (!text) return pos;
  if (pos.node.nodeType === 3) {
    (pos.node as Text).insertData(pos.offset, text);
    return { node: pos.node, offset: pos.offset + text.length };
  }
  const el = pos.node as Element;
  if (!allowsText(el, g)) {
    // find or create somewhere text can go
    const target = textTargetNear(el, pos.offset, g);
    if (!target) throw new OpError(`Text is not allowed in <${el.nodeName}>`);
    return insertText(target, text, g);
  }
  const t = el.ownerDocument!.createTextNode(text);
  el.insertBefore(t, el.childNodes[pos.offset] ?? null);
  return { node: t, offset: text.length };
}

/** For a caret in element-only content, finds an adjacent text block or creates a para if permitted. */
export function textTargetNear(el: Element, offset: number, g: Grammar | null): ModelPos | null {
  const kids = el.childNodes;
  const next = kids[offset] as Element | undefined;
  const prev = kids[offset - 1] as Element | undefined;
  // Next to a table, figure, list or warning the text belongs in a paragraph of its own, not inside the nearest cell or item:
  // text typed right after a table must not end up in its last cell.
  const compound = (n?: Element) => !!n && n.nodeType === 1 && COMPOUND.has(n.nodeName);
  if (compound(prev) || compound(next)) {
    const idx = countElementsBefore(el, offset);
    for (const name of ['para', 'simplePara']) {
      if (g?.has(el.nodeName) && canInsertAt(g, el, idx, name)) {
        const p = createSkeleton(el.ownerDocument!, g, name);
        el.insertBefore(p, el.childNodes[offset] ?? null);
        return { node: p, offset: 0 };
      }
    }
  }
  if (prev && prev.nodeType === 1) {
    const tb = lastTextBlock(prev, g);
    if (tb) return endOf(tb, g);
  }
  if (next && next.nodeType === 1) {
    const tb = firstTextBlock(next, g);
    if (tb) return startOf(tb, g);
  }
  const idx = offset === 0 ? 0 : elementChildren(el).indexOf(prev as Element) + 1;
  for (const name of ['para', 'simplePara', 'notePara', 'warningAndCautionPara']) {
    if (g?.has(el.nodeName) && canInsertAt(g, el, idx, name)) {
      const p = createSkeleton(el.ownerDocument!, g, name);
      el.insertBefore(p, el.childNodes[offset] ?? null);
      return { node: p, offset: 0 };
    }
  }
  return null;
}

/** Deletes the model range [a, b] (document order) and joins partially selected blocks. */
export function deleteRange(a: ModelPos, b: ModelPos, g: Grammar | null): ModelPos {
  if (a.node === b.node && a.node.nodeType === 3) {
    const lo = Math.min(a.offset, b.offset);
    const hi = Math.max(a.offset, b.offset);
    (a.node as Text).deleteData(lo, hi - lo);
    return { node: a.node, offset: lo };
  }
  const doc = a.node.ownerDocument!;
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  if (range.collapsed) {
    // a after b
    range.setStart(b.node, b.offset);
    range.setEnd(a.node, a.offset);
  }
  // A selection that runs across the cells of a table, or from the text around it into a cell, must not cut the table apart (rows
  // with missing cells, a cell that lost its paragraph): cells are cleared or trimmed, and the table itself stays whole.
  const startPos0: ModelPos = { node: range.startContainer, offset: range.startOffset };
  const startEntry = entryAround(range.startContainer);
  const crossed = clearAcrossTables(range, g);
  if (crossed && range.collapsed) {
    if (startPos0.node.isConnected && (!startEntry || startEntry.contains(startPos0.node))) return normalizePos(startPos0);
    return startEntry && startEntry.isConnected ? startOf(startEntry, g) : normalizePos({ node: range.startContainer, offset: range.startOffset });
  }
  const startBlock = textBlockOf(range.startContainer, g);
  const endBlock = textBlockOf(range.endContainer, g);
  range.deleteContents();
  let pos: ModelPos = { node: range.startContainer, offset: range.startOffset };
  if (startBlock && endBlock && startBlock !== endBlock && startBlock.isConnected && endBlock.isConnected && !startBlock.contains(endBlock) && !endBlock.contains(startBlock)) {
    if (scopeOf(startBlock) === scopeOf(endBlock) && canJoin(startBlock, endBlock, g)) {
      const parentOfEnd = endBlock.parentNode as Element;
      joinInto(startBlock, endBlock);
      cleanupEmptyAncestors(parentOfEnd, g);
    }
  }
  if (startBlock && startBlock.isConnected) {
    // the start position may have been inside removed nodes
    if (!pos.node.isConnected || !startBlock.contains(pos.node)) pos = endOf(startBlock, g);
  }
  if (crossed && startEntry && startEntry.isConnected && !startEntry.contains(pos.node)) pos = startPos0.node.isConnected && startEntry.contains(startPos0.node) ? startPos0 : startOf(startEntry, g);
  if (!pos.node.isConnected) pos = { node: doc.documentElement, offset: 0 };
  return normalizePos(pos);
}

function entryAround(n: Node): Element | null {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) if (c.nodeType === 1 && c.nodeName === 'entry') return c as Element;
  return null;
}

/** Does `range` contain all of `el`? */
function rangeCovers(range: Range, el: Element): boolean {
  const r = el.ownerDocument!.createRange();
  r.selectNode(el);
  return range.compareBoundaryPoints(Range.START_TO_START, r) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, r) >= 0;
}

/** The part of `range` that lies inside `el`'s content, or null when nothing of it does. */
function clipTo(range: Range, el: Element): Range | null {
  const r = el.ownerDocument!.createRange();
  r.selectNodeContents(el);
  if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
  return r.collapsed ? null : r;
}

/**
 * Handles every table that `range` only partly covers: the cells inside the range are emptied (a cell must keep its paragraph) or
 * trimmed, then the range is cut back to the text outside the table. Tables that lie wholly inside the range stay in it and are
 * removed with the rest. Returns whether any table was handled.
 */
function clearAcrossTables(range: Range, g: Grammar | null): boolean {
  const doc = range.startContainer.ownerDocument ?? (range.startContainer as Document);
  const partial = Array.from(doc.getElementsByTagName('table')).filter((t) => {
    if (!range.intersectsNode(t) || rangeCovers(range, t)) return false;
    const entries = Array.from(t.getElementsByTagName('entry')).filter((e) => range.intersectsNode(e));
    if (!entries.length) return false; // inside the title only: plain text
    return !(entries.length === 1 && entryAround(range.startContainer) === entries[0] && entryAround(range.endContainer) === entries[0]);
  });
  for (const t of partial) {
    const clip = clipTo(range, t);
    if (clip) {
      for (const e of Array.from(t.getElementsByTagName('entry'))) {
        if (!e.isConnected || !clip.intersectsNode(e)) continue;
        if (rangeCovers(clip, e)) {
          while (e.firstChild) e.removeChild(e.firstChild);
          if (!g || !g.has('entry') || !g.allowsText('entry')) e.appendChild(createSkeleton(e.ownerDocument!, g, 'para'));
        } else {
          const sub = clipTo(clip, e);
          if (sub) deleteRange({ node: sub.startContainer, offset: sub.startOffset }, { node: sub.endContainer, offset: sub.endOffset }, g);
        }
      }
      for (const title of elementChildren(t).filter((c) => c.nodeName === 'title')) {
        const sub = clipTo(clip, title);
        if (sub) deleteRange({ node: sub.startContainer, offset: sub.startOffset }, { node: sub.endContainer, offset: sub.endOffset }, g);
      }
    }
    if (t.contains(range.startContainer)) range.setStartAfter(t);
    if (t.contains(range.endContainer)) range.setEndBefore(t);
  }
  return partial.length > 0;
}

/**
 * Whether two text blocks may be merged by Backspace/Delete/deleting a selection. Merging is Word-style for neighbouring paragraphs
 * and list items; it is refused where it would blur what the structure keeps apart: text inside a warning, caution, note, figure,
 * table cell or definition entry flowing into the text around it (or the reverse), a title and the body, a term and its definition,
 * code and prose, or a block into its own descendant.
 */
export function canJoin(prev: Element, block: Element, g: Grammar | null): boolean {
  if (prev.contains(block) || block.contains(prev)) return false;
  if (closestPreserve(prev) || closestPreserve(block)) return false;
  const isolated = (x: Element, other: Element) => {
    for (let c: Node | null = x; c && c.nodeType === 1; c = c.parentNode) {
      if (JOIN_ISOLATED.has(c.nodeName) && !c.contains(other)) return true;
    }
    return false;
  };
  if (isolated(prev, block) || isolated(block, prev)) return false;
  const parent = block.parentNode as Element;
  if (prev.parentNode === parent && prev.nodeName !== block.nodeName && !allowsText(parent, g)) return false;
  return true;
}

/** Moves content of `src` to the end of `dst` and removes `src`. Returns the junction. */
export function joinInto(dst: Element, src: Element): ModelPos {
  dropEmptyText(dst);
  const junction: ModelPos = { node: dst, offset: dst.childNodes.length };
  const lastBefore = dst.lastChild;
  while (src.firstChild) dst.appendChild(src.firstChild);
  src.parentNode?.removeChild(src);
  // collapse duplicated spaces at the seam and merge texts
  if (lastBefore && lastBefore.nodeType === 3) {
    const len = lastBefore.nodeValue!.length;
    dst.normalize();
    return { node: lastBefore, offset: len };
  }
  dst.normalize();
  return normalizePos(junction.offset <= dst.childNodes.length ? junction : { node: dst, offset: dst.childNodes.length });
}

// ------------------------------------------------------------- enter key
export interface EnterResult {
  sel: ModelSelection;
  message?: string;
}

export function smartEnter(pos: ModelPos, g: Grammar | null): EnterResult {
  pos = normalizePos(pos);
  const block = textBlockOf(pos.node, g);
  const doc = pos.node.ownerDocument!;
  if (!block) {
    const container = containerElement(pos);
    const t = textTargetNear(container, pos.node === container ? pos.offset : 0, g);
    if (t) return { sel: caret(t) };
    throw new OpError('Cannot create a new paragraph here');
  }
  if (PRESERVE.has(block.nodeName) || closestPreserve(pos.node)) {
    return { sel: caret(insertText(pos, '\n', g)) };
  }
  const parent = block.parentNode as Element;
  const name = block.nodeName;
  const empty = !hasText(block) && elementChildren(block).length === 0;

  // A definition's term: Enter moves on to its definition (splitting the term would leave an entry without one).
  if (name === 'listItemTerm') {
    const def = elementChildren(parent).find((c) => c.nodeName === 'listItemDefinition');
    const t = def ? firstTextBlock(def, g) : null;
    if (t) return { sel: caret(startOf(t, g)) };
  }

  // 1. Empty item at end of a list: exit the list (Word behaviour).
  if (empty && SPLIT_CONTAINERS.has(parent.nodeName) && parent.nodeName !== 'proceduralStep' && elementChildren(parent).length === 1) {
    const item = parent;
    const list = item.parentNode as Element;
    if (LIST_NAMES.has(list.nodeName) && !item.nextElementSibling) {
      const outerPara = list.parentNode as Element;
      list.removeChild(item);
      if (elementChildren(list).filter((e) => e.nodeName !== 'title').length === 0) outerPara.removeChild(list);
      const holder = outerPara.parentNode as Element;
      if (holder && canInsertAt(g, holder, elementIndex(outerPara) + 1, outerPara.nodeName)) {
        const np = createSkeleton(doc, g, outerPara.nodeName);
        holder.insertBefore(np, outerPara.nextSibling);
        return { sel: caret(startOf(np, g)) };
      }
      return { sel: caret(endOf(outerPara, g)) };
    }
  }

  // 2. Paragraph inside a repeatable container (list item, procedural step): split the container.
  if (SPLIT_CONTAINERS.has(parent.nodeName) && firstTextBlock(parent, g) === block) {
    const holder = parent.parentNode as Element;
    if (canInsertAt(g, holder, elementIndex(parent) + 1, parent.nodeName)) {
      // True split (Word semantics): the new container receives the trailing text and any
      // nested structures (sub-steps, nested lists) that followed the caret.
      const rightBlock = splitAt(pos, block, g);
      const newContainer = doc.createElementNS(null, parent.nodeName);
      for (const a of Array.from(parent.attributes)) if (a.name !== 'id') newContainer.setAttribute(a.name, a.value);
      // move the right half of the block and everything after it within the container
      const moving: Node[] = [];
      for (let n: Node | null = rightBlock; n; n = n.nextSibling) moving.push(n);
      for (const n of moving) newContainer.appendChild(n);
      holder.insertBefore(newContainer, parent.nextSibling);
      pruneEmptyFormatting(block);
      pruneEmptyFormatting(rightBlock);
      return { sel: caret(startOf(rightBlock, g)) };
    }
  }

  // 3. Title: continue with a paragraph after it.
  if (name === 'title' || name === 'techName' || name === 'infoName') {
    for (const pn of ['para', 'warningAndCautionPara', 'notePara']) {
      if (name !== 'title') break;
      if (canInsertAt(g, parent, elementIndex(block) + 1, pn)) {
        const np = createSkeleton(doc, g, pn);
        const rest = splitAt(pos, block, g);
        while (rest.firstChild) np.appendChild(rest.firstChild);
        rest.parentNode!.removeChild(rest);
        parent.insertBefore(np, block.nextSibling);
        pruneEmptyFormatting(block);
        pruneEmptyFormatting(np);
        return { sel: caret(startOf(np, g)) };
      }
    }
    throw new OpError(`A new paragraph cannot follow <${name}> here`);
  }

  // 4. Generic split when the parent allows another sibling of the same type.
  if (canInsertAt(g, parent, elementIndex(block) + 1, name)) {
    const right = splitAt(pos, block, g);
    pruneEmptyFormatting(block);
    pruneEmptyFormatting(right);
    return { sel: caret(startOf(right, g)) };
  }

  // 5. Fallback: a new paragraph after the nearest ancestor that permits one.
  const ip = findInsertionPoint(block, 'para', g, 'after');
  if (ip) {
    const np = createSkeleton(doc, g, 'para');
    ip.parent.insertBefore(np, ip.ref);
    return { sel: caret(startOf(np, g)) };
  }
  throw new OpError(`Cannot split <${name}> here`);
}

function closestPreserve(n: Node): boolean {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) {
    if (c.nodeType === 1 && (PRESERVE.has(c.nodeName) || (c as Element).getAttribute('xml:space') === 'preserve')) return true;
  }
  return false;
}

// ---------------------------------------------------------- backspace/delete
type Leaf = { kind: 'char'; node: Text; offset: number } | { kind: 'el'; el: Element } | { kind: 'block'; el: Element } | null;

function prevLeaf(pos: ModelPos, block: Element): Leaf {
  // walk backwards inside block from pos
  let node: Node | null;
  if (pos.node.nodeType === 3) {
    if (pos.offset > 0) return { kind: 'char', node: pos.node as Text, offset: pos.offset };
    node = pos.node;
  } else {
    const kids = pos.node.childNodes;
    const prev = kids[pos.offset - 1];
    if (prev) return descendLast(prev, block);
    node = pos.node;
  }
  // climb until a previous sibling exists
  while (node && node !== block) {
    if (node.previousSibling) return descendLast(node.previousSibling, block);
    node = node.parentNode;
  }
  return null;
}

function descendLast(n: Node, block: Element): Leaf {
  if (n.nodeType === 3) {
    if (n.nodeValue!.length) return { kind: 'char', node: n as Text, offset: n.nodeValue!.length };
    return n.previousSibling ? descendLast(n.previousSibling, block) : prevLeaf({ node: n.parentNode!, offset: nodeIndex(n) }, block);
  }
  if (n.nodeType === 1) {
    const el = n as Element;
    if (ATOMIC.has(el.nodeName) || !el.firstChild) return { kind: 'el', el };
    // a nested block (a list inside the paragraph, ...) is not characters of this one: the caret goes there, nothing is deleted
    if (isBlockName(el.nodeName)) return { kind: 'block', el };
    return descendLast(el.lastChild!, block);
  }
  return n.previousSibling ? descendLast(n.previousSibling, block) : null;
}

function nextLeaf(pos: ModelPos, block: Element): Leaf {
  let node: Node | null;
  if (pos.node.nodeType === 3) {
    if (pos.offset < pos.node.nodeValue!.length) return { kind: 'char', node: pos.node as Text, offset: pos.offset };
    node = pos.node;
  } else {
    const next = pos.node.childNodes[pos.offset];
    if (next) return descendFirst(next, block);
    node = pos.node;
  }
  while (node && node !== block) {
    if (node.nextSibling) return descendFirst(node.nextSibling, block);
    node = node.parentNode;
  }
  return null;
}

function descendFirst(n: Node, block: Element): Leaf {
  if (n.nodeType === 3) {
    if (n.nodeValue!.length) return { kind: 'char', node: n as Text, offset: 0 };
    return n.nextSibling ? descendFirst(n.nextSibling, block) : nextLeaf({ node: n.parentNode!, offset: nodeIndex(n) + 1 }, block);
  }
  if (n.nodeType === 1) {
    const el = n as Element;
    if (ATOMIC.has(el.nodeName) || !el.firstChild) return { kind: 'el', el };
    if (isBlockName(el.nodeName)) return { kind: 'block', el };
    return descendFirst(el.firstChild!, block);
  }
  return n.nextSibling ? descendFirst(n.nextSibling, block) : null;
}

function charLenBefore(s: string, offset: number): number {
  const c = s.charCodeAt(offset - 1);
  return c >= 0xdc00 && c <= 0xdfff && offset >= 2 ? 2 : 1;
}

function charLenAfter(s: string, offset: number): number {
  const c = s.charCodeAt(offset);
  return c >= 0xd800 && c <= 0xdbff ? 2 : 1;
}

export interface DeleteOptions {
  word?: boolean;
}

export function backspace(pos: ModelPos, g: Grammar | null, opts: DeleteOptions = {}): ModelSelection {
  pos = normalizePos(pos);
  const block = textBlockOf(pos.node, g);
  if (!block) throw new OpError('Nothing to delete here');
  const leaf = prevLeaf(pos, block);
  if (leaf) {
    if (leaf.kind === 'char') {
      const s = leaf.node.nodeValue!;
      let start = leaf.offset - charLenBefore(s, leaf.offset);
      if (opts.word) {
        let i = leaf.offset;
        while (i > 0 && /\s/.test(s[i - 1])) i--;
        while (i > 0 && !/\s/.test(s[i - 1])) i--;
        start = i;
      }
      leaf.node.deleteData(start, leaf.offset - start);
      const parent = leaf.node.parentNode as Element;
      if (leaf.node.nodeValue === '' && FORMATTING.has(parent.nodeName) && isEmptyEl(parent)) {
        // keep empty formatting element so typing continues inside it
        return caret({ node: parent, offset: 0 });
      }
      return caret({ node: leaf.node, offset: start });
    }
    if (leaf.kind === 'block') return caret(endOf(leaf.el, g));
    const el = leaf.el;
    const p = before(el);
    el.parentNode!.removeChild(el);
    return caret(normalizePos(p));
  }
  // at block start: join with previous block
  const prev = prevTextBlock(block, g);
  if (isEmptyEl(block)) {
    const parent = block.parentNode as Element;
    if (!prev) throw new OpError('Already at the start');
    parent.removeChild(block);
    cleanupEmptyAncestors(parent, g);
    return caret(endOf(prev, g));
  }
  if (!prev) throw new OpError('Already at the start');
  if (prev.contains(block)) return caret(endOfTextBefore(prev, block, g)); // an item of a list inside prev: its own text, not prev's, is next to the caret
  if (block.nodeName === 'title' || (prev.nodeName === 'title' && block.parentNode !== prev.parentNode) || !canJoin(prev, block, g)) {
    return caret(endOf(prev, g));
  }
  const parent = block.parentNode as Element;
  const j = joinInto(prev, block);
  cleanupEmptyAncestors(parent, g);
  return caret(j);
}

/** End of the last text of `host` that comes before `before` (an element nested in `host`). */
function endOfTextBefore(host: Element, before: Element, g: Grammar | null): ModelPos {
  let last: Text | null = null;
  const w = host.ownerDocument!.createTreeWalker(host, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (before.contains(n) || before.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
    last = n as Text;
  }
  return last ? { node: last, offset: last.length } : startOf(host, g);
}

export function deleteForward(pos: ModelPos, g: Grammar | null, opts: DeleteOptions = {}): ModelSelection {
  pos = normalizePos(pos);
  const block = textBlockOf(pos.node, g);
  if (!block) throw new OpError('Nothing to delete here');
  const leaf = nextLeaf(pos, block);
  if (leaf) {
    if (leaf.kind === 'char') {
      const s = leaf.node.nodeValue!;
      let end = leaf.offset + charLenAfter(s, leaf.offset);
      if (opts.word) {
        let i = leaf.offset;
        while (i < s.length && /\s/.test(s[i])) i++;
        while (i < s.length && !/\s/.test(s[i])) i++;
        end = i;
      }
      leaf.node.deleteData(leaf.offset, end - leaf.offset);
      return caret({ node: leaf.node, offset: leaf.offset });
    }
    if (leaf.kind === 'block') return caret(startOf(leaf.el, g));
    const el = leaf.el;
    const p = before(el);
    el.parentNode!.removeChild(el);
    return caret(normalizePos(p));
  }
  const next = nextTextBlock(block, g);
  if (!next) throw new OpError('Already at the end');
  if (next.nodeName === 'title' || !canJoin(block, next, g)) return caret(startOf(next, g));
  if (isEmptyEl(block) && block.nodeName !== 'title') {
    const parent = block.parentNode as Element;
    parent.removeChild(block);
    cleanupEmptyAncestors(parent, g);
    return caret(startOf(next, g));
  }
  const parent = next.parentNode as Element;
  const j = joinInto(block, next);
  cleanupEmptyAncestors(parent, g);
  return caret(j);
}

// ------------------------------------------------------- element insertion
export interface InsertionPoint {
  parent: Element;
  ref: Node | null;
}

/**
 * Finds where `name` can be inserted relative to the node at `from`:
 * innermost ancestor first; prefers the position after the current child.
 */
export function findInsertionPoint(from: Node, name: string, g: Grammar | null, prefer: 'after' | 'before' = 'after'): InsertionPoint | null {
  let child: Node = from;
  let parent = from.parentNode as Element | null;
  if (from.nodeType === 1 && !allowsText(from as Element, g) && g?.has((from as Element).nodeName)) {
    // the element itself may accept it at its end
    const el = from as Element;
    if (canInsertAt(g, el, elementChildren(el).length, name)) return { parent: el, ref: null };
  }
  while (parent && parent.nodeType === 1) {
    const kids = elementChildren(parent);
    const idx = child.nodeType === 1 ? kids.indexOf(child as Element) : kids.length;
    // nearest positions first: after/before the current child, then outwards
    const order: number[] = prefer === 'after' ? [idx + 1, idx] : [idx, idx + 1];
    for (let d = 1; d <= kids.length; d++) {
      if (idx - d >= 0) order.push(idx - d);
      if (idx + 1 + d <= kids.length) order.push(idx + 1 + d);
    }
    for (const i of order) {
      if (i < 0 || i > kids.length) continue;
      if (canInsertAt(g, parent, i, name)) return { parent, ref: i < kids.length ? kids[i] : nextAfterLastElement(parent) };
    }
    if (parent.nodeName === 'content' || parent.nodeName === 'dmodule') break;
    child = parent;
    parent = parent.parentNode as Element | null;
  }
  return null;
}

function nextAfterLastElement(parent: Element): Node | null {
  const last = parent.lastElementChild;
  return last ? last.nextSibling : null;
}

/** Is `name` allowed inline at a text position (mixed content)? */
export function inlineAllowedAt(pos: ModelPos, name: string, g: Grammar | null): Element | null {
  const container = containerElement(pos);
  if (!allowsText(container, g)) return null;
  const idx = pos.node.nodeType === 3 ? elementChildren(container).filter((e) => e.compareDocumentPosition(pos.node) & Node.DOCUMENT_POSITION_FOLLOWING).length : elementChildren(container).filter((_, i) => i < countElementsBefore(container, pos.offset)).length;
  return canInsertAt(g, container, idx, name) ? container : null;
}

function countElementsBefore(parent: Node, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < parent.childNodes.length; i++) if (parent.childNodes[i].nodeType === 1) n++;
  return n;
}

/** Inserts a node at a model position, splitting text if needed. */
export function insertNodeAt(pos: ModelPos, node: Node): void {
  if (pos.node.nodeType === 3) {
    const t = pos.node as Text;
    if (pos.offset === 0) t.parentNode!.insertBefore(node, t);
    else if (pos.offset >= t.length) t.parentNode!.insertBefore(node, t.nextSibling);
    else {
      const right = t.splitText(pos.offset);
      t.parentNode!.insertBefore(node, right);
    }
  } else {
    pos.node.insertBefore(node, pos.node.childNodes[pos.offset] ?? null);
  }
}

export interface InsertResult {
  element: Element;
  sel: ModelSelection;
}

/**
 * Inserts an element at the caret: inline at the caret when the content model
 * permits; otherwise at the nearest valid structural position.
 */
export function insertElement(pos: ModelPos, nameOrEl: string | Element, g: Grammar | null, opts: { prefer?: 'after' | 'before' } = {}): InsertResult {
  const doc = pos.node.ownerDocument!;
  const el = typeof nameOrEl === 'string' ? createSkeleton(doc, g, nameOrEl) : nameOrEl;
  const name = el.nodeName;
  pos = normalizePos(pos);
  const container = containerElement(pos);
  if (allowsText(container, g) && inlineAllowedAt(pos, name, g)) {
    insertNodeAt(pos, el);
  } else if (!allowsText(container, g) && pos.node === container && canInsertAt(g, container, countElementsBefore(container, pos.offset), name)) {
    container.insertBefore(el, container.childNodes[pos.offset] ?? null);
  } else {
    const from = pos.node.nodeType === 3 ? pos.node.parentNode! : pos.node;
    const ip = findInsertionPoint(from, name, g, opts.prefer ?? 'after');
    if (!ip) throw new OpError(`<${name}> is not allowed here`);
    ip.parent.insertBefore(el, ip.ref);
  }
  const tb = firstTextBlock(el, g);
  const sel = tb ? caret(startOf(tb, g)) : { anchor: after(el), focus: after(el), element: el };
  return { element: el, sel };
}

// --------------------------------------------------------- wrap / unwrap
export function rangeOrdered(sel: ModelSelection): [ModelPos, ModelPos] {
  const a = sel.anchor;
  const b = sel.focus;
  if (a.node === b.node) return a.offset <= b.offset ? [a, b] : [b, a];
  const cmp = a.node.compareDocumentPosition(b.node);
  if (cmp & Node.DOCUMENT_POSITION_CONTAINED_BY) {
    // b inside a (a is element)
    const r = a.node.ownerDocument!.createRange();
    r.setStart(a.node, a.offset);
    return r.comparePoint(b.node, b.offset) >= 0 ? [a, b] : [b, a];
  }
  if (cmp & Node.DOCUMENT_POSITION_CONTAINS) {
    const r = a.node.ownerDocument!.createRange();
    r.setStart(b.node, b.offset);
    return r.comparePoint(a.node, a.offset) >= 0 ? [b, a] : [a, b];
  }
  return cmp & Node.DOCUMENT_POSITION_FOLLOWING ? [a, b] : [b, a];
}

export function isCollapsed(sel: ModelSelection): boolean {
  return sel.anchor.node === sel.focus.node && sel.anchor.offset === sel.focus.offset;
}

/** Wraps an inline range (within one text block) in a new element. */
export function wrapInline(sel: ModelSelection, name: string, g: Grammar | null, attrs: Record<string, string> = {}): Element {
  const [a, b] = rangeOrdered(sel);
  const doc = a.node.ownerDocument!;
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const container = range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as Element) : (range.commonAncestorContainer.parentNode as Element);
  if (!allowsText(container, g)) throw new OpError(`Select text within a single paragraph to wrap it in <${name}>`);
  if (g?.has(container.nodeName) && !g.childCandidates(container.nodeName).includes(name)) throw new OpError(`<${name}> is not allowed in <${container.nodeName}>`);
  const el = createEl(doc, name);
  for (const [k, v] of Object.entries(attrs)) setAttr(el, k, v);
  const frag = range.extractContents();
  el.appendChild(frag);
  range.insertNode(el);
  pruneEmptyFormatting(container, el);
  return el;
}

/** Wraps consecutive sibling elements [first..last] in a new element. */
export function wrapElements(first: Element, last: Element, name: string, g: Grammar | null): Element {
  const parent = first.parentNode as Element;
  const doc = parent.ownerDocument!;
  const items: Node[] = [];
  for (let n: Node | null = first; n; n = n.nextSibling) {
    items.push(n);
    if (n === last) break;
  }
  const names = childNames(parent);
  const i0 = elementIndex(first);
  const i1 = elementIndex(last);
  const newSeq = names.slice(0, i0).concat(name, names.slice(i1 + 1));
  if (g?.has(parent.nodeName) && !g.isRepairable(parent.nodeName, newSeq)) throw new OpError(`<${name}> is not allowed in <${parent.nodeName}> here`);
  const wrappedNames = items.filter((n) => n.nodeType === 1).map((n) => n.nodeName);
  if (g?.has(name) && !g.isRepairable(name, wrappedNames)) throw new OpError(`<${name}> cannot contain ${wrappedNames.map((n) => '<' + n + '>').join(', ')}`);
  const el = createEl(doc, name);
  parent.insertBefore(el, first);
  for (const n of items) el.appendChild(n);
  // add missing required leading parts (e.g. a title) when cheap
  return el;
}

export function canUnwrap(el: Element, g: Grammar | null): boolean {
  const parent = el.parentNode as Element | null;
  if (!parent || parent.nodeType !== 1) return false;
  if (!g || !g.has(parent.nodeName)) return true;
  if (hasOwnText(el) && !g.allowsText(parent.nodeName)) return false;
  const names = childNames(parent);
  const i = elementIndex(el);
  const seq = names.slice(0, i).concat(childNames(el), names.slice(i + 1));
  return g.isRepairable(parent.nodeName, seq);
}

function hasOwnText(el: Element): boolean {
  for (const c of Array.from(el.childNodes)) if (c.nodeType === 3 && /\S/.test(c.nodeValue!)) return true;
  return false;
}

/** Removes the element tags, keeping its content in place. */
export function unwrap(el: Element, g: Grammar | null): ModelSelection {
  if (!canUnwrap(el, g)) throw new OpError(`Removing <${el.nodeName}> would leave its content in an invalid place`);
  const parent = el.parentNode as Element;
  const first = el.firstChild;
  const last = el.lastChild;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  const p = before(el);
  parent.removeChild(el);
  if (first && last) {
    const sel: ModelSelection = {
      anchor: first.nodeType === 3 ? { node: first, offset: 0 } : before(first),
      focus: last.nodeType === 3 ? { node: last, offset: last.nodeValue!.length } : after(last),
    };
    return sel;
  }
  return caret(normalizePos(p));
}

export function canRename(el: Element, newName: string, g: Grammar | null): boolean {
  const parent = el.parentNode as Element | null;
  if (!g) return true;
  if (parent && parent.nodeType === 1 && g.has(parent.nodeName)) {
    const names = childNames(parent);
    names[elementIndex(el)] = newName;
    if (!g.isRepairable(parent.nodeName, names)) return false;
  }
  if (g.has(newName)) {
    if (hasOwnText(el) && !g.allowsText(newName)) return false;
    if (!g.isRepairable(newName, childNames(el))) return false;
  }
  return true;
}

/** Elements this element may be changed into. */
export function renameCandidates(el: Element, g: Grammar | null): string[] {
  if (!g) return [];
  const parent = el.parentNode as Element | null;
  const pool = parent && parent.nodeType === 1 && g.has(parent.nodeName) ? g.childCandidates(parent.nodeName) : g.elementNames;
  return pool.filter((n) => n !== el.nodeName && canRename(el, n, g)).sort();
}

export function rename(el: Element, newName: string, g: Grammar | null): Element {
  if (!canRename(el, newName, g)) throw new OpError(`<${el.nodeName}> cannot be changed to <${newName}> here`);
  const doc = el.ownerDocument!;
  const n = createEl(doc, newName);
  const allowed = g?.has(newName) ? new Set(g.attributes(newName).map((a) => a.name)) : null;
  for (const a of Array.from(el.attributes)) {
    if (!allowed || allowed.has(a.name) || a.name.startsWith('xmlns')) {
      if (a.namespaceURI) n.setAttributeNS(a.namespaceURI, a.name, a.value);
      else n.setAttribute(a.name, a.value);
    }
  }
  while (el.firstChild) n.appendChild(el.firstChild);
  el.parentNode!.replaceChild(n, el);
  return n;
}

export function deleteElement(el: Element, g: Grammar | null): ModelSelection {
  const parent = el.parentNode as Element;
  const prev = el.previousElementSibling;
  const next = el.nextElementSibling;
  const ref = el.nextSibling;
  const wasValid = !g || !g.has(parent.nodeName) || g.isValidContent(parent.nodeName, childNames(parent));
  parent.removeChild(el);
  if (wasValid && g?.has(parent.nodeName) && !g.isValidContent(parent.nodeName, childNames(parent))) {
    // the parent needs this element (the only graphic of a figure, the only row of a table): an emptied list or item goes with it, anything else refuses
    cleanupEmptyAncestors(parent, g);
    if (parent.isConnected && !g.isValidContent(parent.nodeName, childNames(parent))) {
      parent.insertBefore(el, ref && ref.parentNode === parent ? ref : null);
      throw new OpError(`<${el.nodeName}> is required in <${parent.nodeName}> and cannot be deleted`);
    }
  }
  const target = (next && (firstTextBlock(next, g) ? startOf(next, g) : null)) || (prev && (lastTextBlock(prev, g) ? endOf(prev, g) : null)) || { node: parent, offset: 0 };
  return caret(target);
}

// --------------------------------------------------------- move / nesting
export function moveElement(el: Element, dir: -1 | 1, g: Grammar | null): void {
  const parent = el.parentNode as Element;
  const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
  if (!sib) throw new OpError(dir < 0 ? 'Already the first element' : 'Already the last element');
  const names = childNames(parent);
  const i = elementIndex(el);
  const j = i + dir;
  [names[i], names[j]] = [names[j], names[i]];
  if (g?.has(parent.nodeName) && !g.isRepairable(parent.nodeName, names)) throw new OpError(`<${el.nodeName}> cannot be moved past <${sib.nodeName}>`);
  if (dir < 0) parent.insertBefore(el, sib);
  else parent.insertBefore(el, sib.nextSibling);
}

/** Nests a levelled paragraph / step / list item into its previous sibling. */
export function demote(el: Element, g: Grammar | null): void {
  const name = el.nodeName;
  const prev = el.previousElementSibling;
  if (!prev || prev.nodeName !== name) throw new OpError(`There is no previous <${name}> to nest into`);
  if (name === 'listItem' || name === 'attentionRandomListItem' || name === 'attentionSequentialListItem') {
    const list = el.parentNode as Element;
    let host = lastTextBlock(prev, g);
    if (!host || host.nodeName !== 'para') {
      host = createSkeleton(el.ownerDocument!, g, 'para');
      prev.appendChild(host);
    }
    let sub = host.lastElementChild;
    if (!sub || sub.nodeName !== list.nodeName || hasTrailingText(host, sub)) {
      sub = el.ownerDocument!.createElementNS(null, list.nodeName);
      for (const a of Array.from(list.attributes)) if (a.name !== 'id') sub.setAttribute(a.name, a.value);
      if (!canInsertAt(g, host, elementChildren(host).length, list.nodeName)) throw new OpError('Nested lists are not allowed here');
      host.appendChild(sub);
    }
    sub.appendChild(el);
    return;
  }
  const kids = elementChildren(prev);
  if (!canInsertAt(g, prev, kids.length, name)) throw new OpError(`<${name}> cannot be nested here`);
  prev.appendChild(el);
}

function hasTrailingText(host: Element, after: Element): boolean {
  for (let n = after.nextSibling; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue!)) return true;
  return false;
}

/** Moves a nested levelled paragraph / step / list item one level up. */
export function promote(el: Element, g: Grammar | null): void {
  const name = el.nodeName;
  if (name === 'listItem' || name === 'attentionRandomListItem' || name === 'attentionSequentialListItem') {
    const list = el.parentNode as Element;
    const para = list.parentNode as Element;
    const outerItem = para?.parentNode as Element;
    if (!outerItem || outerItem.nodeName !== name) throw new OpError('The list item is already at the top level');
    const outerList = outerItem.parentNode as Element;
    // following siblings become a nested list of the promoted item
    const following: Element[] = [];
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) following.push(n);
    outerList.insertBefore(el, outerItem.nextSibling);
    if (following.length) {
      let host = lastTextBlock(el, g);
      if (!host || host.nodeName !== 'para') {
        host = createSkeleton(el.ownerDocument!, g, 'para');
        el.appendChild(host);
      }
      const sub = el.ownerDocument!.createElementNS(null, list.nodeName);
      for (const a of Array.from(list.attributes)) if (a.name !== 'id') sub.setAttribute(a.name, a.value);
      following.forEach((f) => sub.appendChild(f));
      host.appendChild(sub);
    }
    if (elementChildren(list).filter((e) => e.nodeName !== 'title').length === 0) list.parentNode!.removeChild(list);
    return;
  }
  const parent = el.parentNode as Element;
  if (parent.nodeName !== name) throw new OpError(`<${name}> is already at the top level`);
  const grand = parent.parentNode as Element;
  if (!canInsertAt(g, grand, elementIndex(parent) + 1, name)) throw new OpError(`<${name}> cannot be promoted here`);
  const following: Element[] = [];
  for (let n = el.nextElementSibling; n; n = n.nextElementSibling) following.push(n);
  grand.insertBefore(el, parent.nextSibling);
  for (const f of following) {
    if (canInsertAt(g, el, elementChildren(el).length, f.nodeName)) el.appendChild(f);
    else break;
  }
}

// ---------------------------------------------------------- inline format
interface Seg { node: Text; start: number; end: number }

function textSegments(a: ModelPos, b: ModelPos): Seg[] {
  const doc = a.node.ownerDocument!;
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const segs: Seg[] = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) {
    segs.push({ node: root as Text, start: range.startOffset, end: range.endOffset });
    return segs;
  }
  const w = doc.createTreeWalker(root, 4);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    if (!range.intersectsNode(n)) continue;
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.length;
    if (end > start) segs.push({ node: n, start, end });
  }
  return segs;
}

export type ElementMatcher = (e: Element) => boolean;

/** Toggles an inline formatting element over a selection. Returns new selection. */
export function toggleInline(sel: ModelSelection, name: string, attrs: Record<string, string>, matches: ElementMatcher, g: Grammar | null): ModelSelection {
  const [a, b] = rangeOrdered(sel);
  const doc = a.node.ownerDocument!;
  const closestMatch = (n: Node): Element | null => {
    for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) {
      if (c.nodeType === 1 && matches(c as Element)) return c as Element;
      if (c.nodeType === 1 && isTextBlock(c as Element, g)) return null;
    }
    return null;
  };
  if (isCollapsed(sel)) {
    const m = closestMatch(a.node);
    if (m) {
      // step out of the formatting element: split it at the caret
      if (isEmptyEl(m)) {
        const p = before(m);
        m.parentNode!.removeChild(m);
        return caret(normalizePos(p));
      }
      const right = splitAt(a, m);
      const p = after(m);
      if (isEmptyEl(right)) right.parentNode!.removeChild(right);
      if (isEmptyEl(m)) m.parentNode!.removeChild(m);
      return caret(p.node.isConnected ? p : normalizePos(before(right)));
    }
    const container = containerElement(a);
    if (!inlineAllowedAt(a, name, g)) throw new OpError(`<${name}> is not allowed in <${container.nodeName}>`);
    const el = createEl(doc, name);
    for (const [k, v] of Object.entries(attrs)) setAttr(el, k, v);
    insertNodeAt(a, el);
    return caret({ node: el, offset: 0 });
  }
  const segs = textSegments(a, b);
  if (!segs.length) throw new OpError('Select some text first');
  const allFormatted = segs.every((s) => closestMatch(s.node));
  const touched: Text[] = [];
  if (allFormatted) {
    const targets = new Set<Element>();
    segs.forEach((s) => targets.add(closestMatch(s.node)!));
    // split each formatting element at the selection edges and unwrap the middle
    const firstSeg = segs[0];
    const lastSeg = segs[segs.length - 1];
    for (const m of targets) {
      let mid = m;
      if (m.contains(lastSeg.node) && lastSeg.end < lastSeg.node.length) {
        splitAt({ node: lastSeg.node, offset: lastSeg.end }, m);
      }
      if (m.contains(firstSeg.node) && firstSeg.start > 0) {
        mid = splitAt({ node: firstSeg.node, offset: firstSeg.start }, m);
      }
      const kids = Array.from(mid.childNodes);
      while (mid.firstChild) mid.parentNode!.insertBefore(mid.firstChild, mid);
      mid.parentNode!.removeChild(mid);
      kids.forEach((k) => k.nodeType === 3 && touched.push(k as Text));
    }
  } else {
    for (const s of segs) {
      if (closestMatch(s.node)) {
        touched.push(s.node);
        continue;
      }
      const parent = s.node.parentNode as Element;
      if (g?.has(parent.nodeName) && !g.childCandidates(parent.nodeName).includes(name)) continue;
      let node = s.node;
      if (s.end < node.length) node.splitText(s.end);
      if (s.start > 0) node = node.splitText(s.start);
      const el = createEl(doc, name);
      for (const [k, v] of Object.entries(attrs)) setAttr(el, k, v);
      parent.insertBefore(el, node);
      el.appendChild(node);
      touched.push(node);
    }
  }
  if (!touched.length) throw new OpError(`<${name}> is not allowed in the selected text`);
  const first = touched[0];
  const last = touched[touched.length - 1];
  return { anchor: { node: first, offset: 0 }, focus: { node: last, offset: last.length } };
}

export { childNames, elementChildren, elementIndex };
export { closest, closestName } from './xml';

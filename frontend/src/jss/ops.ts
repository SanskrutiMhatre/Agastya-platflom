// Structural edits to a JSS document. Every function works on the model in place and says whether it did anything; none of them touches the DOM.
//
// The stencil fixes a document's chapters (their number, titles and order), so there is no operation that adds, removes, renames or moves one:
// the editor can only fill chapters and manage the sections inside them.

import {
  isSection, newCell, newRow, type Block, type Cell, type Chapter, type JssDoc, type List, type ListItem, type ListType, type Part, type Row, type Section, type Table,
} from './model';

export type Children = Array<Block | Section>;
export interface Located { owner: Chapter | Section; list: Children; index: number }

/** Where a block or section sits: the array that holds it, and its place in it. */
export function locate(doc: JssDoc, node: Block | Section): Located | null {
  const search = (owner: Chapter | Section): Located | null => {
    const i = owner.children.indexOf(node);
    if (i >= 0) return { owner, list: owner.children, index: i };
    for (const c of owner.children) if (isSection(c)) { const r = search(c); if (r) return r; }
    return null;
  };
  for (const ch of doc.chapters) { const r = search(ch); if (r) return r; }
  return null;
}

/** The chapter a node belongs to. */
export function chapterOf(doc: JssDoc, node: Block | Section | Chapter): Chapter | null {
  if (node.k === 'chapter') return node;
  let cur: Block | Section = node;
  for (;;) {
    const at = locate(doc, cur); if (!at) return null;
    if (at.owner.k === 'chapter') return at.owner;
    cur = at.owner;
  }
}

/** Heading level of a section: a chapter is level 1, its sections level 2, and so on. */
export function headingLevel(doc: JssDoc, s: Section): number {
  let level = 2; let cur: Section = s;
  for (;;) { const at = locate(doc, cur); if (!at || at.owner.k === 'chapter') return level; level += 1; cur = at.owner; }
}
const subtreeDepth = (s: Section): number => 1 + Math.max(0, ...s.children.filter(isSection).map(subtreeDepth));

// ── Blocks ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function insertAt<T>(arr: T[], index: number, item: T): void { arr.splice(Math.max(0, Math.min(index, arr.length)), 0, item); }
export function removeAt<T>(arr: T[], index: number): T | undefined { return index >= 0 && index < arr.length ? arr.splice(index, 1)[0] : undefined; }
export function move<T>(arr: T[], index: number, dir: -1 | 1): boolean {
  const j = index + dir; if (index < 0 || index >= arr.length || j < 0 || j >= arr.length) return false;
  [arr[index], arr[j]] = [arr[j], arr[index]]; return true;
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Make a section a child of the section before it (one level deeper), if there is one and the stencil's deepest heading allows it. */
export function indentSection(doc: JssDoc, s: Section, maxDepth: number): boolean {
  const at = locate(doc, s); if (!at) return false;
  const before = at.list[at.index - 1];
  if (!before || !isSection(before)) return false;
  if (headingLevel(doc, s) + subtreeDepth(s) > maxDepth) return false;
  at.list.splice(at.index, 1); before.children.push(s); return true;
}

/** Move a section up one level: it becomes a sibling of its parent, placed after it. Sections after it stay with the old parent. */
export function outdentSection(doc: JssDoc, s: Section): boolean {
  const at = locate(doc, s); if (!at || at.owner.k === 'chapter') return false;
  const parent = at.owner; const up = locate(doc, parent); if (!up) return false;
  at.list.splice(at.index, 1); up.list.splice(up.index + 1, 0, s); return true;
}

export const canIndentSection = (doc: JssDoc, s: Section, maxDepth: number): boolean => {
  const at = locate(doc, s); if (!at) return false;
  const before = at.list[at.index - 1]; return !!before && isSection(before) && headingLevel(doc, s) + subtreeDepth(s) <= maxDepth;
};
export const canOutdentSection = (doc: JssDoc, s: Section): boolean => { const at = locate(doc, s); return !!at && at.owner.k !== 'chapter'; };

// ── Tables ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const hasSpans = (t: Table): boolean => [...t.head, ...t.body].some((r) => r.cells.some((c) => (c.colspan ?? 1) > 1 || (c.rowspan ?? 1) > 1));
export const columnCount = (t: Table): number => Math.max(0, ...[...t.head, ...t.body].map((r) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0)));

/** Add a row after body row `index` (or before the first when index is -1). Refused for a table with merged cells. */
export function addRow(t: Table, group: 'head' | 'body', index: number, where: 'above' | 'below'): boolean {
  if (hasSpans(t)) return false;
  const rows = group === 'head' ? t.head : t.body; const cols = columnCount(t) || 1;
  insertAt(rows, where === 'above' ? index : index + 1, newRow(cols)); return true;
}
export function deleteRow(t: Table, group: 'head' | 'body', index: number): boolean {
  if (hasSpans(t)) return false;
  const rows = group === 'head' ? t.head : t.body;
  if (group === 'body' && rows.length <= 1) return false;             // the schema needs a body
  return removeAt(rows, index) !== undefined;
}
export function addColumn(t: Table, at: number, where: 'before' | 'after'): boolean {
  if (hasSpans(t)) return false;
  const pos = where === 'before' ? at : at + 1;
  for (const r of [...t.head, ...t.body]) insertAt(r.cells, pos, newCell());
  if (t.widths) t.widths = undefined;                                  // the old widths named the old columns
  return true;
}
export function deleteColumn(t: Table, at: number): boolean {
  if (hasSpans(t) || columnCount(t) <= 1) return false;
  for (const r of [...t.head, ...t.body]) removeAt(r.cells, at);
  if (t.widths) t.widths = undefined;
  return true;
}
/** Turn the first body row into the header row, or the header row back into a body row. */
export function toggleHeader(t: Table): boolean {
  if (t.head.length) { t.body.unshift(...t.head); t.head = []; return true; }
  if (t.body.length < 2) return false;                                  // keep a body
  t.head = [t.body.shift() as Row]; return true;
}

const WIDTHS = /^\s*(\d+(\.\d+)?(mm|\*))(\s+\d+(\.\d+)?(mm|\*))*\s*$/;
/** "20mm 1* 2*": one entry per column. Returns an error message, or null when it is acceptable. */
export function checkWidths(t: Table, spec: string): string | null {
  if (!spec.trim()) return null;
  if (!WIDTHS.test(spec)) return 'Give each column as millimetres (20mm) or a share (1*), separated by spaces.';
  const n = spec.trim().split(/\s+/).length; const cols = columnCount(t);
  return n === cols ? null : `This table has ${cols} column${cols === 1 ? '' : 's'}; you gave ${n}.`;
}

// ── Merged cells ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Placed { cell: Cell; index: number; gridCol: number }
const groupRows = (t: Table, group: 'head' | 'body'): Row[] => (group === 'head' ? t.head : t.body);

/** Where each cell sits on the table's grid: its column once cells from rows above that span down into this one are skipped. Same occupancy rule the server checks. */
export function placeCells(rows: Row[]): Placed[][] {
  const occupied: number[] = []; const out: Placed[][] = [];
  for (const row of rows) {
    let col = 0; const placed: Placed[] = [];
    row.cells.forEach((cell, index) => {
      while ((occupied[col] ?? 0) > 0) col += 1;
      placed.push({ cell, index, gridCol: col });
      const cs = cell.colspan ?? 1; const rs = cell.rowspan ?? 1;
      for (let k = 0; k < cs; k += 1) occupied[col + k] = rs;
      col += cs;
    });
    out.push(placed);
    for (let k = 0; k < occupied.length; k += 1) if ((occupied[k] ?? 0) > 0) occupied[k] -= 1;
  }
  return out;
}

const isEmptyParts = (parts: Part[]): boolean => parts.every((p) => p.k === 'inline' && p.inline.length === 0);
/** The content of two merged cells: nothing is lost; text runs are joined with a line break so they do not run together. */
function joinParts(a: Part[], b: Part[]): Part[] {
  if (isEmptyParts(b)) return a; if (isEmptyParts(a)) return b;
  const last = a[a.length - 1]; const first = b[0];
  if (last.k === 'inline' && first.k === 'inline') return [...a.slice(0, -1), { k: 'inline', inline: [...last.inline, { t: 'br' }, ...first.inline] }, ...b.slice(1)];
  return [...a, ...b];
}

/** Why a cell cannot be merged to the right or downwards (null: it can). */
export function mergeCheck(t: Table, group: 'head' | 'body', row: number, index: number, dir: 'right' | 'down'): string | null {
  const rows = groupRows(t, group); const placed = placeCells(rows); const me = placed[row]?.[index];
  if (!me) return 'Click in a cell first.';
  const cs = me.cell.colspan ?? 1; const rs = me.cell.rowspan ?? 1;
  if (dir === 'right') {
    const next = placed[row][index + 1];
    if (!next || next.gridCol !== me.gridCol + cs) return 'There is no cell to the right of this one.';
    if ((next.cell.rowspan ?? 1) !== rs) return 'The cell to the right is not the same height; split it first.';
    return null;
  }
  const r = row + rs;
  if (r >= rows.length) return group === 'head' ? 'There is no cell below in the header.' : 'There is no cell below this one.';
  const below = placed[r].find((p) => p.gridCol === me.gridCol);
  if (!below) return 'The cell below is part of a merged cell; split it first.';
  if ((below.cell.colspan ?? 1) !== cs) return 'The cell below is not the same width; split it first.';
  return null;
}

/** Merge a cell with the one to its right, or the one below it. Nothing is lost: the content of both is kept in the merged cell. */
export function mergeCells(t: Table, group: 'head' | 'body', row: number, index: number, dir: 'right' | 'down'): boolean {
  if (mergeCheck(t, group, row, index, dir) !== null) return false;
  const rows = groupRows(t, group); const placed = placeCells(rows); const me = placed[row][index];
  if (dir === 'right') {
    const next = placed[row][index + 1];
    me.cell.colspan = (me.cell.colspan ?? 1) + (next.cell.colspan ?? 1);
    me.cell.parts = joinParts(me.cell.parts, next.cell.parts); rows[row].cells.splice(index + 1, 1);
  } else {
    const r = row + (me.cell.rowspan ?? 1); const below = placed[r].find((p) => p.gridCol === me.gridCol) as Placed;
    me.cell.rowspan = (me.cell.rowspan ?? 1) + (below.cell.rowspan ?? 1);
    me.cell.parts = joinParts(me.cell.parts, below.cell.parts); rows[r].cells.splice(below.index, 1);
  }
  if (me.cell.colspan === 1) me.cell.colspan = undefined; if (me.cell.rowspan === 1) me.cell.rowspan = undefined;
  return true;
}

/** Undo a merge: the cell goes back to one cell, and the cells it covered come back empty. */
export function splitCell(t: Table, group: 'head' | 'body', row: number, index: number): boolean {
  const rows = groupRows(t, group); const placed = placeCells(rows); const me = placed[row]?.[index]; if (!me) return false;
  const cs = me.cell.colspan ?? 1; const rs = me.cell.rowspan ?? 1; if (cs === 1 && rs === 1) return false;
  for (let k = 1; k < rs; k += 1) {                                   // the rows below get their cells back, at the column the merged cell covered
    const at = placed[row + k].filter((p) => p.gridCol < me.gridCol).length;
    rows[row + k].cells.splice(at, 0, ...Array.from({ length: cs }, () => newCell()));
  }
  me.cell.colspan = undefined; me.cell.rowspan = undefined;
  rows[row].cells.splice(index + 1, 0, ...Array.from({ length: cs - 1 }, () => newCell()));
  return true;
}

export const cellAt = (t: Table, group: 'head' | 'body', row: number, col: number): Cell | undefined => (group === 'head' ? t.head : t.body)[row]?.cells[col];

// ── Lists ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const isList = (p: Part): p is List => p.k === 'list';
const emptyItem = (): ListItem => ({ parts: [{ k: 'inline', inline: [] }] });

export function addItem(list: List, after: number): ListItem { const it = emptyItem(); insertAt(list.items, after + 1, it); return it; }

/** Remove an item; a list is never left with none (the caller deletes the list instead). */
export function removeItem(list: List, index: number): boolean { if (list.items.length <= 1) return false; return removeAt(list.items, index) !== undefined; }

/** Nest an item under the one before it, as that item's own sub-list (created if it has none). */
export function indentItem(list: List, index: number, type?: ListType): boolean {
  const prev = list.items[index - 1]; if (!prev) return false;
  const item = list.items[index];
  let sub = prev.parts.filter(isList).pop();
  if (!sub) { sub = { k: 'list', type, items: [] }; prev.parts.push(sub); }
  sub.items.push(item); list.items.splice(index, 1); return true;
}

/** Pull an item out of its sub-list: it becomes the next item of the parent list. */
export function outdentItem(parent: List, itemIndex: number, sub: List, subIndex: number): boolean {
  const item = sub.items[subIndex]; if (!item) return false;
  sub.items.splice(subIndex, 1);
  insertAt(parent.items, itemIndex + 1, item);
  // the items that followed it stay in the sub-list, which must not be left empty
  if (!sub.items.length) { for (const it of parent.items) { const k = it.parts.indexOf(sub); if (k >= 0) it.parts.splice(k, 1); } }
  return true;
}

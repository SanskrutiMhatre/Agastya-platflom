// =============================================================================
// Pure tree operations for the publication index.
//
// Kept free of React on purpose: these decide where a chapter ends up when you
// drag it, and an off-by-one here silently drops or duplicates a module in the
// published book.
//
// An entry is addressed by its index path from the root: [2] is the third
// top-level entry, [2,0,1] the second child of its first child. Every function
// returns new arrays — nothing is mutated in place, so React sees real changes
// and undo can keep a plain snapshot.
// =============================================================================

export interface PmFolder { type: 'folder'; title: string; children: PmEntry[]; extra?: string[] }
export interface PmDm {
  type: 'dm';
  title?: string;
  dmCode: Record<string, string>;
  identExtension?: Record<string, string>;
  issueInfo?: Record<string, string>;
  language?: Record<string, string>;
  techName?: string;
  infoName?: string;
  issueDate?: Record<string, string>;
  extra?: string[];
}
export interface PmInclude { type: 'include'; title?: string; href: string; hasFallback?: boolean; extra?: string[] }
export type PmEntry = PmFolder | PmDm | PmInclude;

export type Path = number[];
export type DropWhere = 'before' | 'after' | 'inside';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const isFolder = (e: PmEntry | undefined): e is PmFolder => !!e && e.type === 'folder';

export function getAt(entries: PmEntry[], path: Path): PmEntry | undefined {
  let node: any = { children: entries };
  for (const i of path) {
    if (!node?.children) return undefined;
    node = node.children[i];
  }
  return node;
}

/**
 * True when `inner` is `outer` or sits inside it.
 *
 * This is the check that stops a chapter being dropped into its own descendant,
 * which would detach that whole branch — the entries would vanish from the book
 * with no error anywhere.
 */
export function isWithin(outer: Path, inner: Path): boolean {
  if (outer.length > inner.length) return false;
  return outer.every((v, i) => inner[i] === v);
}

export function removeAt(entries: PmEntry[], path: Path): { entries: PmEntry[]; removed?: PmEntry } {
  const next = clone(entries);
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  const parent: any = parentPath.length ? getAt(next, parentPath) : { children: next };
  if (!parent?.children) return { entries: next };
  const [removed] = parent.children.splice(idx, 1);
  return { entries: next, removed };
}

/** Insert `node` as child `index` of `parentPath` ([] = top level). */
export function insertAt(entries: PmEntry[], parentPath: Path, index: number, node: PmEntry): PmEntry[] {
  const next = clone(entries);
  const parent: any = parentPath.length ? getAt(next, parentPath) : { children: next };
  if (!parent) return next;
  if (!parent.children) parent.children = [];
  const i = Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(i, 0, clone(node));
  return next;
}

/**
 * Move the entry at `from` to child `index` of `toParent`.
 *
 * The subtlety is that removing the source first shifts every later sibling
 * down by one, so a destination index in the SAME parent that sits after the
 * source must be decremented. Getting this wrong is the classic drag-and-drop
 * bug where an item lands one slot away from where it was dropped.
 *
 * Returns the original array when the move is impossible (a chapter into
 * itself) or would be a no-op.
 */
export function moveTo(entries: PmEntry[], from: Path, toParent: Path, index: number): PmEntry[] {
  if (isWithin(from, toParent)) return entries;

  const fromParent = from.slice(0, -1);
  const fromIndex = from[from.length - 1];
  const sameParent = fromParent.length === toParent.length && fromParent.every((v, i) => toParent[i] === v);

  if (sameParent && (index === fromIndex || index === fromIndex + 1)) return entries;

  const { entries: without, removed } = removeAt(entries, from);
  if (!removed) return entries;

  return insertAt(without, toParent, sameParent && index > fromIndex ? index - 1 : index, removed);
}

/**
 * Move an entry one place up (delta -1) or down (+1) among its siblings.
 *
 * moveTo's index is a position in the list BEFORE the source is removed, so "down one" is index+2
 * (it lands after the next sibling) and "up one" is index-1. Returns the original array at either end.
 */
export function shiftBy(entries: PmEntry[], path: Path, delta: -1 | 1): PmEntry[] {
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  const siblings: PmEntry[] = parent.length ? ((getAt(entries, parent) as PmFolder | undefined)?.children ?? []) : entries;
  if (delta < 0 ? i <= 0 : i >= siblings.length - 1) return entries;
  return moveTo(entries, path, parent, delta > 0 ? i + 2 : i - 1);
}

export function updateAt(entries: PmEntry[], path: Path, fn: (e: PmEntry) => PmEntry): PmEntry[] {
  const next = clone(entries);
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  const parent: any = parentPath.length ? getAt(next, parentPath) : { children: next };
  if (!parent?.children?.[idx]) return next;
  parent.children[idx] = fn(parent.children[idx]);
  return next;
}

export function countOf(entries: PmEntry[]): { folders: number; dms: number; total: number } {
  let folders = 0, dms = 0;
  const walk = (list: PmEntry[]) => (list ?? []).forEach(e => {
    if (isFolder(e)) { folders++; walk(e.children); } else dms++;
  });
  walk(entries);
  return { folders, dms, total: folders + dms };
}

/**
 * Resolve a drop onto `path` into a concrete { parentPath, index }.
 *
 * 'inside' only means anything for a chapter; dropping onto a module is always
 * a sibling placement, because a module cannot contain anything.
 */
export function dropTarget(entries: PmEntry[], path: Path, where: DropWhere): { parentPath: Path; index: number } {
  const node = getAt(entries, path);
  if (where === 'inside' && isFolder(node)) {
    return { parentPath: path, index: (node.children ?? []).length };
  }
  const idx = path[path.length - 1];
  return { parentPath: path.slice(0, -1), index: where === 'after' ? idx + 1 : idx };
}



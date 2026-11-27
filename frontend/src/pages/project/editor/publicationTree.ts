// The editor's left-panel publication tree, laid out without React so it can be tested: which chapters and module rows are
// drawn for the closed chapters, the filter and the progressive-drawing limit (WP-18, FE-030).
import type { ExploreNode } from '../../../api';

type DmNode = Extract<ExploreNode, { kind: 'dm' }>;
export type TreeItem =
  | { kind: 'chapter'; key: string; depth: number; title: string; dmCount: number; shut: boolean; children: TreeItem[] }
  | { kind: 'dm'; key: string; depth: number; node: DmNode }
  | { kind: 'missing'; key: string; depth: number; ref: string };

export interface TreeOpts { closed: ReadonlySet<string>; q: string; match: (n: DmNode) => boolean }

/** How many module rows the tree would draw (open chapters, matching the filter): the total the progressive drawing counts against. */
export function countTreeRows(nodes: ExploreNode[], o: TreeOpts, path = 'r'): number {
  return nodes.reduce((sum, n, i) => {
    const key = `${path}/${i}`;
    if (n.kind === 'chapter') return sum + (!o.q && o.closed.has(key) ? 0 : countTreeRows(n.children, o, key));
    return sum + (n.kind === 'dm' && o.match(n) ? 1 : 0);
  }, 0);
}

/**
 * Chapters with their modules, in publication order. A chapter is shown when it, or anything in it, matches the filter.
 * `limit` of the `total` module rows are drawn; once the limit is used up the rest of the tree waits for "Show more".
 * Returns the items and how much of the limit is left (for the "Not in the publication" group drawn after the tree).
 */
export function layoutTree(nodes: ExploreNode[], o: TreeOpts & { limit: number; total: number }): { items: TreeItem[]; left: number } {
  // Nothing is cut when the limit covers every row. Counting down from the limit even then hid the whole tree as soon as no
  // module row was left to draw: collapsing the only open chapter made the total (and so the limit) 0, and the chapter itself
  // was skipped, so it could not be opened again (e2e 00-platform, "the saved publication hierarchy").
  let budget = o.limit >= o.total ? Number.MAX_SAFE_INTEGER : o.limit;
  const walk = (list: ExploreNode[], depth: number, path: string): TreeItem[] => list.flatMap((n, i): TreeItem[] => {
    const key = `${path}/${i}`;
    if (n.kind === 'chapter') {
      if (budget <= 0) return [];
      const shut = !o.q && o.closed.has(key);
      const children = shut ? [] : walk(n.children, depth + 1, key);
      if (o.q && children.length === 0) return [];
      return [{ kind: 'chapter', key, depth, title: n.title, dmCount: n.dmCount, shut, children }];
    }
    if (n.kind === 'dm') {
      if (!o.match(n) || budget <= 0) return [];
      budget--;
      return [{ kind: 'dm', key, depth, node: n }];
    }
    if (n.kind === 'missing' && !o.q) return [{ kind: 'missing', key, depth, ref: n.ref }];
    return [];
  });
  const items = walk(nodes, 0, 'r');
  return { items, left: budget };
}

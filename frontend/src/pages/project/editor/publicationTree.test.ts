// The editor's publication tree (e2e 00-platform "the saved publication hierarchy shows in the left panel"): collapsing a chapter
// must keep the tree, and expanding it again must bring its modules back.
import { describe, expect, it } from 'vitest';
import type { ExploreNode } from '../../../api';
import { WINDOW_FROM, PROGRESSIVE_STEP } from '../../../components/windowing';
import { countTreeRows, layoutTree, type TreeItem } from './publicationTree';

const dm = (file: string): ExploreNode => ({ kind: 'dm', title: file, file, dmc: file, infoName: '', issue: '001-00', found: true, style: 'dmRef' });
const chapter = (title: string, children: ExploreNode[]): ExploreNode => ({ kind: 'chapter', title, children, dmCount: children.length });
const all = () => true;
/** What the component does: the progressive limit for this many rows (useProgressive), then the layout. */
function draw(tree: ExploreNode[], closed: Set<string>, q = '', limitWhenLong = PROGRESSIVE_STEP) {
  const o = { closed, q, match: all };
  const total = countTreeRows(tree, o);
  const limit = total <= WINDOW_FROM ? total : Math.min(total, limitWhenLong);
  return layoutTree(tree, { ...o, limit, total });
}
const chapters = (items: TreeItem[]): string[] => items.flatMap((i) => (i.kind === 'chapter' ? [i.title, ...chapters(i.children)] : []));
const rows = (items: TreeItem[]): number => items.reduce((s, i) => s + (i.kind === 'dm' ? 1 : i.kind === 'chapter' ? rows(i.children) : 0), 0);

describe('publication tree layout', () => {
  const tree = [chapter('Description', [dm('a.xml'), dm('b.xml')])];

  it('draws the chapter and its modules', () => {
    const { items } = draw(tree, new Set());
    expect(chapters(items)).toEqual(['Description']);
    expect(rows(items)).toBe(2);
  });

  it('keeps the chapter when it is collapsed (the only chapter, so no module row is left to draw), and expanding brings the modules back', () => {
    const shut = draw(tree, new Set(['r/0']));
    expect(chapters(shut.items)).toEqual(['Description']);
    expect(shut.items[0]).toMatchObject({ kind: 'chapter', shut: true, children: [] });
    expect(rows(shut.items)).toBe(0);
    const open = draw(tree, new Set());
    expect(rows(open.items)).toBe(2);
  });

  it('keeps every collapsed chapter after the open ones', () => {
    const t = [chapter('One', [dm('a.xml')]), chapter('Two', [dm('b.xml')]), chapter('Three', [])];
    expect(chapters(draw(t, new Set(['r/1'])).items)).toEqual(['One', 'Two', 'Three']);
    expect(chapters(draw(t, new Set(['r/0', 'r/1'])).items)).toEqual(['One', 'Two', 'Three']);
  });

  it('in a long publication stops at the limit and leaves the rest for "Show more"', () => {
    const big = [chapter('Big', Array.from({ length: WINDOW_FROM + 50 }, (_, i) => dm(`m${i}.xml`))), chapter('After', [dm('z.xml')])];
    const r = draw(big, new Set());
    expect(rows(r.items)).toBe(PROGRESSIVE_STEP);
    expect(chapters(r.items)).toEqual(['Big']);
    expect(r.left).toBe(0);
  });

  it('a filter hides chapters with nothing that matches', () => {
    const t = [chapter('One', [dm('a.xml')]), chapter('Two', [dm('b.xml')])];
    const o = { closed: new Set<string>(), q: 'a', match: (n: { file: string }) => n.file === 'a.xml' };
    const total = countTreeRows(t, o);
    expect(chapters(layoutTree(t, { ...o, limit: total, total }).items)).toEqual(['One']);
  });
});

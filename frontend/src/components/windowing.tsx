// Long lists render only what can be seen (audit WP-18: FE-030). No dependency.
//
//  * VirtualRows: a flat list inside its own scroll box (the editor's "All" list). Only the rows in view, plus a margin, are in the page;
//    the rest is an empty spacer of the right height, so the scroll bar and the position behave as with every row present.
//  * useProgressive + MoreRows: lists that scroll with the page (tables) or that are nested (the chapter tree). The first rows are drawn,
//    and more follow as the end comes into view (or on the "Show more" button, also for the keyboard).
// Lists up to WINDOW_FROM rows are drawn in full, exactly as before.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export const WINDOW_FROM = 200;
export const PROGRESSIVE_STEP = 100;

/** How many of `total` rows to draw now; grows by `step` when `more()` is called. Resets when `resetKey` changes (a new filter). */
export function useProgressive(total: number, resetKey: unknown = null, opts: { from?: number; step?: number } = {}): { limit: number; more: () => void; all: () => void } {
  const from = opts.from ?? WINDOW_FROM; const step = opts.step ?? PROGRESSIVE_STEP;
  const [limit, setLimit] = useState(step);
  useEffect(() => { setLimit(step); }, [resetKey, step]);
  const more = useCallback(() => setLimit((l) => l + step), [step]);
  const all = useCallback(() => setLimit(Number.MAX_SAFE_INTEGER), []);
  return { limit: total <= from ? total : Math.min(total, limit), more, all };
}

/** The end of a progressively drawn list: draws more when it scrolls into view, or when pressed. */
export function MoreRows({ shown, total, onMore, onAll, as = 'div', colSpan }: { shown: number; total: number; onMore: () => void; onAll?: () => void; as?: 'div' | 'tr'; colSpan?: number }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown >= total || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onMore(); }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, total, onMore]);
  if (shown >= total) return null;
  const body = (
    <span className="v2-hint" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', padding: '6px 8px' }}>
      Showing {shown} of {total}.
      <button type="button" className="v2-link" onClick={onMore} data-testid="list-more">Show more</button>
      {onAll ? <button type="button" className="v2-link" onClick={onAll} data-testid="list-all">Show all</button> : null}
    </span>
  );
  if (as === 'tr') return <tr ref={(e) => { ref.current = e; }} data-testid="list-more-row"><td colSpan={colSpan}>{body}</td></tr>;
  return <div ref={(e) => { ref.current = e; }} data-testid="list-more-row">{body}</div>;
}

/** The range of rows of height `rowH` that a scroll box shows, plus `overscan` rows each side. Pure, for tests. */
export function visibleRange(count: number, rowH: number, scrollTop: number, viewH: number, blockTop: number, overscan: number): { start: number; end: number } {
  if (count <= 0 || rowH <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop - blockTop);
  // scrolled past the end (the list just became shorter): keep the last rows drawn, never an empty window
  const first = Math.min(count - 1, Math.floor(top / rowH));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, Math.max(first + 1, Math.ceil((top + Math.max(viewH, rowH)) / rowH)) + overscan);
  return { start, end };
}

/**
 * The rows of `items` the scroll box `scrollRef` shows. Rows are expected to be of one height (it is measured from the first row drawn).
 * Below WINDOW_FROM items every row is drawn.
 */
export function VirtualRows<T>({ items, row, keyOf, scrollRef, estimate = 40, overscan = 12, from = WINDOW_FROM }: {
  items: T[]; row: (item: T, index: number) => ReactNode; keyOf?: (item: T, index: number) => string; scrollRef: RefObject<HTMLElement>; estimate?: number; overscan?: number; from?: number;
}) {
  const block = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(estimate);
  const [view, setView] = useState({ scrollTop: 0, height: 800, blockTop: 0 });
  const windowed = items.length > from;

  useEffect(() => {
    const box = scrollRef.current;
    if (!windowed || !box) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const b = block.current;
      const blockTop = b ? b.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop : 0;
      setView((v) => (v.scrollTop === box.scrollTop && v.height === box.clientHeight && v.blockTop === blockTop ? v : { scrollTop: box.scrollTop, height: box.clientHeight, blockTop }));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    box.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onScroll) : null;
    ro?.observe(box);
    return () => { box.removeEventListener('scroll', onScroll); ro?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [scrollRef, windowed]);

  const { start, end } = windowed ? visibleRange(items.length, rowH, view.scrollTop, view.height, view.blockTop, overscan) : { start: 0, end: items.length };

  // measure the height of a drawn row once it is in the page
  useLayoutEffect(() => {
    if (!windowed) return;
    const first = block.current?.querySelector<HTMLElement>('[data-vrow]');
    const h = first?.offsetHeight ?? 0;
    if (h > 0 && Math.abs(h - rowH) > 0.5) setRowH(h);
  });

  if (!windowed) return <>{items.map((it, i) => row(it, i))}</>;
  return (
    <div ref={block} data-testid="virtual-rows" data-total={items.length}>
      <div style={{ height: start * rowH }} aria-hidden="true" />
      {items.slice(start, end).map((it, k) => <div key={keyOf ? keyOf(it, start + k) : start + k} data-vrow="">{row(it, start + k)}</div>)}
      <div style={{ height: (items.length - end) * rowH }} aria-hidden="true" />
    </div>
  );
}

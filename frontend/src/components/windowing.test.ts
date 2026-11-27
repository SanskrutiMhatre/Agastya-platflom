// WP-18 (FE-030): which rows a windowed list draws.
import { describe, expect, it } from 'vitest';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VirtualRows, WINDOW_FROM, visibleRange } from './windowing';

describe('visibleRange', () => {
  it('covers the view plus the margin, never past the ends', () => {
    expect(visibleRange(5000, 40, 0, 800, 0, 10)).toEqual({ start: 0, end: 30 });
    expect(visibleRange(5000, 40, 4000, 800, 0, 10)).toEqual({ start: 90, end: 130 });
    // scrolled past the end (the list became shorter): the last rows, never an empty window
    expect(visibleRange(5000, 40, 10_000_000, 800, 0, 10)).toEqual({ start: 4989, end: 5000 });
    expect(visibleRange(0, 40, 0, 800, 0, 10)).toEqual({ start: 0, end: 0 });
  });
  it('accounts for content above the list inside the same scroll box', () => {
    expect(visibleRange(1000, 40, 200, 400, 200, 0)).toEqual({ start: 0, end: 10 });
  });
});

describe('VirtualRows', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `DMC-${i}.XML`);
  const html = (n: number) => renderToStaticMarkup(createElement(VirtualRows<string>, {
    items: rows(n), scrollRef: createRef<HTMLElement>(), keyOf: (s) => s,
    row: (s) => createElement('button', { 'data-testid': 'dm-row', key: s }, s),
  }));
  it(`draws every row up to ${WINDOW_FROM}`, () => {
    expect(html(WINDOW_FROM).match(/data-testid="dm-row"/g)).toHaveLength(WINDOW_FROM);
  });
  it('draws only the first screenful of a 5,000-row list, with spacers for the rest', () => {
    const out = html(5000);
    const drawn = out.match(/data-testid="dm-row"/g)?.length ?? 0;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(60);
    expect(out).toContain('data-total="5000"');
    expect(out).toMatch(/height:\d+px/);
  });
});

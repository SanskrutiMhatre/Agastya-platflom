// =============================================================================
// PDF review anchors (Phase 3, P3-4): ONE definition of "where on a PDF page a comment is", shared by the server (re-anchoring after a
// rebuild, services/pdfReview) and the review viewer (making an anchor from a selection or an area, frontend/src/components/pdfreview).
// No Node or DOM dependency here (see shared/xsdRegex.ts): both sides build the same page index from pdf.js text content.
//
//   Coordinates   PDF user space of the page (points, origin bottom left, y up), as pdf.js text items and viewport.convertToPdfPoint give
//                 them: independent of zoom, window size and theme. A rectangle is [x1, y1, x2, y2] with x1 < x2 and y1 < y2.
//   Text quote    the selected words (exact) with up to CONTEXT characters before (prefix) and after (suffix), as the W3C Web Annotation
//                 TextQuoteSelector. Matching folds case, quotes, dashes, ligatures and ignores all white space, so a line that breaks
//                 differently in the new build still matches.
//   Re-anchoring  exact match first (context and closeness to the old place decide between several), then an approximate match (at most a
//                 quarter of the characters different) in the page neighbourhood; nothing found = the caller marks it "needs re-anchoring".
// =============================================================================

export type Rect = [number, number, number, number];
export interface TextRun { str: string; x: number; y: number; w: number; h: number }
export interface Quote { exact: string; prefix?: string; suffix?: string }

/** A page's text with, for every character, the run it came from (or -1 for a separator), and a folded copy without white space. */
export interface PageIndex {
  runs: TextRun[];
  text: string;
  runOf: number[];
  offInRun: number[];
  /** folded, white space removed */
  compact: string;
  /** compact position -> position in `text` */
  compactAt: number[];
}

export const CONTEXT = 40;
/** How many pages either side of the old page are searched (exact and approximate). */
export const NEIGHBOURHOOD = 3;
const MAX_QUOTE = 2000;

const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '´': "'", '`': "'",
  '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '…': '...',
};
const isSpace = (c: string): boolean => /\s/.test(c) || c === '­' || c === '​' || c === '﻿';

/** Folded characters of `s` without white space, each with the index of the character of `s` it came from. */
export function compactOf(s: string): { compact: string; at: number[] } {
  let out = ''; const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (isSpace(c)) continue;
    const f = (FOLD[c] ?? c).toLowerCase();
    for (const ch of f) { out += ch; at.push(i); }
  }
  return { compact: out, at };
}
export const foldCompact = (s: string): string => compactOf(String(s ?? '')).compact;

/** pdf.js text content items -> runs (horizontal text only; rotated margin text is left out, it is never a review target). */
export function runsFromTextContent(items: ReadonlyArray<{ str?: unknown; transform?: unknown; width?: unknown; height?: unknown }>): TextRun[] {
  const runs: TextRun[] = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str) continue;
    const t = it.transform as number[] | undefined;
    if (!Array.isArray(t) || t.length < 6) continue;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const h = Number(it.height) || Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
    runs.push({ str: it.str, x: t[4], y: t[5], w: Number(it.width) || 0, h: Math.abs(h) });
  }
  return runs;
}

/** The page index of a page's runs, in the order pdf.js gives them (the content stream's order, the reading order of our builds). */
export function buildPageIndex(runs: TextRun[]): PageIndex {
  let text = ''; const runOf: number[] = []; const offInRun: number[] = [];
  runs.forEach((r, ri) => {
    if (text && !/\s$/.test(text)) {
      const p = runs[ri - 1];
      const sameLine = p && Math.abs(p.y - r.y) < Math.max(1, Math.min(p.h, r.h) * 0.5);
      const touching = sameLine && r.x <= p.x + p.w + Math.max(0.5, r.h * 0.12);
      if (!touching) { text += ' '; runOf.push(-1); offInRun.push(-1); }
    }
    for (let k = 0; k < r.str.length; k++) { text += r.str[k]; runOf.push(ri); offInRun.push(k); }
  });
  const c = compactOf(text);
  return { runs, text, runOf, offInRun, compact: c.compact, compactAt: c.at };
}

const area = (r: Rect): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const overlap = (a: Rect, b: Rect): number => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  return rects.reduce<Rect>((u, r) => [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])], [...rects[0]] as Rect);
}

/** The rectangles (one per line) that cover text[start, end). */
export function rectsFor(ix: PageIndex, start: number, end: number): Rect[] {
  const segs = new Map<number, [number, number]>();
  for (let i = Math.max(0, start); i < Math.min(end, ix.text.length); i++) {
    const r = ix.runOf[i]; if (r < 0) continue;
    const k = ix.offInRun[i]; const s = segs.get(r);
    if (s) { s[0] = Math.min(s[0], k); s[1] = Math.max(s[1], k + 1); } else segs.set(r, [k, k + 1]);
  }
  const out: Rect[] = [];
  for (const [ri, [a, b]] of [...segs.entries()].sort((p, q) => p[0] - q[0])) {
    const run = ix.runs[ri]; const n = run.str.length || 1;
    const rect: Rect = [run.x + (run.w * a) / n, run.y - run.h * 0.22, run.x + (run.w * b) / n, run.y + run.h * 0.8];
    const last = out[out.length - 1];
    // the same line: one rectangle
    if (last && Math.abs((last[1] + last[3]) / 2 - (rect[1] + rect[3]) / 2) < run.h * 0.5 && rect[0] <= last[2] + run.h * 1.5) {
      last[0] = Math.min(last[0], rect[0]); last[1] = Math.min(last[1], rect[1]); last[2] = Math.max(last[2], rect[2]); last[3] = Math.max(last[3], rect[3]);
    } else out.push(rect);
  }
  return out.map((r) => r.map((v) => Math.round(v * 100) / 100) as Rect);
}

/** The text inside an area (the characters whose centre lies in it), in reading order, with the range it spans in `text`. */
export function textInRect(ix: PageIndex, rect: Rect): { text: string; start: number; end: number } | null {
  let first = -1; let last = -1; let s = '';
  for (let i = 0; i < ix.text.length; i++) {
    const ri = ix.runOf[i];
    if (ri < 0) { if (first >= 0 && !s.endsWith(' ')) s += ' '; continue; }
    const run = ix.runs[ri]; const n = run.str.length || 1;
    const cx = run.x + (run.w * (ix.offInRun[i] + 0.5)) / n; const cy = run.y + run.h * 0.3;
    if (cx >= rect[0] && cx <= rect[2] && cy >= rect[1] && cy <= rect[3]) { if (first < 0) first = i; last = i; s += ix.text[i]; }
  }
  return first < 0 ? null : { text: s.trim(), start: first, end: last + 1 };
}

export function contextOf(ix: PageIndex, start: number, end: number, n = CONTEXT): { prefix: string; suffix: string } {
  return { prefix: ix.text.slice(Math.max(0, start - n), start).replace(/\s+/g, ' '), suffix: ix.text.slice(end, end + n).replace(/\s+/g, ' ') };
}

/** Characters equal at the end of `a` and the end of `b` (folded, white space ignored), as a share of b's length. */
function tailAgree(a: string, b: string): number {
  if (!b) return 0; let k = 0;
  while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k / b.length;
}
function headAgree(a: string, b: string): number {
  if (!b) return 0; let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k / b.length;
}

export interface Match { start: number; end: number; exact: boolean; /** 0..1, higher is better */ score: number }

const toText = (ix: PageIndex, cs: number, ce: number): { start: number; end: number } =>
  ({ start: ix.compactAt[cs], end: ix.compactAt[Math.max(cs, ce - 1)] + 1 });

/** Approximate substring match (Sellers): the window of `t` closest to `p`, with at most `k` edits. */
function approx(t: string, p: string, k: number): { s: number; e: number; d: number } | null {
  const m = p.length; if (!m) return null;
  let cost = new Array<number>(m + 1); let start = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) { cost[i] = i; start[i] = 0; }
  let best: { s: number; e: number; d: number } | null = null;
  for (let j = 0; j < t.length; j++) {
    const nc = new Array<number>(m + 1); const ns = new Array<number>(m + 1);
    nc[0] = 0; ns[0] = j + 1;
    for (let i = 1; i <= m; i++) {
      const diag = cost[i - 1] + (p[i - 1] === t[j] ? 0 : 1);
      const left = cost[i] + 1;          // an extra character in the text
      const up = nc[i - 1] + 1;          // a character of the quote missing in the text
      if (diag <= left && diag <= up) { nc[i] = diag; ns[i] = start[i - 1]; }
      else if (left <= up) { nc[i] = left; ns[i] = start[i]; }
      else { nc[i] = up; ns[i] = ns[i - 1]; }
    }
    cost = nc; start = ns;
    if (cost[m] <= k && (!best || cost[m] < best.d)) best = { s: start[m], e: j + 1, d: cost[m] };
  }
  return best;
}

/**
 * Find a quote on one page. `near`: rectangles of where it was (same page) - among several exact occurrences the one with the best context,
 * then the closest, wins. `fuzzy`: also accept an approximate match.
 */
export function findQuote(ix: PageIndex, q: Quote, opts: { near?: Rect[]; fuzzy?: boolean } = {}): Match | null {
  const needle = foldCompact(String(q.exact ?? '').slice(0, MAX_QUOTE));
  if (!needle) return null;
  const pre = foldCompact(q.prefix ?? ''); const suf = foldCompact(q.suffix ?? '');
  const hay = ix.compact;
  const nearBox = opts.near?.length ? unionRect(opts.near) : null;
  let best: Match | null = null; let bestKey = -Infinity;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const ctx = (tailAgree(hay.slice(Math.max(0, at - pre.length), at), pre) + headAgree(hay.slice(at + needle.length, at + needle.length + suf.length), suf)) / ((pre ? 1 : 0) + (suf ? 1 : 0) || 1);
    const r = toText(ix, at, at + needle.length);
    let closeness = 0;
    if (nearBox) {
      const box = unionRect(rectsFor(ix, r.start, r.end));
      if (box) closeness = overlap(box, nearBox) > 0 ? 1 : 1 / (1 + Math.hypot(box[0] - nearBox[0], box[3] - nearBox[3]) / 100);
    }
    const key = ctx * 2 + closeness;
    if (key > bestKey) { bestKey = key; best = { ...r, exact: true, score: Math.min(1, 0.7 + ctx * 0.3) }; }
  }
  if (best || !opts.fuzzy || needle.length < 6) return best;
  // approximate: a long quote is matched by its head and its tail, which must come in order and span about the quote's length
  const k = (n: number): number => Math.max(1, Math.floor(n * 0.25));
  if (needle.length <= 160) {
    const a = approx(hay, needle, k(needle.length));
    if (!a) return null;
    return { ...toText(ix, a.s, a.e), exact: false, score: Math.max(0, 0.6 * (1 - a.d / needle.length)) };
  }
  const head = needle.slice(0, 80); const tail = needle.slice(-80);
  const h = approx(hay, head, k(80)); if (!h) return null;
  const rest = hay.slice(h.e); const t = approx(rest, tail, k(80)); if (!t) return null;
  const span = h.e + t.e - h.s;
  if (span < needle.length * 0.6 || span > needle.length * 1.6) return null;
  return { ...toText(ix, h.s, h.e + t.e), exact: false, score: Math.max(0, 0.6 * (1 - (h.d + t.d) / 160)) };
}

export interface StoredAnchor {
  page: number;
  rects: Rect[];
  quote: Quote | null;
  /** an area drawn with the area tool (rects = [the area]); `quoteBox` = where its text was, to move the area with it */
  area?: boolean;
  quoteBox?: Rect | null;
}

export interface Placement { page: number; rects: Rect[]; exact: boolean; score: number; quoteBox?: Rect | null; quote?: Quote }

/** The pages to search for an anchor of `oldPage`, nearest first, within 1..pageCount. */
export function neighbourhood(oldPage: number, pageCount: number, radius = NEIGHBOURHOOD): number[] {
  const out: number[] = [];
  const p = Math.min(Math.max(1, oldPage), Math.max(1, pageCount));
  for (let d = 0; d <= radius; d++) for (const n of d === 0 ? [p] : [p - d, p + d]) if (n >= 1 && n <= pageCount && !out.includes(n)) out.push(n);
  return out;
}

/**
 * Where an anchor lies in a new version of the PDF. `pageAt(n)` gives a page's index (or null when the page cannot be read). Pages of the
 * neighbourhood first (exact, then approximate); then, when `wholeDocument`, an exact search of every other page (a rebuild that inserted many
 * pages). Returns null when the quote is found nowhere: the caller keeps the old anchor and marks it "needs re-anchoring".
 */
export async function reanchor(a: StoredAnchor, pageCount: number, pageAt: (n: number) => Promise<PageIndex | null>, opts: { wholeDocument?: boolean } = {}): Promise<Placement | null> {
  if (!a.quote || !foldCompact(a.quote.exact)) return null;
  const near = neighbourhood(a.page, pageCount);
  const place = (n: number, ix: PageIndex, m: Match): Placement => {
    const textRects = rectsFor(ix, m.start, m.end);
    const ctx = contextOf(ix, m.start, m.end);
    const quote: Quote = { exact: ix.text.slice(m.start, m.end).replace(/\s+/g, ' ').trim(), ...ctx };
    if (a.area && a.rects[0]) {
      const nb = unionRect(textRects); const ob = a.quoteBox ?? null;
      const dx = nb && ob ? nb[0] - ob[0] : 0; const dy = nb && ob ? nb[3] - ob[3] : 0;
      const r = a.rects[0];
      return { page: n, rects: [[r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy].map((v) => Math.round(v * 100) / 100) as Rect], exact: m.exact, score: m.score, quoteBox: nb, quote };
    }
    return { page: n, rects: textRects, exact: m.exact, score: m.score, quote };
  };
  let best: { n: number; ix: PageIndex; m: Match; d: number } | null = null;
  const seen = new Map<number, PageIndex | null>();
  const get = async (n: number): Promise<PageIndex | null> => { if (!seen.has(n)) seen.set(n, await pageAt(n)); return seen.get(n) ?? null; };
  for (const fuzzy of [false, true]) {
    for (const n of near) {
      const ix = await get(n); if (!ix) continue;
      const m = findQuote(ix, a.quote, { near: n === a.page ? a.rects : undefined, fuzzy });
      if (!m) continue;
      const d = Math.abs(n - a.page);
      // a better match wins; at the same quality the nearer page
      if (!best || m.score - d * 0.02 > best.m.score - best.d * 0.02) best = { n, ix, m, d };
    }
    if (best) return place(best.n, best.ix, best.m);
  }
  if (opts.wholeDocument) {
    for (let n = 1; n <= pageCount; n++) {
      if (near.includes(n)) continue;
      const ix = await get(n); if (!ix) continue;
      const m = findQuote(ix, a.quote);
      if (m && (!best || m.score > best.m.score)) best = { n, ix, m, d: Math.abs(n - a.page) };
    }
    if (best) return place(best.n, best.ix, best.m);
  }
  return null;
}

/** Clean an untrusted rectangle list (finite numbers, ordered corners, at most `max` rectangles, inside a generous page box). */
export function cleanRects(raw: unknown, max = 64): Rect[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > max) return null;
  const out: Rect[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length !== 4) return null;
    const v = r.map(Number);
    if (v.some((x) => !Number.isFinite(x) || Math.abs(x) > 20000)) return null;
    out.push([Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])].map((x) => Math.round(x * 100) / 100) as Rect);
  }
  return out;
}

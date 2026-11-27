// WP-21 (PRD-004): comparing the author's version of a document with the one someone else saved meanwhile, against the version both started from.
//
// The three editors write their XML one block per line (jss/xml.ts, jsg/xml.ts, the Studio's serializer), so a line is the unit of change. A change
// only one side made is offered as a choice that does not touch the other side's changes; where both sides changed the same lines differently the
// author picks one of the two. Nothing here decides for the author, and nothing is saved before the editor's own validation has passed (the dialog).

/** a[aStart, aEnd) is replaced by b[bStart, bEnd) (half-open ranges of line indexes). */
export interface Hunk { aStart: number; aEnd: number; bStart: number; bEnd: number }

export const splitLines = (s: string): string[] => s.replace(/\r\n?/g, '\n').split('\n');

const DP_LIMIT = 4_000_000;   // cells of the plain LCS table for a region without unique anchors (16 MB); beyond it the region counts as replaced

/** Matched line pairs of a and b, in increasing order (patience diff: unique common lines as anchors, plain LCS for small regions between). */
function matchLines(a: string[], b: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const rec = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out.push([aLo++, bLo++]);
    const tail: Array<[number, number]> = [];
    while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) tail.push([--aHi, --bHi]);
    if (aLo < aHi && bLo < bHi) {
      const ca = new Map<string, number>(); const cb = new Map<string, number>(); const posA = new Map<string, number>(); const posB = new Map<string, number>();
      for (let i = aLo; i < aHi; i++) { ca.set(a[i], (ca.get(a[i]) ?? 0) + 1); posA.set(a[i], i); }
      for (let j = bLo; j < bHi; j++) { cb.set(b[j], (cb.get(b[j]) ?? 0) + 1); posB.set(b[j], j); }
      const cand: Array<[number, number]> = [];
      for (let i = aLo; i < aHi; i++) if (ca.get(a[i]) === 1 && cb.get(a[i]) === 1) cand.push([i, posB.get(a[i])!]);
      const anchors = lis(cand);
      if (anchors.length) {
        let pa = aLo; let pb = bLo;
        for (const [i, j] of anchors) { rec(pa, i, pb, j); out.push([i, j]); pa = i + 1; pb = j + 1; }
        rec(pa, aHi, pb, bHi);
      } else if ((aHi - aLo) * (bHi - bLo) <= DP_LIMIT) {
        lcs(a, b, aLo, aHi, bLo, bHi, out);
      }
    }
    for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]);
  };
  rec(0, a.length, 0, b.length);
  return out;
}

/** Longest increasing subsequence on the second index (the pairs come sorted by the first). */
function lis(pairs: Array<[number, number]>): Array<[number, number]> {
  const tails: number[] = []; const prev = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let lo = 0; let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  });
  const res: Array<[number, number]> = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) res.push(pairs[k]);
  return res.reverse();
}

function lcs(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number, out: Array<[number, number]>): void {
  const n = aHi - aLo; const m = bHi - bLo; const w = m + 1;
  const t = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[aLo + i] === b[bLo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[aLo + i] === b[bLo + j]) { out.push([aLo + i, bLo + j]); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++; else j++;
  }
}

/** The changed regions between a and b. */
export function diffLines(a: string[], b: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let pa = 0; let pb = 0;
  for (const [i, j] of [...matchLines(a, b), [a.length, b.length] as [number, number]]) {
    if (i > pa || j > pb) hunks.push({ aStart: pa, aEnd: i, bStart: pb, bEnd: j });
    pa = i + 1; pb = j + 1;
  }
  return hunks;
}

export type MergeChunk =
  | { kind: 'same'; lines: string[] }
  /** one side changed these lines (or both made the same change): `lines` replace `base` when the change is kept */
  | { kind: 'change'; side: 'mine' | 'theirs' | 'both'; base: string[]; lines: string[] }
  /** both sides changed the same lines, differently: the author chooses */
  | { kind: 'conflict'; base: string[]; mine: string[]; theirs: string[] };

interface Tagged extends Hunk { side: 'mine' | 'theirs' }

/** Three-way comparison of the author's text and the other text against the text both started from. */
export function merge3(base: string, mine: string, theirs: string): MergeChunk[] {
  const B = splitLines(base); const M = splitLines(mine); const T = splitLines(theirs);
  const all: Tagged[] = [...diffLines(B, M).map((h) => ({ ...h, side: 'mine' as const })), ...diffLines(B, T).map((h) => ({ ...h, side: 'theirs' as const }))]
    .sort((x, y) => x.aStart - y.aStart || x.aEnd - y.aEnd);
  const chunks: MergeChunk[] = [];
  let at = 0;
  const same = (to: number): void => { if (to > at) chunks.push({ kind: 'same', lines: B.slice(at, to) }); at = Math.max(at, to); };
  for (let k = 0; k < all.length;) {
    // a group: hunks whose base ranges overlap or touch (two insertions at one place are one group, so their order is the author's call)
    let gs = all[k].aStart; let ge = all[k].aEnd; const group: Tagged[] = [all[k++]];
    while (k < all.length && all[k].aStart <= ge) { ge = Math.max(ge, all[k].aEnd); gs = Math.min(gs, all[k].aStart); group.push(all[k++]); }
    same(gs);
    const region = (side: 'mine' | 'theirs', lines: string[]): string[] | null => {
      const hs = group.filter((h) => h.side === side); if (!hs.length) return null;
      const first = hs[0]; const last = hs[hs.length - 1];
      return lines.slice(first.bStart - (first.aStart - gs), last.bEnd + (ge - last.aEnd));
    };
    const base = B.slice(gs, ge); const m = region('mine', M); const t = region('theirs', T);
    if (m && t) chunks.push(m.join('\n') === t.join('\n') ? { kind: 'change', side: 'both', base, lines: m } : { kind: 'conflict', base, mine: m, theirs: t });
    else if (m) chunks.push({ kind: 'change', side: 'mine', base, lines: m });
    else if (t) chunks.push({ kind: 'change', side: 'theirs', base, lines: t });
    at = ge;
  }
  same(B.length);
  return chunks;
}

/**
 * Choices: for a change, whether it is kept (true) or the base text stays (false); for a conflict, 'mine' or 'theirs'. Undecided conflicts make the
 * result null: the author has not finished.
 */
export type MergeChoice = boolean | 'mine' | 'theirs' | undefined;

export function buildMerged(chunks: MergeChunk[], choices: MergeChoice[]): string | null {
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.kind === 'same') out.push(...c.lines);
    else if (c.kind === 'change') out.push(...(choices[i] === false ? c.base : c.lines));
    else { const ch = choices[i]; if (ch !== 'mine' && ch !== 'theirs') return null; out.push(...(ch === 'mine' ? c.mine : c.theirs)); }
  }
  return out.join('\n');
}

/** The default choices: every change one side made is kept (the author's and the other person's), conflicts are left to the author. */
export const defaultChoices = (chunks: MergeChunk[]): MergeChoice[] => chunks.map((c) => (c.kind === 'change' ? true : undefined));

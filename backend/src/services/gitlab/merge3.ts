// =============================================================================
// Line-based three-way merge (diff3) for the GitLab pull (Phase 3, P3-5).
//
// merge3(base, mine, theirs): each side's changes against the base are found with a Myers diff (after trimming the common head and tail,
// which is most of a typical data module). Changes on both sides that touch the same base lines (or insert at the same place) are a
// conflict unless they are identical; everything else is combined. A conflict is never written with markers into a document: the caller
// asks the person to choose a side for that file. A diff bigger than `maxEdits` is treated as a conflict (no merge attempted).
// The line ending of `mine` is kept (CRLF or LF).
// =============================================================================

interface Hunk { start: number; end: number; lines: string[] }

/** The edit hunks turning a into b, as ranges of a replaced by lines of b. Null when the edit distance exceeds maxEdits. */
function hunks(a: string[], b: string[], maxEdits: number): Hunk[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf); const B = b.slice(pre, b.length - suf);
  const n = A.length; const m = B.length;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ start: pre, end: pre + n, lines: B }];
  // Myers O(ND), keeping each round's V for the backtrack
  const max = n + m; const off = max;
  let v = new Int32Array(2 * max + 2); const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxEdits); d++) {
    trace.push(v.slice());
    const nv = v;
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && nv[off + k - 1] < nv[off + k + 1])) ? nv[off + k + 1] : nv[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      nv[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    v = nv;
    if (found >= 0) { trace.push(v.slice()); break; }
  }
  if (found < 0) return null;
  // backtrack to the list of matched pairs
  const pairs: Array<[number, number]> = [];
  let x = n; let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1])) ? k + 1 : k - 1;
    const px = pv[off + prevK]; const py = px - prevK;
    while (x > px && y > py) { pairs.push([x - 1, y - 1]); x--; y--; }
    x = px; y = py;
  }
  while (x > 0 && y > 0) { pairs.push([x - 1, y - 1]); x--; y--; }
  pairs.reverse();
  const out: Hunk[] = [];
  let ai = 0; let bi = 0;
  for (const [pa, pb] of [...pairs, [n, m] as [number, number]]) {
    if (pa > ai || pb > bi) out.push({ start: pre + ai, end: pre + pa, lines: B.slice(bi, pb) });
    ai = pa + 1; bi = pb + 1;
  }
  return out;
}

export interface MergeResult { clean: boolean; text: string | null; conflicts: number }

export function splitLines(s: string): { lines: string[]; eol: string } {
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  return { lines: s.split(/\r?\n/), eol };
}

export function merge3(base: string, mine: string, theirs: string, maxEdits = 4000): MergeResult {
  if (mine === theirs) return { clean: true, text: mine, conflicts: 0 };
  if (base === mine) return { clean: true, text: theirs, conflicts: 0 };
  if (base === theirs) return { clean: true, text: mine, conflicts: 0 };
  const b = splitLines(base).lines; const m = splitLines(mine); const t = splitLines(theirs).lines;
  const hm = hunks(b, m.lines, maxEdits); const ht = hunks(b, t, maxEdits);
  if (!hm || !ht) return { clean: false, text: null, conflicts: 1 };
  const all = [...hm.map((h) => ({ ...h, side: 'm' as const })), ...ht.map((h) => ({ ...h, side: 't' as const }))].sort((p, q) => p.start - q.start || p.end - q.end);
  const out: string[] = [];
  let pos = 0; let conflicts = 0;
  let i = 0;
  while (i < all.length) {
    // a group of hunks that overlap or touch (an insertion at the boundary of another change counts)
    const group = [all[i]];
    let end = all[i].end;
    let j = i + 1;
    // touching changes (one ends where the other starts) are grouped too: adjacent edits by two people are a conflict, as in git
    while (j < all.length && all[j].start <= end) { group.push(all[j]); end = Math.max(end, all[j].end); j++; }
    const start = group[0].start;
    out.push(...b.slice(pos, start));
    const sides = new Set(group.map((g) => g.side));
    if (sides.size === 1) {
      let p = start;
      for (const g of group) { out.push(...b.slice(p, g.start)); out.push(...g.lines); p = g.end; }
      out.push(...b.slice(p, end));
    } else {
      // both sides changed this region: identical results are fine, anything else is a conflict
      const render = (side: 'm' | 't'): string => { const r: string[] = []; let p = start; for (const g of group.filter((x) => x.side === side)) { r.push(...b.slice(p, g.start)); r.push(...g.lines); p = g.end; } r.push(...b.slice(p, end)); return r.join('\n'); };
      const rm = render('m'); const rt = render('t');
      if (rm === rt) out.push(...rm.split('\n')); else conflicts++;
    }
    pos = end; i = j;
  }
  out.push(...b.slice(pos));
  if (conflicts) return { clean: false, text: null, conflicts };
  return { clean: true, text: out.join(m.eol), conflicts: 0 };
}

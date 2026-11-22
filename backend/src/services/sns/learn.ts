// =============================================================================
// Where SNS rows can come from besides typing them in.
//
//   snsRowsFromBrexModel(model)   the <snsRules> of a BREX data module (S1000D chapter 4.10): an authoritative SNS
//   learnSnsFromDms(dms, existing) a PROPOSAL from the data modules themselves: the codes tell WHICH nodes exist, the titles
//                                  (techName) hint at what to call them. Titles are guesses, so every proposal carries a
//                                  confidence and the reason for it, and nothing here writes anything: the caller shows the
//                                  proposals and applies the ones the author accepts. A node that already exists is never
//                                  overwritten - it comes back as `exists` (same title) or `conflict` (a different one).
//
// Pure: no I/O, no database.
// =============================================================================

import { isZeroCode, parseDmCode, type SnsLevel } from './codes';
import { SnsTree, compareRows, levelOf, normalizeRow, rowKey, type SnsRow, type SnsRowData } from './model';
import type { DmLike } from './dms';

// ── from a BREX ──────────────────────────────────────────────────────────────

export interface BrexSnsNode { code: string; title: string; children?: BrexSnsNode[] }

/** The SNS rows a BREX's snsRules describe (brex.parseBrexModel(...).sns). Entries that are not valid codes are returned in `rejected`, not dropped silently. */
export function snsRowsFromBrexModel(sns: ReadonlyArray<BrexSnsNode>): { rows: SnsRowData[]; rejected: Array<{ path: string; errors: string[] }> } {
  const rows: SnsRowData[] = [];
  const rejected: Array<{ path: string; errors: string[] }> = [];
  const walk = (nodes: ReadonlyArray<BrexSnsNode>, path: string[]) => {
    for (const n of nodes) {
      const codes = [...path, String(n.code ?? '').trim()];
      const [systemCode = '', subSystemCode = '', subSubSystemCode = '', assyCode = ''] = codes;
      const r = normalizeRow({ systemCode, subSystemCode, subSubSystemCode, assyCode, title: n.title });
      if (r.row) rows.push(r.row); else rejected.push({ path: codes.join('-'), errors: r.errors });
      if (n.children?.length) walk(n.children, codes);
    }
  };
  walk(sns, []);
  return { rows, rejected };
}

// ── from the data modules ────────────────────────────────────────────────────

export interface TitleCandidate { title: string; count: number }

export interface SnsProposal {
  key: string;
  level: SnsLevel;
  row: SnsRowData;
  /** 0..1: how far the title can be trusted. High = the modules at the node agree; low = a guess among different titles. */
  confidence: number;
  /** In words: why this title, and how sure. */
  basis: string;
  candidates: TitleCandidate[];
  /** Files of the data modules that name this node (the first few). */
  sources: string[];
  moduleCount: number;
  /** new: not in the SNS yet. exists: already there with this title. conflict: already there with ANOTHER title (kept; never overwritten). */
  status: 'new' | 'exists' | 'conflict';
  existing?: { id: string; title: string };
}

export interface LearnOptions {
  /** How many source files to list per proposal (default 5). */
  maxSources?: number;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;
const trimTail = (s: string): string => s.replace(/[\s\-–—:;,/&(]+$/, '').trim();

/** The longest run of leading words all names share (case-insensitive), as written in the first name. */
function commonWordPrefix(names: string[]): string {
  const words = names.map((n) => n.split(' '));
  const first = words[0];
  let k = 0;
  while (k < first.length && words.every((w) => w[k] !== undefined && w[k].toLowerCase() === first[k].toLowerCase())) k++;
  return trimTail(first.slice(0, k).join(' '));
}

/**
 * Choose a title among the techNames of the modules at a node.
 *  1. all agree           -> that title            (0.9 with two or more modules, 0.7 with one)
 *  2. one shared "head"   -> text before " - "     (0.7 x share of modules that have it), e.g. "Trailer - Purpose", "Trailer - Features"
 *  3. a shared word run   -> the common prefix     (0.6), at least two words
 *  4. otherwise           -> the most frequent title, a guess (at most 0.5)
 */
export function pickTitle(rawNames: ReadonlyArray<string>): { title: string; confidence: number; basis: string; candidates: TitleCandidate[] } {
  const names = rawNames.map(norm).filter(Boolean);
  if (!names.length) return { title: '', confidence: 0, basis: 'The data modules at this node have no title to learn from.', candidates: [] };
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const candidates = [...counts].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count || a.title.length - b.title.length || (a.title < b.title ? -1 : 1));

  if (candidates.length === 1) {
    const n = names.length;
    return { title: candidates[0].title, confidence: n >= 2 ? 0.9 : 0.7, basis: n >= 2 ? `All ${n} data modules at this node are titled "${candidates[0].title}".` : `Taken from the one data module at this node.`, candidates };
  }
  const heads = new Map<string, number>();
  for (const n of names) { const i = n.indexOf(' - '); if (i > 0) { const h = norm(n.slice(0, i)); heads.set(h, (heads.get(h) ?? 0) + 1); } }
  const topHead = [...heads].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (topHead && topHead[1] >= 2 && topHead[1] / names.length >= 0.6) {
    return { title: topHead[0], confidence: round2(0.7 * (topHead[1] / names.length)), basis: `${topHead[1]} of ${names.length} data module titles begin "${topHead[0]} - ".`, candidates };
  }
  const prefix = commonWordPrefix(names);
  if (prefix.split(' ').length >= 2 && prefix.length >= 4) {
    return { title: prefix, confidence: 0.6, basis: `Every data module title at this node begins "${prefix}".`, candidates };
  }
  const top = candidates[0];
  const share = top.count / names.length;
  return { title: top.title, confidence: round2(Math.min(0.5, 0.2 + 0.3 * share)), basis: `The ${names.length} data modules at this node have ${candidates.length} different titles; "${top.title}" is the most common (${top.count}). Check it.`, candidates };
}

interface NodeAcc { row: SnsRowData; level: SnsLevel; own: DmLike[]; subtree: DmLike[] }

/**
 * Propose SNS rows from data modules. The nodes are the (system, sub-system, sub-sub-system, assembly) paths the codes
 * spell out; a level is a node when its code is not zero, or when something deeper hangs from it. Rows are not tied to a
 * system difference code (the same SNS serves every variant); give `existing` to see what is already defined.
 */
export function learnSnsFromDms(dms: ReadonlyArray<Partial<DmLike> & Record<string, unknown>>, existing?: SnsTree | ReadonlyArray<SnsRow> | null, options: LearnOptions = {}): {
  proposals: SnsProposal[];
  summary: { nodes: number; new: number; exists: number; conflict: number; modules: number; skipped: number; lowConfidence: number };
} {
  const tree = SnsTree.from(existing ?? []);
  const maxSources = options.maxSources ?? 5;
  const nodes = new Map<string, NodeAcc>();
  let skipped = 0;
  let modules = 0;

  for (const d of dms) {
    const p = parseDmCode(d);
    if (!p || !p.systemCode) { skipped++; continue; }
    modules++;
    const dm = d as unknown as DmLike;
    // The deepest level this module's code names.
    const deepest = !isZeroCode(p.assyCode) ? 3 : !isZeroCode(p.subSubSystemCode) ? 2 : !isZeroCode(p.subSystemCode) ? 1 : 0;
    for (let lv = 0; lv <= deepest; lv++) {
      const row: SnsRowData = {
        systemDiffCode: '', systemCode: p.systemCode, subSystemCode: lv >= 1 ? p.subSystemCode : '', subSubSystemCode: lv >= 2 ? p.subSubSystemCode : '',
        assyCode: lv >= 3 ? p.assyCode : '', title: '',
      };
      const key = rowKey(row);
      let n = nodes.get(key);
      if (!n) { n = { row, level: levelOf(row), own: [], subtree: [] }; nodes.set(key, n); }
      n.subtree.push(dm);
      if (lv === deepest) n.own.push(dm);
    }
  }

  const proposals: SnsProposal[] = [];
  for (const n of [...nodes.values()].sort((a, b) => compareRows(a.row, b.row))) {
    const fromOwn = n.own.some((d) => d.techName);
    const pool = fromOwn ? n.own : n.subtree;
    const pick = pickTitle(pool.map((d) => String(d.techName ?? '')));
    const confidence = round2(fromOwn ? pick.confidence : pick.confidence * 0.6);
    const basis = fromOwn ? pick.basis : `No data module sits at this node itself, so the title is guessed from the ${n.subtree.length} below it. ${pick.basis}`;
    const key = rowKey(n.row);
    const have = tree.find('', n.row.systemCode, n.row.subSystemCode, n.row.subSubSystemCode, n.row.assyCode);
    const status: SnsProposal['status'] = !have ? 'new' : have.title.toLowerCase() === pick.title.toLowerCase() ? 'exists' : 'conflict';
    proposals.push({
      key, level: n.level, row: { ...n.row, title: pick.title }, confidence, basis, candidates: pick.candidates,
      sources: [...new Set(pool.map((d) => String(d.file ?? d.dmc ?? '')).filter(Boolean))].sort().slice(0, maxSources),
      moduleCount: n.subtree.length, status, ...(have ? { existing: { id: have.id, title: have.title } } : {}),
    });
  }
  const count = (s: SnsProposal['status']) => proposals.filter((p) => p.status === s).length;
  return {
    proposals,
    summary: { nodes: proposals.length, new: count('new'), exists: count('exists'), conflict: count('conflict'), modules, skipped, lowConfidence: proposals.filter((p) => p.confidence < 0.5).length },
  };
}

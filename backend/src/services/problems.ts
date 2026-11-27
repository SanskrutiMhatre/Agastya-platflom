// =============================================================================
// WP-22 (UX-008, FE-015): one problems model, and the "reviewed" marks on the server.
//
// A finding used to appear in five places with five shapes (the Studio Problems pane, the Validation page, the publish refusal, the JSS
// findings strip, the JSG check) and the Validation page kept its "reviewed" marks in one browser's localStorage, so a colleague, or the same
// author on another computer, saw everything unreviewed. Here:
//
//   * Problem      the one shape: source, severity, file, line, rule, message, and a state (open, reviewed, waived) with who and when.
//   * the marks    one small file per project (problem-reviews.json), written atomically, holding who marked which finding reviewed and when.
//                  A mark is shared by everyone on the project; it is audit evidence for a release, so it is not browser state.
//   * problemsOf   the last validation run of the project (services/validation lastRun) joined with the marks and the recorded publish
//                  waivers. It never runs a check itself: the numbers are those of the run the Validation page and the editors show.
//
// The key of a finding is the one the Validation page always used (source|file|line|title|location), so marks made before this change can be
// moved from the browser to the server once (the page sends them; a key that matches no finding of the last run is still stored, because a
// later run may produce it again).
// =============================================================================

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { writeFileAtomic } from '../storage/atomicWrite';
import { bad } from './http';
import { lastRun, type Issue } from './validation';
import { listWaivers } from './publishWaivers';

export type ProblemState = 'open' | 'reviewed' | 'waived';
export interface ReviewMark { key: string; by: string; byName: string | null; at: string }
export interface Problem {
  key: string; id: string; source: Issue['source']; severity: Issue['sev']; file: string; line: number; rule: string; message: string; detail: string;
  location: string; state: ProblemState; reviewedBy: string | null; reviewedAt: string | null; waivedBy: string | null;
}

const FILE = 'problem-reviews.json';
const MAX_KEY = 1200;
const MAX_MARKS = 20000;
const fileOf = (projectId: string): string => path.join(projectDirFor(projectId), FILE);

/** The key the Validation page has always used for a finding. */
export const problemKey = (i: Pick<Issue, 'source' | 'rel' | 'line' | 'title' | 'loc'>): string => `${i.source}|${i.rel}|${i.line}|${i.title}|${i.loc}`;

export function listMarks(projectId: string): ReviewMark[] {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(projectId), 'utf8'));
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.key === 'string' && typeof m.by === 'string' && typeof m.at === 'string') : [];
  } catch { return []; }
}

// WP-11: the one atomic writer (flush, rename with retries on Windows; leftovers swept at start).
function save(projectId: string, list: ReviewMark[]): void {
  writeFileAtomic(fileOf(projectId), JSON.stringify(list, null, 1) + '\n');
}

const cleanKey = (k: unknown): string => {
  const key = String(k ?? '');
  if (!key || key.length > MAX_KEY || /[\u0000-\u001f]/.test(key)) throw bad('That is not the key of a finding.', 'BAD_PROBLEM_KEY');
  return key;
};

/**
 * Marks (reviewed = true) or unmarks findings, for the whole team. Returns the marks after the change. Marking a finding that is already
 * marked keeps the first mark (who reviewed it first stays on record).
 */
export function setReviewed(projectId: string, keys: unknown, reviewed: boolean, who: { username: string; fullName?: string | null }): ReviewMark[] {
  const list = (Array.isArray(keys) ? keys : [keys]).map(cleanKey);
  if (!list.length) throw bad('Say which findings.', 'BAD_PROBLEM_KEY');
  if (list.length > 2000) throw bad('At most 2000 findings at a time.', 'TOO_MANY_KEYS');
  const marks = listMarks(projectId);
  const have = new Map(marks.map((m) => [m.key, m]));
  const at = new Date().toISOString();
  for (const k of list) {
    if (reviewed) { if (!have.has(k)) have.set(k, { key: k, by: who.username, byName: who.fullName ?? null, at }); }
    else have.delete(k);
  }
  if (have.size > MAX_MARKS) throw bad(`A project keeps at most ${MAX_MARKS} reviewed marks.`, 'TOO_MANY_MARKS');
  const out = [...have.values()];
  save(projectId, out);
  return out;
}

/** The findings of the last validation run, in the one model, with their review state. Null when the project was never validated. */
export function problemsOf(projectId: string): { ranAt: string | null; problems: Problem[]; summary: Record<ProblemState, number> & { error: number; warn: number; info: number } } {
  const run = lastRun(projectId);
  const marks = new Map(listMarks(projectId).map((m) => [m.key, m]));
  const waivers = listWaivers(projectId);
  const waiverOf = (i: Issue) => (i.source === 'brex'
    ? waivers.find((w) => { const s = w.subject.toLowerCase(); const f = (i.rel || '').toLowerCase(); return !!f && (f.endsWith(s) || f.includes(s)); })
    : undefined);
  const problems: Problem[] = (run?.issues ?? []).map((i) => {
    const key = problemKey(i); const m = marks.get(key); const w = waiverOf(i);
    return {
      key, id: i.id, source: i.source, severity: i.sev, file: i.rel, line: i.line, rule: i.source, message: i.title, detail: i.detail, location: i.loc,
      state: w ? 'waived' : m ? 'reviewed' : 'open', reviewedBy: m?.byName ?? m?.by ?? null, reviewedAt: m?.at ?? null, waivedBy: w?.by ?? null,
    };
  });
  const summary = { open: 0, reviewed: 0, waived: 0, error: 0, warn: 0, info: 0 };
  for (const p of problems) { summary[p.state]++; summary[p.severity]++; }
  return { ranAt: run?.ranAt ?? null, problems, summary };
}

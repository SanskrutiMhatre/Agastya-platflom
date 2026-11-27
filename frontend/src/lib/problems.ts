// WP-22 (UX-008, 06 section 7.4): one problems model for every surface.
//
// A finding used to have one shape per place (the Validation page's ValidationIssue, the JSS editor's Finding, the publish gate's finding) and one
// wording per place ("warn", "warning", "Warnings", "Notes"). Every surface now maps its own report into `Problem` with the adapters below, and
// says the severity with `severityLabel`, so the words and the counts are the same wherever a finding is shown. The server keeps the same shape
// (backend services/problems.ts) with the team's "reviewed" marks, so a mark is seen by everyone.

import type { ProblemRow, ProblemState, ValidationIssue } from '../api';

export type Severity = 'error' | 'warn' | 'info';
export interface Problem {
  key: string; source: string; severity: Severity; file: string; line: number; rule: string; message: string; detail?: string; location?: string;
  state: ProblemState; reviewedBy?: string | null; reviewedAt?: string | null;
}

/** One wording for severities, singular and plural, everywhere a finding is shown. */
export const SEVERITY_LABEL: Record<Severity, { one: string; many: string }> = {
  error: { one: 'Error', many: 'Errors' },
  warn: { one: 'Warning', many: 'Warnings' },
  info: { one: 'Note', many: 'Notes' },
};
export const severityLabel = (s: Severity, n = 1): string => (n === 1 ? SEVERITY_LABEL[s].one : SEVERITY_LABEL[s].many);
/** "3 errors, 1 warning" (nothing when both are zero); notes are only named when asked for. */
export function countLabel(c: { error?: number; warn?: number; info?: number }, withNotes = false): string {
  const part = (s: Severity, n = 0) => (n ? `${n} ${severityLabel(s, n).toLowerCase()}` : '');
  return [part('error', c.error), part('warn', c.warn), withNotes ? part('info', c.info) : ''].filter(Boolean).join(', ');
}

/** The key of a Validation-page finding (the one the page always used, and the server uses for the marks). */
export const issueKey = (i: Pick<ValidationIssue, 'source' | 'rel' | 'line' | 'title' | 'loc'>): string => `${i.source}|${i.rel}|${i.line}|${i.title}|${i.loc}`;

export function fromValidationIssue(i: ValidationIssue, reviewed?: { by?: string | null; at?: string | null } | null): Problem {
  return { key: issueKey(i), source: i.source, severity: i.sev, file: i.rel, line: i.line, rule: i.source, message: i.title, detail: i.detail, location: i.loc,
    state: reviewed ? 'reviewed' : 'open', reviewedBy: reviewed?.by ?? null, reviewedAt: reviewed?.at ?? null };
}

/** The JSS (and JSG) editor's findings: the document is one file. */
export function fromDocFinding(f: { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }, file = 'document'): Problem {
  return { key: `doc|${file}|${f.line}|${f.rule}|${f.location}`, source: 'document', severity: f.severity === 'error' ? 'error' : 'warn', file, line: f.line, rule: f.rule,
    message: f.message, location: f.location, state: 'open' };
}

export function fromServer(p: ProblemRow): Problem {
  return { key: p.key, source: p.source, severity: p.severity, file: p.file, line: p.line, rule: p.rule, message: p.message, detail: p.detail, location: p.location,
    state: p.state, reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt };
}

/** Counts of one list, by severity and by state. */
export function countProblems(list: Problem[]): Record<Severity | ProblemState, number> {
  const out = { error: 0, warn: 0, info: 0, open: 0, reviewed: 0, waived: 0 };
  for (const p of list) { out[p.severity]++; out[p.state]++; }
  return out;
}

/** Marks kept in this browser before WP-22 (localStorage `agastya.reviewed.<project>`): read once, so they can be moved to the server. */
export function legacyReviewedKeys(projectId: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(`agastya.reviewed.${projectId}`) ?? '[]'); return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []; } catch { return []; }
}
export function forgetLegacyReviewed(projectId: string): void { try { localStorage.removeItem(`agastya.reviewed.${projectId}`); } catch { /* private mode */ } }

// Publish-gate refusals and waivers, as logic only (the screens are components/PublishRefusal.tsx and the Publication page).
//
// A server publish (Generate, the server Quick preview, a release request) is refused with HTTP 422 `VALIDATION_FAILED` and a list of findings. Exactly one
// kind of finding can be waived: a BREX the project does not have (`kind: 'brex-source'`, title "BREX <code> is not available"). A waiver is a recorded decision
// to build DRAFTS without that BREX. It never covers a release request or approval. Schema errors, breaches of a business rule and an invalid BREX are never waivable.

import { ApiError } from '../api/client';

export interface GateFinding { file: string; kind: 'malformed' | 'schema' | 'unchecked' | 'brex' | 'brex-source' | string; title: string; detail: string; line: number }
export interface Refusal { message: string; findings: GateFinding[]; total: number; modules: string[] }

export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** The refusal in an error, or null when the error is anything else (a network failure, a 500, a different 4xx). */
export function refusalOf(e: unknown): Refusal | null {
  if (!(e instanceof ApiError) || e.status !== 422 || e.code !== 'VALIDATION_FAILED') return null;
  const body = (e.body ?? {}) as { findings?: unknown; totalFindings?: unknown; modules?: unknown };
  const findings = Array.isArray(body.findings) ? (body.findings as GateFinding[]).filter((f) => f && typeof f.title === 'string') : [];
  return {
    message: e.message, findings,
    total: typeof body.totalFindings === 'number' ? body.totalFindings : findings.length,
    modules: Array.isArray(body.modules) ? body.modules.map(String) : [],
  };
}

const MISSING = /^BREX (\S+) is not available$/;

/** The BREX code a finding says is not available, or null when the finding is anything else (and so cannot be waived). */
export function missingBrexSubject(f: GateFinding): string | null {
  if (f.kind !== 'brex-source') return null;
  return MISSING.exec(f.title.trim())?.[1] ?? null;
}

export interface WaiverOffer {
  /** Every BREX code the refusal says is missing, once each. */
  subjects: string[];
  /** The findings a waiver does not cover: they still stop the build after the waiver is recorded. */
  blockers: GateFinding[];
  /** Offer "Build drafts without this BREX…". */
  offer: boolean;
  /** Some findings were not sent (the server sends at most 50), so there may be blockers that are not listed. */
  truncated: boolean;
}

export function waiverOffer(r: Refusal): WaiverOffer {
  const subjects: string[] = [];
  const blockers: GateFinding[] = [];
  for (const f of r.findings) {
    const s = missingBrexSubject(f);
    if (s) { if (!subjects.some((x) => x.toLowerCase() === s.toLowerCase())) subjects.push(s); } else blockers.push(f);
  }
  return { subjects, blockers, offer: subjects.length > 0, truncated: r.total > r.findings.length };
}

/** The reason is what a reviewer reads later: at least a sentence, and not more than the server keeps. */
export function reasonProblem(reason: string): string | null {
  const t = reason.trim();
  if (t.length < REASON_MIN) return `Say why, in at least ${REASON_MIN} characters (${t.length} so far). It is recorded with your name and the date.`;
  if (t.length > REASON_MAX) return `The reason is limited to ${REASON_MAX} characters (${t.length}).`;
  return null;
}

/** Short wording of a waiver kind for lists. */
export const WAIVER_KIND_LABEL: Record<string, string> = { 'brex-missing': 'BREX not available' };
export const waiverKindLabel = (k: string): string => WAIVER_KIND_LABEL[k] ?? k;

/** What the findings of a refusal are about, for one line above the list: "2 BREX not available, 1 schema error". */
export function summariseFindings(findings: GateFinding[]): string {
  const n = (pred: (f: GateFinding) => boolean) => findings.filter(pred).length;
  const parts: string[] = [];
  const missing = n((f) => missingBrexSubject(f) !== null);
  const source = n((f) => f.kind === 'brex-source') - missing;
  const rules = n((f) => f.kind === 'brex');
  const schema = n((f) => f.kind === 'schema' || f.kind === 'malformed' || f.kind === 'unchecked');
  if (missing) parts.push(`${missing} BREX not available`);
  if (source) parts.push(`${source} BREX that cannot be used`);
  if (rules) parts.push(`${rules} business rule breach${rules === 1 ? '' : 'es'}`);
  if (schema) parts.push(`${schema} schema problem${schema === 1 ? '' : 's'}`);
  return parts.join(', ');
}

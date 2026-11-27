// WP-22 (UX-008): one problems model; the same words and counts on every surface, and the old browser marks read once.
import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '../api';
import { countLabel, countProblems, forgetLegacyReviewed, fromDocFinding, fromValidationIssue, issueKey, legacyReviewedKeys, severityLabel } from './problems';
import { plainIp } from '../pages/Settings';

const issue = { source: 'schema', rel: 'DMC-A.xml', line: 4, title: 'Bad element', loc: '/dmodule', sev: 'warn', detail: 'd' } as unknown as ValidationIssue;

describe('the problems model', () => {
  it('names severities the same way everywhere, singular and plural', () => {
    expect([severityLabel('error'), severityLabel('warn', 2), severityLabel('info', 3)]).toEqual(['Error', 'Warnings', 'Notes']);
    expect(countLabel({ error: 3, warn: 1, info: 2 })).toBe('3 errors, 1 warning');
    expect(countLabel({ error: 0, warn: 0, info: 2 }, true)).toBe('2 notes');
    expect(countLabel({})).toBe('');
  });
  it('keeps the key the Validation page always used, which the server uses for the marks', () => {
    expect(issueKey(issue)).toBe('schema|DMC-A.xml|4|Bad element|/dmodule');
    const p = fromValidationIssue(issue, { by: 'Ann', at: '2026-11-27T10:00:00Z' });
    expect(p).toMatchObject({ severity: 'warn', file: 'DMC-A.xml', state: 'reviewed', reviewedBy: 'Ann' });
    expect(fromValidationIssue(issue).state).toBe('open');
  });
  it('maps a document finding and counts by severity and by state', () => {
    const d = fromDocFinding({ severity: 'warning', rule: 'R1', message: 'm', line: 2, location: 'c1' });
    expect(d.severity).toBe('warn');
    const c = countProblems([d, fromValidationIssue(issue, {}), { ...d, severity: 'error' }]);
    expect(c).toMatchObject({ error: 1, warn: 2, open: 2, reviewed: 1, waived: 0 });
  });
  it('reads the marks kept in the browser before WP-22 once, and forgets them', () => {
    localStorage.setItem('agastya.reviewed.p1', JSON.stringify(['a', 2, 'b']));
    expect(legacyReviewedKeys('p1')).toEqual(['a', 'b']);
    forgetLegacyReviewed('p1');
    expect(legacyReviewedKeys('p1')).toEqual([]);
    localStorage.setItem('agastya.reviewed.p2', '{not json');
    expect(legacyReviewedKeys('p2')).toEqual([]);
  });
});

describe('the audit log (UX-025)', () => {
  it('shows an IPv4 address without its IPv6 wrapper and leaves the others alone', () => {
    expect(plainIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(plainIp('::1')).toBe('::1');
    expect(plainIp(null)).toBe('');
  });
});

// WP-29 (ENT-003): the audit viewer's filters reach the server, the export links carry the same filters (every matching row, not the
// 300 shown), and "Verify chain" shows the server's report, with the problems when the chain is broken.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditApi, auditQueryString } from '../api';
import { resetQueries } from '../api/query';
import { Audit } from './Settings';
import { cleanup, click, render, settle, type } from '../testing/render';

let calls: Array<{ url: string; method: string }> = [];
let verifyAnswer: unknown = null;
beforeEach(() => {
  resetQueries(); calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const body = url.startsWith('/api/admin/audit/verify') ? { report: verifyAnswer }
      : { entries: [{ id: 1, at: '2026-11-27T10:00:00.000Z', actor: 'admin', action: 'release.approved', targetType: 'release', projectId: 'p1', ip: '127.0.0.1', meta: {}, seq: 1 }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('audit query string', () => {
  it('only the filters that are set, encoded, in a fixed order; a date alone as "to" means the end of that day', () => {
    expect(auditQueryString({})).toBe('');
    expect(auditQueryString({ to: '2026-11-27', actor: ' alice ', action: 'release.', project: '' })).toBe('action=release.&actor=alice&to=2026-11-27T23%3A59%3A59.999Z');
    expect(auditQueryString({ from: '2026-11-01T08:00:00Z', project: 'a b&c' })).toBe('project=a%20b%26c&from=2026-11-01T08%3A00%3A00Z');
    expect(auditApi.exportUrl('jsonl', {})).toBe('/api/admin/audit/export?format=jsonl');
    expect(auditApi.exportUrl('csv', { actor: 'bob' })).toBe('/api/admin/audit/export?format=csv&actor=bob');
  });
});

describe('Audit viewer', () => {
  it('sends the filters to the server and puts them on both export links', async () => {
    const r = render(<Audit />);
    await settle();
    expect(calls[0].url).toBe('/api/admin/audit?limit=300');
    type(r.$<HTMLInputElement>('[data-testid="audit-actor"]'), 'alice');
    type(r.$<HTMLInputElement>('[data-testid="audit-project"]'), 'p1');
    type(r.$<HTMLInputElement>('[data-testid="audit-from"]'), '2026-11-01');
    await act(async () => { await new Promise((res) => setTimeout(res, 350)); }); await settle();
    expect(calls.at(-1)!.url).toBe('/api/admin/audit?limit=300&actor=alice&project=p1&from=2026-11-01');
    expect(r.$<HTMLAnchorElement>('[data-testid="audit-export-csv"]').getAttribute('href')).toBe('/api/admin/audit/export?format=csv&actor=alice&project=p1&from=2026-11-01');
    expect(r.$<HTMLAnchorElement>('[data-testid="audit-export-jsonl"]').getAttribute('href')).toBe('/api/admin/audit/export?format=jsonl&actor=alice&project=p1&from=2026-11-01');
  });

  it('"Verify chain" shows an intact report, and the problems of a broken one', async () => {
    const base = { at: '2026-11-27T10:00:00.000Z', keyId: 'k', chained: 3, beforeChain: 0, head: { seq: 3, hash: 'h' }, anchor: null, checkpoints: { checked: 1, newest: null } };
    verifyAnswer = { ...base, ok: true, summary: 'audit chain intact: 3 row(s) verified', problemCount: 0, problems: [] };
    const r = render(<Audit />);
    await settle();
    click(r.$('[data-testid="audit-verify"]')); await settle(); await settle();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/audit/verify')).toBe(true);
    expect(r.$('[data-testid="audit-verify-result"]').textContent).toBe('Intact: audit chain intact: 3 row(s) verified.');
    verifyAnswer = { ...base, ok: false, summary: 'audit chain BROKEN: 1 problem(s)', problemCount: 1, problems: [{ kind: 'content', id: 2, seq: 2, message: 'row id 2 (sequence 2) was changed after it was written' }] };
    click(r.$('[data-testid="audit-verify"]')); await settle(); await settle();
    expect(r.$('[data-testid="audit-verify-result"]').textContent).toMatch(/^Problems found: audit chain BROKEN/);
    expect(r.$('[role="alert"]').textContent).toContain('row id 2 (sequence 2) was changed after it was written');
  });
});

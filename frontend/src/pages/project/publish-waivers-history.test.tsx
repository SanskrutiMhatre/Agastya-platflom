// WP-29 (ENT-017): the waiver list shows the expiry (and "expired"), the history with every reason, and a removal asks for its reason,
// which is sent to the server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetQueries } from '../../api/query';
import { expiryFromDays } from '../../api/waivers';
import { PublishWaivers } from './PublishWaivers';
import { cleanup, click, render, settle, type } from '../../testing/render';

let calls: Array<{ url: string; method: string }> = [];
const S = 'DMC-EXAMPLE-A-00-00-00-00A-022A-D';
beforeEach(() => {
  resetQueries(); calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const body = init.method === 'DELETE' ? { ok: true } : {
      kinds: ['brex-missing'], note: '',
      waivers: [
        { id: 'w1', kind: 'brex-missing', subject: S, reason: 'Drafts only until the BREX arrives.', by: 'eve', at: '2026-11-01T10:00:00.000Z', expiresAt: '2026-11-20T00:00:00.000Z', expired: true },
        { id: 'w2', kind: 'brex-missing', subject: `${S}2`, reason: 'Second one, no expiry.', by: 'eve', at: '2026-11-02T10:00:00.000Z' },
      ],
      history: [
        { id: 3, waiverId: 'w0', event: 'removed', kind: 'brex-missing', subject: S, reason: 'The BREX arrived after all.', expiresAt: null, by: 'eve', at: '2026-10-30T10:00:00.000Z' },
        { id: 2, waiverId: 'w0', event: 'added', kind: 'brex-missing', subject: S, reason: 'The customer BREX arrives next month.', expiresAt: null, by: 'eve', at: '2026-10-29T10:00:00.000Z' },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('publish waivers: expiry and history', () => {
  it('shows the expiry, marks an expired waiver, and lists the history with its reasons', async () => {
    const r = render(<PublishWaivers projectId="p1" can={{ 'pm.write': true }} refreshKey={0} />);
    await settle(); await settle();
    const cells = r.$$('[data-testid="waiver-expiry-cell"]').map((c) => c.textContent ?? '');
    expect(cells[0]).toMatch(/expired/); expect(cells[1]).toBe('never');
    expect(r.$('.v2-card-head').textContent).toContain('1');      // only the waiver in force is counted
    const hist = r.$$('[data-testid="waiver-history-row"]').map((x) => x.textContent ?? '');
    expect(hist).toHaveLength(2);
    expect(hist[0]).toContain('Removed'); expect(hist[0]).toContain('The BREX arrived after all.');
    expect(hist[1]).toContain('Recorded'); expect(hist[1]).toContain('The customer BREX arrives next month.');
  });

  it('a removal asks for the reason and sends it', async () => {
    const r = render(<PublishWaivers projectId="p1" can={{ 'pm.write': true }} refreshKey={0} />);
    await settle(); await settle();
    click(r.$$('[data-testid="waiver-remove"]')[1]);
    type(r.$<HTMLInputElement>('[role="dialog"] input'), 'No longer needed.');
    click(r.$$<HTMLButtonElement>('[role="dialog"] button').find((b) => b.textContent === 'Remove')!); await settle(); await settle();
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(`/api/projects/p1/publish-waivers/w2?reason=${encodeURIComponent('No longer needed.')}`);
  });

  it('the expiry choices give a time that many days ahead, or none', () => {
    const now = Date.parse('2026-11-27T00:00:00.000Z');
    expect(expiryFromDays(0, now)).toBeUndefined();
    expect(expiryFromDays(30, now)).toBe('2026-12-27T00:00:00.000Z');
  });
});

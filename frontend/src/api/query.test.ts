// WP-18 (FE-020, FE-029): the query layer shares identical GETs, reuses an answer briefly, forgets everything on a write, and cancels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, post } from './client';
import { invalidate, requestsSent, resetQueries, shared } from './query';

type Call = { url: string; method: string; signal?: AbortSignal | null };
let calls: Call[] = [];
let answer: (url: string) => unknown = () => ({ ok: true });
let delay = 5;

beforeEach(() => {
  resetQueries(); calls = []; answer = (url) => ({ url, n: calls.length }); delay = 5;
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', signal: init.signal });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response(JSON.stringify(answer(url)), { status: 200, headers: { 'content-type': 'application/json' } })), delay);
      init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const gets = () => calls.filter((c) => c.method === 'GET');

describe('query layer', () => {
  it('identical GETs in flight share one request; each caller gets its own copy', async () => {
    const [a, b] = await Promise.all([get<{ list: number[] }>('/api/x'), get<{ list: number[] }>('/api/x')]);
    expect(gets()).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    (a as unknown as { url: string }).url = 'changed';
    expect((b as unknown as { url: string }).url).toBe('/api/x');
  });

  it('different URLs and the background flag are different keys', async () => {
    await Promise.all([get('/api/x'), get('/api/y'), get('/api/x', { background: true })]);
    expect(gets()).toHaveLength(3);
  });

  it('reuses an answer for the short window, then asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-11-27T10:00:00Z').getTime(); vi.setSystemTime(t0);
    await get('/api/x');
    await get('/api/x');
    expect(gets()).toHaveLength(1);
    vi.setSystemTime(t0 + 1000);
    await get('/api/x');
    expect(gets()).toHaveLength(2);
  });

  it('a longer ttl is honoured; fresh always goes to the server', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now(); vi.setSystemTime(t0);
    await get('/api/auth/me', { ttl: 30_000 });
    vi.setSystemTime(t0 + 20_000);
    await get('/api/auth/me', { ttl: 30_000 });
    expect(gets()).toHaveLength(1);
    await get('/api/auth/me', { fresh: true });
    expect(gets()).toHaveLength(2);
    vi.setSystemTime(t0 + 20_100);
    await get('/api/auth/me', { ttl: 0 });
    expect(gets()).toHaveLength(3);
  });

  it('a write forgets every answer, and an answer that started before the write is not kept', async () => {
    await get('/api/x', { ttl: 60_000 });
    await post('/api/y', {});
    await get('/api/x', { ttl: 60_000 });
    expect(gets()).toHaveLength(2);

    // a GET in flight while a write happens: its own callers get it, a later caller does not reuse it
    delay = 30;
    const before = get('/api/z', { ttl: 60_000 });
    await new Promise((r) => setTimeout(r, 5));
    delay = 5;
    await post('/api/w', {});
    await before;
    await get('/api/z', { ttl: 60_000 });
    expect(gets().filter((c) => c.url === '/api/z')).toHaveLength(2);
  });

  it('invalidate(prefix) drops only that prefix', async () => {
    await Promise.all([get('/api/projects/a/dms', { ttl: 60_000 }), get('/api/other', { ttl: 60_000 })]);
    invalidate('/api/projects/a');
    await Promise.all([get('/api/projects/a/dms', { ttl: 60_000 }), get('/api/other', { ttl: 60_000 })]);
    expect(gets().map((c) => c.url)).toEqual(['/api/projects/a/dms', '/api/other', '/api/projects/a/dms']);
  });

  it('a cancelled caller stops waiting; the shared request is aborted only when nobody waits', async () => {
    delay = 50;
    const c1 = new AbortController(); const c2 = new AbortController();
    const p1 = get('/api/slow', { signal: c1.signal });
    const p2 = get('/api/slow', { signal: c2.signal });
    c1.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls[0].signal?.aborted).toBe(false);
    await expect(p2).resolves.toMatchObject({ url: '/api/slow' });

    const c3 = new AbortController();
    const p3 = get('/api/slow2', { signal: c3.signal });
    c3.abort();
    await expect(p3).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.find((c) => c.url === '/api/slow2')?.signal?.aborted).toBe(true);
  });

  it('a failed request is not kept', async () => {
    let fail = true;
    const load = () => (fail ? Promise.reject(new Error('down')) : Promise.resolve(7));
    await expect(shared('k', load, { ttl: 60_000 })).rejects.toThrow('down');
    fail = false;
    await expect(shared('k', load, { ttl: 60_000 })).resolves.toBe(7);
    expect(requestsSent()).toBe(2);
  });

  it('one save follow-up: the side list and the Studio asking for /dms together send one request', async () => {
    await post('/api/projects/p/dms/DMC-A.XML', { xml: '<dmodule/>' });
    const studio = get('/api/projects/p/dms');
    await new Promise((r) => setTimeout(r, 1));        // the side list asks a render later
    const side = get('/api/projects/p/dms');
    await Promise.all([studio, side]);
    expect(gets()).toHaveLength(1);
  });
});

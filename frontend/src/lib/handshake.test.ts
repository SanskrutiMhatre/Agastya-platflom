// WP-26: the client side of the version handshake - refusal of an old page and of an old server, the header on every request, and a 426
// from the server landing in the same "reload" dialog state.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_API_VERSION, CLIENT_VERSION, CLIENT_VERSION_HEADER, checkCompatibility, compareVersions, reportClientTooOld, runHandshake, useHandshake } from './handshake';
import { get, ApiError } from '../api/client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { useHandshake.getState().set(null); vi.unstubAllGlobals(); });

describe('version handshake (WP-26)', () => {
  it('the page knows its own version: the root package.json, written in at build time', () => {
    const root = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as { version: string };
    expect(CLIENT_VERSION).toBe(root.version);
    expect(CLIENT_API_VERSION).toBe(1);
  });

  it('compares versions numerically; a pre-release ranks below its release', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0-rc.1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('nonsense', '0.0.1')).toBeLessThan(0);
  });

  it('refuses an old page (below minClientVersion, or a server on a newer API) and an old server (an older API)', () => {
    const page = { version: '2.0.0', apiVersion: 1 };
    expect(checkCompatibility({ version: '2.0.0', apiVersion: 1, minClientVersion: '2.0.0' }, page)).toEqual({ ok: true });
    expect(checkCompatibility({ version: '2.3.0', apiVersion: 1, minClientVersion: '2.0.0' }, page)).toEqual({ ok: true });
    const old = checkCompatibility({ version: '2.5.0', apiVersion: 1, minClientVersion: '2.4.0' }, page);
    expect(old.ok).toBe(false); if (!old.ok) { expect(old.reason).toBe('client-too-old'); expect(old.message).toMatch(/Reload/); }
    const newerApi = checkCompatibility({ version: '3.0.0', apiVersion: 2, minClientVersion: '2.0.0' }, page);
    expect(newerApi.ok ? null : newerApi.reason).toBe('client-too-old');
    const oldServer = checkCompatibility({ version: '1.9.0', apiVersion: 1, minClientVersion: '1.0.0' }, { version: '3.0.0', apiVersion: 2 });
    expect(oldServer.ok ? null : oldServer.reason).toBe('server-too-old');
  });

  it('runHandshake asks /api/version and records a mismatch; a failed or malformed answer is not one', async () => {
    expect(await runHandshake(async () => json({ version: '9.0.0', apiVersion: 9, minClientVersion: '9.0.0' }))).toMatchObject({ ok: false, reason: 'client-too-old' });
    expect(useHandshake.getState().mismatch?.reason).toBe('client-too-old');
    useHandshake.getState().set(null);
    expect(await runHandshake(async () => { throw new TypeError('network'); })).toBeNull();
    expect(await runHandshake(async () => json({ error: 'x' }, 503))).toBeNull();
    expect(await runHandshake(async () => json({ hello: 1 }))).toBeNull();
    expect(await runHandshake(async () => json({ version: CLIENT_VERSION, apiVersion: CLIENT_API_VERSION, minClientVersion: '2.0.0' }))).toEqual({ ok: true });
    expect(useHandshake.getState().mismatch).toBeNull();
  });

  it('every API request carries the page version, and a 426 CLIENT_TOO_OLD opens the reload dialog state', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return json({ error: 'This page is older than the server.', code: 'CLIENT_TOO_OLD', minClientVersion: '9.0.0', version: '9.1.0' }, 426);
    }));
    await expect(get('/api/wp26-probe', { fresh: true })).rejects.toBeInstanceOf(ApiError);
    expect(seen[0][CLIENT_VERSION_HEADER]).toBe(CLIENT_VERSION);
    expect(useHandshake.getState().mismatch).toMatchObject({ reason: 'client-too-old' });
    expect(useHandshake.getState().mismatch?.message).toMatch(/9\.1\.0/);
    reportClientTooOld('9.2.0');                                                     // the first report stays
    expect(useHandshake.getState().mismatch?.message).toMatch(/9\.1\.0/);
  });
});

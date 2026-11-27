// WP-26 (DEP-010): the client/server version handshake.
//
// Before anyone signs in, the page asks GET /api/version and checks that it and the server can talk:
//   * the page is older than the server allows (version < minClientVersion), or the server speaks a newer API level than this page
//     knows: the page is stale (cached from before an upgrade, or a Mode B client left open over a server update) -> reload;
//   * the server speaks an older API level than this page needs: the server is older than the page -> the administrator must update it.
// The page also sends its version on every API request (api/client.ts) and on the WebSocket; the server answers 426 CLIENT_TOO_OLD to a
// page older than it allows, which lands here too. A server that does not answer is not a mismatch: the session store shows "not answering".
import { create } from 'zustand';

/** This page's version (the root package.json at build time). */
export const CLIENT_VERSION: string = typeof __AGASTYA_CLIENT_VERSION__ === 'string' ? __AGASTYA_CLIENT_VERSION__ : '0.0.0';
/** The HTTP API level this page is written against (backend services/version.ts API_VERSION). */
export const CLIENT_API_VERSION = 1;
/** The header the server reads the page's version from (backend services/version.ts CLIENT_VERSION_HEADER). */
export const CLIENT_VERSION_HEADER = 'x-agastya-client';

export interface ServerVersion { product?: string; version: string; apiVersion: number; minClientVersion: string }

export type Compatibility =
  | { ok: true }
  | { ok: false; reason: 'client-too-old' | 'server-too-old'; message: string };

/** "2.10.1" against "2.9.0": <0, 0, >0. A pre-release ranks below its release; a malformed version below every real one. */
export function compareVersions(a: string, b: string): number {
  const p = (v: string) => { const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(v.trim()); return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] } : null; };
  const x = p(a); const y = p(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  return (x.pre ? 0 : 1) - (y.pre ? 0 : 1);
}

/** Can this page work with that server? */
export function checkCompatibility(server: ServerVersion, client = { version: CLIENT_VERSION, apiVersion: CLIENT_API_VERSION }): Compatibility {
  if (compareVersions(client.version, server.minClientVersion) < 0 || server.apiVersion > client.apiVersion) {
    return { ok: false, reason: 'client-too-old', message: `This page (version ${client.version}) is older than the server (version ${server.version}). Reload the page to load the current version.` };
  }
  if (server.apiVersion < client.apiVersion) {
    return { ok: false, reason: 'server-too-old', message: `The server (version ${server.version}) is older than this page (version ${client.version}). Ask the administrator to update the server.` };
  }
  return { ok: true };
}

interface HandshakeState { mismatch: Exclude<Compatibility, { ok: true }> | null; set: (m: HandshakeState['mismatch']) => void }
export const useHandshake = create<HandshakeState>((set) => ({ mismatch: null, set: (mismatch) => set({ mismatch }) }));

/** The server answered 426 CLIENT_TOO_OLD to a request of this page. */
export function reportClientTooOld(serverVersion?: string): void {
  if (useHandshake.getState().mismatch) return;
  useHandshake.getState().set({ ok: false, reason: 'client-too-old', message: `This page (version ${CLIENT_VERSION}) is older than the server${serverVersion ? ` (version ${serverVersion})` : ''}. Reload the page to load the current version.` });
}

/** Ask the server once (at start). A network error or a malformed answer is not a mismatch. */
export async function runHandshake(fetchVersion: () => Promise<Response> = () => fetch('/api/version', { credentials: 'same-origin', headers: { [CLIENT_VERSION_HEADER]: CLIENT_VERSION } })): Promise<Compatibility | null> {
  try {
    const res = await fetchVersion();
    if (!res.ok) return null;
    const v = await res.json() as Partial<ServerVersion>;
    if (typeof v.version !== 'string' || typeof v.apiVersion !== 'number' || typeof v.minClientVersion !== 'string') return null;
    const c = checkCompatibility(v as ServerVersion);
    if (!c.ok) useHandshake.getState().set(c);
    return c;
  } catch { return null; }
}

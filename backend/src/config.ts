// =============================================================================
// Configuration - where the server finds its data and its vendored engine.
//
// `ROOT` is the backend folder in BOTH layouts: this file is backend/src/config.ts
// when run from source and backend/dist/config.js once compiled, and both are
// one level below it. vendor/ (the publishing engine copied from JSS Publisher)
// and schemas/ sit beside src/ and dist/, so they resolve identically either way.
// =============================================================================

import path from 'path';

const ROOT = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 4040),
  /**
   * Address to listen on. Unset keeps Node's default (every interface), which is what a developer running from source expects. The packaged
   * product sets 127.0.0.1 so a fresh install is reachable from this machine only; an administrator opens it to the LAN on purpose.
   */
  host: process.env.AGASTYA_HOST || undefined,

  root: ROOT,
  /** The publishing engine, pipelines and bundled tools. Treated as third-party code. */
  vendorDir: path.join(ROOT, 'vendor'),
  pipelineDir: path.join(ROOT, 'vendor', 'pipeline'),
  /** S1000D XSD sets, one clean directory per issue. */
  schemasDir: path.join(ROOT, 'schemas'),
  /** House templates seeded into the workspace on first start. */
  seedTemplatesDir: path.join(ROOT, 'templates'),

  /** Projects, house templates and publisher.db live here. */
  workspaceDir: process.env.AGASTYA_WORKSPACE_DIR ?? path.resolve(ROOT, '..', 'workspace'),

  /** The built client, served by this process when present (single-process deployment). */
  clientDist: process.env.AGASTYA_CLIENT_DIST ?? path.resolve(ROOT, '..', 'frontend', 'dist'),

  secureCookies: process.env.AGASTYA_SECURE_COOKIES === '1',
  /**
   * Which peers may set X-Forwarded-For / X-Forwarded-Proto (Express "trust proxy"; audit SEC-008). Default "loopback": a reverse proxy on the
   * same machine is believed, a client that writes the header itself is not (with the former fixed 1 any client could choose its own address
   * for the login throttle and the audit log). Behind a proxy on another machine set its address ("10.0.0.5") or a hop count ("1").
   */
  trustProxy: (() => { const v = (process.env.AGASTYA_TRUST_PROXY ?? 'loopback').trim(); if (/^\d+$/.test(v)) return Number(v); if (/^(false|off|none|0)$/i.test(v)) return false; return v; })() as string | number | boolean,
};

/** Load a CommonJS module from vendor/ (engine code that is deliberately not type-checked). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vendor(rel: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(config.vendorDir, rel));
}

export const nowIso = (): string => new Date().toISOString();

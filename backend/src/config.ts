// =============================================================================
// Configuration - where the server finds its data and its vendored engine.
//
// `ROOT` is the backend folder in BOTH layouts: this file is backend/src/config.ts
// when run from source and backend/dist/config.js once compiled, and both are
// one level below it. vendor/ (the publishing engine copied from JSS Publisher)
// and schemas/ sit beside src/ and dist/, so they resolve identically either way.
//
// WP-10 (PLT-032, PLT-028): this is the ONLY module under src/ that reads the process environment. `buildConfig(env)` turns an
// environment into one typed, validated `Config`; `config` is that object for this process, built once when this module first
// loads (the test harness relies on that moment: it sets AGASTYA_WORKSPACE_DIR before the first require). An invalid value stops
// start-up with the variable's name. A test or a tool that needs a second, isolated configuration calls `buildConfig({...})`
// itself and hands it to `createAppContext` (appContext.ts). test/wp10-seams.test.js keeps `process.env` out of every other file.
// =============================================================================

import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/** The environment a configuration is built from (process.env, or a plain object in a test). */
export type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  /**
   * Address to listen on. Unset keeps Node's default (every interface), which is what a developer running from source expects. The packaged
   * product sets 127.0.0.1 so a fresh install is reachable from this machine only; an administrator opens it to the LAN on purpose.
   */
  host: string | undefined;
  root: string;
  /** The publishing engine, pipelines and bundled tools. Treated as third-party code. */
  vendorDir: string;
  pipelineDir: string;
  /** S1000D XSD sets, one clean directory per issue. */
  schemasDir: string;
  /** House templates seeded into the workspace on first start. */
  seedTemplatesDir: string;
  /** Projects, house templates and publisher.db live here. */
  workspaceDir: string;
  /** The built client, served by this process when present (single-process deployment). */
  clientDist: string;
  secureCookies: boolean;
  /**
   * Which peers may set X-Forwarded-For / X-Forwarded-Proto (Express "trust proxy"; audit SEC-008). Default "loopback": a reverse proxy on the
   * same machine is believed, a client that writes the header itself is not (with the former fixed 1 any client could choose its own address
   * for the login throttle and the audit log). Behind a proxy on another machine set its address ("10.0.0.5") or a hop count ("1").
   */
  trustProxy: string | number | boolean;
  /** Browser origins of the development server that may make state-changing requests (AGASTYA_DEV_ORIGINS, comma-separated). */
  devOrigins: string[];
  /** Upload and import limits (AGASTYA_MAX_UPLOAD_BYTES, AGASTYA_REQUEST_TIMEOUT_MS, AGASTYA_MAX_EXPANDED_BYTES). */
  limits: { maxUploadBytes: number; requestTimeoutMs: number; maxExpandedBytes: number };
  /** WP-06: one server per data folder, unless a test harness opts out (AGASTYA_NO_WORKSPACE_LOCK=1). */
  workspaceLock: boolean;
  /** The packaged launcher asks for a clean stop by closing standard input (AGASTYA_SHUTDOWN_ON_STDIN_CLOSE=1). */
  shutdownOnStdinClose: boolean;
  /** A pdfjs-dist folder to use for structure recovery before the bundled candidates (AGASTYA_PDFJS_DIR). */
  pdfjsDir: string | undefined;
  /** First-run administrator (INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD). Secret: never logged. */
  initialAdmin: { INITIAL_ADMIN_USERNAME: string | undefined; INITIAL_ADMIN_PASSWORD: string | undefined };
}

/** A positive number from an environment; unset, empty or invalid (".env" files often leave `NAME=` blank) means the default, never 0 or NaN. */
export const envPositive = (name: string, fallback: number, env: Env = process.env): number => {
  const raw = env[name]; const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** A configuration error names the variable, so start-up stops with something an administrator can act on. */
export class ConfigError extends Error {
  constructor(public variable: string, message: string) { super(`${variable}: ${message}`); this.name = 'ConfigError'; }
}

function parseTrustProxy(raw: string | undefined): string | number | boolean {
  const v = (raw ?? 'loopback').trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (/^(false|off|none|0)$/i.test(v)) return false;
  return v;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 4040;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new ConfigError('PORT', `"${raw}" is not a TCP port (0-65535).`);
  return n;
}

/** Build one typed, validated configuration from an environment. Pure: reads nothing but `env`. */
export function buildConfig(env: Env = process.env): Config {
  return {
    port: parsePort(env.PORT),
    host: env.AGASTYA_HOST || undefined,
    root: ROOT,
    vendorDir: path.join(ROOT, 'vendor'),
    pipelineDir: path.join(ROOT, 'vendor', 'pipeline'),
    schemasDir: path.join(ROOT, 'schemas'),
    seedTemplatesDir: path.join(ROOT, 'templates'),
    workspaceDir: env.AGASTYA_WORKSPACE_DIR ?? path.resolve(ROOT, '..', 'workspace'),
    clientDist: env.AGASTYA_CLIENT_DIST ?? path.resolve(ROOT, '..', 'frontend', 'dist'),
    secureCookies: env.AGASTYA_SECURE_COOKIES === '1',
    trustProxy: parseTrustProxy(env.AGASTYA_TRUST_PROXY),
    devOrigins: (env.AGASTYA_DEV_ORIGINS ?? 'http://localhost:5174').split(',').map((s) => s.trim()).filter(Boolean),
    limits: {
      maxUploadBytes: envPositive('AGASTYA_MAX_UPLOAD_BYTES', 2 * 1024 ** 3, env),
      requestTimeoutMs: envPositive('AGASTYA_REQUEST_TIMEOUT_MS', 3 * 3600_000, env),
      maxExpandedBytes: envPositive('AGASTYA_MAX_EXPANDED_BYTES', 8 * 1024 ** 3, env),
    },
    workspaceLock: env.AGASTYA_NO_WORKSPACE_LOCK !== '1',
    shutdownOnStdinClose: env.AGASTYA_SHUTDOWN_ON_STDIN_CLOSE === '1',
    pdfjsDir: env.AGASTYA_PDFJS_DIR || undefined,
    initialAdmin: { INITIAL_ADMIN_USERNAME: env.INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD: env.INITIAL_ADMIN_PASSWORD },
  };
}

/** The effective configuration without secrets, for the start-up log and diagnostics. */
export function describeConfig(c: Config): Record<string, unknown> {
  const { initialAdmin, ...rest } = c;
  return { ...rest, initialAdmin: initialAdmin.INITIAL_ADMIN_USERNAME ? { username: initialAdmin.INITIAL_ADMIN_USERNAME, password: '[set]' } : null };
}

/** This process's configuration, built once. */
export const config: Config = buildConfig(process.env);

/** Load a CommonJS module from vendor/ (engine code that is deliberately not type-checked). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vendor(rel: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(config.vendorDir, rel));
}

export const nowIso = (): string => new Date().toISOString();

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
import { defaultKeyFile } from './core/auth/auditChain';

const ROOT = path.resolve(__dirname, '..');

/** The environment a configuration is built from (process.env, or a plain object in a test). */
export type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  /**
   * Address to listen on (AGASTYA_HOST). Unset in Mode A = the loopback interface only, 127.0.0.1 and ::1 (WP-26; it used to be every
   * interface, so a server started from source answered the whole network in plain HTTP). Unset in Mode B = every interface, TLS only.
   * The packaged product sets 127.0.0.1; an administrator opens it to the network on purpose (Mode B).
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
  /** Upload and import limits (AGASTYA_MAX_UPLOAD_BYTES, AGASTYA_REQUEST_TIMEOUT_MS, AGASTYA_MAX_EXPANDED_BYTES), and the free-disk floor of GET /api/ready (AGASTYA_READY_MIN_FREE_BYTES). */
  limits: { maxUploadBytes: number; requestTimeoutMs: number; maxExpandedBytes: number; readyMinFreeBytes: number };
  /** WP-06: one server per data folder, unless a test harness opts out (AGASTYA_NO_WORKSPACE_LOCK=1). */
  workspaceLock: boolean;
  /** The packaged launcher asks for a clean stop by closing standard input (AGASTYA_SHUTDOWN_ON_STDIN_CLOSE=1). */
  shutdownOnStdinClose: boolean;
  /** A pdfjs-dist folder to use for structure recovery before the bundled candidates (AGASTYA_PDFJS_DIR). */
  pdfjsDir: string | undefined;
  /** First-run administrator (INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD). Secret: never logged. */
  initialAdmin: { INITIAL_ADMIN_USERNAME: string | undefined; INITIAL_ADMIN_PASSWORD: string | undefined };
  /**
   * WP-26 (ENT-001, SEC-006, DEP-010): the deployment shape (AGASTYA_MODE). `local` = Mode A, one person on this computer: the server listens
   * on the loopback interface only and refuses any other AGASTYA_HOST. `server` = Mode B, a server on the network: every listener on a
   * non-loopback address serves TLS only (AGASTYA_TLS_*), so a Mode B server without a certificate stops at start naming the variable.
   */
  mode: DeploymentMode;
  /** The certificate files of the TLS listener (null = plain HTTP, allowed on loopback only). Read and checked at start by services/network.ts. */
  tls: TlsFiles | null;
  /**
   * Host names (and addresses) the server answers to besides the loopback names (AGASTYA_SERVER_NAMES, comma-separated; "*" = any). The
   * certificate's subjectAltName entries are added at start. A request for any other Host gets 421: a page on another site that rebinds
   * its DNS name to this server reads nothing and creates nothing (DNS rebinding), over HTTP and over the WebSocket alike.
   */
  serverNames: string[];
  /** Strict-Transport-Security max-age in seconds on TLS answers (AGASTYA_HSTS_MAX_AGE; 0 = no header). No includeSubDomains, no preload. */
  hstsMaxAge: number;
  /**
   * WP-12 (PLT-001, ENT-006, PLT-006): platform backups. `dir` (AGASTYA_BACKUP_DIR, default <workspace>/backups/platform) holds the archives;
   * put it on a second disk in production. `intervalHours` (AGASTYA_BACKUP_INTERVAL_HOURS, default 24, 0 = no scheduled backup);
   * `keep` (AGASTYA_BACKUP_KEEP "daily/weekly/monthly", default 7/4/12) applies to scheduled backups only; `keepMigrationSnapshots`
   * (AGASTYA_KEEP_MIGRATION_SNAPSHOTS, default 5) the pre-migration database copies; `restoreTestDays` (AGASTYA_RESTORE_TEST_DAYS, default 7,
   * 0 = off) how often the latest backup is restored into a scratch folder and checked.
   */
  backup: { dir: string; intervalHours: number; keep: { daily: number; weekly: number; monthly: number }; keepMigrationSnapshots: number; restoreTestDays: number };
  /**
   * WP-12 (PLT-007, ENT-015): how long housekeeping rows live, in days (0 = keep for ever). Sessions after they ended, read notifications,
   * decided password-reset requests; audit rows older than `auditDays` are written to a compressed archive file first, then removed.
   */
  retention: { sessionsDays: number; notificationsDays: number; resetRequestsDays: number; auditDays: number };
  /**
   * WP-29 (ENT-003): the key of the audit chain lives in a file outside the database (AGASTYA_AUDIT_KEY_FILE; default
   * <workspace>/audit-key/audit-hmac.key; the packaged product points it at its state folder, outside the data folder). Made on first start.
   * `checkpointHours` (AGASTYA_AUDIT_CHECKPOINT_HOURS, default 24, 0 = only with backups): how often a signed checkpoint is taken.
   */
  audit: { keyFile: string; checkpointHours: number };
  /**
   * WP-29 (ENT-007, RES-004): server logs. `format` (AGASTYA_LOG_FORMAT) `json` = one JSON object per line on standard output (the default
   * when NODE_ENV=production, which the packaged host sets), `text` = the readable console lines of a developer run. `dir`
   * (AGASTYA_LOG_DIR, default <workspace>/logs; "off" = none) also gets agastya-server.jsonl, always JSON, rotated at `maxBytes`
   * (AGASTYA_LOG_MAX_MB, default 10) keeping `keep` old files (AGASTYA_LOG_KEEP, default 5). `access` (AGASTYA_ACCESS_LOG, default on with
   * JSON) adds one line per request: method, route, status, milliseconds, user id - never a body, a query string or a cookie.
   * `eventSink` (AGASTYA_EVENT_SINK) `host` = security events are also written to standard output as `##agastya-event|id|level|text` lines,
   * which the Windows host turns into Application-log entries with stable ids (docs/OPERATIONS.md section 9).
   */
  log: { format: 'json' | 'text'; dir: string | null; maxBytes: number; keep: number; access: boolean; eventSink: 'host' | 'none' };
}

function parseLogFormat(raw: string | undefined, nodeEnv: string | undefined): 'json' | 'text' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return nodeEnv === 'production' ? 'json' : 'text';
  if (v === 'json' || v === 'text') return v;
  throw new ConfigError('AGASTYA_LOG_FORMAT', `"${raw}" is not a log format: use "json" or "text".`);
}
function parseOnOff(name: string, raw: string | undefined, fallback: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  if (/^(1|on|true|yes)$/.test(v)) return true;
  if (/^(0|off|false|no)$/.test(v)) return false;
  throw new ConfigError(name, `"${raw}" is not on or off.`);
}
function parseEventSink(raw: string | undefined): 'host' | 'none' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'none') return 'none';
  if (v === 'host') return 'host';
  throw new ConfigError('AGASTYA_EVENT_SINK', `"${raw}" is not an event sink: use "host" (the Windows host writes the Application log) or "none".`);
}

export type DeploymentMode = 'local' | 'server';
/** PEM certificate + key, or one PKCS#12 (.pfx) file; the passphrase of either comes from a file, never from the environment itself. */
export interface TlsFiles { certFile?: string; keyFile?: string; pfxFile?: string; passphraseFile?: string }

/** A positive number from an environment; unset, empty or invalid (".env" files often leave `NAME=` blank) means the default, never 0 or NaN. */
export const envPositive = (name: string, fallback: number, env: Env = process.env): number => {
  const raw = env[name]; const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** A whole number >= 0 from an environment; unset or empty means the default; anything else is a configuration error (0 is meaningful: "off"). */
export const envCount = (name: string, fallback: number, env: Env = process.env): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(name, `"${raw}" is not a whole number of 0 or more.`);
  return n;
};

function parseKeep(raw: string | undefined): { daily: number; weekly: number; monthly: number } {
  if (raw === undefined || raw.trim() === '') return { daily: 7, weekly: 4, monthly: 12 };
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!m) throw new ConfigError('AGASTYA_BACKUP_KEEP', `"${raw}" is not daily/weekly/monthly, for example 7/4/12.`);
  return { daily: Number(m[1]), weekly: Number(m[2]), monthly: Number(m[3]) };
}

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

/** True for an address or name that can only reach this computer: 127.0.0.0/8, ::1, IPv4-mapped loopback, "localhost" and *.localhost (RFC 6761). */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function parseMode(raw: string | undefined): DeploymentMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'local' || v === 'a') return 'local';
  if (v === 'server' || v === 'b') return 'server';
  throw new ConfigError('AGASTYA_MODE', `"${raw}" is not a deployment mode: use "local" (Mode A, this computer only) or "server" (Mode B, TLS on the network).`);
}

function parseTls(env: Env): TlsFiles | null {
  const pick = (n: string): string | undefined => { const v = env[n]; return v === undefined || v.trim() === '' ? undefined : v.trim(); };
  const certFile = pick('AGASTYA_TLS_CERT'); const keyFile = pick('AGASTYA_TLS_KEY'); const pfxFile = pick('AGASTYA_TLS_PFX');
  const passphraseFile = pick('AGASTYA_TLS_PASSPHRASE_FILE');
  if (pfxFile && (certFile || keyFile)) throw new ConfigError('AGASTYA_TLS_PFX', 'give either a PKCS#12 file (AGASTYA_TLS_PFX) or a PEM certificate and key (AGASTYA_TLS_CERT, AGASTYA_TLS_KEY), not both.');
  if (certFile && !keyFile) throw new ConfigError('AGASTYA_TLS_KEY', 'AGASTYA_TLS_CERT is set but the private key file is not (PEM).');
  if (keyFile && !certFile) throw new ConfigError('AGASTYA_TLS_CERT', 'AGASTYA_TLS_KEY is set but the certificate file is not (PEM: the server certificate first, then any intermediate CA).');
  if (!certFile && !pfxFile) {
    if (passphraseFile) throw new ConfigError('AGASTYA_TLS_PASSPHRASE_FILE', 'is set but no certificate is (AGASTYA_TLS_PFX, or AGASTYA_TLS_CERT and AGASTYA_TLS_KEY).');
    return null;
  }
  return { certFile, keyFile, pfxFile, passphraseFile };
}

const HOST_NAME = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const ADDRESS = /^\[?[0-9a-f:.]+\]?$/;

function parseServerNames(raw: string | undefined): string[] {
  const names = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const n of names) {
    if (n !== '*' && !HOST_NAME.test(n) && !ADDRESS.test(n)) {
      throw new ConfigError('AGASTYA_SERVER_NAMES', `"${n}" is not a host name or an address (no scheme and no port, for example "docs.example.local, 10.0.0.5").`);
    }
  }
  return names.map((n) => n.replace(/^\[(.*)\]$/, '$1'));
}

function parseHsts(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 15552000;          // 180 days
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError('AGASTYA_HSTS_MAX_AGE', `"${raw}" is not a whole number of seconds (0 turns the header off).`);
  return n;
}

/**
 * The listening rules of WP-26, checked before anything listens: Mode A never binds a network address, and Mode B binds one only with TLS.
 * A reverse proxy on the same computer that terminates TLS is the documented alternative: Mode B listening on 127.0.0.1 behind it.
 */
function checkListening(mode: DeploymentMode, host: string | undefined, tls: TlsFiles | null): void {
  if (mode === 'local') {
    if (host !== undefined && !isLoopbackHost(host)) {
      throw new ConfigError('AGASTYA_HOST', `"${host}" is not a loopback address. Mode A (AGASTYA_MODE=local, the default) serves this computer only; `
        + 'to serve the network set AGASTYA_MODE=server with a TLS certificate (AGASTYA_TLS_CERT and AGASTYA_TLS_KEY, or AGASTYA_TLS_PFX).');
    }
    return;
  }
  const networked = host === undefined || !isLoopbackHost(host);
  if (networked && !tls) {
    throw new ConfigError('AGASTYA_TLS_CERT', `Mode B listens on ${host ?? 'every network interface'} and serves TLS only there: set AGASTYA_TLS_CERT and AGASTYA_TLS_KEY `
      + '(PEM) or AGASTYA_TLS_PFX. Behind a reverse proxy on this computer that terminates TLS, set AGASTYA_HOST=127.0.0.1 instead.');
  }
}

/** Build one typed, validated configuration from an environment. Pure: reads nothing but `env`. */
export function buildConfig(env: Env = process.env): Config {
  const mode = parseMode(env.AGASTYA_MODE);
  const host = env.AGASTYA_HOST?.trim() || undefined;
  const tls = parseTls(env);
  checkListening(mode, host, tls);
  const workspaceDir = env.AGASTYA_WORKSPACE_DIR ?? path.resolve(ROOT, '..', 'workspace');
  return {
    port: parsePort(env.PORT),
    host,
    root: ROOT,
    vendorDir: path.join(ROOT, 'vendor'),
    pipelineDir: path.join(ROOT, 'vendor', 'pipeline'),
    schemasDir: path.join(ROOT, 'schemas'),
    seedTemplatesDir: path.join(ROOT, 'templates'),
    workspaceDir,
    clientDist: env.AGASTYA_CLIENT_DIST ?? path.resolve(ROOT, '..', 'frontend', 'dist'),
    secureCookies: env.AGASTYA_SECURE_COOKIES === '1' || tls !== null,          // TLS on: every cookie Secure (WP-26)
    trustProxy: parseTrustProxy(env.AGASTYA_TRUST_PROXY),
    devOrigins: (env.AGASTYA_DEV_ORIGINS ?? 'http://localhost:5174').split(',').map((s) => s.trim()).filter(Boolean),
    limits: {
      maxUploadBytes: envPositive('AGASTYA_MAX_UPLOAD_BYTES', 2 * 1024 ** 3, env),
      requestTimeoutMs: envPositive('AGASTYA_REQUEST_TIMEOUT_MS', 3 * 3600_000, env),
      maxExpandedBytes: envPositive('AGASTYA_MAX_EXPANDED_BYTES', 8 * 1024 ** 3, env),
      readyMinFreeBytes: envPositive('AGASTYA_READY_MIN_FREE_BYTES', 256 * 1024 ** 2, env),
    },
    workspaceLock: env.AGASTYA_NO_WORKSPACE_LOCK !== '1',
    shutdownOnStdinClose: env.AGASTYA_SHUTDOWN_ON_STDIN_CLOSE === '1',
    pdfjsDir: env.AGASTYA_PDFJS_DIR || undefined,
    initialAdmin: { INITIAL_ADMIN_USERNAME: env.INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD: env.INITIAL_ADMIN_PASSWORD },
    mode,
    tls,
    serverNames: parseServerNames(env.AGASTYA_SERVER_NAMES),
    hstsMaxAge: parseHsts(env.AGASTYA_HSTS_MAX_AGE),
    backup: {
      dir: env.AGASTYA_BACKUP_DIR || path.join(workspaceDir, 'backups', 'platform'),
      intervalHours: envCount('AGASTYA_BACKUP_INTERVAL_HOURS', 24, env),
      keep: parseKeep(env.AGASTYA_BACKUP_KEEP),
      keepMigrationSnapshots: envCount('AGASTYA_KEEP_MIGRATION_SNAPSHOTS', 5, env),
      restoreTestDays: envCount('AGASTYA_RESTORE_TEST_DAYS', 7, env),
    },
    retention: {
      sessionsDays: envCount('AGASTYA_RETENTION_SESSIONS_DAYS', 30, env),
      notificationsDays: envCount('AGASTYA_RETENTION_NOTIFICATIONS_DAYS', 90, env),
      resetRequestsDays: envCount('AGASTYA_RETENTION_RESET_REQUESTS_DAYS', 90, env),
      auditDays: envCount('AGASTYA_AUDIT_RETENTION_DAYS', 730, env),
    },
    audit: {
      keyFile: defaultKeyFile(workspaceDir, env),
      checkpointHours: envCount('AGASTYA_AUDIT_CHECKPOINT_HOURS', 24, env),
    },
    log: (() => {
      const format = parseLogFormat(env.AGASTYA_LOG_FORMAT, env.NODE_ENV);
      const dirRaw = (env.AGASTYA_LOG_DIR ?? '').trim();
      return {
        format,
        dir: /^(off|none|0)$/i.test(dirRaw) ? null : dirRaw ? path.resolve(dirRaw) : path.join(workspaceDir, 'logs'),
        maxBytes: envCount('AGASTYA_LOG_MAX_MB', 10, env) * 1024 * 1024 || 10 * 1024 * 1024,
        keep: envCount('AGASTYA_LOG_KEEP', 5, env),
        access: parseOnOff('AGASTYA_ACCESS_LOG', env.AGASTYA_ACCESS_LOG, format === 'json'),
        eventSink: parseEventSink(env.AGASTYA_EVENT_SINK),
      };
    })(),
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

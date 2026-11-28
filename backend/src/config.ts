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
import os from 'os';
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
  limits: { maxUploadBytes: number; requestTimeoutMs: number; maxExpandedBytes: number; readyMinFreeBytes: number;
    /** WP-17 (PERF-014): the largest data module the editor saves or creates (AGASTYA_MAX_MODULE_BYTES, default 16 MiB); imports are not limited. */
    maxModuleBytes: number };
  /** WP-06: one server per data folder, unless a test harness opts out (AGASTYA_NO_WORKSPACE_LOCK=1). */
  workspaceLock: boolean;
  /**
   * WP-11 (decision D2): every content write must name the version it was made from (`baseHash` or If-Match). AGASTYA_BASEHASH_COMPAT=1 opens a
   * compatibility window for an old script: a write without it is then accepted with a logged warning instead of refused with 428.
   */
  baseHashCompat: boolean;
  /** WP-11 (RES-001): how long a check-out lease lasts unless it is renewed (AGASTYA_LEASE_MINUTES, default 60). */
  leaseMinutes: number;
  /**
   * WP-28: at most this many WebSocket connections on the server (AGASTYA_WS_MAX_CLIENTS, default 1000; a team server has 25-50 authors
   * with a few tabs each). One session may hold at most 8 (services/broadcast.ts). A refused upgrade answers 503 / 429.
   */
  wsMaxClients: number;
  /**
   * Phase 3 (P3-1): live co-editing (services/collab). `enabled` (AGASTYA_COLLAB, default on; 0 = every editor saves by version as before);
   * `maxUpdateBytes` (AGASTYA_COLLAB_MAX_UPDATE_BYTES, default 2 MiB) the largest single change a client may send; `writeBackMs` /
   * `writeBackMaxMs` (AGASTYA_COLLAB_WRITEBACK_MS 2000 / AGASTYA_COLLAB_WRITEBACK_MAX_MS 10000): the project file is written this long after
   * the last change, and at the latest this long after the first unwritten one; `revisionMinutes` (AGASTYA_COLLAB_REVISION_MINUTES, default
   * 10): a write-back cuts a revision in the history at most this often (and always when the room closes, at Save and at server stop);
   * `idleUnloadMs` (AGASTYA_COLLAB_IDLE_MS, default 60000): a room nobody is in is written back and unloaded after this long; `maxRooms`
   * (AGASTYA_COLLAB_MAX_ROOMS, default 2000) rooms in memory at once; `persistMs` (AGASTYA_COLLAB_PERSIST_MS, default 100): updates are
   * stored in batches this often, one transaction per batch.
   */
  collab: { enabled: boolean; maxUpdateBytes: number; writeBackMs: number; writeBackMaxMs: number; revisionMinutes: number; idleUnloadMs: number; maxRooms: number; persistMs: number };
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
  /**
   * Phase 3 P3-6 (docs/phase3/standalone.md): how accounts begin (AGASTYA_DEPLOYMENT). `standalone` = the single-computer EXE: the first start
   * of a fresh data folder creates one default account per role with fixed credentials, each forced to change its password at the first
   * sign-in (core/auth/defaultAccounts.js); needs Mode A (loopback). `server` (the default, also of a developer run that does not say) = a
   * common server: no default accounts, the first administrator is created at first start (the setup screen), everyone else through user
   * management. Written by the installer (agastya.ini [server] Deployment=), shown read-only on the administration page.
   */
  deployment: AccountDeployment;
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
   * WP-25 (PRD-005): what the Windows host opened the interface in, reported by GET /api/version so support sees whether the WebView2 runtime is
   * present (and how old it is) on an air-gapped machine. Set by packaging/host (AGASTYA_WEBVIEW2_VERSION, AGASTYA_SHELL_WINDOW); null in a
   * source checkout or when the host found no runtime. A value that is not a version / a known window kind is dropped, never echoed.
   */
  shell: { webview2: string | null; window: 'app' | 'browser' | null };
  /**
   * WP-12 (PLT-001, ENT-006, PLT-006): platform backups. `dir` (AGASTYA_BACKUP_DIR, default <workspace>/backups/platform) holds the archives;
   * put it on a second disk in production. `intervalHours` (AGASTYA_BACKUP_INTERVAL_HOURS, default 24, 0 = no scheduled backup);
   * `keep` (AGASTYA_BACKUP_KEEP "daily/weekly/monthly", default 7/4/12) applies to scheduled backups only; `keepMigrationSnapshots`
   * (AGASTYA_KEEP_MIGRATION_SNAPSHOTS, default 5) the pre-migration database copies; `restoreTestDays` (AGASTYA_RESTORE_TEST_DAYS, default 7,
   * 0 = off) how often the latest backup is restored into a scratch folder and checked.
   */
  backup: { dir: string; intervalHours: number; keep: { daily: number; weekly: number; monthly: number }; keepMigrationSnapshots: number; restoreTestDays: number;
    /** WP-28 (PRD-007 warm standby): after every scheduled backup a verified copy goes to this folder (AGASTYA_BACKUP_COPY_DIR, absolute: a second
     *  disk, or a share the standby machine can reach); the copies are pruned like the originals. null = no copy. */
    copyTo: string | null };
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
   * which the Windows host turns into Application-log entries with stable ids (docs/OPERATIONS.md section 13).
   */
  log: { format: 'json' | 'text'; dir: string | null; maxBytes: number; keep: number; access: boolean; eventSink: 'host' | 'none' };
  /**
   * WP-27 (ENT-005, DEP-015): directory sign-on over LDAPS, Mode B only (null = local accounts only, as in Mode A). Set by
   * AGASTYA_DIRECTORY_URL and its companions; the group-to-role mapping is kept in the database and edited by administrators.
   */
  directory: DirectoryConfig | null;
  /**
   * Phase 3 (P3-5): the intranet GitLab integration. The connection itself (address, CA, OAuth application, tokens) is entered by the
   * administrator in the UI and kept in the database; secrets are encrypted with the key in `secretsKeyFile` (AGASTYA_SECRETS_KEY_FILE,
   * default <workspace>/keys/secrets.key, made on first use, owner-only). `allowHttp` (AGASTYA_GITLAB_ALLOW_HTTP=1) accepts a plain-http
   * GitLab address (never recommended; off by default: the integration needs TLS).
   */
  gitlab: { secretsKeyFile: string; allowHttp: boolean };
  /** WP-14 (PERF-001, PUB-027, PRD-001): the job service that runs validation, the publish gate and publication in worker processes. */
  jobs: JobsConfig;
  /**
   * WP-17 (PERF-009, decision D14): the working `synchronous` level of publisher.db. NORMAL (the default) in WAL mode keeps the database
   * consistent after any crash; a power cut can lose only the last commits. AGASTYA_DB_SYNCHRONOUS=FULL syncs every commit. Migrations always run under FULL.
   */
  database: { synchronous: 'NORMAL' | 'FULL' };
  /**
   * Phase 7 (docs/phase3/performance.md): AGASTYA_SERVER_TIMING = admin (default: the Server-Timing database detail for administrators only,
   * the total for everyone), full (the detail for everyone, as the bench measures) or off (no header). AGASTYA_CSDB_LIST_TTL_MS = how long a
   * kept module listing is trusted for an edit made in place by hand, outside the platform, that does not change the folder (default 5000).
   */
  perf: { serverTiming: 'admin' | 'full' | 'off'; csdbListTtlMs: number };
}

function parseLogFormat(raw: string | undefined, nodeEnv: string | undefined): 'json' | 'text' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return nodeEnv === 'production' ? 'json' : 'text';
  if (v === 'json' || v === 'text') return v;
  throw new ConfigError('AGASTYA_LOG_FORMAT', `"${raw}" is not a log format: use "json" or "text".`);
}
function parseServerTiming(raw: string | undefined): 'admin' | 'full' | 'off' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return 'admin';
  if (v === 'admin' || v === 'full' || v === 'off') return v;
  throw new ConfigError('AGASTYA_SERVER_TIMING', `"${raw}" is not a Server-Timing mode: use "admin" (default), "full" or "off".`);
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

/** The directory connection (AGASTYA_DIRECTORY_*). The service account's password and the CA come from files, never from the environment. */
export interface DirectoryConfig {
  /** ldaps://host[:port], tried in order (a second domain controller is the fallback). */
  urls: string[];
  /** The service account that searches for people (AGASTYA_DIRECTORY_BIND_DN) and the file holding its password (AGASTYA_DIRECTORY_BIND_PASSWORD_FILE). */
  bindDn: string;
  bindPasswordFile: string;
  /** Where people are searched (AGASTYA_DIRECTORY_BASE_DN) and where nested groups are searched (AGASTYA_DIRECTORY_GROUP_BASE_DN, default the same). */
  baseDn: string;
  groupBaseDn: string;
  /** The attribute a person types as user name (AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE, default sAMAccountName) and the people's object class (AGASTYA_DIRECTORY_USER_CLASS, default user). */
  loginAttribute: string;
  userObjectClass: string;
  /** Follow nested groups with Active Directory's LDAP_MATCHING_RULE_IN_CHAIN (AGASTYA_DIRECTORY_NESTED_GROUPS=1); off = memberOf only. */
  nestedGroups: boolean;
  /** PEM file of the CA(s) the directory's certificate must chain to (AGASTYA_DIRECTORY_CA_FILE); unset = the Windows/Node trust store. */
  caFile: string | undefined;
  /** Connect and per-operation timeout (AGASTYA_DIRECTORY_TIMEOUT_MS, default 10000). */
  timeoutMs: number;
  /** How often the offboarding sync runs, in hours (AGASTYA_DIRECTORY_SYNC_HOURS, default 24, 0 = only on demand). */
  syncHours: number;
}

const ATTRIBUTE = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;

function parseDirectory(env: Env, mode: DeploymentMode): DirectoryConfig | null {
  const pick = (n: string): string | undefined => { const v = env[n]; return v === undefined || v.trim() === '' ? undefined : v.trim(); };
  const raw = pick('AGASTYA_DIRECTORY_URL');
  if (!raw) return null;
  if (mode !== 'server') {
    throw new ConfigError('AGASTYA_DIRECTORY_URL', 'directory sign-on is for Mode B (AGASTYA_MODE=server). Mode A serves one person on this computer with a local account.');
  }
  const urls = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const u of urls) {
    let parsed: URL | null = null;
    try { parsed = new URL(u); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'ldaps:' || !parsed.hostname || parsed.pathname.replace(/\/$/, '') !== '') {
      throw new ConfigError('AGASTYA_DIRECTORY_URL', `"${u}" is not an LDAPS address: use ldaps://host[:port] (636, or 3269 for the global catalogue). Plain ldap:// and StartTLS are not supported.`);
    }
  }
  const baseDn = pick('AGASTYA_DIRECTORY_BASE_DN');
  if (!baseDn) throw new ConfigError('AGASTYA_DIRECTORY_BASE_DN', 'is required with AGASTYA_DIRECTORY_URL: where people are searched, for example "OU=Staff,DC=corp,DC=local".');
  const bindDn = pick('AGASTYA_DIRECTORY_BIND_DN');
  const bindPasswordFile = pick('AGASTYA_DIRECTORY_BIND_PASSWORD_FILE');
  if (!bindDn) throw new ConfigError('AGASTYA_DIRECTORY_BIND_DN', 'is required with AGASTYA_DIRECTORY_URL: the service account that searches for people.');
  if (!bindPasswordFile) throw new ConfigError('AGASTYA_DIRECTORY_BIND_PASSWORD_FILE', 'is required with AGASTYA_DIRECTORY_BIND_DN: a file holding the service account\'s password (never the password itself).');
  const loginAttribute = pick('AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE') ?? 'sAMAccountName';
  if (!ATTRIBUTE.test(loginAttribute)) throw new ConfigError('AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE', `"${loginAttribute}" is not an attribute name.`);
  const userObjectClass = pick('AGASTYA_DIRECTORY_USER_CLASS') ?? 'user';
  if (!ATTRIBUTE.test(userObjectClass)) throw new ConfigError('AGASTYA_DIRECTORY_USER_CLASS', `"${userObjectClass}" is not an object class name.`);
  const nested = (pick('AGASTYA_DIRECTORY_NESTED_GROUPS') ?? '0').toLowerCase();
  if (!/^(0|1|true|false|on|off)$/.test(nested)) throw new ConfigError('AGASTYA_DIRECTORY_NESTED_GROUPS', `"${nested}" is not 0 or 1.`);
  return {
    urls, bindDn, bindPasswordFile, baseDn, groupBaseDn: pick('AGASTYA_DIRECTORY_GROUP_BASE_DN') ?? baseDn,
    loginAttribute, userObjectClass, nestedGroups: /^(1|true|on)$/.test(nested),
    caFile: pick('AGASTYA_DIRECTORY_CA_FILE'),
    timeoutMs: envPositive('AGASTYA_DIRECTORY_TIMEOUT_MS', 10000, env),
    syncHours: envCount('AGASTYA_DIRECTORY_SYNC_HOURS', 24, env),
  };
}

/**
 * WP-14: the job service. Every variable is optional; the defaults follow the audit (03 section 5, addendum 17 PRD-001).
 *   AGASTYA_JOBS                  "worker" (default) or "inline" (run in the server process: a diagnostic fallback, no isolation)
 *   AGASTYA_JOB_WORKERS           worker processes at most (default: cores - 1, at most validation + build slots, at least 1)
 *   AGASTYA_VALIDATION_SLOTS      validation / gate jobs at once, server-wide (default 2)
 *   AGASTYA_BUILD_SLOTS           publication builds at once, server-wide (default 2: two FOP slots)
 *   AGASTYA_JOB_TIMEOUT_MINUTES   deadline of one job (default 30); a job past it is killed with its process tree
 *   AGASTYA_WORKER_HEAP_MB        V8 heap of a worker (default 4096; WebAssembly memory of the schema validator is outside it)
 *   AGASTYA_FOP_HEAP_MB           -Xmx of the FOP JVM a worker starts (default 1536; 0 = the JVM's own default)
 *   AGASTYA_JOBS_PER_WORKER       a worker (and its JVM) is replaced after this many jobs (default 50)
 *   AGASTYA_WORKER_IDLE_MINUTES   an idle worker exits after this long (default 10)
 *   AGASTYA_PREWARM               phase 7: start one worker and its FOP JVM at server start, off the request path (default on)
 *   AGASTYA_JOB_OBJECT            "0" = do not put workers into a Windows job object (default on, Windows only)
 *   AGASTYA_JOB_PROCESS_MB        job object: memory limit of each process (default half the RAM, 1-8 GB)
 *   AGASTYA_JOB_MEMORY_MB         job object: memory limit of all workers and their tools together (default 75 % of the RAM)
 *   AGASTYA_JOB_CPU_PERCENT       job object: CPU rate cap of all workers together (default (cores - 1) / cores; 0 = no cap)
 *   AGASTYA_JOB_ACTIVE_PROCESSES  job object: processes at once (default 8 per worker)
 *   AGASTYA_VALIDATION_CACHE      "0" = never answer the Validation page from the stored run of unchanged content (default on)
 *   AGASTYA_JOB_KEEP_DAYS         finished job records are kept this long (default 30)
 *   AGASTYA_JOB_TEST_KINDS        "1" = the diagnostic job kinds the tests use (sleep, crash, allocate, spawn); never in production
 *   AGASTYA_JOB_WORKER            set by the pool for its own children: this process is a worker (no migrations, no listener)
 */
export interface JobsConfig {
  mode: 'worker' | 'inline';
  workers: number;
  validationSlots: number;
  buildSlots: number;
  timeoutMs: number;
  workerHeapMb: number;
  fopHeapMb: number;
  jobsPerWorker: number;
  idleMs: number;
  /** Phase 7: one worker (and its FOP JVM) is started at server start (AGASTYA_PREWARM). */
  prewarm: boolean;
  limits: { enabled: boolean; processMb: number; jobMb: number; cpuPercent: number; activeProcesses: number };
  validationCache: boolean;
  keepDays: number;
  testKinds: boolean;
  /** This process is a job worker. */
  worker: boolean;
  /** The environment a worker starts with: this one without secrets and without the variables that load code (the audit's "reduced environment"). */
  workerEnv: Record<string, string>;
}

/** Names a worker never inherits: secrets, and the variables that load code into Node or the JVM. */
const WORKER_ENV_DROP = /PASSWORD|PASSPHRASE|SECRET|TOKEN|COOKIE|CREDENTIAL|^NODE_OPTIONS$|^JAVA_TOOL_OPTIONS$|^_JAVA_OPTIONS$|^JDK_JAVA_OPTIONS$/i;

function parseJobs(env: Env): JobsConfig {
  const cores = Math.max(1, os.cpus().length);
  const ramMb = Math.floor(os.totalmem() / 1024 ** 2);
  const mode = (env.AGASTYA_JOBS ?? '').trim().toLowerCase();
  if (mode !== '' && mode !== 'worker' && mode !== 'inline') throw new ConfigError('AGASTYA_JOBS', `"${env.AGASTYA_JOBS}" is not a job mode: use "worker" (default) or "inline".`);
  const validationSlots = envPositive('AGASTYA_VALIDATION_SLOTS', 2, env);
  const buildSlots = envPositive('AGASTYA_BUILD_SLOTS', 2, env);
  const workers = envPositive('AGASTYA_JOB_WORKERS', Math.max(1, Math.min(cores - 1, validationSlots + buildSlots)), env);
  const workerEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !WORKER_ENV_DROP.test(k)) workerEnv[k] = v;
  workerEnv.AGASTYA_JOB_WORKER = '1';
  return {
    mode: mode === 'inline' ? 'inline' : 'worker',
    workers, validationSlots, buildSlots,
    timeoutMs: envPositive('AGASTYA_JOB_TIMEOUT_MINUTES', 30, env) * 60_000,
    workerHeapMb: envPositive('AGASTYA_WORKER_HEAP_MB', 4096, env),
    fopHeapMb: envCount('AGASTYA_FOP_HEAP_MB', 1536, env),
    jobsPerWorker: envPositive('AGASTYA_JOBS_PER_WORKER', 50, env),
    idleMs: envPositive('AGASTYA_WORKER_IDLE_MINUTES', 10, env) * 60_000,
    prewarm: parseOnOff('AGASTYA_PREWARM', env.AGASTYA_PREWARM, true),
    limits: {
      enabled: env.AGASTYA_JOB_OBJECT !== '0' && process.platform === 'win32',
      processMb: envPositive('AGASTYA_JOB_PROCESS_MB', Math.min(8192, Math.max(1024, Math.floor(ramMb / 2))), env),
      jobMb: envPositive('AGASTYA_JOB_MEMORY_MB', Math.max(1536, Math.floor(ramMb * 0.75)), env),
      cpuPercent: Math.min(100, envCount('AGASTYA_JOB_CPU_PERCENT', cores > 1 ? Math.floor(((cores - 1) / cores) * 100) : 0, env)),
      activeProcesses: envPositive('AGASTYA_JOB_ACTIVE_PROCESSES', workers * 8, env),
    },
    validationCache: env.AGASTYA_VALIDATION_CACHE !== '0',
    keepDays: envCount('AGASTYA_JOB_KEEP_DAYS', 30, env),
    testKinds: env.AGASTYA_JOB_TEST_KINDS === '1',
    worker: env.AGASTYA_JOB_WORKER === '1',
    workerEnv,
  };
}

export type DeploymentMode = 'local' | 'server';
/** P3-6: how the accounts of an installation begin (AGASTYA_DEPLOYMENT); see Config.deployment. */
export type AccountDeployment = 'standalone' | 'server';
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

/** WP-28: the warm-standby copy folder must be absolute (a relative path would depend on the service's working folder). */
function parseCopyDir(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (!path.isAbsolute(v)) throw new ConfigError('AGASTYA_BACKUP_COPY_DIR', `"${v}" is not an absolute folder path.`);
  return path.resolve(v);
}

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

/** P3-6: AGASTYA_DEPLOYMENT. Unset = `server` (no default accounts: the behaviour before P3-6). A standalone installation serves this computer only. */
function parseDeployment(raw: string | undefined, mode: DeploymentMode): AccountDeployment {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'server') return 'server';
  if (v === 'standalone') {
    if (mode !== 'local') {
      throw new ConfigError('AGASTYA_DEPLOYMENT', 'standalone is the single-computer installation (Mode A, loopback only) and has accounts with published default '
        + 'passwords: it cannot run as a network server (AGASTYA_MODE=server). Use AGASTYA_DEPLOYMENT=server for a common server.');
    }
    return 'standalone';
  }
  throw new ConfigError('AGASTYA_DEPLOYMENT', `"${raw}" is not an account deployment: use "standalone" (this computer, default accounts) or "server" (a common server, administrator created at first start).`);
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
      maxModuleBytes: envPositive('AGASTYA_MAX_MODULE_BYTES', 16 * 1024 ** 2, env),
    },
    workspaceLock: env.AGASTYA_NO_WORKSPACE_LOCK !== '1',
    baseHashCompat: env.AGASTYA_BASEHASH_COMPAT === '1',
    leaseMinutes: envPositive('AGASTYA_LEASE_MINUTES', 60, env),
    wsMaxClients: envPositive('AGASTYA_WS_MAX_CLIENTS', 1000, env),
    collab: {
      enabled: env.AGASTYA_COLLAB !== '0',
      maxUpdateBytes: envPositive('AGASTYA_COLLAB_MAX_UPDATE_BYTES', 2 * 1024 ** 2, env),
      writeBackMs: envPositive('AGASTYA_COLLAB_WRITEBACK_MS', 2000, env),
      writeBackMaxMs: envPositive('AGASTYA_COLLAB_WRITEBACK_MAX_MS', 10_000, env),
      revisionMinutes: envPositive('AGASTYA_COLLAB_REVISION_MINUTES', 10, env),
      idleUnloadMs: envPositive('AGASTYA_COLLAB_IDLE_MS', 60_000, env),
      maxRooms: envPositive('AGASTYA_COLLAB_MAX_ROOMS', 2000, env),
      persistMs: envPositive('AGASTYA_COLLAB_PERSIST_MS', 100, env),
    },
    shutdownOnStdinClose: env.AGASTYA_SHUTDOWN_ON_STDIN_CLOSE === '1',
    pdfjsDir: env.AGASTYA_PDFJS_DIR || undefined,
    initialAdmin: { INITIAL_ADMIN_USERNAME: env.INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD: env.INITIAL_ADMIN_PASSWORD },
    mode,
    deployment: parseDeployment(env.AGASTYA_DEPLOYMENT, mode),
    tls,
    serverNames: parseServerNames(env.AGASTYA_SERVER_NAMES),
    hstsMaxAge: parseHsts(env.AGASTYA_HSTS_MAX_AGE),
    shell: {
      webview2: /^\d{1,5}(\.\d{1,6}){1,3}$/.test(env.AGASTYA_WEBVIEW2_VERSION ?? '') ? String(env.AGASTYA_WEBVIEW2_VERSION) : null,
      window: env.AGASTYA_SHELL_WINDOW === 'app' || env.AGASTYA_SHELL_WINDOW === 'browser' ? env.AGASTYA_SHELL_WINDOW : null,
    },
    backup: {
      dir: env.AGASTYA_BACKUP_DIR || path.join(workspaceDir, 'backups', 'platform'),
      intervalHours: envCount('AGASTYA_BACKUP_INTERVAL_HOURS', 24, env),
      keep: parseKeep(env.AGASTYA_BACKUP_KEEP),
      keepMigrationSnapshots: envCount('AGASTYA_KEEP_MIGRATION_SNAPSHOTS', 5, env),
      restoreTestDays: envCount('AGASTYA_RESTORE_TEST_DAYS', 7, env),
      copyTo: parseCopyDir(env.AGASTYA_BACKUP_COPY_DIR),
    },
    retention: {
      sessionsDays: envCount('AGASTYA_RETENTION_SESSIONS_DAYS', 30, env),
      notificationsDays: envCount('AGASTYA_RETENTION_NOTIFICATIONS_DAYS', 90, env),
      resetRequestsDays: envCount('AGASTYA_RETENTION_RESET_REQUESTS_DAYS', 90, env),
      auditDays: envCount('AGASTYA_AUDIT_RETENTION_DAYS', 730, env),
    },
    jobs: parseJobs(env),
    database: { synchronous: String(env.AGASTYA_DB_SYNCHRONOUS ?? '').trim().toUpperCase() === 'FULL' ? 'FULL' : 'NORMAL' },
    perf: { serverTiming: parseServerTiming(env.AGASTYA_SERVER_TIMING), csdbListTtlMs: envCount('AGASTYA_CSDB_LIST_TTL_MS', 5000, env) },
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
    directory: parseDirectory(env, mode),
    gitlab: {
      secretsKeyFile: env.AGASTYA_SECRETS_KEY_FILE && env.AGASTYA_SECRETS_KEY_FILE.trim() ? path.resolve(env.AGASTYA_SECRETS_KEY_FILE.trim()) : path.join(workspaceDir, 'keys', 'secrets.key'),
      allowHttp: env.AGASTYA_GITLAB_ALLOW_HTTP === '1',
    },
  };
}

/** The effective configuration without secrets, for the start-up log and diagnostics. */
export function describeConfig(c: Config): Record<string, unknown> {
  const { initialAdmin, jobs, ...rest } = c;
  const { workerEnv, ...jobsRest } = jobs;
  return { ...rest, jobs: { ...jobsRest, workerEnv: `[${Object.keys(workerEnv).length} variables]` }, initialAdmin: initialAdmin.INITIAL_ADMIN_USERNAME ? { username: initialAdmin.INITIAL_ADMIN_USERNAME, password: '[set]' } : null };
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

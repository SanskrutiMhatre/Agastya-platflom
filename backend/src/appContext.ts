// =============================================================================
// AppContext - everything long-lived that one running platform needs, built from one Config (audit WP-10: PLT-028, PLT-031, PLT-027).
//
// `createAppContext(config)` builds the objects context.ts used to build at import: the workspace folders and house templates, the
// database handle, the AuthStore, sessions, the sign-in throttle, authorisation, the document index, revisions, the audit writer, and the
// seams that a server build or a test substitutes:
//
//   content      ContentStore      project files (default: local folders)
//   repos        Repositories      every SQL statement outside the AuthStore (default: SQLite)
//   sessionStore SessionStore      where sessions live (default: the AuthStore's tables)
//   limiterStore LimiterStore      where the per-account sign-in throttle lives (default: the AuthStore's table)
//   authProvider AuthProvider      who a person is (default: local accounts)
//
// Nothing is migrated by construction: `start()` takes the pre-migration snapshot and runs the additive migrations, so a migration error
// is an error of start(), which the caller can report. context.ts is the compatibility facade: it builds the process's default context
// from `config`, starts it at import exactly as before, and re-exports the same names, so the 74 modules that import it are unchanged.
// Two contexts on two workspaces can live in one process (test/wp10-seams.test.js does that).
// =============================================================================

import fs from 'fs';
import path from 'path';
import type { Config } from './config';
import { openSqlite, dbSynchronous, setSynchronous, type SqlDatabase } from './storage/sqlite';
import { checkOrder, inspectSchema, quickCheck, recordApplied, snapshotBeforePendingMigrations, type MigrationStep } from './storage/schema';
import { ORDER as MIGRATION_ORDER, forDialect } from './storage/migrations';
import { buildInfo } from './services/version';
import { LocalFolderStore, type ContentStore } from './storage/contentStore';
import type { LimiterStore, SessionStore } from './storage/authStores';
import { createSqliteRepositories, type Repositories } from './repositories';
import { currentRequest } from './services/requestContext';
import { HttpError } from './services/http';
import { raiseSecurityEvent, securityEventForAudit } from './services/securityEvents';
import { loadOrCreateKey } from './core/auth/auditChain';
import { createDirectory, createDirectoryAuthProvider } from './core/auth/directory';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
const { AuthStore } = require('./core/auth/store');
const { SessionService } = require('./core/auth/sessions');
const { RateLimiter } = require('./core/auth/rateLimit');
const { createSecurityPolicy } = require('./core/auth/securityPolicy');
const { createAuthz } = require('./core/auth/authz');
const { createLocalAuthProvider } = require('./core/auth/provider');
const { DocIndex } = require('./core/collab/docindex');
const { Revisions } = require('./core/collab/revisions');
/* eslint-enable */

const nowIso = (): string => new Date().toISOString();
/** The SQLite bodies of the migrations, as AuthStore.migrate runs them (the checksums are taken over these). */
const MIGRATION_STEPS: MigrationStep[] = forDialect('sqlite');

/** Who a person is (core/auth/provider.js). Roles, memberships and sessions stay in the platform. */
export interface AuthProvider {
  readonly kind: string;
  /** WP-27 adds two reasons a directory provider gives: the directory could not be reached, or no mapped group gives the person a role. */
  authenticate(c: { username: string; password: string }): Promise<{ ok: boolean; user?: AuthAccount; viaMaster?: boolean; reason?: 'unknown-user' | 'bad-password' | 'disabled' | 'directory-unavailable' | 'not-authorised'; detail?: string }>;
  /** The signed-in session for a Cookie header, or null; its shape is the session service's (core/auth/sessions.js). */
  resolveSession(cookieHeader: string): unknown;
  /** Creates or finds the local account for an external identity (a directory provider); the local provider throws. */
  provisionUser(external: unknown): unknown;
}

/** The account row the AuthStore returns (core/auth/store.js users table); the fields the login route reads, the rest passed through. */
export interface AuthAccount { id: string; username: string; role: string; password_hash: string; disabled_at?: string | null; [column: string]: unknown }

export interface AppContext {
  config: Config;
  workspaceDir: string;
  projectDirFor(id: string): string;
  /** The vendored workspace engine (project folders, names, copies). */
  workspace: any;
  db: SqlDatabase;
  /** The AuthStore: users, sessions, governance, audit (109 methods; deliberately not behind an interface yet). */
  store: any;
  repos: Repositories;
  /** Alias of repos.registry, under the name the services have always used. */
  registryDb: Repositories['registry'];
  content: ContentStore;
  sessionStore: SessionStore;
  limiterStore: LimiterStore;
  authProvider: AuthProvider;
  securityPolicy: any;
  sessionsSvc: any;
  limiter: any;
  authz: any;
  docIndex: any;
  revisions: any;
  audit(fields: Record<string, any>): void;
  /** WP-29: write the row or throw AuditUnavailableError (503) - for an action that must not happen unrecorded, audited before it acts. */
  auditStrict(fields: Record<string, any>): void;
  /** WP-29: run `fn` and write its audit row in ONE transaction; if the row cannot be written, the change is rolled back (503). */
  auditedTx<T>(fields: Record<string, any> | ((out: T) => Record<string, any> | null), fn: () => T): T;
  auditHealth(): AuditHealth;
  recordAuditVerification(r: { at: string; ok: boolean; summary: string }): void;
  /** WP-29: the audit chain key (read from config.audit.keyFile, made on first start). */
  auditKey(): { key: Buffer; id: string; file: string };
  /** Take the pre-migration snapshot and run the additive migrations. Idempotent. */
  start(): { snapshot: string | null };
  /** Checkpoint and close the database. */
  close(): void;
}

export interface AppContextOverrides {
  db?: SqlDatabase;
  content?: ContentStore;
  repos?: Repositories;
  sessionStore?: SessionStore;
  limiterStore?: LimiterStore;
  authProvider?: AuthProvider;
  /** The vendored workspace engine; tests may pass a stand-in. */
  workspace?: any;
}

/** The `revision` a house template declares, or null (a template without one is never replaced). */
function revisionOf(file: string): number | null {
  try { const r = JSON.parse(fs.readFileSync(file, 'utf8')).revision; return typeof r === 'number' ? r : null; } catch { return null; }
}
const newerRevision = (src: string, target: string): boolean => { const s = revisionOf(src); return s !== null && s > (revisionOf(target) ?? 0); };

/**
 * House templates are single files; brand packs (templates/brand/<id>/ with a logo beside brand.json) are folders. Both are copied only when
 * absent, so an organisation's edited copy is never overwritten by an update. Only a template that declares a `revision` is ever replaced, and
 * only by a higher one: the old copy is kept beside it. No template that existed before this mechanism declares one, so none of them is touched.
 */
export function seedTemplates(seedDir: string, dest: string): void {
  if (!fs.existsSync(seedDir)) return;
  const seed = (from: string, to: string): void => {
    for (const f of fs.readdirSync(from)) {
      const src = path.join(from, f);
      const target = path.join(to, f);
      if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        seed(src, target);
      } else if (!fs.existsSync(target)) {
        fs.copyFileSync(src, target);
      } else if (newerRevision(src, target)) {
        fs.copyFileSync(target, `${target}.rev${revisionOf(target) ?? 0}.bak`);
        fs.copyFileSync(src, target);
      }
    }
  };
  seed(seedDir, dest);
}

/*
  Append-only audit (WP-03, SEC-012, ENT-011).

  Redaction is by explicit field name and by value shape, not by "any key containing hash": the former filter dropped
  contentHash and every other fingerprint a release record needs. A field is removed when its name (case, "_" and "-"
  ignored) is one of SECRET_KEYS, or when its value looks like a password hash or a session cookie.

  Every row gets the client address of the request it belongs to (requestContext), when the caller did not give one.

  A failing write still never breaks the operation it describes (the operation's own database write has usually
  succeeded by then, and refusing it afterwards would be worse), but it is no longer only a console line: it is counted,
  appended to workspace/logs/audit-failures.log, and shown to administrators (auditHealth(), GET /api/admin/health).
*/
const SECRET_KEYS = new Set(['password', 'newpassword', 'currentpassword', 'oldpassword', 'temppassword', 'passwordhash', 'masterpassword',
  'token', 'tokenhash', 'sessiontoken', 'resettoken', 'cookie', 'setcookie', 'secret', 'clientsecret', 'credential', 'credentials', 'apikey', 'authorization']);
const SECRET_VALUE = /^\$(argon2(id|i|d)?|2[aby]?|scrypt)\$|agastya_session=/i;
export function redactAuditMeta(meta: unknown): unknown {
  if (meta == null) return null;
  return JSON.parse(JSON.stringify(meta, (k, v) => {
    if (k && SECRET_KEYS.has(k.toLowerCase().replace(/[_-]/g, ''))) return undefined;
    if (typeof v === 'string' && SECRET_VALUE.test(v)) return '[redacted]';
    return v;
  }));
}

/**
 * WP-29 (ENT-003, G-REL-8, AU-5): the failure classes. An ordinary action whose audit row cannot be written still goes ahead (its own write
 * has usually happened already), but the failure is counted, logged, written to audit-failures.log, raised as Application-log event 4100
 * and shown to administrators. A CRITICAL action (sign-in, role and membership changes, release decisions, restore) uses auditedTx /
 * auditStrict instead: the change and its audit row are one transaction, so the change does not happen without its row (503 AUDIT_UNAVAILABLE).
 */
export class AuditUnavailableError extends HttpError {
  constructor(action: string) {
    super(503, 'The action was not carried out because the audit log could not record it. Try again; if it keeps happening, tell the administrator (Security page).', 'AUDIT_UNAVAILABLE', { action });
  }
}

type AuditApi = Pick<AppContext, 'audit' | 'auditHealth' | 'auditStrict' | 'auditedTx' | 'recordAuditVerification'>;
function createAudit(store: { appendAudit(row: Record<string, unknown>): unknown; tx<T>(fn: () => T): T }, workspaceDir: string): AuditApi {
  const failures = { count: 0, last: null as null | { at: string; action: string; error: string } };
  let lastVerify: AuditHealth['lastVerification'] = null;
  const rowOf = (fields: Record<string, unknown>): Record<string, unknown> =>
    ({ at: nowIso(), ...fields, ip: fields.ip || currentRequest()?.ip || null, meta: redactAuditMeta(fields.meta) });
  const failed = (fields: Record<string, unknown>, e: unknown, critical: boolean): void => {
    failures.count++;
    failures.last = { at: nowIso(), action: String(fields.action ?? ''), error: (e as Error).message };
    console.error(`[audit] write failed (${critical ? 'the action was refused' : 'operation unaffected'}):`, (e as Error).message);
    try {
      const dir = path.join(workspaceDir, 'logs'); fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'audit-failures.log'), `${JSON.stringify({ ...failures.last, critical, actor: fields.actorUsername ?? null, ip: currentRequest()?.ip ?? null })}\n`);
    } catch { /* the counter still shows it */ }
    raiseSecurityEvent('AUDIT_WRITE_FAILED', `The audit log could not record "${String(fields.action ?? '')}" by ${String(fields.actorUsername ?? 'unknown')}: ${(e as Error).message}. ${critical ? 'The action was refused.' : 'The action went ahead without its audit row.'}`);
  };
  const written = (row: Record<string, unknown>): void => { try { securityEventForAudit(row); } catch { /* events never break an action */ } };
  const strict = (fields: Record<string, unknown>): Record<string, unknown> => {
    const row = rowOf(fields);
    try { store.appendAudit(row); } catch (e) { failed(fields, e, true); throw new AuditUnavailableError(String(fields.action ?? '')); }
    return row;
  };
  return {
    auditHealth: () => ({ failures: failures.count, last: failures.last, lastVerification: lastVerify }),
    recordAuditVerification: (r) => { lastVerify = { at: r.at, ok: r.ok, summary: r.summary }; },
    audit(fields: Record<string, any>): void {
      let row: Record<string, unknown>;
      try { row = rowOf(fields); store.appendAudit(row); } catch (e) { failed(fields, e, false); return; }
      written(row);
    },
    auditStrict(fields: Record<string, any>): void { written(strict(fields)); },
    auditedTx<T>(fields: Record<string, any> | ((out: T) => Record<string, any> | null), fn: () => T): T {
      let row: Record<string, unknown> | null = null;
      const out = store.tx(() => {
        const r = fn();
        const f = typeof fields === 'function' ? fields(r) : fields;
        if (f) row = strict(f);
        return r;
      });
      if (row) written(row);
      return out;
    },
  };
}

export interface AuditHealth {
  failures: number;
  last: null | { at: string; action: string; error: string };
  /** The last chain verification this process ran (WP-29), or null. */
  lastVerification: null | { at: string; ok: boolean; summary: string };
}

export function createAppContext(config: Config, o: AppContextOverrides = {}): AppContext {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wsEngine = o.workspace ?? require(path.join(config.vendorDir, 'engine', 'workspace'));
  const workspaceDir = config.workspaceDir;
  const projectDirFor = (id: string): string => wsEngine.projectDir(workspaceDir, id);

  // Workspace skeleton + house templates, before the database opens.
  wsEngine.ensureWorkspace(workspaceDir);
  seedTemplates(config.seedTemplatesDir, wsEngine.templatesDir(workspaceDir));

  const db = o.db ?? openSqlite(workspaceDir);
  const store = new AuthStore(db);
  // WP-29: the chain key, outside the database. Made on the first start; an unreadable or damaged key file stops the start (a silent new key
  // would make every earlier row unverifiable).
  const chainKey = loadOrCreateKey(config.audit.keyFile) as { key: Buffer; id: string; file: string };
  store.setAuditKey(chainKey);
  const repos = o.repos ?? createSqliteRepositories(db);
  const sessionStore: SessionStore = o.sessionStore ?? store;
  const limiterStore: LimiterStore = o.limiterStore ?? store;
  const securityPolicy = createSecurityPolicy(store, nowIso);
  const sessionsSvc = new SessionService(sessionStore, { secureCookies: config.secureCookies, policy: securityPolicy });
  const limiter = new RateLimiter({ store: limiterStore });
  // WP-27: group grants and capability rules are read by every project decision.
  const authz = createAuthz({ store, sessions: sessionsSvc, workspaceDir, projectDirFor, access: repos.access });
  const auditWriter = createAudit(store, workspaceDir);
  const localProvider: AuthProvider = createLocalAuthProvider({ store, sessions: sessionsSvc });
  // WP-27 (ENT-005): Mode B with AGASTYA_DIRECTORY_URL signs directory users in over LDAPS; local accounts (and the break-glass
  // administrator) keep signing in locally. Without a directory the local provider is the only one, exactly as before.
  const authProvider: AuthProvider = o.authProvider ?? (config.directory
    ? createDirectoryAuthProvider({ store, access: repos.access, sessions: sessionsSvc, local: localProvider, directory: createDirectory(config.directory), audit: auditWriter.audit })
    : localProvider);
  let started = false;
  let snapshot: string | null = null;

  return {
    config, workspaceDir, projectDirFor, workspace: wsEngine, db, store, repos, registryDb: repos.registry,
    content: o.content ?? new LocalFolderStore(projectDirFor),
    sessionStore, limiterStore, authProvider, securityPolicy, sessionsSvc, limiter, authz,
    docIndex: new DocIndex(store),
    revisions: new Revisions(store),
    auditKey: () => chainKey,
    ...auditWriter,
    start() {
      if (started) return { snapshot };
      /**
       * WP-12 (PLT-006, PLT-011, DEP-002, ENT-013, PLT-013), in this order, all before anything is written:
       *   the migration list is well formed; the file passes quick_check; the database is not from a newer build and no applied migration
       *   was edited (refused with a SchemaError naming the cause); then ONE verified copy before the first pending migration of any number
       *   (the old code protected 016 only) - if the copy cannot be made, nothing is migrated. A fresh database has nothing to protect.
       * Then the additive migrations run, and their checksums, the program version and PRAGMA user_version are recorded.
       */
      checkOrder(MIGRATION_ORDER);
      const qc0 = Date.now();
      quickCheck(db);
      console.log(`[db] quick_check: ok (${Date.now() - qc0} ms)`);           // WP-17 (PERF-009): the boot check is stated in the log
      const state = inspectSchema(db, MIGRATION_STEPS);
      snapshot = snapshotBeforePendingMigrations(db, workspaceDir, state, nowIso(), config.backup.keepMigrationSnapshots);
      if (snapshot) console.log(`[migration] database copy before ${state.pending[0]}: ${snapshot}`);
      // WP-17 (D14): migrations run with every commit synced (FULL); the working level (NORMAL unless AGASTYA_DB_SYNCHRONOUS=FULL) after them
      setSynchronous(db, 'FULL');
      try {
        store.migrate(nowIso()); // additive migrations only
        recordApplied(db, MIGRATION_STEPS, buildInfo().version);
      } finally { setSynchronous(db, dbSynchronous()); }
      started = true;
      return { snapshot };
    },
    close() { repos.registry.close(); },
  };
}

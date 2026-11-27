// =============================================================================
// Context - the one place the long-lived services are constructed and wired.
//
// Mirrors the wiring block in JSS Publisher's server.js (registry -> auth store
// -> sessions -> authz), minus the collaboration server and approval queues
// that this platform does not carry. Everything else imports from here rather
// than constructing its own store, so there is exactly one SQLite handle and
// exactly one authorisation service.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { config, nowIso, vendor } from './config';
import { snapshotBeforeMigration } from './services/dbSnapshot';
import { currentRequest } from './services/requestContext';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
const { AuthStore } = require('./core/auth/store');
const { SessionService } = require('./core/auth/sessions');
const { RateLimiter } = require('./core/auth/rateLimit');
const { createSecurityPolicy } = require('./core/auth/securityPolicy');
const { createAuthz } = require('./core/auth/authz');
const { DocIndex } = require('./core/collab/docindex');
const { Revisions } = require('./core/collab/revisions');
const registry = vendor('engine/db');
const wsEngine = vendor('engine/workspace');
/* eslint-enable */

export const workspaceDir = config.workspaceDir;
export const projectDirFor = (id: string): string => wsEngine.projectDir(workspaceDir, id);

// Workspace skeleton + house templates, before the database opens.
wsEngine.ensureWorkspace(workspaceDir);
seedTemplates();

/** The `revision` a house template declares, or null (a template without one is never replaced). */
function revisionOf(file: string): number | null {
  try { const r = JSON.parse(fs.readFileSync(file, 'utf8')).revision; return typeof r === 'number' ? r : null; } catch { return null; }
}
// function declarations, not consts: seedTemplates() below runs while this module is still loading
function newerRevision(src: string, target: string): boolean { const s = revisionOf(src); return s !== null && s > (revisionOf(target) ?? 0); }

function seedTemplates(): void {
  const dest = wsEngine.templatesDir(workspaceDir);
  if (!fs.existsSync(config.seedTemplatesDir)) return;
  // House templates are single files; brand packs (templates/brand/<id>/ with a
  // logo beside brand.json) are folders. Both are copied only when absent, so an
  // organisation's edited copy is never overwritten by an update.
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
        // Only a template that declares a `revision` is ever replaced, and only by a higher one: the old copy is kept beside it. No template that existed
        // before this mechanism declares one, so none of them is touched.
        fs.copyFileSync(target, `${target}.rev${revisionOf(target) ?? 0}.bak`);
        fs.copyFileSync(src, target);
      }
    }
  };
  seed(config.seedTemplatesDir, dest);
}

const sqlite: any = registry.open(workspaceDir);
export const store: any = new AuthStore(sqlite);

/**
 * Before the S1000D reference-configuration migration (016) first runs on a database that already holds projects, keep a consistent copy of it
 * (VACUUM INTO) in workspace/backups/. Manual rollback is documented in docs/S1000D_REFERENCE_CONFIG.md. A fresh database has nothing to protect.
 */
const preMigrationSnapshot = snapshotBeforeMigration(sqlite, workspaceDir, '016-s1000d-reference', nowIso());
if (preMigrationSnapshot) console.log(`[migration] database copy before 016-s1000d-reference: ${preMigrationSnapshot}`);
store.migrate(nowIso()); // additive migrations only

export const securityPolicy: any = createSecurityPolicy(store, nowIso);
export const sessionsSvc: any = new SessionService(store, { secureCookies: config.secureCookies, policy: securityPolicy });
export const limiter: any = new RateLimiter({ store });
export const authz: any = createAuthz({ store, sessions: sessionsSvc, workspaceDir, projectDirFor });
export const docIndex: any = new DocIndex(store);
export const revisions: any = new Revisions(store);
export const registryDb: any = registry;
export const workspace: any = wsEngine;

export const { requireAuth, requireAdmin, requireRoles, requireProject, publicRoute } = authz as {
  requireAuth: (o?: any) => any; requireAdmin: () => any; requireRoles: (...roles: string[]) => any;
  requireProject: (minRole: string, o?: any) => any; publicRoute: (reason: string) => any;
};

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
const auditFailures = { count: 0, last: null as null | { at: string; action: string; error: string } };
export const auditHealth = (): { failures: number; last: typeof auditFailures.last } => ({ failures: auditFailures.count, last: auditFailures.last });
export function audit(fields: Record<string, any>): void {
  try {
    const meta = redactAuditMeta(fields.meta);
    store.appendAudit({ at: nowIso(), ...fields, ip: fields.ip || currentRequest()?.ip || null, meta });
  } catch (e) {
    auditFailures.count++;
    auditFailures.last = { at: nowIso(), action: String(fields.action ?? ''), error: (e as Error).message };
    console.error('[audit] write failed (operation unaffected):', (e as Error).message);
    try {
      const dir = path.join(workspaceDir, 'logs'); fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'audit-failures.log'), `${JSON.stringify({ ...auditFailures.last, actor: fields.actorUsername ?? null, ip: currentRequest()?.ip ?? null })}\n`);
    } catch { /* the counter still shows it */ }
  }
}

/** The client's address: Express's req.ip, which honours the trust-proxy setting (config.trustProxy, SEC-008); the socket peer otherwise. */
export const clientIp = (req: { ip?: string; socket?: { remoteAddress?: string } }): string =>
  String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');

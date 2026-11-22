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

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
const { AuthStore } = require('./core/auth/store');
const { SessionService } = require('./core/auth/sessions');
const { RateLimiter } = require('./core/auth/rateLimit');
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

export const sessionsSvc: any = new SessionService(store, { secureCookies: config.secureCookies });
export const limiter: any = new RateLimiter();
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
  Append-only audit. Metadata is stripped of anything that looks like a secret
  so no password, hash or token can land in a row even by accident, and a
  failing audit write never breaks the operation it describes.
*/
export function audit(fields: Record<string, any>): void {
  try {
    const meta = fields.meta == null ? null
      : JSON.parse(JSON.stringify(fields.meta, (k, v) =>
        /password|hash|token|secret|cookie|credential/i.test(k) ? undefined : v));
    store.appendAudit({ at: nowIso(), ...fields, meta });
  } catch (e) {
    console.error('[audit] write failed (operation unaffected):', (e as Error).message);
  }
}

export const clientIp = (req: { socket?: { remoteAddress?: string } }): string =>
  (req.socket && req.socket.remoteAddress) || '';

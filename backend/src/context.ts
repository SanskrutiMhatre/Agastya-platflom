// =============================================================================
// Context - the compatibility facade over this process's default AppContext (audit WP-10, PLT-028).
//
// The long-lived services are built by createAppContext (appContext.ts) from the one typed Config. This module builds the process's
// default context from `config`, starts it (snapshot + additive migrations) at import exactly as it always did, and re-exports the same
// names, so every module that imports from here is unchanged. New code and code that must be substituted in a test or a server build
// takes an AppContext instead (`defaultContext()` here, or its own from createAppContext).
// =============================================================================

import { config } from './config';
import { createAppContext, redactAuditMeta, type AppContext } from './appContext';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ctx: AppContext = createAppContext(config);
try {
  ctx.start();
} catch (e) {
  // WP-12: a refused database (newer build, edited migration, damaged file, no safety copy) stops the process with the operator's message on top.
  console.error(`\n[start] ${(e as Error).message}\n`);
  throw e;
}

/** The process's default application context. */
export const defaultContext = (): AppContext => ctx;

export const workspaceDir = ctx.workspaceDir;
export const projectDirFor = ctx.projectDirFor;
export const store = ctx.store;
export const repos = ctx.repos;
export const content = ctx.content;
export const authProvider = ctx.authProvider;
export const securityPolicy = ctx.securityPolicy;
export const sessionsSvc = ctx.sessionsSvc;
export const limiter = ctx.limiter;
export const authz = ctx.authz;
export const docIndex = ctx.docIndex;
export const revisions = ctx.revisions;
export const registryDb = ctx.registryDb;
export const workspace = ctx.workspace;

export const { requireAuth, requireAdmin, requireRoles, requireProject, publicRoute } = ctx.authz as {
  requireAuth: (o?: any) => any; requireAdmin: () => any; requireRoles: (...roles: string[]) => any;
  requireProject: (minRole: string, o?: any) => any; publicRoute: (reason: string) => any;
};

export { redactAuditMeta };
export const auditHealth = ctx.auditHealth;
export const audit = ctx.audit;

/** The client's address: Express's req.ip, which honours the trust-proxy setting (config.trustProxy, SEC-008); the socket peer otherwise. */
export const clientIp = (req: { ip?: string; socket?: { remoteAddress?: string } }): string =>
  String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');

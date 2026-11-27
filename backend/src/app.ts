// =============================================================================
// The Express application.
// =============================================================================

import express from 'express';
import fs from 'fs';
import path from 'path';
import { config, nowIso } from './config';
import { dbBusy, diskFull } from './services/http';
import { store, sessionsSvc, authz, audit, limiter, docIndex, projectDirFor, publicRoute, clientIp, securityPolicy, auditHealth, authProvider, defaultContext } from './context';
import { readiness } from './services/readiness';
import { requestContextMiddleware } from './services/requestContext';
import { securityHeaders } from './services/securityHeaders';
import { compressResponses, clientStatic, STUDIO_SCHEMA_SETS } from './services/delivery';
import { originAllowed } from './services/origin';
import { registerWorkspaceRoutes } from './routes/workspace';
import { registerProjectContentRoutes } from './routes/project-content';
import { registerTeamRoutes } from './routes/team';
import { registerAdminRoutes } from './routes/admin';
import { registerCirRoutes } from './routes/cir';
import { registerS1000dRoutes } from './routes/s1000d';
import { bootReference } from './services/bootReference';
import { registerGraphicsRoutes } from './routes/graphics';
import { registerPackageRoutes } from './routes/packages';
import { registerLifecycleRoutes } from './routes/lifecycle';
import { registerExtensionRoutes } from './routes/extensions';
import { registerImporterRoutes } from './routes/importer';
import { registerJssGuard } from './routes/jss-guard';
import { registerSnsRoutes } from './routes/sns';
import { registerJssdmRoutes } from './routes/jssdm';
import { registerJssRoutes } from './routes/jss';
import { registerJsgRoutes } from './routes/jsg';
import './services/jss/service';      // registers the JSS document creator (services/documentCreators.ts, WP-10)
import './services/jsg/service';      // registers the JSG document creator
import { registerJssRwiRoutes } from './routes/jss-rwi';
import { registerIdentityRoutes } from './routes/identity';
import { registerXengineRoutes } from './routes/xengine';
import { registerWaiverRoutes } from './routes/waivers';
import { registerBrandRoutes } from './routes/brand';
import { registerBackupRoutes } from './routes/backups';
import { notifyAccess } from './services/access-notify';
import { API_VERSION, MIN_CLIENT_VERSION, CLIENT_VERSION_HEADER, buildInfo, clientAccepted, schemaLevel } from './services/version';
import { hostAllowed, MISDIRECTED } from './services/network';
import { capabilityTableFrom, readOnlyCapabilitiesFrom, setCapabilityTable } from './services/permissions';
import { registerAccessRoutes } from './routes/access';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerAuthRoutes } = require('./core/auth/routes');
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { MIGRATIONS } from './core/auth/store';

export function createApp(): express.Express {
  // S1000D reference catalogues, SNS presets, carry-over of the retired flat tables, and a configuration for every existing project (idempotent).
  try { const r = bootReference(); if (r.backfill.created) console.log(`[s1000d] configuration derived for ${r.backfill.created} existing project(s)`); } catch (e) { console.error('[s1000d] reference start-up failed:', (e as Error).stack); throw e; }
  const app = express();
  // Which proxy may tell us the client's address and scheme (config.trustProxy, SEC-008): by default one on this machine only, so req.secure
  // (the Secure cookie flag) is right behind a local TLS-terminating proxy and no client can choose its own address.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requestContextMiddleware(clientIp));   // every audit row gets the client address; a 500 answers with this request's id (WP-03)
  app.use(securityHeaders);                      // CSP, nosniff, framing, referrer (ENT-012, FE-017); HSTS on TLS in Mode B (WP-26)
  // WP-26: the Host must name this server (DNS rebinding); the same rule guards the WebSocket upgrade (services/broadcast.ts).
  app.use((req, res, next) => {
    if (hostAllowed(req.headers.host)) return next();
    res.status(421).json({ error: MISDIRECTED, code: 'MISDIRECTED_REQUEST' });
  });
  // WP-26: the version handshake, enforced on the server as well: a client older than MIN_CLIENT_VERSION (a page cached from before an upgrade)
  // gets 426 and reloads; the version routes themselves always answer, so it can learn what to do.
  app.use('/api', (req, res, next) => {
    const v = req.headers[CLIENT_VERSION_HEADER];
    if (clientAccepted(typeof v === 'string' ? v : undefined) || /^\/(version|health|ready)$/.test(req.path)) return next();
    res.status(426).json({ error: 'This page is older than the server. Reload it to continue.', code: 'CLIENT_TOO_OLD', minClientVersion: MIN_CLIENT_VERSION, version: buildInfo().version });
  });
  app.use(compressResponses);                    // gzip for JSON / text answers of 1 KB or more (WP-18: PERF-016)
  app.use(express.json({ limit: '25mb' }));

  /*
    Cross-origin write refusal (defence in depth on top of SameSite=Lax): a
    state-changing request from a browser page on a different origin is refused.
    Non-browser clients send no Origin and cannot carry a victim's cookie.
    In development the Vite proxy forwards the browser's Origin, so the dev
    server's own origin is allowed explicitly.
  */
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (originAllowed(req.headers.origin, req.headers.host)) return next();
    return res.status(403).json({ error: 'Cross-origin request refused.' });
  });

  app.get('/api/health', publicRoute('Liveness probe: reveals only that the server is up.'),
    (_req, res) => { res.json({ status: 'ok', version: buildInfo().version, time: nowIso() }); });
  // WP-10 (PLT-031): readiness, for a monitor in front of a server: the database answers, the data folder is writable, disk is above the floor.
  app.get('/api/ready', publicRoute('Readiness probe: reveals only which of three checks (database, data folder, disk) pass.'),
    (_req, res) => { const r = readiness(defaultContext()); res.status(r.ready ? 200 : 503).json({ status: r.ready ? 'ready' : 'not-ready', checks: r.checks }); });
  // Version identity (WP-13, DEP-004): read by the installer's verification and by a client before it signs in (compatibility handshake).
  app.get('/api/version', publicRoute('Version handshake: product version, API level and database schema level; no user data.'), (_req, res) => {
    const b = buildInfo(); const schema = schemaLevel(defaultContext().repos.appliedMigrations(), MIGRATIONS);
    res.json({
      product: 'Agastya Platform', version: b.version, apiVersion: API_VERSION, minClientVersion: MIN_CLIENT_VERSION,
      schema: { level: schema.level, latest: schema.latest, applied: schema.applied, compatible: schema.unknown.length === 0 },
      build: { commit: b.commit, builtAt: b.builtAt, packaged: b.packaged },
    });
  });

  registerAuthRoutes({
    app, store, sessionsSvc, authz, audit, limiter, nowIso, projectDirFor, docIndex,
    // This platform has no live-collaboration rooms; the admin routes that close them still call this.
    collab: { closeDocumentConnectionsForUser: () => undefined },
    onProjectDecided: () => undefined,
    onAccess: notifyAccess,
    securityPolicy, auditHealth, authProvider,
  });
  registerJssGuard(app);                 // before every S1000D-side writer: a JSS document project's publication.xml is never replaced by them
  registerWorkspaceRoutes(app);
  registerProjectContentRoutes(app);
  registerTeamRoutes(app);
  registerAdminRoutes(app);
  registerCirRoutes(app);
  registerS1000dRoutes(app);
  registerGraphicsRoutes(app);
  registerPackageRoutes(app);
  registerLifecycleRoutes(app);
  registerExtensionRoutes(app);
  registerImporterRoutes(app);
  registerSnsRoutes(app);
  registerJssdmRoutes(app);
  registerJssRoutes(app);
  registerJsgRoutes(app);
  registerJssRwiRoutes(app);
  registerIdentityRoutes(app);
  registerXengineRoutes(app);
  registerWaiverRoutes(app);
  registerBrandRoutes(app);
  registerBackupRoutes(app);             // WP-12: platform backup, verify, copy, restore into a new folder (administrators)
  registerAccessRoutes(app);             // WP-27: directory sign-on administration, groups, project group grants and capability rules
  // The client's `can` map is read from the guards just registered (WP-13, FE-019): one rule, stated once, on the server.
  setCapabilityTable(capabilityTableFrom(app), readOnlyCapabilitiesFrom(app));

  // Unknown API paths are JSON 404s, never the SPA shell.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

  // One copy of the S1000D schemas (WP-18, FE-032): the Studio's in-browser check reads /schemas/<issue>/ from the server's own sets, so the
  // browser and the server validate against the same files. Issue 4.1 and the shared entity files still ship with the client (their copies differ).
  for (const [web, dir] of Object.entries(STUDIO_SCHEMA_SETS)) app.use(`/schemas/${web}`, clientStatic(path.join(config.schemasDir, dir)));

  // The built client, when present: one process serves the UI and the API.
  const index = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(index)) {
    // hashed assets immutable, index.html no-cache, text files compressed once and kept (WP-18: FE-027)
    app.use(clientStatic(config.clientDist));
    app.get(/^\/(?!api\/|ws).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(index); });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const full = diskFull(err);
    if (full) { console.error('[api] disk full:', err.message); return void res.status(full.status).json({ error: full.message, code: full.code }); }
    const busy = dbBusy(err);
    if (busy) { res.setHeader('Retry-After', '3'); return void res.status(busy.status).json({ error: busy.message, code: busy.code }); }
    // body-parser and friends set a 4xx status on their own errors (a malformed JSON body is the client's mistake, not a 500)
    const status = Number((err as any).status ?? (err as any).statusCode);
    if (status >= 400 && status < 500) return void res.status(status).json({ error: status === 413 ? 'The request is too large.' : 'The request could not be read.', code: status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST' });
    const id = (req as any).requestId ?? '-';
    console.error(`[api] ${id} unhandled:`, err.stack ?? err);
    res.status(500).json({ error: 'Something went wrong on the server. If it happens again, give the administrator this reference.', code: 'INTERNAL', id });
  });
  return app;
}

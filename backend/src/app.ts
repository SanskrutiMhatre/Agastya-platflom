// =============================================================================
// The Express application.
// =============================================================================

import express from 'express';
import fs from 'fs';
import path from 'path';
import { config, nowIso } from './config';
import { diskFull } from './services/http';
import { store, sessionsSvc, authz, audit, limiter, docIndex, projectDirFor, publicRoute } from './context';
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
import { registerSnsRoutes } from './routes/sns';
import { registerJssdmRoutes } from './routes/jssdm';
import { registerWaiverRoutes } from './routes/waivers';
import { registerBrandRoutes } from './routes/brand';
import { notifyAccess } from './services/access-notify';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerAuthRoutes } = require('./core/auth/routes');

export function createApp(): express.Express {
  // S1000D reference catalogues, SNS presets, carry-over of the retired flat tables, and a configuration for every existing project (idempotent).
  try { const r = bootReference(); if (r.backfill.created) console.log(`[s1000d] configuration derived for ${r.backfill.created} existing project(s)`); } catch (e) { console.error('[s1000d] reference start-up failed:', (e as Error).stack); throw e; }
  const app = express();
  // Trust exactly one proxy hop (a TLS-terminating reverse proxy), so req.secure - and therefore the Secure cookie flag - is right behind it.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  /*
    Cross-origin write refusal (defence in depth on top of SameSite=Lax): a
    state-changing request from a browser page on a different origin is refused.
    Non-browser clients send no Origin and cannot carry a victim's cookie.
    In development the Vite proxy forwards the browser's Origin, so the dev
    server's own origin is allowed explicitly.
  */
  const devOrigins = new Set((process.env.AGASTYA_DEV_ORIGINS ?? 'http://localhost:5174').split(',').map((s) => s.trim()).filter(Boolean));
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    let host: string | null = null;
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host && (host === req.headers.host || devOrigins.has(origin))) return next();
    return res.status(403).json({ error: 'Cross-origin request refused.' });
  });

  app.get('/api/health', publicRoute('Liveness probe: reveals only that the server is up.'),
    (_req, res) => { res.json({ status: 'ok', version: '2.0.0', time: nowIso() }); });

  registerAuthRoutes({
    app, store, sessionsSvc, authz, audit, limiter, nowIso, projectDirFor, docIndex,
    // This platform has no live-collaboration rooms; the admin routes that close them still call this.
    collab: { closeDocumentConnectionsForUser: () => undefined },
    onProjectDecided: () => undefined,
    onAccess: notifyAccess,
  });
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
  registerWaiverRoutes(app);
  registerBrandRoutes(app);

  // Unknown API paths are JSON 404s, never the SPA shell.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

  // The built client, when present: one process serves the UI and the API.
  const index = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(config.clientDist, {
      setHeaders: (res, file) => { if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); },
    }));
    app.get(/^\/(?!api\/|ws).*/, (_req, res) => { res.sendFile(index); });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const full = diskFull(err);
    if (full) { console.error('[api] disk full:', err.message); return void res.status(full.status).json({ error: full.message, code: full.code }); }
    console.error('[api] unhandled:', err.stack ?? err);
    res.status(500).json({ error: 'Internal error' });
  });
  return app;
}

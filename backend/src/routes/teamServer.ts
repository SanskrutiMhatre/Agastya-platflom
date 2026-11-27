// =============================================================================
// Team server routes (audit WP-28: Mode B multi-user operation; PRD-003 presence and lock visibility; G-PERF-4 load figures).
//
//   GET  /api/projects/:id/presence     anyone who can see the project: who is in it now (memory only, services/presence.ts) and the live
//                                       check-outs with the document path (services/leases.ts) - one call for the Home card and the editors
//   GET  /api/admin/metrics             administrators: event-loop delay, statement time and slow statements, request p50/p95/p99,
//                                       WebSocket connections, presence entries, and the deployment facts an operator checks first
//   POST /api/admin/metrics/reset       administrators: start a new measuring window (audited)
// =============================================================================

import type { Express, Request } from 'express';
import { audit, requireAdmin, requireProject } from '../context';
import { config } from '../config';
import { wrap } from '../services/http';
import { listProject, PRESENCE_HEARTBEAT_MS, PRESENCE_TTL_MS } from '../services/presence';
import { projectLeases } from '../services/leases';
import { reset, snapshot } from '../services/metrics';
import { MAX_SOCKETS_PER_SESSION } from '../services/broadcast';
import { buildInfo } from '../services/version';

export function registerTeamServerRoutes(app: Express): void {
  app.get('/api/projects/:id/presence', requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    const me = req.auth.user.id as string;
    res.json({ people: listProject(req.project.id, me), leases: projectLeases(req.project.id, me), heartbeatMs: PRESENCE_HEARTBEAT_MS, ttlMs: PRESENCE_TTL_MS });
  }));

  app.get('/api/admin/metrics', requireAdmin(), wrap((_req, res) => {
    res.json({
      ...snapshot(),
      server: {
        version: buildInfo().version, mode: config.mode, tls: !!config.tls, directory: !!config.directory,
        wsMaxClients: config.wsMaxClients, wsMaxPerSession: MAX_SOCKETS_PER_SESSION, leaseMinutes: config.leaseMinutes,
        backup: { intervalHours: config.backup.intervalHours, copyTo: config.backup.copyTo !== null },
      },
    });
  }));

  app.post('/api/admin/metrics/reset', requireAdmin(), wrap((req: Request, res) => {
    reset();
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'metrics.reset', targetType: 'admin' });
    res.json({ ok: true });
  }));
}

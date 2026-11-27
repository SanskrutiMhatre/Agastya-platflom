// =============================================================================
// WP-14 (PUB-004, FE-010): the jobs of a project. A job outlives the request that started it: its state, progress lines (replayed after a
// reconnect: ?after=<seq>) and result are read here, and a queued or running job can be cancelled. The administrator sees the service.
// =============================================================================

import type { Express } from 'express';
import { audit, requireAdmin, requireProject } from '../context';
import { wrap, param, notFound, conflict } from '../services/http';
import * as jobs from '../services/jobs';

export function registerJobRoutes(app: Express): void {
  const base = '/api/projects/:id/jobs';
  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    res.json({ jobs: jobs.listJobs(req.project.id, Number(req.query.limit) || 50) });
  }));
  app.get(`${base}/:jobId`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    const j = jobs.getJob(req.project.id, param(req, 'jobId'), Number(req.query.after) || 0);
    if (!j) throw notFound('No such job in this project.');
    res.json({ job: j });
  }));
  // Whoever may build may cancel a build or a validation of the project.
  app.post(`${base}/:jobId/cancel`, requireProject('reviewer', { from: 'param', cap: 'publish.build' }), wrap((req, res) => {
    const id = param(req, 'jobId');
    if (!jobs.cancel(id, req.project.id, req.auth.user.username)) throw conflict('This job is not queued or running (any more).', 'JOB_NOT_ACTIVE');
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'job.cancelled', projectId: req.project.id, targetType: 'job', targetId: id });
    res.json({ ok: true });
  }));
  app.get('/api/admin/jobs', requireAdmin(), wrap((_req, res) => { res.json(jobs.jobsStatus()); }));
}

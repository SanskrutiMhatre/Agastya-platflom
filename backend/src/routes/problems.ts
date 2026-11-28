// WP-22 (UX-008, FE-015): the one problems model of a project, and the team's "reviewed" marks (services/problems.ts).
//
//   GET  /api/projects/:id/problems            anyone who can see the project: the last run's findings with open / reviewed / waived
//   GET  /api/projects/:id/problems/reviewed   anyone who can see the project: the marks (who, when)
//   PUT  /api/projects/:id/problems/reviewed   a reviewer or above (the people who may run the checks): { keys: [...], reviewed: true|false, note?: text kept with a new mark }
//
// A mark is shared by the whole project and recorded in the audit log; it never changes what the publication gate enforces.

import type { Express, Request } from 'express';
import { requireProject, audit } from '../context';
import { wrap } from '../services/http';
import { listMarks, problemsOf, setReviewed } from '../services/problems';

export function registerProblemRoutes(app: Express): void {
  const base = '/api/projects/:id/problems';
  const log = (req: Request, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    res.json(problemsOf(req.project.id));
  }));

  app.get(`${base}/reviewed`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    res.json({ marks: listMarks(req.project.id) });
  }));

  app.put(`${base}/reviewed`, requireProject('reviewer', { from: 'param', cap: 'problems.review' }), wrap((req, res) => {
    const reviewed = req.body?.reviewed !== false;
    const keys = req.body?.keys ?? req.body?.key;
    const u = req.auth.user;
    const note = reviewed ? req.body?.note : undefined;
    const marks = setReviewed(req.project.id, keys, reviewed, { username: u.username, fullName: u.fullName ?? u.full_name ?? null }, note);
    log(req, reviewed ? 'problems.reviewed' : 'problems.unreviewed', { count: Array.isArray(keys) ? keys.length : 1, ...(typeof note === 'string' && note.trim() ? { note: true } : {}) });
    res.json({ marks });
  }));
}

// Recorded waivers for the publication gate (see services/publishWaivers.ts).
//
//   GET    /api/projects/:id/publish-waivers        anyone who can see the project
//   POST   /api/projects/:id/publish-waivers        an editor or above: { kind, subject, reason }
//   DELETE /api/projects/:id/publish-waivers/:wid   an editor or above
//
// A waiver lets DRAFT builds proceed past a BREX the project does not have. It never lets a release through.

import type { Express } from 'express';
import { requireProject, audit } from '../context';
import { wrap, param, notFound } from '../services/http';
import { addWaiver, listWaivers, removeWaiver, WAIVER_KINDS } from '../services/publishWaivers';

export function registerWaiverRoutes(app: Express): void {
  const base = '/api/projects/:id/publish-waivers';
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    res.json({ waivers: listWaivers(req.project.id), kinds: WAIVER_KINDS,
      note: 'A waiver lets draft builds go ahead without the named item. A release request or approval ignores it.' });
  }));

  app.post(base, requireProject('editor', { from: 'param', cap: 'pm.write' }), wrap((req, res) => {
    const w = addWaiver(req.project.id, req.body ?? {}, req.auth.user.username);
    log(req, 'publish.waiver.added', { kind: w.kind, subject: w.subject });
    res.status(201).json({ waiver: w });
  }));

  app.delete(`${base}/:wid`, requireProject('editor', { from: 'param', cap: 'pm.write' }), wrap((req, res) => {
    const wid = param(req, 'wid');
    if (!removeWaiver(req.project.id, wid)) throw notFound('No such waiver.');
    log(req, 'publish.waiver.removed', { id: wid });
    res.json({ ok: true });
  }));
}

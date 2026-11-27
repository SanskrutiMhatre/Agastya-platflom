// Recorded waivers for the publication gate (see services/publishWaivers.ts).
//
//   GET    /api/projects/:id/publish-waivers        anyone who can see the project (the waivers and their history, WP-29)
//   POST   /api/projects/:id/publish-waivers        an editor or above: { kind, subject, reason, expiresAt? }
//   DELETE /api/projects/:id/publish-waivers/:wid   an editor or above ({ reason } optional, kept in the history)
//
// A waiver lets DRAFT builds proceed past a BREX the project does not have. It never lets a release through.

import type { Express } from 'express';
import { requireProject, audit } from '../context';
import { wrap, param, notFound } from '../services/http';
import { addWaiver, listWaivers, removeWaiver, waiverHistory, WAIVER_KINDS } from '../services/publishWaivers';

export function registerWaiverRoutes(app: Express): void {
  const base = '/api/projects/:id/publish-waivers';
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    // WP-29 (ENT-017): `history` = who added, replaced or removed which waiver, when and why - kept after the waiver itself is gone
    res.json({ waivers: listWaivers(req.project.id), history: waiverHistory(req.project.id), kinds: WAIVER_KINDS,
      note: 'A waiver lets draft builds go ahead without the named item. A release request or approval ignores it.' });
  }));

  app.post(base, requireProject('editor', { from: 'param', cap: 'pm.write' }), wrap((req, res) => {
    const w = addWaiver(req.project.id, req.body ?? {}, req.auth.user.username);
    log(req, 'publish.waiver.added', { id: w.id, kind: w.kind, subject: w.subject, reason: w.reason, expiresAt: w.expiresAt ?? null });
    res.status(201).json({ waiver: w });
  }));

  // an optional reason for the removal: { reason } in the body or ?reason=
  app.delete(`${base}/:wid`, requireProject('editor', { from: 'param', cap: 'pm.write' }), wrap((req, res) => {
    const wid = param(req, 'wid');
    const why = typeof req.body?.reason === 'string' ? req.body.reason : typeof req.query.reason === 'string' ? req.query.reason : null;
    const gone = removeWaiver(req.project.id, wid, req.auth.user.username, why);
    if (!gone) throw notFound('No such waiver.');
    log(req, 'publish.waiver.removed', { id: wid, kind: gone.kind, subject: gone.subject, reason: gone.reason, removalReason: why ? String(why).slice(0, 500) : null });
    res.json({ ok: true });
  }));
}

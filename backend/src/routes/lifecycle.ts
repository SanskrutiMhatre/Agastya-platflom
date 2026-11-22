// Data module lifecycle: history, working revisions, change-mark suggestions, issue, supersession, obsolescence.
import type { Express, RequestHandler } from 'express';
import { audit, requireProject } from '../context';
import { wrap, param, bad } from '../services/http';
import * as lc from '../services/lifecycle';
import { assertNotCir } from '../services/projects';

const view = (min: string, cap = 'project.read'): RequestHandler => requireProject(min, { from: 'param', cap });

export function registerLifecycleRoutes(app: Express): void {
  const base = '/api/projects/:id/dms/:file';
  const actor = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  app.get(`${base}/lifecycle`, view('viewer'), wrap((req, res) => { res.json({ revisions: lc.historyOf(req.project.id, param(req, 'file')) }); }));
  app.get('/api/projects/:id/lifecycle/events', view('viewer'), wrap((req, res) => { res.json({ events: lc.events(req.project.id) }); }));
  app.post(`${base}/working-revision`, view('editor', 'dm.write'), wrap(async (req, res) => {
    assertNotCir(req.project.id, 'revise modules in');
    const out = await lc.createWorkingRevision(req.project.id, param(req, 'file'), actor(req), req.body?.reason);
    log(req, 'dm.working-revision', { from: out.from, file: out.file }); res.status(201).json(out);
  }));
  app.get(`${base}/change-suggestions`, view('viewer'), wrap((req, res) => { res.json(lc.changeSuggestions(req.project.id, param(req, 'file'))); }));
  app.post(`${base}/change-marks`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const picks = Array.isArray(req.body?.picks) ? req.body.picks : []; if (picks.some((p: any) => !['add', 'modify'].includes(p?.type) || typeof p?.path !== 'string')) throw bad('Each pick needs a path and a type of add or modify.');
    const out = await lc.applyChangeMarks(req.project.id, param(req, 'file'), picks, actor(req), req.project.role);
    log(req, 'dm.change-marks', { file: out.file, marked: out.marked }); res.json(out);
  }));
  // Authorised, explicit, reasoned: Project Manager (or administrator) only.
  app.post(`${base}/issue`, view('manager', 'release.decide'), wrap(async (req, res) => {
    const out = await lc.issueRevision(req.project.id, param(req, 'file'), actor(req), req.body?.reason); log(req, 'dm.issued', { from: out.from, file: out.file }); res.status(201).json(out);
  }));
  app.post(`${base}/obsolete`, view('manager', 'release.decide'), wrap(async (req, res) => {
    const out = await lc.obsolete(req.project.id, param(req, 'file'), actor(req), String(req.body?.reason ?? '')); log(req, 'dm.obsolete', { from: out.from, file: out.file, reason: req.body?.reason }); res.status(201).json(out);
  }));
  app.post(`${base}/reinstate`, view('manager', 'release.decide'), wrap(async (req, res) => {
    const out = await lc.reinstate(req.project.id, param(req, 'file'), actor(req), String(req.body?.kind ?? ''), String(req.body?.reason ?? '')); log(req, 'dm.reinstated', { from: out.from, file: out.file, issueType: out.issueType, reason: req.body?.reason }); res.status(201).json(out);
  }));
  app.post(`${base}/supersede`, view('manager', 'release.decide'), wrap(async (req, res) => {
    const out = await lc.supersede(req.project.id, param(req, 'file'), actor(req), String(req.body?.reason ?? ''), String(req.body?.by ?? '')); log(req, 'dm.superseded', { from: out.from, file: out.file, by: out.supersededBy, reason: req.body?.reason }); res.status(201).json(out);
  }));
}

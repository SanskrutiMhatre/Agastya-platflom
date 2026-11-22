// =============================================================================
// Common Information Repository routes - the platform-wide pool of common data modules.
// Every signed-in user may browse it and add to it; reusing a module (copying it into a project)
// needs the right to write data modules in that project.
// =============================================================================

import type { Express } from 'express';
import multer from 'multer';
import { audit, authz, requireAuth } from '../context';
import { wrap, param, bad, notFound } from '../services/http';
import * as cir from '../services/cir';
import { requireProject } from '../context';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

export function registerCirRoutes(app: Express): void {
  const who = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });
  const log = (req: any, action: string, meta?: unknown, projectId?: string) =>
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId, targetType: 'cir', meta });

  // The modules, and the id of the shared workspace that opens in the editor (made on first use).
  app.get('/api/cir', requireAuth(), wrap(async (_req, res) => { res.json(await cir.list()); }));

  app.get('/api/cir/:id', requireAuth(), wrap(async (req, res) => { res.json(await cir.read(param(req, 'id'))); }));

  app.post('/api/cir', requireAuth(), upload.array('files', 100), wrap(async (req, res) => {
    const files = ((req as any).files as Express.Multer.File[] ?? []).map((f) => ({ name: f.originalname, xml: f.buffer.toString('utf8') }));
    const added = await cir.add(who(req), files, String(req.body?.note ?? ''));
    log(req, 'cir.added', { files: added.map((a: any) => a.file) });
    for (const a of added) await cir.announceChange(a.file, who(req));
    res.status(201).json({ added });
  }));

  app.delete('/api/cir/:id', requireAuth(), wrap(async (req, res) => {
    const file = await cir.remove(who(req), param(req, 'id'));
    log(req, 'cir.removed', { file });
    res.json({ ok: true });
  }));

  // Reuse: copy a common module into a project the user can write to.
  app.post('/api/cir/:id/copy', requireAuth(), wrap(async (req, res) => {
    const projectId = String(req.body?.projectId ?? '');
    if (!projectId) throw bad('Say which project to copy it into.', 'PROJECT_REQUIRED');
    const v = authz.evaluate(req.auth.user, projectId, { minRole: 'editor', cap: 'dm.write' });
    if (!v.ok) throw notFound('No such project.');
    const out = await cir.copyToProject(who(req), param(req, 'id'), projectId);
    log(req, 'cir.copied', { file: out.file }, projectId);
    res.json(out);
  }));

  // Linked copies: which modules of a project came from the repository, whether the repository has changed since, and the Project Manager's approval.
  const proj = (min: string, cap: string) => requireProject(min, { from: 'param', cap });
  app.get('/api/projects/:id/cir-links', proj('viewer', 'project.read'), wrap(async (req, res) => { res.json({ links: await cir.linksOf(req.project.id) }); }));
  app.post('/api/projects/:id/cir-links/:file/update', proj('manager', 'release.decide'), wrap(async (req, res) => {
    const out = await cir.approveUpdate(who(req), req.project.id, param(req, 'file'), req.body?.force === true || req.body?.force === '1', req.project.role);
    log(req, 'cir.update.approved', { file: out.file, changed: out.changed }, req.project.id); res.json(out);
  }));
  app.delete('/api/projects/:id/cir-links/:file', proj('manager', 'release.decide'), wrap((req, res) => { cir.detach(req.project.id, param(req, 'file')); log(req, 'cir.link.detached', { file: param(req, 'file') }, req.project.id); res.json({ ok: true }); }));
}

// =============================================================================
// Common Information Repository routes - the platform-wide pool of common data modules.
// Every signed-in user may browse it and add to it; reusing a module (copying it into a project)
// needs the right to write data modules in that project.
// =============================================================================

import type { Express, RequestHandler } from 'express';
import { cappedDiskUpload, discardWhenDone, uploadedBytes } from '../services/uploads';
import { audit, authz, requireAuth } from '../context';
import { wrap, param, bad, notFound } from '../services/http';
import * as cir from '../services/cir';
import { requireProject } from '../context';

// WP-11 (PLT-021, REL-007): the files stream to disk, at most 100 of 16 MB and 256 MB together, and are removed when the response is over.
const upload = cappedDiskUpload({ fileSize: 16 * 1024 * 1024, files: 100, totalBytes: 256 * 1024 * 1024 });
const cirUpload: RequestHandler = (req, res, next) => {
  upload.array('files', 100)(req, res, (err: unknown) => {
    if (!err) { discardWhenDone(req, res); return next(); }
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is larger than the 16 MB limit.', code: 'FILE_TOO_LARGE' });
    if (code === 'LIMIT_TOTAL_SIZE') return res.status(413).json({ error: 'The files are larger than 256 MB together. Add them in batches.', code: 'UPLOAD_TOO_LARGE' });
    if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: 'Too many files: add at most 100 at a time.', code: 'TOO_MANY_FILES', max: 100 });
    return next(err);
  });
};

export function registerCirRoutes(app: Express): void {
  const who = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });
  const log = (req: any, action: string, meta?: unknown, projectId?: string) =>
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId, targetType: 'cir', meta });

  // The modules, and the id of the shared workspace that opens in the editor (made on first use).
  app.get('/api/cir', requireAuth(), wrap(async (_req, res) => { res.json(await cir.list()); }));

  app.get('/api/cir/:id', requireAuth(), wrap(async (req, res) => { res.json(await cir.read(param(req, 'id'))); }));

  // WP-11: a replacement names the current versions in `baseHashes` (a JSON object, file -> hash); see cir.add
  app.post('/api/cir', requireAuth(), cirUpload, wrap(async (req, res) => {
    const files = ((req as any).files as Express.Multer.File[] ?? []).map((f) => ({ name: f.originalname, xml: uploadedBytes(f).toString('utf8') }));
    let baseHashes: Record<string, string> = {};
    if (typeof req.body?.baseHashes === 'string' && req.body.baseHashes.trim()) {
      try { const parsed: unknown = JSON.parse(req.body.baseHashes); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) baseHashes = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<string, string>; }
      catch { throw bad('`baseHashes` must be a JSON object of file name -> hash.', 'BAD_BODY'); }
    }
    const added = await cir.add(who(req), files, String(req.body?.note ?? ''), baseHashes);
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

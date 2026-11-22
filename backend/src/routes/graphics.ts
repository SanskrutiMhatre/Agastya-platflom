// =============================================================================
// Graphics routes.
//
//   GET    /api/graphics                          graphics of every project the user can open
//   GET    /api/projects/:id/graphics             one project's graphics only
//   POST   /api/projects/:id/graphics             add ICNs or symbols (several files at once)
//   DELETE /api/projects/:id/graphics/:name       remove one (refused while a data module uses it)
//
// The image bytes are served by the existing /api/projects/:id/media/:name.
// =============================================================================

import type { Express, RequestHandler } from 'express';
import fs from 'fs';
import { diskUpload, discard, tooLarge } from '../services/uploads';
import { audit, requireAuth, requireProject } from '../context';
import { wrap, param, bad, HttpError } from '../services/http';
import * as graphics from '../services/graphics';
import { svgProblem } from '../services/assets';
import { listProjectsFor } from '../services/projects';

const upload = diskUpload({ files: 200 });
const view = (min: string, cap = 'project.read'): RequestHandler => requireProject(min, { from: 'param', cap });

export function registerGraphicsRoutes(app: Express): void {
  const base = '/api/projects/:id/graphics';
  const log = (req: any, action: string, meta?: unknown) =>
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  app.get('/api/graphics', requireAuth(), wrap((req, res) => {
    const projects = listProjectsFor(req.auth.user).map((p) => ({ id: p.id, name: p.name, role: p.role, graphics: graphics.listGraphics(p.id) }));
    res.json({ projects });
  }));

  app.get(base, view('viewer'), wrap((req, res) => { res.json({ graphics: graphics.listGraphics(req.project.id) }); }));

  app.post(base, view('editor', 'graphics.write'), ((req, res, next) => upload.array('files', 200)(req, res, (err: unknown) => (err && (err as any).code === 'LIMIT_FILE_SIZE' ? res.status(413).json(tooLarge()) : next(err)))) as RequestHandler, wrap((req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    try {
    if (!files.length) throw bad('No files uploaded.');
    const forced = req.body?.kind === 'icn' || req.body?.kind === 'symbol' ? (req.body.kind as graphics.GraphicKind) : null;
    // Place everything first so a bad name refuses the whole batch and nothing half-lands.
    const placed: Array<{ abs: string; name: string; src: string }> = [];
    const problems: string[] = [];
    for (const f of files) {
      try {
        const kind = forced ?? graphics.kindOf(f.originalname);
        if (/\.svg$/i.test(f.originalname)) { const bad1 = svgProblem(fs.readFileSync(f.path, 'utf8').slice(0, 8 * 1024 * 1024)); if (bad1) throw bad(`${f.originalname}: SVG refused - ${bad1}.`, 'UNSAFE_SVG'); }
        const p = graphics.placeGraphic(req.project.id, f.originalname, kind);
        placed.push({ ...p, src: f.path });
      } catch (e) { problems.push((e as Error).message); }
    }
    if (problems.length) throw new HttpError(400, 'Nothing was added.', 'GRAPHICS_REFUSED', { problems });
    for (const p of placed) fs.copyFileSync(p.src, p.abs);
    log(req, 'graphics.added', { files: placed.map((p) => p.name) });
    res.status(201).json({ added: placed.map((p) => p.name), graphics: graphics.listGraphics(req.project.id) });
    } finally { discard(files); }
  }));

  app.delete(`${base}/:name`, view('editor', 'graphics.write'), wrap((req, res) => {
    graphics.deleteGraphic(req.project.id, param(req, 'name'), req.query.force === '1');
    log(req, 'graphics.removed', { name: param(req, 'name') });
    res.json({ ok: true, graphics: graphics.listGraphics(req.project.id) });
  }));
}

// Cross-engine compatibility: converting a project, or an uploaded package / document, from one format to another as a NEW project (services/xengine/convert.ts).
//
//   GET  /api/xengine/formats                   the formats and what each conversion does
//   POST /api/projects/:id/convert              { to: "s1000d" | "jss" | "jsg", name? }  -> a new project; the source is not changed
//   POST /api/xengine/import                    multipart `file` (a .zip package or one .xml document) + `source` ("auto" | "s1000d" | "jss" | "jsg") + `target` + `name`
//                                               (+ optional `folder`, and for a JSS target `domain` and `manualType`, for a JSG target `manualType`) -> a new project
//
// The answer of a conversion carries the new project and every finding (what could not be carried, what was matched by position, what was set aside): nothing is dropped silently.

import type { Express } from 'express';
import { requireAuth, requireProject, audit } from '../context';
import { wrap, bad } from '../services/http';
import { diskUpload, discard, tooLarge } from '../services/uploads';
import { FORMATS, MATRIX, convertHub, hubFromProject, hubFromUpload, label, type Format } from '../services/xengine/convert';

const asFormat = (v: unknown, what: string): Format => { const f = String(v ?? '').toLowerCase(); if (!(FORMATS as readonly string[]).includes(f)) throw bad(`Choose ${what}: S1000D, JSS or JSG.`, 'BAD_FORMAT'); return f as Format; };

export function registerXengineRoutes(app: Express): void {
  const log = (req: any, action: string, projectId: string, meta?: unknown): void => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId, targetType: 'project', targetId: projectId, meta });

  app.get('/api/xengine/formats', requireAuth(), wrap((_req, res) => {
    res.json({ ok: true, formats: FORMATS.map((id) => ({ id, label: label(id) })), conversions: MATRIX, accepts: { zip: 'a package of S1000D documents, or the older publishing tool\'s export (.zip, .jsspub.zip)', xml: 'one JSS or JSG document (.xml)' } });
  }));

  app.post('/api/projects/:id/convert', requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    const to = asFormat(req.body?.to, 'the format to convert to');
    const hub = await hubFromProject(req.project.id);
    const out = await convertHub(req.auth.user, hub, to, String(req.body?.name ?? ''));
    log(req, 'project.converted', req.project.id, { from: out.from, to: out.to, created: out.project.id, findings: out.findings.length });
    res.status(201).json(out);
  }));

  const upload = diskUpload({ files: 1 });
  app.post('/api/xengine/import', requireAuth(), (req, res, next) => upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    return (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? res.status(413).json(tooLarge()) : next(err);
  }), wrap(async (req, res) => {
    const file = (req as any).file as { path: string; originalname: string } | undefined;
    try {
      if (!file) throw bad('Send the package or document as the form field "file".', 'NO_FILE');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const source = String(body.source ?? 'auto').toLowerCase() === 'auto' ? 'auto' : asFormat(body.source, 'the source format');
      const target = asFormat(body.target, 'the format to import it as');
      const hub = await hubFromUpload(file.path, file.originalname, source);
      const opt = (k: string): string | undefined => { const v = String(body[k] ?? '').trim(); return v || undefined; };
      const out = await convertHub(req.auth.user, hub, target, String(body.name ?? ''), { folder: opt('folder'), domain: opt('domain'), manualType: opt('manualType') });
      log(req, 'project.imported-as', out.project.id, { from: out.from, to: out.to, file: file.originalname, findings: out.findings.length });
      res.status(201).json(out);
    } finally { discard(file ? [file] : []); }
  }));
}

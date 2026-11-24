// Project import for JSS document projects (additive: registered beside the JSS routes, shares no handler with them).
//
//   POST /api/projects/:id/jss/import-project   a project package (multipart `file`, .zip) -> replaces the document and its pictures                    (editor)
//   GET  /api/projects/:id/jss/export-check     what an export would contain and any problems, without building it                                       (viewer)
//   GET  /api/projects/:id/jss/export           the project package (.zip); 422 with the report when it cannot be exported                              (viewer)
//   GET  /api/projects/:id/jss/import-report    what the last import found                                                                                (viewer)

import path from 'path';
import type { Express } from 'express';
import { requireProject, audit } from '../context';
import { wrap, bad, notFound } from '../services/http';
import { isJssAuthored } from '../services/jss/service';
import { importRwiProject } from '../services/jss/rwi/importer';
import { readRecord } from '../services/jss/rwi/record';
import { planExport } from '../services/jss/rwi/exporter';
import { ZipStreamWriter } from '../services/zipio';
import { diskUpload, discard, tooLarge } from '../services/uploads';

export function registerJssRwiRoutes(app: Express): void {
  const base = '/api/projects/:id/jss';
  const log = (req: any, action: string, meta?: unknown): void => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const need = (req: any): void => { if (!isJssAuthored(req.project.id)) throw notFound('This project is not a JSS document project.'); };

  const upload = diskUpload({ files: 1 });
  app.post(`${base}/import-project`, requireProject('editor', { from: 'param', cap: 'dm.write' }), (req, res, next) => upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    return (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? res.status(413).json(tooLarge()) : next(err);
  }), wrap(async (req, res) => {
    need(req);
    const file = (req as any).file as { path: string; originalname: string } | undefined;
    try {
      if (!file) throw bad('Send the project file as the form field "file".', 'NO_FILE');
      if (!/\.zip$/i.test(file.originalname)) throw bad('This is not a project package (.zip).', 'NOT_ZIP');
      const out = await importRwiProject(req.project.id, file.path);
      log(req, 'jss.project-imported', { file: path.basename(file.originalname), documents: out.import.counts.documents, errors: out.report.errors, findings: out.import.findings.length });
      res.json({ ok: true, hash: out.hash, report: out.report, import: out.import });
    } finally { discard(file ? [file] : []); }
  }));

  app.get(`${base}/import-report`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    need(req);
    const rec = readRecord(req.project.id);
    if (!rec) throw notFound('No project has been imported into this document.');
    res.json({ ok: true, packageName: rec.packageName, importedAt: rec.importedAt, counts: rec.counts, findings: rec.findings });
  }));

  app.get(`${base}/export-check`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    need(req);
    const plan = await planExport(req.project.id);
    res.json({ ok: !plan.blocked, report: plan.report });
  }));

  app.get(`${base}/export`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    need(req);
    const plan = await planExport(req.project.id);
    if (plan.blocked) { res.status(422).json({ ok: false, error: 'This document cannot be exported yet.', code: 'EXPORT_BLOCKED', report: plan.report }); return; }
    log(req, 'jss.exported', { documents: plan.report.counts.documents, findings: plan.report.findings.length });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${plan.fileName.replace(/[^\w.\- ]/g, '_')}"`);
    const zip = new ZipStreamWriter(res);
    for (const f of plan.files) { if (f.data) await zip.addBuffer(f.name, f.data); else if (f.abs) await zip.addFile(f.name, f.abs); }
    await zip.finish();
    res.end();
  }));
}

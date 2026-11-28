// =============================================================================
// PDF review routes (Phase 3, P3-4). All under /api/projects/:id/pdf-review/; the service is services/pdfReview.
//
//   GET    files                          the reviewable PDFs of the project with their thread counts            (viewer)
//   GET    file?key=                      the PDF itself; X-Pdf-Hash names the version (the anchors' identity)     (viewer)
//   GET    annotations?key=               the threads of one PDF (re-anchored first when it changed), or all     (viewer)
//   GET    summary                        open / required counts, the release setting, what the caller may do    (viewer)
//   GET    export?format=csv|xfdf&key=    the threads as CSV or XFDF (ISO 19444-1) for a PDF reader                (viewer)
//   POST   annotations                    a new thread on a selection or an area                                 (reviewer)
//   PUT    annotations/:aid               edit the text / replacement / required flag (own thread, or a manager)  (reviewer)
//   DELETE annotations/:aid               delete (own thread without others' replies, or a manager)              (reviewer)
//   POST   annotations/:aid/replies       reply                                                                  (reviewer)
//   POST   annotations/:aid/status        open / resolved (reviewer); accepted / rejected a suggestion (editor)  (reviewer)
//   POST   annotations/:aid/place         place a thread again by hand on the current version                    (reviewer)
//   PUT    settings                       block a release while required comments are open                       (manager)
// =============================================================================

import type { Express, Request, RequestHandler } from 'express';
import fs from 'fs';
import { requireProject, audit } from '../context';
import { wrap, param, bad } from '../services/http';
import * as pdfReview from '../services/pdfReview';
import { resolveReviewFile, identityOf } from '../services/pdfReview/files';

const read: RequestHandler = requireProject('viewer', { from: 'param', cap: 'project.read' });
const comment: RequestHandler = requireProject('reviewer', { from: 'param', cap: 'pdfreview.comment' });
const manage: RequestHandler = requireProject('manager', { from: 'param', cap: 'pdfreview.settings' });

export function registerPdfReviewRoutes(app: Express): void {
  const base = '/api/projects/:id/pdf-review';
  const actor = (req: Request): pdfReview.Actor => ({ id: req.auth.user.id, username: req.auth.user.username, fullName: req.auth.user.fullName ?? req.auth.user.full_name, role: req.auth.user.role });
  const log = (req: Request, action: string, meta?: unknown): void => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const me = (req: Request) => ({ id: req.auth.user.id, role: req.project.role, can: pdfReview.abilities(req.project.role) });

  app.get(`${base}/files`, read, wrap((req, res) => { res.json({ files: pdfReview.files(req.project.id), me: me(req) }); }));

  app.get(`${base}/file`, read, wrap((req, res) => {
    const f = resolveReviewFile(req.project.id, req.query.key);
    res.set('X-Pdf-Hash', identityOf(f)).set('Cache-Control', 'no-cache').type('application/pdf');
    fs.createReadStream(f.abs).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
  }));

  app.get(`${base}/annotations`, read, wrap(async (req, res) => {
    const out = await pdfReview.listAnnotations(req.project.id, req.query.key);
    res.json({ ...out, me: me(req) });
  }));

  app.get(`${base}/summary`, read, wrap((req, res) => { res.json({ ...pdfReview.counts(req.project.id), me: me(req) }); }));

  app.get(`${base}/export`, read, wrap(async (req, res) => {
    const format = String(req.query.format ?? 'csv');
    if (format !== 'csv' && format !== 'xfdf') throw bad('Export as csv or xfdf.', 'BAD_FORMAT');
    const key = req.query.key ? String(req.query.key) : undefined;
    if (format === 'xfdf' && !key) throw bad('XFDF belongs to one PDF: name it (key).', 'KEY_REQUIRED');
    const { annotations } = await pdfReview.listAnnotations(req.project.id, key);
    log(req, 'pdfreview.exported', { format, key: key ?? null, count: annotations.length });
    const stem = (key ? key.split('/').pop()!.replace(/\.pdf$/i, '') : 'pdf-review').replace(/[^\w.\- ]/g, '_');
    if (format === 'csv') res.type('text/csv; charset=utf-8').attachment(`${stem} comments.csv`).send('﻿' + pdfReview.exportCsv(req.project.id, annotations));
    else res.type('application/vnd.adobe.xfdf').attachment(`${stem}.xfdf`).send(pdfReview.exportXfdf(key!, annotations));
  }));

  app.post(`${base}/annotations`, comment, wrap((req, res) => {
    const a = pdfReview.createAnnotation(req.project.id, actor(req), req.body ?? {});
    log(req, 'pdfreview.created', { id: a.id, file: a.fileKey, page: a.page, kind: a.kind, required: a.required });
    res.status(201).json({ annotation: a });
  }));

  app.put(`${base}/annotations/:aid`, comment, wrap((req, res) => {
    const a = pdfReview.editAnnotation(req.project.id, actor(req), req.project.role, param(req, 'aid'), req.body ?? {});
    log(req, 'pdfreview.edited', { id: a.id, file: a.fileKey });
    res.json({ annotation: a });
  }));

  app.delete(`${base}/annotations/:aid`, comment, wrap((req, res) => {
    const gone = pdfReview.deleteAnnotation(req.project.id, actor(req), req.project.role, param(req, 'aid'));
    log(req, 'pdfreview.deleted', { id: param(req, 'aid'), file: gone.fileKey, page: gone.page, kind: gone.kind });
    res.json({ ok: true });
  }));

  app.post(`${base}/annotations/:aid/replies`, comment, wrap((req, res) => {
    const a = pdfReview.addReply(req.project.id, actor(req), param(req, 'aid'), req.body?.body);
    log(req, 'pdfreview.replied', { id: a.id, file: a.fileKey });
    res.status(201).json({ annotation: a });
  }));

  app.post(`${base}/annotations/:aid/status`, comment, wrap((req, res) => {
    const { view, from } = pdfReview.setStatus(req.project.id, actor(req), req.project.role, param(req, 'aid'), req.body?.status);
    log(req, 'pdfreview.status', { id: view.id, file: view.fileKey, from, to: view.status });
    res.json({ annotation: view });
  }));

  app.post(`${base}/annotations/:aid/place`, comment, wrap((req, res) => {
    const a = pdfReview.placeAgain(req.project.id, param(req, 'aid'), req.body ?? {});
    log(req, 'pdfreview.placed', { id: a.id, file: a.fileKey, page: a.page });
    res.json({ annotation: a });
  }));

  app.put(`${base}/settings`, manage, wrap((req, res) => {
    if (typeof req.body?.blockRelease !== 'boolean') throw bad('blockRelease must be true or false.', 'BAD_SETTING');
    pdfReview.setBlockRelease(req.project.id, actor(req), req.body.blockRelease);
    log(req, 'pdfreview.settings', { blockRelease: req.body.blockRelease });
    res.json({ ok: true, ...pdfReview.counts(req.project.id) });
  }));
}

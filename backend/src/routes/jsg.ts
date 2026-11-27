// JSG authoring and publishing (Joint Services Guide: User Handbook, Illustrated Spare Parts List).
//
//   GET  /api/jsg/types                    the document types of the JSG stencils, and which are built
//   GET  /api/jsg/schema                   the XSD itself
//   GET  /api/projects/:id/jsg             the project's JSG document (XML), its type and a fresh validation report   (viewer)
//   PUT  /api/projects/:id/jsg             save the XML { xml, baseHash } (baseHash mandatory, WP-11) - malformed refused, schema-invalid kept as a draft   (editor)
//   POST /api/projects/:id/jsg/validate    check { xml? } (default: the saved document)   (viewer)
//   POST /api/projects/:id/jsg/build       build the PDF with the JSG engine   (reviewer)
//   GET  /api/projects/:id/jsg/pdf         the last PDF built   (viewer)
//   POST /api/projects/:id/jsg/import-docx  a Word file (multipart `file`) in the JSG User Handbook or ISPL format -> replaces the document, copies its pictures   (editor)
//
// These routes are the whole JSG surface: the JSS and S1000D routes and the shared publish route are not involved.

import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { requireAuth, requireProject, audit, projectDirFor } from '../context';
import { wrap, bad, notFound } from '../services/http';
import { readProjectJson } from '../services/projects';
import { JSG_TYPES, jsgTypeById } from '../services/jsg/registry';
import { JSG_XSD, isJsgProject, jsgTypeOfProject, readSource, writeSource, validateJsg, sourceHistory, sourceRevision, sourceRel } from '../services/jsg/service';
import { versionGuard } from '../services/versionGuard';
import { registerOneFileDocumentRoutes, actorOf } from './documentHistory';
import { buildJsgPdf, PDF_NAME } from '../services/jsg/engine';
import { importDocx } from '../services/jsg/docx';
import { importIsplDocx } from '../services/jsg/docx-ispl';
import { diskUpload, discard, tooLarge } from '../services/uploads';

export function registerJsgRoutes(app: Express): void {
  app.get('/api/jsg/types', requireAuth(), wrap((_req, res) => {
    res.json({ types: JSG_TYPES.map((t) => ({ id: t.id, label: t.label, stencil: t.stencil, ready: t.ready, notReady: t.notReady })) });
  }));
  app.get('/api/jsg/schema', requireAuth(), wrap((_req, res) => { res.type('application/xml').send(fs.readFileSync(JSG_XSD, 'utf8')); }));

  const base = '/api/projects/:id/jsg';
  const log = (req: any, action: string, meta?: unknown): void => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const needJsg = (req: any): void => { if (!isJsgProject(req.project.id)) throw notFound('This project is not a JSG document project.'); };

  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    needJsg(req);
    const { xml, hash } = readSource(req.project.id);
    const type = jsgTypeOfProject(req.project.id);
    res.json({ docType: type?.id ?? null, label: type?.label ?? null, stencil: type?.stencil ?? null, xml, hash, report: await validateJsg(xml) });
  }));

  app.put(base, requireProject('editor', { from: 'param', cap: 'dm.write' }), versionGuard('JSG document'), wrap(async (req, res) => {
    needJsg(req);
    const xml = req.body?.xml;
    if (typeof xml !== 'string') throw bad('Send the document as { "xml": "..." }.', 'BAD_BODY');
    const out = await writeSource(req.project.id, xml, res.locals.baseHash, actorOf(req));
    log(req, 'jsg.saved', { bytes: Buffer.byteLength(xml), errors: out.report.errors, warnings: out.report.warnings });
    res.json(out);
  }));

  // WP-11: the document's history (restore a previous save) and its check-outs by section, plate or appendix (decision D22)
  registerOneFileDocumentRoutes(app, {
    base, what: 'JSG document', auditPrefix: 'jsg', need: needJsg, rel: sourceRel, history: sourceHistory, revision: sourceRevision,
    save: async (req, projectId, xml, baseHash, reason) => { const o = await writeSource(projectId, xml, baseHash, actorOf(req), reason); return { hash: o.hash, ...(o.merged ? { merged: true, xml: o.xml } : {}) }; },
  });

  app.post(`${base}/validate`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    needJsg(req);
    const xml = typeof req.body?.xml === 'string' ? req.body.xml : readSource(req.project.id).xml;
    res.json(await validateJsg(xml));
  }));

  app.post(`${base}/build`, requireProject('reviewer', { from: 'param', cap: 'publish.build' }), wrap(async (req, res) => {
    needJsg(req);
    const out = await buildJsgPdf(req.project.id);
    log(req, 'jsg.built', { ms: out.totalMs });
    res.json({ ok: true, totalMs: out.totalMs, bytes: fs.statSync(out.pdf).size, warnings: out.warnings, pdfUrl: `/api/projects/${req.project.id}/jsg/pdf` });
  }));

  app.get(`${base}/pdf`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    needJsg(req);
    const abs = path.join(projectDirFor(req.project.id), PDF_NAME);
    if (!fs.existsSync(abs)) throw notFound('This document has not been built yet.');
    const name = `${(readProjectJson(req.project.id).name || req.project.id).replace(/[^\w.\- ]/g, '_')}.pdf`;
    res.type('application/pdf');
    if (req.query.download === '1') res.attachment(name);
    res.sendFile(abs);
  }));

  // Import from Word: the filled handbook's styles are read (docx.ts), its pictures go to the project's Media folder, and the document is replaced (the old one is kept as a .bak beside it).
  const wordUpload = diskUpload({ files: 1 });
  app.post(`${base}/import-docx`, requireProject('editor', { from: 'param', cap: 'dm.write' }), (req, res, next) => wordUpload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    return (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? res.status(413).json(tooLarge()) : next(err);
  }), wrap(async (req, res) => {
    needJsg(req);
    const file = (req as any).file as { path: string; originalname: string } | undefined;
    try {
      if (!file) throw bad('Send the Word file as the form field "file".', 'NO_FILE');
      const kind = jsgTypeOfProject(req.project.id)?.id;
      if (kind !== 'uhb' && kind !== 'ispl') throw bad('Only a User Handbook or an Illustrated Spare Parts List can be imported from Word.', 'IMPORT_TYPE');
      if (!/\.docx$/i.test(file.originalname)) throw bad('This is not a Word document (.docx). Save the file as .docx in Word first.', 'NOT_DOCX');
      let out;
      try { out = await (kind === 'ispl' ? importIsplDocx : importDocx)(file.path, { projectDir: projectDirFor(req.project.id) }); }
      catch (e) { throw bad(`This Word file could not be read: ${(e as Error).message}`, 'DOCX_UNREADABLE'); }
      const dir = projectDirFor(req.project.id); const src = path.join(dir, 'jsg-document.xml');
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, 'jsg-document.before-import.bak'));
      const saved = await writeSource(req.project.id, out.xml, undefined, actorOf(req), 'import from Word');
      log(req, 'jsg.imported', { file: file.originalname, pictures: out.media.length, chapters: out.report.chapters, errors: saved.report.errors });
      res.json({ ok: true, hash: saved.hash, report: saved.report, import: out.report, pictures: out.media.length });
    } finally { discard(file ? [file] : []); }
  }));

  void jsgTypeById;
}

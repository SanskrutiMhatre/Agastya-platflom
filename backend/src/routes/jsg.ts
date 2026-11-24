// JSG authoring and publishing (Joint Services Guide: User Handbook, Illustrated Spare Parts List).
//
//   GET  /api/jsg/types                    the document types of the JSG stencils, and which are built
//   GET  /api/jsg/schema                   the XSD itself
//   GET  /api/projects/:id/jsg             the project's JSG document (XML), its type and a fresh validation report   (viewer)
//   PUT  /api/projects/:id/jsg             save the XML { xml, baseHash? } - malformed refused, schema-invalid kept as a draft   (editor)
//   POST /api/projects/:id/jsg/validate    check { xml? } (default: the saved document)   (viewer)
//   POST /api/projects/:id/jsg/build       build the PDF with the JSG engine   (reviewer)
//   GET  /api/projects/:id/jsg/pdf         the last PDF built   (viewer)
//
// These routes are the whole JSG surface: the JSS and S1000D routes and the shared publish route are not involved.

import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { requireAuth, requireProject, audit, projectDirFor } from '../context';
import { wrap, bad, notFound } from '../services/http';
import { readProjectJson } from '../services/projects';
import { JSG_TYPES, jsgTypeById } from '../services/jsg/registry';
import { JSG_XSD, isJsgProject, jsgTypeOfProject, readSource, writeSource, validateJsg } from '../services/jsg/service';
import { buildJsgPdf, PDF_NAME } from '../services/jsg/engine';

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

  app.put(base, requireProject('editor', { from: 'param', cap: 'dm.write' }), wrap(async (req, res) => {
    needJsg(req);
    const xml = req.body?.xml;
    if (typeof xml !== 'string') throw bad('Send the document as { "xml": "..." }.', 'BAD_BODY');
    const out = await writeSource(req.project.id, xml, typeof req.body?.baseHash === 'string' ? req.body.baseHash : undefined);
    log(req, 'jsg.saved', { bytes: Buffer.byteLength(xml), errors: out.report.errors, warnings: out.report.warnings });
    res.json(out);
  }));

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

  void jsgTypeById;
}

// =============================================================================
// JSS authoring.
//
//   GET  /api/jss/types                    the document types of the JSS stencils, and which are built
//   GET  /api/projects/:id/jss             the project's JSS document (XML), its type, and a fresh validation report   (viewer)
//   PUT  /api/projects/:id/jss             save the XML { xml, baseHash? } - malformed refused, schema-invalid kept as a draft   (editor)
//   POST /api/projects/:id/jss/validate    check { xml? } (default: the saved document) against the schema and the stencil's rules   (viewer)
//   GET  /api/jss/schema                   the XSD itself, for tools that want to check a document off-line
//
// The PDF is built by the ordinary publish routes: a JSS project goes through the same Generate / release flow, with the JSS gate.
// =============================================================================

import fs from 'fs';
import type { Express } from 'express';
import { requireAuth, requireProject, audit } from '../context';
import { wrap, bad, notFound } from '../services/http';
import { JSS_TYPES, jssTypeById } from '../services/jss/registry';
import { JSS_XSD, isJssAuthored, jssTypeOfProject, readSource, writeSource, validateJss } from '../services/jss/service';

export function registerJssRoutes(app: Express): void {
  app.get('/api/jss/types', requireAuth(), wrap((_req, res) => {
    res.json({ types: JSS_TYPES.map((t) => ({ id: t.id, label: t.label, stencil: t.stencil, bodyKind: t.bodyKind, ready: t.ready, notReady: t.notReady, chapters: (t.chapters ?? []).map((c) => c.title), maxDepth: t.maxDepth })) });
  }));
  app.get('/api/jss/schema', requireAuth(), wrap((_req, res) => { res.type('application/xml').send(fs.readFileSync(JSS_XSD, 'utf8')); }));

  const base = '/api/projects/:id/jss';
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const needJss = (req: any): void => { if (!isJssAuthored(req.project.id)) throw notFound('This project is not a JSS document project.'); };

  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    needJss(req);
    const { xml, hash } = readSource(req.project.id);
    const type = jssTypeOfProject(req.project.id);
    res.json({
      docType: type?.id ?? null, label: type?.label ?? null, bodyKind: type?.bodyKind ?? null, stencil: type?.stencil ?? null,
      chapters: (type?.chapters ?? []).map((c) => c.title), maxDepth: type?.maxDepth ?? 5,
      xml, hash, report: await validateJss(req.project.id, xml),
    });
  }));

  app.put(base, requireProject('editor', { from: 'param', cap: 'dm.write' }), wrap(async (req, res) => {
    needJss(req);
    const xml = req.body?.xml;
    if (typeof xml !== 'string') throw bad('Send the document as { "xml": "..." }.', 'BAD_BODY');
    const out = await writeSource(req.project.id, xml, typeof req.body?.baseHash === 'string' ? req.body.baseHash : undefined);
    log(req, 'jss.saved', { bytes: Buffer.byteLength(xml), errors: out.report.errors, warnings: out.report.warnings });
    res.json(out);
  }));

  app.post(`${base}/validate`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap(async (req, res) => {
    needJss(req);
    const xml = typeof req.body?.xml === 'string' ? req.body.xml : readSource(req.project.id).xml;
    res.json(await validateJss(req.project.id, xml));
  }));

  // used by the editor to say what a type looks like before one exists
  app.get('/api/jss/types/:type', requireAuth(), wrap((req, res) => {
    const t = jssTypeById(req.params.type);
    if (!t) throw notFound('No such JSS document type.');
    res.json({ id: t.id, label: t.label, ready: t.ready, notReady: t.notReady, chapters: t.chapters ?? [] });
  }));
}

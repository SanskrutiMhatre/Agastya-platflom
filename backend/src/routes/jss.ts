// =============================================================================
// JSS authoring.
//
//   GET  /api/jss/types                    the document types of the JSS stencils, and which are built
//   GET  /api/projects/:id/jss             the project's JSS document (XML), its type, and a fresh validation report   (viewer)
//   PUT  /api/projects/:id/jss             save the XML { xml, baseHash? } - malformed refused, schema-invalid kept as a draft   (editor)
//   POST /api/projects/:id/jss/validate    check { xml? } (default: the saved document) against the schema and the stencil's rules   (viewer)
//   GET  /api/projects/:id/ancillary            the ancillary pages (title pages, foreword, record of changes ...): which are printed, their headings, which were edited   (viewer)
//   PUT  /api/projects/:id/ancillary            { pages: [{ id, enabled?, title? }] } choose the pages that are printed and their headings   (editor)
//   GET  /api/projects/:id/ancillary/:page      one page's XML   (viewer)
//   PUT  /api/projects/:id/ancillary/:page      save one page's XML { xml } - must be well formed and keep its root element   (editor)
//   POST /api/projects/:id/ancillary/:page/reset  give the page back to Settings   (editor)
//   GET  /api/jss/schema                   the XSD itself, for tools that want to check a document off-line
//
// The PDF is built by the ordinary publish routes: a JSS project goes through the same Generate / release flow, with the JSS gate.
// =============================================================================

import fs from 'fs';
import type { Express } from 'express';
import { requireAuth, requireProject, audit } from '../context';
import { wrap, bad, notFound } from '../services/http';
import { JSS_TYPES, jssTypeById, tableTemplatesOf } from '../services/jss/registry';
import { effectiveConfig, applyJssFrontMatter } from '../services/publisher';
import { listAncillary, readAncillary, resetAncillary, saveAncillaryChoices, writeAncillary } from '../services/jss/ancillary';
import { JSS_XSD, isJssAuthored, jssTypeOfProject, readSource, writeSource, validateJss } from '../services/jss/service';

export function registerJssRoutes(app: Express): void {
  app.get('/api/jss/types', requireAuth(), wrap((_req, res) => {
    res.json({ types: JSS_TYPES.map((t) => ({ id: t.id, label: t.label, stencil: t.stencil, domain: t.domain, bodyKind: t.bodyKind, ready: t.ready, notReady: t.notReady, source: t.source ?? 'stencil', derivedFrom: t.derivedFrom, chapters: (t.chapters ?? []).map((c) => c.title), maxDepth: t.maxDepth })) });
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
      domain: type?.domain ?? null, chapterRule: type?.chapterRule ?? 'fixed', sectionsFixed: !!type?.sectionsFixed, bodyPage: type?.bodyPage ?? null, tableTemplates: tableTemplatesOf(type),
      chapterStarter: type?.chapterRule === 'free' ? (type.chapters?.[0] ?? null) : null,
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
    res.json({ id: t.id, label: t.label, domain: t.domain, bodyKind: t.bodyKind, ready: t.ready, notReady: t.notReady, coverTitle: t.coverTitle, chapterRule: t.chapterRule ?? 'fixed', bodyPage: t.bodyPage ?? null, chapters: t.chapters ?? [] });
  }));

  // ── ancillary pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const anc = '/api/projects/:id/ancillary';
  /** The project's settings with what the JSS type adds to the frame, the same as the build sees them. */
  const effective = (req: any) => { needJss(req); const { project, effective: eff } = effectiveConfig(req.project.id); applyJssFrontMatter(req.project.id, project, eff); return eff; };

  app.get(anc, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    res.json({ pages: listAncillary(req.project.id, effective(req)) });
  }));

  app.put(anc, requireProject('editor', { from: 'param', cap: 'settings.write' }), wrap((req, res) => {
    const eff = effective(req);
    const pages = req.body?.pages;
    if (!Array.isArray(pages)) throw bad('Send { "pages": [{ "id": "...", "enabled": true, "title": "..." }] }.', 'BAD_BODY');
    const known = listAncillary(req.project.id, eff).map((p) => p.id);
    const required = new Set(listAncillary(req.project.id, eff).filter((p) => p.required).map((p) => p.id));
    for (const p of pages) if (p?.enabled === false && required.has(p.id)) throw bad(`"${p.id}" is always printed and cannot be switched off.`, 'PAGE_REQUIRED');
    saveAncillaryChoices(req.project.id, pages, known, eff.frontMatter?.pages);
    log(req, 'jss.ancillary.choices', { pages: pages.map((p: any) => ({ id: p.id, enabled: p.enabled })) });
    res.json({ pages: listAncillary(req.project.id, effective(req)) });
  }));

  app.get(`${anc}/:page`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    res.json(readAncillary(req.project.id, effective(req), req.params.page));
  }));

  app.put(`${anc}/:page`, requireProject('editor', { from: 'param', cap: 'settings.write' }), wrap((req, res) => {
    const page = writeAncillary(req.project.id, effective(req), req.params.page, req.body?.xml);
    log(req, 'jss.ancillary.saved', { page: page.id, bytes: Buffer.byteLength(req.body.xml) });
    res.json({ page });
  }));

  app.post(`${anc}/:page/reset`, requireProject('editor', { from: 'param', cap: 'settings.write' }), wrap((req, res) => {
    const eff = effective(req);
    const page = resetAncillary(req.project.id, eff, req.params.page);
    log(req, 'jss.ancillary.reset', { page: page.id });
    res.json(readAncillary(req.project.id, eff, req.params.page));
  }));
}

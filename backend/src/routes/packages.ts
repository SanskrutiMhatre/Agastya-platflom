// CSDB objects (DML/DDN/COM/UPF/SMC/IMF), asset inventory, DML generation and ZIP packages.
// Uploads stream to disk (never held in memory) up to AGASTYA_MAX_UPLOAD_BYTES (default 2 GB); downloads are built in a temp file and
// sent with Range support, so an error while building is still a JSON error and not a half-sent archive.

import fs from 'fs';
import path from 'path';
import type { Express, RequestHandler } from 'express';
import { diskUpload, uploadTmp } from '../services/uploads';
import { ZipFileReader } from '../services/zipio';
import { audit, requireAuth, requireProject } from '../context';
import { wrap, param, bad, HttpError } from '../services/http';
import * as obj from '../services/csdbObjects';
import * as assets from '../services/assets';
import * as pk from '../services/packages';
import { generateDml } from '../services/dispatch';
import { isCirProject, createProject, deleteProject } from '../services/projects';
import { adoptFromContents } from '../services/projectConfig';
import { restoreSettings, type RestoreReport } from '../services/packageSettings';
import { projectDirFor } from '../context';
import { buildHtmlPublication } from '../services/htmlPublish';
import { allFindings } from '../services/findings';
import { buildObject } from '../services/objectTemplates';
import { createItem } from '../services/adminConfig';
import { objectHtml, objectPdf } from '../services/objectRender';
import { coverage } from '../services/registry';

const view = (min: string, cap = 'project.read'): RequestHandler => requireProject(min, { from: 'param', cap });
const tmpRoot = uploadTmp;
const upload = diskUpload({ files: 1 });
const uploadOne: RequestHandler = (req, res, next) => upload.single('file')(req, res, (err: unknown) => {
  if (!err) return next();
  if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `The file is larger than the upload limit (${Math.round(pk.MAX_UPLOAD_BYTES / 1024 ** 2)} MB; set AGASTYA_MAX_UPLOAD_BYTES to change it).`, code: 'FILE_TOO_LARGE' });
  return next(err);
});
const flag = (v: unknown) => v === '1' || v === 'true' || v === true;

/**
 * What an upload is, read from its entry names (a .zip: nothing is extracted) or from the root element of its first few KB (one .xml document).
 * This is only a first guess: the person importing it is asked to confirm it, or to say what it really is.
 */
export interface Detection { format: 's1000d' | 'jss' | 'jsg' | 'unknown'; kind: 'package' | 'document'; dataModules: number; publicationModules: number; graphics: number; other: number; entries: number; /** the older publishing tool's own export (.jsspub.zip layout) */ olderTool: boolean; /** a JSG document's type (uhb | ispl) */ docType?: string }
export function detectPackage(zipPath: string, originalName = ''): Detection {
  if (/\.xml$/i.test(originalName)) {                          // one authored document: its root element says which
    const fd = fs.openSync(zipPath, 'r'); const buf = Buffer.alloc(65536); let n = 0; try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    const head = buf.subarray(0, n).toString('utf8'); const root = /<(jssbook|jsgdoc)\b([^>]*)>/.exec(head);
    const format = root ? (root[1] === 'jssbook' ? 'jss' : 'jsg') : 'unknown';
    return { format, kind: 'document', dataModules: 0, publicationModules: 0, graphics: 0, other: 1, entries: 1, olderTool: false, ...(root && root[1] === 'jsgdoc' ? { docType: /\btype\s*=\s*"([^"]*)"/.exec(root[2])?.[1] ?? 'uhb' } : {}) };
  }
  const r = ZipFileReader.open(zipPath, pk.importLimits()); const all = r.entries.map((e) => e.name.replace(/\\/g, '/')); r.close();
  const names = all.map((n) => n.split('/').pop() ?? '');
  const dm = names.filter((n) => /^DMC-.*\.xml$/i.test(n)).length; const pm = names.filter((n) => pk.classify(n) === 'pm').length;   // a PMC-….xml, or the publication.xml of this platform's own project package
  const gr = names.filter((n) => /\.(png|jpe?g|svg|gif|tiff?|cgm)$/i.test(n)).length;
  const olderTool = all.some((n) => /^manifest\.json$/i.test(n)) && all.some((n) => /^project\/(csdb|PM)\//i.test(n));
  return { format: dm || pm ? 's1000d' : 'unknown', kind: 'package', dataModules: dm, publicationModules: pm, graphics: gr, other: names.length - dm - pm - gr, entries: names.length, olderTool };
}

// A package that has been looked at but not yet turned into a project waits here, under a random token, until the owner confirms the format.
const pending = new Map<string, { userId: string; file: string; name: string; at: number }>();
const TOKEN_RE = /^[a-f0-9]{32}$/;

export function registerPackageRoutes(app: Express): void {
  const base = '/api/projects/:id';

  // ── Starting a project by importing a package ──
  // 1. detect: the upload is examined and kept under a token. 2. import: the owner has confirmed the format; the project is created and the package imported.
  app.post('/api/projects/import/detect', requireAuth(), uploadOne, wrap(async (req, res) => {
    const f = (req as any).file as Express.Multer.File | undefined; if (!f) throw bad('No package uploaded.', 'NO_FILE');
    try {
      const found = detectPackage(f.path, f.originalname);
      const token = (await import('crypto')).randomBytes(16).toString('hex'); const keep = path.join(uploadTmp(), `${token}.upload`);
      fs.renameSync(f.path, keep);
      for (const [k, v] of pending) if (Date.now() - v.at > 3600_000) { pending.delete(k); try { fs.unlinkSync(v.file); } catch { /* gone */ } }
      pending.set(token, { userId: (req as any).auth.user.id, file: keep, name: f.originalname, at: Date.now() });
      res.json({ token, name: f.originalname, ...found });
    } catch (e) { try { fs.unlinkSync(f.path); } catch { /* moved or gone */ } throw e; }
  }));

  app.post('/api/projects/import', requireAuth(), wrap(async (req, res) => {
    const user = (req as any).auth.user; const token = String(req.body?.token ?? '');
    const held = TOKEN_RE.test(token) ? pending.get(token) : undefined;
    if (!held || held.userId !== user.id || !fs.existsSync(held.file)) throw bad('That upload has expired. Choose the package again.', 'UPLOAD_EXPIRED');
    const card = await createProject(user, { name: req.body?.name, folder: req.body?.folder, format: req.body?.format, domain: req.body?.domain, manualType: req.body?.manualType });
    const role = 'owner'; let report; let packageSettings: unknown;
    try {
      report = await pk.importPackage(card.id, held.file, held.name, { overwrite: false, partial: false, skipChecks: false, replacePm: true, validate: true, enterprises: (card.format ?? 's1000d') === 's1000d', onManifest: (m) => { packageSettings = m?.project?.settings; } },{ id: user.id, username: user.username, role: user.role }, role);
    } catch (e) { try { deleteProject(user, card.id); } catch { /* best effort */ } throw e; }
    if (!report.applied) {                                  // nothing was imported: do not leave an empty project behind
      try { deleteProject(user, card.id); } catch { /* best effort */ }
      // Say WHY in the message itself: the most common reason first, how many files it covers, and how many other reasons there are. The whole report is in the body.
      const why = new Map<string, number>();
      for (const it of report.items) if (it.status === 'rejected' && it.message) why.set(it.message, (why.get(it.message) ?? 0) + 1);
      const top = [...why.entries()].sort((a, b) => b[1] - a[1]);
      const lead = top.length
        ? ` ${top[0][1] > 1 ? `${top[0][1]} files: ` : ''}${top[0][0]}${top.length > 1 ? ` (and ${top.length - 1} other reason${top.length > 2 ? 's' : ''}; see the report)` : ''}`
        : (report.notes[0] ? ` ${report.notes[0]}` : ' The report says why.');
      return void res.status(422).json({ error: `The package was not imported, so no project was created.${lead}`, code: 'IMPORT_REFUSED', report });
    }
    if ((card.format ?? 's1000d') === 's1000d' || card.format === 'jss') adoptFromContents(card.id, user.id);
    // What the exporting project CHOSE (partner, originator, codes, data module types, both SNS systems) comes back too - validated, and never over what the data modules say.
    let settings: RestoreReport | null = null;
    if ((card.format ?? 's1000d') === 's1000d') {
      try { settings = restoreSettings(card.id, user.id, packageSettings); }
      catch (e) { settings = { restored: [], notes: [`The package settings could not be applied: ${(e as Error).message}`] }; }
    }
    pending.delete(token); try { fs.unlinkSync(held.file); } catch { /* gone */ }
    audit({ actorId: user.id, actorUsername: user.username, action: 'project.imported', projectId: card.id, targetType: 'project', targetId: card.id, meta: { source: held.name, counts: report.counts, settings: settings?.restored ?? [] } });
    res.status(201).json({ project: card, report, settings });
  }));

  const actor = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const sendTemp = (res: any, tmp: string, name: string) => res.download(tmp, name, () => { try { fs.unlinkSync(tmp); } catch { /* gone */ } });

  // ── CSDB objects ──────────────────────────────────────────────────────────
  app.get(`${base}/objects`, view('viewer'), wrap((req, res) => { res.json({ objects: obj.listObjects(req.project.id, (req.query.kind as obj.ObjectKind) || undefined) }); }));
  app.get(`${base}/objects/:file`, view('viewer'), wrap((req, res) => { res.json(obj.readObject(req.project.id, param(req, 'file'))); }));
  app.post(`${base}/objects`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const out = await obj.writeObject(req.project.id, String(req.body?.file ?? ''), String(req.body?.xml ?? ''), actor(req), { overwrite: false, lenient: flag(req.body?.lenient) });
    log(req, 'object.created', { file: out.file }); res.status(201).json(out);
  }));
  app.put(`${base}/objects/:file`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const out = await obj.writeObject(req.project.id, param(req, 'file'), String(req.body?.xml ?? ''), actor(req), { overwrite: true, lenient: flag(req.body?.lenient) });
    log(req, 'object.saved', { file: out.file }); res.json(out);
  }));
  app.delete(`${base}/objects/:file`, view('editor', 'dm.delete'), wrap((req, res) => { obj.deleteObject(req.project.id, param(req, 'file')); log(req, 'object.deleted', { file: param(req, 'file') }); res.json({ ok: true }); }));

  app.post(`${base}/dml/generate`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const g = await generateDml(req.project.id, { type: req.body?.type, senderIdent: req.body?.sender, files: Array.isArray(req.body?.files) ? req.body.files : undefined, remarks: req.body?.remarks });
    if (flag(req.body?.save)) { await obj.writeObject(req.project.id, g.file, g.xml, actor(req), { overwrite: false }); log(req, 'dml.generated', { file: g.file, entries: g.entries }); }
    res.json(g);
  }));

  // ── Assets ────────────────────────────────────────────────────────────────
  app.get(`${base}/assets`, view('viewer'), wrap((req, res) => { res.json(assets.checkAssets(req.project.id)); }));

  // ── Packages ──────────────────────────────────────────────────────────────
  app.get(`${base}/packages/project`, view('viewer'), wrap(async (req, res) => {
    const tmp = path.join(tmpRoot(), `${Date.now()}-export.zip`);
    try { await pk.exportProjectPackage(req.project.id, fs.createWriteStream(tmp)); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw e; }
    log(req, 'package.exported', { kind: 'project' });
    sendTemp(res, tmp, `${String(req.project.name ?? 'project').replace(/[^\w.-]+/g, '_')}-project.zip`);
  }));
  app.post(`${base}/packages/delivery`, view('viewer'), wrap(async (req, res) => {
    const tmp = path.join(tmpRoot(), `${Date.now()}-delivery.zip`); let info;
    try { info = await pk.exportDeliveryPackage(req.project.id, fs.createWriteStream(tmp), { files: Array.isArray(req.body?.files) ? req.body.files : undefined, sender: req.body?.sender, receiver: req.body?.receiver, includeDml: flag(req.body?.includeDml), remarks: req.body?.remarks, authorization: req.body?.authorization }); }
    catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw e; }
    log(req, 'package.exported', { kind: 'delivery', files: info.files.length, ddn: info.ddn, dml: info.dml });
    if (info.ddn) { try { createItem('ddn', { code: info.ddn.replace(/^DDN-/i, '').replace(/\.xml$/i, ''), recipient: String(req.body?.receiver?.name || req.body?.receiver?.code || ''), status: 'generated' }); } catch { /* already recorded */ } }   // the Administrator's dispatch record
    res.setHeader('X-Agastya-Package-Notes', encodeURIComponent(JSON.stringify(info.notes.slice(0, 5))).slice(0, 2000));   // a header must stay small; every note is in AGASTYA-MANIFEST.json
    sendTemp(res, tmp, `${String(req.project.name ?? 'project').replace(/[^\w.-]+/g, '_')}-delivery.zip`);
  }));
  app.post(`${base}/packages/import`, view('editor', 'dm.write'), uploadOne, wrap(async (req, res) => {
    const f = (req as any).file as Express.Multer.File | undefined; if (!f) throw bad('No package uploaded.', 'NO_FILE');
    if (isCirProject(req.project.id)) { try { fs.unlinkSync(f.path); } catch { /* none */ } throw new HttpError(403, 'Packages cannot be imported into the shared repository here; add its modules through the Common Information Repository.', 'CIR_IMPORT'); }
    try {
      const report = await pk.importPackage(req.project.id, f.path, f.originalname, { overwrite: flag(req.body?.overwrite), partial: flag(req.body?.partial), skipChecks: flag(req.body?.skipChecks), replacePm: flag(req.body?.replacePm), validate: req.body?.validate === '0' ? false : true }, actor(req), req.project.role);
      log(req, 'package.imported', { source: f.originalname, applied: report.applied, counts: report.counts });
      res.status(report.applied ? 200 : 422).json(report);
    } finally { try { fs.unlinkSync(f.path); } catch { /* already removed */ } }
  }));
  app.get(`${base}/packages/import-reports`, view('viewer'), wrap((req, res) => {
    const d = path.join(projectDirFor(req.project.id), '.import-reports');
    res.json({ reports: fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 50).map((f) => ({ id: f, ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) })).map(({ items, ...r }: any) => ({ ...r, items: undefined, itemCount: items?.length ?? 0 })) : [] });
  }));
  app.get(`${base}/packages/import-reports/:id`, view('viewer'), wrap((req, res) => {
    const id = param(req, 'id'); if (!/^[\w.-]+\.json$/.test(id)) throw bad('Bad report id.');
    const f = path.join(projectDirFor(req.project.id), '.import-reports', id); if (!fs.existsSync(f)) throw new HttpError(404, 'No such report.');
    res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
  }));

  // ── Static HTML publication (AGASTYA's own format) ───────────────────────
  app.post(`${base}/publish/html`, view('reviewer', 'publish.build'), wrap(async (req, res) => {
    if (isCirProject(req.project.id)) throw new HttpError(403, 'The shared repository is not published.', 'CIR_PUBLISH');
    const input = req.body?.productId || Array.isArray(req.body?.values) ? { productId: req.body?.productId || undefined, values: Array.isArray(req.body?.values) ? req.body.values : undefined } : undefined;
    const out = await buildHtmlPublication(req.project.id, input, { allowRuleBreaks: req.body?.allowRuleBreaks === true });
    log(req, out.ruleBreaks.length ? 'publish.html.with-rule-breaks' : 'publish.html', { name: out.name, pages: out.pages, configured: out.configured, ruleBreaks: out.ruleBreaks });
    res.status(201).json({ name: out.name, pages: out.pages, assets: out.assets, missing: out.missing, configured: out.configured, ruleBreaks: out.ruleBreaks, warnings: out.warnings, zip: `/api/projects/${req.project.id}/publish/html/${out.name}.zip`, index: `/api/projects/${req.project.id}/publish/html/${out.name}/index.html` });
  }));
  app.get(`${base}/publish/html`, view('viewer'), wrap((req, res) => {
    const d = path.join(projectDirFor(req.project.id), 'html');
    res.json({ builds: fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.zip')).map((f) => ({ name: f.replace(/\.zip$/, ''), size: fs.statSync(path.join(d, f)).size, builtAt: fs.statSync(path.join(d, f)).mtime.toISOString() })) : [] });
  }));
  app.get(`${base}/publish/html/:name.zip`, view('viewer'), wrap((req, res) => {
    const name = path.basename(param(req, 'name')); const abs = path.join(projectDirFor(req.project.id), 'html', `${name}.zip`);
    if (!/^[\w.-]+$/.test(name) || !fs.existsSync(abs)) throw new HttpError(404, 'No such HTML build.');
    res.download(abs, `${name}.zip`);
  }));
  // preview of a built page: contained to the build folder, locked down with a CSP (no script, nothing from the network)
  app.get(`${base}/publish/html/:name/*`, view('viewer'), wrap((req, res) => {
    const name = path.basename(param(req, 'name')); const root = path.resolve(projectDirFor(req.project.id), 'html', name); const rel = String((req.params as any)[0] || 'index.html');
    const abs = path.resolve(root, rel);
    if (!/^[\w.-]+$/.test(name) || (abs !== root && !abs.startsWith(root + path.sep)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'Not found.');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; media-src 'self'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(abs);
  }));

  // ── Findings (module, rule, XML location, suggested fix) and the standards coverage matrix ──
  app.get(`${base}/findings`, view('viewer'), wrap(async (req, res) => { res.json(await allFindings(req.project.id, req.query.run === '1')); }));
  app.get('/api/s1000d/coverage', requireAuth(), wrap((_req, res) => { res.json({ rows: coverage() }); }));

  // ── New objects from templates, and rendering (HTML / PDF) ──
  app.post(`${base}/objects/new`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const kind = String(req.body?.kind ?? '') as obj.ObjectKind; if (!['comment', 'update', 'imf'].includes(kind)) throw bad('kind must be comment, update or imf (DML and DDN are generated).', 'BAD_KIND');
    const t = await buildObject(req.project.id, kind, req.body?.params ?? {});
    if (flag(req.body?.save)) { await obj.writeObject(req.project.id, t.file, t.xml, actor(req), { overwrite: false }); log(req, 'object.created', { file: t.file, template: true }); }
    res.status(flag(req.body?.save) ? 201 : 200).json(t);
  }));
  app.get(`${base}/objects/:file/html`, view('viewer'), wrap((req, res) => {
    const o = obj.readObject(req.project.id, param(req, 'file'));
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox"); res.type('html').send(objectHtml(o.xml, o.file));
  }));
  app.post(`${base}/objects/:file/pdf`, view('reviewer', 'publish.preview'), wrap(async (req, res) => {
    const o = obj.readObject(req.project.id, param(req, 'file')); const pdf = await objectPdf(req.project.id, o.xml, o.file);
    res.type('application/pdf').sendFile(pdf, () => { try { fs.unlinkSync(pdf); } catch { /* gone */ } });
  }));
}

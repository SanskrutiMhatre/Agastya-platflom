// =============================================================================
// Project content routes - everything behind a project's dashboard tiles:
// data modules (Editor), Explore, Publication, Validation, Release, Publish
// and Settings. All live under /api/projects/:id/.
//
// Role ladder (JSS Publisher's): viewer reads; reviewer may build and preview;
// editor changes content and settings; owner changes the shared house
// template and locks documents. Software administrators are owner-equivalent
// and are the ones who approve releases.
// =============================================================================

import { rewriteCodes } from '../services/modelCode';
import { placeNewDm } from '../services/pm';
import type { Express, Request, RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { cappedDiskUpload, discardWhenDone, uploadedBytes } from '../services/uploads';
import { nowIso, vendor } from '../config';
import { requireProject, requireAdmin, store, audit, auditedTx, projectDirFor, workspaceDir, docIndex, authz, securityPolicy, content } from '../context';
import { headOf, rootStart } from '../services/xmlHead';
import { wrap, param, bad, notFound, forbidden, conflict, HttpError } from '../services/http';
import { pageRequest, searchText, windowOf } from '../services/paging';
import { getConfig, getConfigRow, newDmProblems } from '../services/projectConfig';
import { ISSUE_LABEL } from '../services/s1000dRef';
import * as csdb from '../services/csdb';
import * as pm from '../services/pm';
import * as release from '../services/release';
import * as lifecycle from '../services/lifecycle';
import { publicationSources } from '../services/pm';
import * as review from '../services/review';
import * as pdfReview from '../services/pdfReview';
import { createProjectBrex, missingBrex } from '../services/projectBrex';
import { isS1000dProject } from '../services/projects';
import { assertS1000dPublication } from '../services/projectRecord';
import { checkDmEnterprises } from '../services/enterprises';
import * as validation from '../services/validation';
import * as publisher from '../services/publisher';
import * as jobs from '../services/jobs';
import { readProjectJson, updateProjectJson, csdbRel, mediaRel, isCirProject, assertNotCir, PROTECTED_PROJECT_KEYS, unsafeInputFields, sameSetting, unsafeArtwork } from '../services/projects';
import * as cir from '../services/cir';
import * as leases from '../services/leases';
import { versionGuard } from '../services/versionGuard';
import { writeFileAtomic } from '../storage/atomicWrite';
import { mayBreak } from './documentHistory';
import { notify, approversOf, adminIds } from '../services/notifications';
import { emitReleaseApproved, setReleaseDecider } from '../services/releaseEvents';

const { CATALOGUE } = vendor('engine/frontMatterPages');
// WP-11 (REL-007, PERF-010): uploads stream to disk with a cap on each file and on the whole request; the files are removed when the response is over.
const MAX_IMPORT_TOTAL = 1024 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|bmp|webp)$/i;

/** Most data modules one import request may carry. A bigger set is imported in batches. */
export const MAX_IMPORT_FILES = 1000;
const upload = cappedDiskUpload({ fileSize: 64 * 1024 * 1024, files: MAX_IMPORT_FILES, totalBytes: MAX_IMPORT_TOTAL });
/** One file (a picture, a publication module). */
const singleUpload: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) { discardWhenDone(req, res); return next(); }
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The file is larger than the 64 MB limit.', code: 'FILE_TOO_LARGE' });
    return next(err);
  });
};
/** Multer's own errors (too many files, a file too large) are the sender's mistake: say what is wrong instead of a bare 500. */
const importUpload: RequestHandler = (req, res, next) => {
  upload.array('files', MAX_IMPORT_FILES)(req, res, (err: unknown) => {
    if (!err) { discardWhenDone(req, res); return next(); }
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_TOTAL_SIZE') return res.status(413).json({ error: `The files are larger than ${MAX_IMPORT_TOTAL / 1048576} MB together. Import them in batches.`, code: 'UPLOAD_TOO_LARGE' });
    if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `Too many files: one import takes at most ${MAX_IMPORT_FILES}. Select fewer files (for example, import in batches).`, code: 'TOO_MANY_FILES', max: MAX_IMPORT_FILES });
    if (code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A file is larger than the 64 MB limit.', code: 'FILE_TOO_LARGE' });
    return next(err);
  });
};

const view = (min: string, cap = 'project.read'): RequestHandler => requireProject(min, { from: 'param', cap });
/** What a publish job answers (services/jobs/kinds.ts "publish"). */
interface Built { pdf: string; totalMs?: number; releaseLabel: string; ruleBreaks?: string[] }

export function registerProjectContentRoutes(app: Express): void {
  const base = '/api/projects/:id';
  const pname = (id: string) => `“${readProjectJson(id).name || 'the project'}”`;
  const actor = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  // WP-14: the publish gate as a job (a worker process), with the same refusal (422 VALIDATION_FAILED and its findings) as before
  const gate = (req: Request): Promise<unknown> => jobs.run({ kind: 'gate', projectId: req.project.id, params: { scope: 'publication', opts: {} }, actor: actor(req) });
  const isAsync = (req: Request): boolean => req.query?.async === '1' || req.body?.async === true;

  // ── Data modules (the Editor) ───────────────────────────────────────────
  // WP-18 (PERF-016, FE-030): `?limit=&offset=` return one window plus the total, `q` narrows by file name, code or title on the server, and
  // `fields=list` sends the slim row a list shows (no identity attribute maps). Without them: every module, every field, exactly as before.
  app.get(`${base}/dms`, view('viewer'), wrap((req, res) => {
    const want = pageRequest(req); const q = searchText(req);
    const slim = req.query.fields === 'list';
    const locked = new Set<string>(store.listLockedPaths(req.project.id));
    const pj = readProjectJson(req.project.id);
    let all = csdb.listDms(req.project.id);
    if (q) all = all.filter((d) => [d.file, d.dmc, d.techName, d.infoName, d.title].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
    const w = want ? windowOf(all, want) : null;
    const rows = (w ? w.items : all).map((d) => {
      const isLocked = locked.has(`${csdbRel(pj)}/${d.file}`);
      if (!slim) return { ...d, locked: isLocked };
      return { file: d.file, dmc: d.dmc, techName: d.techName, infoName: d.infoName, title: d.title, issueNumber: d.issueNumber, inWork: d.inWork,
        language: d.language, issue: d.issue, security: d.security, size: d.size, modified: d.modified, locked: isLocked };
    });
    res.json(w ? { dms: rows, ...w.page } : { dms: rows });
  }));

  app.get(`${base}/dms/:file`, view('viewer'), wrap((req, res) => { res.json(csdb.readDm(req.project.id, param(req, 'file'))); }));

  app.put(`${base}/dms/:file`, view('editor', 'dm.write'), versionGuard('data module'), wrap(async (req, res) => {
    cir.assertNotLinked(req.project.id, param(req, 'file'));                        // a linked copy is changed in the repository, not here
    const out = await csdb.writeDm(req.project.id, param(req, 'file'), String(req.body?.xml ?? ''), res.locals.baseHash, actor(req), req.project.role);
    if (isCirProject(req.project.id)) await cir.announceChange(out.file, actor(req));    // projects that link this module are told an update is available
    log(req, 'dm.saved', { file: out.file });
    res.json(out);
  }));

  app.post(`${base}/dms`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const out = await csdb.createDm(req.project.id, String(req.body?.file ?? ''), String(req.body?.xml ?? ''), actor(req));
    if (isCirProject(req.project.id)) cir.noteAdded(out.file, actor(req).id);       // who put it in the shared repository
    else placeNewDm(req.project.id, out.file);                                     // a new module joins the publication (the CSDB holds it either way)
    log(req, 'dm.created', { file: out.file });
    res.status(201).json(out);
  }));

  app.delete(`${base}/dms/:file`, view('editor', 'dm.delete'), wrap(async (req, res) => {
    if (isCirProject(req.project.id) && req.auth.user.role === 'author') throw forbidden('Only a Project Manager or an administrator can delete a common data module. Everyone can add and edit them.', 'CIR_DELETE_ROLE');
    await csdb.deleteDm(req.project.id, param(req, 'file'), actor(req), req.project.role);
    if (isCirProject(req.project.id)) cir.forget(param(req, 'file'));
    log(req, 'dm.deleted', { file: param(req, 'file') });
    res.json({ ok: true });
  }));

  app.get(`${base}/dms/:file/history`, view('viewer'), wrap((req, res) => { res.json({ revisions: csdb.history(req.project.id, param(req, 'file')) }); }));
  app.get(`${base}/dms/:file/history/:rev`, view('viewer'), wrap((req, res) => {
    res.json({ xml: csdb.revisionContent(req.project.id, param(req, 'file'), Number(param(req, 'rev'))) });
  }));
  // WP-11: restore a previous version (saved as the newest revision, guarded like a save), and check-out leases (RES-001, ENT-016)
  app.post(`${base}/dms/:file/history/:rev/restore`, view('editor', 'dm.write'), versionGuard('data module'), wrap(async (req, res) => {
    cir.assertNotLinked(req.project.id, param(req, 'file'));
    const rev = Number(param(req, 'rev'));
    const xml = csdb.revisionContent(req.project.id, param(req, 'file'), rev);
    const out = await csdb.writeDm(req.project.id, param(req, 'file'), xml, res.locals.baseHash, actor(req), req.project.role, true);
    log(req, 'dm.restored', { file: out.file, revision: rev });
    res.json(out);
  }));
  const dmRel = (projectId: string, file: string): string => { csdb.resolveDmFile(projectId, file); return `${csdbRel(readProjectJson(projectId))}/${file}`; };
  app.get(`${base}/dms/:file/checkout`, view('viewer'), wrap(async (req, res) => { res.json({ leases: await leases.leasesOf(req.project.id, dmRel(req.project.id, param(req, 'file')), req.auth.user.id) }); }));
  app.post(`${base}/dms/:file/checkout`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const lease = await leases.checkOut(req.project.id, dmRel(req.project.id, param(req, 'file')), '', actor(req));
    log(req, 'dm.checked-out', { file: param(req, 'file'), expiresAt: lease.expiresAt });
    res.json({ lease });
  }));
  app.delete(`${base}/dms/:file/checkout`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const breakIt = req.query.break === '1';
    if (breakIt && !mayBreak(req)) throw forbidden('Only a project owner, a manager or an administrator can break another author\'s check-out.', 'BREAK_NOT_ALLOWED');
    // WP-29: breaking someone else's check-out is critical - released and recorded together, or neither
    const out = await leases.checkIn(req.project.id, dmRel(req.project.id, param(req, 'file')), '', actor(req), breakIt, breakIt
      ? (fn) => auditedTx((x: { released: boolean; holder: string | null }) => (x.released ? { actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'dm.checkout-broken', projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta: { file: param(req, 'file'), holder: x.holder } } : null), fn)
      : undefined);
    if (out.released && !breakIt) log(req, 'dm.checked-in', { file: param(req, 'file'), holder: out.holder });
    res.json(out);
  }));
  app.get(`${base}/checkouts`, view('viewer'), wrap((req, res) => { res.json({ leases: leases.projectLeases(req.project.id, req.auth.user.id) }); }));

  // Lock: only a project owner may then edit the module.
  app.post(`${base}/dms/:file/lock`, view('owner', 'doc.lock'), wrap(async (req, res) => {
    const rel = `${csdbRel(readProjectJson(req.project.id))}/${param(req, 'file')}`;
    csdb.resolveDmFile(req.project.id, param(req, 'file'));
    const doc = docIndex.resolve(req.project.id, rel);
    if (!doc) throw notFound();
    store.lockDocument(doc.id, req.auth.user.id, nowIso());
    log(req, 'dm.locked', { file: param(req, 'file') });
    res.json({ ok: true });
  }));
  app.post(`${base}/dms/:file/unlock`, view('owner', 'doc.lock'), wrap(async (req, res) => {
    const rel = `${csdbRel(readProjectJson(req.project.id))}/${param(req, 'file')}`;
    const doc = docIndex.resolve(req.project.id, rel);
    if (!doc) throw notFound();
    store.unlockDocument(doc.id, nowIso());
    log(req, 'dm.unlocked', { file: param(req, 'file') });
    res.json({ ok: true });
  }));

  // Import: several data modules at once, all-or-nothing (a half-imported batch must never exist).
  app.post(`${base}/dms-import`, view('editor', 'dm.write'), importUpload, wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw bad('No files uploaded.');
    const overwrite = req.body?.overwrite === '1';
    // "Import without validation": the enterprise check against the Administrator's lists and the content rules
    // (well-formed, a <dmodule> root) are skipped, so drafts with problems can be brought in and fixed in the editor.
    // Never skipped: file naming (DMC-*.xml), safety (empty file, entity bombs, external entities), and a data module
    // existing once per project - a clash would otherwise stop the batch half way.
    const skipChecks = req.body?.skipChecks === '1';
    // A module that carries ANOTHER model code (one from a repository, another project, a supplier) is not refused without a way forward: the importer is told what to do with it.
    //   keep   the module keeps its own code and is imported as a shared module of another model (like a copy from the Common Information Repository)
    //   recode its identification and every reference to its code become this project's model code (and its file is renamed)
    const otherModel = req.body?.otherModel === 'keep' || req.body?.otherModel === 'recode' ? (req.body.otherModel as 'keep' | 'recode') : null;
    const projectMic = String(getConfig(req.project.id).mic ?? '').toUpperCase();
    const foreign: Array<{ file: string; mic: string }> = [];
    const problems: string[] = [];
    const withProblems: Array<{ file: string; problem: string }> = [];
    const staged: Array<{ name: string; xml: string }> = [];
    const seen = new Map<string, string>();
    const csdbPath = csdbRel(readProjectJson(req.project.id));
    for (const f of files) {
      let name = path.basename(f.originalname).replace(/[^\w.\- ]/g, '_');
      if (!csdb.DM_FILE_RE.test(name)) { problems.push(`${f.originalname}: data module files are named DMC-<code>.xml`); continue; }
      if (!overwrite && fs.existsSync(csdb.resolveDmFile(req.project.id, name))) { problems.push(`${name}: already exists in this project`); continue; }
      let xml = uploadedBytes(f).toString('utf8');
      const ownMic = (csdb.parseIdent(headOf(xml), name).dmc.split('-')[0] ?? '').toUpperCase();
      const isForeign = !!projectMic && !!ownMic && ownMic !== projectMic;
      if (isForeign && otherModel === 'recode') {
        xml = rewriteCodes(xml, ownMic, projectMic).text; name = name.replace(/^DMC-[A-Za-z0-9]+-/i, `DMC-${projectMic}-`);
        if (!overwrite && fs.existsSync(csdb.resolveDmFile(req.project.id, name))) { problems.push(`${name}: already exists in this project`); continue; }
      } else if (isForeign && !otherModel && !skipChecks) { foreign.push({ file: name, mic: ownMic }); }
      // Every file is judged BEFORE anything is written, so a bad file 150 of 218 cannot leave a half-imported batch.
      try { csdb.validateContent(`${csdbPath}/${name}`, xml, skipChecks); } catch (e) { problems.push(`${name}: ${(e as Error).message}`); continue; }
      try { csdb.assertUnique(req.project.id, name, xml); } catch (e) { problems.push(`${name}: ${(e as Error).message}`); continue; }
      const key = csdb.identityKey(csdb.parseIdent(headOf(xml), name));
      const twin = seen.get(key);
      if (twin) { problems.push(`${name}: same data module (code, issue and language) as ${twin} in this import`); continue; }
      seen.set(key, name);
      if (skipChecks) { const why = csdb.contentProblem(`${csdbPath}/${name}`, xml); if (why) withProblems.push({ file: name, problem: why }); }
      else {
        for (const p of checkDmEnterprises(xml)) problems.push(`${name}: ${p}`);      // enterprise code / name / pair against the Administrator's lists
        // a NEW module must also fit the project's S1000D configuration (an existing one being replaced is not held to it)
        if (!fs.existsSync(csdb.resolveDmFile(req.project.id, name)) && !(isForeign && otherModel === 'keep')) for (const p of newDmProblems(req.project.id, xml)) problems.push(`${name}: ${p}`);
      }
      staged.push({ name, xml });
    }
    if (problems.length) throw new HttpError(400, 'Nothing was imported.', 'IMPORT_REFUSED', { problems, ...(foreign.length ? { otherModel: foreign, projectMic } : {}) });
    for (const s of staged) {
      if (fs.existsSync(csdb.resolveDmFile(req.project.id, s.name))) await csdb.writeDm(req.project.id, s.name, s.xml, undefined, actor(req), req.project.role, skipChecks);
      else await csdb.createDm(req.project.id, s.name, s.xml, actor(req), skipChecks, otherModel === 'keep' && projectMic && (csdb.parseIdent(headOf(s.xml), s.name).dmc.split('-')[0] ?? '').toUpperCase() !== projectMic ? { fromRepository: true } : undefined);
    }
    log(req, 'dm.imported', { count: staged.length, ...(skipChecks ? { enterpriseCheckSkipped: true } : {}) });
    res.json({ imported: staged.map((s) => s.name), withProblems });
  }));

  // ── Graphics ────────────────────────────────────────────────────────────
  app.get(`${base}/media`, view('viewer'), wrap((req, res) => { res.json({ media: csdb.listMedia(req.project.id) }); }));
  app.get(`${base}/media/:name`, view('viewer'), wrap((req, res) => {
    const abs = csdb.mediaPath(req.project.id, param(req, 'name'));
    if (!abs) throw notFound();
    res.sendFile(abs);
  }));
  app.post(`${base}/media`, view('editor', 'graphics.write'), singleUpload, wrap((req, res) => {
    if (!req.file) throw bad('No file uploaded.');
    const safe = path.basename(req.file.originalname).replace(/[^\w.\- ]/g, '_');
    if (!IMAGE_EXT.test(safe)) throw bad('Unsupported image type.');
    // ICN artwork declared by <!ENTITY ... SYSTEM "file"> resolves beside the data modules (csdb/); logos and branding live in Media/.
    const pj = readProjectJson(req.project.id);
    const target = req.body?.dir === 'csdb' ? csdbRel(pj) : mediaRel(pj);
    const dir = path.join(projectDirFor(req.project.id), target);
    fs.mkdirSync(dir, { recursive: true });
    content.writeBuffer(req.project.id, path.join(dir, safe), uploadedBytes(req.file));
    log(req, 'media.uploaded', { name: safe, dir: target });
    res.json({ ok: true, name: safe, path: `${target}/${safe}` });
  }));

  // ── Explore + Publication ───────────────────────────────────────────────
  app.get(`${base}/explore`, view('viewer'), wrap((req, res) => { res.json(pm.explore(req.project.id)); }));

  app.get(`${base}/pmc`, view('viewer'), wrap((req, res) => {
    const { meta, entries, warnings, counts, pool } = pm.readPm(req.project.id);
    const abs = pm.pmPath(req.project.id);
    res.json({ meta, entries, warnings, counts, pool, hash: fs.existsSync(abs) ? csdb.sha(fs.readFileSync(abs, 'utf8')) : null });     // hash: the version a save names (WP-11)
  }));

  app.put(`${base}/pmc`, view('editor', 'pm.write'), versionGuard('publication'), wrap((req, res) => {
    const out = pm.writePm(req.project.id, { meta: req.body?.meta, entries: req.body?.entries }, req.query.allowEmpty === '1', res.locals.baseHash);
    log(req, 'pm.saved', out.counts);
    res.json(out);
  }));

  // Replace the publication module with an uploaded file (kept as .bak). Parsed before anything is written.
  app.post(`${base}/pmc/import`, view('editor', 'pm.write'), singleUpload, wrap((req, res) => {
    if (!req.file) throw bad('No file uploaded.');
    const text = uploadedBytes(req.file).toString('utf8');
    if (rootStart(text, 'pm') < 0) throw bad('That is not a publication module (no <pm> root element) - was a data module or the PDF picked by mistake?', 'NOT_A_PM');
    const guard = require('../core/auth/xmlGuard').checkXmlSafety(text);
    if (!guard.ok) throw bad(guard.error, 'UNSAFE_XML');
    const parsed = vendor('engine/pmc').parsePm(text);
    if (!parsed.entries.length) throw bad('That publication module has no entries.', 'EMPTY_PM');
    assertS1000dPublication(req.project.id);                           // WP-16 (PUB-022): refused by the writer itself, not only by routes/jss-guard.ts
    const abs = pm.pmPath(req.project.id);
    if (fs.existsSync(abs)) fs.copyFileSync(abs, abs + '.bak');
    content.writeText(req.project.id, abs, text);
    const ex = pm.explore(req.project.id);
    log(req, 'pm.imported', ex.counts);
    res.json({ counts: ex.counts, warnings: ex.warnings, backup: path.basename(abs) + '.bak', missingModules: ex.missing });
  }));

  // The publication as a file: 'ietm' is the stored form, 'pdf' resolves every dmRef to the xi:include the build uses.
  app.get(`${base}/pmc/export`, view('viewer'), wrap((req, res) => {
    const abs = pm.pmPath(req.project.id);
    if (!fs.existsSync(abs)) throw notFound('This project has no publication module yet.');
    let text = fs.readFileSync(abs, 'utf8');
    if (req.query.form === 'pdf') {
      const rel = csdbRel(readProjectJson(req.project.id));
      text = vendor('engine/resolveDmRefs').resolveDmRefs(text, path.join(projectDirFor(req.project.id), rel), rel).text;
    }
    res.type('application/xml').attachment(req.query.form === 'pdf' ? 'PMC-PDF.xml' : 'PMC-IETM.xml').send(text);
  }));

  // ── Validation ──────────────────────────────────────────────────────────
  app.get(`${base}/validation`, view('viewer'), wrap((req, res) => {
    res.json({ run: validation.lastRun(req.project.id), schemaIssues: validation.installedSchemaIssues(), issue: validation.projectIssue(req.project.id) });
  }));
  // The S1000D issue this project's checks use (schema + default BREX): 'auto' = each module's own declaration. Applies to the
  // Validation page, and to the build / preview / release checks, so what the page says is what the build enforces.
  // A BREX that the modules name but the project does not hold: list it, or create it (inherits the S1000D default, adds no rules).
  app.get(`${base}/brex/missing`, view('viewer'), wrap((req, res) => { res.json({ missing: isS1000dProject(req.project.id) ? missingBrex(req.project.id) : [] }); }));
  app.post(`${base}/brex/create`, view('editor', 'dm.write'), wrap(async (req, res) => {
    const out = await createProjectBrex(req.project.id, actor(req));
    log(req, 'brex.created', { files: out.created });
    res.status(201).json(out);
  }));
  app.put(`${base}/validation/issue`, view('editor', 'settings.write'), wrap((req, res) => {
    const issue = String(req.body?.issue ?? 'auto');
    const owned = getConfigRow(req.project.id)?.config.issue;
    if (owned && issue !== ISSUE_LABEL[owned]) throw conflict(`This project's S1000D issue (${ISSUE_LABEL[owned]}) is part of its configuration, and its checks use it. Change it there (only possible while the project has no data modules).`, 'ISSUE_FROM_CONFIG');
    if (issue !== 'auto' && !validation.installedSchemaIssues().includes(issue)) throw bad(`S1000D issue ${issue} is not installed.`, 'BAD_ISSUE');
    validation.setProjectIssue(req.project.id, issue);
    log(req, 'validation.issue', { issue });
    res.json({ issue });
  }));
  // WP-14 (PERF-001): validation runs as a job in a worker process; the request waits for it (same answer as before), or with ?async=1 gets 202
  // and the job, whose progress and result GET /jobs/:jobId replays.
  app.post(`${base}/validation`, view('reviewer', 'validate.run'), wrap(async (req, res) => {
    const params = { issue: req.body?.issue === undefined ? undefined : String(req.body.issue), brex: req.body?.brex === undefined ? true : !!req.body.brex, fresh: req.body?.fresh === true };
    const s = jobs.submit({ kind: 'validate', projectId: req.project.id, params, actor: actor(req) });
    const record = (out: unknown): void => { const run = (out as { run: validation.ValidationRun }).run; log(req, 'validation.run', { ...run.summary, ...(run.cached ? { cached: true } : {}) }); };
    if (isAsync(req)) { void s.done.then(record, () => undefined); res.status(202).json({ job: { id: s.id }, jobUrl: `/api/projects/${req.project.id}/jobs/${s.id}` }); return; }
    const out = await s.done as { run: validation.ValidationRun };
    record(out);
    res.set('X-Job-Id', s.id).json({ run: out.run });
  }));

  // ── Release + watermark ─────────────────────────────────────────────────
  const canSubmit = (role: string) => role === 'editor' || role === 'manager' || role === 'owner';
  const canComment = (role: string) => role === 'reviewer' || canSubmit(role);
  /*
    Who approves a release: the Project Manager of THIS project, or an administrator. An Author - even
    the owner of the project - requests; they never approve their own work.
  */
  const canApprove = (user: { role: string }, role: string) =>
    user.role === 'admin' || (user.role === 'project_manager' && (role === 'manager' || role === 'owner'));
  app.get(`${base}/release`, view('viewer', 'release.read'), wrap((req, res) => {
    // WP-17 (PERF-005): a page view computes the release state once (it was three passes over every source file, each re-read and re-hashed)
    // and, as the dashboard summary does since WP-18, reuses the digest of a file whose size and times are unchanged. Display only: submit,
    // approve and every build compute it afresh from the files.
    const known = csdb.listDms(req.project.id);
    const st = release.releaseStateOf(req.project.id, { reuse: true, known });
    const rs = review.reviewState(req.project.id, st);
    res.json({
      ...release.releaseOverview(req.project.id, canSubmit(req.project.role) || req.auth.user.role === 'admin', { state: st, known }),
      canApprove: canApprove(req.auth.user, req.project.role) && !securityPolicy.approverConflict(store.pendingRelease(req.project.id)?.requested_by, req.auth.user.id),
      approveBlocked: canApprove(req.auth.user, req.project.role) ? securityPolicy.approverConflict(store.pendingRelease(req.project.id)?.requested_by, req.auth.user.id) : null,
      review: { ...rs, comments: review.listComments(req.project.id), open: review.openComments(req.project.id), canComment: canComment(req.project.role) || req.auth.user.role === 'admin' },
      pdfReview: pdfReview.counts(req.project.id),     // Phase 3 (P3-4): open / required PDF review threads and the block-release setting
    });
  }));
  app.post(`${base}/release`, view('editor', 'release.submit'), wrap(async (req, res) => {
    assertNotCir(req.project.id, 'release');
    pdfReview.assertReleasable(req.project.id);                      // P3-4: the project may block a release while required PDF comments are open
    await gate(req);                                                // a release is a publication: its modules must be valid right now
    const again = review.reviewState(req.project.id).state === 'changes_requested';
    publisher.syncFrontMatter(req.project.id);                       // the fingerprint that is approved must be the one every build reproduces
    const out = release.requestRelease(req.project.id, req.auth.user.id, req.body ?? {});
    log(req, again ? 'review.resubmitted' : 'release.requested', { ...out, fingerprint: out.contentHash });   // WP-29 (ENT-020): the fingerprint the approver signs off
    const who = req.auth.user.fullName ?? req.auth.user.full_name;
    notify(approversOf(req.project.id), again
      ? { kind: 'review.resubmitted', title: 'Manual resubmitted for review', body: `${who} made the requested changes to ${pname(req.project.id)} and resubmitted it.`, projectId: req.project.id, actorId: req.auth.user.id }
      : { kind: 'approval.requested', title: 'Manual submitted for review', body: `${who} submitted ${pname(req.project.id)} for review.`, projectId: req.project.id, actorId: req.auth.user.id });
    res.json({ ok: true });
  }));
  app.delete(`${base}/release/:relId`, view('editor', 'release.submit'), wrap((req, res) => {
    release.withdrawRelease(req.project.id, param(req, 'relId'));
    log(req, 'release.withdrawn');
    notify(approversOf(req.project.id), { kind: 'approval.withdrawn', title: 'Release request withdrawn', body: `${pname(req.project.id)}: the request was withdrawn.`, projectId: req.project.id, actorId: req.auth.user.id });
    res.json({ ok: true });
  }));
  // A release only becomes real when the project's Project Manager (or an administrator) approves it.
  // Phase 3 (P3-5): the decision is one function, so a GitLab merge-request approval that counts toward the Agastya approval
  // (services/releaseEvents.ts decideReleaseAs) runs exactly these steps under the approver's own account.
  const decision = async (req: Request, relId: string, approve: boolean, via?: string): Promise<void> => {
    if (!canApprove(req.auth.user, req.project.role)) throw forbidden('Only the Project Manager of this project, or an administrator, can decide a release.', 'APPROVER_ONLY');
    const requester = store.getRelease(relId)?.requested_by;
    if (approve) { const sod = securityPolicy.approverConflict(requester, req.auth.user.id); if (sod) throw forbidden(sod, 'SEPARATION_OF_DUTIES'); }   // before any side effect (D7)
    if (approve) pdfReview.assertReleasable(req.project.id);        // P3-4: the same rule at approval
    if (approve) await gate(req);                                    // never approve a release whose content is not valid now
    // Approval turns every in-work revision of the publication into the next ISSUE (in-work 00, issueType "changed"); the release then covers that content.
    // The issuing happens BEFORE the decision is recorded (and only for a request that is still pending), so a failure leaves the release undecided and the
    // approval can simply be repeated - already-issued modules are not issued twice.
    let issued: Array<{ from: string; file: string }> = [];
    if (approve && store.getRelease(relId)?.status === 'pending') issued = await lifecycle.issueForRelease(req.project.id, publicationSources(req.project.id), actor(req));
    // WP-29 (ENT-003, ENT-020): the decision, the fingerprint it covers and its audit row are one transaction; the row names the fingerprint.
    auditedTx(() => ({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: approve ? 'release.approved' : 'release.rejected', projectId: req.project.id,
      targetType: 'project', targetId: req.project.id, meta: { id: relId, fingerprint: store.getRelease(relId)?.content_hash ?? null, ...(via ? { via } : {}) } }), () => {
      release.decideRelease(req.project.id, relId, approve, req.auth.user.id);
      if (issued.length) store.setReleaseContentHash(relId, release.publicationFingerprint(req.project.id));
    });
    if (issued.length) log(req, 'release.issued', { issued });
    notify([requester], { kind: approve ? 'approval.approved' : 'approval.rejected', title: approve ? 'Release approved' : 'Release rejected', body: `${pname(req.project.id)}: ${approve ? 'approved' : 'rejected'} by ${req.auth.user.fullName ?? req.auth.user.full_name}.`, projectId: req.project.id, actorId: req.auth.user.id });
    if (approve) emitReleaseApproved({ projectId: req.project.id, releaseId: relId, actor: actor(req) });
  };
  setReleaseDecider((projectId, releaseId, who, via) => decision({ auth: { user: who.user }, project: { id: projectId, role: who.projectRole } } as unknown as Request, releaseId, true, via));
  const decide = (approve: boolean): RequestHandler[] => [view('manager', 'release.decide'), wrap(async (req, res) => {
    await decision(req, param(req, 'relId'), approve);
    res.json({ ok: true });
  })];
  app.post(`${base}/release/:relId/approve`, ...decide(true));
  app.post(`${base}/release/:relId/reject`, ...decide(false));

  // The Project Manager sends a manual back: the request ends as "changes requested" and the reasons are kept.
  app.post(`${base}/release/:relId/changes`, view('manager', 'release.decide'), wrap(async (req, res) => {
    if (!canApprove(req.auth.user, req.project.role)) throw forbidden('Only the Project Manager of this project, or an administrator, can send a manual back.', 'APPROVER_ONLY');
    const text = String(req.body?.comment ?? '').trim();
    const open = review.openComments(req.project.id);
    if (!text && !open) throw bad('Say what needs to change: add a comment (or at least one review comment) before sending the manual back.', 'COMMENT_REQUIRED');
    const relId = param(req, 'relId');
    const requester = store.getRelease(relId)?.requested_by;
    release.decideRelease(req.project.id, relId, false, req.auth.user.id);
    if (text) review.addComment(req.project.id, req.auth.user.id, { body: text, releaseId: relId }, 'changes');
    notify([requester], { kind: 'review.changes_requested', title: 'Changes requested', body: `${pname(req.project.id)}: ${req.auth.user.fullName ?? req.auth.user.full_name} sent it back${text ? `: “${text.slice(0, 140)}”` : ' with comments.'}`, projectId: req.project.id, actorId: req.auth.user.id });
    log(req, 'review.changes_requested', { id: relId });
    res.json({ ok: true });
  }));
  app.post(`${base}/review/comments`, view('reviewer', 'review.comment'), wrap((req, res) => {
    if (!canComment(req.project.role) && req.auth.user.role !== 'admin') throw forbidden('You cannot comment on this manual.');
    const id = review.addComment(req.project.id, req.auth.user.id, req.body ?? {});
    const pending = store.pendingRelease(req.project.id);
    // The author hears about a comment made while the manual is in review.
    if (pending) notify([pending.requested_by], { kind: 'review.comment', title: 'New review comment', body: `${pname(req.project.id)}: ${req.auth.user.fullName ?? req.auth.user.full_name} commented.`, projectId: req.project.id, actorId: req.auth.user.id });
    log(req, 'review.comment', { id });
    res.status(201).json({ ok: true, id });
  }));
  app.post(`${base}/review/comments/:cid/resolve`, view('reviewer', 'review.comment'), wrap((req, res) => {
    review.setResolved(req.project.id, Number(param(req, 'cid')), req.auth.user.id, req.body?.resolved !== false);
    log(req, req.body?.resolved !== false ? 'review.comment.resolved' : 'review.comment.reopened', { id: Number(param(req, 'cid')) });   // WP-29 (G-SEC-5)
    res.json({ ok: true });
  }));

  app.get(`${base}/watermark`, view('viewer', 'watermark.read'), wrap((req, res) => {
    res.json({ watermark: release.readWatermark(req.project.id), styles: release.WATERMARK_STYLES });
  }));
  app.put(`${base}/watermark`, view('editor', 'watermark.write'), wrap((req, res) => {
    const wm = release.writeWatermark(req.project.id, req.body?.watermark ?? req.body ?? {});
    log(req, 'watermark.updated', wm);
    res.json({ ok: true, watermark: wm });
  }));

  // ── Publish ─────────────────────────────────────────────────────────────
  app.get(`${base}/publish/status`, view('viewer'), wrap((_req, res) => { res.json(publisher.rendererStatus()); }));

  app.post(`${base}/publish`, view('reviewer', 'publish.build'), wrap(async (req, res) => {
    let compression: number | undefined;
    if (req.body?.compression !== undefined) {
      compression = Math.max(0, Math.min(100, Number(req.body.compression) || 0));
      updateProjectJson(req.project.id, (pj) => { pj.output = { ...(pj.output || {}), compression }; });
    }
    assertNotCir(req.project.id, 'publish');
    const allowRuleBreaks = req.body?.allowRuleBreaks === true;
    // WP-14: the build is a job in a worker process (deadline, cancel, one build per project, a bounded number server-wide)
    const s = jobs.submit({ kind: 'publish', projectId: req.project.id, params: { compression, allowRuleBreaks }, actor: actor(req) });
    const record = (out: Built): void => log(req, out.ruleBreaks?.length ? 'publish.built.with-rule-breaks' : 'publish.built', { ms: out.totalMs, ruleBreaks: out.ruleBreaks ?? [] });
    if (isAsync(req)) { void s.done.then((o) => record(o as Built), () => undefined); res.status(202).json({ job: { id: s.id }, jobUrl: `/api/projects/${req.project.id}/jobs/${s.id}` }); return; }
    const out = await s.done as Built;
    record(out);
    // PUB-005: what the build said about the document (notes, image references, security confinements) comes back with the answer
    res.set('X-Job-Id', s.id).json({ ok: true, ruleBreaks: out.ruleBreaks ?? [], totalMs: out.totalMs, bytes: fs.statSync(out.pdf).size, releaseLabel: out.releaseLabel, pdfUrl: `/api/projects/${req.project.id}/publish/pdf`, jobId: s.id, report: jobs.buildReport(req.project.id, s.id) });
  }));

  /*
    The PDF to hand out. It is rebuilt first when the file on disk no longer says the right thing: built
    before an approval it carries NOT RELEASED; built from older content it is out of date. So after
    approval the download is the clean released copy, and until then it always carries the watermark.
  */
  app.get(`${base}/publish/download`, view('reviewer', 'publish.build'), wrap(async (req, res) => {
    const st = release.releaseStateOf(req.project.id);
    const abs = path.join(projectDirFor(req.project.id), publisher.PDF_NAME);
    const built = publisher.lastBuildState(req.project.id);
    if (!fs.existsSync(abs) || !built || built.fingerprint !== st.fingerprint || built.released !== st.released) {
      // WP-14 (PERF-015): still rebuilt here, because the page links to this address for the released copy; but as a job (deadline,
      // one per project, joined with an identical queued build), never on the server's thread
      await jobs.run({ kind: 'publish', projectId: req.project.id, params: {}, actor: actor(req) });
    }
    const name = `${(readProjectJson(req.project.id).name || req.project.id).replace(/[^\w.\- ]/g, '_')}${st.released ? '' : ' (NOT RELEASED)'}.pdf`;
    log(req, 'publish.downloaded', { released: st.released });
    res.set('X-Release-State', st.released ? 'released' : 'not-released');
    res.type('application/pdf').attachment(name).sendFile(abs);
  }));

  app.post(`${base}/publish/preview/:file`, view('reviewer', 'publish.preview'), wrap(async (req, res) => {
    csdb.resolveDmFile(req.project.id, param(req, 'file'));
    const out = await jobs.run<{ pdf: string; totalMs?: number }>({ kind: 'preview', projectId: req.project.id, params: { file: param(req, 'file') }, actor: actor(req) });
    res.set('X-Build-Ms', String(out.totalMs ?? '')).set('X-Job-Id', String(out.jobId ?? ''));
    res.type('application/pdf').sendFile(out.pdf);
  }));

  app.get(`${base}/publish/pdf`, view('viewer'), wrap((req, res) => {
    const abs = path.join(projectDirFor(req.project.id), publisher.PDF_NAME);
    if (!fs.existsSync(abs)) throw notFound('This publication has not been built yet.');
    const name = `${(readProjectJson(req.project.id).name || req.project.id).replace(/[^\w.\- ]/g, '_')}.pdf`;
    res.type('application/pdf');
    if (req.query.download === '1') res.attachment(name);
    res.sendFile(abs);
  }));

  // ── Settings (project layer + shared house template) ────────────────────
  app.get(`${base}/settings`, view('viewer'), wrap((req, res) => {
    const project = readProjectJson(req.project.id);
    const ref = project.templateRef || 'default';
    const tdir = path.join(workspaceDir, 'templates');
    let house: any = {};
    try { house = JSON.parse(fs.readFileSync(path.join(tdir, `${ref}.house.json`), 'utf8')); } catch { /* falls back to stylesheet defaults */ }
    const templates = fs.existsSync(tdir) ? fs.readdirSync(tdir).filter((f) => /\.house\.json$/i.test(f)).map((f) => f.replace(/\.house\.json$/i, '')).sort() : [];
    res.json({ version: settingsVersion(req.project.id),     // the version a save names (WP-11, FE-008)
      projectId: req.project.id, templateRef: ref, house, project, templates,
      canEditHouse: req.project.role === 'owner' || req.project.role === 'manager' || req.auth.user.role === 'admin',
      frontMatterCatalogue: CATALOGUE.map((p: any) => ({ id: p.id, label: p.label, title: p.title, generated: !!p.generated, required: !!p.required })),
    });
  }));

  app.put(`${base}/settings`, view('editor', 'settings.write'), versionGuard('settings'), wrap((req, res) => {
    const { house, project } = req.body ?? {};
    if (!house && !project) throw bad('Nothing to save.');
    const current = readProjectJson(req.project.id);
    const ref = project?.templateRef || current.templateRef || 'default';
    if (!/^[\w.-]+$/.test(ref)) throw bad('Bad template name.');
    // WP-11 (FE-008): the settings (the project file and its house template) are saved only over the version the editor loaded
    if (res.locals.baseHash !== undefined && res.locals.baseHash !== settingsVersion(req.project.id)) throw conflict('The settings were changed by someone else since you opened them. Reload to see their changes.', 'EDIT_CONFLICT', { currentVersion: settingsVersion(req.project.id) });

    if (house) {
      // The house template is shared by every project that uses it, so changing it is the owner's call.
      if (req.project.role !== 'owner' && req.project.role !== 'manager' && req.auth.user.role !== 'admin') {
        throw new HttpError(403, 'Only a project owner or manager can change the shared house template.', 'HOUSE_OWNER_ONLY');
      }
      const tdir = path.join(workspaceDir, 'templates');
      fs.mkdirSync(tdir, { recursive: true });
      if (!house.id) house.id = ref;
      writeFileAtomic(path.join(tdir, `${ref}.house.json`), JSON.stringify(house, null, 2) + '\n');
    }
    if (project) {
      if (typeof project !== 'object' || Array.isArray(project)) throw bad('The project settings must be an object.');
      // WP-01 (SEC-002, S1K-001, PUB-001): the settings screen never owns what makes the project this project or where its
      // files are. Those keys always keep the value on disk, whatever the body says; a body that tries to change one is refused
      // so that a forged request is visible rather than silently half-applied.
      // Hostile path values and a change of the project's kind are refused outright; a stale name or folder (renamed in another
      // tab while this screen was open) is not an attack, so those keys simply keep the value on disk.
      if (unsafeInputFields(project).length) throw new HttpError(400, `Unsafe file location in the project settings (${unsafeInputFields(project).join(', ')}): only a relative path inside the project is allowed.`, 'UNSAFE_PATH');
      { const art = unsafeArtwork(project); if (art.length) throw new HttpError(400, `Unsafe picture reference in the project settings (${art.slice(0, 3).join(', ')}): use a picture uploaded to the project (a path such as Media/logo.png), not a web address or a file elsewhere on the computer.`, 'UNSAFE_ARTWORK'); }
      for (const k of ['id', 'format', 'authoring', 'type'] as const) {
        if (k in project && !sameSetting(project[k], current[k])) throw new HttpError(400, `"${k}" cannot be changed from the project settings.`, 'PROTECTED_SETTING');
      }
      updateProjectJson(req.project.id, (pj) => {
        const keep: Record<string, unknown> = { watermark: pj.watermark, validation: pj.validation };   // validation: the issue chosen on the Validation page
        const fixed: Record<string, unknown> = {};
        for (const k of PROTECTED_PROJECT_KEYS) fixed[k] = pj[k];
        for (const k of Object.keys(pj)) delete pj[k];
        Object.assign(pj, project);
        for (const [k, v] of Object.entries(keep)) if (v !== undefined && pj[k] === undefined) pj[k] = v;
        for (const [k, v] of Object.entries(fixed)) { if (v === undefined) delete pj[k]; else pj[k] = v; }
      });
    }
    log(req, 'settings.saved', { house: !!house, project: !!project });
    res.json({ ok: true, templateRef: ref, version: settingsVersion(req.project.id) });
  }));

  void authz;
}

/**
 * The version of a project's settings (WP-11, FE-008): the project file and the house template it uses, hashed together. The settings
 * screen loads it with the settings and names it when it saves; a change by anyone else in between (also to the shared house template
 * from another project) makes the save a conflict instead of a silent overwrite.
 */
export function settingsVersion(projectId: string): string {
  const read = (p: string): string => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const pjText = read(content.pathOf(projectId, 'project.json'));
  let ref = 'default';
  try { ref = String(JSON.parse(pjText).templateRef || 'default'); } catch { /* default */ }
  const house = /^[\w.-]+$/.test(ref) ? read(path.join(workspaceDir, 'templates', `${ref}.house.json`)) : '';
  return csdb.sha(`${csdb.sha(pjText)}:${csdb.sha(house)}`);
}

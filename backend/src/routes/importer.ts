// =============================================================================
// Package importer routes - bring a foreign S1000D package (Xignal/Docuneering, Vektra, any other) into a
// project: scan it, repair what is repairable, write it, then place the modules no publication claimed.
//
//   POST /api/projects/:id/import/scan        files and/or a zip  -> report (nothing is written)
//   POST /api/projects/:id/import/apply       same upload + options -> writes, returns the change log
//   GET  /api/projects/:id/import/unassigned  the pool, the sub-publications, where modules can go
//   POST /api/projects/:id/import/assign      move pool modules into the publication
//   GET  /api/projects/:id/import/report      what earlier imports did: the batches, and one batch's change log (?batch=<id>, default the latest)
//
// Same role pattern as the neighbouring content routes: whoever may write data modules (an Author or above
// on the project) may scan and apply; whoever may write the publication may assign; a viewer may look.
// Options travel as form fields next to the files: `options` (JSON) or the flat fields named below.
// =============================================================================

import type { Express, RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { cappedDiskUpload, uploadedBytes, discardWhenDone } from '../services/uploads';
import { requireProject, audit, projectDirFor } from '../context';
import { wrap, bad, notFound, HttpError } from '../services/http';
import * as csdb from '../services/csdb';
import * as pm from '../services/pm';
import { readProjectJson } from '../services/projects';
import { vendor } from '../config';
import { analyzePackage } from '../services/importer/scanner';
import { RULES } from '../services/importer/repair';
import { applyImport, type ApplyOptions } from '../services/importer/apply';
import { loadState, saveState, ORIGINALS_DIR } from '../services/importer/state';
import { assignToTree, outline, type AssignTarget, type ModuleToPlace } from '../services/importer/assign';
import { entryForIdent } from '../services/importer/reconstruct';
import { dmKey, parseDmIdent } from '../services/importer/identity';
import { parsePmComplete } from '../services/importer/pmComplete';
import { ZipError } from '../services/importer/zipRead';
import { REPAIR_RULES, type PackageEntry, type RepairRuleId } from '../services/importer/types';

/** A package is many files (the Xignal sample is 710, mostly graphics) - far more than the data module import's 1000-file cap allows for. */
export const MAX_PACKAGE_FILES = 5000;
/** One upload, all files together: checked while it streams to disk (WP-11). The analysis still reads the files into memory, so the ceiling stays explicit. */
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

// WP-11 (REL-007, PERF-010): the files stream to disk and the whole request is capped while it arrives (uploads.ts), never buffered in memory first.
const upload = cappedDiskUpload({ fileSize: MAX_FILE_BYTES, files: MAX_PACKAGE_FILES, totalBytes: MAX_PACKAGE_BYTES });
const packageUpload: RequestHandler = (req, res, next) => {
  upload.array('files', MAX_PACKAGE_FILES)(req, res, (err: unknown) => {
    if (!err) { discardWhenDone(req, res); return next(); }
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `Too many files: one import takes at most ${MAX_PACKAGE_FILES}. Send the package as a zip, or in parts.`, code: 'TOO_MANY_FILES', max: MAX_PACKAGE_FILES });
    if (code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `A file is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`, code: 'FILE_TOO_LARGE' });
    if (code === 'LIMIT_TOTAL_SIZE') return res.status(413).json({ error: `The upload is larger than ${MAX_PACKAGE_BYTES / 1048576} MB in total; one import takes at most that.`, code: 'UPLOAD_TOO_LARGE' });
    return next(err);
  });
};

const view = (min: string, cap = 'project.read'): RequestHandler => requireProject(min, { from: 'param', cap });
const truthy = (v: unknown): boolean => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v ?? ''));

/** Options from `options` (JSON) and/or flat form fields; the flat field wins. */
export function parseOptions(body: Record<string, unknown> | undefined): ApplyOptions {
  const b = body ?? {};
  let json: Record<string, unknown> = {};
  if (typeof b.options === 'string' && b.options.trim()) {
    try { json = JSON.parse(b.options) as Record<string, unknown>; } catch { throw bad('`options` must be JSON.', 'BAD_OPTIONS'); }
  } else if (b.options && typeof b.options === 'object') json = b.options as Record<string, unknown>;
  const pick = (k: string): unknown => (b[k] !== undefined ? b[k] : json[k]);

  let repairs: unknown = pick('repairs');
  if (typeof repairs === 'string') {
    const t = repairs.trim();
    if (t.startsWith('[')) { try { repairs = JSON.parse(t); } catch { throw bad('`repairs` must be a JSON array of rule ids.', 'BAD_OPTIONS'); } }
    else repairs = t ? t.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  const out: ApplyOptions = {};
  if (repairs !== undefined) {
    if (!Array.isArray(repairs)) throw bad('`repairs` must be an array of rule ids.', 'BAD_OPTIONS');
    const unknown = repairs.filter((r) => !(REPAIR_RULES as readonly string[]).includes(String(r)));
    if (unknown.length) throw bad(`Unknown repair rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Known: ${REPAIR_RULES.join(', ')}.`, 'UNKNOWN_RULE');
    out.repairs = repairs.map(String) as RepairRuleId[];
  }
  if (pick('assembleUnassigned') !== undefined) out.assembleUnassigned = truthy(pick('assembleUnassigned'));
  if (pick('overwrite') !== undefined) out.overwrite = truthy(pick('overwrite'));
  if (pick('neutraliseMissingBrex') !== undefined) out.neutraliseMissingBrex = truthy(pick('neutraliseMissingBrex'));
  const pub = pick('publication');
  if (pub !== undefined) {
    if (!['auto', 'replace', 'keep'].includes(String(pub))) throw bad('`publication` is auto, replace or keep.', 'BAD_OPTIONS');
    out.publication = String(pub) as ApplyOptions['publication'];
  }
  const issue = pick('targetIssue');
  if (typeof issue === 'string' && issue) out.targetIssue = issue;
  return out;
}

/** The uploaded files as package entries. `paths` (JSON array, parallel to `files`) keeps folder structure a browser flattens. */
export function entriesFromUpload(files: Express.Multer.File[], body: Record<string, unknown> | undefined): PackageEntry[] {
  let paths: unknown[] = [];
  const raw = body?.paths;
  if (typeof raw === 'string' && raw.trim()) { try { paths = JSON.parse(raw) as unknown[]; } catch { throw bad('`paths` must be a JSON array of relative file paths.', 'BAD_OPTIONS'); } }
  else if (Array.isArray(raw)) paths = raw;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_PACKAGE_BYTES) throw new HttpError(413, `The upload is ${(total / 1048576).toFixed(0)} MB; one import takes at most ${MAX_PACKAGE_BYTES / 1048576} MB.`, 'UPLOAD_TOO_LARGE');
  return files.map((f, i) => ({ name: typeof paths[i] === 'string' && paths[i] ? String(paths[i]) : f.originalname, bytes: uploadedBytes(f) }));
}

export function registerImporterRoutes(app: Express): void {
  const base = '/api/projects/:id/import';
  const actor = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const guardZip = (e: unknown): never => {
    if (e instanceof ZipError) throw bad(`The zip could not be read: ${e.message}`, 'BAD_ZIP');
    throw e;
  };

  // ── scan: nothing is written ────────────────────────────────────────────
  app.post(`${base}/scan`, view('editor', 'dm.write'), packageUpload, wrap((req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw bad('No files uploaded.');
    const options = parseOptions(req.body);
    let report;
    try { report = analyzePackage(entriesFromUpload(files, req.body), { ...options, projectName: readProjectJson(req.project.id).name }).report; } catch (e) { guardZip(e); }
    log(req, 'import.scanned', { files: files.length, flavour: report!.flavour.id, errors: report!.summary.errors });
    res.json({ report, rules: RULES });
  }));

  // ── apply: writes ───────────────────────────────────────────────────────
  app.post(`${base}/apply`, view('editor', 'dm.write'), packageUpload, wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw bad('No files uploaded.');
    const options = parseOptions(req.body);
    let out;
    try { out = await applyImport(req.project.id, entriesFromUpload(files, req.body), options, actor(req), req.project.role); } catch (e) { guardZip(e); }
    log(req, 'import.applied', { batch: out!.batch.id, ...out!.batch.counts, flavour: out!.flavour.id, rules: out!.batch.rules, publication: out!.publication.mode });
    res.json(out);
  }));

  // ── the unassigned pool and where its modules can go ────────────────────
  const modulesOf = (projectId: string) => {
    const dms = csdb.listDms(projectId);
    const pmAbs = pm.pmPath(projectId);
    let entries: any[] = [];
    let hasPm = false;
    // The completing reader, not the vendored one: that keeps only the first reference of an entry that holds several, and the rest would show up here as
    // "unplaced" - and assigning them would then place them a second time.
    if (fs.existsSync(pmAbs)) { try { entries = parsePmComplete(fs.readFileSync(pmAbs, 'utf8')).entries; hasPm = true; } catch { entries = []; } }
    return { dms, entries, hasPm, pool: pm.unplaced(entries, dms) };
  };

  // ── report: what earlier imports did ─────────────────────────────────────
  // The apply response is the only place the change log used to be shown; it is gone once the screen is closed. The state file keeps the batches and each batch
  // keeps its change log beside the original bytes it replaced, so a later visit (or an auditor) can still see what was changed and why.
  app.get(`${base}/report`, view('viewer'), wrap((req, res) => {
    const projectDir = projectDirFor(req.project.id);
    const state = loadState(projectDir);
    if (!state.batches.length) throw notFound('Nothing has been imported into this project yet.');
    const wanted = typeof req.query.batch === 'string' ? req.query.batch.trim() : '';
    const batch = wanted ? state.batches.find((b) => b.id === wanted) : state.batches[state.batches.length - 1];
    if (!batch) throw notFound(`This project has no import batch "${wanted}".`);

    // batch.originals comes from a file in the project folder: never follow it out of the originals folder.
    const root = path.resolve(projectDir, ORIGINALS_DIR);
    const logFile = path.resolve(projectDir, batch.originals, 'change-log.json');
    let log: { by?: string; rules?: string[]; changes?: unknown[] } | null = null;
    if (logFile.startsWith(root + path.sep) && fs.existsSync(logFile)) { try { log = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch { log = null; } }
    const origDir = path.dirname(logFile);
    const originals = logFile.startsWith(root + path.sep) && fs.existsSync(origDir) ? fs.readdirSync(origDir).filter((f) => f !== 'change-log.json').length : 0;

    res.json({
      batch,
      batches: state.batches.map((b) => ({ id: b.id, at: b.at, by: b.by, flavour: b.flavour, counts: b.counts, publication: b.publication })),
      changeLog: log?.changes ?? [],
      changeLogAvailable: log !== null,
      rules: log?.rules ?? batch.rules,
      originalsKept: originals,
      subPublications: state.subPublications.map((s) => ({ pmCode: s.pmCode, title: s.entryTitle || s.pmTitle, status: s.status, materialisedAs: s.materialisedAs ?? null })),
      reusedDms: state.reusedDms,
      poolNotes: Object.keys(state.poolNotes).length,
      reconstructed: state.reconstructedPublication,
    });
  }));

  app.get(`${base}/unassigned`, view('viewer'), wrap((req, res) => {
    const { dms, entries, hasPm, pool } = modulesOf(req.project.id);
    const state = loadState(projectDirFor(req.project.id));
    res.json({
      count: pool.length,
      total: dms.length,
      hasPublication: hasPm,
      pool: pool.map((d) => {
        const note = state.poolNotes[d.file];
        return {
          file: d.file, dmc: d.dmc, techName: d.techName, infoName: d.infoName, infoCode: d.dmCodeAttrs.infoCode ?? '',
          reason: note?.reason ?? 'not-in-any-pmc', group: note?.group ?? '', anchorOf: note?.anchorOf,
        };
      }),
      subPublications: state.subPublications.map((s) => ({
        pmCode: s.pmCode, title: s.entryTitle || s.pmTitle, status: s.status, anchor: s.anchorDm, anchorBasis: s.anchorBasis, materialisedAs: s.materialisedAs ?? null,
      })),
      targets: outline(entries),
      reconstructed: state.reconstructedPublication,
      lastImport: state.batches[state.batches.length - 1] ?? null,
    });
  }));

  // ── assign: pool -> publication ────────────────────────────────────────
  app.post(`${base}/assign`, view('editor', 'pm.write'), wrap((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const names = Array.isArray(body.files) ? body.files.map(String) : [];
    if (!names.length) throw bad('`files` (an array of data module file names) is required.', 'NO_FILES');
    const to = (body.to ?? {}) as AssignTarget;
    if (to.folderPath !== undefined && !(Array.isArray(to.folderPath) && to.folderPath.every((n) => Number.isInteger(n) && n >= 0))) throw bad('`to.folderPath` is an array of child indexes.', 'BAD_TARGET');
    const reuse = truthy(body.reuse);

    const projectId = req.project.id;
    const pmAbs = pm.pmPath(projectId);
    if (!fs.existsSync(pmAbs)) throw notFound('This project has no publication to place modules in. Import with a publication, or create one in the Publication screen.');
    const model = parsePmComplete(fs.readFileSync(pmAbs, 'utf8'));
    const dms = new Map(csdb.listDms(projectId).map((d) => [d.file.toLowerCase(), d]));
    const dir = projectDirFor(projectId);

    const toPlace: ModuleToPlace[] = [];
    const refused: Array<{ file: string; reason: string }> = [];
    const moduleOf = (file: string): ModuleToPlace | null => {
      const hit = dms.get(file.toLowerCase());
      if (!hit) return null;
      const ident = parseDmIdent(csdb.readDm(projectId, hit.file).xml);
      return { file: hit.file, key: dmKey(ident.dmCodeAttrs, ident.identExtension).toUpperCase(), entry: entryForIdent(ident) };
    };
    for (const n of names) {
      const m = moduleOf(n);
      if (m) toPlace.push(m); else refused.push({ file: n, reason: 'no such data module in this project' });
    }

    const state = loadState(dir);
    const sub = to.subPublication ? state.subPublications.find((s) => s.pmCode === to.subPublication) : undefined;
    if (to.subPublication && !sub && !outline(model.entries).some((o) => o.pmCode === to.subPublication)) throw notFound(`No sub-publication ${to.subPublication} (see GET /import/unassigned).`);
    const anchor = sub?.anchorDm ? moduleOf(sub.anchorDm.file) ?? undefined : undefined;

    const result = assignToTree(model.entries, toPlace, to, { reuse, anchor, materialisedTitle: sub?.materialisedAs });
    const next = { meta: model.meta, entries: result.entries };
    const out = pm.writePm(projectId, next as any);
    if (result.materialised && sub) { sub.materialisedAs = result.materialised.title; saveState(dir, state); }
    else if (result.materialised) { state.subPublications.push({ pmCode: result.materialised.pmCode, pmCodeAttrs: {}, entryTitle: result.materialised.title, pmTitle: '', shortPmTitle: '', referencedFrom: '', entryPath: result.materialised.path, status: 'anchor-only', materialisedAs: result.materialised.title }); saveState(dir, state); }
    log(req, 'import.assigned', { placed: result.placed.length, refused: refused.length + result.refused.length, subPublication: to.subPublication });
    res.json({ placed: result.placed, refused: [...refused, ...result.refused], materialised: result.materialised ?? null, counts: out.counts, backup: out.backup });
  }));
}

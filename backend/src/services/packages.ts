// =============================================================================
// Packages: project export / import and delivery packages (ZIP).
//
//   PROJECT PACKAGE   everything of a project that is content: csdb/ (data modules, CSDB objects, ICNs), Media/, the publication module and
//                     a manifest.json (SHA-256 per file) - the round-trip format between AGASTYA installations.
//   DELIVERY PACKAGE  S1000D Issue 4.2 Chap 7.5.1 transfer package: ONE DDN + the data files, FLAT (no directories), plus an AGASTYA manifest
//                     (an extra file "by agreement"). Built from the publication module (its data modules, their ICNs and IMFs, the ACT/CCT/PCT
//                     and the BREX) or from selected modules. DML and DDN are generated where the issue has the schema (never invented).
//   IMPORT            two phases. PLAN: unpack to a staging directory (ZIP Slip / bomb / encryption checks in zipio.ts), classify each file by its
//                     S1000D name, validate it with the scope that fits it (a data module against its own declared schema; NEVER against the other
//                     modules - ids are only unique within one module), compare with what the project already holds. APPLY: only when nothing is
//                     rejected (or `partial`), and a failure part-way removes what this import created. The report says what happened to every file.
// Existing project files are never overwritten unless `overwrite` is set; the source ZIP is never modified.
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import { nowIso } from '../config';
import { projectDirFor } from '../context';
import { bad, HttpError } from './http';
import * as csdb from './csdb';
import { checkDmEnterprises } from './enterprises';
import { newDmProblems, getConfig } from './projectConfig';
import { csdbRel, mediaRel, pmRel, readProjectJson } from './projects';
import { publicationSources } from './pm';
import { headOf, rootStart } from './xmlHead';
import { assetProblem, formatOf } from './mediaFormats';
import { ICN_CODE_RE, refsOf, stripExt, riskyAllowed, svgProblem } from './assets';
import { OBJECT_FILE_RE, kindOfFile, listObjects, validateObject, writeObject, type ObjectActor } from './csdbObjects';
import { generateDdn, generateDml, resolveParty, type DeliveryItem, type Party } from './dispatch';
import { ZipFileReader, ZipStreamWriter, safeEntryName, DEFAULT_LIMITS, type ExtractLimits, ZipError } from './zipio';
import { hasSchema } from './registry';
import { analyse as analyseExt, usesForeign } from './extensions';
import { ISSUE_LABEL } from './s1000dRef';
import { settingsOf, type PackageSettings } from './packageSettings';

const { validateProjectSchema, declaredSchema } = require('../../vendor/engine/validateSchema');
const { checkXmlSafety } = require('../core/auth/xmlGuard');

export { MAX_UPLOAD_BYTES } from './uploads';
import { MAX_UPLOAD_BYTES, envPositive } from './uploads';
export const importLimits = (): ExtractLimits => ({ ...DEFAULT_LIMITS, maxEntryBytes: MAX_UPLOAD_BYTES, maxTotalBytes: envPositive('AGASTYA_MAX_EXPANDED_BYTES', 8 * 1024 ** 3) });

export type FileKind = 'dm' | 'pm' | 'object' | 'asset' | 'manifest' | 'other';
export interface PackageFile { path: string; abs: string; kind: FileKind; size: number; sha256: string }

const sha256File = (abs: string): string => { const h = crypto.createHash('sha256'); const fd = fs.openSync(abs, 'r'); const b = Buffer.alloc(1 << 20); try { for (let n; (n = fs.readSync(fd, b, 0, b.length, null)) > 0;) h.update(b.subarray(0, n)); } finally { fs.closeSync(fd); } return h.digest('hex'); };

export function classify(name: string): FileKind {
  const base = path.basename(name);
  if (/^(AGASTYA-)?manifest\.json$/i.test(base)) return 'manifest';
  if (csdb.DM_FILE_RE.test(base)) return 'dm';
  if (/^PMC-[A-Za-z0-9._-]+\.xml$/i.test(base) || /^publication\.xml$/i.test(base)) return 'pm';
  if (OBJECT_FILE_RE.test(base)) return 'object';
  if (formatOf(base) || /^ICN-/i.test(base)) return 'asset';
  return 'other';
}

/** The control number the DDN's delivery list uses: the file name without TYPE- and without the extension. */
export const entityControl = (file: string): string => stripExt(file).replace(/^[A-Z]{3}-/i, '');

/** Publication module file name from its own identification (Chap 7.5.1 para 2.3.6); null when the identification is incomplete. */
export function pmFileName(xml: string): string | null {
  const head = headOf(xml, 'pm', 20000);
  const g = (tag: string) => { const m = new RegExp(`<${tag}\\b([^>]*?)/?>`).exec(head); const o: Record<string, string> = {}; if (m) for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[a[1]] = a[2]; return o; };
  const c = g('pmCode'), i = g('issueInfo'), l = g('language');
  if (!c.modelIdentCode || !c.pmIssuer || !c.pmNumber || !c.pmVolume || !i.issueNumber || !l.languageIsoCode) return null;
  return `PMC-${[c.modelIdentCode, c.pmIssuer, c.pmNumber, c.pmVolume].join('-')}_${i.issueNumber}-${i.inWork}_${l.languageIsoCode}-${l.countryIsoCode}.XML`.toUpperCase();
}

const dirs = (projectId: string) => { const pj = readProjectJson(projectId); const root = projectDirFor(projectId); return { root, csdb: path.join(root, csdbRel(pj)), media: path.join(root, mediaRel(pj)), pm: path.join(root, pmRel(pj)), pj }; };

/** Every content file of a project, with a hash. */
export function projectInventory(projectId: string): PackageFile[] {
  const d = dirs(projectId); const out: PackageFile[] = [];
  const add = (abs: string, rel: string) => { const st = fs.statSync(abs); if (st.isFile()) out.push({ path: rel, abs, kind: classify(rel), size: st.size, sha256: sha256File(abs) }); };
  if (fs.existsSync(d.csdb)) for (const f of fs.readdirSync(d.csdb)) { const k = classify(f); if (k !== 'other' && k !== 'manifest') add(path.join(d.csdb, f), `csdb/${f}`); }
  if (fs.existsSync(d.media)) for (const f of fs.readdirSync(d.media)) if (classify(f) === 'asset') add(path.join(d.media, f), `Media/${f}`);
  if (fs.existsSync(d.pm)) add(d.pm, 'publication.xml');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Manifest { format: 'agastya-package'; version: 1; kind: 'project' | 'delivery'; createdAt: string; project: { name: string; mic: string; issue: string | null; /** What the project chose (a project package only): see services/packageSettings.ts. */ settings?: PackageSettings }; files: Array<{ path: string; kind: FileKind; size: number; sha256: string }>; notes: string[]; ddn?: string; dml?: string }

const manifestOf = (projectId: string, kind: Manifest['kind'], files: PackageFile[], notes: string[], extra: Partial<Manifest> = {}): Manifest => {
  const cfg = getConfig(projectId);
  return { format: 'agastya-package', version: 1, kind, createdAt: nowIso(), project: { name: readProjectJson(projectId).name ?? '', mic: cfg.mic, issue: cfg.issue ? ISSUE_LABEL[cfg.issue] : null }, files: files.map((f) => ({ path: f.path, kind: f.kind, size: f.size, sha256: f.sha256 })), notes, ...extra };
};

export async function exportProjectPackage(projectId: string, out: Writable): Promise<{ files: number }> {
  const files = projectInventory(projectId);
  const z = new ZipStreamWriter(out);
  const man = manifestOf(projectId, 'project', files, ['Round-trip project package. Paths are relative to the project; csdb/ holds data modules, CSDB objects and ICNs. project.settings holds the project configuration and both SNS systems (restored only when the package starts a new project).']);
  man.project.settings = settingsOf(projectId);
  await z.addBuffer('manifest.json', Buffer.from(JSON.stringify(man, null, 1)));
  for (const f of files) await z.addFile(f.path, f.abs, { store: f.kind === 'asset' });
  await z.finish();
  return { files: files.length };
}

// ── Delivery package ────────────────────────────────────────────────────────

export interface DeliveryOptions { files?: string[]; sender?: { code: string; name?: string; city?: string; country?: string }; receiver?: { code: string; name?: string; city?: string; country?: string }; includeDml?: boolean; remarks?: string; authorization?: string }
export interface DeliveryPlan { items: Array<{ name: string; abs: string; kind: FileKind; reason: string }>; notes: string[] }

export function planDelivery(projectId: string, o: DeliveryOptions): DeliveryPlan {
  const d = dirs(projectId); const cfg = getConfig(projectId); const notes: string[] = []; const items = new Map<string, { name: string; abs: string; kind: FileKind; reason: string }>();
  const put = (name: string, abs: string, kind: FileKind, reason: string) => { if (!items.has(name.toLowerCase()) && fs.existsSync(abs)) items.set(name.toLowerCase(), { name, abs, kind, reason }); };
  const dms = csdb.listDms(projectId); const byFile = new Map(dms.map((m) => [m.file.toLowerCase(), m]));
  let dmFiles: string[];
  if (o.files?.length) {
    dmFiles = o.files.map((f) => { const m = byFile.get(f.toLowerCase()); if (!m) throw bad(`${f} is not a data module of this project.`, 'UNKNOWN_FILE'); return m.file; });
  } else {
    if (!fs.existsSync(d.pm)) throw bad('This project has no publication module; choose modules to deliver.', 'NO_PM');
    const pmXml = fs.readFileSync(d.pm, 'utf8');
    put(pmFileName(pmXml) ?? 'publication.xml', d.pm, 'pm', 'publication module');
    if (!pmFileName(pmXml)) notes.push('The publication module has no complete pmCode/issueInfo/language, so it is delivered as publication.xml instead of an S1000D PMC file name.');
    dmFiles = publicationSources(projectId).map((p) => p.split('/').pop()!).filter((f) => csdb.DM_FILE_RE.test(f));
  }
  for (const f of dmFiles) put(f, path.join(d.csdb, f), 'dm', 'data module');
  // support modules every delivery needs: ACT / CCT / PCT and the BREX, when the project holds them
  for (const f of [cfg.applicability.act, cfg.applicability.cct, cfg.applicability.pct, cfg.brex.mode === 'project' ? cfg.brex.dmc : null]) if (f) { const m = byFile.get(String(f).toLowerCase()) ?? dms.find((x) => x.dmc === f); if (m) put(m.file, path.join(d.csdb, m.file), 'dm', 'applicability / BREX support module'); }
  // ICNs the delivered modules refer to (and their IMFs)
  const assets = new Map<string, string>(); for (const f of fs.existsSync(d.csdb) ? fs.readdirSync(d.csdb) : []) if (classify(f) === 'asset') assets.set(stripExt(f).toUpperCase(), f);
  const imfs = listObjects(projectId, 'imf');
  for (const it of [...items.values()].filter((x) => x.kind === 'dm')) {
    const r = refsOf(it.name, fs.readFileSync(it.abs, 'utf8'));
    for (const e of r.entities) { const f = fs.existsSync(path.join(d.csdb, e.file)) ? e.file : null; if (f) put(f, path.join(d.csdb, f), 'asset', `graphic of ${it.name}`); else notes.push(`${it.name}: graphic ${e.file} is not in the project and is NOT in the package.`); }
    for (const x of r.idents) { const f = assets.get(x.ident.toUpperCase()); if (f) put(f, path.join(d.csdb, f), 'asset', `graphic of ${it.name}`); }
  }
  for (const im of imfs) { if ([...items.values()].some((a) => a.kind === 'asset' && stripExt(a.name).toUpperCase() === `ICN-${im.control.replace(/_\d{3}-\d{2}$/, '')}`.toUpperCase())) put(im.file, path.join(d.csdb, im.file), 'object', 'illustration metadata'); }
  return { items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)), notes };
}

export async function exportDeliveryPackage(projectId: string, out: Writable, o: DeliveryOptions = {}): Promise<{ files: string[]; ddn: string | null; dml: string | null; notes: string[] }> {
  const cfg = getConfig(projectId); const plan = planDelivery(projectId, o); const notes = [...plan.notes];
  const extra: Array<{ name: string; data: Buffer; kind: FileKind }> = [];
  let dml: string | null = null; let ddn: string | null = null;
  if (o.includeDml) {
    if (cfg.issue && hasSchema(cfg.issue, 'dml')) { const g = await generateDml(projectId, { files: plan.items.filter((x) => x.kind === 'dm').map((x) => x.name), senderIdent: o.sender?.code }); extra.push({ name: g.file, data: Buffer.from(g.xml), kind: 'object' }); dml = g.file; }
    else notes.push('No DML schema for this issue: no data management list was produced.');
  }
  const deliver = [...plan.items.map((x) => ({ name: x.name, kind: x.kind, abs: x.abs, data: undefined as Buffer | undefined })), ...extra.map((x) => ({ name: x.name, kind: x.kind, abs: '', data: x.data }))];
  if (o.sender && o.receiver && cfg.issue && hasSchema(cfg.issue, 'ddn')) {
    const sender: Party = resolveParty(o.sender.code, o.sender, [cfg.responsiblePartner, cfg.originator]); const receiver: Party = resolveParty(o.receiver.code, o.receiver, [cfg.responsiblePartner, cfg.originator]);
    const items: DeliveryItem[] = deliver.map((x) => ({ file: x.name, control: entityControl(x.name) }));
    const g = await generateDdn(projectId, { sender, receiver, items, remarks: o.remarks, authorization: o.authorization }); if (!o.authorization) notes.push("The DDN's <authorization> (required by the schema) was set to the sender's enterprise name; give an authorization to override it."); ddn = g.file; extra.push({ name: g.file, data: Buffer.from(g.xml), kind: 'object' });
  } else if (!o.sender || !o.receiver) notes.push('No sender/receiver was given, so no data dispatch note was produced.');
  else notes.push(`S1000D ${cfg.issue ? ISSUE_LABEL[cfg.issue] : '?'}: no DDN schema is bundled, so no data dispatch note was produced.`);
  const z = new ZipStreamWriter(out);
  const allFiles: PackageFile[] = [];
  const seen = new Set<string>();
  for (const x of deliver) { seen.add(x.name.toLowerCase()); }
  for (const x of plan.items) { const st = fs.statSync(x.abs); allFiles.push({ path: x.name, abs: x.abs, kind: x.kind, size: st.size, sha256: sha256File(x.abs) }); }
  for (const x of extra) allFiles.push({ path: x.name, abs: '', kind: x.kind, size: x.data.length, sha256: crypto.createHash('sha256').update(x.data).digest('hex') });
  const names = allFiles.map((f) => f.path.toLowerCase()); const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw bad(`Two files would have the same name in the flat package: ${dup}.`, 'NAME_CLASH');
  for (const x of extra) await z.addBuffer(x.name, x.data);
  for (const x of plan.items) await z.addFile(x.name, x.abs, { store: x.kind === 'asset' });
  await z.addBuffer('AGASTYA-MANIFEST.json', Buffer.from(JSON.stringify(manifestOf(projectId, 'delivery', allFiles, [...notes, 'S1000D transfer package (Issue 4.2 Chap 7.5.1): flat, one DDN when its schema is bundled. This manifest is an AGASTYA addition.'], { ddn: ddn ?? undefined, dml: dml ?? undefined }), null, 1)));
  await z.finish();
  return { files: allFiles.map((f) => f.path), ddn, dml, notes };
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportOptions { overwrite?: boolean; partial?: boolean; skipChecks?: boolean; replacePm?: boolean; validate?: boolean; /** false: a data module naming an enterprise the Administrator has not registered is kept and reported, not refused (a JSS / JSG project does not author S1000D enterprise data, so the register is not its rule). Default true. */ enterprises?: boolean; /** Called with the package's manifest when it can be read (the new-project import takes the project settings from it). */ onManifest?: (m: Manifest) => void }
export type ItemStatus = 'accepted' | 'unchanged' | 'skipped' | 'rejected';
export interface ImportItem { path: string; as: FileKind; status: ItemStatus; message: string; schema?: string; xsdErrors?: number; xsdFirst?: string[]; sha256?: string; action?: 'create' | 'replace' }
export interface ImportReport { source: string; startedAt: string; finishedAt: string; applied: boolean; counts: Record<ItemStatus, number>; items: ImportItem[]; notes: string[]; manifest: { present: boolean; checked: number; mismatches: string[] } }

export async function importPackage(projectId: string, zipPath: string, sourceName: string, o: ImportOptions, actor: ObjectActor, role: string): Promise<ImportReport> {
  const startedAt = nowIso(); const d = dirs(projectId); const notes: string[] = []; const items: ImportItem[] = [];
  let reader: ZipFileReader;
  try { reader = ZipFileReader.open(zipPath, importLimits()); } catch (e) { if (e instanceof ZipError) throw new HttpError(400, `Package refused: ${e.message}`, 'PACKAGE_REFUSED', { reason: e.code }); throw e; }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-import-'));
  const created: string[] = [];
  try {
    // PLAN 1: unpack (names are checked inside; a bad name aborts the whole package - an archive that tries to escape is not partially trusted)
    const names = new Set<string>();
    try { for (const e of reader.entries) { const rel = safeEntryName(e.name); if (e.isDirectory) continue; const k = rel.toLowerCase(); if (names.has(k)) throw new ZipError(`duplicate entry ${JSON.stringify(rel)}.`, 'UNSAFE_NAME'); names.add(k); } }
    catch (e) { if (e instanceof ZipError) throw new HttpError(400, `Package refused: ${e.message}`, 'PACKAGE_REFUSED', { reason: e.code }); throw e; }
    try { await reader.extractTo(staging); } catch (e) { if (e instanceof ZipError) throw new HttpError(400, `Package refused: ${e.message}`, 'PACKAGE_REFUSED', { reason: e.code }); throw e; }
    const staged = reader.entries.filter((e) => !e.isDirectory).map((e) => ({ rel: safeEntryName(e.name), abs: path.join(staging, safeEntryName(e.name)) }));

    // manifest integrity
    const man = staged.find((s) => classify(s.rel) === 'manifest'); const mm: ImportReport['manifest'] = { present: !!man, checked: 0, mismatches: [] };
    if (man) {
      try {
        const m = JSON.parse(fs.readFileSync(man.abs, 'utf8')) as Manifest; o.onManifest?.(m);
        for (const f of m.files ?? []) { const hit = staged.find((s) => s.rel.toLowerCase() === String(f.path).toLowerCase() || path.basename(s.rel).toLowerCase() === path.basename(String(f.path)).toLowerCase()); if (!hit) { mm.mismatches.push(`${f.path}: listed in the manifest but not in the package`); continue; } mm.checked++; if (sha256File(hit.abs) !== f.sha256) mm.mismatches.push(`${f.path}: content differs from the manifest (SHA-256)`); }
      } catch { mm.mismatches.push('manifest.json could not be read'); }
    }

    // PLAN 2: judge each file
    const cfg = getConfig(projectId); const seen = new Map<string, { rel: string; sha: string }>(); const toCheck: Array<{ it: ImportItem; xml: string }> = []; let unregistered = 0;
    const known = new Map(csdb.listDms(projectId).map((m) => [csdb.identityKey(m), m.file]));
    for (const s of staged) {
      const kind = classify(s.rel); const base = path.basename(s.rel); const it: ImportItem = { path: s.rel, as: kind, status: 'accepted', message: '' };
      items.push(it);
      if (kind === 'manifest') { it.status = 'skipped'; it.message = 'Package manifest (used for the integrity check).'; continue; }
      if (kind === 'other') { it.status = 'skipped'; it.message = 'Not an S1000D CSDB object, graphic or multimedia file; ignored.'; continue; }
      const sha = sha256File(s.abs); it.sha256 = sha;
      const key = (kind === 'pm' ? 'PM' : base).toLowerCase(); const twin = seen.get(key);
      if (twin) { if (twin.sha === sha) { it.status = 'skipped'; it.message = `Same name and identical content as ${twin.rel}; counted once.`; } else { it.status = 'rejected'; it.message = `Same file name as ${twin.rel} but different content.`; } continue; }
      seen.set(key, { rel: s.rel, sha });
      try {
        if (kind === 'dm') {
          const xml = fs.readFileSync(s.abs, 'utf8'); const target = csdb.resolveDmFile(projectId, base); const exists = fs.existsSync(target);
          csdb.validateContent(`${csdbRel(d.pj)}/${base}`, xml, !!o.skipChecks);
          const mine = csdb.parseIdent(headOf(xml), base); const clash = known.get(csdb.identityKey(mine));
          if (clash && clash.toLowerCase() !== base.toLowerCase()) throw new Error(`same data module (code, issue, language) as ${clash}, held under another file name`);
          if (exists && sha256File(target) === sha) { it.status = 'unchanged'; it.message = 'Already in the project with identical content.'; continue; }
          if (exists && !o.overwrite) throw new Error('already in the project with different content (overwrite not requested)');
          if (!o.skipChecks) { const ep = checkDmEnterprises(xml); if (ep.length) { if (o.enterprises === false) unregistered++; else throw new Error(ep[0]); } if (!exists) { const np = newDmProblems(projectId, xml); if (np.length) throw new Error(np[0]); } }
          it.action = exists ? 'replace' : 'create'; it.message = exists ? 'Replaces the project\'s file (history keeps the old content).' : 'New data module.';
          it.schema = mine.schema || undefined;
          if (o.validate !== false) toCheck.push({ it, xml });                                    // this module against ITS schema only (batched below)
        } else if (kind === 'object') {
          const xml = fs.readFileSync(s.abs, 'utf8'); const target = path.join(d.csdb, base);
          const g = checkXmlSafety(xml); if (!g.ok) throw new Error(g.error);
          validateObject(base, xml, !!o.skipChecks); const exists = fs.existsSync(target);
          if (exists && sha256File(target) === sha) { it.status = 'unchanged'; it.message = 'Already in the project with identical content.'; continue; }
          if (exists && !o.overwrite) throw new Error('already in the project with different content (overwrite not requested)');
          it.action = exists ? 'replace' : 'create'; it.message = `${kindOfFile(base)} object.`;
          if (o.validate !== false) toCheck.push({ it, xml });
        } else if (kind === 'pm') {
          const xml = fs.readFileSync(s.abs, 'utf8'); const g = checkXmlSafety(xml); if (!g.ok) throw new Error(g.error);
          if (rootStart(xml, 'pm') < 0) throw new Error('no <pm> root element');
          const exists = fs.existsSync(d.pm);
          if (exists && sha256File(d.pm) === sha) { it.status = 'unchanged'; it.message = 'Same publication module.'; continue; }
          if (exists && !o.replacePm) { it.status = 'skipped'; it.message = 'The project already has a publication module; kept (ask to replace it to use this one).'; continue; }
          it.action = exists ? 'replace' : 'create'; it.message = 'Publication module.';
          if (o.validate !== false) toCheck.push({ it, xml });
        } else if (kind === 'asset') {
          const why = assetProblem(base, riskyAllowed()); if (why) throw new Error(why);
          const isIcn = /^ICN-/i.test(base); const target = path.join(isIcn ? d.csdb : d.media, base); const exists = fs.existsSync(target);
          if (/\.svg$/i.test(base)) { const bad1 = svgProblem(fs.readFileSync(s.abs, 'utf8')); if (bad1) throw new Error(`SVG refused: ${bad1}`); }
          if (isIcn && !ICN_CODE_RE.test(stripExt(base))) it.message = 'ICN name does not follow ICN-<unique id>-<issue>-<security>; stored as it is.';
          if (exists && sha256File(target) === sha) { it.status = 'unchanged'; it.message = 'Already in the project with identical content.'; continue; }
          if (exists && !o.overwrite) throw new Error('already in the project with different content (overwrite not requested)');
          it.action = exists ? 'replace' : 'create'; it.message ||= 'Graphic / multimedia file.';
        }
      } catch (e) { it.status = 'rejected'; it.message = (e as Error).message; }
    }
    void cfg;
    if (unregistered) notes.push(`${unregistered} data module${unregistered === 1 ? ' names' : 's name'} an enterprise that is not in the Administrator's lists. They were kept as received; this kind of project does not check them.`);
    if (toCheck.length) await xsdBatch(projectId, staging, toCheck.filter((c) => c.it.status === 'accepted'));
    const rejected = items.filter((i) => i.status === 'rejected').length; const integrity = mm.mismatches.length > 0;
    if (integrity) notes.push('The manifest check found differences; the package was not applied.');
    const applied = !integrity && (rejected === 0 || !!o.partial);
    if (applied) {
      try {
        for (const it of items.filter((i) => i.status === 'accepted' && i.action)) {
          const src = path.join(staging, it.path); const base = path.basename(it.path);
          if (it.as === 'dm') { const xml = fs.readFileSync(src, 'utf8'); if (it.action === 'replace') await csdb.writeDm(projectId, base, xml, undefined, actor, role, !!o.skipChecks); else { await csdb.createDm(projectId, base, xml, actor, !!o.skipChecks); created.push(path.join(d.csdb, base)); } }
          else if (it.as === 'object') { const r = await writeObject(projectId, base, fs.readFileSync(src, 'utf8'), actor, { overwrite: true, lenient: !!o.skipChecks }); if (r.created) created.push(path.join(d.csdb, base)); }
          else if (it.as === 'pm') { if (fs.existsSync(d.pm)) fs.copyFileSync(d.pm, `${d.pm}.bak`); else created.push(d.pm); fs.copyFileSync(src, d.pm); }
          else if (it.as === 'asset') { const dest = path.join(/^ICN-/i.test(base) ? d.csdb : d.media, base); fs.mkdirSync(path.dirname(dest), { recursive: true }); if (!fs.existsSync(dest)) created.push(dest); fs.copyFileSync(src, dest); }
        }
      } catch (e) { for (const f of created) try { fs.unlinkSync(f); } catch { /* best effort */ } throw bad(`Import failed part-way and was rolled back: ${(e as Error).message}`, 'IMPORT_FAILED'); }
    }
    for (const i of items) if (!applied && i.status === 'accepted') i.message = `${i.message} (not applied)`.trim();
    const counts: Record<ItemStatus, number> = { accepted: 0, unchanged: 0, skipped: 0, rejected: 0 }; for (const i of items) counts[i.status]++;
    const report: ImportReport = { source: sourceName, startedAt, finishedAt: nowIso(), applied, counts, items, notes, manifest: mm };
    try { const rd = path.join(d.root, '.import-reports'); fs.mkdirSync(rd, { recursive: true }); fs.writeFileSync(path.join(rd, `${startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 1)); } catch { /* the report is still returned */ }
    return report;
  } finally { reader.close(); fs.rmSync(staging, { recursive: true, force: true }); }
}

/**
 * XSD scope = each file against its OWN declared schema (never against the other files). Files are validated in groups per schema - the validator carries the
 * schema set into WebAssembly on every call, so one call per file would cost seconds per file. Diagnostics are reported, not fatal (the publication gate
 * decides later). Files using another namespace are judged with enabled extension content set aside (services/extensions.ts).
 */
async function xsdBatch(projectId: string, staging: string, items: Array<{ it: ImportItem; xml: string }>): Promise<void> {
  const direct: string[] = []; const hostRels: string[] = []; const hostDir = path.join(staging, '.ext-host'); const extErrors = new Map<string, string[]>();
  for (const { it, xml } of items) {
    try {
      if (usesForeign(xml)) {
        const a = await analyseExt(projectId, xml); extErrors.set(it.path, a.findings.filter((f) => f.severity === 'error').map((f) => `line ${f.line}: ${f.rule} - ${f.message}`));
        const dest = path.join(hostDir, it.path); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, a.host, 'utf8'); hostRels.push(it.path);
      } else direct.push(it.path);
    } catch (e) { it.message += ` Not schema-checked: ${(e as Error).message}`; }
  }
  const byRel = new Map<string, { errors: string[]; note?: string; schema?: string }>();
  const take = (res: { issues: any[] }) => { for (const i of res.issues) { const e = byRel.get(i.rel) ?? byRel.set(i.rel, { errors: [] }).get(i.rel)!; if (i.sev === 'crit' || i.sev === 'error') e.errors.push(`line ${i.line}: ${String(i.detail).replace(/ \(Issue [\d.]+, [\w.]+\)$/, '')}`); else e.note = i.detail; } };
  try { if (direct.length) take(await validateProjectSchema(staging, direct, {})); if (hostRels.length) take(await validateProjectSchema(hostDir, hostRels, { includeNotes: true })); }
  catch (e) { for (const { it } of items) it.message += ` Not schema-checked: ${(e as Error).message}`; return; } finally { fs.rmSync(hostDir, { recursive: true, force: true }); }
  for (const { it, xml } of items) {
    const r = byRel.get(it.path); const ext = extErrors.get(it.path) ?? [];
    it.schema ??= declaredSchema(xml)?.file?.replace(/\.xsd$/, '');
    if (r?.note && !r.errors.length && !ext.length) { it.message += ` Not schema-checked: ${r.note}`; continue; }
    it.xsdErrors = (r?.errors.length ?? 0) + ext.length; if (it.xsdErrors) it.xsdFirst = [...ext, ...(r?.errors ?? [])].slice(0, 3);
  }
}

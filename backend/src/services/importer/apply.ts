// =============================================================================
// Apply: write a scanned-and-repaired package into a project. The only importer stage with side effects.
//
// Same guarantees as the existing multi-file import (routes/project-content.ts `dms-import`):
//   - every file is judged BEFORE anything is written, so a bad file 150 of 218 cannot leave a half-imported batch;
//   - file naming (DMC-*.xml), safety (entity bombs, external entities), well-formedness and "a data module
//     exists once per project" are never skipped;
//   - the Administrator's enterprise lists are CHECKED but only reported: a foreign package (Vektra writes
//     the template enterprise "ENTERPRISE") would otherwise be impossible to bring in at all.
// And what the importer adds:
//   - the ORIGINAL bytes of every file a repair changed are kept in import-originals/<batch>/ with the
//     change log, so nothing a repair did is irreversible;
//   - images land beside the data modules (csdb/), where DOCTYPE entities resolve; a placeholder never
//     overwrites a real image, and a real image replaces an earlier placeholder;
//   - modules are written directly and indexed once (createDm re-reads the whole project for every file,
//     which is minutes for a 218-module book); the revision history entry is cut exactly as createDm does.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso, vendor } from '../../config';
import { projectDirFor, docIndex, revisions, content } from '../../context';
import { headOf } from '../xmlHead';
import { HttpError } from '../http';
import * as csdb from '../csdb';
import * as pm from '../pm';
import { checkDmEnterprises } from '../enterprises';
import { csdbRel, readProjectJson } from '../projects';
import { isPlaceholderPng } from './png';
import { externalTargets } from './repairs/icn';
import { analyzePackage } from './scanner';
import { repairedEntries } from './repair';
import { serialisePm } from './identity';
import { withReconstructedMarker } from './reconstruct';
import { ORIGINALS_DIR, loadState, saveState, type ImportBatch } from './state';
import type { ChangeEntry, PackageEntry, PackageReport, PoolItem, ReusedDm, RepairOptions, SubPublication } from './types';

export interface ApplyOptions extends RepairOptions {
  /** Replace modules that already exist in the project (same file name). Default: refuse. */
  overwrite?: boolean;
  /**
   * auto: replace the project's publication only when it has none (or an empty one); replace: always (the old one is kept as .bak);
   * keep: never - the imported modules then sit in the pool of the project's own publication.
   */
  publication?: 'auto' | 'replace' | 'keep';
}

export interface Actor { id: string; username: string; role?: string }

export interface ApplyResult {
  ok: true;
  batch: ImportBatch;
  imported: { dms: string[]; overwritten: string[]; media: string[]; mediaKept: string[]; skipped: string[] };
  publication: { mode: 'replaced' | 'kept' | 'none'; counts?: { folders: number; dms: number; total: number }; reconstructed: 'full' | 'metadata' | null; backup?: string };
  changeLog: ChangeEntry[];
  placeholders: Array<{ file: string; icn: string; declaredIn: string[] }>;
  pool: PoolItem[];
  subPublications: SubPublication[];
  reusedDms: ReusedDm[];
  withProblems: Array<{ file: string; problem: string }>;
  flavour: PackageReport['flavour'];
  summary: PackageReport['summary'];
  originals: string;
}

const SAFE_NAME = /[^\w.\- ]/g;
const safeName = (n: string): string => path.basename(n).replace(SAFE_NAME, '_');
const pmc = (): { parsePm(x: string): { entries: unknown[] }; countEntries(e: unknown[]): { folders: number; dms: number; total: number } } => vendor('engine/pmc');
const batchId = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export async function applyImport(projectId: string, entries: PackageEntry[], options: ApplyOptions, actor: Actor, projectRole: string): Promise<ApplyResult> {
  const pj = readProjectJson(projectId);
  const analysis = analyzePackage(entries, { ...options, projectName: options.projectName ?? pj.name });
  const { pkg, repair, report } = analysis;
  const projectDir = projectDirFor(projectId);
  const csdbPath = csdbRel(pj);
  const csdbAbs = csdb.csdbDir(projectId);

  // ── 1. judge everything before writing anything ─────────────────────────
  const problems: string[] = [];
  const withProblems: Array<{ file: string; problem: string }> = [];
  const staged: Array<{ name: string; xml: string; existed: boolean }> = [];
  const existing = csdb.listDms(projectId);
  const byFile = new Map(existing.map((d) => [d.file.toLowerCase(), d]));
  const identities = new Map(existing.map((d) => [csdb.identityKey(d), d.file]));
  const seenNames = new Map<string, string>();
  const seenIdentity = new Map<string, string>();
  if (!pkg.dms.length) problems.push('The package holds no data modules.');

  for (const d of pkg.dms) {
    const name = safeName(d.file.base);
    if (d.file.encodingProblem) { problems.push(`${d.file.path}: ${d.file.encodingProblem} Save it as UTF-8 and import again.`); continue; }
    if (!csdb.DM_FILE_RE.test(name)) { problems.push(`${d.file.path}: data module files are named DMC-<code>.xml`); continue; }
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) { problems.push(`${d.file.path}: same file name as ${seenNames.get(lower)} in this import`); continue; }
    seenNames.set(lower, d.file.path);
    const had = byFile.get(lower);
    if (had && !options.overwrite) { problems.push(`${name}: already exists in this project (set overwrite to replace it)`); continue; }
    if (had) {
      const doc = docIndex.resolve(projectId, `${csdbPath}/${name}`);
      if (doc?.locked_at && projectRole !== 'owner' && actor.role !== 'admin') { problems.push(`${name}: locked in this project; only a project owner can replace it`); continue; }
    }
    const bytes = repair.files.get(d.file.path) ?? d.file.bytes;
    const xml = Buffer.from(bytes).toString('utf8');
    try { csdb.validateContent(`${csdbPath}/${name}`, xml, false); } catch (e) { problems.push(`${name}: ${(e as Error).message}`); continue; }
    const key = csdb.identityKey(csdb.parseIdent(headOf(xml), name));
    const twin = seenIdentity.get(key);
    if (twin) { problems.push(`${name}: same data module (code, issue and language) as ${twin} in this import`); continue; }
    const clash = identities.get(key);
    if (clash && clash.toLowerCase() !== lower) { problems.push(`${name}: this project already has that data module as ${clash} (same code, issue and language)`); continue; }
    seenIdentity.set(key, name);
    const outside = externalTargets(xml);
    if (outside.length) { problems.push(`${name}: entity ${outside[0].name} points at "${outside[0].target}", outside the package; graphics must be files shipped with the modules`); continue; }
    for (const p of checkDmEnterprises(xml)) withProblems.push({ file: name, problem: p });
    staged.push({ name, xml, existed: !!had });
  }
  if (problems.length) throw new HttpError(400, 'Nothing was imported.', 'IMPORT_REFUSED', { problems });

  // ── 2. originals first: whatever a repair changes can be recovered ────────
  const id = batchId();
  const originalsRel = `${ORIGINALS_DIR}/${id}`;
  const originalsAbs = path.join(projectDir, originalsRel);
  fs.mkdirSync(originalsAbs, { recursive: true });
  const byPath = new Map(pkg.files.map((f) => [f.path, f]));
  for (const [p] of repair.files) {
    const orig = byPath.get(p);
    if (!orig) continue;                                   // a file the repair created has no original
    const dest = path.join(originalsAbs, ...p.split('/'));
    if (path.relative(originalsAbs, dest).startsWith('..')) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    content.writeBuffer(projectId, dest, orig.bytes);
  }
  content.writeText(projectId, path.join(originalsAbs, 'change-log.json'), JSON.stringify({ batch: id, by: actor.username, rules: repair.rulesRun, changes: repair.changeLog }, null, 2));

  // ── 3. data modules ──────────────────────────────────────────────────────
  fs.mkdirSync(csdbAbs, { recursive: true });
  const previous = new Map<string, string>();
  for (const s of staged) {
    const abs = csdb.resolveDmFile(projectId, s.name);
    if (s.existed) previous.set(s.name, fs.readFileSync(abs, 'utf8'));
    content.writeText(projectId, abs, s.xml);
  }
  await docIndex.syncProject(projectId, projectDir, nowIso());
  for (const s of staged) {
    try {
      const doc = docIndex.resolve(projectId, `${csdbPath}/${s.name}`);
      if (!doc) continue;
      const before = previous.get(s.name);
      if (before !== undefined && before !== s.xml) revisions.cut(doc.id, before, { reason: 'before-import', createdBy: actor.id, now: nowIso() });
      revisions.cut(doc.id, s.xml, { reason: 'import', createdBy: actor.id, now: nowIso() });
    } catch (e) { console.error('[importer] revision not recorded:', (e as Error).message); }
  }

  // ── 4. graphics, flat beside the modules ─────────────────────────────────
  const media: string[] = []; const mediaKept: string[] = [];
  const imagePaths = new Set<string>([...pkg.icns, ...pkg.images].map((f) => f.path));
  for (const ph of repair.placeholders) imagePaths.add(ph.file);
  const placeholderPaths = new Set(repair.placeholders.map((p) => p.file));
  const all = new Map(repairedEntries(pkg, repair).map((e) => [e.name, e.bytes]));
  for (const p of [...imagePaths].sort()) {
    const bytes = all.get(p);
    if (!bytes) continue;
    const name = safeName(p);
    const dest = path.join(csdbAbs, name);
    const incoming = Buffer.from(bytes);
    if (fs.existsSync(dest)) {
      const have = fs.readFileSync(dest);
      if (have.equals(incoming)) continue;
      const incomingIsPlaceholder = placeholderPaths.has(p);
      const haveIsPlaceholder = isPlaceholderPng(have);
      // A placeholder must never hide a real image; a real image replaces an earlier placeholder; two real ones need the overwrite flag.
      if (incomingIsPlaceholder || (!haveIsPlaceholder && !options.overwrite)) { mediaKept.push(name); continue; }
    }
    content.writeBuffer(projectId, dest, incoming);
    media.push(name);
  }

  // ── 5. the publication ───────────────────────────────────────────────────
  const mode = options.publication ?? 'auto';
  const pmAbs = pm.pmPath(projectId);
  let existingTotal = 0;
  if (fs.existsSync(pmAbs)) { try { existingTotal = pmc().countEntries(pmc().parsePm(fs.readFileSync(pmAbs, 'utf8')).entries).total; } catch { existingTotal = 0; } }
  const replace = !!repair.publication && (mode === 'replace' || (mode === 'auto' && existingTotal === 0));
  let publication: ApplyResult['publication'] = { mode: repair.publication ? 'kept' : 'none', reconstructed: null };
  if (repair.publication && replace) {
    let xml = serialisePm(repair.publication.model);
    const counts = pmc().countEntries(repair.publication.model.entries);
    const check = pmc().countEntries(pmc().parsePm(xml).entries);
    if (check.total !== counts.total || check.dms !== counts.dms) throw new Error('Internal check failed: the serialised publication does not read back identically. The modules were written; the publication was not.');
    if (repair.publication.reconstructed) xml = withReconstructedMarker(xml, repair.publication.reconstructed === 'full' ? 'synthesised from the data modules by the importer' : 'header rebuilt from the data modules by the importer');
    let backup: string | undefined;
    if (fs.existsSync(pmAbs)) {
      fs.copyFileSync(pmAbs, `${pmAbs}.bak`); backup = `${path.basename(pmAbs)}.bak`;
      fs.copyFileSync(pmAbs, path.join(originalsAbs, 'previous-publication.xml'));
    }
    content.writeText(projectId, pmAbs, xml);
    publication = { mode: 'replaced', counts, reconstructed: repair.publication.reconstructed, backup };
  }

  // ── 6. what the screen needs later ───────────────────────────────────────
  const state = loadState(projectDir);
  const poolNotes: typeof state.poolNotes = {};
  const importedNames = new Map(pkg.dms.map((d) => [d.file.path, safeName(d.file.base)]));
  if (replace) {
    for (const p of repair.pool) poolNotes[importedNames.get(p.file) ?? p.file] = { reason: p.reason, group: p.group };
    for (const s of repair.subPublications) {
      if (s.status === 'anchor-only' && s.anchorDm) { const n = importedNames.get(s.anchorDm.file) ?? s.anchorDm.file; poolNotes[n] = { ...(poolNotes[n] ?? { reason: 'sub-publication-not-in-package', group: '' }), anchorOf: s.pmCode }; }
    }
  } else {
    for (const d of pkg.dms) poolNotes[importedNames.get(d.file.path) ?? d.file.path] = { reason: 'imported-into-existing-publication', group: '' };
  }
  const batch: ImportBatch = {
    id, at: nowIso(), by: actor.username, flavour: report.flavour.id, rules: repair.rulesRun, assembleUnassigned: !!options.assembleUnassigned,
    counts: { dms: staged.length, media: media.length, placeholders: repair.placeholders.length, changes: repair.changeLog.length, pool: repair.pool.length },
    originals: originalsRel, publication: publication.mode, reconstructed: publication.reconstructed,
  };
  state.batches.push(batch);
  state.poolNotes = { ...state.poolNotes, ...poolNotes };
  if (replace) { state.subPublications = repair.subPublications; state.reusedDms = repair.reusedDms; state.reconstructedPublication = publication.reconstructed; }
  saveState(projectDir, state);

  return {
    ok: true, batch,
    imported: { dms: staged.filter((s) => !s.existed).map((s) => s.name), overwritten: staged.filter((s) => s.existed).map((s) => s.name), media, mediaKept, skipped: [...pkg.others, ...pkg.ignored].map((f) => f.path) },
    publication, changeLog: repair.changeLog, placeholders: repair.placeholders,
    pool: repair.pool, subPublications: repair.subPublications, reusedDms: repair.reusedDms,
    withProblems, flavour: report.flavour, summary: report.summary, originals: originalsRel,
  };
}

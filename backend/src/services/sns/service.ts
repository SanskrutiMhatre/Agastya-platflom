// =============================================================================
// SNS operations on a project: the glue between the pure SNS code (codes / model / derive / learn / pmxml) and the
// project on disk (its data modules, its publication module, its settings).
// =============================================================================

import fs from 'fs';
import path from 'path';
import { vendor } from '../../config';
import { bad } from '../http';
import { readProjectJson } from '../projects';
import { csdbDir, listDms, type DmSummary } from '../csdb';
import { pmPath, parseModel } from '../pm';
import { parseBrexModel } from '../brex';
import { readSidecar } from '../jssdm/sidecar';
import { projectDirFor } from '../../context';
import { INFO_CODE_GROUPS, DEFAULT_ORDER_KEYS, type OrderConfig } from './codes';
import { NON_CONTENT_INFO_CODES, deriveStructure, structureDms, type DeriveOptions, type Structure } from './derive';
import { learnSnsFromDms, snsRowsFromBrexModel } from './learn';
import { SnsTree, type SnsRow } from './model';
import { buildPmXml, defaultPmMeta, spliceContent, structureToPmEntries, type PmEntryOut } from './pmxml';
import { orgRepo, projectRepo, readProjectOrder, mergeRows, type MergeResult } from './store';

const pmc = vendor('engine/pmc');

/** The ordering table in force, for display and for overrides: the groups, the sort keys, and the project's own overrides. */
export function orderingInfo(projectId?: string) {
  return {
    groups: INFO_CODE_GROUPS,
    keys: DEFAULT_ORDER_KEYS,
    override: projectId ? readProjectOrder(projectId) ?? null : null,
    note: 'Modules of one SNS node are ordered by the keys in order. "info" ranks the information code by its group (position in `groups`), then by the code. Override with order.groups, order.rank, order.pinFirst, order.pinLast, order.keys.',
  };
}

/** Files that are front matter written by the front-matter DM generator, or consumed by the front-matter import: not part of the book body. */
export function frontMatterFiles(projectId: string): Set<string> {
  const sc = readSidecar(projectDirFor(projectId));
  return new Set([...Object.keys(sc.generated), ...Object.keys(sc.consumed)].map((f) => f.toLowerCase()));
}

export interface DeriveRequest {
  /** Where the SNS comes from: the project's own rows (default), the organisation defaults, or both (project rows win). */
  sns?: 'project' | 'defaults' | 'merged';
  order?: OrderConfig;
  collapseZero?: boolean;
  unmatched?: 'deepest' | 'unclassified';
  unclassifiedTitle?: string;
  titleFormat?: 'title' | 'code-title';
  /** Keep generated / consumed front-matter modules out of the structure (default true). */
  excludeFrontMatter?: boolean;
  /** 'replace' (default): the derived tree becomes the publication. 'unplaced': it is appended to the existing publication, for the modules it does not place yet. */
  placement?: 'replace' | 'unplaced';
  pmTitle?: string;
}

export interface DeriveOutcome {
  snsRows: number;
  structure: Structure;
  pm: { entries: number; xml: string; headerFrom: 'existing' | 'generated'; placement: 'replace' | 'unplaced' };
  hints: string[];
}

/** The SNS rows a derive request should use. */
export function rowsFor(projectId: string, source: DeriveRequest['sns'] = 'project'): SnsRow[] {
  const own = projectRepo(projectId).list();
  if (source === 'project') return own;
  const org = orgRepo.list();
  if (source === 'defaults') return org;
  const have = new Set(own.map((r) => `${r.systemDiffCode}|${r.systemCode}|${r.subSystemCode}|${r.subSubSystemCode}|${r.assyCode}`));
  return [...own, ...org.filter((r) => !have.has(`${r.systemDiffCode}|${r.systemCode}|${r.subSystemCode}|${r.subSubSystemCode}|${r.assyCode}`))];
}

function placedFiles(entries: any[], dms: DmSummary[]): Set<string> {
  // Modules the existing publication already places, by dmCode and by file name (the two reference styles).
  const { dmCodeString } = vendor('engine/resolveDmRefs');
  const codes = new Set<string>();
  const files = new Set<string>();
  (function walk(list: any[]) {
    for (const e of list ?? []) {
      if (e.type === 'folder') { walk(e.children ?? []); continue; }
      if (e.type === 'include' && e.href) files.add(String(e.href).replace(/\\/g, '/').replace(/^.*\//, '').toLowerCase());
      if (e.type === 'dm' && e.dmCode) codes.add(dmCodeString(e.dmCode, e.identExtension ?? null));
    }
  })(entries);
  return new Set(dms.filter((d) => files.has(d.file.toLowerCase()) || codes.has(d.dmc)).map((d) => d.file));
}

/** Derive (and describe) the publication a project's SNS implies. Writes nothing. */
export function deriveForProject(projectId: string, req: DeriveRequest = {}): DeriveOutcome & { absPm: string } {
  const placement = req.placement === 'unplaced' ? 'unplaced' : 'replace';
  const dms = listDms(projectId);
  const rows = rowsFor(projectId, req.sns);
  const hints: string[] = [];
  if (!rows.length) hints.push('This project has no SNS rows, so every data module will be Unclassified. Import the organisation defaults, import the BREX SNS, or learn rows from the modules first.');

  const absPm = pmPath(projectId);
  let existingXml: string | null = null;
  let existingEntries: PmEntryOut[] = [];
  let existingMeta: any = null;
  if (fs.existsSync(absPm)) {
    existingXml = fs.readFileSync(absPm, 'utf8');
    // The completing reader: with the vendored one, a publication entry that holds several references would come back with only the first, and
    // placing "the unplaced" (which rewrites <content> from these entries) would delete the rest.
    try { const parsed = parseModel(existingXml); existingEntries = parsed.entries as unknown as PmEntryOut[]; existingMeta = parsed.meta; } catch { existingXml = null; }
  }

  const exclude = new Set<string>();
  if (req.excludeFrontMatter !== false) for (const f of frontMatterFiles(projectId)) exclude.add(f);
  if (placement === 'unplaced') for (const f of placedFiles(existingEntries, dms)) exclude.add(f.toLowerCase());

  const opts: DeriveOptions = {
    order: req.order ?? readProjectOrder(projectId), collapseZero: req.collapseZero, unmatched: req.unmatched,
    unclassifiedTitle: req.unclassifiedTitle, exclude: [...exclude],
  };
  const structure = deriveStructure(dms.map((d) => ({ ...d })), new SnsTree(rows), opts);
  if (!structureDms(structure).length) hints.push(placement === 'unplaced' ? 'Every data module is already placed in the publication.' : 'There are no data modules to place.');

  const fresh = structureToPmEntries(structure, { titleFormat: req.titleFormat });
  const entries: PmEntryOut[] = placement === 'unplaced' ? [...existingEntries, ...fresh] : fresh;
  let xml: string | null = existingXml ? spliceContent(existingXml, entries) : null;
  const headerFrom: 'existing' | 'generated' = xml ? 'existing' : 'generated';
  if (!xml) {
    const model = dominant(dms.map((d) => d.dmCodeAttrs.modelIdentCode));
    const lang = dominant(dms.map((d) => d.language));
    const [l, c] = lang ? lang.split('-') : ['en', 'IN'];
    const meta = defaultPmMeta(req.pmTitle || readProjectJson(projectId).name || 'Publication', {
      ...(model ? { modelIdentCode: model } : {}), language: { languageIsoCode: l || 'en', countryIsoCode: (c || 'IN').toUpperCase() },
    });
    xml = buildPmXml(entries, meta);
  }
  // The same read-back guarantee pm.writePm gives: what is written parses to what was derived.
  const check = pmc.countEntries(pmc.parsePm(xml).entries);
  const want = pmc.countEntries(entries);
  if (check.dms !== want.dms || check.total !== want.total) throw new Error('Internal check failed: the derived publication does not read back identically. Nothing was written.');
  return { snsRows: rows.length, structure, pm: { entries: want.total, xml, headerFrom, placement }, hints, absPm };
}

/** How many earlier publications a project keeps from derives. */
export const DERIVE_BACKUPS_KEPT = 20;

/**
 * Keep the file about to be replaced: as <name>.bak (what every other writer of the publication leaves, always the latest) AND as a timestamped copy in
 * <name>.<yyyymmdd-hhmmss>.bak, of which the newest DERIVE_BACKUPS_KEPT remain. A derive replaces the whole structure, and two of them in a row used to leave
 * only the first derive's result to go back to. Returns the name of the timestamped copy.
 */
function keepBackup(abs: string): string {
  const dir = path.dirname(abs), name = path.basename(abs);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let copy = `${name}.${stamp}.bak`;
  for (let n = 2; fs.existsSync(path.join(dir, copy)); n++) copy = `${name}.${stamp}-${n}.bak`;   // two derives within one second
  fs.copyFileSync(abs, path.join(dir, copy));
  fs.copyFileSync(abs, abs + '.bak');
  const mine = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d{8}-\\d{6}(-\\d+)?\\.bak$`);
  const old = fs.readdirSync(dir).filter((f) => mine.test(f)).sort();       // the stamp sorts oldest first
  for (const f of old.slice(0, Math.max(0, old.length - DERIVE_BACKUPS_KEPT))) { try { fs.rmSync(path.join(dir, f)); } catch { /* best effort */ } }
  return copy;
}

/** Write a derived publication into the project (the previous file is kept as <name>.bak and in a timestamped history, see keepBackup). */
export function applyDerived(projectId: string, out: ReturnType<typeof deriveForProject>): { counts: { folders: number; dms: number; total: number }; backup: string | null } {
  if (!structureDms(out.structure).length && out.pm.placement === 'replace') throw bad('Refusing to replace the publication with an empty one: there are no data modules to place.', 'EMPTY_PM');
  const abs = out.absPm;
  let backup: string | null = null;
  if (fs.existsSync(abs)) backup = keepBackup(abs);
  fs.writeFileSync(abs, out.pm.xml, 'utf8');
  return { counts: pmc.countEntries(pmc.parsePm(out.pm.xml).entries), backup };
}

function dominant(values: string[]): string {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
}

// ── BREX and learning ────────────────────────────────────────────────────────

/** The SNS rows of every BREX data module (information code 022) in the project. Modules without snsRules are named in `notes`. */
export function brexRowsForProject(projectId: string): { rows: Array<Record<string, string>>; sources: string[]; notes: string[]; rejected: Array<{ path: string; errors: string[] }> } {
  const dir = csdbDir(projectId);
  const rows: Array<Record<string, string>> = [];
  const sources: string[] = [];
  const notes: string[] = [];
  const rejected: Array<{ path: string; errors: string[] }> = [];
  const seen = new Set<string>();
  for (const d of listDms(projectId).filter((x) => x.dmCodeAttrs.infoCode === '022')) {
    let model;
    try { model = parseBrexModel(fs.readFileSync(path.join(dir, d.file), 'utf8'), d.file, true); } catch (e) { notes.push(`${d.file}: ${(e as Error).message}`); continue; }
    if (!model.sns.length) { notes.push(`${d.file}: this BREX has no snsRules.`); continue; }
    sources.push(d.file);
    const got = snsRowsFromBrexModel(model.sns);
    rejected.push(...got.rejected.map((r) => ({ ...r, path: `${d.file}: ${r.path}` })));
    for (const r of got.rows) {
      const k = `${r.systemCode}|${r.subSystemCode}|${r.subSubSystemCode}|${r.assyCode}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ ...r });
    }
  }
  return { rows, sources, notes, rejected };
}

export function learnForProject(projectId: string) {
  const fm = frontMatterFiles(projectId);
  // Not the BREX and the other modules that support the publication (derive leaves them out of the structure for the same reason): their codes are
  // not a part of the product, and "00 - <project name>" proposed from a BREX is not an SNS node anyone wants.
  const dms = listDms(projectId)
    .filter((d) => !fm.has(d.file.toLowerCase()) && !(d.dmCodeAttrs.infoCode in NON_CONTENT_INFO_CODES))
    .map((d) => ({ ...d }));
  return learnSnsFromDms(dms, new SnsTree(projectRepo(projectId).list()));
}

export function importDefaultsInto(projectId: string, overwrite = false): MergeResult {
  return mergeRows(projectRepo(projectId), orgRepo.list().map(({ id: _id, ...r }) => r), { overwrite });
}

// =============================================================================
// Front-matter data modules on a project: read them into settings, write settings out as modules.
//
// The pure code (fromDms.ts, toDms.ts) knows nothing of projects. This is where a project's data modules, publication module,
// settings (project.json) and house template are found, and where the results are written back with the same safeguards the
// rest of the platform uses: createDm / writeDm (uniqueness, locks, revisions), a .bak beside a replaced publication module,
// a read-back of what was written.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso } from '../../config';
import { projectDirFor, workspaceDir } from '../../context';
import { bad } from '../http';
import { readProjectJson, updateProjectJson, csdbRel, mediaRel } from '../projects';
import { assertS1000dPublication } from '../projectRecord';
import { createDm, writeDm, csdbDir, listDms, listMedia, sha, type DmSummary } from '../csdb';
import { pmPath, parseModel } from '../pm';
import { buildPmXml, defaultPmMeta, pmContentXml, spliceContent, type PmEntryOut } from '../sns/pmxml';
import { vendor } from '../../config';
import { frontMatterFromDms, type FrontMatterImport } from './fromDms';
import { dmsFromFrontMatter, type GenIds, type GenerateResult } from './toDms';
import { couldBeFrontMatterCode, type PageId } from './reserved';
import { isGeneratedXml, readSidecar, writeSidecar } from './sidecar';

const pmc = vendor('engine/pmc');

// ── reading ────────────────────────────────────────────────────────────────────────────────────

export interface ImportRun {
  result: FrontMatterImport;
  /** Modules that looked like front matter and were read. */
  scanned: number;
  /** Whether a publication module was available (header fields and page order come from it). */
  publicationRead: boolean;
}

/** Front-matter candidates: reserved information code at the zero SNS code, and not a module this code generated itself. */
const isCandidate = (d: DmSummary, generated: Record<string, unknown>): boolean => {
  const a = d.dmCodeAttrs;
  return couldBeFrontMatterCode(String(a.infoCode ?? '')) && !(d.file in generated)
    && a.systemCode === '00' && /^0+$/.test(a.subSystemCode ?? '') && /^0+$/.test(a.subSubSystemCode ?? '') && /^0+$/.test(a.assyCode ?? '');
};

export function importFromProject(projectId: string): ImportRun {
  const dir = csdbDir(projectId);
  const pj = readProjectJson(projectId);
  const sc = readSidecar(projectDirFor(projectId));
  const mods = listDms(projectId).filter((d) => isCandidate(d, sc.generated));
  const dms: Array<{ file: string; xml: string }> = [];
  for (const d of mods) {
    const xml = fs.readFileSync(path.join(dir, d.file), 'utf8');
    if (isGeneratedXml(xml)) continue;                                         // written by this code: it came from the settings, not the other way
    dms.push({ file: d.file, xml });
  }
  const pmFile = pmPath(projectId);
  const pmXml = fs.existsSync(pmFile) ? fs.readFileSync(pmFile, 'utf8') : null;
  const files = [
    ...listMedia(projectId).map((m) => `${m.dir === 'Media' ? mediaRel(pj) : csdbRel(pj)}/${m.name}`),
  ];
  const result = frontMatterFromDms(dms, pmXml, { csdbDir: csdbRel(pj), files });
  return { result, scanned: dms.length, publicationRead: pmXml !== null };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isPlain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The engine's labels are nested (labels.title.for): merge down to the leaf, so a label the module did not mention is never lost and only a leaf that really differs is reported. */
function mergeLabels(cur: Record<string, any>, incoming: Record<string, any>, prefix: string, overwritten: string[]): void {
  for (const [k, v] of Object.entries(incoming)) {
    if (isPlain(v)) {
      const sub = isPlain(cur[k]) ? cur[k] : {};
      cur[k] = sub;
      mergeLabels(sub, v, `${prefix}.${k}`, overwritten);
    } else {
      if (k in cur && cur[k] !== v) overwritten.push(`${prefix}.${k}`);
      cur[k] = v;
    }
  }
}

export interface ApplyOutcome {
  frontMatterKeys: string[];
  publicationKeys: string[];
  publishers: boolean;
  /** Settings that already had a different value and were replaced. */
  overwritten: string[];
  /** The emblem is a house-template setting (shared by every project on it): offered, never applied here. */
  emblem: string | null;
  /** How many modules were recorded as read (the list itself is `consumed` in the response). */
  consumedCount: number;
}

/** Write an import into the project's settings (project.json): the keys the import produced replace those keys; everything else stays. */
export function applyImport(projectId: string, run: ImportRun): ApplyOutcome {
  const r = run.result;
  const overwritten: string[] = [];
  const fmKeys = Object.keys(r.frontMatter);
  const pubKeys = Object.keys(r.publication);
  updateProjectJson(projectId, (pj) => {
    const fm: Record<string, any> = (pj.frontMatter && typeof pj.frontMatter === 'object' ? pj.frontMatter : {});
    for (const [k, v] of Object.entries(r.frontMatter)) {
      if (k === 'labels') {                                                    // labels merge key by key: the project may override ones this module did not mention
        const cur: Record<string, any> = fm.labels && typeof fm.labels === 'object' && !Array.isArray(fm.labels) ? fm.labels : {};
        mergeLabels(cur, v as Record<string, any>, 'frontMatter.labels', overwritten);
        fm.labels = cur;
        continue;
      }
      if (k in fm && !same(fm[k], v)) overwritten.push(`frontMatter.${k}`);
      fm[k] = v;
    }
    pj.frontMatter = fm;
    const pub: Record<string, string> = pj.publication && typeof pj.publication === 'object' ? pj.publication : {};
    for (const [k, v] of Object.entries(r.publication)) { if (k in pub && pub[k] !== v && pub[k] !== '') overwritten.push(`publication.${k}`); pub[k] = v; }
    pj.publication = pub;
    if (r.branding.publishers) {
      if (pj.publishers && !same(pj.publishers, r.branding.publishers)) overwritten.push('publishers');
      pj.publishers = r.branding.publishers;
    }
  });
  const dir = projectDirFor(projectId);
  const sc = readSidecar(dir);
  const at = nowIso();
  for (const c of r.consumed) sc.consumed[c.file] = { page: c.page, infoCode: c.infoCode, at };
  writeSidecar(dir, sc);
  return { frontMatterKeys: fmKeys, publicationKeys: pubKeys, publishers: !!r.branding.publishers, overwritten, emblem: r.branding.emblem ?? null, consumedCount: r.consumed.length };
}

// ── writing ────────────────────────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  /** Settings to generate from instead of the project's own (an unsaved edit in the Settings screen, say). */
  frontMatter?: Record<string, any>;
  publication?: Record<string, any>;
  ids?: GenIds;
  pages?: PageId[];
  /** Replace modules that exist and were changed since they were generated, or that an author wrote. Default false. */
  overwrite?: boolean;
  /** 'none' (default): the publication module is left alone and the entries are returned. 'merge': a "Front matter" folder is put first in it. */
  pm?: 'none' | 'merge';
  /** Compute everything, write nothing. */
  dryRun?: boolean;
}

export interface GenerateOutcome {
  written: Array<{ file: string; page: PageId; infoCode: string; action: 'created' | 'updated' | 'unchanged' }>;
  skipped: Array<{ file: string; page: PageId; reason: string; code: string }>;
  pmEntries: PmEntryOut[];
  pm: { action: 'none' | 'merged' | 'created'; backup?: string | null; entries?: { folders: number; dms: number; total: number } };
  report: GenerateResult['report'];
  ids: GenIds;
}

const houseEmblem = (pj: any): string | undefined => {
  try {
    const ref = pj.templateRef || 'default';
    if (!/^[\w.-]+$/.test(ref)) return undefined;
    const house = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'templates', `${ref}.house.json`), 'utf8'));
    const e = house?.branding?.emblem;
    return typeof e === 'string' && e ? e : undefined;
  } catch { return undefined; }
};

const dominant = (values: string[]): string => {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
};

/** The identity the generated modules carry: the project's own language and BREX where known, the Xignal convention otherwise. */
export function idsForProject(projectId: string, over: GenIds = {}): GenIds {
  const dms = listDms(projectId);
  const out: GenIds = {};
  const lang = dominant(dms.map((d) => d.language));
  if (lang.includes('-')) { const [l, c] = lang.split('-'); out.languageIsoCode = l; out.countryIsoCode = c; }
  const brex = dms.find((d) => String(d.dmCodeAttrs.infoCode).toUpperCase() === '022');
  if (brex) out.brex = { ...brex.dmCodeAttrs };
  const sc = readSidecar(projectDirFor(projectId));
  const consumed = dms.find((d) => d.file in sc.consumed);
  if (consumed) {
    out.modelIdentCode = consumed.dmCodeAttrs.modelIdentCode;
    out.systemDiffCode = consumed.dmCodeAttrs.systemDiffCode;
    out.languageIsoCode = consumed.languageAttrs?.languageIsoCode ?? out.languageIsoCode;
    out.countryIsoCode = consumed.languageAttrs?.countryIsoCode ?? out.countryIsoCode;
  }
  return { ...out, ...over };
}

export async function generateForProject(projectId: string, req: GenerateRequest, actor: { id: string; username: string; role?: string }, projectRole: string): Promise<GenerateOutcome> {
  const pj = readProjectJson(projectId);
  if (req.pm === 'merge' && !req.dryRun) assertS1000dPublication(projectId);    // WP-16 (PUB-022): the front matter is merged into an S1000D publication only
  const fm = req.frontMatter ?? pj.frontMatter ?? {};
  const publication = req.publication ?? pj.publication ?? {};
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) throw bad('frontMatter must be an object.', 'BAD_FRONT_MATTER');
  const ids = idsForProject(projectId, req.ids);
  const gen = dmsFromFrontMatter(fm, publication, ids, {
    branding: { publishers: Array.isArray(pj.publishers) ? pj.publishers : undefined, emblem: houseEmblem(pj) }, csdbDir: csdbRel(pj), pages: req.pages,
  });
  const dir = projectDirFor(projectId);
  const cdir = csdbDir(projectId);
  const sc = readSidecar(dir);
  const out: GenerateOutcome = { written: [], skipped: [], pmEntries: gen.pmEntries, pm: { action: 'none' }, report: gen.report, ids };

  for (const d of gen.dms) {
    const abs = path.join(cdir, d.file);
    const have = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (have !== null) {
      if (have === d.xml) { out.written.push({ file: d.file, page: d.page, infoCode: d.infoCode, action: 'unchanged' }); sc.generated[d.file] ??= { page: d.page, infoCode: d.infoCode, sha256: sha(have), at: nowIso() }; continue; }
      const mine = sc.generated[d.file];
      const untouched = !!mine && mine.sha256 === sha(have);
      if (!untouched && !req.overwrite) {
        out.skipped.push({
          file: d.file, page: d.page, code: mine ? 'EDITED_SINCE_GENERATED' : 'NOT_GENERATED',
          reason: mine ? 'This module was generated here but has been edited since. Generate with overwrite to replace the edits.' : 'A module with this name exists and was not generated here. Generate with overwrite to replace it.',
        });
        continue;
      }
      if (!req.dryRun) await writeDm(projectId, d.file, d.xml, undefined, actor, projectRole);
      out.written.push({ file: d.file, page: d.page, infoCode: d.infoCode, action: 'updated' });
    } else {
      if (!req.dryRun) {
        try { await createDm(projectId, d.file, d.xml, actor); } catch (e) {
          if ((e as any)?.code === 'DUPLICATE_DMC') { out.skipped.push({ file: d.file, page: d.page, code: 'DUPLICATE_DMC', reason: (e as Error).message }); continue; }
          throw e;
        }
      }
      out.written.push({ file: d.file, page: d.page, infoCode: d.infoCode, action: 'created' });
    }
    sc.generated[d.file] = { page: d.page, infoCode: d.infoCode, sha256: sha(d.xml), at: nowIso() };
  }
  if (req.dryRun) return out;
  writeSidecar(dir, sc);

  if (req.pm === 'merge' && gen.pmEntries.length) out.pm = mergeFrontMatterIntoPm(projectId, gen, out.written.map((w) => w.file), pj);
  return out;
}

/** The "Front matter" folder goes first in the publication; a previous folder of that name (this code's, from an earlier run) is replaced. */
function mergeFrontMatterIntoPm(projectId: string, gen: GenerateResult, writtenFiles: string[], pj: any): GenerateOutcome['pm'] {
  const abs = pmPath(projectId);
  const keep = new Set(writtenFiles);
  const folder = gen.pmEntries[0];
  folder.children = (folder.children ?? []).filter((_c, i) => keep.has(gen.dms[i].file));      // pmEntries and dms run in the same order
  if (fs.existsSync(abs)) {
    const text = fs.readFileSync(abs, 'utf8');
    const parsed = parseModel(text);   // the completing reader: the vendored one would drop every reference but the first of an entry that holds several
    const others: PmEntryOut[] = (parsed.entries as unknown as PmEntryOut[]).filter((e) => !(e.type === 'folder' && String(e.title ?? '').toLowerCase() === 'front matter'));
    const merged = [folder, ...others];
    const xml = spliceContent(text, merged);
    if (xml === null) throw bad('The publication module has no <content> block to put the front matter in.', 'NO_PM_CONTENT');
    const check = pmc.countEntries(pmc.parsePm(xml).entries);
    const want = pmc.countEntries(merged);
    if (check.total !== want.total) throw new Error('Internal check failed: the merged publication does not read back identically. Nothing was written.');
    fs.copyFileSync(abs, abs + '.bak');
    fs.writeFileSync(abs, xml, 'utf8');
    return { action: 'merged', backup: path.basename(abs) + '.bak', entries: check };
  }
  const meta = defaultPmMeta(gen.pmMeta.pmTitle || pj.name || 'Publication', { ...gen.pmMeta });
  const xml = buildPmXml([folder], meta);
  fs.writeFileSync(abs, xml, 'utf8');
  return { action: 'created', backup: null, entries: pmc.countEntries(pmc.parsePm(xml).entries) };
}

/** The front-matter content as a publication module header would carry it, for tests and previews: a full PM around the generated folder. */
export function frontMatterPmXml(gen: GenerateResult, title = 'Publication'): string {
  return buildPmXml(gen.pmEntries, defaultPmMeta(gen.pmMeta.pmTitle || title, { ...gen.pmMeta }));
}
void pmContentXml;

// ── status ─────────────────────────────────────────────────────────────────────────────────────

export function statusOf(projectId: string) {
  const dir = projectDirFor(projectId);
  const cdir = csdbDir(projectId);
  const sc = readSidecar(dir);
  const generated = Object.entries(sc.generated).map(([file, g]) => {
    const abs = path.join(cdir, file);
    const exists = fs.existsSync(abs);
    return { file, page: g.page, infoCode: g.infoCode, generatedAt: g.at, exists, editedSince: exists ? sha(fs.readFileSync(abs, 'utf8')) !== g.sha256 : false };
  }).sort((a, b) => (a.file < b.file ? -1 : 1));
  const consumed = Object.entries(sc.consumed).map(([file, c]) => ({ file, page: c.page, infoCode: c.infoCode, consumedAt: c.at, exists: fs.existsSync(path.join(cdir, file)) })).sort((a, b) => (a.file < b.file ? -1 : 1));
  const candidates = listDms(projectId).filter((d) => isCandidate(d, sc.generated) && !(d.file in sc.consumed)).map((d) => ({ file: d.file, infoCode: d.dmCodeAttrs.infoCode, title: d.infoName || d.techName }));
  return { generated, consumed, candidates, hint: 'Front-matter modules in `generated` are written from the settings; hide them from the author\'s module list. Those in `consumed` are read into the settings and are not printed as body.' };
}

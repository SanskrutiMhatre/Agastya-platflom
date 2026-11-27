// =============================================================================
// Publication module (PM) - the book's table of contents.
//
// Reading, writing and round-trip safety come from the vendored pmc module
// (nothing unmodelled is dropped). This file adds what the dashboards need on
// top: resolving each entry to the data module on disk (Explore), the pool of
// modules not yet placed (Publication), and the list of source files a
// release fingerprint must cover.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { vendor } from '../config';
import { projectDirFor, content } from '../context';
import { bad, conflict } from './http';
import { sha } from './csdbIndex';
import { readProjectJson, csdbRel, pmRel } from './projects';
import { listDms, type DmSummary } from './csdb';
import { parsePmComplete } from './importer/pmComplete';
import { RECONSTRUCTED_MARKER } from './importer/package';

const pmc = vendor('engine/pmc');
const { dmCodeString, pmCodeString } = vendor('engine/resolveDmRefs');

export interface PmEntry {
  type: 'folder' | 'include' | 'dm' | 'pmRef';
  title?: string; href?: string; children?: PmEntry[];
  dmCode?: Record<string, string>; identExtension?: Record<string, string>;
  [k: string]: unknown;
}

export function pmPath(projectId: string): string {
  return path.join(projectDirFor(projectId), pmRel(readProjectJson(projectId)));
}

const baseName = (href: string): string => href.replace(/\\/g, '/').replace(/^.*\//, '').toLowerCase();

/** key by canonical DMC string and by lower-cased file name, for both reference styles. */
function indexes(dms: DmSummary[]) {
  const byCode = new Map<string, DmSummary>();
  const byFile = new Map<string, DmSummary>();
  for (const d of dms) {
    byFile.set(d.file.toLowerCase(), d);
    // several revision files of one module: an unpinned reference means the highest issue / in-work (Phase 17 revision model)
    const have = byCode.get(d.dmc);
    if (!have || Number(d.issueNumber || 0) * 1000 + Number(d.inWork || 0) > Number(have.issueNumber || 0) * 1000 + Number(have.inWork || 0)) byCode.set(d.dmc, d);
  }
  return { byCode, byFile };
}

/**
 * The publication as the platform works with it. The vendored reader keeps only the FIRST reference of a <pmEntry> that holds several, and only the
 * dmRef when it sits beside nested entries, so a PM read with it and saved again would lose the rest for good - and a PM uploaded as a file is stored
 * verbatim, so nothing before the first save shows it. The importer already reads through the completing reader (importer/pmComplete.ts: every dmRef the
 * model lacks comes back as a sibling at its document position); everything that can lead to a save, or that decides which modules belong to the
 * publication, does the same.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseModel(text: string): { meta: any; entries: PmEntry[]; warnings: string[] } {
  const { generated: _generated, added: _added, ...model } = parsePmComplete(text);
  return model as unknown as ReturnType<typeof parseModel>;
}
const readModel = (abs: string): ReturnType<typeof parseModel> => parseModel(fs.readFileSync(abs, 'utf8'));

/** `known`: the module list the caller has just read in the same request (WP-18: the summary lists the modules once, not three times). */
export function readPm(projectId: string, known?: DmSummary[]) {
  const abs = pmPath(projectId);
  if (!fs.existsSync(abs)) throw bad('This project has no publication module yet.', 'NO_PM');
  let model: ReturnType<typeof parseModel>;
  // WP-07 (FE-009): a file that is not a publication module (a JSS or JSG document project, a damaged file) is the project's state, not a server bug
  try { model = readModel(abs); }
  catch (e) { throw bad(`The publication module of this project cannot be read: ${(e as Error).message}`, 'NOT_A_PM'); }
  const dms = known ?? listDms(projectId);
  return { ...model, counts: pmc.countEntries(model.entries), pool: unplaced(model.entries, dms), dms };
}

const NOT_PRINTED = new Set(['022', '00W', '00Q', '00P']);   // BREX and the applicability tables are project data, not pages of the book

/**
 * A data module that is created (or copied in from the repository) joins the publication at the end, so the author sees it in the book without a second step.
 * The CSDB holds every module; the publication module decides which of them are printed. Off for a project whose `autoAddToPublication` is false; BREX and the
 * applicability tables are never added; a module that is already referenced is left where it is. Never fails the caller: the module exists either way.
 */
export function placeNewDm(projectId: string, file: string): boolean {
  try {
    if (readProjectJson(projectId).autoAddToPublication === false || !fs.existsSync(pmPath(projectId))) return false;
    const model = pmc.parsePm(fs.readFileSync(pmPath(projectId), 'utf8'));
    const d = listDms(projectId).find((x) => x.file.toLowerCase() === file.toLowerCase());
    if (!d || NOT_PRINTED.has(d.dmCodeAttrs.infoCode)) return false;
    if (!unplaced(model.entries, [d]).length) return false;
    model.entries.push({ type: 'dm', title: d.techName || d.dmc, dmCode: d.dmCodeAttrs, techName: d.techName, infoName: d.infoName });
    writePm(projectId, model, true);
    return true;
  } catch { return false; }
}

/** Modules in csdb/ that no entry references, whichever style the entry uses. */
export function unplaced(entries: PmEntry[], dms: DmSummary[]): DmSummary[] {
  const files = new Set<string>();
  const codes = new Set<string>();
  (function walk(list: PmEntry[]) {
    for (const e of list ?? []) {
      if (e.type === 'folder') { walk(e.children ?? []); continue; }
      if (e.type === 'include' && e.href) files.add(baseName(e.href));
      if (e.type === 'dm' && e.dmCode) codes.add(dmCodeString(e.dmCode, e.identExtension ?? null));
    }
  })(entries);
  return dms.filter((d) => !files.has(d.file.toLowerCase()) && !codes.has(d.dmc));
}

/**
 * The annexures of a publication: entries that point at a WHOLE OTHER publication module (a pmRef) instead of at data modules. The build does not embed
 * another publication, so such an entry prints nothing; callers use this to say so instead of leaving the book quietly shorter than its table of contents.
 */
export function pmRefsOf(projectId: string): Array<{ title: string; code: string }> {
  const abs = pmPath(projectId);
  if (!fs.existsSync(abs)) return [];
  const out: Array<{ title: string; code: string }> = [];
  try {
    (function walk(list: PmEntry[]) {
      for (const e of list ?? []) {
        if (e.type === 'folder') { walk(e.children ?? []); continue; }
        if (e.type === 'pmRef') out.push({ title: String(e.title || e.pmTitle || '').trim(), code: String(pmCodeString((e.pmCode ?? {}) as Record<string, string>) || '') });
      }
    })(readModel(abs).entries);
  } catch { /* an unreadable publication is reported by the validation, not here */ }
  return out;
}

/** `next` with the importer's "reconstructed" comment from `prior`, when prior had one and next does not. The comment is copied verbatim, reason included. */
export function carryReconstructedMarker(prior: string, next: string): string {
  if (next.includes(RECONSTRUCTED_MARKER)) return next;
  const m = new RegExp(`<!--\\s*${RECONSTRUCTED_MARKER}:[^>]*-->`).exec(prior);
  if (!m) return next;
  return next.replace(/^(<\?xml[^>]*\?>\r?\n)/, `$1${m[0]}\n`);
}

/** `baseHash` (mandatory on the route, WP-11 FE-008): the version of the publication module the editor loaded; a newer file refuses the save (409 EDIT_CONFLICT). */
export function writePm(projectId: string, model: { meta?: unknown; entries: PmEntry[] }, allowEmpty = false, baseHash?: string) {
  if (!Array.isArray(model?.entries)) throw bad('entries[] is required.');
  const counts = pmc.countEntries(model.entries);
  if (counts.total === 0 && !allowEmpty) throw bad('Refusing to save an empty publication. Pass allowEmpty=1 if that is intended.', 'EMPTY_PM');

  let xml: string = pmc.serialisePm(model);
  const check = pmc.countEntries(pmc.parsePm(xml).entries);
  if (check.total !== counts.total || check.dms !== counts.dms) {
    throw new Error('Internal check failed: the serialised publication does not read back identically. Nothing was written.');
  }
  const abs = pmPath(projectId);
  // The importer marks a publication it built itself with an XML comment, which the serialiser (it writes the model, not the file) does not carry.
  // The mark is what tells a later import of this project's export that the publication is Agastya's own and not a foreign template to rebuild,
  // so a save from the Explorer must not silently take it away.
  const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (existing !== null && baseHash !== undefined && sha(existing) !== baseHash) throw conflict('The publication was changed by someone else since you opened it. Reload it to see their changes.', 'EDIT_CONFLICT', { currentHash: sha(existing) });
  if (existing !== null) xml = carryReconstructedMarker(existing, xml);
  if (fs.existsSync(abs)) fs.copyFileSync(abs, abs + '.bak');
  content.writeText(projectId, abs, xml);
  return { counts, backup: path.basename(abs) + '.bak', hash: sha(xml) };
}

// ── Explore ───────────────────────────────────────────────────────────────

export type ExploreNode =
  | { kind: 'chapter'; title: string; children: ExploreNode[]; dmCount: number }
  | { kind: 'dm'; title: string; file: string; dmc: string; infoName: string; issue: string; found: true; style: 'include' | 'dmRef' }
  | { kind: 'missing'; title: string; ref: string; style: 'include' | 'dmRef' }
  | { kind: 'pmRef'; title: string };

export function explore(projectId: string, known?: DmSummary[]) {
  const { meta, entries, warnings, counts, pool, dms } = readPm(projectId, known);
  const { byCode, byFile } = indexes(dms);
  const missing: string[] = [];

  const build = (list: PmEntry[]): ExploreNode[] => (list ?? []).map((e): ExploreNode => {
    if (e.type === 'folder') {
      const children = build(e.children ?? []);
      const dmCount = children.reduce((n, c) => n + (c.kind === 'dm' ? 1 : c.kind === 'chapter' ? c.dmCount : 0), 0);
      return { kind: 'chapter', title: e.title || '(untitled)', children, dmCount };
    }
    if (e.type === 'pmRef') return { kind: 'pmRef', title: e.title || String(e.pmTitle ?? 'Annexure') };

    const style = e.type === 'include' ? 'include' : 'dmRef';
    const hit = e.type === 'include' ? byFile.get(baseName(e.href ?? '')) : byCode.get(dmCodeString(e.dmCode ?? {}, e.identExtension ?? null));
    if (hit) return { kind: 'dm', title: e.title || hit.techName || hit.file, file: hit.file, dmc: hit.dmc, infoName: hit.infoName, issue: hit.issueNumber, found: true, style };
    const ref = e.type === 'include' ? String(e.href ?? '') : dmCodeString(e.dmCode ?? {}, e.identExtension ?? null);
    missing.push(ref);
    return { kind: 'missing', title: e.title || ref, ref, style };
  });

  return {
    meta, warnings, counts,
    tree: build(entries),
    unplaced: pool,
    missing,
    totals: { dms: dms.length, placed: dms.length - pool.length, unplaced: pool.length, missing: missing.length },
  };
}

// ── Release fingerprint inputs ────────────────────────────────────────────

/**
 * Every source file the PDF is built from, as project-relative paths. A module
 * sitting unplaced in the pool does not appear in the PDF, so changing it must
 * not un-release the PDF - hence "referenced", not "everything in csdb".
 */
/** Every data module a PM names, read from its raw XML: <dmRef> by code and includes by file name. */
function rawPmReferences(pmXml: string, byCode: Map<string, DmSummary>, byFile: Map<string, DmSummary>): DmSummary[] {
  const hits: DmSummary[] = [];
  const doc = new DOMParser({ onError: () => undefined } as any).parseFromString(pmXml, 'text/xml') as any;
  for (const d of Array.from(doc.getElementsByTagName('dmRef')) as any[]) {
    const c = d.getElementsByTagName('dmCode')[0]; if (!c) continue;
    const attrs: Record<string, string> = {}; for (const a of Array.from(c.attributes) as any[]) attrs[a.name] = a.value;
    const x = d.getElementsByTagName('identExtension')[0];
    const ext: Record<string, string> | null = x ? Object.fromEntries((Array.from(x.attributes) as any[]).map((a) => [a.name, a.value])) : null;
    const hit = byCode.get(dmCodeString(attrs, ext)); if (hit) hits.push(hit);
  }
  for (const n of Array.from(doc.getElementsByTagName('*')) as any[]) {
    if (!/(^|:)include$/.test(n.nodeName)) continue;
    const hit = byFile.get(baseName(n.getAttribute('href') ?? '')); if (hit) hits.push(hit);
  }
  return hits;
}

export function publicationSources(projectId: string, known?: DmSummary[]): string[] {
  const dir = projectDirFor(projectId);
  const pj = readProjectJson(projectId);
  const csdb = csdbRel(pj);
  const out = new Set<string>();
  const pmName = pmRel(pj);
  if (fs.existsSync(path.join(dir, pmName))) out.add(pmName);

  try {
    const model = readModel(path.join(dir, pmName));
    const { byCode, byFile } = indexes(known ?? listDms(projectId));
    (function walk(list: PmEntry[]) {
      for (const e of list ?? []) {
        if (e.type === 'folder') { walk(e.children ?? []); continue; }
        const hit = e.type === 'include'
          ? byFile.get(baseName(e.href ?? ''))
          : e.type === 'dm' ? byCode.get(dmCodeString(e.dmCode ?? {}, e.identExtension ?? null)) : undefined;
        if (hit) out.add(`${csdb}/${hit.file}`);
      }
    })(model.entries);
    // The editor's PM model keeps ONE reference per entry; a publication module may legally list several dmRef / includes in one <pmEntry>. Every
    // reference in the raw XML is part of the publication (and must be validated, and filtered), whether or not the model carries it.
    for (const hit of rawPmReferences(fs.readFileSync(path.join(dir, pmName), 'utf8'), byCode, byFile)) out.add(`${csdb}/${hit.file}`);
  } catch { /* an unreadable PM simply contributes only itself */ }

  // Front matter is part of the book, and it is the half a settings change rewrites.
  const fmDir = pj.pipeline === 's1000dtofo' ? 's1000d/frontmatter' : 'jss/frontmatter';
  const fmAbs = path.join(dir, fmDir);
  if (fs.existsSync(fmAbs)) for (const f of fs.readdirSync(fmAbs)) if (/\.xml$/i.test(f)) out.add(`${fmDir}/${f}`);
  return [...out].sort();
}

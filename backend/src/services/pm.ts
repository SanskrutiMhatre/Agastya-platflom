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
import { assertS1000dPublication } from './projectRecord';
import { listDms, dmSummaryOf, type DmSummary } from './csdb';
import { parsePmComplete } from './importer/pmComplete';
import { RECONSTRUCTED_MARKER } from './importer/package';
import { completePmStatus } from './pmHeader';
import { FileMemo } from './fileMemo';

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
// WP-17 (PERF-005): a page view read the publication module three times (the release fingerprint, the raw references, the explorer), each a
// full parse (about 50-90 ms for 1000 entries). The parse is kept until the file changes (size, modification or change time) and handed out as
// a copy, so a caller that changes its model changes nothing kept.
// Phase 7 (docs/phase3/performance.md, item 2): the kept parse is deep-frozen and SHARED instead of copied on every read (structuredClone of
// a 1,000-entry model was the largest single cost of /pmc, /explore and /summary: 4.2 s in the baseline profile). Every reader of it is
// read-only (the explorer, the JSON answers, the fingerprint inputs, the annexure list); a writer builds a new model (writePm serialises
// without changing its input), so freezing turns any accidental change into an error instead of a silently changed cache.
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}
const modelMemo = new FileMemo<ReturnType<typeof parseModel>>(64);
const readModel = (abs: string): ReturnType<typeof parseModel> => modelMemo.get(abs, fs.statSync(abs), () => deepFreeze(parseModel(fs.readFileSync(abs, 'utf8'))));

// the hash of the publication file a save names (GET /pmc), per file version
const pmHashMemo = new FileMemo<string>(64);
/** sha256 of the publication module file as it is on disk, or null when there is none (kept per file version). */
export function pmFileHash(projectId: string): string | null {
  const abs = pmPath(projectId);
  let st: fs.Stats; try { st = fs.statSync(abs); } catch { return null; }
  return pmHashMemo.get(abs, st, () => sha(fs.readFileSync(abs, 'utf8')));
}

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

// pmc.parsePm of a publication file, kept per file version (size, times, file id); frozen and shared (phase 7): placeNewDm appends to a
// new entries array instead of changing the kept one
const pmParseMemo = new FileMemo<{ meta?: unknown; entries: PmEntry[] }>(64);
const parsedPm = (abs: string) => pmParseMemo.get(abs, fs.statSync(abs), () => deepFreeze(pmc.parsePm(fs.readFileSync(abs, 'utf8'))));

const NOT_PRINTED = new Set(['022', '00W', '00Q', '00P']);   // BREX and the applicability tables are project data, not pages of the book

/**
 * A data module that is created (or copied in from the repository) joins the publication at the end, so the author sees it in the book without a second step.
 * The CSDB holds every module; the publication module decides which of them are printed. Off for a project whose `autoAddToPublication` is false; BREX and the
 * applicability tables are never added; a module that is already referenced is left where it is. Never fails the caller: the module exists either way.
 */
export function placeNewDm(projectId: string, file: string): boolean {
  try {
    if (readProjectJson(projectId).autoAddToPublication === false || !fs.existsSync(pmPath(projectId))) return false;
    const kept = parsedPm(pmPath(projectId));                         // WP-17: the kept parse of this file version (frozen, shared)
    const d = dmSummaryOf(projectId, file);                         // WP-17 (PERF-005): this module, not a listing of all of them
    if (!d || NOT_PRINTED.has(d.dmCodeAttrs.infoCode)) return false;
    if (!unplaced(kept.entries, [d]).length) return false;
    const entry: PmEntry = { type: 'dm', title: d.techName || d.dmc, dmCode: d.dmCodeAttrs, techName: d.techName, infoName: d.infoName };
    if (appendPmEntry(projectId, kept, entry)) { placeStats.appended++; return true; }   // phase 8: the one entry appended (same bytes as below)
    const model = { ...kept, entries: [...kept.entries, entry] };
    writePm(projectId, model, true);
    placeStats.rewritten++;
    return true;
  } catch { return false; }
}

/*
  Phase 8 (docs/phase3/cleanup-backend.md, item 3): a module created at 1,000 modules rewrote the whole publication (serialise 1,000 entries,
  parse them all back to check, about 70 ms of synchronous work per create). `appendPmEntry` writes the SAME bytes as
  `writePm({ ...kept, entries: [...kept.entries, entry] }, true)` without touching the other entries:

    * the file on disk must be one `writePm` (or this function) wrote, unchanged since (`canonical`: its text, and the frozen model whose
      serialisation is exactly that text's <content> - checked once, when writePm wrote it, by serialising the read-back again);
    * the serialiser writes the top-level entries one after another and the <content> close last, so the full rewrite's text is the old text
      with the new entry's lines inserted before `  </content>` - the lines come from the vendored serialiser itself (a publication of this
      one entry, under the same header), so they are the lines the full rewrite would write;
    * the header the full rewrite would write (the importer's mark carried over, completePmStatus against the file on disk) is computed from
      the serialised header and must equal the file's header; the new entry being a dmRef, the XInclude namespace does not change;
    * read-back check, as in writePm: the new entry's text parses back to exactly one entry, which serialises to the same lines again, and the
      count of the whole publication is the old count plus one.
  Anything unexpected (a file edited by hand, another layout, a header the full path would change, the importer's mark inside the content)
  answers false and the caller does the full rewrite. `test/phase8-cleanup.test.js` compares both paths byte for byte on several real PMs.
*/
/** How placeNewDm wrote the publication (tests and diagnostics). */
export const placeStats = { appended: 0, rewritten: 0 };
interface Canonical { size: number; mtimeMs: number; ctimeMs: number; ino: number; text: string; model: { meta?: unknown; entries: PmEntry[]; warnings?: string[] } }
const canonical = new Map<string, Canonical>();
const CONTENT_OPEN = '\n  <content>\n';
const CONTENT_TAIL = '  </content>\n</pm>\n';
const XI_NS = ' xmlns:xi="http://www.w3.org/2001/XInclude"';
const usesInclude = (list: PmEntry[] | undefined): boolean => (list ?? []).some((e) => e.type === 'include' || usesInclude(e.children));
function rememberCanonical(abs: string, text: string, model: Canonical['model']): void {
  try {
    const st = fs.statSync(abs);
    canonical.delete(abs); canonical.set(abs, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, text, model });
    if (canonical.size > 64) { const first = canonical.keys().next().value; if (first !== undefined) canonical.delete(first); }
  } catch { canonical.delete(abs); }
}

/** The text the append path would write, or null when only the full rewrite can be trusted to give the same bytes. Exported for the tests. */
export function appendedPmText(existing: string, kept: { meta?: unknown; entries: PmEntry[] }, entry: PmEntry): { text: string; entry: PmEntry } | null {
  if (entry.type !== 'dm' || !existing.endsWith(CONTENT_TAIL)) return null;
  const one: string = pmc.serialisePm({ meta: kept.meta, entries: [entry] });
  const at = one.indexOf(CONTENT_OPEN); if (at < 0 || !one.endsWith(CONTENT_TAIL)) return null;
  const lines = one.slice(at + CONTENT_OPEN.length, one.length - CONTENT_TAIL.length);
  let head = one.slice(0, at);
  if (usesInclude(kept.entries)) { if (!head.includes('<pm xmlns:xsi=')) return null; head = head.replace('<pm xmlns:xsi=', `<pm${XI_NS} xmlns:xsi=`); }
  // the importer's mark: the full path carries it over unless the new text has it; inside the content it would change that decision
  if (existing.indexOf(RECONSTRUCTED_MARKER, head.length) >= 0 || lines.includes(RECONSTRUCTED_MARKER)) return null;
  head = completePmStatus(carryReconstructedMarker(existing, head), existing, { enterpriseCode: (kept.meta as { rpc?: { enterpriseCode?: string } } | undefined)?.rpc?.enterpriseCode });
  if (!existing.startsWith(head + CONTENT_OPEN)) return null;
  // read-back of what is added: one entry, serialising to the same lines again
  const back = pmc.parsePm(one);
  if (back.entries.length !== 1 || back.warnings.length) return null;
  const again: string = pmc.serialisePm({ meta: kept.meta, entries: back.entries });
  if (again !== one) return null;
  return { text: existing.slice(0, existing.length - CONTENT_TAIL.length) + lines + CONTENT_TAIL, entry: back.entries[0] };
}

function appendPmEntry(projectId: string, kept: { meta?: unknown; entries: PmEntry[]; warnings?: string[] }, entry: PmEntry): boolean {
  const abs = pmPath(projectId);
  const c = canonical.get(abs);
  if (!c || c.model !== kept) return false;
  let st: fs.Stats; try { st = fs.statSync(abs); } catch { return false; }
  if (st.size !== c.size || st.mtimeMs !== c.mtimeMs || st.ctimeMs !== c.ctimeMs || st.ino !== c.ino) { canonical.delete(abs); return false; }
  const got = appendedPmText(c.text, kept, entry); if (!got) return false;
  assertS1000dPublication(projectId);
  const before = pmc.countEntries(kept.entries);
  const entries = [...kept.entries, got.entry];
  const after = pmc.countEntries(entries);
  if (after.total !== before.total + 1 || after.dms !== before.dms + 1) return false;
  fs.copyFileSync(abs, abs + '.bak');
  content.writeText(projectId, abs, got.text);
  const model = deepFreeze({ ...kept, entries });
  try { pmParseMemo.get(abs, fs.statSync(abs), () => model); } catch { /* the memo is a convenience */ }
  rememberCanonical(abs, got.text, model);
  return true;
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
  assertS1000dPublication(projectId);                                  // WP-16 (PUB-022): a JSS document project's publication.xml is not a <pm>
  if (!Array.isArray(model?.entries)) throw bad('entries[] is required.');
  const counts = pmc.countEntries(model.entries);
  if (counts.total === 0 && !allowEmpty) throw bad('Refusing to save an empty publication. Pass allowEmpty=1 if that is intended.', 'EMPTY_PM');

  let xml: string = pmc.serialisePm(model);
  const reread = pmc.parsePm(xml);
  const check = pmc.countEntries(reread.entries);
  if (check.total !== counts.total || check.dms !== counts.dms) {
    throw new Error('Internal check failed: the serialised publication does not read back identically. Nothing was written.');
  }
  const abs = pmPath(projectId);
  // The importer marks a publication it built itself with an XML comment, which the serialiser (it writes the model, not the file) does not carry.
  // The mark is what tells a later import of this project's export that the publication is Agastya's own and not a foreign template to rebuild,
  // so a save from the Explorer must not silently take it away.
  const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (existing !== null && baseHash !== undefined && sha(existing) !== baseHash) throw conflict('The publication was changed by someone else since you opened it. Reload it to see their changes.', 'EDIT_CONFLICT', { currentHash: sha(existing) });
  const written = xml;
  if (existing !== null) xml = carryReconstructedMarker(existing, xml);
  // WP-15 (PUB-015): the writer does not write the header's applicability and BREX reference (pm.xsd requires both): the saved file keeps the ones it had
  xml = completePmStatus(xml, existing, { enterpriseCode: (model.meta as { rpc?: { enterpriseCode?: string } } | undefined)?.rpc?.enterpriseCode });
  if (fs.existsSync(abs)) fs.copyFileSync(abs, abs + '.bak');
  content.writeText(projectId, abs, xml);
  // WP-17 (PERF-005): the read-back just made IS the parse of the file as written (when nothing was added to the text after it), so the next
  // module created does not parse the whole publication again
  // Phase 7: when the header was completed (completePmStatus) or the importer's mark carried over, the text differs from `written` only in
  // the identification and status section and a leading comment: the entries (everything under <content>) are the ones just read back, and
  // the header is read from the written text with its <content> left out (a few hundred bytes instead of the whole publication). Before,
  // every create paid a second full parse here (the next placeNewDm missed the memo).
  canonical.delete(abs);
  try {
    const st = fs.statSync(abs);
    let kept: Canonical['model'] | null = null;
    if (xml === written) kept = pmParseMemo.get(abs, st, () => deepFreeze(reread));
    else {
      const head = xml.replace(/<content\b[\s\S]*<\/content>/, '');
      if (head.length < xml.length) {
        const h = pmc.parsePm(head);
        if (h.entries.length === 0) kept = pmParseMemo.get(abs, st, () => deepFreeze({ meta: h.meta, entries: reread.entries, warnings: reread.warnings }));
      }
    }
    // phase 8 (item 3): the append path may build on this file when the kept model serialises to exactly its content (checked once, here)
    if (kept) {
      const again: string = pmc.serialisePm(kept);
      const a = again.indexOf(CONTENT_OPEN); const b = xml.indexOf(CONTENT_OPEN);
      if (a >= 0 && b >= 0 && again.slice(a) === xml.slice(b)) rememberCanonical(abs, xml, kept);
    }
  } catch { /* the memo is a convenience */ }
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
function rawPmReferences(abs: string, byCode: Map<string, DmSummary>, byFile: Map<string, DmSummary>): DmSummary[] {
  const hits: DmSummary[] = [];
  const refs = rawRefMemo.get(abs, fs.statSync(abs), () => rawPmKeys(fs.readFileSync(abs, 'utf8')));   // WP-17: parsed once per file version
  for (const code of refs.codes) { const hit = byCode.get(code); if (hit) hits.push(hit); }
  for (const file of refs.files) { const hit = byFile.get(file); if (hit) hits.push(hit); }
  return hits;
}

/** The references of a publication module's raw XML: every <dmRef>'s code string, then every include's file name, in document order. */
function rawPmKeys(pmXml: string): { codes: string[]; files: string[] } {
  const codes: string[] = []; const files: string[] = [];
  const doc = new DOMParser({ onError: () => undefined } as any).parseFromString(pmXml, 'text/xml') as any;
  for (const d of Array.from(doc.getElementsByTagName('dmRef')) as any[]) {
    const c = d.getElementsByTagName('dmCode')[0]; if (!c) continue;
    const attrs: Record<string, string> = {}; for (const a of Array.from(c.attributes) as any[]) attrs[a.name] = a.value;
    const x = d.getElementsByTagName('identExtension')[0];
    const ext: Record<string, string> | null = x ? Object.fromEntries((Array.from(x.attributes) as any[]).map((a) => [a.name, a.value])) : null;
    codes.push(dmCodeString(attrs, ext));
  }
  for (const n of Array.from(doc.getElementsByTagName('*')) as any[]) {
    if (!/(^|:)include$/.test(n.nodeName)) continue;
    files.push(baseName(n.getAttribute('href') ?? ''));
  }
  return { codes, files };
}
const rawRefMemo = new FileMemo<{ codes: string[]; files: string[] }>(64);

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
    for (const hit of rawPmReferences(path.join(dir, pmName), byCode, byFile)) out.add(`${csdb}/${hit.file}`);
  } catch { /* an unreadable PM simply contributes only itself */ }

  // Front matter is part of the book, and it is the half a settings change rewrites.
  const fmDir = pj.pipeline === 's1000dtofo' ? 's1000d/frontmatter' : 'jss/frontmatter';
  const fmAbs = path.join(dir, fmDir);
  if (fs.existsSync(fmAbs)) for (const f of fs.readdirSync(fmAbs)) if (/\.xml$/i.test(f)) out.add(`${fmDir}/${f}`);
  return [...out].sort();
}

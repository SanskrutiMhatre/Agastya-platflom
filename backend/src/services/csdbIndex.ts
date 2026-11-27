// =============================================================================
// The CSDB index: which data modules a project holds and what each one is (identity read from the head of the file).
//
// A leaf of csdb.ts (audit WP-10, ARC-006): projectConfig needs the list of data modules and csdb.ts needs projectConfig's rule for a new
// module, which made the two import each other. The read-only half lives here; csdb.ts re-exports it, so existing imports keep working.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { bad } from './http';
import { HEAD_BYTES, MAX_PROLOG, headOf, rootStart, readAttrs as attrs } from './xmlHead';
import { FileMemo } from './fileMemo';
import { readProjectJson, csdbRel } from './projectRecord';
import { sha256 as sha } from '../lib/hash';

export const DM_FILE_RE = /^DMC-[A-Za-z0-9._-]+\.xml$/i;

export interface DmSummary {
  file: string; dmc: string; techName: string; infoName: string; title: string;
  issueNumber: string; inWork: string; language: string; schema: string; issue: string;
  security: string; size: number; modified: string;
  /** The identity attributes a <dmRef> to this module is written from. */
  dmCodeAttrs: Record<string, string>; identExtension?: Record<string, string>;
  issueInfoAttrs: Record<string, string>; languageAttrs: Record<string, string>;
}

export { sha };

export function csdbDir(projectId: string): string {
  return path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId)));
}

/** The file inside csdb/, refusing anything that could leave it. */
export function resolveDmFile(projectId: string, file: string): string {
  const name = String(file ?? '');
  if (!DM_FILE_RE.test(name)) throw bad('A data module file name looks like DMC-<code>.xml.', 'BAD_FILE_NAME');
  const dir = csdbDir(projectId);
  const abs = path.resolve(dir, name);
  if (path.dirname(abs) !== path.resolve(dir)) throw bad('Bad path.', 'BAD_FILE_NAME');
  return abs;
}


/** "MODEL-AA-00-00-00-00A-040A-D" from dmCode attributes. */
export function dmcString(a: Record<string, string>): string {
  const g = (k: string) => a[k] ?? '';
  const s = [g('modelIdentCode'), g('systemDiffCode'), g('systemCode'), `${g('subSystemCode')}${g('subSubSystemCode')}`,
    g('assyCode'), `${g('disassyCode')}${g('disassyCodeVariant')}`, `${g('infoCode')}${g('infoCodeVariant')}`, g('itemLocationCode')];
  return s.join('-');
}

export function parseIdent(head: string, file: string): Omit<DmSummary, 'size' | 'modified'> {
  const scope = (/<dmIdent>([\s\S]*?)<\/dmIdent>/.exec(head) || [null, head])[1] as string;
  const code = /<dmCode\b([^>]*)\/?>/.exec(scope);
  const issueInfo = /<issueInfo\b([^>]*)\/?>/.exec(scope);
  const lang = /<language\b([^>]*)\/?>/.exec(scope);
  const ext = /<identExtension\b([^>]*)\/?>/.exec(scope);
  const tech = /<techName>([\s\S]*?)<\/techName>/.exec(head);
  const info = /<infoName>([\s\S]*?)<\/infoName>/.exec(head);
  const sec = /<security\b([^>]*)\/?>/.exec(head);
  const loc = /noNamespaceSchemaLocation\s*=\s*"([^"]+)"/.exec(head);
  const schemaFile = loc ? loc[1].split('/').pop() ?? '' : '';
  const iss = loc ? /S1000D[_-]?(\d)[-._](\d)/i.exec(loc[1]) : null;
  const ca = code ? attrs(code[1]) : {};
  const ia = issueInfo ? attrs(issueInfo[1]) : {};
  const la = lang ? attrs(lang[1]) : {};
  const techName = tech ? tech[1].replace(/\s+/g, ' ').trim() : '';
  const infoName = info ? info[1].replace(/\s+/g, ' ').trim() : '';
  return {
    file,
    dmc: code ? dmcString(ca) : file.replace(/^DMC-/i, '').replace(/\.xml$/i, ''),
    techName, infoName, title: [techName, infoName].filter(Boolean).join(' - '),
    issueNumber: ia.issueNumber ?? '', inWork: ia.inWork ?? '',
    language: la.languageIsoCode ? `${la.languageIsoCode}-${(la.countryIsoCode ?? '').toUpperCase()}` : '',
    schema: schemaFile.replace(/\.xsd$/i, ''), issue: iss ? `${iss[1]}.${iss[2]}` : '',
    security: sec ? attrs(sec[1]).securityClassification ?? '' : '',
    dmCodeAttrs: ca, identExtension: ext ? attrs(ext[1]) : undefined, issueInfoAttrs: ia, languageAttrs: la,
  };
}

function readHead(abs: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(abs, 'r');
    const f = fd;
    return headFrom((buf) => fs.readSync(f, buf, 0, buf.length, 0));
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

/** The head `readHead` would read from a file holding exactly this text (WP-17: a module just written is not read back from the disk). */
export function headOfText(xml: string): string {
  const all = Buffer.from(xml, 'utf8');
  try { return headFrom((buf) => all.copy(buf, 0, 0, Math.min(buf.length, all.length))); } catch { return ''; }
}

function headFrom(read: (buf: Buffer) => number): string {
  {
    // Normally the first 12 KB hold the identity. A long DOCTYPE (one entity per graphic) pushes the root
    // element further down: read on, up to the prolog limit, until it shows up.
    let size = HEAD_BYTES;
    for (;;) {
      const buf = Buffer.alloc(size);
      const n = read(buf);
      const text = buf.toString('utf8', 0, n);
      const at = rootStart(text, 'dmodule');
      const complete = at >= 0 && text.length >= at + HEAD_BYTES;      // root found AND its identity section read in full
      if (n < size || size >= MAX_PROLOG + HEAD_BYTES || complete) return headOf(text, 'dmodule', HEAD_BYTES);
      size = Math.min(size * 4, MAX_PROLOG + HEAD_BYTES);
    }
  }
}

// WP-18 (PERF-016, FE-029): a module's identity is read from its head once and kept until the file changes (size, mtime or ctime), so the list,
// the summary, the explorer and the BREX check stop re-reading every module on every request.
const identMemo = new FileMemo<ReturnType<typeof parseIdent>>();

// WP-17: the file-system stat each listed summary was made from, so a caller holding the list (the release fingerprint of a display) need
// not stat every module a second time in the same request. Not part of the summary itself (nothing changes in the JSON).
const statOf = new WeakMap<DmSummary, fs.Stats>();
/** The stat a summary from `listDms` was made from, when it came from there. */
export function listedStat(d: DmSummary): fs.Stats | undefined { return statOf.get(d); }

/** The identity a module is unique by within a project: code, issue and language. */
export const identityKey = (d: Pick<DmSummary, 'dmc' | 'issueNumber' | 'inWork' | 'language'>): string =>
  `${d.dmc}|${d.issueNumber}-${d.inWork}|${d.language}`.toUpperCase();

/** The summary of ONE module (what `listDms` would list for it), or null when the file is not there. */
export function dmSummaryOf(projectId: string, file: string): DmSummary | null {
  const abs = resolveDmFile(projectId, file);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  return summaryFrom(abs, path.basename(abs), st);
}

function summaryFrom(abs: string, f: string, st: fs.Stats): DmSummary {
  const ident = identMemo.get(abs, st, () => parseIdent(readHead(abs), f));
  // a fresh copy per call: callers may change what they are given without touching the memo
  return {
    ...ident, size: st.size, modified: st.mtime.toISOString(),
    dmCodeAttrs: { ...ident.dmCodeAttrs }, issueInfoAttrs: { ...ident.issueInfoAttrs }, languageAttrs: { ...ident.languageAttrs },
    identExtension: ident.identExtension ? { ...ident.identExtension } : ident.identExtension,
  };
}

/*
  WP-17 (PERF-005): the identity index behind the uniqueness check of every save and create. Listing the CSDB costs one file-system stat per
  module (about 55 ms at 1000 modules on Windows), and every save and create paid it. The index keeps, per CSDB folder, identity key -> files,
  and is trusted while the folder's own modification time is unchanged: every write the platform makes is an atomic rename inside the folder
  (storage/atomicWrite.ts), and an added, removed or renamed file changes the folder's time, so any such change outside the save path makes the
  next check list the folder again. The save and create paths update the index in place for the module they wrote (noteDmWritten). A change
  that leaves the folder's time alone (a file edited in place by a tool outside the platform) is picked up within INDEX_MAX_AGE_MS, after which
  the index is rebuilt anyway. Listings (`listDms`) never use it: they always stat every file.
*/
interface IdentIndex { dirMtimeMs: number; builtAt: number; keyOf: Map<string, string>; filesOf: Map<string, Set<string>> }
const identIndexes = new Map<string, IdentIndex>();
const INDEX_MAX_AGE_MS = 60000;
const INDEX_MAX = 64;

function dirTime(dir: string): number | null { try { return fs.statSync(dir).mtimeMs; } catch { return null; } }

function identIndexOf(projectId: string): IdentIndex | null {
  const dir = csdbDir(projectId);
  const t = dirTime(dir);
  if (t === null) { identIndexes.delete(dir); return null; }
  const had = identIndexes.get(dir);
  if (had && had.dirMtimeMs === t && Date.now() - had.builtAt < INDEX_MAX_AGE_MS) return had;
  const idx: IdentIndex = { dirMtimeMs: t, builtAt: Date.now(), keyOf: new Map(), filesOf: new Map() };   // the time read BEFORE the listing
  for (const d of listDms(projectId)) put(idx, d.file, identityKey(d));
  identIndexes.delete(dir); identIndexes.set(dir, idx);
  if (identIndexes.size > INDEX_MAX) { const first = identIndexes.keys().next().value; if (first !== undefined) identIndexes.delete(first); }
  return idx;
}
function put(idx: IdentIndex, file: string, key: string | null): void {
  const lower = file.toLowerCase();
  let name = file;                                                       // the name as the folder spells it (a save may address it in another case)
  const old = idx.keyOf.get(lower);
  if (old !== undefined) {
    const s = idx.filesOf.get(old);
    if (s) { for (const f of s) if (f.toLowerCase() === lower) { name = f; s.delete(f); } if (!s.size) idx.filesOf.delete(old); }
    idx.keyOf.delete(lower);
  }
  if (key === null) return;
  idx.keyOf.set(lower, key);
  let s = idx.filesOf.get(key); if (!s) { s = new Set(); idx.filesOf.set(key, s); } s.add(name);
}

/** Another module of the project with this identity (not `file` itself), or null. Same answer as searching `listDms`. */
export function identityClash(projectId: string, file: string, key: string): string | null {
  const idx = identIndexOf(projectId);
  if (!idx) return null;
  const lower = file.toLowerCase();
  const hits = [...(idx.filesOf.get(key) ?? [])].filter((f) => f.toLowerCase() !== lower).sort((a, b) => a.localeCompare(b));
  return hits[0] ?? null;
}

/**
 * After the platform wrote (or deleted) one module through csdb.ts: keep the index in step instead of listing again. The identity is read
 * back from the file exactly as `listDms` reads it.
 */
export function noteDmWritten(projectId: string, file: string, xml: string | null): void {
  const dir = csdbDir(projectId);
  const idx = identIndexes.get(dir);
  if (!idx) return;
  const t = dirTime(dir);
  if (t === null) { identIndexes.delete(dir); return; }
  // the text just written, read the way listDms reads a file (opening a file that was just written waits for the virus scanner on Windows)
  put(idx, file, xml === null ? null : identityKey(parseIdent(headOfText(xml), file)));
  idx.dirMtimeMs = t;
}

/** Forget every identity index (tests; a restore or import that rewrote a whole CSDB may call it too, though the folder time already does). */
export function clearIdentityIndexes(): void { identIndexes.clear(); }

export function listDms(projectId: string): DmSummary[] {
  const dir = csdbDir(projectId);
  if (!fs.existsSync(dir)) return [];
  const out: DmSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!DM_FILE_RE.test(f)) continue;
    const abs = path.join(dir, f);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    const d = summaryFrom(abs, f, st);
    statOf.set(d, st);
    out.push(d);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

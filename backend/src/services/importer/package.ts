// =============================================================================
// Loading and classifying an import package.
//
// A package is just a list of files - a folder's contents, several multipart uploads, or the entries of one
// or more zips. Classification looks at the CONTENT (the root element), not only the name, because plugin
// output is not consistent: the Vektra plugin writes `DMC-GAV-A-00-00-00-01A-040A-D.xml` with no issue or
// language suffix, and a PMC called `PMC-IETM.xml`.
// =============================================================================

import { parseDmIdent, isPlaceholderPmCode, pmCodesInBody } from './identity';
import { parsePmComplete, type CompletePm } from './pmComplete';
import { rootTag } from './xmlScan';
import { isZip, readZip, ZipError } from './zipRead';
import type { DmIdent, FileKind, PackageEntry, PmModel } from './types';

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|bmp|webp|tiff?)$/i;
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/i;

export interface PkgFile {
  path: string;
  base: string;
  kind: FileKind;
  bytes: Buffer;
  /** Set when the file is text the importer cannot safely edit (UTF-16, ...). */
  encodingProblem?: string;
}

export interface DmRec {
  file: PkgFile;
  text: string;
  ident: DmIdent;
  isBrex: boolean;
  /** `<pmCode>` elements quoted in the module's body. */
  bodyPmCodes: Array<Record<string, string>>;
}

export interface PmcRec {
  file: PkgFile;
  text: string;
  model: CompletePm | null;
  parseError?: string;
  placeholder: boolean;
  /** Written by this importer (the marker comment survives a re-scan of repaired output). */
  reconstructedMarker: boolean;
}

export interface Package {
  files: PkgFile[];
  dms: DmRec[];
  pmcs: PmcRec[];
  icns: PkgFile[];
  images: PkgFile[];
  others: PkgFile[];
  ignored: PkgFile[];
  /** Problems met while unpacking (unsafe zip entries, damaged zips). */
  loadNotes: Array<{ severity: 'error' | 'warning' | 'info'; message: string }>;
}

export const RECONSTRUCTED_MARKER = 'agastya-import: reconstructed';

export const normPath = (name: string): string => name.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Expand zips found among the entries (the Vektra plugin ships `XML.zip` + `ICN.zip`), one level deep. */
export function expandZips(entries: PackageEntry[]): { entries: PackageEntry[]; notes: Package['loadNotes'] } {
  const out: PackageEntry[] = [];
  const notes: Package['loadNotes'] = [];
  for (const e of entries) {
    const buf = Buffer.from(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength);
    if (/\.zip$/i.test(e.name) || isZip(buf)) {
      try {
        const { entries: inner, skipped } = readZip(buf);
        const stem = baseName(normPath(e.name)).replace(/\.zip$/i, '');
        for (const s of skipped) notes.push({ severity: 'warning', message: `${e.name}: entry ${s.name} was skipped (${s.reason}).` });
        for (const i of inner) {
          const first = i.name.split('/')[0];
          out.push({ name: first.toLowerCase() === stem.toLowerCase() ? i.name : `${stem}/${i.name}`, bytes: i.bytes });
        }
        continue;
      } catch (err) {
        notes.push({ severity: 'error', message: `${e.name}: ${err instanceof ZipError ? err.message : `could not be read as a zip (${(err as Error).message})`}` });
        continue;
      }
    }
    out.push(e);
  }
  return { entries: out, notes };
}

function decode(bytes: Buffer): { text: string; problem?: string } {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return { text: bytes.toString('utf16le'), problem: 'The file is UTF-16 encoded; the importer reads it but does not rewrite it.' };
  }
  return { text: bytes.toString('utf8') };
}

export function loadPackage(input: PackageEntry[]): Package {
  const { entries, notes } = expandZips(input);
  const pkg: Package = { files: [], dms: [], pmcs: [], icns: [], images: [], others: [], ignored: [], loadNotes: notes };
  const seen = new Map<string, Buffer>();
  const sameCopies: string[] = [];
  const differentCopies: string[] = [];

  for (const e of entries) {
    const path = normPath(e.name);
    if (!path || path.endsWith('/')) continue;
    const bytes = Buffer.from(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength);
    const base = baseName(path);
    const dupKey = path.toLowerCase();
    const first = seen.get(dupKey);
    if (first) {
      // A vendor tool often ships both the folder and a zip of it. Identical copies are harmless and are said once; differing ones are not.
      (first.equals(bytes) ? sameCopies : differentCopies).push(path);
      continue;
    }
    seen.set(dupKey, bytes);

    const f: PkgFile = { path, base, kind: 'other', bytes };
    if (JUNK.test(path)) { f.kind = 'ignored'; pkg.ignored.push(f); pkg.files.push(f); continue; }

    if (/\.xml$/i.test(base)) {
      const { text, problem } = decode(bytes);
      if (problem) f.encodingProblem = problem;
      const root = rootTag(text);
      if (root?.name === 'dmodule') {
        const ident = parseDmIdent(text);
        const isBrex = /<content\b[^>]*>\s*<brex\b/.test(text) || ident.infoCode === '022' && /<brex\b/.test(text);
        f.kind = isBrex ? 'brex' : 'dm';
        pkg.dms.push({ file: f, text, ident, isBrex, bodyPmCodes: ident.infoCode === '001' || /^DMC-/i.test(base) ? pmCodesInBody(text) : [] });
      } else if (root?.name === 'pm') {
        f.kind = 'pmc';
        let model: PmcRec['model'] = null;
        let parseError: string | undefined;
        try { model = parsePmComplete(text); } catch (err) { parseError = (err as Error).message; }
        pkg.pmcs.push({
          file: f, text, model, parseError,
          placeholder: !!model && isPlaceholderPmCode(model.meta.pmCode),
          reconstructedMarker: text.includes(RECONSTRUCTED_MARKER),
        });
      } else { f.kind = 'other'; pkg.others.push(f); }
    } else if (IMAGE_EXT.test(base)) {
      f.kind = /^ICN-/i.test(base) ? 'icn' : 'image';
      (f.kind === 'icn' ? pkg.icns : pkg.images).push(f);
    } else pkg.others.push(f);
    pkg.files.push(f);
  }
  // Graphics land flat beside the modules, so two files of one name from different folders would collide there.
  const byBase = new Map<string, PkgFile[]>();
  for (const f of [...pkg.icns, ...pkg.images]) (byBase.get(f.base.toLowerCase()) ?? byBase.set(f.base.toLowerCase(), []).get(f.base.toLowerCase()) as PkgFile[]).push(f);
  for (const group of byBase.values()) {
    if (group.length > 1 && group.some((g) => !g.bytes.equals(group[0].bytes))) {
      notes.push({ severity: 'warning', message: `${group[0].base} appears in ${group.length} folders (${group.map((g) => g.path).join(', ')}) with different content; graphics are stored side by side, so only one of them can be used.` });
    }
  }
  if (sameCopies.length) notes.push({ severity: 'info', message: `${sameCopies.length} file${sameCopies.length === 1 ? '' : 's'} appear${sameCopies.length === 1 ? 's' : ''} twice with identical content (for example loose and inside a zip); each is used once.` });
  for (const p of differentCopies.slice(0, 25)) notes.push({ severity: 'warning', message: `${p} appears twice with different content; the first copy is used.` });
  if (differentCopies.length > 25) notes.push({ severity: 'warning', message: `${differentCopies.length - 25} more files appear twice with different content.` });
  return pkg;
}

/** Latest issue wins when the package holds several issues of one module (a project holds each module once). */
export const issueRank = (d: DmRec): string => `${d.ident.issueNumber}-${d.ident.inWork}`;

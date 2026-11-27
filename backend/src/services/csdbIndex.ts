// =============================================================================
// The CSDB index: which data modules a project holds and what each one is (identity read from the head of the file).
//
// A leaf of csdb.ts (audit WP-10, ARC-006): projectConfig needs the list of data modules and csdb.ts needs projectConfig's rule for a new
// module, which made the two import each other. The read-only half lives here; csdb.ts re-exports it, so existing imports keep working.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { projectDirFor } from '../context';
import { bad } from './http';
import { HEAD_BYTES, MAX_PROLOG, headOf, rootStart } from './xmlHead';
import { FileMemo } from './fileMemo';
import { readProjectJson, csdbRel } from './projectRecord';

export const DM_FILE_RE = /^DMC-[A-Za-z0-9._-]+\.xml$/i;

export interface DmSummary {
  file: string; dmc: string; techName: string; infoName: string; title: string;
  issueNumber: string; inWork: string; language: string; schema: string; issue: string;
  security: string; size: number; modified: string;
  /** The identity attributes a <dmRef> to this module is written from. */
  dmCodeAttrs: Record<string, string>; identExtension?: Record<string, string>;
  issueInfoAttrs: Record<string, string>; languageAttrs: Record<string, string>;
}

export const sha = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex');

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

const attrs = (src: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = m[2];
  return out;
};

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
    // Normally the first 12 KB hold the identity. A long DOCTYPE (one entity per graphic) pushes the root
    // element further down: read on, up to the prolog limit, until it shows up.
    let size = HEAD_BYTES;
    for (;;) {
      const buf = Buffer.alloc(size);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const text = buf.toString('utf8', 0, n);
      const at = rootStart(text, 'dmodule');
      const complete = at >= 0 && text.length >= at + HEAD_BYTES;      // root found AND its identity section read in full
      if (n < size || size >= MAX_PROLOG + HEAD_BYTES || complete) return headOf(text, 'dmodule', HEAD_BYTES);
      size = Math.min(size * 4, MAX_PROLOG + HEAD_BYTES);
    }
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

// WP-18 (PERF-016, FE-029): a module's identity is read from its head once and kept until the file changes (size, mtime or ctime), so the list,
// the summary, the explorer and the BREX check stop re-reading every module on every request.
const identMemo = new FileMemo<ReturnType<typeof parseIdent>>();

export function listDms(projectId: string): DmSummary[] {
  const dir = csdbDir(projectId);
  if (!fs.existsSync(dir)) return [];
  const out: DmSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!DM_FILE_RE.test(f)) continue;
    const abs = path.join(dir, f);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    const ident = identMemo.get(abs, st, () => parseIdent(readHead(abs), f));
    // a fresh copy per call: callers may change what they are given without touching the memo
    out.push({
      ...ident, size: st.size, modified: st.mtime.toISOString(),
      dmCodeAttrs: { ...ident.dmCodeAttrs }, issueInfoAttrs: { ...ident.issueInfoAttrs }, languageAttrs: { ...ident.languageAttrs },
      identExtension: ident.identExtension ? { ...ident.identExtension } : ident.identExtension,
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

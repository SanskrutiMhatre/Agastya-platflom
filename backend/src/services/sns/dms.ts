// =============================================================================
// Data modules as the SNS code sees them: identity and titles, nothing else.
//
// `DmLike` is deliberately the common subset of csdb.DmSummary (what the project listing returns) and of what can be read
// straight from a file on disk (what a test, or a folder that is not a project yet, offers). Reading is head-only and
// regex-based, like csdb.parseIdent, so a 200-module package is read in milliseconds and a malformed module costs one
// entry, not the run. No database, no workspace: importing this file has no side effects.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { headOf } from '../xmlHead';
import { dmCodeToString, parseDmCode } from './codes';

export interface DmLike {
  file: string;
  /** "RDR-A-A05-40-00-01A-258A-D" */
  dmc: string;
  techName: string;
  infoName: string;
  dmCodeAttrs: Record<string, string>;
  issueNumber: string;
  inWork: string;
  /** "en-IN" */
  language: string;
  identExtension?: Record<string, string>;
  issueInfoAttrs?: Record<string, string>;
  languageAttrs?: Record<string, string>;
  issueDate?: Record<string, string>;
  security?: string;
}

const attrsOf = (src: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = m[2];
  return out;
};
const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const clean = (s: string | undefined): string => decode((s ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** Identity and titles of a data module from its text. null when it has no readable <dmCode>. */
export function dmLikeFromXml(xml: string, file: string): DmLike | null {
  const head = headOf(xml, 'dmodule');
  const scope = (/<dmIdent>([\s\S]*?)<\/dmIdent>/.exec(head) || [null, head])[1] as string;
  const code = /<dmCode\b([^>]*)\/?>/.exec(scope);
  if (!code) return null;
  const ca = attrsOf(code[1]);
  const parts = parseDmCode(ca);
  if (!parts) return null;
  const issue = /<issueInfo\b([^>]*)\/?>/.exec(scope);
  const lang = /<language\b([^>]*)\/?>/.exec(scope);
  const ext = /<identExtension\b([^>]*)\/?>/.exec(scope);
  const date = /<issueDate\b([^>]*)\/?>/.exec(head);
  const sec = /<security\b([^>]*)\/?>/.exec(head);
  const ia = issue ? attrsOf(issue[1]) : {};
  const la = lang ? attrsOf(lang[1]) : {};
  return {
    file,
    dmc: dmCodeToString(parts),
    techName: clean((/<techName>([\s\S]*?)<\/techName>/.exec(head) || [])[1]),
    infoName: clean((/<infoName>([\s\S]*?)<\/infoName>/.exec(head) || [])[1]),
    dmCodeAttrs: ca,
    issueNumber: ia.issueNumber ?? '', inWork: ia.inWork ?? '',
    language: la.languageIsoCode ? `${la.languageIsoCode}-${(la.countryIsoCode ?? '').toUpperCase()}` : '',
    identExtension: ext ? attrsOf(ext[1]) : undefined,
    issueInfoAttrs: ia, languageAttrs: la,
    issueDate: date ? attrsOf(date[1]) : undefined,
    security: sec ? attrsOf(sec[1]).securityClassification : undefined,
  };
}

/** Every DMC-*.xml in a folder (not recursive), read as `DmLike`. Unreadable files are skipped and named in `skipped`. */
export function readDmFolder(dir: string): { dms: DmLike[]; skipped: string[] } {
  const dms: DmLike[] = [];
  const skipped: string[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^DMC-.*\.xml$/i.test(f)) continue;
    try {
      const xml = fs.readFileSync(path.join(dir, f), 'utf8');
      const d = dmLikeFromXml(xml, f);
      if (d) dms.push(d); else skipped.push(f);
    } catch { skipped.push(f); }
  }
  return { dms, skipped };
}

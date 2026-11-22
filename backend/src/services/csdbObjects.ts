// =============================================================================
// CSDB objects other than data modules: DML, DDN, COM (comment), UPF/UPE (data update file), SMC/SME (SCORM content package), IMF (ICN metadata).
//
// File naming follows S1000D Issue 4.2 Chap 7.5.1 "File naming conventions" (the only specification text available to this project;
// later issues are UNVERIFIED for naming and the same rules are applied, flagged in docs/S1000D_COMPLIANCE_MATRIX.md):
//   DDN-MI-SENDER-RECEIVER-YEAR-SEQ.XML                      (control number = data identifier only)
//   DML-MI-SENDER-T-YEAR-SEQ_III-WW.XML
//   COM-MI-ORIGINATOR-YEAR-SEQ-T_LL[-CC].XML                 (4.2 text says _LL or _LL-CC; its own examples use _EN_GB)
//   UPF-<update code>_III-WW_LL-CC.XML  / UPE-<ext producer>-<ext code>-...
//   SMC-MI-ISSUER-NUMBER-VV_III-WW_LL-CC.XML / SME-...
//   IMF-<ICN without "ICN-">_III-WW.XML
// Existing data modules (DMC-) and publication modules (PMC-) keep their own services (csdb.ts, pm.ts); nothing here touches them.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { csdbRel, readProjectJson } from './projects';
import { bad, notFound } from './http';
import { headOf } from './xmlHead';

export type ObjectKind = 'dml' | 'ddn' | 'comment' | 'update' | 'scorm' | 'imf';
export const OBJECT_PREFIXES: Record<ObjectKind, string[]> = { dml: ['DML'], ddn: ['DDN'], comment: ['COM'], update: ['UPF', 'UPE'], scorm: ['SMC', 'SME'], imf: ['IMF'] };
const ROOT: Record<ObjectKind, string> = { dml: 'dml', ddn: 'ddn', comment: 'comment', update: 'dataUpdateFile', scorm: 'scormContentPackage', imf: 'icnMetadataFile' };
export const OBJECT_FILE_RE = /^(DML|DDN|COM|UPF|UPE|SMC|SME|IMF)-[A-Za-z0-9._-]+\.xml$/i;

export interface ObjectSummary {
  file: string; kind: ObjectKind; prefix: string; control: string; issueNumber: string; inWork: string; language: string;
  title: string; schema: string; issue: string; size: number; modified: string;
}

const attrs = (src: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g; let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = m[2];
  return out;
};
const tag = (xml: string, name: string): Record<string, string> | null => { const m = new RegExp(`<${name}\\b([^>]*?)\\/?>`).exec(xml); return m ? attrs(m[1]) : null; };

export function kindOfXml(xml: string): ObjectKind | null {
  for (const k of Object.keys(ROOT) as ObjectKind[]) if (new RegExp(`<${ROOT[k]}[\\s>]`).test(xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/g, ''))) return k;
  return null;
}
export function kindOfFile(file: string): ObjectKind | null {
  const p = file.slice(0, 3).toUpperCase();
  return (Object.keys(OBJECT_PREFIXES) as ObjectKind[]).find((k) => OBJECT_PREFIXES[k].includes(p)) ?? null;
}

const need = (a: Record<string, string> | null, keys: string[], what: string): Record<string, string> => {
  if (!a) throw bad(`The file has no <${what}> element, so its file name cannot be derived.`, 'NO_IDENT');
  const miss = keys.filter((k) => !a[k]);
  if (miss.length) throw bad(`<${what}> lacks ${miss.join(', ')}, so its file name cannot be derived.`, 'NO_IDENT');
  return a;
};
const up = (s: string) => s.toUpperCase();
const issueOf = (xml: string): string => { const i = need(tag(xml, 'issueInfo'), ['issueNumber', 'inWork'], 'issueInfo'); return `${i.issueNumber}-${i.inWork}`; };
const langOf = (xml: string, sep: string): string => { const l = need(tag(xml, 'language'), ['languageIsoCode', 'countryIsoCode'], 'language'); return `${up(l.languageIsoCode)}${sep}${up(l.countryIsoCode)}`; };

/** The CONTROLNUMBER (file name without TYPE- and .XML) the object's own identification section calls for. */
export function controlNumber(kind: ObjectKind, xml: string, prefix?: string): string {
  const ext = tag(xml, 'identExtension');
  const extPart = ext && ext.extensionProducer ? `${ext.extensionProducer}-${ext.extensionCode}-` : '';
  switch (kind) {
    case 'ddn': { const c = need(tag(xml, 'ddnCode'), ['modelIdentCode', 'senderIdent', 'receiverIdent', 'yearOfDataIssue', 'seqNumber'], 'ddnCode');
      return [c.modelIdentCode, c.senderIdent, c.receiverIdent, c.yearOfDataIssue, c.seqNumber].join('-'); }
    case 'dml': { const c = need(tag(xml, 'dmlCode'), ['modelIdentCode', 'senderIdent', 'dmlType', 'yearOfDataIssue', 'seqNumber'], 'dmlCode');
      const t = c.dmlType; const letter = /^[cps]$/i.test(t) ? t.toUpperCase() : '';
      if (!letter) throw bad(`dmlType "${t}" is not c, p or s.`, 'NO_IDENT');
      return `${[c.modelIdentCode, c.senderIdent, letter, c.yearOfDataIssue, c.seqNumber].join('-')}_${issueOf(xml)}`; }
    case 'comment': { const c = need(tag(xml, 'commentCode'), ['modelIdentCode', 'senderIdent', 'yearOfDataIssue', 'seqNumber', 'commentType'], 'commentCode');
      const t = /^[qir]$/i.test(c.commentType) ? c.commentType.toUpperCase() : '';
      if (!t) throw bad(`commentType "${c.commentType}" is not q, i or r.`, 'NO_IDENT');
      return `${[c.modelIdentCode, c.senderIdent, c.yearOfDataIssue, c.seqNumber, t].join('-')}_${langOf(xml, '-')}`; }
    case 'update': { const c = need(tag(xml, 'updateCode'), ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'], 'updateCode');
      return `${extPart}${[c.modelIdentCode, c.systemDiffCode, c.systemCode, `${c.subSystemCode}${c.subSubSystemCode}`, c.assyCode, `${c.disassyCode}${c.disassyCodeVariant}`, `${c.infoCode}${c.infoCodeVariant}`, c.itemLocationCode].join('-')}_${issueOf(xml)}_${langOf(xml, '-')}`; }
    case 'scorm': { const c = need(tag(xml, 'scormContentPackageCode'), ['modelIdentCode', 'scormContentPackageIssuer', 'scormContentPackageNumber', 'scormContentPackageVolume'], 'scormContentPackageCode');
      return `${extPart}${[c.modelIdentCode, c.scormContentPackageIssuer, c.scormContentPackageNumber, c.scormContentPackageVolume].join('-')}_${issueOf(xml)}_${langOf(xml, '-')}`; }
    case 'imf': { const c = need(tag(xml, 'imfCode'), ['imfIdentIcn'], 'imfCode');
      return `${c.imfIdentIcn.replace(/^ICN-/i, '')}_${issueOf(xml)}`; }
  }
  void prefix;
}

/** "DML-….XML": S1000D file names are upper case; the stored extension keeps the project's existing ".xml"/".XML" habit via `ext`. */
export function expectedFileName(kind: ObjectKind, xml: string, ext = 'XML'): string {
  const ident = tag(xml, 'identExtension');
  const prefix = kind === 'update' ? (ident?.extensionProducer ? 'UPE' : 'UPF') : kind === 'scorm' ? (ident?.extensionProducer ? 'SME' : 'SMC') : OBJECT_PREFIXES[kind][0];
  return `${prefix}-${up(controlNumber(kind, xml))}.${ext}`;
}

/** Why the file name does not match the content's identification (null = it does). The comment form accepts _LL-CC or _LL_CC (4.2 examples). */
export function fileNameProblem(file: string, xml: string): string | null {
  const kind = kindOfFile(file);
  if (!kind) return `"${file}" does not start with a CSDB object prefix (DML, DDN, COM, UPF, UPE, SMC, SME, IMF).`;
  let want: string;
  try { want = expectedFileName(kind, xml, path.extname(file).slice(1) || 'XML'); } catch (e) { return (e as Error).message; }
  const norm = (s: string) => (kind === 'comment' ? s.replace(/_([A-Z]{2})[-_]([A-Z]{2})\./i, '_$1-$2.') : s).toUpperCase();
  return norm(file) === norm(want) ? null : `File name ${file} does not match the identification inside the file (expected ${want}).`;
}

export function parseObject(xml: string, file: string): Omit<ObjectSummary, 'size' | 'modified'> | null {
  const kind = kindOfFile(file) ?? kindOfXml(xml);
  if (!kind) return null;
  const head = headOf(xml, ROOT[kind], 24000) || xml.slice(0, 24000);
  const loc = /noNamespaceSchemaLocation\s*=\s*"([^"]+)"/.exec(head);
  const iss = loc ? /S1000D[_-]?(\d)[-._](\d)/i.exec(loc[1]) : null;
  let control = ''; try { control = controlNumber(kind, head); } catch { control = file.replace(/^[A-Z]{3}-/i, '').replace(/\.xml$/i, ''); }
  const ii = tag(head, 'issueInfo'); const lang = tag(head, 'language');
  const title = (/<(?:dmlTitle|icnTitle|title|ddnTitle)\b[^>]*>([\s\S]*?)<\//.exec(head) || [, ''])[1].replace(/\s+/g, ' ').trim();
  return { file, kind, prefix: file.slice(0, 3).toUpperCase(), control, issueNumber: ii?.issueNumber ?? '', inWork: ii?.inWork ?? '',
    language: lang?.languageIsoCode ? `${lang.languageIsoCode}-${(lang.countryIsoCode ?? '').toUpperCase()}` : '', title,
    schema: loc ? (loc[1].split('/').pop() ?? '').replace(/\.xsd$/i, '') : '', issue: iss ? `${iss[1]}.${iss[2]}` : '' };
}

const csdbDirOf = (projectId: string) => path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId)));

export function resolveObjectFile(projectId: string, file: string): string {
  const name = String(file ?? '');
  if (!OBJECT_FILE_RE.test(name)) throw bad('A CSDB object file name looks like DML-/DDN-/COM-/UPF-/UPE-/SMC-/SME-/IMF-<code>.xml.', 'BAD_FILE_NAME');
  const dir = path.resolve(csdbDirOf(projectId)); const abs = path.resolve(dir, name);
  if (path.dirname(abs) !== dir) throw bad('Bad path.', 'BAD_FILE_NAME');
  return abs;
}

export function listObjects(projectId: string, kind?: ObjectKind): ObjectSummary[] {
  const dir = csdbDirOf(projectId); if (!fs.existsSync(dir)) return [];
  const out: ObjectSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!OBJECT_FILE_RE.test(f)) continue;
    const abs = path.join(dir, f); let st: fs.Stats; try { st = fs.statSync(abs); } catch { continue; }
    const p = parseObject(fs.readFileSync(abs, 'utf8'), f); if (!p || (kind && p.kind !== kind)) continue;
    out.push({ ...p, size: st.size, modified: st.mtime.toISOString() });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export function readObject(projectId: string, file: string): { file: string; xml: string } {
  const abs = resolveObjectFile(projectId, file);
  if (!fs.existsSync(abs)) throw notFound('No such CSDB object.');
  return { file, xml: fs.readFileSync(abs, 'utf8') };
}

// ── Writing ─────────────────────────────────────────────────────────────────

import { checkXmlSafetyOf, contentCheck } from './csdbGuard';
import { cut, sha } from './csdb';
import { docIndex } from '../context';
import { nowIso } from '../config';

export interface ObjectActor { id: string; username: string; role?: string }

/** Safety + shape checks for a CSDB object: nothing is ever stored that fails the XML safety rules; the rest can be deferred with `lenient`. */
export function validateObject(file: string, xml: string, lenient = false): ObjectKind {
  const kind = kindOfFile(file);
  if (!kind) throw bad(`"${file}" is not a CSDB object file name.`, 'BAD_FILE_NAME');
  checkXmlSafetyOf(xml);
  if (!lenient) {
    const why = contentCheck(xml); if (why) throw bad(`${file} is not well-formed XML and was not saved: ${why}`, 'MALFORMED_XML');
    if (kindOfXml(xml) !== kind) throw bad(`${file} should be a <${ROOT[kind]}> document but its root element is different.`, 'WRONG_ROOT');
    const bad1 = fileNameProblem(file, xml); if (bad1) throw bad(bad1, 'FILE_NAME_MISMATCH');
  }
  return kind;
}

export async function writeObject(projectId: string, file: string, xml: string, actor: ObjectActor, opts: { overwrite?: boolean; lenient?: boolean } = {}) {
  const abs = resolveObjectFile(projectId, file);
  validateObject(file, xml, opts.lenient);
  const existed = fs.existsSync(abs);
  if (existed && !opts.overwrite) throw bad(`${file} already exists in this project.`, 'ALREADY_EXISTS');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, xml, 'utf8');
  try {
    const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
    await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso());
    await cut(projectId, rel, xml, actor, existed ? 'save' : 'create');
  } catch (e) { console.error('[csdb-objects] history not recorded:', (e as Error).message); }
  return { file, hash: sha(xml), created: !existed };
}

export function deleteObject(projectId: string, file: string): void {
  const abs = resolveObjectFile(projectId, file);
  if (!fs.existsSync(abs)) throw notFound('No such CSDB object.');
  fs.unlinkSync(abs);
}

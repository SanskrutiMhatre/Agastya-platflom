// =============================================================================
// CSDB - the data modules of one project (workspace/projects/<id>/csdb/).
//
// Files on disk are the source of truth. Reads parse only the head of each
// module for its identity; writes are guarded the way JSS Publisher guards
// them (XXE/entity safety, "document twice" damage, locked documents), take an
// optimistic-concurrency token, and cut an immutable revision.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { vendor, nowIso } from '../config';
import { docIndex, revisions, projectDirFor } from '../context';
import { bad, conflict, notFound, forbidden } from './http';
import { HEAD_BYTES, MAX_PROLOG, headOf, rootStart } from './xmlHead';
import { wellFormedError } from './wellFormed';
import { readProjectJson, csdbRel, mediaRel } from './projects';
import { assertNewDmAllowed } from './projectConfig';

const { checkXmlSafety } = require('../core/auth/xmlGuard');
const { isDoubledXml, DOUBLED_MESSAGE } = vendor('engine/doubled');


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

export function listDms(projectId: string): DmSummary[] {
  const dir = csdbDir(projectId);
  if (!fs.existsSync(dir)) return [];
  const out: DmSummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!DM_FILE_RE.test(f)) continue;
    const abs = path.join(dir, f);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    out.push({ ...parseIdent(readHead(abs), f), size: st.size, modified: st.mtime.toISOString() });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export function readDm(projectId: string, file: string): { file: string; xml: string; hash: string; modified: string } {
  const abs = resolveDmFile(projectId, file);
  if (!fs.existsSync(abs)) throw notFound('No such data module.');
  const xml = fs.readFileSync(abs, 'utf8');
  return { file, xml, hash: sha(xml), modified: fs.statSync(abs).mtime.toISOString() };
}

interface Actor { id: string; username: string; role?: string }

function lockedFor(projectId: string, rel: string, actor: Actor, projectRole: string): boolean {
  const doc = docIndex.resolve(projectId, rel);
  return !!(doc && doc.locked_at && projectRole !== 'owner' && actor.role !== 'admin');
}

/**
 * What a data module must be to be stored. `lenient` is "import without validation": the content rules
 * (well-formed, a <dmodule> root, not doubled) are left to the later validation and publication gate,
 * so a draft with problems can still be brought in and fixed in the editor. The safety rules (not empty,
 * no entity bombs / external entities) are never lenient.
 */
export function validateContent(rel: string, xml: string, lenient = false): void {
  if (typeof xml !== 'string' || !xml.trim()) throw bad('The data module is empty.', 'EMPTY');
  const guard = checkXmlSafety(xml);
  if (!guard.ok) throw bad(guard.error, 'UNSAFE_XML');
  if (lenient) return;
  const malformed = wellFormedError(xml);
  if (malformed) throw bad(`The data module is not well-formed XML and was not saved: ${malformed}`, 'MALFORMED_XML');
  if (isDoubledXml(rel, xml)) throw conflict(DOUBLED_MESSAGE, 'DOCUMENT_DOUBLED');
  if (rootStart(xml, 'dmodule') < 0) throw bad('This is not an S1000D data module (no <dmodule> root element).', 'NOT_A_DM');
}

/** Why a file would not pass the full content rules (empty = it would), without throwing. */
export function contentProblem(rel: string, xml: string): string | null {
  try { validateContent(rel, xml, false); return null; } catch (e) { return (e as Error).message; }
}

/**
 * A project holds each data module once. Two files are the same data module when they carry the same
 * code, issue and language - a different issue or language of the same code is a legitimate, separate file.
 */
export const identityKey = (d: Pick<DmSummary, 'dmc' | 'issueNumber' | 'inWork' | 'language'>): string =>
  `${d.dmc}|${d.issueNumber}-${d.inWork}|${d.language}`.toUpperCase();

export function assertUnique(projectId: string, file: string, xml: string): void {
  const mine = parseIdent(headOf(xml), file);
  const key = identityKey(mine);
  const clash = listDms(projectId).find((d) => d.file.toLowerCase() !== file.toLowerCase() && identityKey(d) === key);
  if (clash) {
    throw conflict(`This project already has that data module: ${clash.file} has the same code (${mine.dmc}), issue (${mine.issueNumber}-${mine.inWork}) and language (${mine.language || 'none'}). Each data module exists once per project - open the existing one, or give this one a different code or issue.`, 'DUPLICATE_DMC', { existing: clash.file });
  }
}

export async function cut(projectId: string, rel: string, xml: string, actor: Actor, reason: string): Promise<void> {
  try {
    let doc = docIndex.resolve(projectId, rel);
    if (!doc) { await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso()); doc = docIndex.resolve(projectId, rel); }
    if (doc) revisions.cut(doc.id, xml, { reason, createdBy: actor.id, now: nowIso() });
  } catch (e) { console.error('[csdb] revision not recorded:', (e as Error).message); }
}

export async function writeDm(projectId: string, file: string, xml: string, baseHash: string | undefined, actor: Actor, projectRole: string, lenient = false) {
  const abs = resolveDmFile(projectId, file);
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  if (!fs.existsSync(abs)) throw notFound('No such data module. Create it first.');
  if (lockedFor(projectId, rel, actor, projectRole)) throw forbidden('This data module is locked. Only a project owner can edit it.', 'DOCUMENT_LOCKED');
  validateContent(rel, xml, lenient);
  assertUnique(projectId, file, xml);

  // Optimistic concurrency: refuse to overwrite a version the author never saw.
  const current = fs.readFileSync(abs, 'utf8');
  const currentHash = sha(current);
  if (baseHash && baseHash !== currentHash) {
    throw conflict('This data module was changed by someone else since you opened it.', 'EDIT_CONFLICT',
      { currentHash, modified: fs.statSync(abs).mtime.toISOString() });
  }
  if (current !== xml) {
    fs.writeFileSync(abs, xml, 'utf8');
    await cut(projectId, rel, xml, actor, 'save');
  }
  return { file, hash: sha(xml), modified: fs.statSync(abs).mtime.toISOString(), changed: current !== xml };
}

/**
 * Create a data module. `fromRepository`: the module is a copy out of the shared Common Information Repository, which holds modules of every model
 * code and issue by design, so the project's own MIC/issue/SNS rules do not apply to it (XSD and BREX still judge it).
 */
export async function createDm(projectId: string, file: string, xml: string, actor: Actor, lenient = false, opts: { fromRepository?: boolean; revisionOf?: string } = {}) {
  const abs = resolveDmFile(projectId, file);
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  validateContent(rel, xml, lenient);
  assertUnique(projectId, file, xml);
  if (fs.existsSync(abs)) throw conflict(`A data module named ${file} already exists in this project.`, 'ALREADY_EXISTS');
  // A NEW module must fit the project's S1000D configuration (MIC, issue, offered types and codes, SNS). The server decides this, not the form.
  // Imports (lenient) are brought in as they are: validation and the publication gate report what does not fit.
  if (!lenient && !opts.fromRepository && !opts.revisionOf) assertNewDmAllowed(projectId, xml);   // a revision of a module the project already holds is not a NEW module
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, xml, 'utf8');
  await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso());
  await cut(projectId, rel, xml, actor, 'create');
  return { file, hash: sha(xml), modified: fs.statSync(abs).mtime.toISOString() };
}

export async function deleteDm(projectId: string, file: string, actor: Actor, projectRole: string) {
  const abs = resolveDmFile(projectId, file);
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  if (!fs.existsSync(abs)) throw notFound('No such data module.');
  if (lockedFor(projectId, rel, actor, projectRole)) throw forbidden('This data module is locked. Only a project owner can delete it.', 'DOCUMENT_LOCKED');
  // Keep the last content in history so a deletion can be undone by hand.
  await cut(projectId, rel, fs.readFileSync(abs, 'utf8'), actor, 'before-delete');
  fs.unlinkSync(abs);
  await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso());
}

export function history(projectId: string, file: string) {
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  resolveDmFile(projectId, file);
  const doc = docIndex.resolve(projectId, rel);
  if (!doc) return [];
  return revisions.list(doc.id, 50).map((r: any) => ({ id: r.id, reason: r.reason, at: r.created_at, by: r.created_by, size: r.size }));
}

export function revisionContent(projectId: string, file: string, revId: number): string {
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  const doc = docIndex.resolve(projectId, rel);
  const got = doc ? revisions.content(revId) : null;
  if (!got || got.revision.document_id !== doc.id) throw notFound('No such revision.');
  return got.content;
}

// ── Graphics (ICN artwork) ────────────────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|gif|svg)$/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|bmp|webp|tiff?|cgm|cg4|pdf|mp3|wav|wma|aiff?|midi?|mp4|mpe?g|mpg4|mp2v?|avi|mov|qt|flv|asf|wmv|webm|u3d|wrl|x3d|step|iges|dwf|3dxml)$/i;
export const isImage = (name: string): boolean => IMAGE_EXT.test(name);

export function listMedia(projectId: string): Array<{ name: string; size: number; dir: 'csdb' | 'Media' }> {
  const pj = readProjectJson(projectId);
  const out: Array<{ name: string; size: number; dir: 'csdb' | 'Media' }> = [];
  for (const [label, rel] of [['Media', mediaRel(pj)], ['csdb', csdbRel(pj)]] as const) {
    const dir = path.join(projectDirFor(projectId), rel);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!ASSET_EXT.test(f)) continue;                                  // graphics and the multimedia the platform stores (see mediaFormats.ts)
      out.push({ name: f, size: fs.statSync(path.join(dir, f)).size, dir: label });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Serve path for one image, searching Media/ then csdb/, containment-checked. */
export function mediaPath(projectId: string, name: string): string | null {
  const base = path.basename(String(name));
  if (!IMAGE_EXT.test(base)) return null;
  const pj = readProjectJson(projectId);
  for (const rel of [mediaRel(pj), csdbRel(pj)]) {
    const abs = path.join(projectDirFor(projectId), rel, base);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

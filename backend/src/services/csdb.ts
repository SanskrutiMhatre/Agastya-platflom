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
import { docIndex, revisions, projectDirFor, content } from '../context';
import { bad, conflict, notFound, forbidden } from './http';
import { HEAD_BYTES, MAX_PROLOG, headOf, rootStart } from './xmlHead';
import { FileMemo } from './fileMemo';
import { wellFormedError } from './wellFormed';
import { readProjectJson, csdbRel, mediaRel } from './projectRecord';
import { assertNewDmAllowed } from './projectConfig';
import { saveRevisioned, withDocumentLock } from './projectFiles';
import { assertNotLeasedByOther } from './leases';

const { checkXmlSafety } = require('../core/auth/xmlGuard');
const { isDoubledXml, DOUBLED_MESSAGE } = vendor('engine/doubled');


// The read-only index (file names, identities, the list) lives in csdbIndex.ts (WP-10, ARC-006); re-exported here for compatibility.
export * from './csdbIndex';
import { DM_FILE_RE, DmSummary, sha, csdbDir, resolveDmFile, dmcString, parseIdent, listDms } from './csdbIndex';

// WP-10: data module files are read and written through the ContentStore (storage/contentStore.ts), addressed inside the project.
const inProject = (projectId: string, abs: string): string => path.relative(content.projectDir(projectId), abs);
const modifiedOf = (projectId: string, at: string): string => new Date(content.stat(projectId, at)!.mtimeMs).toISOString();

export function readDm(projectId: string, file: string): { file: string; xml: string; hash: string; modified: string } {
  const at = inProject(projectId, resolveDmFile(projectId, file));
  if (!content.exists(projectId, at)) throw notFound('No such data module.');
  const xml = content.readText(projectId, at);
  return { file, xml, hash: sha(xml), modified: modifiedOf(projectId, at) };
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
  const at = inProject(projectId, resolveDmFile(projectId, file));
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  if (!content.exists(projectId, at)) throw notFound('No such data module. Create it first.');
  if (lockedFor(projectId, rel, actor, projectRole)) throw forbidden('This data module is locked. Only a project owner can edit it.', 'DOCUMENT_LOCKED');
  validateContent(rel, xml, lenient);
  assertUnique(projectId, file, xml);

  // WP-11: the check and the write run under the document's write lock, the revision is recorded before the atomic write (projectFiles.ts).
  return withDocumentLock(`${projectId}:${rel}`, async () => {
    // A check-out lease held by someone else refuses the save, naming the holder (RES-001).
    await assertNotLeasedByOther(projectId, rel, actor);
    // Optimistic concurrency: refuse to overwrite a version the author never saw. The routes make the hash mandatory (versionGuard.ts);
    // `undefined` is left for the server's own callers that state an explicit overwrite (the import with overwrite=1).
    const current = content.readText(projectId, at);
    const currentHash = sha(current);
    if (baseHash !== undefined && baseHash !== currentHash) {
      throw conflict('This data module was changed by someone else since you opened it.', 'EDIT_CONFLICT',
        { currentHash, modified: modifiedOf(projectId, at) });
    }
    if (current !== xml) await saveRevisioned(projectId, at, xml, actor, 'save');
    return { file, hash: sha(xml), modified: modifiedOf(projectId, at), changed: current !== xml };
  });
}

/**
 * Create a data module. `fromRepository`: the module is a copy out of the shared Common Information Repository, which holds modules of every model
 * code and issue by design, so the project's own MIC/issue/SNS rules do not apply to it (XSD and BREX still judge it).
 */
export async function createDm(projectId: string, file: string, xml: string, actor: Actor, lenient = false, opts: { fromRepository?: boolean; revisionOf?: string } = {}) {
  const abs = resolveDmFile(projectId, file); const at = inProject(projectId, abs);
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  validateContent(rel, xml, lenient);
  assertUnique(projectId, file, xml);
  if (content.exists(projectId, at)) throw conflict(`A data module named ${file} already exists in this project.`, 'ALREADY_EXISTS');
  // A NEW module must fit the project's S1000D configuration (MIC, issue, offered types and codes, SNS). The server decides this, not the form.
  // Imports (lenient) are brought in as they are: validation and the publication gate report what does not fit.
  if (!lenient && !opts.fromRepository && !opts.revisionOf) assertNewDmAllowed(projectId, xml);   // a revision of a module the project already holds is not a NEW module
  await saveRevisioned(projectId, at, xml, actor, 'create');            // WP-11: atomic, and refused when its revision cannot be recorded
  return { file, hash: sha(xml), modified: modifiedOf(projectId, at) };
}

export async function deleteDm(projectId: string, file: string, actor: Actor, projectRole: string) {
  const at = inProject(projectId, resolveDmFile(projectId, file));
  const rel = `${csdbRel(readProjectJson(projectId))}/${file}`;
  if (!content.exists(projectId, at)) throw notFound('No such data module.');
  if (lockedFor(projectId, rel, actor, projectRole)) throw forbidden('This data module is locked. Only a project owner can delete it.', 'DOCUMENT_LOCKED');
  await assertNotLeasedByOther(projectId, rel, actor);                  // WP-11: a module checked out by someone else is not deleted under them
  // Keep the last content in history so a deletion can be undone by hand.
  await cut(projectId, rel, content.readText(projectId, at), actor, 'before-delete');
  content.remove(projectId, at);
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

// =============================================================================
// ProjectFiles - the one write path of a project's source documents (audit WP-11: REL-001, PLT-009, ARC-001, PUB-007, ENT-016).
//
// A data module, a JSS book and a JSG document are saved here, and nowhere else:
//   1. history first: if the file on disk is not yet the head of its history (written by an older build, by hand, or by a save that
//      failed after its revision), that content is recorded ("on-disk"); then the new content is recorded as a revision;
//   2. then the file is written atomically through the ContentStore (temporary sibling, fsync, rename).
// So whatever a crash leaves on disk - the old file or the new one - is in the history, and a revision that cannot be recorded fails the
// save (REVISION_FAILED, 500) instead of being logged and forgotten (PLT-009, ENT-016). A new file is written first (it has no document
// identity until it exists) and removed again when its revision cannot be recorded.
//
// The read-compare-write of a save is synchronous: in this single-process server no other request runs between the version check of a
// caller and the rename here. `withDocumentLock` serialises the few async steps around it (the short document write lock of decision D22).
// =============================================================================

import path from 'path';
import crypto from 'crypto';
import { docIndex, revisions, projectDirFor, content } from '../context';
import { nowIso } from '../config';
import { HttpError, notFound } from './http';

export interface RevisionActor { id: string }

/** Test seam (fault injection): a hook that throws makes recording the revision fail. */
export const revisionFaults: { beforeCut: ((projectId: string, rel: string) => void) | null } = { beforeCut: null };

const posix = (projectId: string, relOrAbs: string): string => path.relative(content.projectDir(projectId), content.pathOf(projectId, relOrAbs)).replace(/\\/g, '/');

const revisionFailed = (e: unknown): HttpError =>
  new HttpError(500, `The save was refused because its history could not be recorded (${(e as Error).message}). Nothing was changed; try again, and tell an administrator if it keeps happening.`, 'REVISION_FAILED');

/** The document identity of a file, indexing the project once when the file is not known yet. */
async function documentOf(projectId: string, rel: string): Promise<{ id: string } | null> {
  let doc = docIndex.resolve(projectId, rel);
  if (!doc) { await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso()); doc = docIndex.resolve(projectId, rel); }
  return doc ?? null;
}

function record(projectId: string, rel: string, docId: string, previous: string | null, text: string, actor: RevisionActor, reason: string): void {
  if (revisionFaults.beforeCut) revisionFaults.beforeCut(projectId, rel);
  const now = nowIso();
  const head = revisions.head(docId) as { hash: string } | null;
  if (previous !== null && (!head || head.hash !== sha256(previous))) revisions.cut(docId, previous, { reason: 'on-disk', createdBy: null, now });
  revisions.cut(docId, text, { reason, createdBy: actor.id, now });
}

const sha256 = (s: string): string => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

/**
 * Save a source document: its revision first, then an atomic write. `relOrAbs` is a path inside the project (or an absolute path in it).
 * Returns whether the file existed before. Throws REVISION_FAILED (and changes nothing) when the history cannot be written.
 */
export async function saveRevisioned(projectId: string, relOrAbs: string, text: string, actor: RevisionActor, reason = 'save'): Promise<{ created: boolean }> {
  const rel = posix(projectId, relOrAbs);
  if (content.exists(projectId, rel)) {
    const doc = docIndex.resolve(projectId, rel) ?? await documentOf(projectId, rel);
    const previous = content.readText(projectId, rel);
    if (doc) { try { record(projectId, rel, doc.id, previous, text, actor, reason); } catch (e) { throw revisionFailed(e); } }
    content.writeText(projectId, rel, text);
    return { created: false };
  }
  content.mkdir(projectId, path.posix.dirname(rel) || '.');
  content.writeText(projectId, rel, text);
  try {
    const doc = await documentOf(projectId, rel);
    if (doc) record(projectId, rel, doc.id, null, text, actor, reason === 'save' ? 'create' : reason);
  } catch (e) {
    try { content.remove(projectId, rel); await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso()); } catch { /* the file stays; the next save records it as on-disk */ }
    throw revisionFailed(e);
  }
  return { created: true };
}

/** Before a file is deleted: record its last content in the history, or throw REVISION_FAILED so the caller does not delete it. */
export async function recordBeforeDelete(projectId: string, relOrAbs: string, actor: RevisionActor): Promise<void> {
  const rel = posix(projectId, relOrAbs);
  try {
    const doc = docIndex.resolve(projectId, rel) ?? await documentOf(projectId, rel);
    if (doc) record(projectId, rel, doc.id, null, content.readText(projectId, rel), actor, 'before-delete');
  } catch (e) { throw revisionFailed(e); }
}

interface RevisionRow { id: number | bigint; reason: string; created_at: string; created_by: string | null; size: number; hash: string }

export interface RevisionSummary { id: number; reason: string; at: string; by: string | null; size: number; hash: string }

/** The saved versions of a document, newest first. */
export function historyOf(projectId: string, relOrAbs: string, limit = 50): RevisionSummary[] {
  const doc = docIndex.resolve(projectId, posix(projectId, relOrAbs));
  if (!doc) return [];
  return (revisions.list(doc.id, limit) as RevisionRow[]).map((r) => ({ id: Number(r.id), reason: String(r.reason), at: String(r.created_at), by: r.created_by ?? null, size: Number(r.size), hash: String(r.hash) }));
}

/** The exact text of one revision of this document (404 for a revision of another document). */
export function revisionText(projectId: string, relOrAbs: string, revId: number): { text: string; hash: string; at: string } {
  const doc = docIndex.resolve(projectId, posix(projectId, relOrAbs));
  const got = doc && Number.isInteger(revId) ? revisions.content(revId) : null;
  if (!got || got.revision.document_id !== doc.id) throw notFound('No such revision.');
  return { text: got.content, hash: String(got.revision.hash), at: String(got.revision.created_at) };
}

/** The text of the revision with this content hash, if the document's recent history has it (the base of a three-way merge). */
export function revisionByHash(projectId: string, relOrAbs: string, hash: string, depth = 200): string | null {
  const doc = docIndex.resolve(projectId, posix(projectId, relOrAbs));
  if (!doc || !hash) return null;
  const hit = (revisions.list(doc.id, depth) as RevisionRow[]).find((r) => r.hash === hash);
  return hit ? revisions.content(Number(hit.id))?.content ?? null : null;
}

/** The document id of a file (for leases), or null when it is not indexed. */
export async function documentIdOf(projectId: string, relOrAbs: string): Promise<string | null> {
  return (await documentOf(projectId, posix(projectId, relOrAbs)))?.id ?? null;
}

// ── the short document write lock (D22) ──────────────────────────────────────────────────────────────────────────────────────────
const chains = new Map<string, Promise<unknown>>();

/** Run `fn` with no other `withDocumentLock` call on the same key running at the same time (FIFO). */
export function withDocumentLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  const tail = run.then(() => undefined, () => undefined);
  chains.set(key, tail);
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

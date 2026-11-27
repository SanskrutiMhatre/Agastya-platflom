// =============================================================================
// Saving a one-file document - the JSS book or the JSG document (audit WP-11: ARC-001, PUB-007, PUB-010; decision D22).
//
// Under the document's short write lock (projectFiles.withDocumentLock):
//   1. version: a save from the current version is written as sent. A save from an older version is merged by part (docParts.ts) with
//      the base taken from the revision history; a conflicting part, or a base the history no longer has, refuses the save with 409
//      STALE_DOCUMENT and the current text and hash, so the editor can show it.
//   2. check-out: the parts this save changes (compared with the version it was made from) must not be checked out by another author.
//   3. the caller's final check (the declared document type) runs on what will be written, then the revision and the atomic write.
// The cross-part data (the identity record of document codes, numbering, front matter) is derived afterwards from the merged text by the
// caller, so it always follows what is on disk.
// =============================================================================

import crypto from 'crypto';
import { conflict } from './http';
import { content } from '../context';
import { wellFormedError } from './wellFormed';
import { changedParts, mergeByParts } from './docParts';
import { revisionByHash, saveRevisioned, withDocumentLock } from './projectFiles';
import { assertNotLeasedByOther } from './leases';

export const shaOf = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

export interface SaveActor { id: string; username?: string }
export interface OneFileSave {
  projectId: string;
  /** The document's path inside the project. */
  at: string;
  xml: string;
  /** The version the text was made from; undefined only for the server's own callers (an import into the document), which replace it. */
  baseHash: string | undefined;
  actor: SaveActor;
  partNames: string[];
  reason?: string;
  /** Runs on the text that will be written (the merged text after a merge); throws to refuse. */
  check?: (xml: string) => void;
}

/** The server's own writes into a document (an import) are made as this actor. */
export const SYSTEM_ACTOR: SaveActor = { id: 'system', username: 'system' };

export async function saveOneFileDocument(s: OneFileSave): Promise<{ xml: string; merged: boolean; changed: boolean }> {
  return withDocumentLock(`${s.projectId}:${s.at}`, async () => {
    const current = content.exists(s.projectId, s.at) ? content.readText(s.projectId, s.at) : null;
    let out = s.xml; let merged = false; let base = current;
    if (current !== null && s.baseHash !== undefined && shaOf(current) !== s.baseHash) {
      const older = s.baseHash ? revisionByHash(s.projectId, s.at, s.baseHash) : null;
      const m = older !== null ? mergeByParts(older, s.xml, current, s.partNames) : { conflicts: ['(unknown base version)'] };
      if ('conflicts' in m) {
        throw conflict('The document was saved by someone else since you opened it, and your changes overlap theirs (' + m.conflicts.join(', ') + '). Reload to see their changes.', 'STALE_DOCUMENT',
          { currentHash: shaOf(current), conflicts: m.conflicts, xml: current });
      }
      const wf = wellFormedError(m.xml);
      if (wf) throw conflict(`The merged document would not be well-formed (${wf}); reload and apply your changes again.`, 'STALE_DOCUMENT', { currentHash: shaOf(current), conflicts: [], xml: current });
      out = m.xml; merged = true; base = older;
    }
    if (base !== null && s.actor.id !== SYSTEM_ACTOR.id) {
      const ch = changedParts(base, s.xml, s.partNames);
      await assertNotLeasedByOther(s.projectId, s.at, s.actor, ch ? [...ch.parts, ...(ch.frame ? [''] : [])] : undefined);
    }
    if (s.check) s.check(out);
    if (current === out) return { xml: out, merged, changed: false };
    await saveRevisioned(s.projectId, s.at, out, s.actor, s.reason ?? (merged ? 'save (merged)' : 'save'));
    return { xml: out, merged, changed: true };
  });
}

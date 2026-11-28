// =============================================================================
// Live co-editing (Phase 3, P3-1): the formats a room can hold. A format says which file a room writes back to, how the merged XML is
// written there (through the platform's one write path: atomic write + revision history, services/projectFiles.ts), which capability a
// writer needs and which document states make it read-only. The S1000D data module is the first; JSS and JSG plug in here by the same
// contract (docs/phase3/COLLAB-CONTRACT.md) - register() is all a format needs.
// =============================================================================

import type * as Y from 'yjs';
import { content, docIndex } from '../../context';
import { readProjectJson, csdbRel } from '../projects';
import { resolveDmFile, noteDmWritten } from '../csdbIndex';
import { assertModuleSize, assertUnique } from '../csdb';
import * as cir from '../cir';
import { saveRevisioned } from '../projectFiles';
import type { RoomKind } from '../../shared/collab/protocol';
import { serializeY, yFromText, reconcileText } from './xml';

export interface CollabActor { id: string; username?: string | null }

/** Why a document is read-only for this person now (beyond the role and the check-out, which rooms.ts decides). */
export interface ReadOnlyReason { code: string; reason: string }

export interface CollabFormat {
  kind: RoomKind;
  /** The project-relative (posix) path of the file a room of `docPath` writes to. Throws (an HttpError) for a document that is not there. */
  resolve(projectId: string, docPath: string): string;
  /** The project role and capability a writer needs (a reader needs viewer + project.read). */
  writeRole: 'editor' | 'manager' | 'owner';
  writeCap: string;
  /** Fill an empty Y document from the file's text. Default: the S1000D form (services/collab/xml.ts). */
  toY(text: string, ydoc: Y.Doc, origin?: unknown): void;
  /** The file's text for a Y document. */
  fromY(ydoc: Y.Doc): string;
  /** Bring a Y document to a changed file with the fewest changes. */
  reconcile(ydoc: Y.Doc, text: string, origin?: unknown): void;
  /** Write the merged text to the file; `revision`: also record it in the history. Refuse (throw) what the format does not accept. */
  writeBack(projectId: string, rel: string, text: string, actor: CollabActor, revision: boolean): Promise<void>;
  /** Document states that stop a writer (a locked module, a linked copy). */
  readOnly?(projectId: string, rel: string, docPath: string, user: { id: string; role?: string }, projectRole: string): ReadOnlyReason | null;
  /** The part of a document a check-out covers: '' (the whole document) unless the format has parts (JSS chapters, JSG sections). */
  leasePart?: string;
}

const formats = new Map<RoomKind, CollabFormat>();
export function register(f: CollabFormat): void { formats.set(f.kind, f); }
export function formatOf(kind: RoomKind): CollabFormat | null { return formats.get(kind) ?? null; }
export function kinds(): RoomKind[] { return [...formats.keys()]; }

const DM_FILE = /^DMC-[A-Za-z0-9._-]+\.xml$/i;

/** The S1000D data module. */
export const dmFormat: CollabFormat = {
  kind: 'dm',
  writeRole: 'editor',
  writeCap: 'dm.write',
  resolve(projectId, docPath) {
    if (!DM_FILE.test(docPath)) throw Object.assign(new Error('Not a data module file name.'), { status: 400, code: 'BAD_FILE_NAME' });
    resolveDmFile(projectId, docPath);
    const rel = `${csdbRel(readProjectJson(projectId))}/${docPath}`;
    if (!content.exists(projectId, rel)) throw Object.assign(new Error('No such data module.'), { status: 404, code: 'NOT_FOUND' });
    return rel;
  },
  toY: (text, ydoc, origin) => { yFromText(text, ydoc, origin); },
  fromY: (ydoc) => serializeY(ydoc),
  reconcile: (ydoc, text, origin) => reconcileText(ydoc, text, origin),
  async writeBack(projectId, rel, text, actor, revision) {
    const file = rel.split('/').pop() ?? rel;
    assertModuleSize(text);                     // the same limit as a save from the editor
    assertUnique(projectId, file, text);        // an identity changed to another module's is not written (the room keeps it, and says so)
    if (revision) await saveRevisioned(projectId, rel, text, actor, 'collab', { selfWritten: true });
    else content.writeText(projectId, rel, text);
    noteDmWritten(projectId, file, text);
  },
  readOnly(projectId, rel, docPath, user, projectRole) {
    const doc = docIndex.resolve(projectId, rel) as { locked_at?: string | null } | null;
    if (doc && doc.locked_at && projectRole !== 'owner' && user.role !== 'admin') return { code: 'LOCKED', reason: 'This data module is locked. Only a project owner can edit it.' };
    try { cir.assertNotLinked(projectId, docPath); } catch (e) { return { code: 'LINKED', reason: (e as Error).message }; }
    return null;
  },
};

register(dmFormat);

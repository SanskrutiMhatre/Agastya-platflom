// =============================================================================
// "Files changed externally" - the one event a writer that is NOT an editor session raises after it changed a project's source files
// (Phase 3: the GitLab pull is the first such writer; P3-1 live collaboration consumes it).
//
// Contract (docs/phase3/gitlab.md, "Interface for live collaboration"):
//   * The event is raised AFTER the files are on disk and their revisions are recorded (services/projectFiles.ts saveRevisioned, atomic
//     writes): a listener can read the new content at once and compare `after` with the content hash it holds.
//   * `files[].path` is project-relative with forward slashes (the same key docIndex / withDocumentLock use: `${projectId}:${path}`).
//   * `before` / `after` are SHA-256 hex digests of the file bytes (null = the file did not exist / no longer exists). They are not git blob ids.
//   * Listeners run synchronously in registration order; a listener that throws is logged and never breaks the writer or other listeners.
//     A listener that needs async work starts it itself and must not block.
//   * The collaboration server should: for every open room whose document is in `files`, reload the document from disk (or, for a CRDT room,
//     apply the new content as one remote transaction attributed to `actor`), and tell its participants that `source` changed it.
//   * Connected pages also get `{ type: 'reload', kind: 'external' }` over the existing project WebSocket (services/broadcast.ts), sent by
//     the writer, so a page without a collaboration room refreshes too.
// =============================================================================

export interface ExternalFileChange {
  /** Project-relative path, forward slashes. */
  path: string;
  change: 'added' | 'modified' | 'deleted';
  /** SHA-256 hex of the bytes before (null when the file was added). */
  before: string | null;
  /** SHA-256 hex of the bytes now (null when the file was deleted). */
  after: string | null;
}

export interface FilesChangedExternally {
  projectId: string;
  /** Who or what wrote the files: 'gitlab' for a pull, branch switch or merge-request merge. */
  source: string;
  /** The Agastya user on whose behalf the files were written. */
  actor: { id: string; username: string };
  files: ExternalFileChange[];
  /** Free-form detail from the source (for GitLab: { commit, branch, operation }). */
  detail?: Record<string, unknown>;
  at: string;
}

export type FilesChangedListener = (ev: FilesChangedExternally) => void;

const listeners = new Set<FilesChangedListener>();

/** Subscribe; returns the unsubscribe function. */
export function onFilesChangedExternally(fn: FilesChangedListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Raise the event (writers only). Never throws. */
export function emitFilesChangedExternally(ev: FilesChangedExternally): void {
  if (!ev.files.length) return;
  for (const fn of [...listeners]) {
    try { fn(ev); } catch (e) { console.error('[external-changes] a listener failed:', (e as Error).message); }
  }
}

/** How many listeners are registered (diagnostics, tests). */
export const externalChangeListenerCount = (): number => listeners.size;

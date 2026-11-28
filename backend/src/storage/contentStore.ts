// =============================================================================
// ContentStore - the seam between the services and where project content lives (audit WP-10: PLT-028, 03 section 6).
//
// Project content (project.json, data modules, the JSS and JSG documents, pictures) stays in files. Services address it as
// (projectId, relative path) through this interface instead of joining paths onto the workspace themselves, so a server build can put
// the content on a shared volume, and WP-11 can make every write atomic and cut a revision in ONE place.
//
// The default, LocalFolderStore, reads, lists and removes under <workspace>/projects/<id>/ as the services did before; since WP-11
// every write is atomic (storage/atomicWrite.ts: temporary sibling, fsync, rename), so a crash never leaves a torn file. Paths are confined to the project folder; an escaping path is refused.
// The document engines (xsltproc, FOP) still need a local folder: `projectDir()` materialises it (for a local folder, it is just
// the folder).
// =============================================================================

import fs from 'fs';
import path from 'path';
import { writeFileAtomic, writeFilesAtomic, BatchWriteError } from './atomicWrite';

export interface ContentStat { size: number; mtimeMs: number; isDirectory: boolean }

export interface ContentStore {
  /** The local folder that holds this project's content (materialised for the engines). */
  projectDir(projectId: string): string;
  /** The local path of a file in the project; throws when `rel` would leave the project folder. `rel` may also be an absolute path, which must lie inside the project folder. */
  pathOf(projectId: string, rel: string): string;
  exists(projectId: string, rel: string): boolean;
  stat(projectId: string, rel: string): ContentStat | null;
  readText(projectId: string, rel: string): string;
  readBuffer(projectId: string, rel: string): Buffer;
  /** Write a whole file, atomically (WP-11): a reader, or the disk after a crash, sees the old or the new file, never a torn one. The folder must exist (a write never re-creates a deleted project); `mkdir` a sub-folder first. */
  writeText(projectId: string, rel: string, text: string): void;
  /** The same for binary content (pictures, uploaded files). */
  writeBuffer(projectId: string, rel: string, data: Uint8Array): void;
  /**
   * Phase 8: write several text files with the same per-file guarantee, their flushes grouped (storage/atomicWrite.ts writeFilesAtomic).
   * Nothing is renamed until every file is flushed and `precommit` (synchronous, right before the renames) has passed; a failure after that
   * throws a BatchWriteError naming the files already written.
   */
  writeTexts(projectId: string, files: Array<{ rel: string; text: string }>, precommit?: () => void): Promise<void>;
  /** Names in a folder of the project; [] when the folder does not exist. */
  list(projectId: string, relDir: string): string[];
  remove(projectId: string, rel: string): void;
  /** Create a folder (and its parents) in the project. */
  mkdir(projectId: string, relDir: string): void;
}

/**
 * Phase 3 (P3-1): who wants to hear that a project file was written or removed. The live co-editing service listens, so a change that did
 * not come from a room (an import, a conversion, a restore, a save by version from an older page) reaches the people in that document's
 * room instead of being overwritten by the next write-back. A listener never fails the write; it is told the absolute path.
 */
export type ContentWriteListener = (projectId: string, absPath: string, kind: 'write' | 'remove') => void;
const writeListeners = new Set<ContentWriteListener>();
export function onContentWrite(l: ContentWriteListener): () => void { writeListeners.add(l); return () => { writeListeners.delete(l); }; }
function told(projectId: string, absPath: string, kind: 'write' | 'remove'): void {
  for (const l of writeListeners) { try { l(projectId, absPath, kind); } catch { /* a listener never fails a write */ } }
}

export class ContentPathError extends Error {
  constructor(rel: string) { super(`Path leaves the project folder: ${rel}`); this.name = 'ContentPathError'; }
}

/** Project content in local folders: <workspace>/projects/<id>/. */
export class LocalFolderStore implements ContentStore {
  constructor(private readonly projectDirOf: (projectId: string) => string) {}

  projectDir(projectId: string): string { return this.projectDirOf(projectId); }

  pathOf(projectId: string, rel: string): string {
    const root = path.resolve(this.projectDirOf(projectId));
    const abs = path.resolve(root, String(rel ?? ''));
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new ContentPathError(String(rel));
    return abs;
  }

  exists(projectId: string, rel: string): boolean { return fs.existsSync(this.pathOf(projectId, rel)); }

  stat(projectId: string, rel: string): ContentStat | null {
    try { const st = fs.statSync(this.pathOf(projectId, rel)); return { size: st.size, mtimeMs: st.mtimeMs, isDirectory: st.isDirectory() }; } catch { return null; }
  }

  readText(projectId: string, rel: string): string { return fs.readFileSync(this.pathOf(projectId, rel), 'utf8'); }

  readBuffer(projectId: string, rel: string): Buffer { return fs.readFileSync(this.pathOf(projectId, rel)); }

  writeText(projectId: string, rel: string, text: string): void { const p = this.pathOf(projectId, rel); writeFileAtomic(p, text, 'utf8'); told(projectId, p, 'write'); }

  writeBuffer(projectId: string, rel: string, data: Uint8Array): void { const p = this.pathOf(projectId, rel); writeFileAtomic(p, data); told(projectId, p, 'write'); }

  async writeTexts(projectId: string, files: Array<{ rel: string; text: string }>, precommit?: () => void): Promise<void> {
    const batch = files.map((f) => ({ target: this.pathOf(projectId, f.rel), data: f.text }));
    try { await writeFilesAtomic(batch, precommit); } catch (e) {
      if (e instanceof BatchWriteError) for (const p of e.renamed) told(projectId, p, 'write');
      throw e;
    }
    for (const b of batch) told(projectId, b.target, 'write');
  }

  list(projectId: string, relDir: string): string[] {
    const abs = this.pathOf(projectId, relDir);
    return fs.existsSync(abs) ? fs.readdirSync(abs) : [];
  }

  remove(projectId: string, rel: string): void { const p = this.pathOf(projectId, rel); fs.unlinkSync(p); told(projectId, p, 'remove'); }

  mkdir(projectId: string, relDir: string): void { fs.mkdirSync(this.pathOf(projectId, relDir), { recursive: true }); }
}

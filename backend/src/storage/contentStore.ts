// =============================================================================
// ContentStore - the seam between the services and where project content lives (audit WP-10: PLT-028, 03 section 6).
//
// Project content (project.json, data modules, the JSS and JSG documents, pictures) stays in files. Services address it as
// (projectId, relative path) through this interface instead of joining paths onto the workspace themselves, so a server build can put
// the content on a shared volume, and WP-11 can make every write atomic and cut a revision in ONE place.
//
// The default, LocalFolderStore, does exactly what the services did before (fs read / write / list / unlink under
// <workspace>/projects/<id>/): behaviour is unchanged. Paths are confined to the project folder; an escaping path is refused.
// The document engines (xsltproc, FOP) still need a local folder: `projectDir()` materialises it (for a local folder, it is just
// the folder).
// =============================================================================

import fs from 'fs';
import path from 'path';

export interface ContentStat { size: number; mtimeMs: number; isDirectory: boolean }

export interface ContentStore {
  /** The local folder that holds this project's content (materialised for the engines). */
  projectDir(projectId: string): string;
  /** The local path of a file in the project; throws when `rel` would leave the project folder. */
  pathOf(projectId: string, rel: string): string;
  exists(projectId: string, rel: string): boolean;
  stat(projectId: string, rel: string): ContentStat | null;
  readText(projectId: string, rel: string): string;
  readBuffer(projectId: string, rel: string): Buffer;
  /** Write a whole file. The folder must exist (a write never re-creates a deleted project). WP-11 makes this atomic and revisioned here, for every caller at once. */
  writeText(projectId: string, rel: string, text: string): void;
  /** Names in a folder of the project; [] when the folder does not exist. */
  list(projectId: string, relDir: string): string[];
  remove(projectId: string, rel: string): void;
  /** Create a folder (and its parents) in the project. */
  mkdir(projectId: string, relDir: string): void;
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

  writeText(projectId: string, rel: string, text: string): void {
    fs.writeFileSync(this.pathOf(projectId, rel), text, 'utf8');
  }

  list(projectId: string, relDir: string): string[] {
    const abs = this.pathOf(projectId, relDir);
    return fs.existsSync(abs) ? fs.readdirSync(abs) : [];
  }

  remove(projectId: string, rel: string): void { fs.unlinkSync(this.pathOf(projectId, rel)); }

  mkdir(projectId: string, relDir: string): void { fs.mkdirSync(this.pathOf(projectId, relDir), { recursive: true }); }
}

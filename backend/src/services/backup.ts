// =============================================================================
// Project files export - a ZIP of the projects a person can open (administrators: every project, plus the people, memberships and recent
// activity records). Scope is the same rule the workspace uses; password hashes are never exported.
//
// This is NOT the platform backup: it has no database, so it cannot restore accounts, history, releases or settings. The platform backup with
// restore is services/platformBackup.ts (WP-12). Since WP-12 this export is streamed with the ZIP64-capable writer, files are read from disk
// as they are written (never held in memory: PERF-006, PLT-005, DEP-025), and the old in-memory writer (services/zip.ts) is gone (PLT-029).
// =============================================================================

import fs from 'fs';
import path from 'path';
import type { Writable } from 'stream';
import { store, projectDirFor } from '../context';
import { listProjectsFor, readProjectJson } from './projects';
import { ZipStreamWriter } from './zipio';

type Row = Record<string, any>;
const SKIP_DIRS = new Set(['node_modules', '.git']);

function* walk(dir: string, rel = ''): Generator<{ abs: string; rel: string }> {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name), `${rel}${e.name}/`); }
    else if (e.isFile()) yield { abs: path.join(dir, e.name), rel: `${rel}${e.name}` };
  }
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'project';

export interface BackupResult { projects: number; files: number }

/** Add one file; a file deleted between listing and reading is left out (the export describes what was there while it ran). */
async function addIfPresent(zip: ZipStreamWriter, name: string, abs: string): Promise<boolean> {
  try { await zip.addFile(name, abs); return true; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(abs)) return false;
    throw e;
  }
}

let exporting = 0;
/** How many exports are being written right now (the route refuses a second one at a time: PLT-005). */
export const exportsRunning = (): number => exporting;

export async function writeBackup(user: { id: string; role: string }, out: Writable): Promise<BackupResult> {
  exporting++;
  try {
    const zip = new ZipStreamWriter(out);
    const projects = listProjectsFor(user as any);
    let files = 0;
    const manifest: Row = { app: 'Agastya Platform', kind: 'project-files-export', restorable: false, createdAt: new Date().toISOString(), scope: user.role === 'admin' ? 'platform' : 'projects', projects: [] };

    for (const p of projects) {
      const root = `projects/${safe(p.name)}-${p.id.slice(0, 8)}/`;
      let n = 0;
      for (const f of walk(projectDirFor(p.id))) if (await addIfPresent(zip, root + f.rel, f.abs)) n++;
      files += n;
      manifest.projects.push({ id: p.id, name: p.name, folder: readProjectJson(p.id).group ?? '', files: n });
    }

    if (user.role === 'admin') {
      // The shared Common Information Repository is part of the platform, not of any one project.
      const cirRow = store.getCirProjectRow();
      if (cirRow) {
        let n = 0;
        for (const f of walk(projectDirFor(cirRow.id))) if (await addIfPresent(zip, `common-information-repository/${f.rel}`, f.abs)) n++;
        files += n;
        manifest.cir = { files: n };
      }
      const users = store.listUsers().map((u: Row) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, disabled: !!u.disabled_at, createdAt: u.created_at }));
      const members = projects.flatMap((p) => store.listMembers(p.id).map((m: Row) => ({ projectId: p.id, userId: m.user_id, username: m.username, role: m.role })));
      await zip.addBuffer('platform/users.json', Buffer.from(JSON.stringify(users, null, 2)));
      await zip.addBuffer('platform/members.json', Buffer.from(JSON.stringify(members, null, 2)));
      await zip.addBuffer('platform/audit-log.json', Buffer.from(JSON.stringify(store.listAudit({ limit: 5000 }).map((a: Row) => ({ ...a, meta: a.meta ? JSON.parse(a.meta) : null })), null, 2)));
    }
    await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    await zip.finish();
    return { projects: projects.length, files };
  } finally { exporting--; }
}

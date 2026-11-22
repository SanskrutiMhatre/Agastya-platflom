// =============================================================================
// Backup - a ZIP of the projects a person can open (administrators: every
// project, plus the people, memberships and activity records).
// Scope is the same rule the workspace uses; password hashes are never exported.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { store, projectDirFor } from '../context';
import { listProjectsFor, readProjectJson } from './projects';
import { ZipWriter } from './zip';

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

export function writeBackup(user: { id: string; role: string }, write: (b: Buffer) => void): BackupResult {
  const zip = new ZipWriter(write);
  const projects = listProjectsFor(user as any);
  let files = 0;
  const manifest: Row = { app: 'Agastya Platform', createdAt: new Date().toISOString(), scope: user.role === 'admin' ? 'platform' : 'projects', projects: [] };

  for (const p of projects) {
    const root = `projects/${safe(p.name)}-${p.id.slice(0, 8)}/`;
    let n = 0;
    for (const f of walk(projectDirFor(p.id))) {
      let st: fs.Stats; try { st = fs.statSync(f.abs); } catch { continue; }
      zip.add(root + f.rel, fs.readFileSync(f.abs), st.mtime); n++;
    }
    files += n;
    manifest.projects.push({ id: p.id, name: p.name, folder: readProjectJson(p.id).group ?? '', files: n });
  }

  if (user.role === 'admin') {
    // The shared Common Information Repository is part of the platform, not of any one project.
    const cirRow = store.getCirProjectRow();
    if (cirRow) {
      let n = 0;
      for (const f of walk(projectDirFor(cirRow.id))) {
        let st: fs.Stats; try { st = fs.statSync(f.abs); } catch { continue; }
        zip.add(`common-information-repository/${f.rel}`, fs.readFileSync(f.abs), st.mtime); n++;
      }
      files += n;
      manifest.cir = { files: n };
    }
    const users = store.listUsers().map((u: Row) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, disabled: !!u.disabled_at, createdAt: u.created_at }));
    const members = projects.flatMap((p) => store.listMembers(p.id).map((m: Row) => ({ projectId: p.id, userId: m.user_id, username: m.username, role: m.role })));
    zip.add('platform/users.json', Buffer.from(JSON.stringify(users, null, 2)));
    zip.add('platform/members.json', Buffer.from(JSON.stringify(members, null, 2)));
    zip.add('platform/audit-log.json', Buffer.from(JSON.stringify(store.listAudit({ limit: 5000 }).map((a: Row) => ({ ...a, meta: a.meta ? JSON.parse(a.meta) : null })), null, 2)));
  }
  zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.end();
  return { projects: projects.length, files };
}

// One server per data folder (audit WP-06: DEP-017). Two servers on one workspace share one SQLite database and one set of project
// folders with no coordination between them; the second one must not start. The lock is a file in the workspace holding the owner's
// process id and host. A lock left by a process that is gone (a crash, a power cut) is taken over; one held by a live process on this
// computer stops the start with a clear message.

import fs from 'fs';
import os from 'os';
import path from 'path';

const LOCK_NAME = '.agastya-server.lock';
let held: string | null = null;

interface LockInfo { pid: number; host: string; startedAt: string }

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function readLock(file: string): LockInfo | null {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j.pid === 'number' ? j : null; } catch { return null; }
}

/** Take the workspace for this process, or throw when another live server holds it. */
export function acquireWorkspaceLock(workspaceDir: string): void {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const file = path.join(workspaceDir, LOCK_NAME);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() } satisfies LockInfo)); }
      finally { fs.closeSync(fd); }
      held = file;
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const info = readLock(file);
      if (info && info.pid !== process.pid && info.host === os.hostname() && alive(info.pid)) {
        throw new Error(`The data folder ${workspaceDir} is already in use by another Agastya Platform server (process ${info.pid}, started ${info.startedAt}). `
          + 'Stop that server first, or start this one with its own data folder (AGASTYA_WORKSPACE_DIR).');
      }
      if (info && info.host !== os.hostname() && info.pid !== process.pid) {
        // Another computer (a shared drive): its process cannot be checked from here, so the lock is honoured unless it is old.
        const age = Date.now() - Date.parse(info.startedAt);
        if (!(age > 7 * 24 * 3600_000)) {
          throw new Error(`The data folder ${workspaceDir} is in use by an Agastya Platform server on ${info.host} (process ${info.pid}). `
            + `If that server is no longer running, delete ${file} and start again.`);
        }
      }
      try { fs.rmSync(file, { force: true }); } catch { /* raced with another starter: try again */ }
    }
  }
  throw new Error(`Could not take the lock ${file}.`);
}

/** Give the workspace back (a clean stop). Only this process's own lock is removed. */
export function releaseWorkspaceLock(): void {
  if (!held) return;
  const info = readLock(held);
  if (info && info.pid === process.pid) { try { fs.rmSync(held, { force: true }); } catch { /* already gone */ } }
  held = null;
}

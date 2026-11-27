// =============================================================================
// Atomic file writes (audit WP-11: REL-001, PLT-009, PUB-007, ARC-001).
//
// A write never touches the live file: the bytes go to a sibling temporary file in the same folder (so the rename stays on one volume),
// are flushed to the disk (fsync), and the temporary file is then renamed over the target. A rename inside one folder is atomic on NTFS
// and on POSIX file systems: a reader, or the file after a crash or a power cut, sees either the whole old file or the whole new one,
// never a torn mixture. The folder itself is flushed where the platform allows it (POSIX), so the rename survives a power cut as well.
//
// Windows: another process (a virus scanner, the search indexer, a reader that has the file open without FILE_SHARE_DELETE) can make the
// rename fail for a moment with EPERM / EACCES / EBUSY. The rename is retried a few times with a short pause before the write fails; the
// live file is untouched in every failure case, and the temporary file is removed.
//
// The temporary file is named `.<name>.tmp-<pid>-<random>`: hidden (the document index skips dot files) and never mistaken for a source.
// A process killed between the write and the rename leaves one such file behind; `sweepTempFiles` removes them.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TMP_RE = /^\..+\.tmp-\d+-[0-9a-f]{12}$/;
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Test seam (fault injection): called after the temporary file is complete and flushed, before the rename. A hook that throws makes the write fail there. */
export const atomicFaults: { beforeRename: ((target: string, tmp: string) => void) | null } = { beforeRename: null };

const pause = (ms: number): void => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait available: retry at once */ } };

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code) || attempt >= 8) throw e;
      pause(15 * (attempt + 1));
    }
  }
}

function fsyncDir(dir: string): void {
  // POSIX: flush the folder entry so the rename itself is durable. Windows cannot open a folder this way (EISDIR / EPERM): NTFS journals the rename.
  let fd: number | null = null;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* not supported on this platform */ } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/** The sibling temporary file a write of `target` uses. */
export const tempNameFor = (target: string): string =>
  path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);

/**
 * Write `data` to `target` atomically: temporary sibling, fsync, rename. The folder must exist (a write never re-creates a removed folder).
 * Throws (and leaves `target` as it was) when any step fails.
 */
export function writeFileAtomic(target: string, data: string | Uint8Array, encoding: BufferEncoding = 'utf8'): void {
  const tmp = tempNameFor(target);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'wx');
    const buf = typeof data === 'string' ? Buffer.from(data, encoding) : data;
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    if (atomicFaults.beforeRename) atomicFaults.beforeRename(target, tmp);
    renameWithRetry(tmp, target);
  } catch (e) {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
    try { fs.unlinkSync(tmp); } catch { /* never created, or already renamed */ }
    throw e;
  }
  fsyncDir(path.dirname(target));
}

/**
 * WP-30 (QA-008, found by the chaos suite): make `tmp` - a complete file that another program wrote under a `tempNameFor` name, such as FOP's
 * PDF - the file `target`: flush it, rename it over the target (retrying the transient Windows refusals), flush the folder. A server killed
 * while the program was still writing leaves only the temporary file (swept by `sweepTempFiles`), never a torn `target`. On failure the
 * temporary file is removed and `target` is as it was.
 */
export function commitFile(tmp: string, target: string): void {
  try {
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (atomicFaults.beforeRename) atomicFaults.beforeRename(target, tmp);
    renameWithRetry(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* never written, or already renamed */ }
    throw e;
  }
  fsyncDir(path.dirname(target));
}

/** Copy `src` over `target` atomically (a sibling temporary copy, then `commitFile`). */
export function copyFileAtomic(src: string, target: string): void {
  const tmp = tempNameFor(target);
  try { fs.copyFileSync(src, tmp); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw e; }
  commitFile(tmp, target);
}

/** Remove `tmp` if it is there (a build that failed before `commitFile`). */
export function discardTemp(tmp: string): void { try { fs.unlinkSync(tmp); } catch { /* never written */ } }

/** Is this a temporary file left by an interrupted atomic write? */
export const isAtomicTemp = (name: string): boolean => TMP_RE.test(name);

/** Remove the temporary files an interrupted write left in `dir` and below (older than `olderThanMs`). Returns how many were removed. */
export function sweepTempFiles(dir: string, olderThanMs = 60_000, now = Date.now()): number {
  let n = 0;
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 6 && e.name !== 'node_modules') walk(p, depth + 1); continue; }
      if (!isAtomicTemp(e.name)) continue;
      try { if (now - fs.statSync(p).mtimeMs >= olderThanMs) { fs.unlinkSync(p); n++; } } catch { /* gone */ }
    }
  };
  walk(dir, 0);
  return n;
}

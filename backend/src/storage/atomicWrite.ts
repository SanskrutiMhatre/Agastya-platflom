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

/*
  Phase 8 (docs/phase3/cleanup-backend.md, item 1): many files in one go (the package import writes up to 1,000 modules).

  `writeFilesAtomic` gives every file the same guarantee as `writeFileAtomic` (a reader, or the disk after a crash or a power cut, sees the
  whole old file or the whole new one, never a torn mixture), with the work grouped:
    1. every file's bytes go to its own sibling temporary file (opened 'wx', written in full);
    2. every temporary file is flushed (fsync) - each one, because a rename made durable before the data it names would, after a power cut,
       leave an empty or garbage target on a file system that does not journal data (NTFS journals metadata only; ext4 delayed allocation).
       The flushes run in parallel on the libuv thread pool instead of one after another on the event loop: on Windows each FlushFileBuffers
       takes 4-5 ms, and several in flight at once overlap in the disk queue (measured: 1,000 x 8 KB files, 5.3 s one by one, 3.4 s grouped);
    3. only after EVERY flush has succeeded is anything renamed, so a failure up to here changes no target at all (all temporary files are
       removed); each rename is atomic on its own (one folder, one volume), retried like `writeFileAtomic`'s;
    4. each parent folder is flushed ONCE, after all of its renames (POSIX; Windows cannot flush a folder and NTFS journals the renames),
       instead of once per file: the folder entry is durable when that flush returns, which is when the function returns, exactly as for
       a single write.
  What is NOT promised (and was not before, with one write per file): that the batch is all-or-nothing across files. A failure during step 3
  leaves the files already renamed with their new content and the rest untouched; the error carries the targets already renamed
  (`BatchWriteError.renamed`), so a caller can undo or report them (the package import rolls back the files it created).
*/
export interface BatchFile { target: string; data: string | Uint8Array; encoding?: BufferEncoding }
export class BatchWriteError extends Error {
  constructor(readonly failure: unknown, readonly renamed: string[]) { super((failure as Error)?.message ?? String(failure)); this.name = 'BatchWriteError'; }
}
const fsyncAsync = (fd: number): Promise<void> => new Promise((resolve, reject) => fs.fsync(fd, (e) => (e ? reject(e) : resolve())));

/**
 * Write every file of `files` atomically (see above). Resolves when all are renamed and their folders flushed; the targets must be distinct and
 * their folders exist. `precommit` runs synchronously after every flush and before the first rename (nothing else runs in between): a caller
 * whose checks may have been overtaken while the flushes ran re-checks there; when it throws, nothing is renamed and the temporary files go.
 */
export async function writeFilesAtomic(files: BatchFile[], precommit?: () => void): Promise<void> {
  const seen = new Set<string>();
  for (const f of files) { const k = path.resolve(f.target).toLowerCase(); if (seen.has(k)) throw new Error(`writeFilesAtomic: ${f.target} is named twice`); seen.add(k); }
  const open: Array<{ target: string; tmp: string; fd: number | null }> = [];
  const discard = (): void => { for (const o of open) { if (o.fd !== null) try { fs.closeSync(o.fd); } catch { /* closed */ } o.fd = null; try { fs.unlinkSync(o.tmp); } catch { /* none */ } } };
  try {
    for (const f of files) {
      const o = { target: f.target, tmp: tempNameFor(f.target), fd: null as number | null };
      o.fd = fs.openSync(o.tmp, 'wx'); open.push(o);
      const buf = typeof f.data === 'string' ? Buffer.from(f.data, f.encoding ?? 'utf8') : f.data;
      let off = 0;
      while (off < buf.length) off += fs.writeSync(o.fd, buf, off, buf.length - off);
    }
    await Promise.all(open.map((o) => fsyncAsync(o.fd as number)));
    for (const o of open) { fs.closeSync(o.fd as number); o.fd = null; }
    precommit?.();
  } catch (e) { discard(); throw e; }
  const renamed: string[] = [];
  try {
    for (const o of open) {
      if (atomicFaults.beforeRename) atomicFaults.beforeRename(o.target, o.tmp);
      renameWithRetry(o.tmp, o.target);
      renamed.push(o.target);
    }
  } catch (e) {
    for (const o of open) if (!renamed.includes(o.target)) try { fs.unlinkSync(o.tmp); } catch { /* none */ }
    for (const d of new Set(renamed.map((t) => path.dirname(t)))) fsyncDir(d);
    throw new BatchWriteError(e, renamed);
  }
  for (const d of new Set(open.map((o) => path.dirname(o.target)))) fsyncDir(d);
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

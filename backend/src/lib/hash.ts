// =============================================================================
// SHA-256 helpers shared by every service (audit WP-16, PUB-028). There were five named copies with three signatures (string, Buffer,
// file) plus two streaming file hashers.
// =============================================================================

import fs from 'fs';
import crypto from 'crypto';

/** SHA-256 (hex) of a string (UTF-8) or a buffer. */
export function sha256(data: string | Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** SHA-256 (hex) of a file, read in 1 MB blocks (a large file is never held in memory whole). Throws when the file cannot be read. */
export function sha256File(abs: string): string {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(abs, 'r');
  const buf = Buffer.alloc(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** `sha256File`, or `fallback` when the file cannot be read (a gate compares before and after: a file that vanished must read as changed). */
export function sha256FileOr(abs: string, fallback = 'MISSING'): string {
  try { return sha256File(abs); } catch { return fallback; }
}

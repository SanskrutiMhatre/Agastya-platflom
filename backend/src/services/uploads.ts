// Streaming uploads: multipart files go to disk as they arrive (never held in memory), up to a configurable size.
//   AGASTYA_MAX_UPLOAD_BYTES   per file, default 2 GB (2 147 483 648)
//   AGASTYA_REQUEST_TIMEOUT_MS how long one request may take to arrive in full, default 3 hours. Node's own default is 5 minutes, which cuts a
//                              2 GB upload on a slow link with a 408 (measured, Phase 18); the header timeout stays at its short default.
// A route that accepts a file reads it from `file.path` and removes it with `discard` when done (also on error).
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { config, envPositive } from '../config';

// WP-10 (PLT-032): the limits come from the one typed configuration; envPositive lives there and is re-exported for compatibility.
export { envPositive };
export const MAX_UPLOAD_BYTES = config.limits.maxUploadBytes;
export const uploadTmp = (): string => { const d = path.join(os.tmpdir(), 'agastya-uploads'); fs.mkdirSync(d, { recursive: true }); return d; };
export const diskUpload = (opts: { files?: number } = {}) => multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, uploadTmp()), filename: (_r, _f, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.upload`) }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: opts.files ?? 1 },
});
export const discard = (files: Array<{ path?: string }> | undefined): void => { for (const f of files ?? []) if (f.path) try { fs.unlinkSync(f.path); } catch { /* gone */ } };
export const tooLarge = (): { error: string; code: string } => ({ error: `A file is larger than the upload limit (${Math.round(MAX_UPLOAD_BYTES / 1024 ** 2)} MB; set AGASTYA_MAX_UPLOAD_BYTES to change it).`, code: 'FILE_TOO_LARGE' });

/** Time one request may take to arrive in full. Bounded (not disabled) so a stalled client cannot hold a connection forever. */
export const REQUEST_TIMEOUT_MS = config.limits.requestTimeoutMs;
/**
 * Server timeouts. requestTimeout: see above. keepAliveTimeout: Node closes an idle connection after 5 s, so a client (or a proxy) that reuses it a moment later
 * is reset ("fetch failed" / ECONNRESET) - seen in the test harness after a slow synchronous step, and a known cause of sporadic errors behind proxies.
 * 65 s is longer than the usual client / load-balancer idle timeout; headersTimeout must stay above it.
 */
export const KEEP_ALIVE_MS = 65_000;
export const tuneServer = (s: import('http').Server): void => { s.requestTimeout = REQUEST_TIMEOUT_MS; s.keepAliveTimeout = KEEP_ALIVE_MS; s.headersTimeout = KEEP_ALIVE_MS + 1_000; };

/** Remove upload files an aborted or crashed request left behind (older than the longest request can last, plus an hour). */
export function sweepStaleUploads(now = Date.now(), dir = uploadTmp()): number {
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.upload')) continue;
    const p = path.join(dir, f);
    try { if (now - fs.statSync(p).mtimeMs > REQUEST_TIMEOUT_MS + 3600_000) { fs.unlinkSync(p); n++; } } catch { /* gone */ }
  }
  return n;
}
